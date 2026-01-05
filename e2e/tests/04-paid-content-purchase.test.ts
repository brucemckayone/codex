/**
 * E2E Test: Paid Content Purchase Flow
 *
 * Tests the complete paid content purchase flow including:
 * 1. Creator publishes paid content
 * 2. Buyer creates Stripe checkout session
 * 3. Stripe webhook (checkout.session.completed) triggers purchase recording
 * 4. Purchase record created with revenue split
 * 5. Content access granted to buyer
 * 6. Buyer can now access streaming URL
 *
 * Also tests edge cases:
 * - Idempotency (duplicate webhooks)
 * - Invalid webhook signatures
 * - Already purchased content (409)
 * - Free content checkout rejection
 */

import { dbHttp, schema } from '@codex/database';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { authFixture, httpClient } from '../fixtures';
import {
  expectSuccessResponse,
  unwrapApiResponse,
} from '../helpers/assertions';
import {
  createCheckoutCompletedEvent,
  sendSignedWebhook,
} from '../helpers/stripe-webhook';
import { WORKER_URLS } from '../helpers/worker-urls';

describe('Paid Content Purchase Flow', () => {
  test('should complete full paid content purchase flow', async () => {
    // This test performs many API calls (creator setup, org, media, content,
    // publish, buyer registration, checkout, webhook, DB verify, access verify)
    // ========================================================================
    // Step 1: Create creator and publish paid content
    // ========================================================================
    const creatorEmail = `creator-paid-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const creatorPassword = 'SecurePassword123!';

    const { cookie: creatorCookie } = await authFixture.registerUser({
      email: creatorEmail,
      password: creatorPassword,
      name: 'Paid Content Creator',
      role: 'creator',
    });

    // Create organization (required for paid content in Phase 1)
    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.organization,
        },
        data: {
          name: `Test Org ${Date.now()}`,
          slug: `test-org-${Date.now()}`,
          description: 'Organization for paid content',
        },
      }
    );
    await expectSuccessResponse(orgResponse, 201);
    const organization = unwrapApiResponse(await orgResponse.json());

    // Create media item
    const testCreatorId = 'e2e-test-creator';
    const testMediaId = `e2e-test-video-paid-${Date.now()}`;
    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Premium Video Media',
          description: 'Media for paid content',
          mediaType: 'video',
          r2Key: `${testCreatorId}/originals/${testMediaId}/original.mp4`,
          fileSizeBytes: 1048576,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());

    // Mark media as ready
    const readyMediaResponse = await httpClient.patch(
      `${WORKER_URLS.content}/api/media/${media.id}`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          status: 'ready',
          hlsMasterPlaylistKey: `${testCreatorId}/hls/${testMediaId}/master.m3u8`,
          thumbnailKey: `${testCreatorId}/thumbnails/${testMediaId}/thumb.jpg`,
          durationSeconds: 300,
          width: 1920,
          height: 1080,
        },
      }
    );
    await expectSuccessResponse(readyMediaResponse);

    // Create PAID content (priceCents > 0)
    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Premium Educational Course',
          slug: `premium-course-${Date.now()}`,
          description: 'This is premium paid content',
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: organization.id, // Required for paid content
          visibility: 'purchased_only',
          priceCents: 2999, // $29.99 - PAID CONTENT
          category: 'Education',
          tags: ['paid', 'premium', 'course'],
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());

    // Publish the content
    const publishResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content/${content.id}/publish`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
      }
    );
    await expectSuccessResponse(publishResponse);
    const publishedContent = unwrapApiResponse(await publishResponse.json());
    expect(publishedContent.status).toBe('published');
    expect(publishedContent.priceCents).toBe(2999);

    // ========================================================================
    // Step 2: Create buyer (customer)
    // ========================================================================
    const buyerEmail = `buyer-paid-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const buyerPassword = 'SecurePassword123!';

    const { user: buyer, cookie: buyerCookie } = await authFixture.registerUser(
      {
        email: buyerEmail,
        password: buyerPassword,
        name: 'Content Buyer',
        role: 'user',
      }
    );

    // ========================================================================
    // Step 3: Verify buyer CANNOT access before purchase
    // ========================================================================
    const beforePurchaseResponse = await httpClient.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: {
          Cookie: buyerCookie,
          Origin: WORKER_URLS.content,
        },
      }
    );

    // Should deny access (403 Forbidden or 404 Not Found)
    expect(beforePurchaseResponse.ok).toBeFalsy();
    expect(beforePurchaseResponse.status).toBeGreaterThanOrEqual(403);

    // ========================================================================
    // Step 4: Create Stripe checkout session
    // ========================================================================
    const checkoutResponse = await httpClient.post(
      `${WORKER_URLS.ecom}/checkout/create`,
      {
        headers: {
          Cookie: buyerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {
          contentId: content.id,
          successUrl: 'http://localhost:3000/purchase/success',
          cancelUrl: 'http://localhost:3000/purchase/cancel',
        },
      }
    );

    await expectSuccessResponse(checkoutResponse);
    const checkoutData = await checkoutResponse.json();
    const checkout = unwrapApiResponse(checkoutData);

    expect(checkout.sessionUrl).toBeDefined();
    expect(checkout.sessionUrl).toContain('checkout.stripe.com');
    expect(checkout.sessionId).toBeDefined();
    expect(checkout.sessionId).toMatch(/^cs_/);

    // ========================================================================
    // Step 5: Simulate Stripe webhook (checkout.session.completed)
    // ========================================================================
    const paymentIntentId = `pi_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const webhookEvent = createCheckoutCompletedEvent({
      sessionId: checkout.sessionId,
      paymentIntentId: paymentIntentId,
      customerId: buyer.id,
      contentId: content.id,
      amountCents: 2999,
      organizationId: organization.id,
    });

    const webhookResponse = await sendSignedWebhook(
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent,
      process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
    );

    expect(webhookResponse.status).toBe(200);
    const webhookResult = await webhookResponse.json();
    expect(webhookResult.received).toBe(true);

    // ========================================================================
    // Step 6: Verify purchase recorded in database
    // ========================================================================
    const purchases = await dbHttp
      .select()
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.customerId, buyer.id),
          eq(schema.purchases.contentId, content.id)
        )
      );

    expect(purchases).toHaveLength(1);
    expect(purchases[0].amountPaidCents).toBe(2999);
    expect(purchases[0].status).toBe('completed');
    expect(purchases[0].stripePaymentIntentId).toBe(paymentIntentId);

    // Verify revenue split (10% platform / 90% creator)
    expect(purchases[0].platformFeeCents).toBe(300); // 10% of 2999 = 299.9 ≈ 300
    expect(purchases[0].creatorPayoutCents).toBe(2699); // 90% of 2999

    // ========================================================================
    // Step 7: Verify access NOW granted
    // ========================================================================
    const afterPurchaseResponse = await httpClient.get(
      `${WORKER_URLS.content}/api/access/content/${content.id}/stream`,
      {
        headers: {
          Cookie: buyerCookie,
          Origin: WORKER_URLS.content,
        },
      }
    );

    await expectSuccessResponse(afterPurchaseResponse);
    const accessData = await afterPurchaseResponse.json();

    expect(accessData.data.streamingUrl).toBeDefined();
    expect(accessData.data.streamingUrl).toContain('master.m3u8');
    expect(accessData.data.expiresAt).toBeDefined();
    expect(accessData.data.contentType).toBe('video');
  }, 120000);

  test('should handle duplicate webhook gracefully (idempotency)', async () => {
    // This test performs full setup + purchase + duplicate webhook test
    // Create creator and paid content
    const creatorEmail = `creator-idem-${Date.now()}@example.com`;
    const { cookie: creatorCookie } = await authFixture.registerUser({
      email: creatorEmail,
      password: 'SecurePassword123!',
      role: 'creator',
    });

    // Create organization (required for paid content)
    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.organization,
        },
        data: {
          name: `Idem Org ${Date.now()}`,
          slug: `idem-org-${Date.now()}`,
        },
      }
    );
    const organization = unwrapApiResponse(await orgResponse.json());

    // Create and publish paid content (abbreviated)
    const testMediaId = `e2e-idem-${Date.now()}`;
    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Idempotency Test Media',
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
        Origin: WORKER_URLS.content,
      },
      data: {
        status: 'ready',
        hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
        thumbnailKey: `e2e/thumbnails/${testMediaId}/thumb.jpg`,
        durationSeconds: 300,
      },
    });

    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Idempotency Test Content',
          slug: `idem-test-${Date.now()}`,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: organization.id, // Required for paid content
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
          Origin: WORKER_URLS.content,
        },
      }
    );

    // Create buyer
    const buyerEmail = `buyer-idem-${Date.now()}@example.com`;
    const { user: buyer, cookie: buyerCookie } = await authFixture.registerUser(
      {
        email: buyerEmail,
        password: 'SecurePassword123!',
        role: 'user',
      }
    );

    // Create checkout (we just need sessionId for webhook)
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

    // Create webhook event with SAME payment intent ID
    const paymentIntentId = `pi_test_idempotency_${Date.now()}`;
    const webhookEvent = createCheckoutCompletedEvent({
      sessionId: checkout.sessionId,
      paymentIntentId: paymentIntentId, // Same ID used twice
      customerId: buyer.id,
      contentId: content.id,
      amountCents: 1999,
      organizationId: organization.id,
    });

    // Send webhook FIRST time
    const firstWebhook = await sendSignedWebhook(
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent,
      process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
    );
    expect(firstWebhook.status).toBe(200);

    // Send webhook SECOND time (same payment_intent)
    const secondWebhook = await sendSignedWebhook(
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent,
      process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
    );
    expect(secondWebhook.status).toBe(200);

    // Verify only ONE purchase record exists (idempotency)
    const purchases = await dbHttp
      .select()
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.customerId, buyer.id),
          eq(schema.purchases.contentId, content.id)
        )
      );

    expect(purchases).toHaveLength(1); // Only one purchase despite two webhooks
    expect(purchases[0].stripePaymentIntentId).toBe(paymentIntentId);
  }, 120000);

  test('should reject webhook with invalid signature', async () => {
    // Create minimal webhook event
    const webhookEvent = createCheckoutCompletedEvent({
      sessionId: 'cs_test_invalid',
      paymentIntentId: 'pi_test_invalid',
      customerId: 'user-invalid',
      contentId: 'content-invalid',
      amountCents: 999,
    });

    const rawBody = JSON.stringify(webhookEvent);

    // Send with INVALID signature
    const response = await httpClient.post(
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      {
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=1234567890,v1=invalidsignaturehex',
        },
        data: rawBody,
      }
    );

    // Should reject with 401 Unauthorized
    expect(response.status).toBe(401);
  });

  test('should return 409 when attempting to purchase already-owned content', async () => {
    // This test performs full setup + purchase + second checkout attempt
    // Setup: Create and publish paid content
    const { cookie: creatorCookie } = await authFixture.registerUser({
      email: `creator-409-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      role: 'creator',
    });

    // Create organization (required for paid content)
    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.organization,
        },
        data: {
          name: `409 Org ${Date.now()}`,
          slug: `org-409-${Date.now()}`,
        },
      }
    );
    const organization = unwrapApiResponse(await orgResponse.json());

    const testMediaId = `e2e-409-${Date.now()}`;
    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: '409 Test Media',
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
        Origin: WORKER_URLS.content,
      },
      data: {
        status: 'ready',
        hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
        thumbnailKey: `e2e/thumbnails/${testMediaId}/thumb.jpg`,
        durationSeconds: 300,
      },
    });

    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: '409 Test Content',
          slug: `test-409-${Date.now()}`,
          contentType: 'video',
          mediaItemId: media.id,
          organizationId: organization.id, // Required for paid content
          visibility: 'purchased_only',
          priceCents: 999,
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
          Origin: WORKER_URLS.content,
        },
      }
    );

    // Create buyer
    const { user: buyer, cookie: buyerCookie } = await authFixture.registerUser(
      {
        email: `buyer-409-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        role: 'user',
      }
    );

    // First checkout - should succeed
    const firstCheckout = await httpClient.post(
      `${WORKER_URLS.ecom}/checkout/create`,
      {
        headers: { Cookie: buyerCookie, 'Content-Type': 'application/json' },
        data: {
          contentId: content.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
      }
    );
    await expectSuccessResponse(firstCheckout);
    const checkout = unwrapApiResponse(await firstCheckout.json());

    // Complete purchase via webhook
    const webhookEvent = createCheckoutCompletedEvent({
      sessionId: checkout.sessionId,
      paymentIntentId: `pi_test_first_${Date.now()}`,
      customerId: buyer.id,
      contentId: content.id,
      amountCents: 999,
      organizationId: organization.id,
    });

    await sendSignedWebhook(
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent,
      process.env.STRIPE_WEBHOOK_SECRET_BOOKING as string
    );

    // Try to create ANOTHER checkout session for same content
    const secondCheckout = await httpClient.post(
      `${WORKER_URLS.ecom}/checkout/create`,
      {
        headers: { Cookie: buyerCookie, 'Content-Type': 'application/json' },
        data: {
          contentId: content.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
      }
    );

    // Should return 409 Conflict (already purchased)
    expect(secondCheckout.status).toBe(409);
  }, 120000);

  test('should reject checkout creation for free content', async () => {
    // Create creator and FREE content
    const { cookie: creatorCookie } = await authFixture.registerUser({
      email: `creator-free-reject-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      role: 'creator',
    });

    // Create and publish FREE content (priceCents = 0)
    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: 'Free Content (No Checkout)',
          slug: `free-no-checkout-${Date.now()}`,
          contentType: 'written',
          contentBody: 'This is free content',
          visibility: 'public',
          priceCents: 0, // FREE
        },
      }
    );
    const freeContent = unwrapApiResponse(await contentResponse.json());

    await httpClient.post(
      `${WORKER_URLS.content}/api/content/${freeContent.id}/publish`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
      }
    );

    // Create buyer
    const { cookie: buyerCookie } = await authFixture.registerUser({
      email: `buyer-free-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      role: 'user',
    });

    // Try to create checkout for FREE content
    const checkoutResponse = await httpClient.post(
      `${WORKER_URLS.ecom}/checkout/create`,
      {
        headers: { Cookie: buyerCookie, 'Content-Type': 'application/json' },
        data: {
          contentId: freeContent.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
      }
    );

    // Should reject (400 Bad Request or 422 Unprocessable Entity)
    expect(checkoutResponse.ok).toBeFalsy();
    expect(checkoutResponse.status).toBeGreaterThanOrEqual(400);
    expect(checkoutResponse.status).toBeLessThanOrEqual(422);
  });
});
