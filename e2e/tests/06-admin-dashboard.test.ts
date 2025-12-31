/**
 * E2E Test: Admin Dashboard
 *
 * Tests the complete admin dashboard functionality including:
 * 1. Authentication & Authorization (platform_owner role)
 * 2. Revenue Analytics
 * 3. Customer Analytics
 * 4. Top Content Rankings
 * 5. Content Management
 * 6. Customer Management & Complimentary Access
 *
 * All tests validate organization scoping to ensure data isolation.
 */

import { dbHttp, schema } from '@codex/database';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { adminFixture, authFixture, httpClient } from '../fixtures';
import {
  expectErrorResponse,
  expectForbidden,
  unwrapApiResponse,
} from '../helpers/assertions';
import {
  createCheckoutCompletedEvent,
  sendSignedWebhook,
} from '../helpers/stripe-webhook';
import { WORKER_URLS } from '../helpers/worker-urls';

describe('Admin Dashboard', () => {
  // ============================================================================
  // 1. Authentication & Authorization
  // ============================================================================

  describe('Authentication & Authorization', () => {
    test('should reject unauthenticated requests', async () => {
      // Call admin endpoint without cookie
      const response = await httpClient.get(
        `${WORKER_URLS.admin}/api/admin/analytics/revenue`
      );

      expect(response.status).toBe(401);
      await expectErrorResponse(response, 'UNAUTHORIZED', 401);
    });

    test('should reject non-platform-owner users', async () => {
      // Create a regular creator user (NOT platform owner)
      const creatorEmail = `creator-reject-${Date.now()}@example.com`;
      const { cookie: creatorCookie } = await authFixture.registerUser({
        email: creatorEmail,
        password: 'SecurePassword123!',
        name: 'Regular Creator',
        role: 'creator',
      });

      // Try to access admin analytics - should fail with 403
      const response = await httpClient.get(
        `${WORKER_URLS.admin}/api/admin/analytics/revenue`,
        {
          headers: { Cookie: creatorCookie },
        }
      );

      expect(response.status).toBe(403);
      await expectForbidden(response);
    });

    test('should accept platform_owner user', async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-accept-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        name: 'Platform Admin',
        orgName: `Test Org ${Date.now()}`,
        orgSlug: `test-org-${Date.now()}`,
      });

      // Access admin analytics - should succeed
      const stats = await adminFixture.getRevenueStats(admin.cookie);

      expect(stats).toBeDefined();
      expect(stats.totalRevenueCents).toBe(0);
      expect(stats.totalPurchases).toBe(0);
    }, 60000);
  });

  // ============================================================================
  // 2. Revenue Analytics
  // ============================================================================

  describe('Revenue Analytics', () => {
    test('should return zero stats for new org', async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-zero-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Zero Org ${Date.now()}`,
        orgSlug: `zero-org-${Date.now()}`,
      });

      const stats = await adminFixture.getRevenueStats(admin.cookie);

      expect(stats.totalRevenueCents).toBe(0);
      expect(stats.totalPurchases).toBe(0);
      expect(stats.averageOrderValueCents).toBe(0);
      expect(stats.platformFeeCents).toBe(0);
      expect(stats.creatorPayoutCents).toBe(0);
      expect(stats.revenueByDay).toEqual([]);
    }, 60000);
    test(
      'should calculate revenue from completed purchases',
      async () => {
        // 1. Create platform owner
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-revenue-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Revenue Org ${Date.now()}`,
          orgSlug: `revenue-org-${Date.now()}`,
        });

        // 2. Create creator and content under this org
        const creatorEmail = `creator-revenue-${Date.now()}@example.com`;
        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: creatorEmail,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Create media item
        const testMediaId = `e2e-revenue-${Date.now()}`;
        const mediaResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/media`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Revenue Test Media',
              mediaType: 'video',
              r2Key: `e2e/originals/${testMediaId}/original.mp4`,
              fileSizeBytes: 1048576,
              mimeType: 'video/mp4',
            },
          }
        );
        const media = unwrapApiResponse(await mediaResponse.json());

        await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            status: 'ready',
            hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
            thumbnailKey: `e2e/thumbnails/${testMediaId}/thumb.jpg`,
            durationSeconds: 300,
          },
        });

        // Create paid content under admin's organization
        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Revenue Test Content',
              slug: `revenue-test-${Date.now()}`,
              contentType: 'video',
              mediaItemId: media.id,
              organizationId: admin.organization.id,
              visibility: 'purchased_only',
              priceCents: 2999, // $29.99
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        // Publish content
        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        // 3. Create buyer and complete purchase
        const buyerEmail = `buyer-revenue-${Date.now()}@example.com`;
        const { user: buyer, cookie: buyerCookie } =
          await authFixture.registerUser({
            email: buyerEmail,
            password: 'SecurePassword123!',
            role: 'customer',
          });

        // Create checkout session
        const checkoutResponse = await httpClient.post(
          `${WORKER_URLS.ecom}/checkout/create`,
          {
            headers: {
              Cookie: buyerCookie,
              'Content-Type': 'application/json',
            },
            data: {
              contentId: content.id,
              successUrl: 'http://localhost:3000/success',
              cancelUrl: 'http://localhost:3000/cancel',
            },
          }
        );
        const checkout = unwrapApiResponse(await checkoutResponse.json());

        // Complete purchase via webhook
        const webhookEvent = createCheckoutCompletedEvent({
          sessionId: checkout.sessionId,
          paymentIntentId: `pi_test_revenue_${Date.now()}`,
          customerId: buyer.id,
          contentId: content.id,
          amountCents: 2999,
          organizationId: admin.organization.id,
        });

        await sendSignedWebhook(
          `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
          webhookEvent,
          process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
        );

        // 4. Verify revenue stats
        const stats = await adminFixture.getRevenueStats(admin.cookie);

        expect(stats.totalRevenueCents).toBe(2999);
        expect(stats.totalPurchases).toBe(1);
        expect(stats.averageOrderValueCents).toBe(2999);
        // Revenue split: 10% platform = 300, 90% creator = 2699
        expect(stats.platformFeeCents).toBe(300);
        expect(stats.creatorPayoutCents).toBe(2699);
      },
      { timeout: 180000 }
    );

    test(
      'should scope to platform owner org only',
      async () => {
        // Create TWO platform owners with different orgs
        const admin1 = await adminFixture.createPlatformOwner({
          email: `admin1-scope-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Scope Org 1 ${Date.now()}`,
          orgSlug: `scope-org-1-${Date.now()}`,
        });

        const admin2 = await adminFixture.createPlatformOwner({
          email: `admin2-scope-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Scope Org 2 ${Date.now()}`,
          orgSlug: `scope-org-2-${Date.now()}`,
        });

        // Create purchase in admin1's org
        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-scope-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        const testMediaId = `e2e-scope-${Date.now()}`;
        const mediaResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/media`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Scope Test Media',
              mediaType: 'video',
              r2Key: `e2e/originals/${testMediaId}/original.mp4`,
              fileSizeBytes: 1048576,
              mimeType: 'video/mp4',
            },
          }
        );
        const media = unwrapApiResponse(await mediaResponse.json());

        await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            status: 'ready',
            hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
            durationSeconds: 300,
          },
        });

        // Content in admin1's org
        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Scope Test Content',
              slug: `scope-test-${Date.now()}`,
              contentType: 'video',
              mediaItemId: media.id,
              organizationId: admin1.organization.id, // Admin1's org
              visibility: 'purchased_only',
              priceCents: 1999,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        // Buyer purchases content
        const { user: buyer, cookie: buyerCookie } =
          await authFixture.registerUser({
            email: `buyer-scope-${Date.now()}@example.com`,
            password: 'SecurePassword123!',
          });

        const checkoutResponse = await httpClient.post(
          `${WORKER_URLS.ecom}/checkout/create`,
          {
            headers: {
              Cookie: buyerCookie,
              'Content-Type': 'application/json',
            },
            data: {
              contentId: content.id,
              successUrl: 'http://localhost:3000/success',
              cancelUrl: 'http://localhost:3000/cancel',
            },
          }
        );
        const checkout = unwrapApiResponse(await checkoutResponse.json());

        const webhookEvent = createCheckoutCompletedEvent({
          sessionId: checkout.sessionId,
          paymentIntentId: `pi_scope_${Date.now()}`,
          customerId: buyer.id,
          contentId: content.id,
          amountCents: 1999,
          organizationId: admin1.organization.id,
        });

        await sendSignedWebhook(
          `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
          webhookEvent,
          process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
        );

        // Admin1 should see the purchase
        const admin1Stats = await adminFixture.getRevenueStats(admin1.cookie);
        expect(admin1Stats.totalPurchases).toBe(1);
        expect(admin1Stats.totalRevenueCents).toBe(1999);

        // Admin2 should NOT see admin1's purchase
        const admin2Stats = await adminFixture.getRevenueStats(admin2.cookie);
        expect(admin2Stats.totalPurchases).toBe(0);
        expect(admin2Stats.totalRevenueCents).toBe(0);
      },
      { timeout: 180000 }
    );
  });

  // ============================================================================
  // 3. Customer Analytics
  // ============================================================================

  describe('Customer Analytics', () => {
    test(
      'should count distinct customers',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-distinct-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Distinct Org ${Date.now()}`,
          orgSlug: `distinct-org-${Date.now()}`,
        });

        // Create content
        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-distinct-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        const testMediaId = `e2e-distinct-${Date.now()}`;
        const mediaResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/media`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Distinct Test Media',
              mediaType: 'video',
              r2Key: `e2e/originals/${testMediaId}/original.mp4`,
              fileSizeBytes: 1048576,
              mimeType: 'video/mp4',
            },
          }
        );
        const media = unwrapApiResponse(await mediaResponse.json());

        await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            status: 'ready',
            hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
            durationSeconds: 300,
          },
        });

        // Create two content items
        const content1Response = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Content 1',
              slug: `content-1-${Date.now()}`,
              contentType: 'video',
              mediaItemId: media.id,
              organizationId: admin.organization.id,
              visibility: 'purchased_only',
              priceCents: 999,
            },
          }
        );
        const content1 = unwrapApiResponse(await content1Response.json());

        const testMediaId2 = `e2e-distinct-2-${Date.now()}`;
        const media2Response = await httpClient.post(
          `${WORKER_URLS.content}/api/media`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Distinct Test Media 2',
              mediaType: 'video',
              r2Key: `e2e/originals/${testMediaId2}/original.mp4`,
              fileSizeBytes: 1048576,
              mimeType: 'video/mp4',
            },
          }
        );
        const media2 = unwrapApiResponse(await media2Response.json());

        await httpClient.patch(
          `${WORKER_URLS.content}/api/media/${media2.id}`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              status: 'ready',
              hlsMasterPlaylistKey: `e2e/hls/${testMediaId2}/master.m3u8`,
              durationSeconds: 300,
            },
          }
        );

        const content2Response = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Content 2',
              slug: `content-2-${Date.now()}`,
              contentType: 'video',
              mediaItemId: media2.id,
              organizationId: admin.organization.id,
              visibility: 'purchased_only',
              priceCents: 999,
            },
          }
        );
        const content2 = unwrapApiResponse(await content2Response.json());

        // Publish both
        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content1.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );
        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content2.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        // Same buyer purchases both
        const { user: buyer, cookie: buyerCookie } =
          await authFixture.registerUser({
            email: `buyer-distinct-${Date.now()}@example.com`,
            password: 'SecurePassword123!',
          });

        // Purchase 1
        const checkout1 = await httpClient.post(
          `${WORKER_URLS.ecom}/checkout/create`,
          {
            headers: {
              Cookie: buyerCookie,
              'Content-Type': 'application/json',
            },
            data: {
              contentId: content1.id,
              successUrl: 'http://localhost:3000/success',
              cancelUrl: 'http://localhost:3000/cancel',
            },
          }
        );
        const c1 = unwrapApiResponse(await checkout1.json());

        await sendSignedWebhook(
          `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
          createCheckoutCompletedEvent({
            sessionId: c1.sessionId,
            paymentIntentId: `pi_distinct_1_${Date.now()}`,
            customerId: buyer.id,
            contentId: content1.id,
            amountCents: 999,
            organizationId: admin.organization.id,
          }),
          process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
        );

        // Purchase 2
        const checkout2 = await httpClient.post(
          `${WORKER_URLS.ecom}/checkout/create`,
          {
            headers: {
              Cookie: buyerCookie,
              'Content-Type': 'application/json',
            },
            data: {
              contentId: content2.id,
              successUrl: 'http://localhost:3000/success',
              cancelUrl: 'http://localhost:3000/cancel',
            },
          }
        );
        const c2 = unwrapApiResponse(await checkout2.json());

        await sendSignedWebhook(
          `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
          createCheckoutCompletedEvent({
            sessionId: c2.sessionId,
            paymentIntentId: `pi_distinct_2_${Date.now()}`,
            customerId: buyer.id,
            contentId: content2.id,
            amountCents: 999,
            organizationId: admin.organization.id,
          }),
          process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
        );

        // Customer stats should show 1 distinct customer
        const customerStats = await adminFixture.getCustomerStats(admin.cookie);
        expect(customerStats.totalCustomers).toBe(1); // Same buyer = 1 distinct customer
      },
      { timeout: 180000 }
    );
  });

  // ============================================================================
  // 4. Top Content
  // ============================================================================

  describe('Top Content', () => {
    test(
      'should respect limit parameter',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-limit-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Limit Org ${Date.now()}`,
          orgSlug: `limit-org-${Date.now()}`,
        });

        // Top content with limit=3 on empty org
        const topContent = await adminFixture.getTopContent(admin.cookie, 3);

        expect(Array.isArray(topContent)).toBe(true);
        expect(topContent.length).toBeLessThanOrEqual(3);
      },
      { timeout: 60000 }
    );
  });

  // ============================================================================
  // 5. Content Management
  // ============================================================================

  describe('Content Management', () => {
    test(
      'should list all org content with pagination',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-list-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `List Org ${Date.now()}`,
          orgSlug: `list-org-${Date.now()}`,
        });

        // Create some content
        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-list-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Create 3 content items
        for (let i = 0; i < 3; i++) {
          await httpClient.post(`${WORKER_URLS.content}/api/content`, {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: `List Content ${i}`,
              slug: `list-content-${i}-${Date.now()}`,
              contentType: 'written',
              contentBody: `Content body ${i}`,
              organizationId: admin.organization.id,
              visibility: 'public',
              priceCents: 0,
            },
          });
        }

        // List with pagination
        const result = await adminFixture.listAllContent(admin.cookie, {
          page: 1,
          limit: 2,
        });

        expect(result.items).toHaveLength(2);
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(2);
        expect(result.pagination.total).toBe(3);
        expect(result.pagination.totalPages).toBe(2);
      },
      { timeout: 120000 }
    );

    test(
      'should filter content by status',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-filter-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Filter Org ${Date.now()}`,
          orgSlug: `filter-org-${Date.now()}`,
        });

        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-filter-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Create draft content
        const draftResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Draft Content',
              slug: `draft-${Date.now()}`,
              contentType: 'written',
              contentBody: 'Draft body',
              organizationId: admin.organization.id,
              visibility: 'public',
              priceCents: 0,
            },
          }
        );
        unwrapApiResponse(await draftResponse.json());

        // Create published content
        const publishedResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Published Content',
              slug: `published-${Date.now()}`,
              contentType: 'written',
              contentBody: 'Published body',
              organizationId: admin.organization.id,
              visibility: 'public',
              priceCents: 0,
            },
          }
        );
        const published = unwrapApiResponse(await publishedResponse.json());

        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${published.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        // Filter by published only
        const publishedResult = await adminFixture.listAllContent(
          admin.cookie,
          { status: 'published' }
        );

        expect(
          publishedResult.items.every((c) => c.status === 'published')
        ).toBe(true);

        // Filter by draft only
        const draftResult = await adminFixture.listAllContent(admin.cookie, {
          status: 'draft',
        });

        expect(draftResult.items.every((c) => c.status === 'draft')).toBe(true);
      },
      { timeout: 120000 }
    );

    test(
      'should publish draft content',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-publish-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Publish Org ${Date.now()}`,
          orgSlug: `publish-org-${Date.now()}`,
        });

        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-publish-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Create draft content
        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'To Be Published',
              slug: `to-be-published-${Date.now()}`,
              contentType: 'written',
              contentBody: 'Will be published',
              organizationId: admin.organization.id,
              visibility: 'public',
              priceCents: 0,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());
        expect(content.status).toBe('draft');

        // Admin publishes content
        const published = await adminFixture.publishContent(
          admin.cookie,
          content.id
        );

        expect(published.status).toBe('published');
      },
      { timeout: 120000 }
    );

    test(
      'should unpublish published content',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-unpublish-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Unpublish Org ${Date.now()}`,
          orgSlug: `unpublish-org-${Date.now()}`,
        });

        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-unpublish-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Create and publish content
        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'To Be Unpublished',
              slug: `to-be-unpublished-${Date.now()}`,
              contentType: 'written',
              contentBody: 'Will be unpublished',
              organizationId: admin.organization.id,
              visibility: 'public',
              priceCents: 0,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        // Admin unpublishes content
        const unpublished = await adminFixture.unpublishContent(
          admin.cookie,
          content.id
        );

        expect(unpublished.status).toBe('draft');
      },
      { timeout: 120000 }
    );

    test(
      'should soft delete content',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-delete-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Delete Org ${Date.now()}`,
          orgSlug: `delete-org-${Date.now()}`,
        });

        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-delete-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Create content
        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'To Be Deleted',
              slug: `to-be-deleted-${Date.now()}`,
              contentType: 'written',
              contentBody: 'Will be deleted',
              organizationId: admin.organization.id,
              visibility: 'public',
              priceCents: 0,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        // Admin deletes content
        await adminFixture.deleteContent(admin.cookie, content.id);

        // Verify content no longer in list
        const contentList = await adminFixture.listAllContent(admin.cookie);
        expect(
          contentList.items.find((c) => c.id === content.id)
        ).toBeUndefined();

        // Verify deletedAt is set in database
        const dbContent = await dbHttp.query.content.findFirst({
          where: eq(schema.content.id, content.id),
        });
        expect(dbContent?.deletedAt).not.toBeNull();
      },
      { timeout: 120000 }
    );

    test(
      'should reject cross-org content operations',
      async () => {
        // Create two admins with different orgs
        const admin1 = await adminFixture.createPlatformOwner({
          email: `admin1-cross-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Cross Org 1 ${Date.now()}`,
          orgSlug: `cross-org-1-${Date.now()}`,
        });

        const admin2 = await adminFixture.createPlatformOwner({
          email: `admin2-cross-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Cross Org 2 ${Date.now()}`,
          orgSlug: `cross-org-2-${Date.now()}`,
        });

        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-cross-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        // Content in admin1's org
        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Cross Org Content',
              slug: `cross-org-${Date.now()}`,
              contentType: 'written',
              contentBody: 'Cross org content',
              organizationId: admin1.organization.id, // Admin1's org
              visibility: 'public',
              priceCents: 0,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        // Admin2 tries to publish admin1's content - should fail with 404
        const response = await httpClient.post(
          `${WORKER_URLS.admin}/api/admin/content/${content.id}/publish`,
          {
            headers: {
              Cookie: admin2.cookie,
              'Content-Type': 'application/json',
            },
          }
        );

        expect(response.status).toBe(404);
      },
      { timeout: 120000 }
    );
  });

  // ============================================================================
  // 6. Customer Management
  // ============================================================================

  describe('Customer Management', () => {
    test(
      'should list customers with aggregated stats',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-customers-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Customers Org ${Date.now()}`,
          orgSlug: `customers-org-${Date.now()}`,
        });

        // Create content and buyer
        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-customers-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        const testMediaId = `e2e-customers-${Date.now()}`;
        const mediaResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/media`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Customers Test Media',
              mediaType: 'video',
              r2Key: `e2e/originals/${testMediaId}/original.mp4`,
              fileSizeBytes: 1048576,
              mimeType: 'video/mp4',
            },
          }
        );
        const media = unwrapApiResponse(await mediaResponse.json());

        await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            status: 'ready',
            hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
            durationSeconds: 300,
          },
        });

        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Customers Content',
              slug: `customers-${Date.now()}`,
              contentType: 'video',
              mediaItemId: media.id,
              organizationId: admin.organization.id,
              visibility: 'purchased_only',
              priceCents: 1999,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        // Buyer purchases
        const { user: buyer, cookie: buyerCookie } =
          await authFixture.registerUser({
            email: `buyer-customers-${Date.now()}@example.com`,
            password: 'SecurePassword123!',
          });

        const checkoutResponse = await httpClient.post(
          `${WORKER_URLS.ecom}/checkout/create`,
          {
            headers: {
              Cookie: buyerCookie,
              'Content-Type': 'application/json',
            },
            data: {
              contentId: content.id,
              successUrl: 'http://localhost:3000/success',
              cancelUrl: 'http://localhost:3000/cancel',
            },
          }
        );
        const checkout = unwrapApiResponse(await checkoutResponse.json());

        await sendSignedWebhook(
          `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
          createCheckoutCompletedEvent({
            sessionId: checkout.sessionId,
            paymentIntentId: `pi_customers_${Date.now()}`,
            customerId: buyer.id,
            contentId: content.id,
            amountCents: 1999,
            organizationId: admin.organization.id,
          }),
          process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
        );

        // List customers
        const customers = await adminFixture.listCustomers(admin.cookie);

        expect(customers.items).toHaveLength(1);
        expect(customers.items[0].userId).toBe(buyer.id);
        expect(customers.items[0].totalPurchases).toBe(1);
        expect(customers.items[0].totalSpentCents).toBe(1999);
      },
      { timeout: 180000 }
    );

    test(
      'should get customer details with purchase history',
      async () => {
        const admin = await adminFixture.createPlatformOwner({
          email: `admin-details-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          orgName: `Details Org ${Date.now()}`,
          orgSlug: `details-org-${Date.now()}`,
        });

        // Setup content and purchase (abbreviated)
        const { cookie: creatorCookie } = await authFixture.registerUser({
          email: `creator-details-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          role: 'creator',
        });

        const testMediaId = `e2e-details-${Date.now()}`;
        const mediaResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/media`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Details Test Media',
              mediaType: 'video',
              r2Key: `e2e/originals/${testMediaId}/original.mp4`,
              fileSizeBytes: 1048576,
              mimeType: 'video/mp4',
            },
          }
        );
        const media = unwrapApiResponse(await mediaResponse.json());

        await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            status: 'ready',
            hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
            durationSeconds: 300,
          },
        });

        const contentResponse = await httpClient.post(
          `${WORKER_URLS.content}/api/content`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
            data: {
              title: 'Details Content',
              slug: `details-${Date.now()}`,
              contentType: 'video',
              mediaItemId: media.id,
              organizationId: admin.organization.id,
              visibility: 'purchased_only',
              priceCents: 2499,
            },
          }
        );
        const content = unwrapApiResponse(await contentResponse.json());

        await httpClient.post(
          `${WORKER_URLS.content}/api/content/${content.id}/publish`,
          {
            headers: {
              Cookie: creatorCookie,
              'Content-Type': 'application/json',
            },
          }
        );

        const { user: buyer, cookie: buyerCookie } =
          await authFixture.registerUser({
            email: `buyer-details-${Date.now()}@example.com`,
            password: 'SecurePassword123!',
          });

        const checkoutResponse = await httpClient.post(
          `${WORKER_URLS.ecom}/checkout/create`,
          {
            headers: {
              Cookie: buyerCookie,
              'Content-Type': 'application/json',
            },
            data: {
              contentId: content.id,
              successUrl: 'http://localhost:3000/success',
              cancelUrl: 'http://localhost:3000/cancel',
            },
          }
        );
        const checkout = unwrapApiResponse(await checkoutResponse.json());

        await sendSignedWebhook(
          `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
          createCheckoutCompletedEvent({
            sessionId: checkout.sessionId,
            paymentIntentId: `pi_details_${Date.now()}`,
            customerId: buyer.id,
            contentId: content.id,
            amountCents: 2499,
            organizationId: admin.organization.id,
          }),
          process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
        );

        // Get customer details
        const details = await adminFixture.getCustomerDetails(
          admin.cookie,
          buyer.id
        );

        expect(details.userId).toBe(buyer.id);
        expect(details.totalPurchases).toBe(1);
        expect(details.totalSpentCents).toBe(2499);
        expect(details.purchaseHistory).toHaveLength(1);
        expect(details.purchaseHistory[0].contentTitle).toBe('Details Content');
        expect(details.purchaseHistory[0].amountPaidCents).toBe(2499);
      },
      { timeout: 180000 }
    );

    test('should grant complimentary access', async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-grant-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Grant Org ${Date.now()}`,
        orgSlug: `grant-org-${Date.now()}`,
      });

      // Create initial purchase to establish customer relationship
      const { cookie: creatorCookie } = await authFixture.registerUser({
        email: `creator-grant-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        role: 'creator',
      });

      // First content (for initial purchase)
      const testMediaId1 = `e2e-grant-1-${Date.now()}`;
      const media1Response = await httpClient.post(
        `${WORKER_URLS.content}/api/media`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            title: 'Grant Test Media 1',
            mediaType: 'video',
            r2Key: `e2e/originals/${testMediaId1}/original.mp4`,
            fileSizeBytes: 1048576,
            mimeType: 'video/mp4',
          },
        }
      );
      const media1 = unwrapApiResponse(await media1Response.json());

      await httpClient.patch(`${WORKER_URLS.content}/api/media/${media1.id}`, {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `e2e/hls/${testMediaId1}/master.m3u8`,
          durationSeconds: 300,
        },
      });

      const content1Response = await httpClient.post(
        `${WORKER_URLS.content}/api/content`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            title: 'First Content',
            slug: `first-${Date.now()}`,
            contentType: 'video',
            mediaItemId: media1.id,
            organizationId: admin.organization.id,
            visibility: 'purchased_only',
            priceCents: 999,
          },
        }
      );
      const content1 = unwrapApiResponse(await content1Response.json());

      await httpClient.post(
        `${WORKER_URLS.content}/api/content/${content1.id}/publish`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
        }
      );

      // Second content (for complimentary access)
      const testMediaId2 = `e2e-grant-2-${Date.now()}`;
      const media2Response = await httpClient.post(
        `${WORKER_URLS.content}/api/media`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            title: 'Grant Test Media 2',
            mediaType: 'video',
            r2Key: `e2e/originals/${testMediaId2}/original.mp4`,
            fileSizeBytes: 1048576,
            mimeType: 'video/mp4',
          },
        }
      );
      const media2 = unwrapApiResponse(await media2Response.json());

      await httpClient.patch(`${WORKER_URLS.content}/api/media/${media2.id}`, {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `e2e/hls/${testMediaId2}/master.m3u8`,
          durationSeconds: 300,
        },
      });

      const content2Response = await httpClient.post(
        `${WORKER_URLS.content}/api/content`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            title: 'Complimentary Content',
            slug: `complimentary-${Date.now()}`,
            contentType: 'video',
            mediaItemId: media2.id,
            organizationId: admin.organization.id,
            visibility: 'purchased_only',
            priceCents: 4999,
          },
        }
      );
      const content2 = unwrapApiResponse(await content2Response.json());

      await httpClient.post(
        `${WORKER_URLS.content}/api/content/${content2.id}/publish`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
        }
      );

      // Customer buys first content to establish relationship
      const { user: buyer, cookie: buyerCookie } =
        await authFixture.registerUser({
          email: `buyer-grant-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
        });

      const checkoutResponse = await httpClient.post(
        `${WORKER_URLS.ecom}/checkout/create`,
        {
          headers: {
            Cookie: buyerCookie,
            'Content-Type': 'application/json',
          },
          data: {
            contentId: content1.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
        }
      );
      const checkout = unwrapApiResponse(await checkoutResponse.json());

      await sendSignedWebhook(
        `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
        createCheckoutCompletedEvent({
          sessionId: checkout.sessionId,
          paymentIntentId: `pi_grant_${Date.now()}`,
          customerId: buyer.id,
          contentId: content1.id,
          amountCents: 999,
          organizationId: admin.organization.id,
        }),
        process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
      );

      // Admin grants complimentary access to second content
      const granted = await adminFixture.grantContentAccess(
        admin.cookie,
        buyer.id,
        content2.id
      );
      expect(granted).toBe(true);

      // Verify access was granted in database
      const accessRecords = await dbHttp
        .select()
        .from(schema.contentAccess)
        .where(
          and(
            eq(schema.contentAccess.userId, buyer.id),
            eq(schema.contentAccess.contentId, content2.id)
          )
        );

      expect(accessRecords).toHaveLength(1);
      expect(accessRecords[0].accessType).toBe('complimentary');
    }, 180000);

    test('should handle duplicate access grant (idempotent)', async () => {
      const admin = await adminFixture.createPlatformOwner({
        email: `admin-idem-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        orgName: `Idem Org ${Date.now()}`,
        orgSlug: `idem-org-${Date.now()}`,
      });

      // Setup (abbreviated)
      const { cookie: creatorCookie } = await authFixture.registerUser({
        email: `creator-idem-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        role: 'creator',
      });

      const testMediaId = `e2e-idem-${Date.now()}`;
      const mediaResponse = await httpClient.post(
        `${WORKER_URLS.content}/api/media`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            title: 'Idem Test Media',
            mediaType: 'video',
            r2Key: `e2e/originals/${testMediaId}/original.mp4`,
            fileSizeBytes: 1048576,
            mimeType: 'video/mp4',
          },
        }
      );
      const media = unwrapApiResponse(await mediaResponse.json());

      await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
          durationSeconds: 300,
        },
      });

      const contentResponse = await httpClient.post(
        `${WORKER_URLS.content}/api/content`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
          data: {
            title: 'Idem Content',
            slug: `idem-${Date.now()}`,
            contentType: 'video',
            mediaItemId: media.id,
            organizationId: admin.organization.id,
            visibility: 'purchased_only',
            priceCents: 1999,
          },
        }
      );
      const content = unwrapApiResponse(await contentResponse.json());

      await httpClient.post(
        `${WORKER_URLS.content}/api/content/${content.id}/publish`,
        {
          headers: {
            Cookie: creatorCookie,
            'Content-Type': 'application/json',
          },
        }
      );

      const { user: buyer, cookie: buyerCookie } =
        await authFixture.registerUser({
          email: `buyer-idem-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
        });

      const checkoutResponse = await httpClient.post(
        `${WORKER_URLS.ecom}/checkout/create`,
        {
          headers: {
            Cookie: buyerCookie,
            'Content-Type': 'application/json',
          },
          data: {
            contentId: content.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
        }
      );
      const checkout = unwrapApiResponse(await checkoutResponse.json());

      await sendSignedWebhook(
        `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
        createCheckoutCompletedEvent({
          sessionId: checkout.sessionId,
          paymentIntentId: `pi_idem_${Date.now()}`,
          customerId: buyer.id,
          contentId: content.id,
          amountCents: 1999,
          organizationId: admin.organization.id,
        }),
        process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
      );

      // Customer already has access via purchase. Grant access twice.
      const first = await adminFixture.grantContentAccess(
        admin.cookie,
        buyer.id,
        content.id
      );
      expect(first).toBe(true);

      const second = await adminFixture.grantContentAccess(
        admin.cookie,
        buyer.id,
        content.id
      );
      expect(second).toBe(true);

      // Should still have only one access record
      const accessRecords = await dbHttp
        .select()
        .from(schema.contentAccess)
        .where(
          and(
            eq(schema.contentAccess.userId, buyer.id),
            eq(schema.contentAccess.contentId, content.id)
          )
        );

      expect(accessRecords).toHaveLength(1);
    }, 180000);
  });
});
