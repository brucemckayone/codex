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
  organizationMemberships,
  organizations,
  purchases,
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

      const topContent = await service.getTopContent(
        testOrg.id,
        DEFAULT_TOP_CONTENT_LIMIT
      );

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
          status: PURCHASE_STATUS.COMPLETED,
          purchasedAt: new Date(),
        });
      }

      const topContent = await service.getTopContent(testOrg.id, 3);

      expect(topContent).toHaveLength(3);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context
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

      const [oldContent] = await db
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

      // Create 2 published content
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

      // Total should be 2 (content) + 3 (purchases) + 1 (membership) = 6
      const result = await service.getRecentActivity(testOrg.id, {
        limit: 100, // Get all items
      });

      expect(result.pagination.total).toBe(6);
    });
  });
});
