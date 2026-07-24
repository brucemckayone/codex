/**
 * Course monetization round-trip (Codex-2pryk · WP-6 · SPEC §7).
 *
 * The critical WRITE→READ round-trip for every §7 path: a purchase / grant /
 * tier subscription writes the row the WP-2 resolver reads, and the resolver
 * then GRANTS. Runs against live Postgres (LOCAL_PROXY) so the split-FK CHECK,
 * the partial-unique idempotency indexes, and the N1 composite FKs are all
 * exercised for real — not stubbed.
 *
 * Covered:
 *   1. One-off course purchase → entitlement + auto-enroll → canEnterCourse ✓;
 *      replay is idempotent (no duplicate grant/enrollment/purchase).
 *   2. Course-subscription grant (the write seam the service uses) →
 *      canEnterCourse ✓; expiry fails closed; revoke cuts access.
 *   3. Tier access (exact grant) + active subscription → canEnterCourse ✓ (derived).
 *   4. N1: a cross-org tier grant is REJECTED (service guard AND DB composite FK).
 *   5. One-off content purchase → content entitlement → resolver reads it.
 *   6. getCourseOffer composes all three paths + the viewer's entitlement.
 *   7. Payout idempotency: the Option-B fan-out writes each ledger row once.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courses,
  courseTierAccess,
  entitlements,
  organizationMemberships,
  organizations,
  purchases,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  ForbiddenError,
  PurchaseService,
  revokeCourseSubscriptionEntitlement,
  writeCourseSubscriptionEntitlement,
} from '@codex/purchase';
import {
  createTestConnectAccountInput,
  createTestContentInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  hasCourseEntitlement,
  hasStoredContentEntitlement,
} from '../content-access/entitlements-resolver';
import { CourseAccessService } from '../course-access-service';

/** Minimal Stripe stub — only `transfers.create` is reached by the payout path. */
function makeStripeStub() {
  const transferCreate = vi.fn(async () => ({ id: `tr_${randomUUID()}` }));
  const stripe = {
    transfers: { create: transferCreate },
  } as unknown as Stripe;
  return { stripe, transferCreate };
}

async function createCourse(
  db: Database,
  orgId: string,
  creatorId: string,
  overrides: { priceCents?: number | null; status?: string } = {}
): Promise<string> {
  const [row] = await db
    .insert(courses)
    .values({
      organizationId: orgId,
      creatorId,
      slug: createUniqueSlug('course'),
      title: 'Test Course',
      status: overrides.status ?? 'published',
      priceCents: overrides.priceCents ?? 5000,
    })
    .returning({ id: courses.id });
  if (!row) throw new Error('failed to create course');
  return row.id;
}

