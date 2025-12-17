/**
 * Admin Customer Management Service Tests
 *
 * Comprehensive test suite for AdminCustomerManagementService covering:
 * - List customers with pagination and aggregated stats
 * - Get customer details with purchase history
 * - Grant complimentary content access (idempotent)
 * - Organization scoping enforcement
 * - Error handling
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 */

import {
  contentAccess,
  content as contentTable,
  mediaItems,
  organizationMemberships,
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
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminCustomerManagementService } from '../services/customer-management-service';

describe('AdminCustomerManagementService', () => {
  let db: Database;
  let service: AdminCustomerManagementService;
  let creatorId: string;
  let customerId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminCustomerManagementService({ db, environment: 'test' });

    // Create test users
    const userIds = await seedTestUsers(db, 2);
    [creatorId, customerId] = userIds;

    // Create organization
    const [org] = await db
      .insert(organizations)
      .values(createTestOrganizationInput())
      .returning();
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('listCustomers', () => {
    it('should return empty list for organization with no customers', async () => {
      // Create a new org with no purchases
      const [emptyOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const result = await service.listCustomers(emptyOrg.id);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('should list customers with aggregated purchase stats', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Create test customers
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
          title: 'Customer Test Content',
          slug: createUniqueSlug('customer-list-test'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Customer 1: 2 purchases totaling $20
      await db.insert(purchases).values([
        {
          customerId: customer1,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_list_c1_1_${Date.now()}`,
          status: 'completed',
          purchasedAt: new Date(),
        },
        {
          customerId: customer1,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_list_c1_2_${Date.now()}`,
          status: 'completed',
          purchasedAt: new Date(),
        },
      ]);

      // Customer 2: 1 purchase totaling $50
      await db.insert(purchases).values({
        customerId: customer2,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 5000,
        platformFeeCents: 500,
        organizationFeeCents: 0,
        creatorPayoutCents: 4500,
        stripePaymentIntentId: `pi_list_c2_${Date.now()}`,
        status: 'completed',
        purchasedAt: new Date(),
      });

      const result = await service.listCustomers(testOrg.id);

      expect(result.items).toHaveLength(2);
      expect(result.pagination.total).toBe(2);

      // Customer 2 should be first (higher total spent)
      expect(result.items[0].userId).toBe(customer2);
      expect(result.items[0].totalPurchases).toBe(1);
      expect(result.items[0].totalSpentCents).toBe(5000);

      // Customer 1 second
      expect(result.items[1].userId).toBe(customer1);
      expect(result.items[1].totalPurchases).toBe(2);
      expect(result.items[1].totalSpentCents).toBe(2000);
    });

    it('should only count completed purchases', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

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
          title: 'Status Filter Test',
          slug: createUniqueSlug('status-filter'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Mix of statuses
      await db.insert(purchases).values([
        {
          customerId: customer,
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
          customerId: customer,
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
          customerId: customer,
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

      const result = await service.listCustomers(testOrg.id);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].totalPurchases).toBe(1); // Only completed
      expect(result.items[0].totalSpentCents).toBe(1000);
    });

    it('should paginate customers correctly', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Create 5 customers
      const customerIds = await seedTestUsers(db, 5);

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
          title: 'Pagination Test',
          slug: createUniqueSlug('pagination-test'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 100,
        })
        .returning();

      // Create purchases for all customers
      const purchaseValues = customerIds.map((cid, idx) => ({
        customerId: cid,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: (idx + 1) * 100,
        platformFeeCents: (idx + 1) * 10,
        organizationFeeCents: 0,
        creatorPayoutCents: (idx + 1) * 90,
        stripePaymentIntentId: `pi_paginate_${Date.now()}_${idx}`,
        status: 'completed' as const,
        purchasedAt: new Date(),
      }));

      await db.insert(purchases).values(purchaseValues);

      const page1 = await service.listCustomers(testOrg.id, {
        page: 1,
        limit: 2,
      });
      const page2 = await service.listCustomers(testOrg.id, {
        page: 2,
        limit: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.total).toBe(5);
      expect(page1.pagination.totalPages).toBe(3);

      expect(page2.items).toHaveLength(2);
      expect(page2.pagination.page).toBe(2);

      // Different customers on different pages
      expect(page1.items[0].userId).not.toBe(page2.items[0].userId);
    });

    it('should scope to specific organization only', async () => {
      const [org1] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [org2] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

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

      // Content for each org
      const [content1] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org1.id,
          mediaItemId: media.id,
          title: 'Org1 Content',
          slug: createUniqueSlug('org1-scoping'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      const [content2] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org2.id,
          mediaItemId: media.id,
          title: 'Org2 Content',
          slug: createUniqueSlug('org2-scoping'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      // Customer1 purchases from org1
      await db.insert(purchases).values({
        customerId: customer1,
        contentId: content1.id,
        organizationId: org1.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_scope_org1_${Date.now()}`,
        status: 'completed',
        purchasedAt: new Date(),
      });

      // Customer2 purchases from org2
      await db.insert(purchases).values({
        customerId: customer2,
        contentId: content2.id,
        organizationId: org2.id,
        amountPaidCents: 2000,
        platformFeeCents: 200,
        organizationFeeCents: 0,
        creatorPayoutCents: 1800,
        stripePaymentIntentId: `pi_scope_org2_${Date.now()}`,
        status: 'completed',
        purchasedAt: new Date(),
      });

      // Org1 should only see customer1
      const org1Result = await service.listCustomers(org1.id);
      expect(org1Result.items).toHaveLength(1);
      expect(org1Result.items[0].userId).toBe(customer1);

      // Org2 should only see customer2
      const org2Result = await service.listCustomers(org2.id);
      expect(org2Result.items).toHaveLength(1);
      expect(org2Result.items[0].userId).toBe(customer2);
    });

    it('should throw NotFoundError for non-existent organization', async () => {
      await expect(
        service.listCustomers('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getCustomerDetails', () => {
    it('should return customer details with purchase history', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      const [content1] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Content A',
          slug: createUniqueSlug('details-a'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      const [content2] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Content B',
          slug: createUniqueSlug('details-b'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      // Create purchases
      await db.insert(purchases).values([
        {
          customerId: customer,
          contentId: content1.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_details_1_${Date.now()}`,
          status: 'completed',
          purchasedAt: yesterday,
        },
        {
          customerId: customer,
          contentId: content2.id,
          organizationId: testOrg.id,
          amountPaidCents: 2000,
          platformFeeCents: 200,
          organizationFeeCents: 0,
          creatorPayoutCents: 1800,
          stripePaymentIntentId: `pi_details_2_${Date.now()}`,
          status: 'completed',
          purchasedAt: now,
        },
      ]);

      const details = await service.getCustomerDetails(testOrg.id, customer);

      expect(details.userId).toBe(customer);
      expect(details.totalPurchases).toBe(2);
      expect(details.totalSpentCents).toBe(3000);
      expect(details.purchaseHistory).toHaveLength(2);

      // Purchase history should be ordered by date descending (newest first)
      expect(details.purchaseHistory[0].contentTitle).toBe('Content B');
      expect(details.purchaseHistory[0].amountPaidCents).toBe(2000);
      expect(details.purchaseHistory[1].contentTitle).toBe('Content A');
      expect(details.purchaseHistory[1].amountPaidCents).toBe(1000);
    });

    it('should only include completed purchases in stats and history', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

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
          title: 'Details Status Test',
          slug: createUniqueSlug('details-status'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      await db.insert(purchases).values([
        {
          customerId: customer,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_det_completed_${Date.now()}`,
          status: 'completed',
          purchasedAt: new Date(),
        },
        {
          customerId: customer,
          contentId: testContent.id,
          organizationId: testOrg.id,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_det_pending_${Date.now()}`,
          status: 'pending',
        },
      ]);

      const details = await service.getCustomerDetails(testOrg.id, customer);

      expect(details.totalPurchases).toBe(1);
      expect(details.totalSpentCents).toBe(1000);
      expect(details.purchaseHistory).toHaveLength(1);
    });

    it('should throw NotFoundError for non-existent organization', async () => {
      await expect(
        service.getCustomerDetails(
          '00000000-0000-0000-0000-000000000000',
          customerId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent customer', async () => {
      await expect(
        service.getCustomerDetails(
          orgId,
          '00000000-0000-0000-0000-000000000000'
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for customer with no purchases from this org', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Customer exists but has no purchases from this org
      const [customer] = await seedTestUsers(db, 1);

      await expect(
        service.getCustomerDetails(testOrg.id, customer)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('grantContentAccess', () => {
    it('should grant complimentary access successfully', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

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
          title: 'Grant Access Content',
          slug: createUniqueSlug('grant-access'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Create a purchase to establish relationship with org
      await db.insert(purchases).values({
        customerId: customer,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_grant_${Date.now()}`,
        status: 'completed',
        purchasedAt: new Date(),
      });

      // Create another content to grant access to
      const [newContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'New Content for Access',
          slug: createUniqueSlug('new-access'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      const result = await service.grantContentAccess(
        testOrg.id,
        customer,
        newContent.id
      );

      expect(result).toBe(true);

      // Verify access record was created
      const accessRecord = await db.query.contentAccess.findFirst({
        where: and(
          eq(contentAccess.userId, customer),
          eq(contentAccess.contentId, newContent.id)
        ),
      });

      expect(accessRecord).toBeDefined();
      expect(accessRecord?.accessType).toBe('complimentary');
      expect(accessRecord?.organizationId).toBe(testOrg.id);
    });

    it('should be idempotent (return success if access already exists)', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

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
          title: 'Idempotent Content',
          slug: createUniqueSlug('idempotent-access'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Create relationship via purchase
      await db.insert(purchases).values({
        customerId: customer,
        contentId: testContent.id,
        organizationId: testOrg.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_idemp_${Date.now()}`,
        status: 'completed',
        purchasedAt: new Date(),
      });

      // Create another content and pre-create access
      const [newContent] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: testOrg.id,
          mediaItemId: media.id,
          title: 'Pre-existing Access Content',
          slug: createUniqueSlug('pre-existing'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      // Pre-create access record
      await db.insert(contentAccess).values({
        userId: customer,
        contentId: newContent.id,
        organizationId: testOrg.id,
        accessType: 'purchased',
      });

      // Should succeed (idempotent)
      const result = await service.grantContentAccess(
        testOrg.id,
        customer,
        newContent.id
      );

      expect(result).toBe(true);

      // Should still only have one access record
      const records = await db
        .select()
        .from(contentAccess)
        .where(
          and(
            eq(contentAccess.userId, customer),
            eq(contentAccess.contentId, newContent.id)
          )
        );

      expect(records).toHaveLength(1);
    });

    it('should grant access to users with org membership (no purchase required)', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

      // Create membership instead of purchase
      await db.insert(organizationMemberships).values({
        organizationId: testOrg.id,
        userId: customer,
        role: 'member',
        status: 'active',
      });

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
          title: 'Member Access Content',
          slug: createUniqueSlug('member-access'),
          contentType: 'video',
          status: 'published',
          visibility: 'members_only',
          priceCents: 0,
        })
        .returning();

      const result = await service.grantContentAccess(
        testOrg.id,
        customer,
        testContent.id
      );

      expect(result).toBe(true);

      // Verify access record was created with complimentary type
      const accessRecord = await db.query.contentAccess.findFirst({
        where: and(
          eq(contentAccess.userId, customer),
          eq(contentAccess.contentId, testContent.id)
        ),
      });

      expect(accessRecord).toBeDefined();
      expect(accessRecord?.accessType).toBe('complimentary');
    });

    it('should throw NotFoundError for non-existent organization', async () => {
      await expect(
        service.grantContentAccess(
          '00000000-0000-0000-0000-000000000000',
          customerId,
          '00000000-0000-0000-0000-000000000001'
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent customer', async () => {
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
          title: 'No Customer Content',
          slug: createUniqueSlug('no-customer'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      await expect(
        service.grantContentAccess(
          testOrg.id,
          '00000000-0000-0000-0000-000000000000',
          testContent.id
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for customer without relationship to org', async () => {
      const [testOrg] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      // Customer exists but has no purchases or membership with org
      const [customer] = await seedTestUsers(db, 1);

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
          title: 'No Relationship Content',
          slug: createUniqueSlug('no-relationship'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      await expect(
        service.grantContentAccess(testOrg.id, customer, testContent.id)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for content not in this organization', async () => {
      const [org1] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [org2] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const [customer] = await seedTestUsers(db, 1);

      const [media] = await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning();

      // Content in org1
      const [org1Content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org1.id,
          mediaItemId: media.id,
          title: 'Org1 Content',
          slug: createUniqueSlug('org1-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 1000,
        })
        .returning();

      // Content in org2
      const [org2Content] = await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: org2.id,
          mediaItemId: media.id,
          title: 'Org2 Content',
          slug: createUniqueSlug('org2-content'),
          contentType: 'video',
          status: 'published',
          visibility: 'purchased_only',
          priceCents: 2000,
        })
        .returning();

      // Create relationship with org1 via purchase
      await db.insert(purchases).values({
        customerId: customer,
        contentId: org1Content.id,
        organizationId: org1.id,
        amountPaidCents: 1000,
        platformFeeCents: 100,
        organizationFeeCents: 0,
        creatorPayoutCents: 900,
        stripePaymentIntentId: `pi_cross_org_${Date.now()}`,
        status: 'completed',
        purchasedAt: new Date(),
      });

      // Try to grant access to org2's content via org1 - should fail
      await expect(
        service.grantContentAccess(org1.id, customer, org2Content.id)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
