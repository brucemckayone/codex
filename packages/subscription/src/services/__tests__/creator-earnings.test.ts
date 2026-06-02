/**
 * Creator earnings query tests (Codex-69t7c.7 / WP7).
 *
 * Integration tests with a real DB for `listPayoutsForCreator` +
 * `getEarningsSummaryForCreator`. The load-bearing assertions are SECURITY:
 *  - cross-creator isolation: a caller sees ONLY their own payout rows, never
 *    another user's (the `eq(userId)` predicate is the tenant boundary).
 *  - payout-type exclusion: `organization_fee` rows (which carry the owner's
 *    userId) are NOT a creator's personal earnings (consistent with WP6).
 *
 * Seeds use `crypto.randomUUID()` for `stripeTransferId` to avoid the
 * `uq_payouts_stripe_transfer_id` dup-key on the shared Neon branch
 * (memory: payout-tests-hardcoded-transfer-ids), and clean up in afterEach.
 */
import { randomUUID } from 'node:crypto';
import { organizations, payouts as payoutsTable } from '@codex/database/schema';
import {
  createMockStripe,
  createTestOrganizationInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SubscriptionService } from '../subscription-service';

describe('SubscriptionService — creator earnings (WP7)', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let service: SubscriptionService;
  let creatorId: string;
  let otherCreatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    [creatorId, otherCreatorId] = await seedTestUsers(db, 2);

    const stripe = createMockStripe() as unknown as Stripe;
    service = new SubscriptionService({ db, environment: 'test' }, stripe);

    const [orgA] = await db
      .insert(organizations)
      .values(createTestOrganizationInput({ slug: createUniqueSlug('wp7a') }))
      .returning();
    const [orgB] = await db
      .insert(organizations)
      .values(createTestOrganizationInput({ slug: createUniqueSlug('wp7b') }))
      .returning();
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterEach(async () => {
    // Clean only the rows this suite seeded (keyed by its two users), so the
    // shared Neon branch stays clean for sibling test files.
    await db
      .delete(payoutsTable)
      .where(inArray(payoutsTable.userId, [creatorId, otherCreatorId]));
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  function seedPayout(o: {
    userId: string | null;
    organizationId: string | null;
    payoutType:
      | 'creator_payout'
      | 'creator_payout_to_owner'
      | 'organization_fee'
      | 'platform_fee';
    status: 'paid' | 'pending' | 'failed';
    amountCents: number;
    sourceType?: 'purchase' | 'subscription';
  }) {
    return db.insert(payoutsTable).values({
      id: randomUUID(),
      organizationId: o.organizationId,
      userId: o.userId,
      payoutType: o.payoutType,
      status: o.status,
      amountCents: o.amountCents,
      currency: 'gbp',
      sourceType: o.sourceType ?? 'subscription',
      // Unique → never collides with the uq_payouts_stripe_transfer_id index.
      stripeTransferId: randomUUID(),
      stripeChargeId: `ch_${randomUUID()}`,
      resolvedAt: o.status === 'paid' ? new Date() : null,
    });
  }

  /** The caller's mixed ledger + a foreign creator's row that must never leak. */
  async function seedScenario() {
    await seedPayout({
      userId: creatorId,
      organizationId: orgAId,
      payoutType: 'creator_payout',
      status: 'paid',
      amountCents: 1000,
    });
    await seedPayout({
      userId: creatorId,
      organizationId: orgBId,
      payoutType: 'creator_payout_to_owner',
      status: 'paid',
      amountCents: 500,
    });
    // org_fee carries the caller's userId but is NOT personal earnings (WP6).
    await seedPayout({
      userId: creatorId,
      organizationId: orgAId,
      payoutType: 'organization_fee',
      status: 'paid',
      amountCents: 300,
    });
    // pending creator slice → counts toward in-transit + needs-attention.
    await seedPayout({
      userId: creatorId,
      organizationId: orgAId,
      payoutType: 'creator_payout',
      status: 'pending',
      amountCents: 200,
    });
    // foreign creator — must be invisible to `creatorId`.
    await seedPayout({
      userId: otherCreatorId,
      organizationId: orgAId,
      payoutType: 'creator_payout',
      status: 'paid',
      amountCents: 99999,
    });
  }

  describe('listPayoutsForCreator', () => {
    it('returns ONLY the caller’s creator slices — excludes org_fee and other users', async () => {
      await seedScenario();

      const result = await service.listPayoutsForCreator(creatorId, {
        page: 1,
        limit: 50,
      });

      // 2 paid creator-type + 1 pending creator-type = 3. NOT the org_fee, NOT the foreign row.
      expect(result.pagination.total).toBe(3);
      expect(result.items).toHaveLength(3);
      for (const row of result.items) {
        expect(['creator_payout', 'creator_payout_to_owner']).toContain(
          row.payoutType
        );
      }
      // The £999.99 foreign payout never appears.
      expect(result.items.some((r) => r.amountCents === 99999)).toBe(false);
      // The org_fee (£3) never appears.
      expect(result.items.some((r) => r.amountCents === 300)).toBe(false);
      // org grouping signal is present on rows.
      expect(result.items.map((r) => r.organizationId).sort()).toEqual(
        [orgAId, orgAId, orgBId].sort()
      );
    });

    it('applies the status filter (pending only)', async () => {
      await seedScenario();

      const result = await service.listPayoutsForCreator(creatorId, {
        page: 1,
        limit: 50,
        status: 'pending',
      });

      expect(result.pagination.total).toBe(1);
      expect(result.items[0]?.amountCents).toBe(200);
      expect(result.items[0]?.status).toBe('pending');
    });

    it('returns an empty page for a creator with no payouts', async () => {
      const result = await service.listPayoutsForCreator(otherCreatorId, {
        page: 1,
        limit: 50,
      });
      expect(result.pagination.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe('getEarningsSummaryForCreator', () => {
    it('sums ONLY the caller’s creator slices (excludes org_fee + other users)', async () => {
      await seedScenario();

      const summary = await service.getEarningsSummaryForCreator(creatorId);

      // paid creator slices: 1000 + 500 = 1500 (org_fee 300 + foreign 99999 excluded).
      expect(summary.totalEarnedCents).toBe(1500);
      expect(summary.earnedInPeriodCents).toBe(1500);
      // pending creator slice: 200.
      expect(summary.inTransitCents).toBe(200);
      // needs-attention = pending|failed count = 1.
      expect(summary.needsAttentionCount).toBe(1);
    });

    it('returns zeros for a creator with no payouts', async () => {
      const summary =
        await service.getEarningsSummaryForCreator(otherCreatorId);
      expect(summary).toEqual({
        earnedInPeriodCents: 0,
        totalEarnedCents: 0,
        inTransitCents: 0,
        needsAttentionCount: 0,
      });
    });
  });
});