describe('Course monetization round-trip (WP-6)', () => {
  let db: Database;
  let buyerId: string;
  let buyer2Id: string;
  let tierSubUserId: string;
  let creatorId: string;
  let creatorBId: string;
  let orgAId: string;
  let orgBId: string;
  let tierAId: string;
  let tierBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, buyer2Id, tierSubUserId, creatorId, creatorBId] =
      await seedTestUsers(db, 5);

    // Creator's Connect account (receives creator + org-fee slices for org A,
    // since the creator is org A's owner → org's primary Connect account).
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId))
      .onConflictDoNothing();

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Org A', slug: createUniqueSlug('org-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Org B', slug: createUniqueSlug('org-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;

    await db.insert(organizationMemberships).values([
      {
        organizationId: orgAId,
        userId: creatorId,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: orgBId,
        userId: creatorBId,
        role: 'owner',
        status: 'active',
      },
    ]);

    const [tierA] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgAId, { sortOrder: 1 }))
      .returning({ id: subscriptionTiers.id });
    const [tierB] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgBId, { sortOrder: 1 }))
      .returning({ id: subscriptionTiers.id });
    if (!tierA || !tierB) throw new Error('failed to create tiers');
    tierAId = tierA.id;
    tierBId = tierB.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('1. course purchase writes entitlement + enrollment → canEnterCourse grants; replay is idempotent', async () => {
    const courseId = await createCourse(db, orgAId, creatorId);
    const { stripe } = makeStripeStub();
    const svc = new PurchaseService({ db, environment: 'test' }, stripe);

    // Before: no access.
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(false);

    const pi = `pi_${randomUUID()}`;
    await svc.completeCoursePurchase(pi, {
      customerId: buyerId,
      courseId,
      amountPaidCents: 5000,
      currency: 'gbp',
      // No stripeChargeId → payouts intentionally skipped for the entitlement leg.
    });

    // Round-trip: the resolver now GRANTS.
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(true);

    const grants = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyerId),
          eq(entitlements.courseId, courseId)
        )
      );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.source).toBe('course_purchase');

    const enrollCount = await db.query.courseEnrollments.findMany({
      where: (t, { and: a, eq: e }) =>
        a(e(t.userId, buyerId), e(t.courseId, courseId)),
    });
    expect(enrollCount).toHaveLength(1);

    // Replay with the SAME payment intent — idempotent (no dup grant/enrollment).
    await svc.completeCoursePurchase(pi, {
      customerId: buyerId,
      courseId,
      amountPaidCents: 5000,
      currency: 'gbp',
    });
    const grantsAfter = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyerId),
          eq(entitlements.courseId, courseId)
        )
      );
    expect(grantsAfter).toHaveLength(1);
    const purchasesForPi = await db
      .select()
      .from(purchases)
      .where(eq(purchases.stripePaymentIntentId, pi));
    expect(purchasesForPi).toHaveLength(1);
    expect(purchasesForPi[0]?.courseId).toBe(courseId);
    expect(purchasesForPi[0]?.contentId).toBeNull();
  });

  it('2. course-subscription grant → canEnterCourse grants; expiry fails closed; revoke cuts access', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await writeCourseSubscriptionEntitlement(db, {
      userId: buyerId,
      organizationId: orgAId,
      courseId,
      courseSubscriptionId: randomUUID(),
      expiresAt: future,
    });
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(true);

    // Revoke (subscription cancelled) → resolver stops granting.
    await revokeCourseSubscriptionEntitlement(db, {
      userId: buyerId,
      courseId,
    });
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(false);

    // A grant already expired fails closed (never grants).
    const expiredCourseId = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    await writeCourseSubscriptionEntitlement(db, {
      userId: buyer2Id,
      organizationId: orgAId,
      courseId: expiredCourseId,
      courseSubscriptionId: randomUUID(),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await hasCourseEntitlement(db, buyer2Id, expiredCourseId)).toBe(
      false
    );
  });

  it('3. tier access + active subscription → canEnterCourse grants (derived)', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const svc = new CourseAccessService({ db, environment: 'test' });

    await svc.setTierAccess(courseId, [tierAId]);

    // No subscription yet → no derived access.
    expect(await hasCourseEntitlement(db, tierSubUserId, courseId)).toBe(false);

    await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(tierSubUserId, orgAId, tierAId));

    // Active subscription intersecting the exact tier grant → derived access.
    expect(await hasCourseEntitlement(db, tierSubUserId, courseId)).toBe(true);
  });

  it('4. N1: a cross-org tier grant is rejected by the service guard AND the DB', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const svc = new CourseAccessService({ db, environment: 'test' });

    // Service guard: tier B (org B) cannot unlock a course in org A.
    await expect(svc.setTierAccess(courseId, [tierBId])).rejects.toBeInstanceOf(
      ForbiddenError
    );

    // Durable DB backstop: a direct cross-org insert violates the composite FK.
    await expect(
      db.insert(courseTierAccess).values({
        courseId,
        tierId: tierBId,
        organizationId: orgAId,
      })
    ).rejects.toThrow();
  });

  it('5. content purchase writes a content entitlement the resolver reads', async () => {
    const [contentRow] = await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, {
          organizationId: orgAId,
          status: 'published',
          isFree: false,
          isPurchasable: true,
          priceCents: 3000,
        })
      )
      .returning({ id: content.id });
    if (!contentRow) throw new Error('failed to create content');

    const { stripe } = makeStripeStub();
    const svc = new PurchaseService({ db, environment: 'test' }, stripe);

    expect(await hasStoredContentEntitlement(db, buyerId, contentRow.id)).toBe(
      false
    );

    await svc.completePurchase(`pi_${randomUUID()}`, {
      customerId: buyerId,
      contentId: contentRow.id,
      organizationId: orgAId,
      amountPaidCents: 3000,
      currency: 'gbp',
    });

    expect(await hasStoredContentEntitlement(db, buyerId, contentRow.id)).toBe(
      true
    );
  });

  it('6. getCourseOffer composes purchase + tier paths + viewer entitlement', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: 7500,
    });
    const svc = new CourseAccessService({ db, environment: 'test' });
    await svc.setTierAccess(courseId, [tierAId]);

    const anonOffer = await svc.getCourseOffer(courseId, null);
    expect(anonOffer.purchase).toEqual({ priceCents: 7500 });
    expect(anonOffer.paths).toContain('purchase');
    expect(anonOffer.paths).toContain('tier');
    expect(anonOffer.tiers.map((t) => t.tierId)).toContain(tierAId);
    expect(anonOffer.entitled).toBe(false);

    // A buyer who purchases sees entitled=true.
    const { stripe } = makeStripeStub();
    const purchase = new PurchaseService({ db, environment: 'test' }, stripe);
    await purchase.completeCoursePurchase(`pi_${randomUUID()}`, {
      customerId: buyer2Id,
      courseId,
      amountPaidCents: 7500,
      currency: 'gbp',
    });
    const ownerOffer = await svc.getCourseOffer(courseId, buyer2Id);
    expect(ownerOffer.entitled).toBe(true);
  });

  it('7. course purchase payouts write each ledger row once and replay is idempotent', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: 5000,
    });
    const { stripe, transferCreate } = makeStripeStub();
    const svc = new PurchaseService({ db, environment: 'test' }, stripe);

    const pi = `pi_${randomUUID()}`;
    const chargeId = `ch_${randomUUID()}`;
    const meta = {
      customerId: tierSubUserId,
      courseId,
      amountPaidCents: 5000,
      currency: 'gbp',
      stripeChargeId: chargeId,
    };

    await svc.completeCoursePurchase(pi, meta);

    const purchaseRow = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.stripePaymentIntentId, pi));
    const purchaseId = purchaseRow[0]?.id;
    expect(purchaseId).toBeDefined();

    const payoutRows = await db.query.payouts.findMany({
      where: (t, { eq: e }) => e(t.purchaseId, purchaseId as string),
    });
    // platform_fee + creator_payout + organization_fee, one each.
    const byType = payoutRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.payoutType] = (acc[r.payoutType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType.platform_fee).toBe(1);
    expect(byType.creator_payout).toBe(1);
    expect(byType.organization_fee).toBe(1);
    // Split sums exactly to the amount (DB CHECK also enforces on purchase row).
    const total = payoutRows.reduce((s, r) => s + r.amountCents, 0);
    expect(total).toBe(5000);
    const transfersAfterFirst = transferCreate.mock.calls.length;
    expect(transfersAfterFirst).toBe(2); // creator + org secondary transfers

    // Replay same PI → isNew=false → payouts skipped, no new transfers/rows.
    await svc.completeCoursePurchase(pi, meta);
    const payoutRowsAfter = await db.query.payouts.findMany({
      where: (t, { eq: e }) => e(t.purchaseId, purchaseId as string),
    });
    expect(payoutRowsAfter).toHaveLength(payoutRows.length);
    expect(transferCreate.mock.calls.length).toBe(transfersAfterFirst);
  });
});
