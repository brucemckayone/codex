/**
 * E2E Test: Purchase History API
 *
 * Tests the purchase listing and retrieval endpoints:
 * - GET /purchases - List customer's purchases with pagination/filters
 * - GET /purchases/:id - Get single purchase by ID
 *
 * Test cases:
 * 1. List purchases (paginated, with content details)
 * 2. Filter purchases by status and contentId
 * 3. Pagination edge cases
 * 4. Single purchase retrieval
 * 5. Access control (cannot view other users' purchases)
 * 6. Error handling (401, 403, 404)
 */

import { dbHttp, schema } from '@codex/database';
import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { authFixture } from '../fixtures';
import {
  expectSuccessResponse,
  unwrapApiResponse,
} from '../helpers/assertions';
import {
  createCheckoutCompletedEvent,
  sendSignedWebhook,
} from '../helpers/stripe-webhook';
import { WORKER_URLS } from '../helpers/worker-urls';

test.describe('Purchase History API', () => {
  // Run tests serially in same worker to share beforeAll setup
  test.describe.configure({ mode: 'serial' });

  // Test data stored across tests
  let creatorCookie: string;
  let buyerCookie: string;
  let otherBuyerCookie: string;
  let buyer: { id: string; email: string };
  let otherBuyer: { id: string; email: string };
  let organizationId: string;
  let contentId: string;
  let content2Id: string;
  let purchaseId: string;
  let purchase2Id: string;

  // Use slow() to increase timeout for complex setup (3x default = 180s)
  test.slow();

  test.beforeAll(async ({ request }) => {
    // Explicitly set longer timeout for this hook (3 minutes)
    test.setTimeout(180000);
    console.log('[Setup] Starting purchase history test setup...');
    // ========================================================================
    // Setup: Create creator with organization and two paid content items
    // ========================================================================
    const creatorEmail = `creator-history-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    console.log('[Setup] 1/12 Registering creator...');
    const { cookie: _creatorCookie } = await authFixture.registerUser(request, {
      email: creatorEmail,
      password: 'SecurePassword123!',
      name: 'History Test Creator',
      role: 'creator',
    });
    creatorCookie = _creatorCookie;
    console.log('[Setup] 1/12 Creator registered');

    // Create organization
    console.log('[Setup] 2/12 Creating organization...');
    const orgResponse = await request.post(
      `${WORKER_URLS.identity}/api/organizations`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.identity,
        },
        data: {
          name: `History Test Org ${Date.now()}`,
          slug: `history-test-org-${Date.now()}`,
          description: 'Organization for purchase history tests',
        },
      }
    );
    await expectSuccessResponse(orgResponse, 201);
    const organization = unwrapApiResponse(await orgResponse.json());
    organizationId = organization.id;
    console.log('[Setup] 2/12 Organization created:', organizationId);

    // Create first media item
    console.log('[Setup] 3/12 Creating media item 1...');
    const testMediaId1 = `e2e-history-video-1-${Date.now()}`;
    const mediaResponse1 = await request.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'History Test Video 1',
          mediaType: 'video',
          r2Key: `e2e/originals/${testMediaId1}/original.mp4`,
          fileSizeBytes: 1048576,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse1, 201);
    const media1 = unwrapApiResponse(await mediaResponse1.json());
    console.log('[Setup] 3/12 Media item 1 created');

    // Mark media 1 as ready
    console.log('[Setup] 4/12 Marking media 1 as ready...');
    await request.patch(`${WORKER_URLS.content}/api/media/${media1.id}`, {
      headers: {
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        Origin: WORKER_URLS.content,
      },
      data: {
        status: 'ready',
        hlsMasterPlaylistKey: `e2e/hls/${testMediaId1}/master.m3u8`,
        thumbnailKey: `e2e/thumbnails/${testMediaId1}/thumb.jpg`,
        durationSeconds: 300,
      },
    });
    console.log('[Setup] 4/12 Media 1 ready');

    // Create first paid content
    console.log('[Setup] 5/12 Creating content 1...');
    const contentResponse1 = await request.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Premium Course 1',
          slug: `premium-course-1-${Date.now()}`,
          description: 'First test content',
          contentType: 'video',
          mediaItemId: media1.id,
          organizationId: organizationId,
          visibility: 'purchased_only',
          priceCents: 2999,
        },
      }
    );
    await expectSuccessResponse(contentResponse1, 201);
    const content1 = unwrapApiResponse(await contentResponse1.json());
    contentId = content1.id;
    console.log('[Setup] 5/12 Content 1 created:', contentId);

    // Publish content 1
    console.log('[Setup] 6/12 Publishing content 1...');
    await request.post(
      `${WORKER_URLS.content}/api/content/${contentId}/publish`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
      }
    );
    console.log('[Setup] 6/12 Content 1 published');

    // Create second media item
    console.log('[Setup] 7/12 Creating media item 2...');
    const testMediaId2 = `e2e-history-video-2-${Date.now()}`;
    const mediaResponse2 = await request.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'History Test Video 2',
          mediaType: 'video',
          r2Key: `e2e/originals/${testMediaId2}/original.mp4`,
          fileSizeBytes: 2097152,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse2, 201);
    const media2 = unwrapApiResponse(await mediaResponse2.json());
    console.log('[Setup] 7/12 Media item 2 created');

    // Mark media 2 as ready
    console.log('[Setup] 8/12 Marking media 2 as ready...');
    await request.patch(`${WORKER_URLS.content}/api/media/${media2.id}`, {
      headers: {
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        Origin: WORKER_URLS.content,
      },
      data: {
        status: 'ready',
        hlsMasterPlaylistKey: `e2e/hls/${testMediaId2}/master.m3u8`,
        thumbnailKey: `e2e/thumbnails/${testMediaId2}/thumb.jpg`,
        durationSeconds: 600,
      },
    });
    console.log('[Setup] 8/12 Media 2 ready');

    // Create second paid content
    console.log('[Setup] 9/12 Creating content 2...');
    const contentResponse2 = await request.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Premium Course 2',
          slug: `premium-course-2-${Date.now()}`,
          description: 'Second test content',
          contentType: 'video',
          mediaItemId: media2.id,
          organizationId: organizationId,
          visibility: 'purchased_only',
          priceCents: 4999,
        },
      }
    );
    await expectSuccessResponse(contentResponse2, 201);
    const content2 = unwrapApiResponse(await contentResponse2.json());
    content2Id = content2.id;
    console.log('[Setup] 9/12 Content 2 created:', content2Id);

    // Publish content 2
    console.log('[Setup] 10/12 Publishing content 2...');
    await request.post(
      `${WORKER_URLS.content}/api/content/${content2Id}/publish`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
      }
    );
    console.log('[Setup] 10/12 Content 2 published');

    // ========================================================================
    // Setup: Create buyer and complete two purchases
    // ========================================================================
    console.log('[Setup] 11/12 Registering buyer...');
    const buyerEmail = `buyer-history-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const buyerResult = await authFixture.registerUser(request, {
      email: buyerEmail,
      password: 'SecurePassword123!',
      name: 'History Test Buyer',
      role: 'user',
    });
    buyer = buyerResult.user;
    buyerCookie = buyerResult.cookie;
    console.log('[Setup] 11/12 Buyer registered:', buyer.id);

    // Create checkout and complete purchase for content 1
    console.log('[Setup] 12/12 Creating purchases via webhooks...');
    const checkoutResponse1 = await request.post(
      `${WORKER_URLS.ecom}/checkout/create`,
      {
        headers: {
          Cookie: buyerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {
          contentId: contentId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
      }
    );
    await expectSuccessResponse(checkoutResponse1);
    const checkout1 = unwrapApiResponse(await checkoutResponse1.json());

    const paymentIntentId1 = `pi_history_1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const webhookEvent1 = createCheckoutCompletedEvent({
      sessionId: checkout1.sessionId,
      paymentIntentId: paymentIntentId1,
      customerId: buyer.id,
      contentId: contentId,
      amountCents: 2999,
      organizationId: organizationId,
    });

    console.log('[Setup] Sending webhook 1...');
    await sendSignedWebhook(
      request,
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent1,
      process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
    );
    console.log('[Setup] Webhook 1 sent');

    // Get purchase ID from database
    console.log('[Setup] Querying purchase 1 from DB...');
    const purchases1 = await dbHttp
      .select()
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.customerId, buyer.id),
          eq(schema.purchases.contentId, contentId)
        )
      );
    purchaseId = purchases1[0].id;
    console.log('[Setup] Purchase 1 ID:', purchaseId);

    // Create checkout and complete purchase for content 2
    console.log('[Setup] Creating checkout 2...');
    const checkoutResponse2 = await request.post(
      `${WORKER_URLS.ecom}/checkout/create`,
      {
        headers: {
          Cookie: buyerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {
          contentId: content2Id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
      }
    );
    await expectSuccessResponse(checkoutResponse2);
    const checkout2 = unwrapApiResponse(await checkoutResponse2.json());

    const paymentIntentId2 = `pi_history_2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const webhookEvent2 = createCheckoutCompletedEvent({
      sessionId: checkout2.sessionId,
      paymentIntentId: paymentIntentId2,
      customerId: buyer.id,
      contentId: content2Id,
      amountCents: 4999,
      organizationId: organizationId,
    });

    console.log('[Setup] Sending webhook 2...');
    await sendSignedWebhook(
      request,
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent2,
      process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
    );
    console.log('[Setup] Webhook 2 sent');

    // Get purchase 2 ID from database
    console.log('[Setup] Querying purchase 2 from DB...');
    const purchases2 = await dbHttp
      .select()
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.customerId, buyer.id),
          eq(schema.purchases.contentId, content2Id)
        )
      );
    purchase2Id = purchases2[0].id;
    console.log('[Setup] Purchase 2 ID:', purchase2Id);

    // ========================================================================
    // Setup: Create another buyer (for access control tests)
    // ========================================================================
    console.log('[Setup] Registering other buyer...');
    const otherBuyerEmail = `other-buyer-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const otherBuyerResult = await authFixture.registerUser(request, {
      email: otherBuyerEmail,
      password: 'SecurePassword123!',
      name: 'Other Buyer',
      role: 'user',
    });
    otherBuyer = otherBuyerResult.user;
    otherBuyerCookie = otherBuyerResult.cookie;
    console.log('[Setup] Other buyer registered:', otherBuyer.id);
    console.log('[Setup] ✅ Setup complete!');
  });

  // ============================================================================
  // GET /purchases - List Purchases
  // ============================================================================

  test.describe('GET /purchases - List Purchases', () => {
    test('should return paginated list of customer purchases', async ({
      request,
    }) => {
      const response = await request.get(`${WORKER_URLS.ecom}/purchases`, {
        headers: {
          Cookie: buyerCookie,
          Origin: WORKER_URLS.ecom,
        },
      });

      await expectSuccessResponse(response);
      const json = await response.json();
      const data = json.data; // Unwrap { data: { items, pagination } }

      // Verify response structure
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(20);
      expect(data.pagination.total).toBeGreaterThanOrEqual(2);
      expect(data.pagination.totalPages).toBeGreaterThanOrEqual(1);

      // Verify at least 2 purchases exist
      expect(data.items.length).toBeGreaterThanOrEqual(2);

      // Verify purchase structure includes content details
      const purchase = data.items[0];
      expect(purchase.id).toBeDefined();
      expect(purchase.customerId).toBe(buyer.id);
      expect(purchase.amountPaidCents).toBeDefined();
      expect(purchase.status).toBe('completed');
      expect(purchase.content).toBeDefined();
      expect(purchase.content.title).toBeDefined();
      expect(purchase.content.slug).toBeDefined();
      expect(purchase.content.contentType).toBe('video');
    });

    test('should filter purchases by status', async ({ request }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases?status=completed`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      await expectSuccessResponse(response);
      const json = await response.json();
      const data = json.data;

      // All items should have completed status
      expect(data.items.length).toBeGreaterThan(0);
      for (const purchase of data.items) {
        expect(purchase.status).toBe('completed');
      }
    });

    test('should filter purchases by contentId', async ({ request }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases?contentId=${contentId}`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      await expectSuccessResponse(response);
      const json = await response.json();
      const data = json.data;

      // Should have exactly one purchase for this content
      expect(data.items.length).toBe(1);
      expect(data.items[0].contentId).toBe(contentId);
      expect(data.items[0].amountPaidCents).toBe(2999);
    });

    test('should handle custom pagination', async ({ request }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases?page=1&limit=1`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      await expectSuccessResponse(response);
      const json = await response.json();
      const data = json.data;

      expect(data.items.length).toBe(1);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(1);
      expect(data.pagination.total).toBeGreaterThanOrEqual(2);
      expect(data.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    test('should return empty items for page beyond total', async ({
      request,
    }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases?page=999`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      await expectSuccessResponse(response);
      const json = await response.json();
      const data = json.data;

      expect(data.items).toEqual([]);
      expect(data.pagination.page).toBe(999);
    });

    test('should return empty list for user with no purchases', async ({
      request,
    }) => {
      const response = await request.get(`${WORKER_URLS.ecom}/purchases`, {
        headers: {
          Cookie: otherBuyerCookie,
          Origin: WORKER_URLS.ecom,
        },
      });

      await expectSuccessResponse(response);
      const json = await response.json();
      const data = json.data;

      expect(data.items).toEqual([]);
      expect(data.pagination.total).toBe(0);
    });

    test('should return 401 when not authenticated', async ({ request }) => {
      const response = await request.get(`${WORKER_URLS.ecom}/purchases`, {
        headers: {
          Origin: WORKER_URLS.ecom,
        },
      });

      expect(response.status()).toBe(401);
    });

    test('should return 400 for invalid query parameters', async ({
      request,
    }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases?status=invalid_status`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThanOrEqual(422);
    });
  });

  // ============================================================================
  // GET /purchases/:id - Single Purchase
  // ============================================================================

  test.describe('GET /purchases/:id - Single Purchase', () => {
    test('should return single purchase owned by authenticated user', async ({
      request,
    }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases/${purchaseId}`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      await expectSuccessResponse(response);
      const json = await response.json();

      // Response is double-wrapped: { data: { data: purchase } }
      // Handler returns SingleItemResponse { data: purchase }
      // createAuthenticatedHandler wraps it in { data: output }
      expect(json.data).toBeDefined();
      expect(json.data.data).toBeDefined();
      const purchase = json.data.data;

      expect(purchase.id).toBe(purchaseId);
      expect(purchase.customerId).toBe(buyer.id);
      expect(purchase.contentId).toBe(contentId);
      expect(purchase.organizationId).toBe(organizationId);
      expect(purchase.amountPaidCents).toBe(2999);
      expect(purchase.currency).toBe('usd');
      expect(purchase.status).toBe('completed');

      // Verify revenue split fields
      expect(purchase.platformFeeCents).toBeDefined();
      expect(purchase.creatorPayoutCents).toBeDefined();
      expect(
        purchase.platformFeeCents +
          purchase.organizationFeeCents +
          purchase.creatorPayoutCents
      ).toBe(2999);
    });

    test('should return 401 when not authenticated', async ({ request }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases/${purchaseId}`,
        {
          headers: {
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      expect(response.status()).toBe(401);
    });

    test('should return 403 when purchase belongs to another user', async ({
      request,
    }) => {
      // otherBuyer tries to access buyer's purchase
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases/${purchaseId}`,
        {
          headers: {
            Cookie: otherBuyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      expect(response.status()).toBe(403);
    });

    test('should return 404 when purchase does not exist', async ({
      request,
    }) => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases/${fakeId}`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      expect(response.status()).toBe(404);
    });

    test('should return 400 for invalid UUID format', async ({ request }) => {
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases/not-a-valid-uuid`,
        {
          headers: {
            Cookie: buyerCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThanOrEqual(422);
    });
  });

  // ============================================================================
  // Access Control Tests
  // ============================================================================

  test.describe('Access Control', () => {
    test('should only return purchases belonging to authenticated user', async ({
      request,
    }) => {
      // Buyer should see their 2 purchases
      const buyerResponse = await request.get(`${WORKER_URLS.ecom}/purchases`, {
        headers: {
          Cookie: buyerCookie,
          Origin: WORKER_URLS.ecom,
        },
      });

      await expectSuccessResponse(buyerResponse);
      const buyerJson = await buyerResponse.json();
      const buyerData = buyerJson.data;

      // Verify all purchases belong to buyer
      for (const purchase of buyerData.items) {
        expect(purchase.customerId).toBe(buyer.id);
      }

      // OtherBuyer should see zero purchases
      const otherResponse = await request.get(`${WORKER_URLS.ecom}/purchases`, {
        headers: {
          Cookie: otherBuyerCookie,
          Origin: WORKER_URLS.ecom,
        },
      });

      await expectSuccessResponse(otherResponse);
      const otherJson = await otherResponse.json();
      const otherData = otherJson.data;

      expect(otherData.items.length).toBe(0);
    });

    test('creator cannot access buyer purchase records', async ({
      request,
    }) => {
      // Creator tries to access buyer's purchase by ID
      const response = await request.get(
        `${WORKER_URLS.ecom}/purchases/${purchaseId}`,
        {
          headers: {
            Cookie: creatorCookie,
            Origin: WORKER_URLS.ecom,
          },
        }
      );

      // Creator is not the customer, should be forbidden
      expect(response.status()).toBe(403);
    });
  });
});
