/**
 * AdminAnalyticsService.getRevenueByCreator real-DB integration tests
 * (Codex-mtv05).
 *
 * Companion to the unit-mocked analytics-service.test.ts. These tests prove
 * the SQL produces the right shape against a real Postgres branch — namely:
 *
 *   1. Active vs expired agreement filter (effectiveUntil semantics).
 *   2. Purchase-revenue aggregation through `content.creatorId`.
 *   3. Pending-payout split: resolved → lastPayoutAt, unresolved → pending.
 *   4. Multi-org pending-payout scoping (the bead STOP rule).
 *   5. Basis-points → display-percent conversion at the service boundary.
 *   6. Date-window filter (only includes purchases inside [start, end]).
 *   7. Single-creator / no-agreement empty result.
 *
 * Mirrors the patterns from
 *   packages/purchase/src/__tests__/fee-config-service-writes.integration.test.ts
 *   packages/admin/src/__tests__/analytics-service.test.ts
 */

import { PURCHASE_STATUS } from '@codex/constants';
import {
  content as contentTable,
  creatorOrganizationAgreements,
  mediaItems,
  organizations,
  payouts,
  purchases,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAnalyticsService } from '../services/analytics-service';

describe('AdminAnalyticsService.getRevenueByCreator (real DB)', () => {
  let db: Database;
  let service: AdminAnalyticsService;
  let customerId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminAnalyticsService({ db, environment: 'test' });
    // Single customer reused across tests — purchases are scoped by content
    // and org, not customer, so a shared row is safe.
    const [c] = await seedTestUsers(db, 1);
    customerId = c;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /**
   * Per-test scaffold. Returns a fresh org with N creators, one content per
   * creator, plus an active subscription (so payouts can FK to a real
   * subscription row when needed).
   */
  async function seedScenario(creatorCount: number) {
    const creators =
      creatorCount > 0 ? await seedTestUsers(db, creatorCount) : [];
    const [org] = await db
      .insert(organizations)
      .values(createTestOrganizationInput())
      .returning();

    const contentByCreator = new Map<string, string>();
    if (creators.length > 0) {
      // Shared media item — one is enough since contents reference different creators.
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creators[0], {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      for (const cid of creators) {
        const [row] = await db
          .insert(contentTable)
          .values({
            creatorId: cid,
            organizationId: org.id,
            mediaItemId: media.id,
            title: `Content ${cid.slice(-4)}`,
            slug: createUniqueSlug(`mtv-${cid.slice(-4)}`),
            contentType: 'video',
            status: 'published',
            visibility: 'purchased_only',
            priceCents: 1000,
          })
          .returning();
        contentByCreator.set(cid, row.id);
      }
    }

    return { orgId: org.id, creators, contentByCreator };
  }

  /**
   * Seed an active subscription for the given creator + org so payouts
   * inserts can satisfy their FK to subscriptions.id.
   */
  async function seedActiveSubscription(
    orgId: string,
    userId: string
  ): Promise<string> {
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId))
      .returning();
    const [sub] = await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(userId, orgId, tier.id))
      .returning();
    return sub.id;
  }

  it('returns empty for an org with no active agreements', async () => {
    const { orgId } = await seedScenario(0);

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('aggregates purchase revenue per active creator and converts bps→%', async () => {
    const { orgId, creators, contentByCreator } = await seedScenario(2);
    const [creatorA, creatorB] = creators;

    // 75/25 split (bps).
    await db.insert(creatorOrganizationAgreements).values([
      {
        creatorId: creatorA,
        organizationId: orgId,
        organizationFeePercentage: 7500,
      },
      {
        creatorId: creatorB,
        organizationId: orgId,
        organizationFeePercentage: 2500,
      },
    ]);

    // 2 purchases for creatorA's content (£18.00 payout each → £36.00),
    // 1 purchase for creatorB's content (£6.00 payout).
    await db.insert(purchases).values([
      {
        customerId,
        contentId: contentByCreator.get(creatorA)!,
        organizationId: orgId,
        amountPaidCents: 2000,
        platformFeeCents: 200,
        organizationFeeCents: 0,
        creatorPayoutCents: 1800,
        stripePaymentIntentId: `pi_a1_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(),
      },
      {
        customerId,
        contentId: contentByCreator.get(creatorA)!,
        organizationId: orgId,
        amountPaidCents: 2000,
        platformFeeCents: 200,
        organizationFeeCents: 0,
        creatorPayoutCents: 1800,
        stripePaymentIntentId: `pi_a2_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(),
      },
      {
        customerId,
        contentId: contentByCreator.get(creatorB)!,
        organizationId: orgId,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 300,
        creatorPayoutCents: 600,
        stripePaymentIntentId: `pi_b1_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(),
      },
    ]);

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(2);
    // Ordered by totalRevenueCents DESC.
    const [first, second] = result.items;
    expect(first.creatorId).toBe(creatorA);
    expect(first.totalRevenueCents).toBe(3600);
    expect(first.splitPercent).toBe(75);
    expect(second.creatorId).toBe(creatorB);
    expect(second.totalRevenueCents).toBe(600);
    expect(second.splitPercent).toBe(25);
  });

  it('excludes agreements whose effectiveUntil has elapsed', async () => {
    const { orgId, creators } = await seedScenario(2);
    const [active, expired] = creators;

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await db.insert(creatorOrganizationAgreements).values([
      {
        creatorId: active,
        organizationId: orgId,
        organizationFeePercentage: 5000,
      },
      {
        creatorId: expired,
        organizationId: orgId,
        organizationFeePercentage: 5000,
        effectiveUntil: past,
      },
    ]);

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].creatorId).toBe(active);
  });

  it('reports lastPayoutAt from resolved payouts and pending from unresolved', async () => {
    const { orgId, creators } = await seedScenario(1);
    const [creatorId] = creators;

    await db.insert(creatorOrganizationAgreements).values({
      creatorId,
      organizationId: orgId,
      organizationFeePercentage: 10000,
    });

    const subscriptionId = await seedActiveSubscription(orgId, creatorId);

    const resolvedDate = new Date('2026-03-15T00:00:00Z');
    const moreRecentResolvedDate = new Date('2026-04-20T00:00:00Z');

    await db.insert(payouts).values([
      {
        userId: creatorId,
        organizationId: orgId,
        subscriptionId,
        amountCents: 500,
        payoutType: 'creator_payout',
        status: 'paid',
        reason: null,
        resolvedAt: resolvedDate,
        stripeTransferId: 'tr_old',
      },
      {
        userId: creatorId,
        organizationId: orgId,
        subscriptionId,
        amountCents: 700,
        payoutType: 'creator_payout',
        status: 'paid',
        reason: null,
        resolvedAt: moreRecentResolvedDate,
        stripeTransferId: 'tr_new',
      },
      {
        userId: creatorId,
        organizationId: orgId,
        subscriptionId,
        amountCents: 250,
        payoutType: 'creator_payout',
        status: 'pending',
        reason: 'min_transfer_floor',
        resolvedAt: null,
      },
      {
        userId: creatorId,
        organizationId: orgId,
        subscriptionId,
        amountCents: 1000,
        payoutType: 'creator_payout',
        status: 'pending',
        reason: 'connect_not_ready',
        resolvedAt: null,
      },
    ]);

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(1);
    const [row] = result.items;
    expect(row.pendingPayoutCents).toBe(1250); // 250 + 1000
    expect(row.lastPayoutAt).not.toBeNull();
    expect(new Date(row.lastPayoutAt!).toISOString()).toBe(
      moreRecentResolvedDate.toISOString()
    );
  });

  it("does NOT include another org's pending payouts (multi-org safety)", async () => {
    const { orgId: orgA, creators } = await seedScenario(1);
    const [creatorId] = creators;
    const { orgId: orgB } = await seedScenario(0);

    await db.insert(creatorOrganizationAgreements).values({
      creatorId,
      organizationId: orgA,
      organizationFeePercentage: 10000,
    });

    // Subscription in orgB referencing the SAME creator — pending payout
    // amount that MUST NOT leak into orgA's result.
    const subscriptionId = await seedActiveSubscription(orgB, creatorId);

    await db.insert(payouts).values({
      userId: creatorId,
      organizationId: orgB,
      subscriptionId,
      amountCents: 9999,
      payoutType: 'creator_payout',
      status: 'pending',
      reason: 'connect_not_ready',
      resolvedAt: null,
    });

    const result = await service.getRevenueByCreator(orgA);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].pendingPayoutCents).toBe(0);
  });

  it('respects startDate / endDate filter on revenue aggregation', async () => {
    const { orgId, creators, contentByCreator } = await seedScenario(1);
    const [creatorId] = creators;

    await db.insert(creatorOrganizationAgreements).values({
      creatorId,
      organizationId: orgId,
      organizationFeePercentage: 10000,
    });

    const now = new Date();
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    await db.insert(purchases).values([
      {
        customerId,
        contentId: contentByCreator.get(creatorId)!,
        organizationId: orgId,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_new_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: now,
      },
      {
        customerId,
        contentId: contentByCreator.get(creatorId)!,
        organizationId: orgId,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_old_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: old,
      },
    ]);

    const result = await service.getRevenueByCreator(orgId, {
      startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endDate: now,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].totalRevenueCents).toBe(900);
  });

  it('does NOT leak revenue from another org', async () => {
    const { orgId: orgA, creators } = await seedScenario(1);
    const [creatorId] = creators;
    const { orgId: orgB } = await seedScenario(0);

    await db.insert(creatorOrganizationAgreements).values({
      creatorId,
      organizationId: orgA,
      organizationFeePercentage: 10000,
    });

    // Set up a content row in orgB for the SAME creator and a paid purchase.
    const [media] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'video',
          status: 'ready',
        })
      )
      .returning();
    const [contentB] = await db
      .insert(contentTable)
      .values({
        creatorId,
        organizationId: orgB,
        mediaItemId: media.id,
        title: 'Cross-org content',
        slug: createUniqueSlug('mtv-cross'),
        contentType: 'video',
        status: 'published',
        visibility: 'purchased_only',
        priceCents: 1000,
      })
      .returning();
    await db.insert(purchases).values({
      customerId,
      contentId: contentB.id,
      organizationId: orgB,
      amountPaidCents: 1000,
      platformFeeCents: 100,
      organizationFeeCents: 0,
      creatorPayoutCents: 900,
      stripePaymentIntentId: `pi_xorg_${Date.now()}`,
      status: PURCHASE_STATUS.COMPLETED,
      purchasedAt: new Date(),
    });

    const result = await service.getRevenueByCreator(orgA);

    // Creator has an agreement in orgA but no purchases in orgA — must be 0,
    // not the orgB revenue (cross-org leak guard).
    expect(result.items).toHaveLength(1);
    expect(result.items[0].totalRevenueCents).toBe(0);
  });
});
