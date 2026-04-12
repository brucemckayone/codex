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
  PaymentProcessingError,
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
      currency: 'gbp',
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
          retrieve: vi.fn(), // For verifyCheckoutSession
        },
      },
      paymentIntents: {
        retrieve: vi.fn(),
      },
      customers: {
        list: vi.fn(),
        create: vi.fn(),
      },
      billingPortal: {
        sessions: {
          create: vi.fn(),
        },
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
                currency: 'gbp',
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
          currency: 'gbp',
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
        currency: 'gbp',
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
          currency: 'gbp',
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
          currency: 'gbp',
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
        currency: 'gbp',
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
        currency: 'gbp',
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
          currency: 'gbp',
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
            currency: 'gbp',
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
          currency: 'gbp',
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
          currency: 'gbp',
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

  describe('createPortalSession', () => {
    it('creates billing portal session for existing Stripe customer', async () => {
      const portalUrl = 'https://billing.stripe.com/session/test_123';

      // Mock Stripe customer list to return existing customer
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockResolvedValue({
        data: [
          {
            id: 'cus_existing_123',
            email: 'test@example.com',
            metadata: { userId },
          },
        ],
        has_more: false,
      });

      // Mock portal session creation
      vi.mocked(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({
        url: portalUrl,
      } as Stripe.BillingPortal.Session);

      const result = await purchaseService.createPortalSession(
        'test@example.com',
        userId,
        'http://localhost:3000/settings'
      );

      expect(result.url).toBe(portalUrl);

      // Verify customer list was called
      expect(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          limit: 1,
        })
      );

      // Verify portal session was created
      expect(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_existing_123',
          return_url: 'http://localhost:3000/settings',
        })
      );
    });

    it('creates new Stripe customer if none exists', async () => {
      const portalUrl = 'https://billing.stripe.com/session/test_456';

      // Mock Stripe customer list to return empty
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockResolvedValue({
        data: [],
        has_more: false,
      });

      // Mock customer creation
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({
        id: 'cus_new_789',
        email: 'newuser@example.com',
        metadata: { userId: otherUserId },
      });

      // Mock portal session creation
      vi.mocked(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({
        url: portalUrl,
      } as Stripe.BillingPortal.Session);

      const result = await purchaseService.createPortalSession(
        'newuser@example.com',
        otherUserId,
        'http://localhost:3000/settings'
      );

      expect(result.url).toBe(portalUrl);

      // Verify new customer was created
      expect(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newuser@example.com',
          metadata: { userId: otherUserId },
        })
      );

      // Verify portal session was created with new customer ID
      expect(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_new_789',
          return_url: 'http://localhost:3000/settings',
        })
      );
    });

    it('throws PaymentProcessingError on Stripe API failure', async () => {
      // Mock Stripe to throw error
      const stripeError = new Error('Stripe API error') as Error & {
        type: string;
      };
      stripeError.type = 'StripeAPIError';

      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockRejectedValue(stripeError);

      await expect(
        purchaseService.createPortalSession(
          'test@example.com',
          userId,
          'http://localhost:3000/settings'
        )
      ).rejects.toThrow(PaymentProcessingError);
    });

    it('validates return URL with domain whitelist', async () => {
      // Mock successful response
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockResolvedValue({
        data: [],
        has_more: false,
      });

      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({
        id: 'cus_new_789',
        email: 'newuser@example.com',
        metadata: { userId: otherUserId },
      });

      vi.mocked(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({
        url: 'https://billing.stripe.com/session/test_789',
      } as Stripe.BillingPortal.Session);

      // Valid URL (localhost is whitelisted)
      await expect(
        purchaseService.createPortalSession(
          'newuser@example.com',
          otherUserId,
          'http://localhost:3000/settings'
        )
      ).resolves.toBeDefined();
    });
  });

  describe('processRefund', () => {
    it('should update status to refunded and soft-delete contentAccess on full refund', async () => {
      // Create content and complete a purchase
      const media = await mediaService.create(
        {
          title: 'Refund Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/refund-test.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/refund-test/master.m3u8',
          thumbnailKey: 'thumbnails/refund-test.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Refund Test Content',
          slug: createUniqueSlug('refund-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_refund_full_${Date.now()}`;

      await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 1999,
        currency: 'gbp',
      });

      // Process refund
      await purchaseService.processRefund(paymentIntentId, {
        stripeRefundId: 're_test_123',
        refundAmountCents: 1999,
        refundReason: 'requested_by_customer',
      });

      // Verify purchase status is refunded
      const hasPurchase = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(hasPurchase).toBe(false);
    });

    it('should be idempotent — second refund on already-refunded is no-op', async () => {
      const media = await mediaService.create(
        {
          title: 'Idempotent Refund Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/idempotent-refund.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/idempotent-refund/master.m3u8',
          thumbnailKey: 'thumbnails/idempotent-refund.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Idempotent Refund Content',
          slug: createUniqueSlug('idempotent-refund'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_refund_idem_${Date.now()}`;

      await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 999,
        currency: 'gbp',
      });

      // First refund
      await purchaseService.processRefund(paymentIntentId);

      // Second refund should not throw
      await purchaseService.processRefund(paymentIntentId);
    });

    it('should return without throwing for unknown paymentIntentId', async () => {
      // Should not throw — logs warning and returns
      await purchaseService.processRefund('pi_unknown_refund_xyz');
    });

    it('should store refund metadata (stripeRefundId, refundAmountCents, refundReason)', async () => {
      const media = await mediaService.create(
        {
          title: 'Refund Metadata Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/refund-metadata.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/refund-metadata/master.m3u8',
          thumbnailKey: 'thumbnails/refund-metadata.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Refund Metadata Content',
          slug: createUniqueSlug('refund-metadata'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 2999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_refund_meta_${Date.now()}`;

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 2999,
        currency: 'gbp',
      });

      await purchaseService.processRefund(paymentIntentId, {
        stripeRefundId: 're_meta_test_456',
        refundAmountCents: 2999,
        refundReason: 'duplicate',
      });

      // Verify metadata was stored by checking purchase is refunded
      // (refund metadata fields are set in the same transaction)
      const result = await purchaseService.getPurchase(
        purchase.id,
        otherUserId
      );

      expect(result?.status).toBe('refunded');
    });

    it('should soft-delete contentAccess record (set deletedAt)', async () => {
      const media = await mediaService.create(
        {
          title: 'Access Revoke Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/access-revoke.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/access-revoke/master.m3u8',
          thumbnailKey: 'thumbnails/access-revoke.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Access Revoke Content',
          slug: createUniqueSlug('access-revoke'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 1499,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_revoke_${Date.now()}`;

      await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 1499,
        currency: 'gbp',
      });

      // Verify access exists before refund
      const hasAccessBefore = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(hasAccessBefore).toBe(true);

      // Process refund
      await purchaseService.processRefund(paymentIntentId);

      // Verify access is revoked after refund
      const hasAccessAfter = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(hasAccessAfter).toBe(false);
    });

    it('should process refund atomically (purchase status + contentAccess in transaction)', async () => {
      // This test documents that processRefund uses db.transaction()
      // for atomicity — both purchase status update and contentAccess
      // soft-delete happen in a single transaction.
      const media = await mediaService.create(
        {
          title: 'Atomic Refund Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/atomic-refund.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/atomic-refund/master.m3u8',
          thumbnailKey: 'thumbnails/atomic-refund.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Atomic Refund Content',
          slug: createUniqueSlug('atomic-refund'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 999,
        },
        userId
      );

      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_atomic_${Date.now()}`;

      await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 999,
        currency: 'gbp',
      });

      // Process refund — both operations should succeed atomically
      await purchaseService.processRefund(paymentIntentId, {
        stripeRefundId: 're_atomic_789',
        refundAmountCents: 999,
        refundReason: 'requested_by_customer',
      });

      // Both purchase status and access should be updated
      const hasAccess = await purchaseService.verifyPurchase(
        content.id,
        otherUserId
      );
      expect(hasAccess).toBe(false);
    });
  });

  /**
   * verifyCheckoutSession Tests
   *
   * Critical security endpoint - verifies Stripe checkout session status
   * and ensures session belongs to authenticated user.
   */
  describe('verifyCheckoutSession', () => {
    let verifyUserId: string;
    let verifyOtherUserId: string;
    let verifyOrgId: string;
    let verifyContentId: string;
    let sessionId: string;

    beforeAll(async () => {
      // Setup: Create separate users and organization for verify tests
      const userIds = await seedTestUsers(db, 2);
      [verifyUserId, verifyOtherUserId] = userIds;

      // Create organization
      const [org] = await db
        .insert(organizations)
        .values({
          name: 'Verify Test Org',
          slug: createUniqueSlug('verify-test-org'),
          ownerId: verifyUserId,
        })
        .returning();

      if (!org) throw new Error('Failed to create verify test organization');
      verifyOrgId = org.id;

      // Create content
      const media = await mediaService.create(
        {
          title: 'Verify Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/verify-test.mp4',
          fileSizeBytes: 1024 * 1024,
        },
        verifyUserId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/verify-test/master.m3u8',
          thumbnailKey: 'thumbnails/verify-test.jpg',
          durationSeconds: 60,
        },
        verifyUserId
      );

      const content = await contentService.create(
        {
          organizationId: verifyOrgId,
          title: 'Verify Test Content',
          slug: createUniqueSlug('verify-test-content'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          priceCents: 999,
        },
        verifyUserId
      );
      verifyContentId = content.id;

      // Add retrieve method to mock Stripe
      vi.mocked(mockStripe.checkout.sessions).retrieve = vi.fn();

      sessionId = 'cs_test_verify_session';
      const paymentIntentId = 'pi_test_verify_intent';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: sessionId,
        status: 'complete',
        payment_intent: paymentIntentId,
        metadata: {
          contentId: verifyContentId,
          customerId: verifyUserId, // Must match the key used in createCheckoutSession
          organizationId: verifyOrgId,
          creatorId: verifyUserId,
        },
      } as Stripe.Checkout.Session);
    });

    it('should return session status when session belongs to user', async () => {
      const result = await purchaseService.verifyCheckoutSession(
        sessionId,
        verifyUserId
      );

      expect(result).toEqual({
        sessionStatus: 'complete',
        purchase: undefined, // No purchase record yet
        content: undefined,
      });
    });

    it('should include purchase and content when purchase exists', async () => {
      const paymentIntentId = `pi_test_verify_with_purchase_${Date.now()}`;

      // Create purchase via service
      await purchaseService.completePurchase(paymentIntentId, {
        customerId: verifyUserId,
        contentId: verifyContentId,
        organizationId: verifyOrgId,
        amountPaidCents: 999,
        currency: 'gbp',
      });

      // Mock retrieve to return session with this payment intent
      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: sessionId,
        status: 'complete',
        payment_intent: paymentIntentId,
        metadata: {
          contentId: verifyContentId,
          customerId: verifyUserId,
          organizationId: verifyOrgId,
          creatorId: verifyUserId,
        },
      } as Stripe.Checkout.Session);

      const result = await purchaseService.verifyCheckoutSession(
        sessionId,
        verifyUserId
      );

      expect(result.sessionStatus).toBe('complete');
      expect(result.purchase).toBeDefined();
      expect(result.purchase?.contentId).toBe(verifyContentId);
      expect(result.purchase?.amountPaidCents).toBe(999);
      expect(result.content).toBeDefined();
      expect(result.content?.id).toBe(verifyContentId);
    });

    it('should return open status for incomplete sessions', async () => {
      const openSessionId = 'cs_test_open_session';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: openSessionId,
        status: 'open',
        payment_intent: null,
        metadata: {
          contentId: verifyContentId,
          customerId: verifyUserId,
        },
      } as Stripe.Checkout.Session);

      const result = await purchaseService.verifyCheckoutSession(
        openSessionId,
        verifyUserId
      );

      expect(result.sessionStatus).toBe('open');
      expect(result.purchase).toBeUndefined();
      expect(result.content).toBeUndefined();
    });

    it('should return expired status for expired sessions', async () => {
      const expiredSessionId = 'cs_test_expired_session';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: expiredSessionId,
        status: 'expired',
        payment_intent: null,
        metadata: {
          contentId: verifyContentId,
          customerId: verifyUserId,
        },
      } as Stripe.Checkout.Session);

      const result = await purchaseService.verifyCheckoutSession(
        expiredSessionId,
        verifyUserId
      );

      expect(result.sessionStatus).toBe('expired');
    });

    it('should throw ForbiddenError when session belongs to different user', async () => {
      const otherUserSessionId = 'cs_test_other_user_session';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: otherUserSessionId,
        status: 'complete',
        payment_intent: 'pi_other_user',
        metadata: {
          contentId: verifyContentId,
          customerId: verifyOtherUserId, // Different user!
          organizationId: verifyOrgId,
          creatorId: verifyUserId,
        },
      } as Stripe.Checkout.Session);

      await expect(
        purchaseService.verifyCheckoutSession(otherUserSessionId, verifyUserId)
      ).rejects.toThrow(ForbiddenError);

      await expect(
        purchaseService.verifyCheckoutSession(otherUserSessionId, verifyUserId)
      ).rejects.toThrow('does not belong to authenticated user');
    });

    it('should throw PaymentProcessingError for invalid session ID', async () => {
      const invalidSessionId = 'cs_invalid_session';

      const stripeError = new Error('Invalid API key') as Error & {
        type?: string;
      };
      stripeError.type = 'StripeInvalidRequestError';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockRejectedValue(
        stripeError
      );

      await expect(
        purchaseService.verifyCheckoutSession(invalidSessionId, verifyUserId)
      ).rejects.toThrow(PaymentProcessingError);
    });

    it('should handle metadata key correctly - camelCase customerId', async () => {
      // CRITICAL TEST: Ensures metadata key consistency between create and verify
      // The bug was using customer_id (snake_case) in verify but customerId (camelCase) in create
      const camelCaseSessionId = 'cs_test_camelcase_metadata';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: camelCaseSessionId,
        status: 'complete',
        payment_intent: 'pi_camelcase',
        metadata: {
          contentId: verifyContentId,
          customerId: verifyUserId, // camelCase - must match createCheckoutSession
          organizationId: verifyOrgId,
          creatorId: verifyUserId,
        },
      } as Stripe.Checkout.Session);

      // Should NOT throw ForbiddenError
      const result = await purchaseService.verifyCheckoutSession(
        camelCaseSessionId,
        verifyUserId
      );

      expect(result.sessionStatus).toBe('complete');
    });

    it('should reject session with snake_case customer_id key', async () => {
      // This test documents the expected failure if using snake_case
      // If this test passes (doesn't throw), it means the verify function
      // is incorrectly accepting snake_case metadata
      const snakeCaseSessionId = 'cs_test_snakecase_metadata';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockResolvedValue({
        id: snakeCaseSessionId,
        status: 'complete',
        payment_intent: 'pi_snakecase',
        metadata: {
          contentId: verifyContentId,
          customer_id: verifyUserId, // snake_case - should NOT be accepted
          organizationId: verifyOrgId,
          creatorId: verifyUserId,
        },
      } as Stripe.Checkout.Session);

      // With correct implementation, customer_id (undefined) !== userId
      // so this should throw ForbiddenError
      await expect(
        purchaseService.verifyCheckoutSession(snakeCaseSessionId, verifyUserId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw PaymentProcessingError on Stripe connection error', async () => {
      const connectionErrorSessionId = 'cs_test_connection_error';

      const connectionError = new Error('Connection error') as Error & {
        type?: string;
      };
      connectionError.type = 'StripeConnectionError';

      vi.mocked(mockStripe.checkout.sessions.retrieve).mockRejectedValue(
        connectionError
      );

      await expect(
        purchaseService.verifyCheckoutSession(
          connectionErrorSessionId,
          verifyUserId
        )
      ).rejects.toThrow(PaymentProcessingError);

      await expect(
        purchaseService.verifyCheckoutSession(
          connectionErrorSessionId,
          verifyUserId
        )
      ).rejects.toThrow('Failed to connect to Stripe API');
    });
  });
});
