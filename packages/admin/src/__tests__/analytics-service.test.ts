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

import {
  content as contentTable,
  mediaItems,
  organizations,
  purchases,
} from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
          status: 'completed',
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
          status: 'completed',
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
          status: 'completed',
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
          status: 'pending',
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
          status: 'failed',
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
          status: 'completed',
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
          status: 'completed',
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

    it('should throw NotFoundError for non-existent organization', async () => {
      await expect(
        service.getRevenueStats('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(NotFoundError);
    });

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
          status: 'completed',
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
          status: 'completed',
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
          status: 'completed',
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
          status: 'completed',
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
          status: 'completed',
          purchasedAt: new Date(),
        },
      ]);

      const stats = await service.getCustomerStats(testOrg.id);

      // 2 distinct customers even though 3 purchases
      expect(stats.totalCustomers).toBe(2);
      expect(stats.newCustomersLast30Days).toBe(2);
    });

    it('should throw NotFoundError for non-existent organization', async () => {
      await expect(
        service.getCustomerStats('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTopContent', () => {
    it('should return empty array for organization with no purchases', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const topContent = await service.getTopContent(emptyOrg.id);

      expect(topContent).toEqual([]);
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
          status: 'completed',
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
          status: 'completed',
          purchasedAt: new Date(),
        },
      ]);

      const topContent = await service.getTopContent(testOrg.id, 10);

      expect(topContent).toHaveLength(2);
      expect(topContent[0].contentId).toBe(highRevenue.id);
      expect(topContent[0].revenueCents).toBe(5000);
      expect(topContent[1].contentId).toBe(lowRevenue.id);
      expect(topContent[1].revenueCents).toBe(100);
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
          status: 'completed',
          purchasedAt: new Date(),
        });
      }

      const topContent = await service.getTopContent(testOrg.id, 3);

      expect(topContent).toHaveLength(3);
    });

    it('should throw NotFoundError for non-existent organization', async () => {
      await expect(
        service.getTopContent('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(NotFoundError);
    });
  });
});
