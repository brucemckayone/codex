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
 *   8. Refund a one-off COURSE purchase → the grant is revoked → canEnterCourse
 *      DENIES (the money-critical refund-revokes-access invariant).
 *   9. Refund a one-off CONTENT purchase → the grant is revoked → canView DENIES.
 *  10. Dispute/chargeback a one-off COURSE purchase → the SAME sourceRef-keyed
 *      revoke fires → canEnterCourse DENIES. Higher-severity than the content
 *      case: a course_purchase grant is permanent and has NO verifyPurchase
 *      backstop, so the entitlement row is the sole access record.
 *  11. Dispute a one-off CONTENT purchase → the grant is revoked → canView DENIES.
 *  12. A course purchase pays the creator's agreed share past the agreement's
 *      review date (AGR-01, Codex-2hxff.17).
 */

import { randomUUID } from 'node:crypto';
import {
  agreementProposals,
  content,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  courseTierAccess,
  creatorOrganizationAgreements,
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
// Imported from the DEFINING package, not a re-export: `toBeInstanceOf` compares
// class identity, and the service throws this exact class.
import { NotFoundError } from '@codex/service-errors';
import {
  createTestConnectAccountInput,
  createTestContentInput,
  createTestMoneyDeps,
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
  resolveCourseEntitlementsBatch,
} from '../content-access/entitlements-resolver';
import { CourseAccessService } from '../course-access-service';
import { EntitlementsService } from '../entitlements-service';

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
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

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
    const courseSubscriptionId = randomUUID();

    await writeCourseSubscriptionEntitlement(db, {
      userId: buyerId,
      organizationId: orgAId,
      courseId,
      courseSubscriptionId,
      expiresAt: future,
    });
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(true);

    // Revoke (subscription cancelled) → resolver stops granting.
    await revokeCourseSubscriptionEntitlement(db, { courseSubscriptionId });
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

    await svc.setTierAccess(orgAId, courseId, [tierAId]);

    // No subscription yet → no derived access.
    expect(await hasCourseEntitlement(db, tierSubUserId, courseId)).toBe(false);

    await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(tierSubUserId, orgAId, tierAId));

    // Active subscription intersecting the exact tier grant → derived access.
    expect(await hasCourseEntitlement(db, tierSubUserId, courseId)).toBe(true);
  });

  it('3b. a past_due tier subscription keeps derived course access; cancelled ends it (Codex-2hxff.10)', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const svc = new CourseAccessService({ db, environment: 'test' });
    await svc.setTierAccess(orgAId, courseId, [tierAId]);
    const [userId] = await seedTestUsers(db, 1);
    const [sub] = await db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(userId ?? '', orgAId, tierAId, {
          status: 'past_due',
        })
      )
      .returning();

    // A failed renewal keeps access while Stripe retries (owner decision P-3).
    expect(await hasCourseEntitlement(db, userId ?? '', courseId)).toBe(true);

    await db
      .update(subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(subscriptions.id, sub?.id ?? ''));
    expect(await hasCourseEntitlement(db, userId ?? '', courseId)).toBe(false);
  });

  it('4. N1: a cross-org tier grant is rejected by the service guard AND the DB', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const svc = new CourseAccessService({ db, environment: 'test' });

    // Service guard: tier B (org B) cannot unlock a course in org A.
    await expect(
      svc.setTierAccess(orgAId, courseId, [tierBId])
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Durable DB backstop: a direct cross-org insert violates the composite FK.
    await expect(
      db.insert(courseTierAccess).values({
        courseId,
        tierId: tierBId,
        organizationId: orgAId,
      })
    ).rejects.toThrow();
  });

  it('4b. setTierAccess is org-scoped: org A cannot touch org B’s course (Codex-2pryk.2.4.1)', async () => {
    // The route proves the caller manages org A; `courseId` arrives from an
    // untrusted path segment, so without the org predicate on the course lookup
    // an org-A admin could rewrite org B's tier access.
    const orgBCourseId = await createCourse(db, orgBId, creatorId, {
      priceCents: null,
    });
    const svc = new CourseAccessService({ db, environment: 'test' });

    // Seed a REAL grant in org B so absence below means "untouched", not "empty".
    await svc.setTierAccess(orgBId, orgBCourseId, [tierBId]);

    // Acting as org A against org B's course: NotFoundError, never Forbidden —
    // a Forbidden would confirm the foreign course exists.
    await expect(
      svc.setTierAccess(orgAId, orgBCourseId, [])
    ).rejects.toBeInstanceOf(NotFoundError);

    // Org B's grant survived the attempt.
    const surviving = await db
      .select({ tierId: courseTierAccess.tierId })
      .from(courseTierAccess)
      .where(eq(courseTierAccess.courseId, orgBCourseId));
    expect(surviving.map((r) => r.tierId)).toEqual([tierBId]);

    // The legitimate owner CAN clear it — proving the rejection above was the
    // org scope and not an unrelated failure.
    await svc.setTierAccess(orgBId, orgBCourseId, []);
    expect(
      await db
        .select({ tierId: courseTierAccess.tierId })
        .from(courseTierAccess)
        .where(eq(courseTierAccess.courseId, orgBCourseId))
    ).toHaveLength(0);
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
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

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
    await svc.setTierAccess(orgAId, courseId, [tierAId]);

    const anonOffer = await svc.getCourseOffer(courseId, null);
    expect(anonOffer.purchase).toEqual({ priceCents: 7500 });
    expect(anonOffer.paths).toContain('purchase');
    expect(anonOffer.paths).toContain('tier');
    expect(anonOffer.tiers.map((t) => t.tierId)).toContain(tierAId);
    expect(anonOffer.entitled).toBe(false);

    // A buyer who purchases sees entitled=true.
    const { stripe } = makeStripeStub();
    const purchase = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
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
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

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

  it('8. refunding a one-off course purchase revokes the grant → canEnterCourse denies', async () => {
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: 5000,
    });
    const { stripe } = makeStripeStub();
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

    // No stripeChargeId → payouts (and thus the refund's payout-reversal) are
    // skipped: this test isolates the access invariant, not the money movement
    // (transfer reversal is covered by the purchase-service refund suite).
    const pi = `pi_${randomUUID()}`;
    await svc.completeCoursePurchase(pi, {
      customerId: buyerId,
      courseId,
      amountPaidCents: 5000,
      currency: 'gbp',
    });

    // Round-trip: the resolver GRANTS and the stored grant is LIVE.
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(true);
    const [grantBefore] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyerId),
          eq(entitlements.courseId, courseId),
          eq(entitlements.source, 'course_purchase')
        )
      );
    expect(grantBefore?.revokedAt).toBeNull();

    // Refund the charge → the entitlement this purchase granted is revoked.
    await svc.processRefund(pi, {
      charge: { id: `ch_${randomUUID()}`, amountCents: 5000 },
      stripeRefundId: `re_${randomUUID()}`,
      refundAmountCents: 5000,
      refundReason: 'requested_by_customer',
    });

    // The grant now carries a revokedAt AND the resolver DENIES on next read.
    const [grantAfter] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyerId),
          eq(entitlements.courseId, courseId),
          eq(entitlements.source, 'course_purchase')
        )
      );
    expect(grantAfter?.revokedAt).toBeInstanceOf(Date);
    expect(await hasCourseEntitlement(db, buyerId, courseId)).toBe(false);
  });

  it('9. refunding a one-off content purchase revokes the grant → canView denies', async () => {
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
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

    const pi = `pi_${randomUUID()}`;
    await svc.completePurchase(pi, {
      customerId: buyerId,
      contentId: contentRow.id,
      organizationId: orgAId,
      amountPaidCents: 3000,
      currency: 'gbp',
    });

    // Round-trip: the resolver reads a LIVE stored content grant.
    expect(await hasStoredContentEntitlement(db, buyerId, contentRow.id)).toBe(
      true
    );
    const [grantBefore] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyerId),
          eq(entitlements.contentId, contentRow.id),
          eq(entitlements.source, 'content_purchase')
        )
      );
    expect(grantBefore?.revokedAt).toBeNull();

    await svc.processRefund(pi, {
      charge: { id: `ch_${randomUUID()}`, amountCents: 3000 },
      stripeRefundId: `re_${randomUUID()}`,
      refundAmountCents: 3000,
      refundReason: 'requested_by_customer',
    });

    const [grantAfter] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyerId),
          eq(entitlements.contentId, contentRow.id),
          eq(entitlements.source, 'content_purchase')
        )
      );
    expect(grantAfter?.revokedAt).toBeInstanceOf(Date);
    expect(await hasStoredContentEntitlement(db, buyerId, contentRow.id)).toBe(
      false
    );
  });

  it('10. disputing a one-off course purchase revokes the grant → canEnterCourse denies', async () => {
    // Higher-severity than the refund/content cases: a course_purchase grant is
    // PERMANENT (no expiresAt) with NO verifyPurchase backstop, so if the
    // chargeback failed to revoke it the buyer would keep paid-for course access
    // after the money is clawed back. processDispute runs the SAME sourceRef=
    // purchase.id revoke as processRefund; this pins that invariant.
    const courseId = await createCourse(db, orgAId, creatorId, {
      priceCents: 5000,
    });
    const { stripe } = makeStripeStub();
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

    const pi = `pi_${randomUUID()}`;
    await svc.completeCoursePurchase(pi, {
      customerId: buyer2Id,
      courseId,
      amountPaidCents: 5000,
      currency: 'gbp',
    });

    // Round-trip: the resolver GRANTS and the stored grant is LIVE.
    expect(await hasCourseEntitlement(db, buyer2Id, courseId)).toBe(true);
    const [grantBefore] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyer2Id),
          eq(entitlements.courseId, courseId),
          eq(entitlements.source, 'course_purchase')
        )
      );
    expect(grantBefore?.revokedAt).toBeNull();

    // Chargeback (charge.dispute.created) → access-reducing, same as a refund.
    await svc.processDispute(pi, {
      stripeDisputeId: `dp_${randomUUID()}`,
      disputeReason: 'fraudulent',
    });

    const [grantAfter] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyer2Id),
          eq(entitlements.courseId, courseId),
          eq(entitlements.source, 'course_purchase')
        )
      );
    expect(grantAfter?.revokedAt).toBeInstanceOf(Date);
    expect(await hasCourseEntitlement(db, buyer2Id, courseId)).toBe(false);
  });

  it('11. disputing a one-off content purchase revokes the grant → canView denies', async () => {
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
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );

    const pi = `pi_${randomUUID()}`;
    await svc.completePurchase(pi, {
      customerId: buyer2Id,
      contentId: contentRow.id,
      organizationId: orgAId,
      amountPaidCents: 3000,
      currency: 'gbp',
    });

    expect(await hasStoredContentEntitlement(db, buyer2Id, contentRow.id)).toBe(
      true
    );
    const [grantBefore] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyer2Id),
          eq(entitlements.contentId, contentRow.id),
          eq(entitlements.source, 'content_purchase')
        )
      );
    expect(grantBefore?.revokedAt).toBeNull();

    await svc.processDispute(pi, {
      stripeDisputeId: `dp_${randomUUID()}`,
      disputeReason: 'fraudulent',
    });

    const [grantAfter] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, buyer2Id),
          eq(entitlements.contentId, contentRow.id),
          eq(entitlements.source, 'content_purchase')
        )
      );
    expect(grantAfter?.revokedAt).toBeInstanceOf(Date);
    expect(await hasStoredContentEntitlement(db, buyer2Id, contentRow.id)).toBe(
      false
    );
  });

  // Owner decision AGR-01 "Keeps paying" (Codex-2hxff.17): the course creator's
  // content_purchase agreement applies past its review date.
  it('12. a course purchase pays the creator their agreed share past its review date', async () => {
    // A fresh creator, so the agreement cannot reach the file's other tests.
    const [agreedCreatorId] = await seedTestUsers(db, 1);
    if (!agreedCreatorId) throw new Error('creator not seeded');
    const courseId = await createCourse(db, orgAId, agreedCreatorId, {
      priceCents: 10000,
    });
    const day = 86_400_000;
    const [proposal] = await db
      .insert(agreementProposals)
      .values({
        organizationId: orgAId,
        creatorId: agreedCreatorId,
        revenueType: 'content_purchase',
        roundNumber: 1,
        proposedByUserId: creatorId,
        proposedByRole: 'owner',
        proposedCreatorSharePercent: 7000,
        proposedEffectiveFrom: new Date(Date.now() - 60 * day),
        status: 'accepted',
      })
      .returning({ id: agreementProposals.id });
    if (!proposal) throw new Error('proposal not inserted');
    await db.insert(creatorOrganizationAgreements).values({
      organizationId: orgAId,
      creatorId: agreedCreatorId,
      organizationFeePercentage: 3000,
      revenueType: 'content_purchase',
      status: 'active',
      effectiveFrom: new Date(Date.now() - 60 * day),
      effectiveUntil: new Date(Date.now() - day), // review date passed
      currentProposalId: proposal.id,
    });

    const { stripe } = makeStripeStub();
    const svc = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
    const pi = `pi_${randomUUID()}`;
    await svc.completeCoursePurchase(pi, {
      customerId: buyerId,
      courseId,
      amountPaidCents: 10000,
      currency: 'gbp',
      stripeChargeId: `ch_${randomUUID()}`,
    });

    const [row] = await db
      .select({
        platformFeeCents: purchases.platformFeeCents,
        organizationFeeCents: purchases.organizationFeeCents,
        creatorPayoutCents: purchases.creatorPayoutCents,
      })
      .from(purchases)
      .where(eq(purchases.stripePaymentIntentId, pi));
    // 10% platform; the creator takes 70% of the 9000 left, not the default.
    expect(row).toEqual({
      platformFeeCents: 1000,
      organizationFeeCents: 2700,
      creatorPayoutCents: 6300,
    });
  });

  it('a disputed subscription pauses its course grants, stored and derived, until the dispute clears (Codex-2hxff.9)', async () => {
    const [courseSubscriberId, tierSubscriberId] = await seedTestUsers(db, 2);
    const viaCourseSub = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const viaTier = await createCourse(db, orgAId, creatorId, {
      priceCents: null,
    });
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // A course subscription's STORED grant.
    const [plan] = await db
      .insert(courseSubscriptionPlans)
      .values({
        courseId: viaCourseSub,
        priceMonthly: 5000,
        priceAnnual: 50000,
        stripeProductId: `prod_${randomUUID()}`,
        stripePriceMonthlyId: `price_m_${randomUUID()}`,
        stripePriceAnnualId: `price_a_${randomUUID()}`,
      })
      .returning();
    const [courseSub] = await db
      .insert(courseSubscriptions)
      .values({
        userId: courseSubscriberId ?? '',
        courseId: viaCourseSub,
        planId: plan?.id ?? '',
        organizationId: orgAId,
        stripeSubscriptionId: `sub_course_${randomUUID()}`,
        stripeCustomerId: `cus_${randomUUID()}`,
        status: 'active',
        billingInterval: 'month',
        currentPeriodStart: now,
        currentPeriodEnd: future,
      })
      .returning();
    await writeCourseSubscriptionEntitlement(db, {
      userId: courseSubscriberId ?? '',
      organizationId: orgAId,
      courseId: viaCourseSub,
      courseSubscriptionId: courseSub?.id ?? '',
      expiresAt: future,
    });

    // A tier subscription's DERIVED grant.
    await new CourseAccessService({ db, environment: 'test' }).setTierAccess(
      orgAId,
      viaTier,
      [tierAId]
    );
    const [tierSub] = await db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(tierSubscriberId ?? '', orgAId, tierAId)
      )
      .returning();

    const grants = async () => ({
      courseSub: await hasCourseEntitlement(
        db,
        courseSubscriberId ?? '',
        viaCourseSub
      ),
      courseSubBatch: (
        await resolveCourseEntitlementsBatch(db, courseSubscriberId ?? '', [
          viaCourseSub,
        ])
      ).has(viaCourseSub),
      tier: await hasCourseEntitlement(db, tierSubscriberId ?? '', viaTier),
      tierBatch: (
        await resolveCourseEntitlementsBatch(db, tierSubscriberId ?? '', [
          viaTier,
        ])
      ).has(viaTier),
      // The stored-grant listing (derived tier grants never appear in it).
      listed: (
        await new EntitlementsService({
          db,
          environment: 'test',
        }).getUserEntitlements(courseSubscriberId ?? '')
      ).some((grant) => grant.resourceId === viaCourseSub),
    });
    const all = (value: boolean) => ({
      courseSub: value,
      courseSubBatch: value,
      tier: value,
      tierBatch: value,
      listed: value,
    });
    expect(await grants()).toEqual(all(true));

    const setDisputed = async (at: Date | null) => {
      await db
        .update(courseSubscriptions)
        .set({ disputedAt: at })
        .where(eq(courseSubscriptions.id, courseSub?.id ?? ''));
      await db
        .update(subscriptions)
        .set({ disputedAt: at })
        .where(eq(subscriptions.id, tierSub?.id ?? ''));
    };
    await setDisputed(new Date());
    expect(await grants()).toEqual(all(false));

    await setDisputed(null);
    expect(await grants()).toEqual(all(true));
  });
});
