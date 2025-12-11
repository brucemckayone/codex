/**
 * PurchaseService Integration Tests
 *
 * Tests for purchase lifecycle management including:
 * - Checkout session creation
 * - Purchase completion from webhooks (idempotent)
 * - Purchase verification for access control
 * - Purchase history queries
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 * - No cleanup needed - fresh database for this file
 *
 * Stripe Integration:
 * - Mocks Stripe client to avoid real API calls
 * - Tests business logic, not Stripe SDK
 */

import { ContentService, MediaItemService } from '@codex/content';
import { organizations } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  withNeonTestBranch,
} from '@codex/test-utils';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AlreadyPurchasedError,
  ContentNotPurchasableError,
  ForbiddenError,
  PurchaseNotFoundError,
} from '../errors';
import { PurchaseService } from '../services/purchase-service';

// Enable ephemeral Neon branch for this test file
withNeonTestBranch();

describe('PurchaseService Integration', () => {
  let db: Database;
  let purchaseService: PurchaseService;
  let contentService: ContentService;
  let mediaService: MediaItemService;
  let mockStripe: Stripe;
  let userId: string;
  let otherUserId: string;
  let organizationId: string;

  // Helper to create mock Stripe checkout session
  function createMockCheckoutSession(
    sessionId: string,
    paymentIntentId: string
  ): Stripe.Checkout.Session {
    return {
      id: sessionId,
      object: 'checkout.session',
      url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      payment_intent: paymentIntentId,
      amount_total: 2999,
      currency: 'usd',
      metadata: {},
      status: 'complete',
    } as Stripe.Checkout.Session;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    const config = { db, environment: 'test' };

    contentService = new ContentService(config);
    mediaService = new MediaItemService(config);

    // Create mock Stripe client
    mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn(),
        },
      },
      paymentIntents: {
        retrieve: vi.fn(),
      },
    } as unknown as Stripe;

    purchaseService = new PurchaseService(config, mockStripe);

    // Seed test users
    const userIds = await seedTestUsers(db, 2);
    [userId, otherUserId] = userIds;

    // Create test organization
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Test Organization',
        slug: createUniqueSlug('test-org'),
        ownerId: userId,
      })
      .returning();

    if (!org) {
      throw new Error('Failed to create test organization');
    }
    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('createCheckoutSession', () => {
    it('creates checkout session for valid paid content', async () => {
      // Create media and content
      const media = await mediaService.create(
        {
          title: 'Paid Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/paid-video.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/paid-video/master.m3u8',
          thumbnailKey: 'thumbnails/paid-video.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Premium Tutorial',
          slug: createUniqueSlug('premium-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 2999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      // Mock Stripe response
      const mockSession = createMockCheckoutSession(
        'cs_test_123',
        'pi_test_123'
      );
      vi.mocked(mockStripe.checkout.sessions.create).mockResolvedValue(
        mockSession
      );

      // Create checkout session
      const result = await purchaseService.createCheckoutSession(
        {
          contentId: content.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
        otherUserId // Customer purchasing
      );

      expect(result.sessionUrl).toBe(mockSession.url);
      expect(result.sessionId).toBe(mockSession.id);

      // Verify Stripe was called with correct params
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          success_url: 'http://localhost:3000/success',
          cancel_url: 'http://localhost:3000/cancel',
          line_items: expect.arrayContaining([
            expect.objectContaining({
              price_data: expect.objectContaining({
                unit_amount: 2999,
                currency: 'usd',
              }),
              quantity: 1,
            }),
          ]),
          metadata: expect.objectContaining({
            contentId: content.id,
            customerId: otherUserId,
          }),
        })
      );
    });

    it('throws ContentNotPurchasableError for free content', async () => {
      // Create free content
      const media = await mediaService.create(
        {
          title: 'Free Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/free-video-2.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/free-video-2/master.m3u8',
          thumbnailKey: 'thumbnails/free-video-2.jpg',
          durationSeconds: 60,
        },
        userId
      );

      const freeContent = await contentService.create(
        {
          organizationId,
          title: 'Free Tutorial',
          slug: createUniqueSlug('free-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          priceCents: 0, // Free!
        },
        userId
      );

      await contentService.publish(freeContent.id, userId);

      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: freeContent.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          otherUserId
        )
      ).rejects.toThrow(ContentNotPurchasableError);
    });

    it('throws ContentNotPurchasableError for unpublished content', async () => {
      // Create draft content
      const media = await mediaService.create(
        {
          title: 'Draft Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/draft-video.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/draft-video/master.m3u8',
          thumbnailKey: 'thumbnails/draft-video.jpg',
          durationSeconds: 60,
        },
        userId
      );

      const draftContent = await contentService.create(
        {
          organizationId,
          title: 'Draft Tutorial',
          slug: createUniqueSlug('draft-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1999,
        },
        userId
      );
      // Note: Not published!

      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: draftContent.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          otherUserId
        )
      ).rejects.toThrow(ContentNotPurchasableError);
    });

    it('throws AlreadyPurchasedError if customer already purchased', async () => {
      // Create content
      const media = await mediaService.create(
        {
          title: 'Already Owned Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/already-owned.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/already-owned/master.m3u8',
          thumbnailKey: 'thumbnails/already-owned.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Already Owned Tutorial',
          slug: createUniqueSlug('already-owned-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 4999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      // Complete a purchase first
      await purchaseService.completePurchase(
        `pi_already_purchased_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 4999,
          currency: 'usd',
        }
      );

      // Try to create another checkout for same content
      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: content.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          otherUserId
        )
      ).rejects.toThrow(AlreadyPurchasedError);
    });
  });

  describe('completePurchase', () => {
    it('creates purchase record with correct revenue split', async () => {
      // Create content
      const media = await mediaService.create(
        {
          title: 'Revenue Split Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/revenue-split.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/revenue-split/master.m3u8',
          thumbnailKey: 'thumbnails/revenue-split.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Revenue Split Tutorial',
          slug: createUniqueSlug('revenue-split-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 2999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_revenue_${Date.now()}`;

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 2999,
        currency: 'usd',
      });

      expect(purchase.customerId).toBe(otherUserId);
      expect(purchase.contentId).toBe(content.id);
      expect(purchase.amountPaidCents).toBe(2999);
      expect(purchase.status).toBe('completed');
      expect(purchase.stripePaymentIntentId).toBe(paymentIntentId);

      // Verify revenue split (default 10% platform, 0% org, 90% creator)
      // Platform: ceil(2999 * 1000 / 10000) = ceil(299.9) = 300
      expect(purchase.platformFeeCents).toBe(300);
      expect(purchase.organizationFeeCents).toBe(0);
      expect(purchase.creatorPayoutCents).toBe(2699);

      // Verify sum
      expect(
        purchase.platformFeeCents +
          purchase.organizationFeeCents +
          purchase.creatorPayoutCents
      ).toBe(purchase.amountPaidCents);
    });

    it('returns existing purchase for same paymentIntentId (idempotent)', async () => {
      // Create content
      const media = await mediaService.create(
        {
          title: 'Idempotent Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/idempotent.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/idempotent/master.m3u8',
          thumbnailKey: 'thumbnails/idempotent.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Idempotent Tutorial',
          slug: createUniqueSlug('idempotent-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_idempotent_${Date.now()}`;

      // First call creates purchase
      const purchase1 = await purchaseService.completePurchase(
        paymentIntentId,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 1999,
          currency: 'usd',
        }
      );

      // Second call with same paymentIntentId returns existing
      const purchase2 = await purchaseService.completePurchase(
        paymentIntentId,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 1999,
          currency: 'usd',
        }
      );

      expect(purchase2.id).toBe(purchase1.id);
      expect(purchase2.stripePaymentIntentId).toBe(paymentIntentId);
    });

    it('creates contentAccess record atomically', async () => {
      // Create content
      const media = await mediaService.create(
        {
          title: 'Access Grant Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/access-grant.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/access-grant/master.m3u8',
          thumbnailKey: 'thumbnails/access-grant.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Access Grant Tutorial',
          slug: createUniqueSlug('access-grant-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_access_${Date.now()}`;

      await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 999,
        currency: 'usd',
      });

      // Verify purchase verification now returns true
      const hasPurchase = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(hasPurchase).toBe(true);
    });
  });

  describe('verifyPurchase', () => {
    it('returns true for completed purchase', async () => {
      // Create content and purchase
      const media = await mediaService.create(
        {
          title: 'Verify Purchase Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/verify-purchase.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/verify-purchase/master.m3u8',
          thumbnailKey: 'thumbnails/verify-purchase.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Verify Purchase Tutorial',
          slug: createUniqueSlug('verify-purchase-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1499,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      // Complete purchase
      await purchaseService.completePurchase(`pi_verify_${Date.now()}`, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 1499,
        currency: 'usd',
      });

      const result = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(result).toBe(true);
    });

    it('returns false for no purchase', async () => {
      // Create content but no purchase
      const media = await mediaService.create(
        {
          title: 'No Purchase Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/no-purchase.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/no-purchase/master.m3u8',
          thumbnailKey: 'thumbnails/no-purchase.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'No Purchase Tutorial',
          slug: createUniqueSlug('no-purchase-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 2499,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      // No purchase made
      const result = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(result).toBe(false);
    });

    it('returns false for different customer purchase', async () => {
      // Create content
      const media = await mediaService.create(
        {
          title: 'Other Customer Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/other-customer.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/other-customer/master.m3u8',
          thumbnailKey: 'thumbnails/other-customer.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Other Customer Tutorial',
          slug: createUniqueSlug('other-customer-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      // userId purchases (creator buying their own content for test purposes)
      await purchaseService.completePurchase(
        `pi_other_customer_${Date.now()}`,
        {
          customerId: userId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 1999,
          currency: 'usd',
        }
      );

      // Different customer checks - should be false
      const result = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(result).toBe(false);
    });
  });

  describe('getPurchaseHistory', () => {
    it('returns paginated purchase history', async () => {
      // Create multiple purchases
      const purchases = [];
      for (let i = 0; i < 3; i++) {
        const media = await mediaService.create(
          {
            title: `History Video ${i}`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: `originals/history-${i}.mp4`,
            fileSizeBytes: 1024 * 1024,
          },
          userId
        );

        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/history-${i}/master.m3u8`,
            thumbnailKey: `thumbnails/history-${i}.jpg`,
            durationSeconds: 120,
          },
          userId
        );

        const content = await contentService.create(
          {
            organizationId,
            title: `History Tutorial ${i}`,
            slug: createUniqueSlug(`history-tutorial-${i}`),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            priceCents: 999 + i * 100,
          },
          userId
        );

        await contentService.publish(content.id, userId);

        const purchase = await purchaseService.completePurchase(
          `pi_history_${i}_${Date.now()}`,
          {
            customerId: otherUserId,
            contentId: content.id,
            organizationId,
            amountPaidCents: 999 + i * 100,
            currency: 'usd',
          }
        );

        purchases.push(purchase);
      }

      // Get history with pagination
      const history = await purchaseService.getPurchaseHistory(otherUserId, {
        page: 1,
        limit: 2,
      });

      expect(history.items.length).toBeLessThanOrEqual(2);
      expect(history.page).toBe(1);
      expect(history.limit).toBe(2);
      expect(history.total).toBeGreaterThanOrEqual(3);
    });

    it('filters by status', async () => {
      // Get only completed purchases (all our test purchases are completed)
      const history = await purchaseService.getPurchaseHistory(otherUserId, {
        page: 1,
        limit: 100,
        status: 'completed',
      });

      expect(history.items.every((p) => p.status === 'completed')).toBe(true);
    });

    it('scoped to customerId only', async () => {
      // userId's history should not include otherUserId's purchases
      const creatorHistory = await purchaseService.getPurchaseHistory(userId, {
        page: 1,
        limit: 100,
      });

      // Only purchases where userId is the customer
      expect(creatorHistory.items.every((p) => p.customerId === userId)).toBe(
        true
      );
    });
  });

  describe('getPurchase', () => {
    it('returns purchase for owner', async () => {
      // Create content and purchase
      const media = await mediaService.create(
        {
          title: 'Get Purchase Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/get-purchase.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/get-purchase/master.m3u8',
          thumbnailKey: 'thumbnails/get-purchase.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Get Purchase Tutorial',
          slug: createUniqueSlug('get-purchase-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const purchase = await purchaseService.completePurchase(
        `pi_get_purchase_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 1999,
          currency: 'usd',
        }
      );

      // Owner can get their purchase
      const result = await purchaseService.getPurchase(
        purchase.id,
        otherUserId
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe(purchase.id);
    });

    it('throws ForbiddenError for non-owner', async () => {
      // Create content and purchase by otherUserId
      const media = await mediaService.create(
        {
          title: 'Forbidden Purchase Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/forbidden-purchase.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/forbidden-purchase/master.m3u8',
          thumbnailKey: 'thumbnails/forbidden-purchase.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Forbidden Purchase Tutorial',
          slug: createUniqueSlug('forbidden-purchase-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 2999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const purchase = await purchaseService.completePurchase(
        `pi_forbidden_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 2999,
          currency: 'usd',
        }
      );

      // Different user trying to access
      await expect(
        purchaseService.getPurchase(purchase.id, userId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws PurchaseNotFoundError for missing ID', async () => {
      await expect(
        purchaseService.getPurchase(
          '00000000-0000-0000-0000-000000000000',
          otherUserId
        )
      ).rejects.toThrow(PurchaseNotFoundError);
    });
  });
});
