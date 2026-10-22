/**
 * Admin Customer Management Service Tests
 *
 * Comprehensive test suite for AdminCustomerManagementService covering:
 * - List customers with pagination and aggregated stats
 * - Get customer details with purchase history
 * - Grant complimentary content access (idempotent), list and revoke grants
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
  entitlements,
  mediaItems,
  organizationMemberships,
  organizations,
  purchases,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentNotGrantableError } from '../errors';
import { AdminCustomerManagementService } from '../services/customer-management-service';

describe('AdminCustomerManagementService', () => {
  let db: Database;
  let service: AdminCustomerManagementService;
  let creatorId: string;
  /** The Studio user who grants (and, in the revoke tests, the other actor). */
  let supportUserId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminCustomerManagementService({ db, environment: 'test' });

    // Create test users
    const userIds = await seedTestUsers(db, 2);
    [creatorId, supportUserId] = userIds;

    // Create organization
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('listCustomers', () => {
    it('should return empty list for organization with no customers', async () => {
      // Create a new org with no purchases
      const emptyOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const result = await service.listCustomers(emptyOrg.id);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('should list customers with aggregated purchase stats', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      // Create test customers
      const [customer1, customer2] = await seedTestUsers(db, 2);

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const testContent = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Customer Test Content',
            slug: createUniqueSlug('customer-list-test'),
            contentType: 'video',
            status: 'published',
            priceCents: 1000,
          })
          .returning()
      );

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
      expect(result.items[0]!.userId).toBe(customer2);
      expect(result.items[0]!.totalPurchases).toBe(1);
      expect(result.items[0]!.totalSpentCents).toBe(5000);

      // Customer 1 second
      expect(result.items[1]!.userId).toBe(customer1);
      expect(result.items[1]!.totalPurchases).toBe(2);
      expect(result.items[1]!.totalSpentCents).toBe(2000);
    });

    it('should only count completed purchases', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const [customer] = await seedTestUsers(db, 1);

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const testContent = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Status Filter Test',
            slug: createUniqueSlug('status-filter'),
            contentType: 'video',
            status: 'published',
            priceCents: 1000,
          })
          .returning()
      );

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
      expect(result.items[0]!.totalPurchases).toBe(1); // Only completed
      expect(result.items[0]!.totalSpentCents).toBe(1000);
    });

    it('should paginate customers correctly', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      // Create 5 customers
      const customerIds = await seedTestUsers(db, 5);

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const testContent = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Pagination Test',
            slug: createUniqueSlug('pagination-test'),
            contentType: 'video',
            status: 'published',
            priceCents: 100,
          })
          .returning()
      );

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
      expect(page1.items[0]!.userId).not.toBe(page2.items[0]!.userId);
    });

    it('should scope to specific organization only', async () => {
      const org1 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const org2 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const [customer1, customer2] = await seedTestUsers(db, 2);

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      // Content for each org
      const content1 = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: org1.id,
            mediaItemId: media.id,
            title: 'Org1 Content',
            slug: createUniqueSlug('org1-scoping'),
            contentType: 'video',
            status: 'published',
            priceCents: 1000,
          })
          .returning()
      );

      const content2 = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: org2.id,
            mediaItemId: media.id,
            title: 'Org2 Content',
            slug: createUniqueSlug('org2-scoping'),
            contentType: 'video',
            status: 'published',
            priceCents: 2000,
          })
          .returning()
      );

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
      expect(org1Result.items[0]!.userId).toBe(customer1);

      // Org2 should only see customer2
      const org2Result = await service.listCustomers(org2.id);
      expect(org2Result.items).toHaveLength(1);
      expect(org2Result.items[0]!.userId).toBe(customer2);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context
  });

  describe('getCustomerDetails', () => {
    it('should return customer details with purchase history', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const [customer] = await seedTestUsers(db, 1);

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const content1 = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Content A',
            slug: createUniqueSlug('details-a'),
            contentType: 'video',
            status: 'published',
            priceCents: 1000,
          })
          .returning()
      );

      const content2 = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Content B',
            slug: createUniqueSlug('details-b'),
            contentType: 'video',
            status: 'published',
            priceCents: 2000,
          })
          .returning()
      );

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
      expect(details.purchaseHistory[0]!.contentTitle).toBe('Content B');
      expect(details.purchaseHistory[0]!.amountPaidCents).toBe(2000);
      expect(details.purchaseHistory[1]!.contentTitle).toBe('Content A');
      expect(details.purchaseHistory[1]!.amountPaidCents).toBe(1000);
    });

    it('should only include completed purchases in stats and history', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const [customer] = await seedTestUsers(db, 1);

      const media = takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              mediaType: 'video',
              status: 'ready',
            })
          )
          .returning()
      );

      const testContent = takeFirst(
        await db
          .insert(contentTable)
          .values({
            creatorId,
            organizationId: testOrg.id,
            mediaItemId: media.id,
            title: 'Details Status Test',
            slug: createUniqueSlug('details-status'),
            contentType: 'video',
            status: 'published',
            priceCents: 1000,
          })
          .returning()
      );

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

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context

    it('should throw NotFoundError for non-existent customer', async () => {
      await expect(
        service.getCustomerDetails(
          orgId,
          '00000000-0000-0000-0000-000000000000'
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for customer with no purchases from this org', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      // Customer exists but has no purchases from this org
      const [customer] = await seedTestUsers(db, 1);

      await expect(
        service.getCustomerDetails(testOrg.id, customer)
      ).rejects.toThrow(NotFoundError);
    });
  });

  // Codex-2hxff.21: a grant is a `grant` entitlement — the row the access
  // decision and the library read. It used to be a `content_access` row that
  // nothing reads, so a granted customer got nothing.
  describe('grantContentAccess', () => {
    it('writes a live grant entitlement recording who granted it, and no content_access row', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();

      const result = await service.grantContentAccess(
        testOrg.id,
        customer,
        newContent.id,
        supportUserId
      );

      expect(result).toBe(true);

      const rows = await liveGrantsFor(customer, newContent.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: customer,
        organizationId: testOrg.id,
        contentId: newContent.id,
        courseId: null,
        source: 'grant',
        sourceRef: null,
        expiresAt: null,
        grantedByUserId: supportUserId,
        revokedByUserId: null,
      });

      const legacy = await db.query.contentAccess.findFirst({
        where: and(
          eq(contentAccess.userId, customer),
          eq(contentAccess.contentId, newContent.id)
        ),
      });
      expect(legacy).toBeUndefined();
    });

    it('is idempotent: a re-grant of a live grant writes no second row', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();

      await service.grantContentAccess(
        testOrg.id,
        customer,
        newContent.id,
        supportUserId
      );
      const again = await service.grantContentAccess(
        testOrg.id,
        customer,
        newContent.id,
        creatorId
      );

      expect(again).toBe(true);
      const rows = await liveGrantsFor(customer, newContent.id);
      expect(rows).toHaveLength(1);
      // The first grant stands; the no-op did not overwrite who gave it.
      expect(rows[0]?.grantedByUserId).toBe(supportUserId);
    });

    it('should grant access to users with org membership (no purchase required)', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const [customer] = await seedTestUsers(db, 1);

      // Create membership instead of purchase
      await db.insert(organizationMemberships).values({
        organizationId: testOrg.id,
        userId: customer,
        role: 'member',
        status: 'active',
      });

      const testContent = await insertContent(testOrg.id, 'member-access');

      const result = await service.grantContentAccess(
        testOrg.id,
        customer,
        testContent.id,
        supportUserId
      );

      expect(result).toBe(true);
      expect(await liveGrantsFor(customer, testContent.id)).toHaveLength(1);
    });

    // Note: Organization existence validation is handled by middleware (requirePlatformOwner)
    // Service trusts that organizationId is valid when passed from authenticated context

    it('should throw NotFoundError for non-existent customer', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      const testContent = await insertContent(testOrg.id, 'no-customer');

      await expect(
        service.grantContentAccess(
          testOrg.id,
          '00000000-0000-0000-0000-000000000000',
          testContent.id,
          supportUserId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for customer without relationship to org', async () => {
      const testOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      // Customer exists but has no purchases or membership with org
      const [customer] = await seedTestUsers(db, 1);

      const testContent = await insertContent(testOrg.id, 'no-relationship');

      await expect(
        service.grantContentAccess(
          testOrg.id,
          customer,
          testContent.id,
          supportUserId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for content not in this organization', async () => {
      const { testOrg, customer } = await setupGrantable();
      const org2 = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const org2Content = await insertContent(org2.id, 'org2-content');

      // Try to grant access to org2's content via org1 - should fail
      await expect(
        service.grantContentAccess(
          testOrg.id,
          customer,
          org2Content.id,
          supportUserId
        )
      ).rejects.toThrow(NotFoundError);
      expect(await liveGrantsFor(customer, org2Content.id)).toHaveLength(0);
    });

    // Owner decision: "only items it can open". The access decision reads an
    // entitlement only on its tier and paid arms (`isGrantableContent`).
    it.each([
      ['followers-only', { isFollowerGated: true, priceCents: null }],
      ['team-only', { isTeamOnly: true, priceCents: null }],
      ['course-only', { courseOnly: true, priceCents: null }],
      ['free', { isFree: true, priceCents: 0 }],
    ])('refuses %s content with a 422 that names only the content', async (_shape, flags) => {
      const { testOrg, customer } = await setupGrantable();
      const item = await insertContent(testOrg.id, 'not-grantable', flags);

      const attempt = service.grantContentAccess(
        testOrg.id,
        customer,
        item.id,
        supportUserId
      );

      await expect(attempt).rejects.toThrow(ContentNotGrantableError);
      await attempt.catch((error: ContentNotGrantableError) => {
        expect(error.statusCode).toBe(422);
        expect(error.message).toBe(
          "This item can't be granted: a grant only opens paid or subscriber content."
        );
        expect(error.context).toEqual({ contentId: item.id });
      });
      expect(await liveGrantsFor(customer, item.id)).toHaveLength(0);
    });

    it.each([
      ['paid', 'paid'],
      ['tier (subscriber)', 'tier'],
    ])('grants %s content', async (_shape, kind) => {
      const { testOrg, customer } = await setupGrantable();
      const flags =
        kind === 'tier'
          ? {
              priceCents: null,
              includedInTierId: takeFirst(
                await db
                  .insert(subscriptionTiers)
                  .values(createTestTierInput(testOrg.id))
                  .returning()
              ).id,
            }
          : { priceCents: 1500 };
      const item = await insertContent(testOrg.id, `grantable-${kind}`, flags);

      await service.grantContentAccess(
        testOrg.id,
        customer,
        item.id,
        supportUserId
      );

      expect(await liveGrantsFor(customer, item.id)).toHaveLength(1);
    });

    it('should throw NotFoundError for deleted content', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      await db
        .update(contentTable)
        .set({ deletedAt: new Date() })
        .where(eq(contentTable.id, newContent.id));

      await expect(
        service.grantContentAccess(
          testOrg.id,
          customer,
          newContent.id,
          supportUserId
        )
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('revokeGrant', () => {
    it('revokes a live grant, recording who revoked it', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const grant = await grantNow(testOrg.id, customer, newContent.id);

      const result = await service.revokeGrant(
        testOrg.id,
        customer,
        grant.id,
        creatorId
      );

      expect(result).toEqual({ contentId: newContent.id, revoked: true });
      const row = await entitlementById(grant.id);
      expect(row?.revokedAt).toBeInstanceOf(Date);
      expect(row?.revokedByUserId).toBe(creatorId);
      expect(await liveGrantsFor(customer, newContent.id)).toHaveLength(0);
    });

    it('is idempotent: revoking a revoked grant changes nothing', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const grant = await grantNow(testOrg.id, customer, newContent.id);
      await service.revokeGrant(testOrg.id, customer, grant.id, creatorId);
      const first = await entitlementById(grant.id);

      const again = await service.revokeGrant(
        testOrg.id,
        customer,
        grant.id,
        supportUserId
      );

      expect(again).toEqual({ contentId: newContent.id, revoked: false });
      const row = await entitlementById(grant.id);
      expect(row?.revokedAt).toEqual(first?.revokedAt);
      expect(row?.revokedByUserId).toBe(creatorId);
    });

    it("404s another organization's grant and leaves it live", async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const grant = await grantNow(testOrg.id, customer, newContent.id);
      const otherOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

      await expect(
        service.revokeGrant(otherOrg.id, customer, grant.id, creatorId)
      ).rejects.toThrow(NotFoundError);
      expect((await entitlementById(grant.id))?.revokedAt).toBeNull();
    });

    it("404s another customer's grant and leaves it live", async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const grant = await grantNow(testOrg.id, customer, newContent.id);
      const [someoneElse] = await seedTestUsers(db, 1);

      await expect(
        service.revokeGrant(testOrg.id, someoneElse, grant.id, creatorId)
      ).rejects.toThrow(NotFoundError);
      expect((await entitlementById(grant.id))?.revokedAt).toBeNull();
    });

    it('404s a purchase entitlement and leaves it live', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const [purchaseEntitlement] = await db
        .insert(entitlements)
        .values({
          userId: customer,
          organizationId: testOrg.id,
          contentId: newContent.id,
          source: 'content_purchase',
        })
        .returning();
      if (!purchaseEntitlement) throw new Error('Failed to seed entitlement');

      await expect(
        service.revokeGrant(
          testOrg.id,
          customer,
          purchaseEntitlement.id,
          creatorId
        )
      ).rejects.toThrow(NotFoundError);
      expect(
        (await entitlementById(purchaseEntitlement.id))?.revokedAt
      ).toBeNull();
    });

    it('404s an unknown id', async () => {
      const { testOrg, customer } = await setupGrantable();
      await expect(
        service.revokeGrant(
          testOrg.id,
          customer,
          crypto.randomUUID(),
          creatorId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('a re-grant after a revoke writes a fresh live row and keeps the revoked one', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const grant = await grantNow(testOrg.id, customer, newContent.id);
      await service.revokeGrant(testOrg.id, customer, grant.id, creatorId);

      await service.grantContentAccess(
        testOrg.id,
        customer,
        newContent.id,
        supportUserId
      );

      const live = await liveGrantsFor(customer, newContent.id);
      expect(live).toHaveLength(1);
      expect(live[0]?.id).not.toBe(grant.id);
      expect((await entitlementById(grant.id))?.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('listCustomerGrants', () => {
    it("lists this organization's grants for the customer, live and revoked, newest first, with names", async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const second = await insertContent(testOrg.id, 'second-grant');
      await db
        .update(users)
        .set({ name: 'Sam Support' })
        .where(eq(users.id, supportUserId));
      await db
        .update(users)
        .set({ name: 'Riley Revoker' })
        .where(eq(users.id, creatorId));

      const older = await grantNow(
        testOrg.id,
        customer,
        newContent.id,
        new Date(Date.now() - 60_000)
      );
      const newer = await grantNow(testOrg.id, customer, second.id);
      await service.revokeGrant(testOrg.id, customer, older.id, creatorId);

      // Out of scope: another org's grant, and a purchase entitlement.
      const otherOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      const otherContent = await insertContent(otherOrg.id, 'other-org-grant');
      await grantNow(otherOrg.id, customer, otherContent.id);
      await db.insert(entitlements).values({
        userId: customer,
        organizationId: testOrg.id,
        contentId: newContent.id,
        source: 'content_purchase',
      });

      const result = await service.listCustomerGrants(testOrg.id, customer, {
        page: 1,
        limit: 50,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 2,
        totalPages: 1,
      });
      expect(result.items.map((g) => g.id)).toEqual([newer.id, older.id]);
      expect(result.items[0]).toEqual({
        id: newer.id,
        contentId: second.id,
        contentTitle: second.title,
        contentSlug: second.slug,
        grantedAt: expect.any(String),
        grantedByName: 'Sam Support',
        revokedAt: null,
        revokedByName: null,
      });
      expect(result.items[1]).toMatchObject({
        id: older.id,
        contentId: newContent.id,
        grantedByName: 'Sam Support',
        revokedAt: expect.any(String),
        revokedByName: 'Riley Revoker',
      });
      expect(Date.parse(result.items[0]?.grantedAt ?? '')).toBeGreaterThan(
        Date.parse(result.items[1]?.grantedAt ?? '')
      );
    });

    it('paginates', async () => {
      const { testOrg, customer, newContent } = await setupGrantable();
      const second = await insertContent(testOrg.id, 'paged-grant');
      await grantNow(testOrg.id, customer, newContent.id);
      await grantNow(testOrg.id, customer, second.id);

      const page2 = await service.listCustomerGrants(testOrg.id, customer, {
        page: 2,
        limit: 1,
      });

      expect(page2.items).toHaveLength(1);
      expect(page2.pagination).toEqual({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
    });

    it('is empty for a customer with no grants here', async () => {
      const { testOrg, customer } = await setupGrantable();
      const result = await service.listCustomerGrants(testOrg.id, customer);
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Paid (£10) unless `flags` say otherwise. */
  async function insertContent(
    organizationId: string,
    slugPrefix: string,
    flags: Partial<typeof contentTable.$inferInsert> = {}
  ) {
    const media = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'ready',
          })
        )
        .returning()
    );
    return takeFirst(
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId,
          mediaItemId: media.id,
          title: `Grant ${slugPrefix}`,
          slug: createUniqueSlug(slugPrefix),
          contentType: 'video',
          status: 'published',
          priceCents: 1000,
          ...flags,
        })
        .returning()
    );
  }

  /**
   * An org, a customer with a completed purchase there (the relationship a
   * grant requires), and a second item in the org to grant.
   */
  async function setupGrantable() {
    const testOrg = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    const [customer] = await seedTestUsers(db, 1);
    const bought = await insertContent(testOrg.id, 'bought');
    await db.insert(purchases).values({
      customerId: customer,
      contentId: bought.id,
      organizationId: testOrg.id,
      amountPaidCents: 1000,
      platformFeeCents: 100,
      organizationFeeCents: 0,
      creatorPayoutCents: 900,
      stripePaymentIntentId: `pi_grant_${crypto.randomUUID()}`,
      status: 'completed',
      purchasedAt: new Date(),
    });
    const newContent = await insertContent(testOrg.id, 'to-grant', {
      priceCents: 2000,
    });
    return { testOrg, customer, newContent };
  }

  /** A grant row as `grantContentAccess` writes it, at `grantedAt`. */
  async function grantNow(
    organizationId: string,
    customerId: string,
    contentId: string,
    grantedAt = new Date()
  ) {
    return takeFirst(
      await db
        .insert(entitlements)
        .values({
          userId: customerId,
          organizationId,
          contentId,
          source: 'grant',
          grantedByUserId: supportUserId,
          grantedAt,
        })
        .returning()
    );
  }

  async function liveGrantsFor(customerId: string, contentId: string) {
    return db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, customerId),
          eq(entitlements.contentId, contentId),
          eq(entitlements.source, 'grant'),
          isNull(entitlements.revokedAt)
        )
      );
  }

  async function entitlementById(id: string) {
    return db.query.entitlements.findFirst({ where: eq(entitlements.id, id) });
  }
});
