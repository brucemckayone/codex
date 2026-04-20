/**
 * Admin Analytics Service Tests
 *
 * Comprehensive test suite for AdminAnalyticsService covering:
 * - Revenue statistics (total, daily breakdown, average order value)
 * - Customer statistics (total, new customers in 30 days)
 * - Top content by revenue
 * - Organization scoping (only counts org's data)
 * - Date range filtering
 * - Zero-purchase edge cases
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 */

import { PURCHASE_STATUS } from '@codex/constants';
import {
  content as contentTable,
  mediaItems,
  organizationFollowers,
  organizationMemberships,
  organizations,
  purchases,
  subscriptions,
  subscriptionTiers,
  videoPlayback,
} from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TOP_CONTENT_LIMIT } from '../constants';
import { AdminAnalyticsService } from '../services/analytics-service';

describe('AdminAnalyticsService', () => {
  let db: Database;
  let service: AdminAnalyticsService;
  let creatorId: string;
  let customerId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminAnalyticsService({ db, environment: 'test' });

    // Create test users
    const userIds = await seedTestUsers(db, 2);
    [creatorId, customerId] = userIds;

    // Create organization (result not needed beyond creation)
    await db
      .insert(organizations)
      .values(createTestOrganizationInput())
      .returning();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('getRevenueStats', () => {
    it('should return zero stats for organization with no purchases', async () => {
      // Create a new org with no purchases
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const stats = await service.getRevenueStats(emptyOrg.id);

      expect(stats.totalRevenueCents).toBe(0);
      expect(stats.totalPurchases).toBe(0);
      expect(stats.averageOrderValueCents).toBe(0);
      expect(stats.platformFeeCents).toBe(0);
      expect(stats.organizationFeeCents).toBe(0);
      expect(stats.creatorPayoutCents).toBe(0);
      expect(stats.revenueByDay).toEqual([]);
    });

    it('should calculate revenue stats with completed purchases', async () => {
      // Create test org with purchases
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Create media and content
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Test Content',
          slug: createUniqueSlug('revenue-test'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2999,
        })
        .returning();

      // Create completed purchases
      await db.insert(purchases).values([
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 2999,
          platformFeeCents: 300,
          organizationFeeCents: 0,
          creatorPayoutCents: 2699,
          stripePaymentIntentId: `pi_test_${Date.now()}_1`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 2999,
          platformFeeCents: 300,
          organizationFeeCents: 0,
          creatorPayoutCents: 2699,
          stripePaymentIntentId: `pi_test_${Date.now()}_2`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
      ]);

      const stats = await service.getRevenueStats(testOrg.id);

      expect(stats.totalRevenueCents).toBe(5998);
      expect(stats.totalPurchases).toBe(2);
      expect(stats.averageOrderValueCents).toBe(2999);
      expect(stats.platformFeeCents).toBe(600);
      expect(stats.organizationFeeCents).toBe(0);
      expect(stats.creatorPayoutCents).toBe(5398);
    });

    it('should exclude pending/failed/refunded purchases from revenue', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Test Content',
          slug: createUniqueSlug('exclude-test'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Create mixed status purchases
      await db.insert(purchases).values([
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_completed_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_pending_${Date.now()}`,
          status: PURCHASE_STATUS.PENDING,
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_failed_${Date.now()}`,
          status: PURCHASE_STATUS.FAILED,
        },
      ]);

      const stats = await service.getRevenueStats(testOrg.id);

      // Only completed purchase should be counted
      expect(stats.totalRevenueCents).toBe(1000);
      expect(stats.totalPurchases).toBe(1);
    });

    it('should filter by date range', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Date Range Test',
          slug: createUniqueSlug('date-range'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 500,
        })
        .returning();

      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const lastWeek = new Date(now);
      lastWeek.setDate(lastWeek.getDate() - 7);

      // Create purchases at different times
      await db.insert(purchases).values([
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_today_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: now,
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_lastweek_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: lastWeek,
        },
      ]);

      // Filter to only yesterday and today
      const stats = await service.getRevenueStats(testOrg.id, {
        startDate: yesterday,
        endDate: now,
      });

      expect(stats.totalRevenueCents).toBe(500); // Only today's purchase
      expect(stats.totalPurchases).toBe(1);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context

    it('should scope revenue to specific organization only', async () => {
      // Create two organizations
      const [org1] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [org2] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Content for org1
      const [content1] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org1.id,
          mediaItemId: media.id,
          title: 'Org1 Content',
          slug: createUniqueSlug('org1'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Content for org2
      const [content2] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org2.id,
          mediaItemId: media.id,
          title: 'Org2 Content',
          slug: createUniqueSlug('org2'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      // Purchases for different orgs
      await db.insert(purchases).values([
        {
          customerId,
          contentId: content1.id,
          organizationId: org1.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_org1_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId,
          contentId: content2.id,
          organizationId: org2.id,
          amountPaidCents: 2000,
          platformFeeCents: 200,
          organizationFeeCents: 0,
          creatorPayoutCents: 1800,
          stripePaymentIntentId: `pi_org2_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
      ]);

      // Check org1 stats
      const org1Stats = await service.getRevenueStats(org1.id);
      expect(org1Stats.totalRevenueCents).toBe(1000);
      expect(org1Stats.totalPurchases).toBe(1);

      // Check org2 stats
      const org2Stats = await service.getRevenueStats(org2.id);
      expect(org2Stats.totalRevenueCents).toBe(2000);
      expect(org2Stats.totalPurchases).toBe(1);
    });

    it('should restrict daily breakdown to the requested date range', async () => {
      // Regression: previously the daily breakdown always ran against the
      // last TREND_DAYS_DEFAULT (30 days) and ignored options.startDate/endDate,
      // so aggregate totals and the daily rows drifted apart. After the fix
      // both must reflect the same window.
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Daily Range',
          slug: createUniqueSlug('daily-range'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1500,
        })
        .returning();

      const today = new Date();
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      await db.insert(purchases).values([
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1500,
          platformFeeCents: 150,
          organizationFeeCents: 0,
          creatorPayoutCents: 1350,
          stripePaymentIntentId: `pi_in_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: twoDaysAgo,
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1500,
          platformFeeCents: 150,
          organizationFeeCents: 0,
          creatorPayoutCents: 1350,
          stripePaymentIntentId: `pi_out_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: tenDaysAgo,
        },
      ]);

      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const stats = await service.getRevenueStats(testOrg.id, {
        startDate: fiveDaysAgo,
        endDate: today,
      });

      // Aggregate only sees the recent purchase
      expect(stats.totalRevenueCents).toBe(1500);
      expect(stats.totalPurchases).toBe(1);
      // Daily rows must reflect the same window — no row older than start
      expect(stats.revenueByDay.length).toBe(1);
      expect(
        new Date(stats.revenueByDay[0].date).getTime()
      ).toBeGreaterThanOrEqual(
        new Date(fiveDaysAgo.toISOString().split('T')[0]).getTime()
      );
    });

    it('should include a previous block when compareFrom and compareTo are provided', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Compare',
          slug: createUniqueSlug('compare-range'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      // Two purchases in current window (last 7d), one in previous window (7-14d ago)
      await db.insert(purchases).values([
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 2000,
          platformFeeCents: 200,
          organizationFeeCents: 0,
          creatorPayoutCents: 1800,
          stripePaymentIntentId: `pi_cur1_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: now,
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 2000,
          platformFeeCents: 200,
          organizationFeeCents: 0,
          creatorPayoutCents: 1800,
          stripePaymentIntentId: `pi_cur2_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: now,
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 2000,
          platformFeeCents: 200,
          organizationFeeCents: 0,
          creatorPayoutCents: 1800,
          stripePaymentIntentId: `pi_prev_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(fourteenDaysAgo.getTime() + 60_000), // just inside previous window
        },
      ]);

      const stats = await service.getRevenueStats(testOrg.id, {
        startDate: sevenDaysAgo,
        endDate: now,
        compareFrom: fourteenDaysAgo,
        compareTo: sevenDaysAgo,
      });

      expect(stats.totalRevenueCents).toBe(4000);
      expect(stats.totalPurchases).toBe(2);
      expect(stats.previous).toBeDefined();
      expect(stats.previous?.totalRevenueCents).toBe(2000);
      expect(stats.previous?.totalPurchases).toBe(1);
      // previous block must not itself carry a nested previous
      expect(
        (stats.previous as unknown as { previous?: unknown })?.previous
      ).toBeUndefined();
    });

    it('should omit previous block when compareFrom or compareTo is missing', async () => {
      // Backward-compat: callers that don't opt into comparison should see the
      // original RevenueStats shape (no `previous` key).
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const onlyFrom = await service.getRevenueStats(testOrg.id, {
        compareFrom: new Date(),
      });
      const onlyTo = await service.getRevenueStats(testOrg.id, {
        compareTo: new Date(),
      });
      const neither = await service.getRevenueStats(testOrg.id);

      expect(onlyFrom.previous).toBeUndefined();
      expect(onlyTo.previous).toBeUndefined();
      expect(neither.previous).toBeUndefined();
    });
  });

  describe('getSubscriberStats', () => {
    // Helper: insert a tier for a given org
    async function insertTier(orgId: string, label: string) {
      const [tier] = await db
        .insert(subscriptionTiers)
        .values({
          organizationId: orgId,
          name: `Tier-${label}`,
          sortOrder: 1,
          priceMonthly: 1000,
          priceAnnual: 10000,
        })
        .returning();
      return tier;
    }

    // Helper: build a valid subscription insert payload
    function subRow(params: {
      orgId: string;
      userId: string;
      tierId: string;
      label: string;
      status: 'active' | 'past_due' | 'cancelling' | 'cancelled' | 'incomplete';
      createdAt: Date;
      cancelledAt?: Date | null;
    }) {
      const start = new Date(params.createdAt);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      return {
        userId: params.userId,
        organizationId: params.orgId,
        tierId: params.tierId,
        stripeSubscriptionId: `sub_test_${Date.now()}_${params.label}_${Math.random().toString(36).slice(2, 8)}`,
        stripeCustomerId: `cus_test_${params.label}`,
        status: params.status,
        billingInterval: 'month' as const,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        amountCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 50,
        creatorPayoutCents: 850,
        cancelledAt: params.cancelledAt ?? null,
        createdAt: params.createdAt,
      };
    }

    it('should return zero stats for organization with no subscriptions', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const stats = await service.getSubscriberStats(emptyOrg.id);

      expect(stats.activeSubscribers).toBe(0);
      expect(stats.newSubscribers).toBe(0);
      expect(stats.churnedSubscribers).toBe(0);
      expect(stats.subscribersByDay).toEqual([]);
      expect(stats.previous).toBeUndefined();
    });

    it('should count active, new, and churned correctly across mixed statuses in and out of the range', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const tier = await insertTier(testOrg.id, 'mixed');
      const [u1, u2, u3, u4, u5] = await seedTestUsers(db, 5);

      const now = new Date();
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const fiveDaysAgo = new Date(now);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const fortyDaysAgo = new Date(now);
      fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

      // Window: last 7 days → start = fiveDaysAgo-ish → use fiveDaysAgo as start, now as end.
      // Expected inside window:
      //   - new: subs created within [fiveDaysAgo, now]
      //   - churned: subs cancelled within [fiveDaysAgo, now]
      //   - active at end of window: alive-status subs with createdAt<=now
      //     AND (cancelledAt IS NULL OR cancelledAt > now)

      await db.insert(subscriptions).values([
        // Created inside window, active → counts as new + active
        subRow({
          orgId: testOrg.id,
          userId: u1,
          tierId: tier.id,
          label: 'new-active',
          status: 'active',
          createdAt: twoDaysAgo,
        }),
        // Created before window, still active → active only (not new, not churned)
        subRow({
          orgId: testOrg.id,
          userId: u2,
          tierId: tier.id,
          label: 'old-active',
          status: 'active',
          createdAt: fortyDaysAgo,
        }),
        // Created before window, cancelled inside window → churned only (not new, not active at end)
        subRow({
          orgId: testOrg.id,
          userId: u3,
          tierId: tier.id,
          label: 'old-churned',
          status: 'cancelled',
          createdAt: fortyDaysAgo,
          cancelledAt: twoDaysAgo,
        }),
        // Created inside window, cancelled inside window → new + churned
        subRow({
          orgId: testOrg.id,
          userId: u4,
          tierId: tier.id,
          label: 'new-churned',
          status: 'cancelled',
          createdAt: fiveDaysAgo,
          cancelledAt: twoDaysAgo,
        }),
        // Created before window, cancelled before window → nothing
        subRow({
          orgId: testOrg.id,
          userId: u5,
          tierId: tier.id,
          label: 'long-gone',
          status: 'cancelled',
          createdAt: fortyDaysAgo,
          cancelledAt: tenDaysAgo,
        }),
      ]);

      const stats = await service.getSubscriberStats(testOrg.id, {
        startDate: fiveDaysAgo,
        endDate: now,
      });

      // New = u1 + u4
      expect(stats.newSubscribers).toBe(2);
      // Churned = u3 + u4
      expect(stats.churnedSubscribers).toBe(2);
      // Active at end of window = u1 (alive) + u2 (alive). u3, u4 cancelled before end, u5 too old.
      expect(stats.activeSubscribers).toBe(2);
      // Daily breakdown should only contain new-sub rows inside the window (u1 on twoDaysAgo, u4 on fiveDaysAgo)
      expect(stats.subscribersByDay).toHaveLength(2);
      expect(
        stats.subscribersByDay.reduce((acc, d) => acc + d.newSubscribers, 0)
      ).toBe(2);
    });

    it('should scope subscriber stats to the given organization only', async () => {
      const [orgA] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [orgB] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const tierA = await insertTier(orgA.id, 'scope-a');
      const tierB = await insertTier(orgB.id, 'scope-b');

      const [ua, ub] = await seedTestUsers(db, 2);
      const now = new Date();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      await db.insert(subscriptions).values([
        subRow({
          orgId: orgA.id,
          userId: ua,
          tierId: tierA.id,
          label: 'scope-a-new',
          status: 'active',
          createdAt: twoDaysAgo,
        }),
        subRow({
          orgId: orgB.id,
          userId: ub,
          tierId: tierB.id,
          label: 'scope-b-new',
          status: 'active',
          createdAt: twoDaysAgo,
        }),
      ]);

      const aStats = await service.getSubscriberStats(orgA.id);
      const bStats = await service.getSubscriberStats(orgB.id);

      expect(aStats.newSubscribers).toBe(1);
      expect(aStats.activeSubscribers).toBe(1);
      expect(bStats.newSubscribers).toBe(1);
      expect(bStats.activeSubscribers).toBe(1);
    });

    it('should include a previous block when compareFrom and compareTo are provided, and omit it otherwise', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const tier = await insertTier(testOrg.id, 'compare');
      const [u1, u2, u3] = await seedTestUsers(db, 3);

      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const threeDaysAgo = new Date(now);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      await db.insert(subscriptions).values([
        // Current window: 2 new subs in last 7 days
        subRow({
          orgId: testOrg.id,
          userId: u1,
          tierId: tier.id,
          label: 'cur-1',
          status: 'active',
          createdAt: threeDaysAgo,
        }),
        subRow({
          orgId: testOrg.id,
          userId: u2,
          tierId: tier.id,
          label: 'cur-2',
          status: 'active',
          createdAt: threeDaysAgo,
        }),
        // Previous window: 1 new sub 7-14 days ago
        subRow({
          orgId: testOrg.id,
          userId: u3,
          tierId: tier.id,
          label: 'prev-1',
          status: 'active',
          createdAt: tenDaysAgo,
        }),
      ]);

      const withCompare = await service.getSubscriberStats(testOrg.id, {
        startDate: sevenDaysAgo,
        endDate: now,
        compareFrom: fourteenDaysAgo,
        compareTo: sevenDaysAgo,
      });

      expect(withCompare.newSubscribers).toBe(2);
      expect(withCompare.previous).toBeDefined();
      expect(withCompare.previous?.newSubscribers).toBe(1);
      // previous block must not itself carry a nested previous
      expect(
        (withCompare.previous as unknown as { previous?: unknown })?.previous
      ).toBeUndefined();

      const onlyFrom = await service.getSubscriberStats(testOrg.id, {
        compareFrom: fourteenDaysAgo,
      });
      const onlyTo = await service.getSubscriberStats(testOrg.id, {
        compareTo: sevenDaysAgo,
      });
      const neither = await service.getSubscriberStats(testOrg.id);

      expect(onlyFrom.previous).toBeUndefined();
      expect(onlyTo.previous).toBeUndefined();
      expect(neither.previous).toBeUndefined();
    });

    it('should restrict daily breakdown to the requested date range', async () => {
      // Regression guard against the revenue bug fixed in BE-1: the daily
      // breakdown must use the same window as aggregates, not a hardcoded
      // TREND_DAYS_DEFAULT window.
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const tier = await insertTier(testOrg.id, 'daily-range');
      const [uIn, uOut] = await seedTestUsers(db, 2);

      const today = new Date();
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      await db.insert(subscriptions).values([
        subRow({
          orgId: testOrg.id,
          userId: uIn,
          tierId: tier.id,
          label: 'in-range',
          status: 'active',
          createdAt: twoDaysAgo,
        }),
        subRow({
          orgId: testOrg.id,
          userId: uOut,
          tierId: tier.id,
          label: 'out-of-range',
          status: 'active',
          createdAt: tenDaysAgo,
        }),
      ]);

      const stats = await service.getSubscriberStats(testOrg.id, {
        startDate: fiveDaysAgo,
        endDate: today,
      });

      // Aggregates respect the window
      expect(stats.newSubscribers).toBe(1);
      // Daily rows reflect the same window — no row older than start
      expect(stats.subscribersByDay).toHaveLength(1);
      expect(
        new Date(stats.subscribersByDay[0].date).getTime()
      ).toBeGreaterThanOrEqual(
        new Date(fiveDaysAgo.toISOString().split('T')[0]).getTime()
      );
    });
  });

  describe('getFollowerStats', () => {
    it('should return zero stats for organization with no followers', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const stats = await service.getFollowerStats(emptyOrg.id);

      expect(stats.totalFollowers).toBe(0);
      expect(stats.newFollowers).toBe(0);
      expect(stats.followersByDay).toEqual([]);
      expect(stats.previous).toBeUndefined();
    });

    it('should count total and new correctly when followers were created before, during, and after the range', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Three users: one pre-range, one in-range, one post-range
      const [uBefore, uIn, uAfter] = await seedTestUsers(db, 3);

      const now = new Date();
      const fortyDaysAgo = new Date(now);
      fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const threeDaysAgo = new Date(now);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const oneDayAhead = new Date(now);
      oneDayAhead.setDate(oneDayAhead.getDate() + 1);

      await db.insert(organizationFollowers).values([
        {
          organizationId: testOrg.id,
          userId: uBefore,
          createdAt: fortyDaysAgo,
        },
        {
          organizationId: testOrg.id,
          userId: uIn,
          createdAt: threeDaysAgo,
        },
        {
          organizationId: testOrg.id,
          userId: uAfter,
          createdAt: oneDayAhead,
        },
      ]);

      // Window: last 7 days. Expected: new = 1 (uIn), total (rows created
      // on or before end=now) = 2 (uBefore + uIn). The future row is excluded.
      const stats = await service.getFollowerStats(testOrg.id, {
        startDate: sevenDaysAgo,
        endDate: now,
      });

      expect(stats.newFollowers).toBe(1);
      expect(stats.totalFollowers).toBe(2);
      expect(stats.followersByDay).toHaveLength(1);
      expect(stats.followersByDay[0].newFollowers).toBe(1);
    });

    it('should scope follower stats to the given organization only', async () => {
      const [orgA] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [orgB] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [ua, ub] = await seedTestUsers(db, 2);
      const now = new Date();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      await db.insert(organizationFollowers).values([
        {
          organizationId: orgA.id,
          userId: ua,
          createdAt: twoDaysAgo,
        },
        {
          organizationId: orgB.id,
          userId: ub,
          createdAt: twoDaysAgo,
        },
      ]);

      const aStats = await service.getFollowerStats(orgA.id);
      const bStats = await service.getFollowerStats(orgB.id);

      expect(aStats.newFollowers).toBe(1);
      expect(aStats.totalFollowers).toBe(1);
      expect(bStats.newFollowers).toBe(1);
      expect(bStats.totalFollowers).toBe(1);
    });

    it('should include a previous block when compareFrom and compareTo are provided, and omit it otherwise', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [u1, u2, u3] = await seedTestUsers(db, 3);

      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const threeDaysAgo = new Date(now);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      await db.insert(organizationFollowers).values([
        // Current window: 2 new follows in last 7 days
        {
          organizationId: testOrg.id,
          userId: u1,
          createdAt: threeDaysAgo,
        },
        {
          organizationId: testOrg.id,
          userId: u2,
          createdAt: threeDaysAgo,
        },
        // Previous window: 1 new follow 7-14 days ago
        {
          organizationId: testOrg.id,
          userId: u3,
          createdAt: tenDaysAgo,
        },
      ]);

      const withCompare = await service.getFollowerStats(testOrg.id, {
        startDate: sevenDaysAgo,
        endDate: now,
        compareFrom: fourteenDaysAgo,
        compareTo: sevenDaysAgo,
      });

      expect(withCompare.newFollowers).toBe(2);
      expect(withCompare.previous).toBeDefined();
      expect(withCompare.previous?.newFollowers).toBe(1);
      // previous block must not itself carry a nested previous
      expect(
        (withCompare.previous as unknown as { previous?: unknown })?.previous
      ).toBeUndefined();

      const onlyFrom = await service.getFollowerStats(testOrg.id, {
        compareFrom: fourteenDaysAgo,
      });
      const onlyTo = await service.getFollowerStats(testOrg.id, {
        compareTo: sevenDaysAgo,
      });
      const neither = await service.getFollowerStats(testOrg.id);

      expect(onlyFrom.previous).toBeUndefined();
      expect(onlyTo.previous).toBeUndefined();
      expect(neither.previous).toBeUndefined();
    });

    it('should restrict daily breakdown to the requested date range', async () => {
      // Regression guard against the revenue bug fixed in BE-1: the daily
      // breakdown must use the same window as aggregates, not a hardcoded
      // TREND_DAYS_DEFAULT window.
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [uIn, uOut] = await seedTestUsers(db, 2);

      const today = new Date();
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      await db.insert(organizationFollowers).values([
        {
          organizationId: testOrg.id,
          userId: uIn,
          createdAt: twoDaysAgo,
        },
        {
          organizationId: testOrg.id,
          userId: uOut,
          createdAt: tenDaysAgo,
        },
      ]);

      const stats = await service.getFollowerStats(testOrg.id, {
        startDate: fiveDaysAgo,
        endDate: today,
      });

      // Aggregates respect the window
      expect(stats.newFollowers).toBe(1);
      // Daily rows reflect the same window — no row older than start
      expect(stats.followersByDay).toHaveLength(1);
      expect(
        new Date(stats.followersByDay[0].date).getTime()
      ).toBeGreaterThanOrEqual(
        new Date(fiveDaysAgo.toISOString().split('T')[0]).getTime()
      );
    });
  });

  describe('getCustomerStats', () => {
    it('should return zero stats for organization with no customers', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const stats = await service.getCustomerStats(emptyOrg.id);

      expect(stats.totalCustomers).toBe(0);
      expect(stats.newCustomersLast30Days).toBe(0);
    });

    it('should count distinct customers with completed purchases', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Create additional test users
      const [customer1, customer2] = await seedTestUsers(db, 2);

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Customer Stats Test',
          slug: createUniqueSlug('customer-stats'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 500,
        })
        .returning();

      // Multiple purchases from two customers
      await db.insert(purchases).values([
        {
          customerId: customer1,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_c1_1_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId: customer1,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_c1_2_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId: customer2,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_c2_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
      ]);

      const stats = await service.getCustomerStats(testOrg.id);

      // 2 distinct customers even though 3 purchases
      expect(stats.totalCustomers).toBe(2);
      expect(stats.newCustomersLast30Days).toBe(2);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context
  });

  describe('getTopContent', () => {
    it('should return empty array for organization with no purchases', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const topContent = await service.getTopContent(emptyOrg.id);

      expect(topContent.items).toEqual([]);
      expect(topContent.pagination.total).toBe(0);
    });

    it('should rank content by revenue in descending order', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create multiple content items
      const [lowRevenue] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Low Revenue Content',
          slug: createUniqueSlug('low-revenue'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 100,
        })
        .returning();

      const [highRevenue] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'High Revenue Content',
          slug: createUniqueSlug('high-revenue'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 5000,
        })
        .returning();

      // Create purchases
      await db.insert(purchases).values([
        {
          customerId,
          contentId: lowRevenue.id,
          organizationId: testOrg.id,
          amountPaidCents: 100,
          platformFeeCents: 10,
          organizationFeeCents: 0,
          creatorPayoutCents: 90,
          stripePaymentIntentId: `pi_low_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId,
          contentId: highRevenue.id,
          organizationId: testOrg.id,
          amountPaidCents: 5000,
          platformFeeCents: 500,
          organizationFeeCents: 0,
          creatorPayoutCents: 4500,
          stripePaymentIntentId: `pi_high_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
      ]);

      const topContent = await service.getTopContent(testOrg.id, {
        limit: DEFAULT_TOP_CONTENT_LIMIT,
      });

      expect(topContent.items).toHaveLength(2);
      expect(topContent.items[0].contentId).toBe(highRevenue.id);
      expect(topContent.items[0].revenueCents).toBe(5000);
      expect(topContent.items[1].contentId).toBe(lowRevenue.id);
      expect(topContent.items[1].revenueCents).toBe(100);
      // New default-shape fields: views zero (no playback), trendDelta null
      // when no compare window is requested.
      expect(topContent.items[0].viewsInPeriod).toBe(0);
      expect(topContent.items[0].trendDelta).toBeNull();
      expect(topContent.items[0].thumbnailUrl).toBeNull();
    });

    it('should respect limit parameter', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create 5 content items with purchases
      for (let i = 0; i < 5; i++) {
        const [c] = await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: `Content ${i}`,
            slug: createUniqueSlug(`limit-test-${i}`),
            contentType: 'video',
            status: 'published',
            visibility: 'purchased_only',
            priceCents: (i + 1) * 100,
          })
          .returning();

        await db.insert(purchases).values({
          customerId,
          contentId: c.id,
          organizationId: testOrg.id,
          amountPaidCents: (i + 1) * 100,
          platformFeeCents: (i + 1) * 10,
          organizationFeeCents: 0,
          creatorPayoutCents: (i + 1) * 90,
          stripePaymentIntentId: `pi_limit_${Date.now()}_${i}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        });
      }

      const topContent = await service.getTopContent(testOrg.id, { limit: 3 });

      expect(topContent.items).toHaveLength(3);
    });

    it('should count distinct playback viewers only within the requested period', async () => {
      // Only videoPlayback rows whose updatedAt falls inside the window should
      // contribute to viewsInPeriod. Each (user, content) pair is a single row
      // due to the composite unique — so "views" here is "distinct users
      // engaged in the window", not total impressions.
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Views Test Content',
          slug: createUniqueSlug('views-test'),
          contentType: 'video',
          status: 'published',
          thumbnailUrl: 'https://cdn.example/thumb.jpg',
          priceCents: 500,
        })
        .returning();

      // Need a completed purchase so the content surfaces in the top list.
      await db.insert(purchases).values({
        customerId,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 500,
        platformFeeCents: 50,
        organizationFeeCents: 0,
        creatorPayoutCents: 450,
        stripePaymentIntentId: `pi_views_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(),
      });

      // Three viewers, one with playback that falls outside the window.
      const [viewerIn1, viewerIn2, viewerOut] = await seedTestUsers(db, 3);

      const now = new Date();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const fiveDaysAgo = new Date(now);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const twentyDaysAgo = new Date(now);
      twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

      await db.insert(videoPlayback).values([
        {
          userId: viewerIn1,
          contentId: testContent.id,
          positionSeconds: 120,
          durationSeconds: 600,
          updatedAt: twoDaysAgo,
          createdAt: twoDaysAgo,
        },
        {
          userId: viewerIn2,
          contentId: testContent.id,
          positionSeconds: 300,
          durationSeconds: 600,
          updatedAt: twoDaysAgo,
          createdAt: twoDaysAgo,
        },
        {
          userId: viewerOut,
          contentId: testContent.id,
          positionSeconds: 50,
          durationSeconds: 600,
          updatedAt: twentyDaysAgo,
          createdAt: twentyDaysAgo,
        },
      ]);

      const stats = await service.getTopContent(testOrg.id, {
        startDate: fiveDaysAgo,
        endDate: now,
      });

      const item = stats.items.find((i) => i.contentId === testContent.id);
      expect(item).toBeDefined();
      expect(item?.viewsInPeriod).toBe(2);
      expect(item?.thumbnailUrl).toBe('https://cdn.example/thumb.jpg');
      expect(item?.trendDelta).toBeNull();
    });

    it('should populate per-row trendDelta when compareFrom and compareTo are provided', async () => {
      // Same content has purchases in both windows. Delta is current-period
      // revenue minus previous-period revenue, scoped per contentId. A missing
      // previous-period match must resolve to delta = current (prev defaults 0).
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [growing] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Growing Content',
          slug: createUniqueSlug('trend-growing'),
          contentType: 'video',
          status: 'published',
          priceCents: 1000,
        })
        .returning();

      const [newcomer] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Newcomer Content',
          slug: createUniqueSlug('trend-newcomer'),
          contentType: 'video',
          status: 'published',
          priceCents: 500,
        })
        .returning();

      const now = new Date();
      const threeDaysAgo = new Date(now);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      await db.insert(purchases).values([
        // Growing: 2000 current, 1000 previous → delta +1000
        {
          customerId,
          contentId: growing.id,
          organizationId: testOrg.id,
          amountPaidCents: 2000,
          platformFeeCents: 200,
          organizationFeeCents: 0,
          creatorPayoutCents: 1800,
          stripePaymentIntentId: `pi_trend_growing_curr_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: threeDaysAgo,
        },
        {
          customerId,
          contentId: growing.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_trend_growing_prev_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: tenDaysAgo,
        },
        // Newcomer: 500 current only → delta +500 (no prev match)
        {
          customerId,
          contentId: newcomer.id,
          organizationId: testOrg.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_trend_newcomer_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: threeDaysAgo,
        },
      ]);

      const stats = await service.getTopContent(testOrg.id, {
        startDate: sevenDaysAgo,
        endDate: now,
        compareFrom: fourteenDaysAgo,
        compareTo: sevenDaysAgo,
      });

      const growingItem = stats.items.find((i) => i.contentId === growing.id);
      const newcomerItem = stats.items.find((i) => i.contentId === newcomer.id);

      expect(growingItem?.trendDelta).toBe(1000);
      expect(newcomerItem?.trendDelta).toBe(500);

      // Without compare dates, trendDelta stays null even if prior sales exist.
      const noCompare = await service.getTopContent(testOrg.id, {
        startDate: sevenDaysAgo,
        endDate: now,
      });
      expect(
        noCompare.items.find((i) => i.contentId === growing.id)?.trendDelta
      ).toBeNull();
    });

    it('should scope revenue and views to the given organization only', async () => {
      // A content row in orgB must never surface in orgA's top list, even when
      // both orgs have purchases at the same priceCents. This guards the
      // `eq(purchases.organizationId, organizationId)` predicate against
      // regressions that would otherwise leak cross-org figures.
      const [orgA] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [orgB] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [contentA] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: orgA.id,
          mediaItemId: media.id,
          title: 'Org A Content',
          slug: createUniqueSlug('org-a-scope'),
          contentType: 'video',
          status: 'published',
          priceCents: 500,
        })
        .returning();

      const [contentB] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: orgB.id,
          mediaItemId: media.id,
          title: 'Org B Content',
          slug: createUniqueSlug('org-b-scope'),
          contentType: 'video',
          status: 'published',
          priceCents: 500,
        })
        .returning();

      await db.insert(purchases).values([
        {
          customerId,
          contentId: contentA.id,
          organizationId: orgA.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_scope_a_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId,
          contentId: contentB.id,
          organizationId: orgB.id,
          amountPaidCents: 500,
          platformFeeCents: 50,
          organizationFeeCents: 0,
          creatorPayoutCents: 450,
          stripePaymentIntentId: `pi_scope_b_${Date.now()}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
      ]);

      const aStats = await service.getTopContent(orgA.id);
      const bStats = await service.getTopContent(orgB.id);

      expect(aStats.items.map((i) => i.contentId)).toContain(contentA.id);
      expect(aStats.items.map((i) => i.contentId)).not.toContain(contentB.id);
      expect(bStats.items.map((i) => i.contentId)).toContain(contentB.id);
      expect(bStats.items.map((i) => i.contentId)).not.toContain(contentA.id);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context
  });

  describe('getDashboardStats', () => {
    it('should return zero stats for organization with no data', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const stats = await service.getDashboardStats(emptyOrg.id);

      expect(stats.revenue.totalRevenueCents).toBe(0);
      expect(stats.revenue.totalPurchases).toBe(0);
      expect(stats.customers.totalCustomers).toBe(0);
      expect(stats.customers.newCustomersLast30Days).toBe(0);
      expect(stats.topContent.items).toEqual([]);
      expect(stats.topContent.pagination.total).toBe(0);
    });

    it('should return combined stats for organization with data', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Dashboard Test Content',
          slug: createUniqueSlug('dashboard-test'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Create purchases
      await db.insert(purchases).values([
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_dashboard_${Date.now()}_1`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
        {
          customerId,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_dashboard_${Date.now()}_2`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        },
      ]);

      const stats = await service.getDashboardStats(testOrg.id);

      // Verify all three data sections are present
      expect(stats.revenue.totalRevenueCents).toBe(2000);
      expect(stats.revenue.totalPurchases).toBe(2);
      expect(stats.customers.totalCustomers).toBe(1);
      expect(stats.customers.newCustomersLast30Days).toBe(1);
      expect(stats.topContent.items).toHaveLength(1);
      expect(stats.topContent.items[0].contentId).toBe(testContent.id);
    });

    it('should respect date range filter for revenue', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Date Filter Dashboard Test',
          slug: createUniqueSlug('dashboard-date-filter'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 500,
        })
        .returning();

      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      // Create purchase today
      await db.insert(purchases).values({
        customerId,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 500,
        platformFeeCents: 50,
        organizationFeeCents: 0,
        creatorPayoutCents: 450,
        stripePaymentIntentId: `pi_dashboard_date_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: now,
      });

      // Filter from yesterday to today
      const stats = await service.getDashboardStats(testOrg.id, {
        startDate: yesterday,
        endDate: now,
      });

      // Revenue stats should be filtered
      expect(stats.revenue.totalRevenueCents).toBe(500);
      // Customer and top content unaffected by date filter
      expect(stats.customers.totalCustomers).toBe(1);
      expect(stats.topContent.items).toHaveLength(1);
    });

    it('should respect top content limit parameter', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create 5 content items with purchases
      for (let i = 0; i < 5; i++) {
        const [c] = await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: `Dashboard Content ${i}`,
            slug: createUniqueSlug(`dashboard-limit-${i}`),
            contentType: 'video',
            status: 'published',
            visibility: 'purchased_only',
            priceCents: (i + 1) * 100,
          })
          .returning();

        await db.insert(purchases).values({
          customerId,
          contentId: c.id,
          organizationId: testOrg.id,
          amountPaidCents: (i + 1) * 100,
          platformFeeCents: (i + 1) * 10,
          organizationFeeCents: 0,
          creatorPayoutCents: (i + 1) * 90,
          stripePaymentIntentId: `pi_dash_limit_${Date.now()}_${i}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        });
      }

      const stats = await service.getDashboardStats(testOrg.id, {
        topContentLimit: 3,
      });

      expect(stats.topContent.items).toHaveLength(3);
    });

    it('should use default limit when topContentLimit not provided', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const stats = await service.getDashboardStats(testOrg.id);

      // Default limit is applied in getTopContent via DEFAULT_TOP_CONTENT_LIMIT
      // This just verifies the method handles undefined correctly
      expect(stats.topContent.items).toEqual([]);
      expect(stats.topContent.pagination.total).toBe(0);
    });
  });

  describe('getRecentActivity', () => {
    it('should return empty activity feed for organization with no activity', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const result = await service.getRecentActivity(emptyOrg.id, {});

      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('should return combined feed with purchases, content_published, and member_joined', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Create additional users for different activity types
      const [memberUser] = await seedTestUsers(db, 1);

      // Create media and content for purchase activity
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Test Content for Activity',
          slug: createUniqueSlug('activity-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: new Date(),
        })
        .returning();

      // Create a purchase
      await db.insert(purchases).values({
        customerId,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_activity_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(),
      });

      // Create a membership (member_joined activity)
      await db.insert(organizationMemberships).values({
        organizationId: testOrg.id,
        userId: memberUser,
        role: 'member',
        status: 'active',
        invitedBy: creatorId,
      });

      const result = await service.getRecentActivity(testOrg.id, {});

      // Should have 3 items: purchase, content_published, member_joined
      expect(result.items).toHaveLength(3);
      expect(result.pagination.total).toBe(3);

      // Check all activity types are present
      const activityTypes = result.items.map((item) => item.type);
      expect(activityTypes).toContain('purchase');
      expect(activityTypes).toContain('content_published');
      expect(activityTypes).toContain('member_joined');

      // Items should be sorted by timestamp DESC (most recent first)
      const timestamps = result.items.map((item) =>
        new Date(item.timestamp).getTime()
      );
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });

    it('should support pagination', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Create media and content
      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create multiple published content items
      for (let i = 0; i < 5; i++) {
        const [contentItem] = await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: `Content ${i}`,
            slug: createUniqueSlug(`content-${i}`),
            contentType: 'video',
            status: 'published',
            visibility: 'purchased_only',
            priceCents: 100,
            publishedAt: new Date(),
          })
          .returning();

        await db.insert(purchases).values({
          customerId,
          contentId: contentItem.id,
          organizationId: testOrg.id,
          amountPaidCents: 100,
          platformFeeCents: 10,
          organizationFeeCents: 0,
          creatorPayoutCents: 90,
          stripePaymentIntentId: `pi_page_${Date.now()}_${i}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        });
      }

      // Test page 1 with limit 3
      const page1 = await service.getRecentActivity(testOrg.id, {
        page: 1,
        limit: 3,
      });

      expect(page1.items).toHaveLength(3);
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.limit).toBe(3);
      expect(page1.pagination.total).toBe(10); // 5 content + 5 purchases

      // Test page 2
      const page2 = await service.getRecentActivity(testOrg.id, {
        page: 2,
        limit: 3,
      });

      expect(page2.items).toHaveLength(3);
      expect(page2.pagination.page).toBe(2);
      expect(page2.pagination.total).toBe(10);

      // Items should be different between pages
      const page1Ids = page1.items.map((item) => item.id);
      const page2Ids = page2.items.map((item) => item.id);
      const intersection = page1Ids.filter((id) => page2Ids.includes(id));
      expect(intersection).toHaveLength(0);
    });

    it('should filter by activity type: purchase', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [testContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Test Content',
          slug: createUniqueSlug('filter-purchase'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: new Date(),
        })
        .returning();

      // Create purchase
      await db.insert(purchases).values({
        customerId,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_filter_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(),
      });

      const result = await service.getRecentActivity(testOrg.id, {
        type: 'purchase',
      });

      // Should only return purchase type (content_published excluded, member_joined excluded)
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.type === 'purchase')).toBe(true);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter by activity type: content_published', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create published content
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Published Content',
          slug: createUniqueSlug('filter-published'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: new Date(),
        })
        .returning();

      // Create draft content (should NOT appear in feed)
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Draft Content',
          slug: createUniqueSlug('draft-content'),
          contentType: 'video',
          status: 'draft',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: null,
        })
        .returning();

      const result = await service.getRecentActivity(testOrg.id, {
        type: 'content_published',
      });

      // Should only return content_published type
      expect(result.items.length).toBeGreaterThan(0);
      expect(
        result.items.every((item) => item.type === 'content_published')
      ).toBe(true);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter by activity type: member_joined', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [memberUser] = await seedTestUsers(db, 1);

      // Create membership
      await db.insert(organizationMemberships).values({
        organizationId: testOrg.id,
        userId: memberUser,
        role: 'member',
        status: 'active',
        invitedBy: creatorId,
      });

      const result = await service.getRecentActivity(testOrg.id, {
        type: 'member_joined',
      });

      // Should only return member_joined type
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.type === 'member_joined')).toBe(
        true
      );
      expect(result.pagination.total).toBe(1);
    });

    it('should exclude deleted content from activity feed', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create published content then delete it
      const [deletedContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Deleted Content',
          slug: createUniqueSlug('deleted-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: new Date(),
        })
        .returning();

      // Create active content
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Active Content',
          slug: createUniqueSlug('active-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: new Date(),
        })
        .returning();

      // Soft delete the content
      await db
        .update(contentTable)
        .set({ deletedAt: new Date() })
        .where(eq(contentTable.id, deletedContent.id));

      const result = await service.getRecentActivity(testOrg.id, {
        type: 'content_published',
      });

      // Should only return active content (deleted content excluded)
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Active Content');
      expect(result.pagination.total).toBe(1);
    });

    it('should sort activity by timestamp DESC', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const now = Date.now();

      // Create content at different times
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);

      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Old Content',
          slug: createUniqueSlug('old-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: twoHoursAgo,
        })
        .returning();

      const [newContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'New Content',
          slug: createUniqueSlug('new-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
          publishedAt: oneHourAgo,
        })
        .returning();

      // Create purchase at a specific time
      await db.insert(purchases).values({
        customerId,
        contentId: newContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_sort_${Date.now()}`,
        status: PURCHASE_STATUS.COMPLETED,
        purchasedAt: new Date(now), // Most recent
      });

      const result = await service.getRecentActivity(testOrg.id, {});

      expect(result.items).toHaveLength(3);

      // Most recent should be first
      expect(result.items[0].type).toBe('purchase');
      expect(result.items[0].timestamp).toBeDefined();
    });

    it('should correctly count total items across all activity types', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Create 2 published content (non-purchase)
      for (let i = 0; i < 2; i++) {
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: `Content ${i}`,
            slug: createUniqueSlug(`count-content-${i}`),
            contentType: 'video',
            status: 'published',
            visibility: 'purchased_only',
            priceCents: 1000,
            publishedAt: new Date(),
          })
          .returning();
      }

      // Create 3 purchases
      for (let i = 0; i < 3; i++) {
        const [contentItem] = await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: `Purchase Content ${i}`,
            slug: createUniqueSlug(`purchase-content-${i}`),
            contentType: 'video',
            status: 'published',
            visibility: 'purchased_only',
            priceCents: 1000,
            publishedAt: new Date(),
          })
          .returning();

        await db.insert(purchases).values({
          customerId,
          contentId: contentItem.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_count_${Date.now()}_${i}`,
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        });
      }

      // Create 1 membership
      const [memberUser] = await seedTestUsers(db, 1);
      await db.insert(organizationMemberships).values({
        organizationId: testOrg.id,
        userId: memberUser,
        role: 'member',
        status: 'active',
        invitedBy: creatorId,
      });

      // Total should be 5 (2 content + 3 content from purchase loop) + 3 (purchases) + 1 (membership) = 9
      const result = await service.getRecentActivity(testOrg.id, {
        limit: 100, // Get all items
      });

      expect(result.pagination.total).toBe(9);
    });
  });
});
