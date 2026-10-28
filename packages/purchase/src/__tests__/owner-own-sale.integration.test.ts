/**
 * An owner selling their OWN work is paid everything after Codex's fee
 * (Codex-2hxff.77; docs/payments/fees-and-splits.md, "How each sale is
 * split").
 *
 * The owner can't hold an agreement with their own organisation: Revenue
 * share never lists them, and `proposeAgreement` refuses one to yourself. The
 * owner decided that on one condition: "as long as the owner gets paid
 * correctly for the content they sell". With no agreement, a one-off sale
 * pays the content's creator the creator slice, and the organisation's owner
 * the organisation slice. When the creator IS the owner, both slices go to
 * them. A course sale follows the same rule.
 *
 * At the spec's fees (10% platform, 10% organisation), a £10.00 sale pays
 * 100 / 90 / 810: the owner receives 90 + 810 = 900.
 *
 * Real DB, mocked Stripe. The local database is shared with other sessions,
 * so every row hangs off this file's own users and organisation and is
 * deleted in afterAll. Payout rows feed global drains, so they never stay.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  contentAccess,
  courseEnrollments,
  courses,
  entitlements,
  organizationMemberships,
  organizationOwnershipPeriods,
  organizations,
  type Payout,
  payouts,
  purchases,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeeConfigService } from '../services/fee-config-service';
import { PurchaseService } from '../services/purchase-service';

const PRICE = 1000;

/** The spec's one-off fees: 10% platform, 10% organisation. */
const FEES = {
  platformFeePercent: 1000,
  orgFeePercent: 1000,
  minPlatformFeeCents: 0,
  minTransferCents: 0,
};

const uid = () => randomUUID().slice(0, 8);

describe("an owner's sale of their own work (Codex-2hxff.77)", () => {
  let db: Database;
  let ownerId: string;
  let buyerId: string;
  let orgId: string;
  const contentIds: string[] = [];
  const courseIds: string[] = [];

  const feeConfig = {
    getFeesForCreator: vi.fn(async () => FEES),
    getFeesForOrg: vi.fn(async () => FEES),
    getFeesPlatform: vi.fn(async () => FEES),
  } as unknown as FeeConfigService;

  function service(): PurchaseService {
    return new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps(), feeConfig },
      createMockStripe()
    );
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    [ownerId, buyerId] = (await seedTestUsers(db, 2)) as [string, string];
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Owner Own Sale Org',
          slug: createUniqueSlug('owner-own-sale'),
        })
        .returning()
    ).id;
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: ownerId,
      role: 'owner',
      status: 'active',
    });
    await setTestOrganisationPayee(db, orgId, ownerId);
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, ownerId));
  });

  afterAll(async () => {
    const purchaseIds = (
      await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.customerId, buyerId))
    ).map((row) => row.id);
    if (purchaseIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.purchaseId, purchaseIds));
    }
    await db.delete(entitlements).where(eq(entitlements.userId, buyerId));
    await db
      .delete(courseEnrollments)
      .where(eq(courseEnrollments.userId, buyerId));
    await db.delete(contentAccess).where(eq(contentAccess.userId, buyerId));
    await db.delete(purchases).where(eq(purchases.customerId, buyerId));
    if (courseIds.length > 0) {
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, ownerId));
    await db
      .delete(organizationOwnershipPeriods)
      .where(eq(organizationOwnershipPeriods.organizationId, orgId));
    await db
      .delete(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(inArray(users.id, [ownerId, buyerId]));
    await teardownTestDatabase();
  });

  async function slicesOf(chargeId: string): Promise<Payout[]> {
    return db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, chargeId));
  }

  /** Each slice's amount and payee, keyed by its type. */
  function byType(rows: Payout[]) {
    return Object.fromEntries(
      rows.map((row) => [
        row.payoutType,
        { amountCents: row.amountCents, userId: row.userId },
      ])
    );
  }

  /** What the owner is paid across the sale's slices. */
  function paidTo(rows: Payout[], userId: string): number {
    return rows
      .filter(
        (row) => row.userId === userId && row.payoutType !== 'platform_fee'
      )
      .reduce((sum, row) => sum + row.amountCents, 0);
  }

  it('a one-off sale with no agreement pays the owner the creator slice AND the organisation slice', async () => {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(ownerId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('owner-own-content'),
          })
        )
        .returning()
    );
    contentIds.push(item.id);
    const chargeId = `ch_owner_own_${uid()}`;

    await service().completePurchase(`pi_owner_own_${uid()}`, {
      contentId: item.id,
      customerId: buyerId,
      organizationId: orgId,
      amountPaidCents: PRICE,
      currency: 'gbp',
      stripeChargeId: chargeId,
    });

    const rows = await slicesOf(chargeId);
    expect(byType(rows)).toMatchObject({
      platform_fee: { amountCents: 100 },
      organization_fee: { amountCents: 90, userId: ownerId },
      creator_payout: { amountCents: 810, userId: ownerId },
    });
    expect(rows).toHaveLength(3);
    expect(paidTo(rows, ownerId)).toBe(900);
  });

  it('a course sale with no agreement pays the owner the creator slice AND the organisation slice', async () => {
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId: ownerId,
          slug: createUniqueSlug('owner-own-course'),
          title: "The owner's own course",
          status: 'published',
          priceCents: PRICE,
        })
        .returning()
    );
    courseIds.push(course.id);
    const chargeId = `ch_owner_course_${uid()}`;

    await service().completeCoursePurchase(`pi_owner_course_${uid()}`, {
      courseId: course.id,
      customerId: buyerId,
      amountPaidCents: PRICE,
      currency: 'gbp',
      stripeChargeId: chargeId,
    });

    const rows = await slicesOf(chargeId);
    expect(byType(rows)).toMatchObject({
      platform_fee: { amountCents: 100 },
      organization_fee: { amountCents: 90, userId: ownerId },
      creator_payout: { amountCents: 810, userId: ownerId },
    });
    expect(rows).toHaveLength(3);
    expect(paidTo(rows, ownerId)).toBe(900);
  });
});
