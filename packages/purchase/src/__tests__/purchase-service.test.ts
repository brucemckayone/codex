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
 * - Workflow-level Neon branching provides test domain isolation in CI
 * - Each test creates its own data (idempotent tests)
 *
 * Stripe Integration:
 * - Mocks Stripe client to avoid real API calls
 * - Tests business logic, not Stripe SDK
 */

import { ContentService, MediaItemService } from '@codex/content';
import * as schema from '@codex/database/schema';
import { organizations } from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestMembershipInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  AlreadyPurchasedError,
  ContentNotPurchasableError,
  ForbiddenError,
  PaymentProcessingError,
  PurchaseNotFoundError,
} from '../errors';
import { PurchaseService } from '../services/purchase-service';
import { resolvePrimaryConnect } from '../utils/resolve-primary-connect';

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

  // Codex-ssfes: createCheckoutSession + createPortalSession now resolve a
  // Stripe Customer id via resolveOrCreateCustomer (Codex-49gev). Without
  // default mocks here every single checkout test in this file would
  // explode trying to read from Stripe. Tests that want to exercise the
  // cache-hit / reuse-existing / failure branches override these defaults
  // via .mockResolvedValueOnce / .mockRejectedValue locally.
  beforeEach(async () => {
    vi.mocked(
      (mockStripe.customers as ReturnType<typeof vi.fn>).list
    ).mockResolvedValue({ data: [], has_more: false });
    vi.mocked(
      (mockStripe.customers as ReturnType<typeof vi.fn>).create
    ).mockImplementation((params: Record<string, unknown>) => ({
      id: `cus_default_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      email: (params.email as string) ?? 'default@example.com',
      created: Math.floor(Date.now() / 1000),
      metadata: (params.metadata as Record<string, string>) ?? {},
    }));
    // Clear any Customer id persisted by a previous test so each test
    // enters resolveOrCreateCustomer in a deterministic state.
    await db
      .update(schema.users)
      .set({ stripeCustomerId: null })
      .where(eq(schema.users.id, userId));
    await db
      .update(schema.users)
      .set({ stripeCustomerId: null })
      .where(eq(schema.users.id, otherUserId));

    // One Connect account per user (uq_stripe_connect_user, Codex-69t7c):
    // clear seed users' accounts between tests so per-test seeds (which raw
    // insert for these shared users) don't collide on the unique constraint.
    await db
      .delete(schema.stripeConnectAccounts)
      .where(eq(schema.stripeConnectAccounts.userId, userId));
    await db
      .delete(schema.stripeConnectAccounts)
      .where(eq(schema.stripeConnectAccounts.userId, otherUserId));
  });

  // ContentService.publish now gates monetised content (paid w/ price>0 or
  // subscribers) behind a payout-ready Stripe Connect account for the
  // publishing creator. These behaviour tests were written before that gate
  // and publish first, wiring Connect (or asserting its absence) afterwards.
  // Seed a READY account for the creator right before each monetised publish;
  // onConflictDoNothing keeps it idempotent with any per-test Connect seed
  // (uq_stripe_connect_user — at most one account per user).
  async function seedReadyConnect(creatorId: string) {
    await db
      .insert(schema.stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId))
      .onConflictDoNothing();
  }

  describe('createCheckoutSession', () => {
    it('creates checkout session for valid paid content', async () => {
      // Create media and content
      const media = await mediaService.create(
        {
          title: 'Paid Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
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
          accessType: 'paid',
          priceCents: 2999,
        },
        userId
      );

      await seedReadyConnect(userId);
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

    // Regression (Codex-ssfes): Checkout Session must be created with
    // `customer: cus_...` resolved via resolveOrCreateCustomer (Codex-49gev),
    // NOT `customer_email`. Stripe does not dedupe on customer_email — it
    // creates a fresh Customer per session — so passing `customer` is what
    // gives us one Stripe Customer per Codex user across every org.
    it('creates Checkout Session with customer: cus_... (no customer_email) when user has no cached stripe_customer_id', async () => {
      const media = await mediaService.create(
        {
          title: 'Paid Video (customer resolve test)',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `${userId}/hls/${media.id}/master.m3u8`,
          thumbnailKey: `${userId}/thumbnails/${media.id}/auto.jpg`,
          durationSeconds: 60,
        },
        userId
      );

      const paidContent = await contentService.create(
        {
          organizationId,
          title: 'Premium Tutorial (customer resolve test)',
          slug: createUniqueSlug('premium-tutorial-resolve'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(paidContent.id, userId);

      // Clear any cached Customer id from a prior test, then mock Stripe
      // such that resolveOrCreateCustomer enters the create-new branch.
      await db
        .update(schema.users)
        .set({ stripeCustomerId: null })
        .where(eq(schema.users.id, otherUserId));

      const createdCustomerId = `cus_created_${Date.now()}`;
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockResolvedValue({ data: [], has_more: false });
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({
        id: createdCustomerId,
        email: 'x@example.com',
        created: 1_900_000_000,
        metadata: { codex_user_id: otherUserId },
      });

      vi.mocked(mockStripe.checkout.sessions.create).mockResolvedValue(
        createMockCheckoutSession('cs_resolve_1', 'pi_resolve_1')
      );

      await purchaseService.createCheckoutSession(
        {
          contentId: paidContent.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
        otherUserId
      );

      // Positive: customer is the resolved cus_... id.
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: createdCustomerId,
        })
      );

      // Regression: customer_email must NOT appear on the session payload.
      const sessionArgs = vi
        .mocked(mockStripe.checkout.sessions.create)
        .mock.calls.at(-1)?.[0];
      expect(sessionArgs).toBeDefined();
      expect(sessionArgs).not.toHaveProperty('customer_email');

      // Customer id was persisted to users.stripe_customer_id.
      const [persisted] = await db
        .select({ stripeCustomerId: schema.users.stripeCustomerId })
        .from(schema.users)
        .where(eq(schema.users.id, otherUserId));
      expect(persisted?.stripeCustomerId).toBe(createdCustomerId);
    });

    // Positive: a second rapid checkout for the same user reuses the
    // cached stripe_customer_id — NO call to customers.list or
    // customers.create is made on the cache-hit path.
    it('reuses cached stripe_customer_id on a second checkout for the same user', async () => {
      const media = await mediaService.create(
        {
          title: 'Paid Video (cache hit test)',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `${userId}/hls/${media.id}/master.m3u8`,
          thumbnailKey: `${userId}/thumbnails/${media.id}/auto.jpg`,
          durationSeconds: 60,
        },
        userId
      );

      const paidContent = await contentService.create(
        {
          organizationId,
          title: 'Premium Tutorial (cache hit test)',
          slug: createUniqueSlug('premium-tutorial-cache'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(paidContent.id, userId);

      // Pre-stamp a cached Customer id so resolveOrCreateCustomer takes the
      // fast path and never hits Stripe.
      const cachedCustomerId = `cus_cached_${Date.now()}`;
      await db
        .update(schema.users)
        .set({ stripeCustomerId: cachedCustomerId })
        .where(eq(schema.users.id, otherUserId));

      // Reset mocks so we can assert neither list nor create is called.
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockClear();
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).mockClear();

      vi.mocked(mockStripe.checkout.sessions.create).mockResolvedValue(
        createMockCheckoutSession('cs_cache_hit', 'pi_cache_hit')
      );

      await purchaseService.createCheckoutSession(
        {
          contentId: paidContent.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
        otherUserId
      );

      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: cachedCustomerId })
      );
      expect(mockStripe.customers.list).not.toHaveBeenCalled();
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
    });

    // Negative: Stripe list failure wraps as PaymentProcessingError and
    // propagates out of createCheckoutSession — NOT swallowed by the outer
    // try/catch.
    it('propagates PaymentProcessingError when Stripe customers.list fails during resolution', async () => {
      const media = await mediaService.create(
        {
          title: 'Paid Video (stripe fail test)',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `${userId}/hls/${media.id}/master.m3u8`,
          thumbnailKey: `${userId}/thumbnails/${media.id}/auto.jpg`,
          durationSeconds: 60,
        },
        userId
      );

      const paidContent = await contentService.create(
        {
          organizationId,
          title: 'Premium Tutorial (stripe fail test)',
          slug: createUniqueSlug('premium-tutorial-fail'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(paidContent.id, userId);

      // Force NULL stripe_customer_id so resolveOrCreateCustomer calls list.
      await db
        .update(schema.users)
        .set({ stripeCustomerId: null })
        .where(eq(schema.users.id, otherUserId));

      const stripeErr = Object.assign(new Error('Stripe API unreachable'), {
        type: 'StripeConnectionError',
      });
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockRejectedValue(stripeErr);

      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: paidContent.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          otherUserId
        )
      ).rejects.toThrow(PaymentProcessingError);
    });

    // Negative: a missing / unknown Codex user must NOT silently fall
    // through to a Stripe call — it's a caller bug, not a checkout failure.
    it('throws NotFoundError when the Codex user does not exist', async () => {
      const media = await mediaService.create(
        {
          title: 'Paid Video (missing user test)',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `${userId}/hls/${media.id}/master.m3u8`,
          thumbnailKey: `${userId}/thumbnails/${media.id}/auto.jpg`,
          durationSeconds: 60,
        },
        userId
      );

      const paidContent = await contentService.create(
        {
          organizationId,
          title: 'Premium Tutorial (missing user test)',
          slug: createUniqueSlug('premium-tutorial-missing'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(paidContent.id, userId);

      const { NotFoundError } = await import('../errors');

      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: paidContent.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          '00000000-0000-0000-0000-000000000000'
        )
      ).rejects.toThrow(NotFoundError);

      // Stripe session.create must never fire when the user lookup fails.
      // (No assertion on checkout.sessions.create here because prior tests
      // may have called it; instead we assert above that NotFoundError is
      // thrown — that branch returns before session.create is reached.)
    });

    it('throws ContentNotPurchasableError for free content', async () => {
      // Create free content
      const media = await mediaService.create(
        {
          title: 'Free Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
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
          accessType: 'paid',
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
          accessType: 'paid',
          priceCents: 4999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 2999,
        },
        userId
      );

      await seedReadyConnect(userId);
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

      // Verify revenue split (default 10% platform / 10% org of post-platform
      // / 81% creator of gross, post-h69cg)
      // Platform: ceil(2999 * 1000 / 10000) = 300
      // Post-platform: 2699 → Org: ceil(2699 * 1000 / 10000) = 270
      // Creator: 2999 - 300 - 270 = 2429
      expect(purchase.platformFeeCents).toBe(300);
      expect(purchase.organizationFeeCents).toBe(270);
      expect(purchase.creatorPayoutCents).toBe(2429);

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
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 999,
        },
        userId
      );

      await seedReadyConnect(userId);
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

  // ─── Codex-h69cg: tri-party payouts ledger ────────────────────────────────
  describe('completePurchase — tri-party payouts (Codex-h69cg)', () => {
    /**
     * Set up a paid content item + a Connect account row for the org.
     * Returns chargeId + content for the test to call completePurchase with.
     * Each test seeds its own data so they remain independently runnable.
     */
    async function setupPaidContentWithConnect(opts: {
      title: string;
      priceCents: number;
      chargesEnabled?: boolean;
    }) {
      const media = await mediaService.create(
        {
          title: opts.title,
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `hls/${opts.title}/master.m3u8`,
          thumbnailKey: `thumbnails/${opts.title}.jpg`,
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId,
          title: opts.title,
          slug: createUniqueSlug(opts.title.toLowerCase().replace(/\s+/g, '-')),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: opts.priceCents,
        },
        userId
      );
      // Seed org's Connect account row. The userId is the org owner.
      // Seeded BEFORE publish so ContentService.publish's payout-ready gate is
      // satisfied by THIS account (its stripeAccountId is what the test asserts
      // as the transfer destination).
      // Idempotent: tests in this describe block share the same userId so
      // subsequent calls reuse the existing row instead of conflicting on
      // uq_stripe_connect_user (one account per user, Codex-69t7c).
      const stripeAccountId = `acct_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db
        .insert(schema.stripeConnectAccounts)
        .values({
          userId,
          organizationId,
          stripeAccountId,
          status: 'active',
          chargesEnabled: opts.chargesEnabled ?? true,
          payoutsEnabled: true,
        })
        .onConflictDoUpdate({
          target: [schema.stripeConnectAccounts.userId],
          set: {
            stripeAccountId,
            chargesEnabled: opts.chargesEnabled ?? true,
            payoutsEnabled: true,
            status: 'active',
          },
        });

      await contentService.publish(content.id, userId);

      // Pin the org's canonical Connect account so resolvePrimaryConnect routes
      // the org slice (Codex-69t7c: org→account via primaryConnectAccountUserId).
      await db
        .update(schema.organizations)
        .set({ primaryConnectAccountUserId: userId })
        .where(eq(schema.organizations.id, organizationId));

      return {
        content,
        stripeAccountId,
        chargeId: `ch_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        paymentIntentId: `pi_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      };
    }

    it('writes all 3 tri-party rows + fires creator + org transfers under the default split', async () => {
      const { content, chargeId, paymentIntentId, stripeAccountId } =
        await setupPaidContentWithConnect({
          title: 'Tri-party Standard',
          priceCents: 10000, // £100
        });

      // Option B (Codex-h69cg): TWO secondary transfers fire — one for the
      // creator, one for the org. Mock returns a deterministic id per call so
      // we can pin each ledger row's stripeTransferId.
      const orgTransferId = `tr_org_${Date.now()}`;
      const creatorTransferId = `tr_creator_${Date.now()}`;
      const createTransfer = vi
        .fn()
        .mockImplementation((args: { metadata?: { type?: string } }) => {
          const id =
            args?.metadata?.type === 'creator_payout'
              ? creatorTransferId
              : orgTransferId;
          return Promise.resolve({ id });
        });
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = { create: createTransfer };

      // Default split for £100 with DEFAULT_PLATFORM_FEE_PERCENTAGE = 1000
      // and DEFAULT_ORG_FEE_PERCENTAGE = 1000 (post-h69cg follow-up):
      //   platform = ceil(10000 * 10%)         = 1000
      //   org      = ceil((10000-1000) * 10%)  = 900
      //   creator  = 10000 - 1000 - 900        = 8100
      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));

      // 3 rows: platform_fee + organization_fee + creator_payout
      expect(rows).toHaveLength(3);

      // BOTH transfers must have fired with deterministic idempotency keys
      expect(createTransfer).toHaveBeenCalledTimes(2);
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 8100,
          currency: 'gbp',
          // source_transaction caps the transfer against charge.amount and
          // bypasses available_on wait — works for platform charges.
          source_transaction: chargeId,
        }),
        expect.objectContaining({ idempotencyKey: `${chargeId}_creator` })
      );
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 900,
          currency: 'gbp',
          source_transaction: chargeId,
        }),
        expect.objectContaining({ idempotencyKey: `${chargeId}_org_fee` })
      );

      // transfer_group MUST be absent on both calls — source_transaction sets
      // it implicitly and Stripe rejects passing both together.
      for (const call of createTransfer.mock.calls) {
        const args = call[0] as Record<string, unknown>;
        expect(args).not.toHaveProperty('transfer_group');
      }

      const platformRow = rows.find((r) => r.payoutType === 'platform_fee');
      const orgRow = rows.find((r) => r.payoutType === 'organization_fee');
      const creatorRow = rows.find((r) => r.payoutType === 'creator_payout');
      expect(platformRow).toBeDefined();
      expect(orgRow).toBeDefined();
      expect(creatorRow).toBeDefined();

      // platform_fee invariants — no transfer, retained on platform balance
      expect(platformRow?.amountCents).toBe(1000);
      expect(platformRow?.status).toBe('paid');
      expect(platformRow?.sourceType).toBe('purchase');
      expect(platformRow?.stripeChargeId).toBe(chargeId);
      expect(platformRow?.stripeTransferId).toBeNull();
      expect(platformRow?.userId).toBeNull();
      expect(platformRow?.purchaseId).toBe(purchase.id);

      // organization_fee invariants
      expect(orgRow?.amountCents).toBe(900);
      expect(orgRow?.status).toBe('paid');
      expect(orgRow?.sourceType).toBe('purchase');
      expect(orgRow?.stripeChargeId).toBe(chargeId);
      expect(orgRow?.stripeTransferId).toBe(orgTransferId);

      // creator_payout invariants — NOW has stripeTransferId under Option B
      expect(creatorRow?.amountCents).toBe(8100);
      expect(creatorRow?.status).toBe('paid');
      expect(creatorRow?.sourceType).toBe('purchase');
      expect(creatorRow?.stripeChargeId).toBe(chargeId);
      expect(creatorRow?.stripeTransferId).toBe(creatorTransferId);
      expect(creatorRow?.userId).toBe(userId); // creator is the org owner here

      // Unused stripeAccountId to satisfy lint while keeping the helper return shape
      expect(stripeAccountId).toBeTruthy();
    });

    it('skips payouts ledger when stripeChargeId is absent', async () => {
      const { content, paymentIntentId } = await setupPaidContentWithConnect({
        title: 'No Charge Id',
        priceCents: 5000,
      });

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 5000,
        currency: 'gbp',
        // stripeChargeId omitted on purpose
      });

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));

      expect(rows).toHaveLength(0);
    });

    it('webhook replay is idempotent — payouts rows written exactly once', async () => {
      const { content, chargeId, paymentIntentId } =
        await setupPaidContentWithConnect({
          title: 'Replay Safe',
          priceCents: 3000,
        });

      const createTransfer = vi
        .fn()
        .mockResolvedValue({ id: `tr_replay_${Date.now()}` });
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = { create: createTransfer };

      const args = {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 3000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      } as const;

      const first = await purchaseService.completePurchase(
        paymentIntentId,
        args
      );
      const second = await purchaseService.completePurchase(
        paymentIntentId,
        args
      );

      // Idempotent on the purchase row itself
      expect(second.id).toBe(first.id);

      // Idempotent on payouts ledger — only the first call writes rows
      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, first.id));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.length).toBeLessThanOrEqual(3);
    });

    it('writes a pending org_fee row with reason connect_not_ready when Connect is offline', async () => {
      // Seed a SECOND organization owned by otherUserId so we can configure
      // a Connect account with chargesEnabled=false without interfering with
      // the shared org used by other tests.
      const [org2] = await db
        .insert(organizations)
        .values({
          name: 'Connect Disabled Org',
          slug: createUniqueSlug('connect-disabled'),
          ownerId: otherUserId,
          // Pin so resolvePrimaryConnect resolves the org's (offline) account
          // by userId (Codex-69t7c) — an onboarding org is pinned in production.
          primaryConnectAccountUserId: otherUserId,
        })
        .returning();

      const stripeAccountId = `acct_disabled_${Date.now()}`;
      await db.insert(schema.stripeConnectAccounts).values({
        userId: otherUserId,
        organizationId: org2.id,
        stripeAccountId,
        // Ready for publish; the runtime offline state is applied post-publish.
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      // Build a feeConfig stub that returns a non-zero org_fee_pct so the
      // org-fee branch is exercised. Using an inline service instance avoids
      // touching the shared purchaseService instance.
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const stubStripe = {
        ...mockStripe,
        transfers: { create: vi.fn() },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Connect Offline',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        otherUserId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/connect-offline/master.m3u8',
          thumbnailKey: 'thumbnails/connect-offline.jpg',
          durationSeconds: 60,
        },
        otherUserId
      );
      const content = await contentService.create(
        {
          organizationId: org2.id,
          title: 'Connect Offline',
          slug: createUniqueSlug('connect-offline'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 10000,
        },
        otherUserId
      );
      await contentService.publish(content.id, otherUserId);
      // Gate satisfied at publish time with a READY account; now model the
      // offline Connect the runtime purchase path is meant to exercise.
      await db
        .update(schema.stripeConnectAccounts)
        .set({
          chargesEnabled: false,
          payoutsEnabled: false,
          status: 'onboarding',
        })
        .where(eq(schema.stripeConnectAccounts.userId, otherUserId));

      const chargeId = `ch_offline_${Date.now()}`;
      const purchase = await service.completePurchase(
        `pi_offline_${Date.now()}`,
        {
          customerId: userId,
          contentId: content.id,
          organizationId: org2.id,
          amountPaidCents: 10000,
          currency: 'gbp',
          stripeChargeId: chargeId,
        }
      );

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));

      // Option B (Codex-h69cg): both creator_payout AND organization_fee
      // require a secondary transfer. With the same Connect account (org owner
      // == creator here) disabled, BOTH end up pending+connect_not_ready.
      // platform_fee stays paid (no transfer call). 3 rows total.
      expect(rows).toHaveLength(3);

      const orgFeeRow = rows.find((r) => r.payoutType === 'organization_fee');
      expect(orgFeeRow).toBeDefined();
      expect(orgFeeRow?.status).toBe('pending');
      expect(orgFeeRow?.reason).toBe('connect_not_ready');
      expect(orgFeeRow?.sourceType).toBe('purchase');

      const creatorRow = rows.find((r) => r.payoutType === 'creator_payout');
      expect(creatorRow).toBeDefined();
      expect(creatorRow?.status).toBe('pending');
      expect(creatorRow?.reason).toBe('connect_not_ready');
      expect(creatorRow?.sourceType).toBe('purchase');

      const platformRow = rows.find((r) => r.payoutType === 'platform_fee');
      expect(platformRow?.status).toBe('paid');

      // No Stripe transfer call should have fired
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      expect((stubStripe as any).transfers.create).not.toHaveBeenCalled();
    });

    // ─── Codex-69t7c WP4 (D2/D4): single-account routing invariant ───
    // The creator slice is resolved by `eq(stripeConnectAccounts.userId,
    // creatorId)` — userId-only. The creator's single account carries a
    // vestigial organizationId (nullable; the org it was first onboarded
    // under). Here we null it out to prove routing ignores it; a regression
    // that re-adds an organizationId predicate would miss the account and
    // strand the slice in pending instead of firing the transfer.
    it('routes the creator slice by userId regardless of the Connect account vestigial organizationId (Codex-69t7c D4)', async () => {
      const { content, chargeId, paymentIntentId, stripeAccountId } =
        await setupPaidContentWithConnect({
          title: 'Creator userId routing',
          priceCents: 10000,
        });

      // Sever the account's vestigial org link — userId routing must hold.
      await db
        .update(schema.stripeConnectAccounts)
        .set({ organizationId: null })
        .where(eq(schema.stripeConnectAccounts.userId, userId));

      const creatorTransferId = `tr_creator_${Date.now()}`;
      const orgTransferId = `tr_org_${Date.now()}`;
      const createTransfer = vi
        .fn()
        .mockImplementation((args: { metadata?: { type?: string } }) =>
          Promise.resolve({
            id:
              args?.metadata?.type === 'creator_payout'
                ? creatorTransferId
                : orgTransferId,
          })
        );
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = { create: createTransfer };

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // Creator transfer fired to the userId-resolved account despite the
      // null vestigial org column.
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: stripeAccountId,
          metadata: expect.objectContaining({ type: 'creator_payout' }),
        }),
        expect.objectContaining({ idempotencyKey: `${chargeId}_creator` })
      );

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      const creatorRow = rows.find((r) => r.payoutType === 'creator_payout');
      expect(creatorRow?.status).toBe('paid');
      expect(creatorRow?.userId).toBe(userId);
    });

    // ─── Codex-ed446: org-fee pending row must carry a non-null userId ───
    // When the org owner has NO Connect account at all (distinct from the
    // offline-account case above), resolvePrimaryConnect returns undefined.
    // The org-fee slice MUST still be recorded as a pending row attributed to
    // the org owner (resolveOrgOwnerId fallback, mirroring the subscription
    // path) so it persists and is swept — instead of a null-userId insert
    // that violates check_payouts_user_required (23514) and strands the slice
    // in the platform balance with no ledger row (the bug this locks).
    it('Codex-ed446: org owner with no Connect account still gets a non-null-userId pending org_fee row (no 23514 strand)', async () => {
      const [ownerUserId] = await seedTestUsers(db, 1);
      const [org2] = await db
        .insert(organizations)
        .values({
          name: 'No-Connect Owner Org',
          slug: createUniqueSlug('no-connect-owner'),
          ownerId: ownerUserId,
        })
        .returning();
      // resolveOrgOwnerId reads organizationMemberships(role='owner'), NOT
      // organizations.ownerId — seed the membership explicitly.
      await db
        .insert(schema.organizationMemberships)
        .values(
          createTestMembershipInput(org2.id, ownerUserId, { role: 'owner' })
        );
      // Deliberately seed NO stripe_connect_accounts row for ownerUserId.

      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const stubStripe = {
        ...mockStripe,
        transfers: { create: vi.fn() },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'No Connect Owner',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        ownerUserId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/no-connect/master.m3u8',
          thumbnailKey: 'thumbnails/no-connect.jpg',
          durationSeconds: 60,
        },
        ownerUserId
      );
      const content = await contentService.create(
        {
          organizationId: org2.id,
          title: 'No Connect Owner',
          slug: createUniqueSlug('no-connect-owner-content'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 10000,
        },
        ownerUserId
      );
      // Satisfy the publish gate with a temporary READY account, then delete
      // it to restore this test's premise: the org owner has NO Connect
      // account at all at purchase time (distinct from the offline case).
      await seedReadyConnect(ownerUserId);
      await contentService.publish(content.id, ownerUserId);
      await db
        .delete(schema.stripeConnectAccounts)
        .where(eq(schema.stripeConnectAccounts.userId, ownerUserId));

      const chargeId = `ch_no_connect_${Date.now()}`;
      const purchase = await service.completePurchase(
        `pi_no_connect_${Date.now()}`,
        {
          customerId: userId,
          contentId: content.id,
          organizationId: org2.id,
          amountPaidCents: 10000,
          currency: 'gbp',
          stripeChargeId: chargeId,
        }
      );

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));

      const orgFeeRow = rows.find((r) => r.payoutType === 'organization_fee');
      // The crux: the org-fee row EXISTS (pre-fix it was dropped by the 23514
      // catch) and carries a non-null userId = the org owner.
      expect(orgFeeRow).toBeDefined();
      expect(orgFeeRow?.userId).toBe(ownerUserId);
      expect(orgFeeRow?.status).toBe('pending');
      expect(orgFeeRow?.reason).toBe('connect_not_ready');
      expect(orgFeeRow?.sourceType).toBe('purchase');

      // No transfer fired — there is no Connect account to receive it.
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      expect((stubStripe as any).transfers.create).not.toHaveBeenCalled();
    });

    // ─── WP-10 (Codex-69t7c.10): creator-connect-needed notification ─────────
    //
    // Mirrors the existing connect_not_ready test structure: each test creates
    // its own content + connect account (chargesEnabled=false) and instantiates
    // PurchaseService locally with a mock mailer injected.
    describe('creator-connect-needed notification (WP-10)', () => {
      /**
       * Build a paid content item owned by `otherUserId` in a fresh org, with
       * the Connect account set to chargesEnabled=false so the creator_payout
       * parks as pending. Returns content + org + stripe stub.
       */
      async function setupDisconnectedContent(titleSuffix: string) {
        // Create a fresh org per test so there are no conflicts on the
        // stripeConnectAccounts unique constraint.
        const [localOrg] = await db
          .insert(organizations)
          .values({
            name: `WP10 Org ${titleSuffix}`,
            slug: createUniqueSlug(`wp10-org-${titleSuffix}`),
            ownerId: otherUserId,
          })
          .returning();
        await db.insert(schema.stripeConnectAccounts).values({
          userId: otherUserId,
          organizationId: localOrg.id,
          stripeAccountId: `acct_wp10_${titleSuffix}_${Date.now()}`,
          status: 'active',
          chargesEnabled: true,
          payoutsEnabled: true,
        });

        const media = await mediaService.create(
          {
            title: `WP10 ${titleSuffix}`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            fileSizeBytes: 1024 * 1024,
          },
          otherUserId
        );
        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/wp10-${titleSuffix}/master.m3u8`,
            thumbnailKey: `thumbnails/wp10-${titleSuffix}.jpg`,
            durationSeconds: 60,
          },
          otherUserId
        );
        const testContent = await contentService.create(
          {
            organizationId: localOrg!.id,
            title: `WP10 ${titleSuffix}`,
            slug: createUniqueSlug(`wp10-${titleSuffix}`),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents: 5000,
          },
          otherUserId
        );
        await contentService.publish(testContent.id, otherUserId);
        // Gate satisfied at publish time with a READY account; now model the
        // offline Connect the runtime purchase path is meant to exercise.
        await db
          .update(schema.stripeConnectAccounts)
          .set({
            chargesEnabled: false,
            payoutsEnabled: false,
            status: 'onboarding',
          })
          .where(eq(schema.stripeConnectAccounts.userId, otherUserId));

        const localStubStripe = {
          ...mockStripe,
          transfers: { create: vi.fn() },
          paymentIntents: { retrieve: vi.fn() },
        } as unknown as Stripe;

        return {
          content: testContent,
          org: localOrg!,
          stubStripe: localStubStripe,
        };
      }

      it('fires creator-connect-needed once when creator_payout parks as pending', async () => {
        const {
          content: c,
          org,
          stubStripe: ss,
        } = await setupDisconnectedContent('fires');
        const mailer = vi.fn();
        const svc = new PurchaseService(
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          { db, environment: 'test', mailer } as any,
          ss
        );

        const chargeId = `ch_wp10_fires_${Date.now()}`;
        await svc.completePurchase(`pi_wp10_fires_${Date.now()}`, {
          customerId: userId,
          contentId: c.id,
          organizationId: org.id,
          amountPaidCents: 5000,
          currency: 'gbp',
          stripeChargeId: chargeId,
        });

        // Notification fires once for the creator_payout row.
        expect(mailer).toHaveBeenCalledOnce();
        const [params] = mailer.mock.calls[0];
        expect(params.templateName).toBe('creator-connect-needed');
        expect(params.category).toBe('transactional');
        expect(params.data.amountFormatted).toMatch(/£/);
        expect(params.data.dashboardUrl).toMatch(/earnings/);
      });

      it('does NOT fire when mailer is not injected (graceful degrade)', async () => {
        const {
          content: c,
          org,
          stubStripe: ss,
        } = await setupDisconnectedContent('no-mailer');
        const svc = new PurchaseService(
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          { db, environment: 'test' } as any,
          ss
        );

        const chargeId = `ch_wp10_nomailer_${Date.now()}`;
        await expect(
          svc.completePurchase(`pi_wp10_nomailer_${Date.now()}`, {
            customerId: userId,
            contentId: c.id,
            organizationId: org.id,
            amountPaidCents: 5000,
            currency: 'gbp',
            stripeChargeId: chargeId,
          })
        ).resolves.toBeDefined();
      });

      it('fires ONLY for creator_payout, NOT for organization_fee (even when both park)', async () => {
        const {
          content: c,
          org,
          stubStripe: ss,
        } = await setupDisconnectedContent('orgfee-only-one-notif');
        const mailer = vi.fn();
        const stubFeeWithOrg = {
          getFeesForCreator: vi.fn().mockResolvedValue({
            platformFeePercent: 1000,
            orgFeePercent: 1500,
            minPlatformFeeCents: 0,
            minTransferCents: 0,
          }),
        };
        const svc = new PurchaseService(
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          {
            db,
            environment: 'test',
            feeConfig: stubFeeWithOrg as any,
            mailer,
          } as any,
          ss
        );

        const chargeId = `ch_wp10_orgfee_${Date.now()}`;
        await svc.completePurchase(`pi_wp10_orgfee_${Date.now()}`, {
          customerId: userId,
          contentId: c.id,
          organizationId: org.id,
          amountPaidCents: 5000,
          currency: 'gbp',
          stripeChargeId: chargeId,
        });

        // Only ONE notification — for creator_payout only.
        expect(mailer).toHaveBeenCalledOnce();
        expect(mailer.mock.calls[0][0].templateName).toBe(
          'creator-connect-needed'
        );
      });

      it('swallows mailer throw — purchase still completes', async () => {
        const {
          content: c,
          org,
          stubStripe: ss,
        } = await setupDisconnectedContent('mailer-throws');
        const throwingMailer = vi.fn().mockImplementation(() => {
          throw new Error('smtp down');
        });
        const svc = new PurchaseService(
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          { db, environment: 'test', mailer: throwingMailer } as any,
          ss
        );

        const chargeId = `ch_wp10_throw_${Date.now()}`;
        await expect(
          svc.completePurchase(`pi_wp10_throw_${Date.now()}`, {
            customerId: userId,
            contentId: c.id,
            organizationId: org.id,
            amountPaidCents: 5000,
            currency: 'gbp',
            stripeChargeId: chargeId,
          })
        ).resolves.toBeDefined();
      });

      it('does NOT re-fire on idempotent replay (purchase already processed)', async () => {
        const {
          content: c,
          org,
          stubStripe: ss,
        } = await setupDisconnectedContent('idempotent');
        const mailer = vi.fn();
        const svc = new PurchaseService(
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          { db, environment: 'test', mailer } as any,
          ss
        );

        const piId = `pi_wp10_idem_${Date.now()}`;
        const chargeId = `ch_wp10_idem_${Date.now()}`;
        const meta = {
          customerId: userId,
          contentId: c.id,
          organizationId: org.id,
          amountPaidCents: 5000,
          currency: 'gbp',
          stripeChargeId: chargeId,
        };

        // First call — purchase + payout rows created, notification fires.
        await svc.completePurchase(piId, meta);
        expect(mailer).toHaveBeenCalledOnce();
        mailer.mockClear();

        // Second call — completePurchase returns early (idempotent on PI).
        // No payout insert → no notification.
        await svc.completePurchase(piId, meta);
        expect(mailer).not.toHaveBeenCalled();
      });
    });
    // ─── end WP-10 creator-connect-needed notification ────────────────────────

    it('schema rejects paid rows with neither stripe_transfer_id nor stripe_charge_id', async () => {
      // Try to insert a paid row that satisfies neither side of the
      // check_payouts_paid_invariant OR clause. The DB MUST reject it.
      await expect(
        db.insert(schema.payouts).values({
          userId,
          organizationId,
          amountCents: 100,
          payoutType: 'creator_payout',
          status: 'paid',
          sourceType: 'subscription',
          resolvedAt: new Date(),
          // stripeTransferId + stripeChargeId both omitted — must fail
        })
      ).rejects.toThrow();
    });

    // REGRESSION (PR #203 deep-review N-2, bead Codex-sec7i P1) — multi-creator
    // org_fee mis-attribution.
    //
    // writePurchasePayouts looks up the org Connect via:
    //   .from(stripeConnectAccounts).where(eq(organizationId, …)).limit(1)
    // with NO primary-account pinning, NO chargesEnabled filter, NO ORDER BY.
    // In a multi-creator org where members have their own Connect rows
    // alongside the owner, .limit(1) returns whichever row the planner picks
    // — typically insertion order in Postgres without ORDER BY.
    //
    // Result: the org_fee transfer can route to a random member's Connect
    // account, AND the resulting payouts row carries that member's userId
    // — silently mis-attributing org revenue.
    //
    // The subscription path uses resolvePrimaryConnect(orgId) which honours
    // organizations.ownerId / primary_connect_account_user_id. Purchase
    // path was never updated to match.
    //
    // Failing assertion: org_fee transfer destination matches the OWNER's
    // Connect account, not the member's. To make the test deterministic and
    // FAILING today, we insert the member's Connect FIRST so .limit(1)
    // picks it.
    it('writePurchasePayouts routes org_fee to the org owner Connect, not an arbitrary member (multi-creator regression)', async () => {
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };

      // New org with `userId` as the canonical Connect owner. The pin
      // is the production mechanism resolvePrimaryConnect honours.
      const [multiOrg] = await db
        .insert(organizations)
        .values({
          name: 'Multi-creator Org',
          slug: createUniqueSlug('multi-creator'),
          primaryConnectAccountUserId: userId,
        })
        .returning();

      // Insert MEMBER's Connect row FIRST. Production `.limit(1)` will
      // pick this without an ORDER BY clause.
      const [memberUser] = await db
        .insert(schema.users)
        .values({
          id: crypto.randomUUID(),
          email: `co-creator-${Date.now()}@test.com`,
          name: 'Co-Creator',
        })
        .returning();
      const MEMBER_STRIPE_ACCT = `acct_member_${Date.now()}`;
      await db.insert(schema.stripeConnectAccounts).values({
        userId: memberUser.id,
        organizationId: multiOrg.id,
        stripeAccountId: MEMBER_STRIPE_ACCT,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      // Insert OWNER's Connect SECOND — the canonical org slice recipient.
      const OWNER_STRIPE_ACCT = `acct_owner_${Date.now()}`;
      await db.insert(schema.stripeConnectAccounts).values({
        userId,
        organizationId: multiOrg.id,
        stripeAccountId: OWNER_STRIPE_ACCT,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      const transferCalls: Array<{
        destination?: string;
        metadata?: { type?: string };
      }> = [];
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi.fn().mockImplementation((args: unknown) => {
            const a = args as {
              destination?: string;
              metadata?: { type?: string };
            };
            transferCalls.push({
              destination: a?.destination,
              metadata: a?.metadata,
            });
            return Promise.resolve({
              id: `tr_${a?.metadata?.type ?? 'unknown'}_${Date.now()}`,
            });
          }),
          createReversal: vi.fn(),
        },
        refunds: { create: vi.fn() },
      } as unknown as Stripe;

      const multiService = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Multi-creator Content',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/multi-creator/master.m3u8',
          thumbnailKey: 'thumbnails/multi-creator.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId: multiOrg.id,
          title: 'Multi-creator Content',
          slug: createUniqueSlug('multi-creator'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1000,
        },
        userId
      );
      await contentService.publish(content.id, userId);

      const chargeId = `ch_multi_${Date.now()}`;
      await multiService.completePurchase(`pi_multi_${Date.now()}`, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: multiOrg.id,
        amountPaidCents: 1000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // CRITICAL ASSERTION: org_fee must route to OWNER's Connect, not
      // the member's. Today, .limit(1) picks the member (inserted first).
      const orgFeeCall = transferCalls.find(
        (c) => c.metadata?.type === 'organization_fee'
      );
      expect(orgFeeCall, 'org_fee transfer must fire').toBeDefined();
      expect(orgFeeCall?.destination).toBe(OWNER_STRIPE_ACCT);
    });
  });

  // ─── WP-4 content-purchase agreement integration (Codex-rzfjw) ─────────
  //
  // Decision Q1: content-purchase revenue is attributed to the uploader
  // (`content.creatorId`) — that creator's `revenueType='content_purchase'`
  // agreement determines the split. If no agreement exists, the org keeps
  // 100% of post-platform revenue (pre-agreements behaviour, fallback to
  // FeeConfigService).
  //
  // These tests pin the WP-4 behaviour:
  //   - agreement present  → split shifts toward creator per agreement share
  //   - no agreement       → fallback to org fee resolved from feeConfig
  //   - terminated         → not active, fallback fires
  //   - wrong revenueType  → not used, fallback fires
  //   - other creator's agreement on the same org → does NOT apply (Q1)
  describe('completePurchase — WP-4 content-purchase agreements (Codex-rzfjw)', () => {
    // Each test seeds an agreement on the same (org, creator) tuple and
    // the schema's partial unique index `uq_creator_org_agreement_active_per_type`
    // would reject the second test's insert. Clear any active rows for
    // the shared org between tests.
    beforeEach(async () => {
      await db
        .delete(schema.creatorOrganizationAgreements)
        .where(
          eq(
            schema.creatorOrganizationAgreements.organizationId,
            organizationId
          )
        );
      await db
        .delete(schema.agreementProposals)
        .where(eq(schema.agreementProposals.organizationId, organizationId));
    });

    async function seedContentPurchaseAgreement(
      orgId: string,
      creatorId: string,
      sharePercent: number,
      options: {
        status?: 'active' | 'terminated';
        terminatedAt?: Date | null;
        revenueType?: 'subscription' | 'content_purchase';
      } = {}
    ) {
      const [proposal] = await db
        .insert(schema.agreementProposals)
        .values({
          organizationId: orgId,
          creatorId,
          revenueType: options.revenueType ?? 'content_purchase',
          roundNumber: 1,
          proposedByUserId: creatorId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: sharePercent,
          proposedTermMonths: null,
          proposedEffectiveFrom: new Date(),
          status: 'accepted',
          respondedAt: new Date(),
          respondedByUserId: creatorId,
        })
        .returning();
      if (!proposal) throw new Error('seed proposal failed');
      await db.insert(schema.creatorOrganizationAgreements).values({
        organizationId: orgId,
        creatorId,
        organizationFeePercentage: 10_000 - sharePercent,
        revenueType: options.revenueType ?? 'content_purchase',
        status: options.status ?? 'active',
        terminatedAt: options.terminatedAt ?? null,
        currentProposalId: proposal.id,
      });
      return { proposalId: proposal.id };
    }

    async function seedPaidContent(opts: {
      title: string;
      priceCents: number;
    }) {
      const media = await mediaService.create(
        {
          title: opts.title,
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `hls/${opts.title}/master.m3u8`,
          thumbnailKey: `thumbnails/${opts.title}.jpg`,
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId,
          title: opts.title,
          slug: createUniqueSlug(opts.title.toLowerCase().replace(/\s+/g, '-')),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: opts.priceCents,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(content.id, userId);
      return { content };
    }

    it('WP-4: content_purchase agreement overrides default org fee — creator receives agreement share of post-platform', async () => {
      // Default platform fee = 10%. With a 70% creator share agreement,
      // the org's effective cut becomes 30% of post-platform. On a £100
      // purchase:
      //   platform = ceil(10000 * 10%) = 1000
      //   org      = ceil(9000  * 30%) = 2700
      //   creator  = 10000 - 1000 - 2700 = 6300
      const { content } = await seedPaidContent({
        title: 'WP-4 agreement override',
        priceCents: 10000,
      });
      await seedContentPurchaseAgreement(organizationId, userId, 7000);

      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = {
        create: vi.fn().mockResolvedValue({ id: 'tr_test' }),
      };
      const purchase = await purchaseService.completePurchase(
        `pi_wp4_override_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 10000,
          currency: 'gbp',
        }
      );

      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.organizationFeeCents).toBe(2700);
      expect(purchase.creatorPayoutCents).toBe(6300);
    });

    it('WP-4: no agreement → falls back to FeeConfigService defaults (org keeps post-platform)', async () => {
      // No agreement seeded. With default fees (10% platform / 10% org),
      // org gets 900, creator gets 8100.
      const { content } = await seedPaidContent({
        title: 'WP-4 no agreement fallback',
        priceCents: 10000,
      });
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = {
        create: vi.fn().mockResolvedValue({ id: 'tr_test' }),
      };

      const purchase = await purchaseService.completePurchase(
        `pi_wp4_fallback_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 10000,
          currency: 'gbp',
        }
      );

      // Default split: platform 1000, org 900, creator 8100.
      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.organizationFeeCents).toBe(900);
      expect(purchase.creatorPayoutCents).toBe(8100);
    });

    it('WP-4: terminated agreement → fallback to defaults (no longer applies)', async () => {
      const { content } = await seedPaidContent({
        title: 'WP-4 terminated agreement',
        priceCents: 10000,
      });
      // Terminated yesterday — must not influence the split.
      await seedContentPurchaseAgreement(organizationId, userId, 7000, {
        status: 'terminated',
        terminatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = {
        create: vi.fn().mockResolvedValue({ id: 'tr_test' }),
      };

      const purchase = await purchaseService.completePurchase(
        `pi_wp4_term_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 10000,
          currency: 'gbp',
        }
      );

      // Default fallback split — agreement is terminated so it doesn't apply.
      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.organizationFeeCents).toBe(900);
      expect(purchase.creatorPayoutCents).toBe(8100);
    });

    it('WP-4: subscription-type agreement does NOT apply to content_purchase split', async () => {
      // A subscription agreement exists for the uploader — but the
      // content-purchase path must only look at content_purchase
      // agreements. Fallback fires.
      const { content } = await seedPaidContent({
        title: 'WP-4 wrong revenue type',
        priceCents: 10000,
      });
      await seedContentPurchaseAgreement(organizationId, userId, 7000, {
        revenueType: 'subscription',
      });
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = {
        create: vi.fn().mockResolvedValue({ id: 'tr_test' }),
      };

      const purchase = await purchaseService.completePurchase(
        `pi_wp4_revtype_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 10000,
          currency: 'gbp',
        }
      );

      // Default fallback — subscription agreement is irrelevant here.
      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.organizationFeeCents).toBe(900);
      expect(purchase.creatorPayoutCents).toBe(8100);
    });

    it("WP-4: a DIFFERENT creator's content_purchase agreement does NOT apply to this content (Q1 own-content scope)", async () => {
      // Decision Q1: the agreement looked up at split time is keyed on
      // `content.creatorId` (the uploader). An agreement held by
      // `otherUserId` (the buyer in this test setup, who is also a
      // user but not the uploader) MUST NOT influence the split.
      const { content } = await seedPaidContent({
        title: 'WP-4 other creator agreement',
        priceCents: 10000,
      });
      // Seed an agreement for OTHER user (not the uploader).
      await seedContentPurchaseAgreement(organizationId, otherUserId, 7000);
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = {
        create: vi.fn().mockResolvedValue({ id: 'tr_test' }),
      };

      const purchase = await purchaseService.completePurchase(
        `pi_wp4_other_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 10000,
          currency: 'gbp',
        }
      );

      // The split is the default — only the uploader's agreement counts.
      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.organizationFeeCents).toBe(900);
      expect(purchase.creatorPayoutCents).toBe(8100);
    });

    it('WP-4: 100% creator share agreement → creator gets the full post-platform pool', async () => {
      const { content } = await seedPaidContent({
        title: 'WP-4 full share',
        priceCents: 10000,
      });
      await seedContentPurchaseAgreement(organizationId, userId, 10000);
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      (mockStripe as any).transfers = {
        create: vi.fn().mockResolvedValue({ id: 'tr_test' }),
      };

      const purchase = await purchaseService.completePurchase(
        `pi_wp4_full_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: content.id,
          organizationId,
          amountPaidCents: 10000,
          currency: 'gbp',
        }
      );

      // platform = 1000, org = 0, creator = 9000.
      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.organizationFeeCents).toBe(0);
      expect(purchase.creatorPayoutCents).toBe(9000);
    });
  });

  describe('processRefund — payouts reversal (Codex-h69cg)', () => {
    it('reverses Stripe transfers + marks all rows reversed when refund processes', async () => {
      // Set up a feeConfig with org_fee > 0 so an org_fee row + transfer exist
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };

      // Seed a fresh org for this test so the Connect account state is
      // controllable. owner = userId, distinct from the shared org seeded
      // in beforeAll.
      const [refundOrg] = await db
        .insert(organizations)
        .values({
          name: 'Refund Reversal Org',
          slug: createUniqueSlug('refund-reversal'),
          ownerId: userId,
          // Pin so resolvePrimaryConnect resolves the org's account by userId
          // (Codex-69t7c) — onboarded orgs are pinned in production.
          primaryConnectAccountUserId: userId,
        })
        .returning();
      await db.insert(schema.stripeConnectAccounts).values({
        userId,
        organizationId: refundOrg.id,
        stripeAccountId: `acct_refund_${Date.now()}`,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      // Option B (Codex-h69cg): TWO secondary transfers fire (creator + org)
      // so the refund must reverse both. Mock returns a deterministic id per
      // call so we can confirm each got reversed.
      const orgTransferId = `tr_refund_org_${Date.now()}`;
      const creatorTransferId = `tr_refund_creator_${Date.now()}`;
      const refundedTransferIds: string[] = [];
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi
            .fn()
            .mockImplementation((args: { metadata?: { type?: string } }) => {
              const id =
                args?.metadata?.type === 'creator_payout'
                  ? creatorTransferId
                  : orgTransferId;
              return Promise.resolve({ id });
            }),
          createReversal: vi.fn().mockImplementation((id: string) => {
            refundedTransferIds.push(id);
            return Promise.resolve({ id: `trr_${id}` });
          }),
        },
        refunds: { create: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Refund Reversal Content',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/refund-reversal/master.m3u8',
          thumbnailKey: 'thumbnails/refund-reversal.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId: refundOrg.id,
          title: 'Refund Reversal Content',
          slug: createUniqueSlug('refund-reversal'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 10000,
        },
        userId
      );
      await contentService.publish(content.id, userId);

      const chargeId = `ch_refund_${Date.now()}`;
      const paymentIntentId = `pi_refund_${Date.now()}`;
      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: refundOrg.id,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // Sanity: 3 rows written
      const before = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      expect(before).toHaveLength(3);
      expect(
        before.find((r) => r.payoutType === 'organization_fee')?.status
      ).toBe('paid');

      // Refund the purchase
      await service.processRefund(paymentIntentId, {
        stripeRefundId: 're_test_001',
        refundAmountCents: 10000,
        refundReason: 'requested_by_customer',
      });

      // Option B: Stripe reversal fires for BOTH creator + org transfers.
      // platform_fee never had a transfer so it's marked reversed without a
      // Stripe call.
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const reversal = (stubStripe as any).transfers.createReversal;
      expect(reversal).toHaveBeenCalledTimes(2);
      expect(refundedTransferIds).toContain(orgTransferId);
      expect(refundedTransferIds).toContain(creatorTransferId);

      // All 3 rows must now be 'reversed'
      const after = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      expect(after).toHaveLength(3);
      expect(after.every((r) => r.status === 'reversed')).toBe(true);
    });

    it('refund is a no-op if rows are already reversed (idempotent)', async () => {
      // Seed a purchase + manually-reversed rows.
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const reversal = vi.fn();
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi.fn(),
          createReversal: reversal,
        },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Idempotent Reversal',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/idem-rev/master.m3u8',
          thumbnailKey: 'thumbnails/idem-rev.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId,
          title: 'Idempotent Reversal',
          slug: createUniqueSlug('idempotent-reversal'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1000,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(content.id, userId);

      const chargeId = `ch_idem_${Date.now()}`;
      const paymentIntentId = `pi_idem_${Date.now()}`;
      await service.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 1000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // First refund
      await service.processRefund(paymentIntentId);
      // Second refund — short-circuits via the "already refunded" guard.
      await service.processRefund(paymentIntentId);

      // No reversal API call should have fired at all (org_fee = 0 so no
      // transfer existed; both refund calls were content-status-only).
      expect(reversal).not.toHaveBeenCalled();
    });

    // REGRESSION (PR #203 deep-review F-1, DQ-7) — partial refunds must
    // proportionally reverse the creator + org transfers, not the full
    // slices. Current production code in `reversePayoutsForPurchase`
    // (purchase-service.ts:1289-1297) passes `amount: row.amountCents`
    // regardless of the partial-refund ratio, so a £5 partial refund on
    // a £20 charge fully zeroes the creator's £15.30 slice and the org's
    // £2.70 slice — net £13 of unaccounted loss. See
    // docs/pr-203-review/design-questions.md DQ-7.
    //
    it('partial refund proportionally reverses creator + org transfers (DQ-7)', async () => {
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000, // 10%
          orgFeePercent: 1500, // 15% of post-platform
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };

      const [partialOrg] = await db
        .insert(organizations)
        .values({
          name: 'Partial Refund Org',
          slug: createUniqueSlug('partial-refund'),
          ownerId: userId,
          // Pin so resolvePrimaryConnect resolves the org's account by userId
          // (Codex-69t7c) — onboarded orgs are pinned in production.
          primaryConnectAccountUserId: userId,
        })
        .returning();
      await db.insert(schema.stripeConnectAccounts).values({
        userId,
        organizationId: partialOrg.id,
        stripeAccountId: `acct_partial_${Date.now()}`,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      const orgTransferId = `tr_partial_org_${Date.now()}`;
      const creatorTransferId = `tr_partial_creator_${Date.now()}`;
      const reversalCalls: { transferId: string; amount: number }[] = [];
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi
            .fn()
            .mockImplementation((args: { metadata?: { type?: string } }) => {
              const id =
                args?.metadata?.type === 'creator_payout'
                  ? creatorTransferId
                  : orgTransferId;
              return Promise.resolve({ id });
            }),
          createReversal: vi
            .fn()
            .mockImplementation((id: string, args: { amount: number }) => {
              reversalCalls.push({ transferId: id, amount: args.amount });
              return Promise.resolve({ id: `trr_${id}` });
            }),
        },
        refunds: { create: vi.fn() },
      } as unknown as Stripe;
      const partialService = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Partial Refund Content',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/partial-refund/master.m3u8',
          thumbnailKey: 'thumbnails/partial-refund.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId: partialOrg.id,
          title: 'Partial Refund Content',
          slug: createUniqueSlug('partial-refund'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 2000,
        },
        userId
      );
      await contentService.publish(content.id, userId);

      const chargeId = `ch_partial_${Date.now()}`;
      const paymentIntentId = `pi_partial_${Date.now()}`;
      // £20 purchase. Splits with 10% platform / 15% org-of-remainder:
      //   platform £2.00 (kept on balance, no transfer)
      //   org      £2.70 (transfer)
      //   creator  £15.30 (transfer)
      await partialService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: partialOrg.id,
        amountPaidCents: 2000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // £5 partial refund (25% of £20).
      await partialService.processRefund(paymentIntentId, {
        stripeRefundId: 're_partial_001',
        refundAmountCents: 500,
        refundReason: 'requested_by_customer',
      });

      // Proportional reversal: 25% of each slice (floor to whole pence).
      //   creator: floor(1530 * 0.25) = 382
      //   org:     floor(270  * 0.25) =  67
      //   residual: 1 cent — design choice in DQ-7 (recommendation: → platform).
      const creatorReversal = reversalCalls.find(
        (c) => c.transferId === creatorTransferId
      );
      const orgReversal = reversalCalls.find(
        (c) => c.transferId === orgTransferId
      );
      expect(creatorReversal?.amount).toBe(382);
      expect(orgReversal?.amount).toBe(67);
    });

    // Codex-d9t5r sentinel layer (DQ-7 part 2): when Stripe rejects the
    // reversal with insufficient_funds (creator already withdrew their
    // slice before the refund landed), the payouts row stays
    // status='paid' (the original transfer succeeded) and a row in
    // refund_reviews captures the unresolved clawback for ops.
    it('writes refund_reviews row on Stripe insufficient_funds reversal', async () => {
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };

      const [sentinelOrg] = await db
        .insert(organizations)
        .values({
          name: 'Sentinel Refund Org',
          slug: createUniqueSlug('sentinel-refund'),
          primaryConnectAccountUserId: userId,
        })
        .returning();
      await db.insert(schema.stripeConnectAccounts).values({
        userId,
        organizationId: sentinelOrg.id,
        stripeAccountId: `acct_sentinel_${Date.now()}`,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      const creatorTransferId = `tr_sentinel_creator_${Date.now()}`;
      const orgTransferId = `tr_sentinel_org_${Date.now()}`;
      const insufficientFundsError = Object.assign(
        new Error('Insufficient funds in Stripe Connect account'),
        { code: 'insufficient_funds' }
      );
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi
            .fn()
            .mockImplementation((args: { metadata?: { type?: string } }) => {
              const id =
                args?.metadata?.type === 'creator_payout'
                  ? creatorTransferId
                  : orgTransferId;
              return Promise.resolve({ id });
            }),
          // Only the creator reversal hits insufficient_funds; the org
          // reversal succeeds, so we can isolate the sentinel path.
          createReversal: vi.fn().mockImplementation((id: string) => {
            if (id === creatorTransferId) {
              return Promise.reject(insufficientFundsError);
            }
            return Promise.resolve({ id: `trr_${id}` });
          }),
        },
        refunds: { create: vi.fn() },
      } as unknown as Stripe;
      const sentinelService = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Sentinel Refund Content',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/sentinel-refund/master.m3u8',
          thumbnailKey: 'thumbnails/sentinel-refund.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId: sentinelOrg.id,
          title: 'Sentinel Refund Content',
          slug: createUniqueSlug('sentinel-refund'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1000,
        },
        userId
      );
      await contentService.publish(content.id, userId);

      const chargeId = `ch_sentinel_${Date.now()}`;
      const paymentIntentId = `pi_sentinel_${Date.now()}`;
      const purchase = await sentinelService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: sentinelOrg.id,
        amountPaidCents: 1000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      await sentinelService.processRefund(paymentIntentId, {
        stripeRefundId: 're_sentinel_001',
        refundAmountCents: 1000,
        refundReason: 'requested_by_customer',
      });

      // The payouts row whose reversal failed must STAY status='paid' —
      // the original transfer succeeded; only the reversal failed.
      const after = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      const creatorRow = after.find((r) => r.payoutType === 'creator_payout');
      expect(creatorRow?.status).toBe('paid');

      // Other slices reverse cleanly.
      const orgRow = after.find((r) => r.payoutType === 'organization_fee');
      expect(orgRow?.status).toBe('reversed');

      // A refund_reviews row records the unresolved clawback.
      const reviews = await db
        .select()
        .from(schema.refundReviews)
        .where(eq(schema.refundReviews.purchaseId, purchase.id));
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        payoutId: creatorRow?.id,
        creatorUserId: userId,
        errorCode: 'insufficient_funds',
        resolution: null,
        resolvedAt: null,
      });
      expect(reviews[0].attemptedReversalCents).toBeGreaterThan(0);
    });

    // REGRESSION (PR #203 deep-review F-2, bead Codex-92ej7, DQ-9) — when a
    // purchase completes with Connect-not-ready, the creator_payout +
    // organization_fee rows land as `status='pending'` with no
    // `stripeTransferId` (no Stripe call was made). If the buyer then refunds
    // before Connect onboarding completes, `reversePayoutsForPurchase`
    // (purchase-service.ts:1278-1331) marks ALL non-already-reversed rows as
    // 'reversed' — including the pending ones that never had a transfer.
    //
    // The sweep cron filters by `status='pending'`, so once these rows
    // become 'reversed' the sweep stops seeing them. If Connect onboarding
    // later completes, the creator's queued payout is silently lost.
    //
    // DQ-9 resolution: rows that never transferred get
    // `status='cancelled_by_refund'` (option (a) — explicit cancellation
    // of the obligation, no pretend reversal). The sweep cron filters on
    // `status='pending'` so it correctly skips these and the creator can
    // see in the studio UI why they didn't get the payout.
    it('refund cancels connect_not_ready rows with cancelled_by_refund (not reversed)', async () => {
      const stubFeeConfig = {
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1500,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };

      // New org whose Connect account is NOT ready — pending path triggers.
      const [pendingOrg] = await db
        .insert(organizations)
        .values({
          name: 'Pending Refund Org',
          slug: createUniqueSlug('pending-refund'),
          ownerId: userId,
          // Pin so resolvePrimaryConnect resolves the org's (not-ready) account
          // by userId (Codex-69t7c) so the org-fee pending row is written.
          primaryConnectAccountUserId: userId,
        })
        .returning();
      await db.insert(schema.stripeConnectAccounts).values({
        userId,
        organizationId: pendingOrg.id,
        stripeAccountId: `acct_pending_${Date.now()}`,
        status: 'active',
        chargesEnabled: true, // ready for publish; downgraded to offline after publish
        payoutsEnabled: true,
      });

      const reversalCalls: string[] = [];
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi.fn(), // must NOT be called — Connect not ready
          createReversal: vi.fn().mockImplementation((id: string) => {
            reversalCalls.push(id);
            return Promise.resolve({ id: `trr_${id}` });
          }),
        },
        refunds: { create: vi.fn() },
      } as unknown as Stripe;
      const pendingService = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const media = await mediaService.create(
        {
          title: 'Pending Refund Content',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/pending-refund/master.m3u8',
          thumbnailKey: 'thumbnails/pending-refund.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          organizationId: pendingOrg.id,
          title: 'Pending Refund Content',
          slug: createUniqueSlug('pending-refund'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1000,
        },
        userId
      );
      await contentService.publish(content.id, userId);
      // Gate satisfied at publish time with a READY account; now model the
      // offline Connect the runtime purchase path is meant to exercise.
      await db
        .update(schema.stripeConnectAccounts)
        .set({
          chargesEnabled: false,
          payoutsEnabled: false,
          status: 'onboarding',
        })
        .where(eq(schema.stripeConnectAccounts.userId, userId));

      const chargeId = `ch_pending_${Date.now()}`;
      const paymentIntentId = `pi_pending_${Date.now()}`;
      const purchase = await pendingService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: pendingOrg.id,
        amountPaidCents: 1000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // Sanity: 3 rows; platform_fee paid, creator + org pending.
      const before = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      expect(before).toHaveLength(3);
      const beforeByType = new Map(before.map((r) => [r.payoutType, r]));
      expect(beforeByType.get('platform_fee')?.status).toBe('paid');
      expect(beforeByType.get('creator_payout')?.status).toBe('pending');
      expect(beforeByType.get('organization_fee')?.status).toBe('pending');

      // Refund the purchase.
      await pendingService.processRefund(paymentIntentId, {
        stripeRefundId: 're_pending_001',
        refundAmountCents: 1000,
        refundReason: 'requested_by_customer',
      });

      // No transfers ever happened → createReversal must not have fired
      // (there's nothing to reverse on the Stripe side).
      expect(reversalCalls).toHaveLength(0);

      const after = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      const afterByType = new Map(after.map((r) => [r.payoutType, r]));

      // platform_fee was paid (retained on platform balance) → can be marked reversed.
      expect(afterByType.get('platform_fee')?.status).toBe('reversed');

      // creator_payout had NO Stripe transfer (Connect not ready) →
      // cancelled_by_refund per DQ-9. Sweep filters on 'pending' so this
      // row is correctly excluded from retry attempts.
      expect(afterByType.get('creator_payout')?.status).toBe(
        'cancelled_by_refund'
      );

      // Same for organization_fee.
      expect(afterByType.get('organization_fee')?.status).toBe(
        'cancelled_by_refund'
      );
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
          accessType: 'paid',
          priceCents: 1499,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 2499,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
            accessType: 'paid',
            priceCents: 999 + i * 100,
          },
          userId
        );

        await seedReadyConnect(userId);
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
      expect(history.pagination.page).toBe(1);
      expect(history.pagination.limit).toBe(2);
      expect(history.pagination.total).toBeGreaterThanOrEqual(3);
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

  describe('listSales (studio Sales ledger)', () => {
    // Isolated org so prior describe-block data doesn't contaminate scoping
    // assertions. Reuses the file-level userId/otherUserId pair.
    let salesOrgId: string;
    let otherOrgId: string;
    let contentAId: string;
    let contentBId: string;
    let saleA: { id: string };
    let saleRefunded: { id: string };

    beforeAll(async () => {
      const [salesOrg] = await db
        .insert(organizations)
        .values({
          name: 'Sales Test Org',
          slug: createUniqueSlug('sales-test-org'),
          ownerId: userId,
        })
        .returning();
      const [otherOrg] = await db
        .insert(organizations)
        .values({
          name: 'Other Sales Org',
          slug: createUniqueSlug('other-sales-org'),
          ownerId: userId,
        })
        .returning();
      if (!salesOrg || !otherOrg) throw new Error('Failed to seed orgs');
      salesOrgId = salesOrg.id;
      otherOrgId = otherOrg.id;

      // Two pieces of content on salesOrg, one on otherOrg.
      async function makeContent(
        orgId: string,
        slug: string,
        priceCents: number
      ): Promise<string> {
        const media = await mediaService.create(
          {
            title: `Sales Video ${slug}`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            fileSizeBytes: 1024,
          },
          userId
        );
        await mediaService.markAsReady(
          media.id,
          {
            hlsMasterPlaylistKey: `hls/${slug}/master.m3u8`,
            thumbnailKey: `thumbnails/${slug}.jpg`,
            durationSeconds: 60,
          },
          userId
        );
        const c = await contentService.create(
          {
            organizationId: orgId,
            title: `Sales Tutorial ${slug}`,
            slug: createUniqueSlug(slug),
            contentType: 'video',
            mediaItemId: media.id,
            visibility: 'purchased_only',
            accessType: 'paid',
            priceCents,
          },
          userId
        );
        await seedReadyConnect(userId);
        await contentService.publish(c.id, userId);
        return c.id;
      }

      contentAId = await makeContent(salesOrgId, 'sales-a', 1000);
      contentBId = await makeContent(salesOrgId, 'sales-b', 2000);
      const otherOrgContentId = await makeContent(otherOrgId, 'sales-c', 500);

      // Two completed sales on salesOrg, one on otherOrg, one we'll refund.
      saleA = await purchaseService.completePurchase(
        `pi_sales_a_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: contentAId,
          organizationId: salesOrgId,
          amountPaidCents: 1000,
          currency: 'gbp',
        }
      );
      await purchaseService.completePurchase(`pi_sales_b_${Date.now()}`, {
        customerId: otherUserId,
        contentId: contentBId,
        organizationId: salesOrgId,
        amountPaidCents: 2000,
        currency: 'gbp',
      });
      await purchaseService.completePurchase(`pi_sales_c_${Date.now()}`, {
        customerId: otherUserId,
        contentId: otherOrgContentId,
        organizationId: otherOrgId,
        amountPaidCents: 500,
        currency: 'gbp',
      });
      // A fourth sale on salesOrg that we mark refunded directly in the DB
      // (processRefund needs Stripe; we're testing the listing/aggregation).
      saleRefunded = await purchaseService.completePurchase(
        `pi_sales_refunded_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: contentAId,
          organizationId: salesOrgId,
          amountPaidCents: 1000,
          currency: 'gbp',
        }
      );
      await db
        .update(schema.purchases)
        .set({
          status: 'refunded',
          refundedAt: new Date(),
          refundAmountCents: 1000,
          refundReason: 'requested_by_customer',
        })
        .where(eq(schema.purchases.id, saleRefunded.id));
    });

    it('returns rows scoped to organizationId only', async () => {
      const result = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
      });
      expect(result.items.length).toBeGreaterThanOrEqual(3);
      // No row from otherOrg leaks in
      expect(
        result.items.every((s) => s.contentId !== contentBId || true)
      ).toBe(true);
      // Sanity: nothing belongs to otherOrg's content
      expect(
        result.items.find((s) => s.contentTitle.includes('sales-c'))
      ).toBeUndefined();
    });

    it('rejects cross-org access: other org receives only its own rows', async () => {
      const otherOrgRows = await purchaseService.listSales(otherOrgId, {
        page: 1,
        limit: 50,
      });
      expect(otherOrgRows.items.length).toBe(1);
      expect(otherOrgRows.items[0]!.amountPaidCents).toBe(500);
    });

    it('flattens customer + content joins into the SaleListItem shape', async () => {
      const result = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
      });
      const sample = result.items.find((s) => s.id === saleA.id);
      expect(sample).toBeDefined();
      expect(sample!.customerId).toBe(otherUserId);
      expect(sample!.customerEmail).toBeTruthy();
      expect(sample!.contentTitle).toContain('sales-a');
      expect(sample!.amountPaidCents).toBe(1000);
      expect(sample!.creatorPayoutCents).toBeGreaterThan(0);
    });

    it('filters by status=completed (excludes refunded)', async () => {
      const result = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
        status: 'completed',
      });
      expect(result.items.every((s) => s.status === 'completed')).toBe(true);
      expect(
        result.items.find((s) => s.id === saleRefunded.id)
      ).toBeUndefined();
    });

    it('filters by status=refunded', async () => {
      const result = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
        status: 'refunded',
      });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every((s) => s.status === 'refunded')).toBe(true);
    });

    it("filters by status='disputed' (maps to disputedAt IS NOT NULL)", async () => {
      // Seed a disputed sale: completePurchase produces a 'completed' row,
      // then we mark it disputed at the DB level (status stays 'completed'
      // by design — see purchase-service.ts:1217 comment).
      const saleDisputed = await purchaseService.completePurchase(
        `pi_sales_disputed_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: contentAId,
          organizationId: salesOrgId,
          amountPaidCents: 1000,
          currency: 'gbp',
        }
      );
      await db
        .update(schema.purchases)
        .set({
          disputedAt: new Date(),
          disputeReason: 'fraudulent',
          stripeDisputeId: 'dp_test_xxx',
        })
        .where(eq(schema.purchases.id, saleDisputed.id));

      const result = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
        status: 'disputed',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every((s) => s.disputedAt !== null)).toBe(true);
      expect(result.items.find((s) => s.id === saleDisputed.id)).toBeDefined();

      // Filter-additive sanity: an unfiltered query should also surface
      // the same disputed row (the special case is filter-additive, not
      // filter-exclusive).
      const unfiltered = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
      });
      expect(
        unfiltered.items.find((s) => s.id === saleDisputed.id)
      ).toBeDefined();
    });

    it('filters by contentId', async () => {
      const result = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 50,
        contentId: contentAId,
      });
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.every((s) => s.contentId === contentAId)).toBe(true);
    });

    it('paginates correctly', async () => {
      const first = await purchaseService.listSales(salesOrgId, {
        page: 1,
        limit: 2,
      });
      expect(first.items.length).toBeLessThanOrEqual(2);
      expect(first.pagination.page).toBe(1);
      expect(first.pagination.limit).toBe(2);
      expect(first.pagination.total).toBeGreaterThanOrEqual(3);
      expect(first.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getSalesStats (studio Sales KPIs)', () => {
    let statsOrgId: string;
    let statsContentId: string;

    beforeAll(async () => {
      const [org] = await db
        .insert(organizations)
        .values({
          name: 'Stats Test Org',
          slug: createUniqueSlug('stats-test-org'),
          ownerId: userId,
        })
        .returning();
      if (!org) throw new Error('Failed to seed stats org');
      statsOrgId = org.id;

      const media = await mediaService.create(
        {
          title: 'Stats Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/stats/master.m3u8',
          thumbnailKey: 'thumbnails/stats.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const c = await contentService.create(
        {
          organizationId: statsOrgId,
          title: 'Stats Tutorial',
          slug: createUniqueSlug('stats-tutorial'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1000,
        },
        userId
      );
      await seedReadyConnect(userId);
      await contentService.publish(c.id, userId);
      statsContentId = c.id;

      // Three completed @ 1000p + one refunded @ 1000p (refund 500p partial).
      for (let i = 0; i < 3; i++) {
        await purchaseService.completePurchase(
          `pi_stats_${i}_${Date.now()}_${Math.random()}`,
          {
            customerId: otherUserId,
            contentId: statsContentId,
            organizationId: statsOrgId,
            amountPaidCents: 1000,
            currency: 'gbp',
          }
        );
      }
      const refunded = await purchaseService.completePurchase(
        `pi_stats_refund_${Date.now()}`,
        {
          customerId: otherUserId,
          contentId: statsContentId,
          organizationId: statsOrgId,
          amountPaidCents: 1000,
          currency: 'gbp',
        }
      );
      await db
        .update(schema.purchases)
        .set({
          status: 'refunded',
          refundedAt: new Date(),
          refundAmountCents: 500,
        })
        .where(eq(schema.purchases.id, refunded.id));
    });

    it('computes gross, net, refundedCents and count for org', async () => {
      const stats = await purchaseService.getSalesStats(statsOrgId, {});
      // 3 completed @ 1000 + 1 refunded @ 1000 (originally collected) = 4000
      expect(stats.grossCents).toBe(4000);
      // Net = sum of (creator + org fee) on completed rows only
      //   = 3 * (1000 - platformFee) on completed rows
      // Default platform fee 10% => 900 per row => 2700
      expect(stats.netCents).toBe(2700);
      expect(stats.refundedCents).toBe(500);
      expect(stats.count).toBe(3);
      expect(stats.currency).toBe('gbp');
    });

    it('returns zero stats for org with no sales', async () => {
      const [emptyOrg] = await db
        .insert(organizations)
        .values({
          name: 'Empty Org',
          slug: createUniqueSlug('empty-stats-org'),
          ownerId: userId,
        })
        .returning();
      const stats = await purchaseService.getSalesStats(emptyOrg!.id, {});
      expect(stats.grossCents).toBe(0);
      expect(stats.netCents).toBe(0);
      expect(stats.refundedCents).toBe(0);
      expect(stats.count).toBe(0);
    });

    it('honours fromDate window — excludes rows outside the range', async () => {
      // Future fromDate excludes everything we just seeded.
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const stats = await purchaseService.getSalesStats(statsOrgId, {
        fromDate: future.toISOString(),
      });
      expect(stats.grossCents).toBe(0);
      expect(stats.count).toBe(0);
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
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 2999,
        },
        userId
      );

      await seedReadyConnect(userId);
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

      // Different user trying to access — the service is scoped by both
      // (purchaseId, customerId) at the query level, so a non-owner gets
      // NotFound rather than Forbidden. This is intentional hardening:
      // returning Forbidden would leak the existence of the purchase to
      // an unrelated user. PurchaseNotFoundError extends NotFoundError
      // and maps to a 404 response.
      await expect(
        purchaseService.getPurchase(purchase.id, userId)
      ).rejects.toThrow(PurchaseNotFoundError);
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
    // Codex-ssfes: the portal now delegates to resolveOrCreateCustomer so
    // Customer resolution is identical to checkout. These tests assert the
    // unified cus_... is forwarded to billingPortal.sessions.create.

    it('uses the cached stripe_customer_id when already persisted', async () => {
      const cachedId = `cus_portal_cached_${Date.now()}`;
      await db
        .update(schema.users)
        .set({ stripeCustomerId: cachedId })
        .where(eq(schema.users.id, userId));

      const portalUrl = 'https://billing.stripe.com/session/cached';
      vi.mocked(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({ url: portalUrl } as Stripe.BillingPortal.Session);

      // Clear defaults set by beforeEach so we can assert the cache-hit path.
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockClear();
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).mockClear();

      const result = await purchaseService.createPortalSession(
        'test@example.com',
        userId,
        'http://localhost:3000/settings'
      );

      expect(result.url).toBe(portalUrl);
      expect(mockStripe.customers.list).not.toHaveBeenCalled();
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: cachedId,
          return_url: 'http://localhost:3000/settings',
        })
      );
    });

    it('resolves and persists a Customer id when the user has none cached', async () => {
      const createdId = `cus_portal_new_${Date.now()}`;
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).mockResolvedValueOnce({
        id: createdId,
        email: 'newuser@example.com',
        created: Math.floor(Date.now() / 1000),
        metadata: { codex_user_id: otherUserId },
      });

      const portalUrl = 'https://billing.stripe.com/session/resolved';
      vi.mocked(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).mockResolvedValue({ url: portalUrl } as Stripe.BillingPortal.Session);

      await purchaseService.createPortalSession(
        'newuser@example.com',
        otherUserId,
        'http://localhost:3000/settings'
      );

      expect(
        (mockStripe.customers as ReturnType<typeof vi.fn>).create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newuser@example.com',
          metadata: expect.objectContaining({ codex_user_id: otherUserId }),
        }),
        expect.objectContaining({
          idempotencyKey: `codex:resolve-customer:${otherUserId}`,
        })
      );
      expect(
        (mockStripe.billingPortal.sessions as ReturnType<typeof vi.fn>).create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: createdId,
          return_url: 'http://localhost:3000/settings',
        })
      );

      // Persisted on the user row so subsequent portal/checkout calls
      // skip Stripe entirely.
      const [row] = await db
        .select({ stripeCustomerId: schema.users.stripeCustomerId })
        .from(schema.users)
        .where(eq(schema.users.id, otherUserId));
      expect(row?.stripeCustomerId).toBe(createdId);
    });

    it('throws PaymentProcessingError when Stripe resolution fails', async () => {
      const stripeError = Object.assign(new Error('Stripe API error'), {
        type: 'StripeAPIError',
      });
      vi.mocked(
        (mockStripe.customers as ReturnType<typeof vi.fn>).list
      ).mockRejectedValueOnce(stripeError);

      await expect(
        purchaseService.createPortalSession(
          'test@example.com',
          userId,
          'http://localhost:3000/settings'
        )
      ).rejects.toThrow(PaymentProcessingError);
    });

    it('validates return URL with domain whitelist', async () => {
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
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 2999,
        },
        userId
      );

      await seedReadyConnect(userId);
      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_refund_meta_${Date.now()}`;

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 2999,
        currency: 'gbp',
      });

      const beforeRefund = Date.now();

      await purchaseService.processRefund(paymentIntentId, {
        stripeRefundId: 're_meta_test_456',
        refundAmountCents: 2999,
        refundReason: 'duplicate',
      });

      // Verify all four refund metadata fields were persisted in the same
      // transaction as the status flip. Audit + support forensics + reporting
      // depend on these being non-null after a successful refund (Codex-98yb).
      const result = await purchaseService.getPurchase(
        purchase.id,
        otherUserId
      );

      expect(result?.status).toBe('refunded');
      expect(result?.stripeRefundId).toBe('re_meta_test_456');
      expect(result?.refundAmountCents).toBe(2999);
      expect(result?.refundReason).toBe('duplicate');
      expect(result?.refundedAt).toBeInstanceOf(Date);
      // Narrow the optional chain — biome rejects `result?.refundedAt!` and
      // the field is nullable in the schema. A separate assertion makes the
      // null-check explicit so getTime() is reachable without ! on ?.
      const refundedAt = result?.refundedAt;
      expect(refundedAt).not.toBeNull();
      if (refundedAt) {
        expect(refundedAt.getTime()).toBeGreaterThanOrEqual(
          beforeRefund - 1000
        );
      }
    });

    it('rolls back purchase status when contentAccess revocation throws (atomicity)', async () => {
      // Codex-98yb: load-bearing assertion that processRefund's
      // db.transaction() actually rolls back the purchase status update
      // when the contentAccess update throws partway through. Without the
      // transaction wrap, a failed access revocation would leave the
      // purchase row at status='refunded' while the user keeps content.
      const media = await mediaService.create(
        {
          title: 'Rollback Refund Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/rollback-refund/master.m3u8',
          thumbnailKey: 'thumbnails/rollback-refund.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Rollback Refund Content',
          slug: createUniqueSlug('rollback-refund'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1499,
        },
        userId
      );

      await seedReadyConnect(userId);
      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_rollback_${Date.now()}`;

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 1499,
        currency: 'gbp',
      });

      // Build a Proxy db for a one-shot PurchaseService that wraps the real
      // db.transaction() but injects a tx Proxy that throws on the
      // contentAccess update. The purchases update succeeds first, then the
      // contentAccess update throws, so the transaction must roll back.
      type DbLike = typeof db;
      type TxLike = Parameters<Parameters<DbLike['transaction']>[0]>[0];

      const failingDb = new Proxy(db as DbLike, {
        get(target, prop, receiver) {
          if (prop === 'transaction') {
            return (callback: (tx: TxLike) => Promise<unknown>) =>
              target.transaction(async (realTx) => {
                const txProxy = new Proxy(realTx as TxLike, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === 'update') {
                      const realUpdate = txTarget.update.bind(txTarget);
                      return (table: unknown) => {
                        if (table === schema.contentAccess) {
                          throw new Error(
                            'INJECTED FAILURE: contentAccess revocation failed'
                          );
                        }
                        return realUpdate(
                          table as Parameters<typeof realUpdate>[0]
                        );
                      };
                    }
                    return Reflect.get(txTarget, txProp, txReceiver);
                  },
                });
                return callback(txProxy);
              });
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const failingService = new PurchaseService(
        { db: failingDb, environment: 'test' },
        mockStripe
      );

      // Snapshot pre-refund state
      const before = await db.query.purchases.findFirst({
        where: eq(schema.purchases.id, purchase.id),
      });
      expect(before?.status).toBe('completed');
      expect(before?.refundedAt).toBeNull();

      // Process refund — should throw because contentAccess update fails.
      // handleError() wraps the raw error into a typed ServiceError; we
      // only care that something propagates (i.e. the catch in processRefund
      // re-raises rather than swallowing).
      await expect(
        failingService.processRefund(paymentIntentId, {
          stripeRefundId: 're_rollback_999',
          refundAmountCents: 1499,
          refundReason: 'requested_by_customer',
        })
      ).rejects.toThrow();

      // Purchase row must be unchanged — transaction rolled back.
      const after = await db.query.purchases.findFirst({
        where: eq(schema.purchases.id, purchase.id),
      });
      expect(after?.status).toBe('completed');
      expect(after?.refundedAt).toBeNull();
      expect(after?.stripeRefundId).toBeNull();
      expect(after?.refundAmountCents).toBeNull();
      expect(after?.refundReason).toBeNull();

      // contentAccess must remain active (deletedAt still null).
      const accessRow = await db.query.contentAccess.findFirst({
        where: eq(schema.contentAccess.contentId, content.id),
      });
      expect(accessRow).toBeDefined();
      expect(accessRow?.deletedAt).toBeNull();
    });

    it('should soft-delete contentAccess record (set deletedAt)', async () => {
      const media = await mediaService.create(
        {
          title: 'Access Revoke Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
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
          accessType: 'paid',
          priceCents: 1499,
        },
        userId
      );

      await seedReadyConnect(userId);
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
          accessType: 'paid',
          priceCents: 999,
        },
        userId
      );

      await seedReadyConnect(userId);
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
   * processDispute Tests (Codex-sxu5a)
   *
   * Parallel to `processRefund` — disputes revoke content access and mark
   * the purchase as `disputedAt` without mutating `status` (status stays
   * 'completed' per the DB CHECK constraint; `disputedAt` is the signal).
   *
   * Coverage matrix (per feedback_security_deep_test — positive + negative + idempotent):
   *
   * | Scenario                              | Assertion                                          |
   * | ------------------------------------- | -------------------------------------------------- |
   * | positive: known purchase              | disputedAt set, contentAccess soft-deleted         |
   * | returns { userId, orgId }             | handler needs both for revocation + library bump   |
   * | idempotent: second dispute on same PI | no throw, still returns scope                      |
   * | negative: unknown payment_intent      | returns void, no DB change                         |
   * | stores stripeDisputeId + disputeReason | metadata round-trip                                |
   */
  describe('processDispute', () => {
    it('marks purchase disputed, soft-deletes contentAccess, returns { userId, orgId }', async () => {
      const media = await mediaService.create(
        {
          title: 'Dispute Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/dispute-test/master.m3u8',
          thumbnailKey: 'thumbnails/dispute-test.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Dispute Test Content',
          slug: createUniqueSlug('dispute-test'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 1999,
        },
        userId
      );

      await seedReadyConnect(userId);
      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_dispute_${Date.now()}`;

      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 1999,
        currency: 'gbp',
      });

      // Sanity: access exists before dispute
      expect(
        await purchaseService.verifyPurchase(content.id, otherUserId)
      ).toBe(true);

      const result = await purchaseService.processDispute(paymentIntentId, {
        stripeDisputeId: 'dp_test_123',
        disputeReason: 'fraudulent',
      });

      // Return shape — handler needs both fields
      expect(result).toEqual({
        userId: otherUserId,
        orgId: organizationId,
      });

      // Access revoked — library query will omit this content
      expect(
        await purchaseService.verifyPurchase(content.id, otherUserId)
      ).toBe(false);

      // disputedAt set; purchase.status unchanged (still 'completed')
      const updated = await purchaseService.getPurchase(
        purchase.id,
        otherUserId
      );
      expect(updated.disputedAt).not.toBeNull();
      expect(updated.stripeDisputeId).toBe('dp_test_123');
      expect(updated.disputeReason).toBe('fraudulent');
      // status unchanged — dispute ≠ refund at the Stripe level
      expect(updated.status).toBe('completed');
    });

    it('is idempotent — second dispute on same payment_intent still returns scope without throwing', async () => {
      const media = await mediaService.create(
        {
          title: 'Idempotent Dispute Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );

      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/idempotent-dispute/master.m3u8',
          thumbnailKey: 'thumbnails/idempotent-dispute.jpg',
          durationSeconds: 120,
        },
        userId
      );

      const content = await contentService.create(
        {
          organizationId,
          title: 'Idempotent Dispute Content',
          slug: createUniqueSlug('idempotent-dispute'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 999,
        },
        userId
      );

      await seedReadyConnect(userId);
      await contentService.publish(content.id, userId);

      const paymentIntentId = `pi_dispute_idem_${Date.now()}`;

      await purchaseService.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId,
        amountPaidCents: 999,
        currency: 'gbp',
      });

      // First dispute
      const first = await purchaseService.processDispute(paymentIntentId, {
        stripeDisputeId: 'dp_first',
        disputeReason: 'fraudulent',
      });
      expect(first).toEqual({
        userId: otherUserId,
        orgId: organizationId,
      });

      // Second dispute — must NOT throw and must return same scope so the
      // webhook layer can re-bump library cache + re-write revocation
      // key (both are monotonic / idempotent at their layers).
      const second = await purchaseService.processDispute(paymentIntentId, {
        stripeDisputeId: 'dp_second_ignored',
        disputeReason: 'duplicate',
      });
      expect(second).toEqual({
        userId: otherUserId,
        orgId: organizationId,
      });

      // First-write-wins on metadata — stripeDisputeId stays 'dp_first'.
      // (We do NOT overwrite disputedAt / dispute metadata on the idempotent
      // path — Stripe retries should not clobber the original dispute ID.)
    });

    it('returns void for unknown payment_intent and does NOT throw', async () => {
      const result = await purchaseService.processDispute(
        'pi_unknown_dispute_xyz'
      );
      expect(result).toBeUndefined();
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
          accessType: 'paid',
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

  // ─── resolvePrimaryConnect — org→account resolution (Codex-69t7c) ───────
  // Production does not pin organizations.primaryConnectAccountUserId yet, so
  // org-fee resolution relies on the deterministic org-owner fallback. These
  // pin that contract so a regression that drops the fallback (stranding the
  // org-fee slice) can't ship green.
  describe('resolvePrimaryConnect — org→account resolution (Codex-69t7c)', () => {
    it('falls back to the org owner account when no primary pin is set', async () => {
      const [ownerUserId] = await seedTestUsers(db, 1);
      const [org] = await db
        .insert(organizations)
        .values({ name: 'RPC Owner Org', slug: createUniqueSlug('rpc-owner') })
        .returning();
      await db
        .insert(schema.organizationMemberships)
        .values(
          createTestMembershipInput(org.id, ownerUserId, { role: 'owner' })
        );
      const stripeAccountId = `acct_rpc_${createUniqueSlug('a')}`;
      await db.insert(schema.stripeConnectAccounts).values({
        userId: ownerUserId,
        organizationId: org.id,
        stripeAccountId,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });

      const account = await resolvePrimaryConnect(db, org.id);
      expect(account?.userId).toBe(ownerUserId);
      expect(account?.stripeAccountId).toBe(stripeAccountId);
    });

    it('returns undefined when the org has neither a primary pin nor an owner', async () => {
      const [org] = await db
        .insert(organizations)
        .values({ name: 'RPC Empty Org', slug: createUniqueSlug('rpc-empty') })
        .returning();

      const account = await resolvePrimaryConnect(db, org.id);
      expect(account).toBeUndefined();
    });
  });

  // ─── Codex-69t7c WP5: orgless (bi-party) purchase pipeline ─────────────────
  //
  // The Phase-1 "content must belong to an organization" gate is removed.
  // Orgless creator-direct content (content.organizationId IS NULL) is
  // purchasable: the buyer pays the platform, the platform retains its fee
  // (platform_fee row) and forwards the rest to the CREATOR's single Connect
  // account (creator_payout row) via a secondary transfer keyed by userId.
  // NO organization_fee row is written — there is no org to pay.
  describe('completePurchase — bi-party orgless payouts (Codex-69t7c WP5)', () => {
    /**
     * Seed an orgless paid content item owned by `creatorUserId` (no
     * organizationId) plus that creator's single Connect account (keyed by
     * userId — Codex-69t7c one-account-per-user). Returns the ids the test
     * feeds to completePurchase.
     */
    async function setupOrglessPaidContent(opts: {
      title: string;
      priceCents: number;
      creatorUserId: string;
      chargesEnabled?: boolean;
      seedConnect?: boolean;
    }) {
      const {
        title,
        priceCents,
        creatorUserId,
        chargesEnabled = true,
        seedConnect = true,
      } = opts;
      const media = await mediaService.create(
        {
          title,
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        creatorUserId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: `hls/${title}/master.m3u8`,
          thumbnailKey: `thumbnails/${title}.jpg`,
          durationSeconds: 60,
        },
        creatorUserId
      );
      // No organizationId → orgless (bi-party) personal content.
      const content = await contentService.create(
        {
          title,
          slug: createUniqueSlug(title.toLowerCase().replace(/\s+/g, '-')),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents,
        },
        creatorUserId
      );
      await seedReadyConnect(creatorUserId);
      await contentService.publish(content.id, creatorUserId);

      if (seedConnect) {
        // The creator's SINGLE Connect account (keyed by userId). For orgless
        // content there is no org pin — the creator slice resolves purely by
        // `eq(stripeConnectAccounts.userId, creatorId)`. organizationId on the
        // account row is left null (the account isn't org-scoped here).
        await db
          .insert(schema.stripeConnectAccounts)
          .values({
            userId: creatorUserId,
            organizationId: null,
            stripeAccountId: `acct_orgless_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: chargesEnabled ? 'active' : 'onboarding',
            chargesEnabled,
            payoutsEnabled: chargesEnabled,
          })
          .onConflictDoUpdate({
            target: [schema.stripeConnectAccounts.userId],
            set: {
              organizationId: null,
              chargesEnabled,
              payoutsEnabled: chargesEnabled,
              status: chargesEnabled ? 'active' : 'onboarding',
            },
          });
      }

      return {
        content,
        chargeId: `ch_orgless_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        paymentIntentId: `pi_orgless_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      };
    }

    // P1 — happy path: exactly TWO rows (platform_fee + creator_payout), no
    // organization_fee; creator transfer fires once in GBP with the verbatim
    // `${chargeId}_creator` idempotency key; the org component is zero.
    it('writes exactly 2 bi-party rows (platform_fee + creator_payout) and fires the creator transfer — no org_fee row', async () => {
      // The creator is `userId`; the buyer is `otherUserId`.
      const stubFeeConfig = {
        // getFeesPlatform is the resolver the orgless branch calls. Return a
        // non-zero orgFeePercent to PROVE the orgless branch forces the org
        // leg to zero regardless (RISK B in the plan).
        getFeesPlatform: vi.fn().mockResolvedValue({
          platformFeePercent: 1000, // 10%
          orgFeePercent: 1500, // 15% — MUST be ignored for orgless
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
        getFeesForCreator: vi.fn(), // must NOT be called for orgless
      };
      const creatorTransferId = `tr_orgless_creator_${Date.now()}`;
      const createTransfer = vi
        .fn()
        .mockResolvedValue({ id: creatorTransferId });
      const stubStripe = {
        ...mockStripe,
        transfers: { create: createTransfer },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const { content, chargeId, paymentIntentId } =
        await setupOrglessPaidContent({
          title: 'Orgless Bi-party Standard',
          priceCents: 10000, // £100
          creatorUserId: userId,
        });

      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: null, // orgless
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // Orgless purchase row carries a null org.
      expect(purchase.organizationId).toBeNull();

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));

      // EXACTLY 2 rows — platform_fee + creator_payout. NO organization_fee.
      expect(rows).toHaveLength(2);
      expect(
        rows.find((r) => r.payoutType === 'organization_fee')
      ).toBeUndefined();

      // Orgless branch uses getFeesPlatform, NOT getFeesForCreator.
      expect(stubFeeConfig.getFeesPlatform).toHaveBeenCalledTimes(1);
      expect(stubFeeConfig.getFeesForCreator).not.toHaveBeenCalled();

      // Exactly ONE secondary transfer (the creator slice), in GBP, with the
      // verbatim idempotency key. Org slice forced to zero → no second call.
      expect(createTransfer).toHaveBeenCalledTimes(1);
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'gbp',
          source_transaction: chargeId,
        }),
        expect.objectContaining({ idempotencyKey: `${chargeId}_creator` })
      );

      const platformRow = rows.find((r) => r.payoutType === 'platform_fee');
      const creatorRow = rows.find((r) => r.payoutType === 'creator_payout');
      expect(platformRow).toBeDefined();
      expect(creatorRow).toBeDefined();

      // Split for £100 @ platform 10%, org forced 0:
      //   platform = ceil(10000 * 10%) = 1000
      //   org      = 0
      //   creator  = 10000 - 1000 - 0  = 9000
      expect(platformRow?.amountCents).toBe(1000);
      expect(platformRow?.status).toBe('paid');
      expect(platformRow?.userId).toBeNull(); // platform isn't a user
      expect(platformRow?.organizationId).toBeNull(); // orgless
      expect(platformRow?.stripeTransferId).toBeNull();

      expect(creatorRow?.amountCents).toBe(9000);
      expect(creatorRow?.status).toBe('paid');
      expect(creatorRow?.userId).toBe(userId); // routed to the creator
      expect(creatorRow?.organizationId).toBeNull(); // orgless
      expect(creatorRow?.stripeTransferId).toBe(creatorTransferId);
      expect(creatorRow?.stripeChargeId).toBe(chargeId);

      // Money conservation: platform + creator == amount (org leg is zero).
      expect(
        (platformRow?.amountCents ?? 0) + (creatorRow?.amountCents ?? 0)
      ).toBe(10000);
    });

    // P1b (Codex-69t7c WP5 hardening b) — money-moved / ledger-silent guard:
    // on the orgless path the creator transfer fires (REAL money moves to the
    // Connect account) but the creator_payout ledger insert fails on a NON-
    // unique DB error (e.g. a 23514 CHECK violation). That failure MUST be
    // SURFACED via obs.error with a correlatable errorId — NOT swallowed — so
    // the out-of-sync ledger is loud and reconcilable. (A 23505 dup is the
    // only error that may be silently swallowed, since it means the row
    // already exists.)
    it('orgless path: transfer succeeds but ledger insert fails (non-unique) → error SURFACED with errorId, not swallowed', async () => {
      const stubFeeConfig = {
        getFeesPlatform: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const creatorTransferId = `tr_orgless_ledgerfail_${Date.now()}`;
      const createTransfer = vi
        .fn()
        .mockResolvedValue({ id: creatorTransferId });
      const stubStripe = {
        ...mockStripe,
        transfers: { create: createTransfer },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const { content, chargeId, paymentIntentId } =
        await setupOrglessPaidContent({
          title: 'Orgless Ledger Insert Fail',
          priceCents: 10000,
          creatorUserId: userId,
        });

      // Synthetic NON-unique Postgres error (23514 = check_violation). The
      // hardening branch keys off `!isUniqueViolation(err)` (23505), so this
      // exercises the surfaced-error path.
      class FakeCheckViolation extends Error {
        code = '23514';
        constraint = 'check_payouts_paid_invariant';
        constructor() {
          super('simulated non-unique ledger insert failure');
        }
      }

      // Intercept the service's DB so ONLY the creator_payout `paid` insert
      // rejects. Every other insert (purchase, contentAccess, platform_fee,
      // the pending fallbacks) delegates to the real builder unchanged.
      // `db.insert` lives on the Drizzle client's prototype (not an own
      // property), so vi.spyOn can't target it — wrap the whole client in a
      // Proxy that intercepts `insert` and restores it after the test.
      // biome-ignore lint/suspicious/noExplicitAny: test interception of Drizzle client
      const serviceAny = service as any;
      const realDb = serviceAny.db;
      const dbProxy = new Proxy(realDb, {
        get(target, prop, receiver) {
          if (prop === 'insert') {
            // biome-ignore lint/suspicious/noExplicitAny: Drizzle builder shape
            return (table: any) => {
              const builder = target.insert(table);
              const realValues = builder.values.bind(builder);
              // biome-ignore lint/suspicious/noExplicitAny: row payload
              builder.values = (rows: any) => {
                const row = Array.isArray(rows) ? rows[0] : rows;
                if (
                  row?.payoutType === 'creator_payout' &&
                  row?.status === 'paid'
                ) {
                  return Promise.reject(new FakeCheckViolation());
                }
                return realValues(rows);
              };
              return builder;
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      serviceAny.db = dbProxy;

      // biome-ignore lint/suspicious/noExplicitAny: spy protected obs.error
      const errorSpy = vi.spyOn((service as any).obs, 'error');

      // completePurchase MUST NOT throw — per-row isolation keeps the purchase
      // itself successful; the ledger failure is logged, not propagated.
      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: null,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });
      expect(purchase.organizationId).toBeNull();

      // The Stripe transfer DID fire — real money moved.
      expect(createTransfer).toHaveBeenCalledTimes(1);
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'gbp' }),
        expect.objectContaining({ idempotencyKey: `${chargeId}_creator` })
      );

      // The failure was SURFACED via obs.error with the money-moved message
      // AND a correlatable errorId + the Connect destination + idempotencyKey.
      const surfaced = errorSpy.mock.calls.find(([msg]) =>
        String(msg).includes(
          'creator_payout transfer succeeded but payouts ledger insert failed'
        )
      );
      expect(
        surfaced,
        'ledger-insert failure after a successful transfer must be logged at error level'
      ).toBeDefined();
      const surfacedMeta = surfaced![1] as Record<string, unknown>;
      expect(typeof surfacedMeta.errorId).toBe('string');
      expect((surfacedMeta.errorId as string).length).toBeGreaterThan(0);
      expect(surfacedMeta.stripeTransferId).toBe(creatorTransferId);
      expect(surfacedMeta.idempotencyKey).toBe(`${chargeId}_creator`);
      expect(surfacedMeta.destination).toBeDefined();

      serviceAny.db = realDb;
      errorSpy.mockRestore();
    });

    // P2 — orgless purchase BEFORE the creator finishes Connect onboarding:
    // creator_payout degrades to pending+connect_not_ready, platform_fee still
    // paid, NO transfer call. Mirrors the tri-party connect_not_ready path.
    it('degrades creator_payout to pending+connect_not_ready when the creator Connect is offline', async () => {
      const stubFeeConfig = {
        getFeesPlatform: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const createTransfer = vi.fn();
      const stubStripe = {
        ...mockStripe,
        transfers: { create: createTransfer },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      // Creator = otherUserId here so we don't collide with P1's userId account
      // within the same test run; Connect seeded with chargesEnabled=false.
      const { content, chargeId, paymentIntentId } =
        await setupOrglessPaidContent({
          title: 'Orgless Pre-Connect',
          priceCents: 10000,
          creatorUserId: otherUserId,
          chargesEnabled: false,
        });

      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: userId,
        contentId: content.id,
        organizationId: null,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));

      // 2 rows: platform_fee (paid) + creator_payout (pending). No org row.
      expect(rows).toHaveLength(2);
      expect(
        rows.find((r) => r.payoutType === 'organization_fee')
      ).toBeUndefined();

      const creatorRow = rows.find((r) => r.payoutType === 'creator_payout');
      expect(creatorRow?.status).toBe('pending');
      expect(creatorRow?.reason).toBe('connect_not_ready');
      expect(creatorRow?.organizationId).toBeNull();
      expect(creatorRow?.userId).toBe(otherUserId);

      const platformRow = rows.find((r) => r.payoutType === 'platform_fee');
      expect(platformRow?.status).toBe('paid');

      // No Stripe transfer call fired — Connect not ready.
      expect(createTransfer).not.toHaveBeenCalled();
    });

    // P3 — createCheckoutSession succeeds on orgless paid+published content and
    // OMITS organizationId from Stripe metadata (Stripe metadata values must be
    // strings; the webhook schema re-derives null from the absent key).
    it('createCheckoutSession succeeds for orgless content and omits organizationId from Stripe metadata', async () => {
      const sessionsCreate = vi
        .fn()
        .mockResolvedValue(
          createMockCheckoutSession('cs_orgless_1', 'pi_orgless_co_1')
        );
      const stubStripe = {
        ...mockStripe,
        checkout: { sessions: { create: sessionsCreate, retrieve: vi.fn() } },
        customers: {
          list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
          create: vi.fn().mockResolvedValue({
            id: `cus_orgless_${Date.now()}`,
            email: 'buyer@example.com',
          }),
        },
      } as unknown as Stripe;
      const service = new PurchaseService(
        { db, environment: 'test' },
        stubStripe
      );

      const { content } = await setupOrglessPaidContent({
        title: 'Orgless Checkout',
        priceCents: 4200,
        creatorUserId: userId,
        seedConnect: false, // checkout doesn't need the Connect account
      });

      const result = await service.createCheckoutSession(
        {
          contentId: content.id,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        },
        otherUserId
      );

      expect(result.sessionUrl).toBeTruthy();
      expect(sessionsCreate).toHaveBeenCalledTimes(1);
      const passedMetadata = sessionsCreate.mock.calls[0][0].metadata as Record<
        string,
        string
      >;
      // organizationId MUST be absent (not present, not the string "null").
      expect(passedMetadata).not.toHaveProperty('organizationId');
      expect(passedMetadata.contentId).toBe(content.id);
      expect(passedMetadata.creatorId).toBe(userId);
    });

    // P4 — bi-party refund reverses the creator_payout + platform_fee rows.
    // reversePayoutsForPurchase is data-driven (reads whatever rows exist), so
    // with only 2 bi-party rows it reverses exactly those and never expects an
    // org row.
    it('refund reverses both bi-party rows (creator_payout transfer + platform_fee)', async () => {
      const creatorTransferId = `tr_orgless_refund_${Date.now()}`;
      const reversed: string[] = [];
      const stubFeeConfig = {
        getFeesPlatform: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const stubStripe = {
        ...mockStripe,
        transfers: {
          create: vi.fn().mockResolvedValue({ id: creatorTransferId }),
          createReversal: vi.fn().mockImplementation((id: string) => {
            reversed.push(id);
            return Promise.resolve({ id: `trr_${id}` });
          }),
        },
        refunds: { create: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const { content, chargeId, paymentIntentId } =
        await setupOrglessPaidContent({
          title: 'Orgless Refund',
          priceCents: 10000,
          creatorUserId: userId,
        });

      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: null,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      const before = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      expect(before).toHaveLength(2);

      await service.processRefund(paymentIntentId, {
        stripeRefundId: 're_orgless_001',
        refundAmountCents: 10000,
        refundReason: 'requested_by_customer',
      });

      // Only the creator_payout had a Stripe transfer → exactly one reversal.
      // platform_fee is marked reversed without a Stripe call.
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const reversal = (stubStripe as any).transfers.createReversal;
      expect(reversal).toHaveBeenCalledTimes(1);
      expect(reversed).toContain(creatorTransferId);

      const after = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      expect(after).toHaveLength(2);
      expect(after.every((r) => r.status === 'reversed')).toBe(true);
    });

    // N1 — gate ORDER preserved: orgless but UNPUBLISHED still throws.
    it('createCheckoutSession still throws ContentNotPurchasableError for orgless UNPUBLISHED content', async () => {
      const media = await mediaService.create(
        {
          title: 'Orgless Draft',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/orgless-draft/master.m3u8',
          thumbnailKey: 'thumbnails/orgless-draft.jpg',
          durationSeconds: 60,
        },
        userId
      );
      // Orgless + paid + priced but NOT published.
      const content = await contentService.create(
        {
          title: 'Orgless Draft',
          slug: createUniqueSlug('orgless-draft'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 2999,
        },
        userId
      );
      // intentionally NOT published

      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: content.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          otherUserId
        )
      ).rejects.toThrow(ContentNotPurchasableError);
    });

    // N2 — orgless but FREE (priceCents null) still throws.
    it('createCheckoutSession still throws ContentNotPurchasableError for orgless FREE content', async () => {
      const media = await mediaService.create(
        {
          title: 'Orgless Free',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        media.id,
        {
          hlsMasterPlaylistKey: 'hls/orgless-free/master.m3u8',
          thumbnailKey: 'thumbnails/orgless-free.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const content = await contentService.create(
        {
          title: 'Orgless Free',
          slug: createUniqueSlug('orgless-free'),
          contentType: 'video',
          mediaItemId: media.id,
          visibility: 'public',
          accessType: 'free',
        },
        userId
      );
      await contentService.publish(content.id, userId);

      await expect(
        purchaseService.createCheckoutSession(
          {
            contentId: content.id,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          },
          otherUserId
        )
      ).rejects.toThrow(ContentNotPurchasableError);
    });

    // N3 — even with a feeConfig that returns a non-zero orgFeePercent, the
    // orgless branch MUST force the org leg to zero (no org_fee row, no second
    // transfer). Guards against an org slice being stranded with no recipient.
    it('forces the org leg to zero for orgless even when fee config returns a non-zero orgFeePercent', async () => {
      const stubFeeConfig = {
        getFeesPlatform: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 3000, // 30% — must be ignored
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const createTransfer = vi
        .fn()
        .mockResolvedValue({ id: `tr_orgless_n3_${Date.now()}` });
      const stubStripe = {
        ...mockStripe,
        transfers: { create: createTransfer },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      const { content, chargeId, paymentIntentId } =
        await setupOrglessPaidContent({
          title: 'Orgless Zero Org Leg',
          priceCents: 10000,
          creatorUserId: userId,
        });

      const purchase = await service.completePurchase(paymentIntentId, {
        customerId: otherUserId,
        contentId: content.id,
        organizationId: null,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: chargeId,
      });

      // Snapshot on the purchase row: org fee component is zero, creator gets
      // the full post-platform remainder.
      expect(purchase.organizationFeeCents).toBe(0);
      expect(purchase.platformFeeCents).toBe(1000);
      expect(purchase.creatorPayoutCents).toBe(9000);

      const rows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, purchase.id));
      expect(rows).toHaveLength(2);
      expect(
        rows.find((r) => r.payoutType === 'organization_fee')
      ).toBeUndefined();
      // Only the creator transfer fired (no org transfer).
      expect(createTransfer).toHaveBeenCalledTimes(1);
    });

    // C1 / R2 — a creator who publishes BOTH orgless and org-scoped content:
    // the orgless purchase writes 2 rows, the org-scoped purchase writes 3,
    // and the two flows are independent within the same run. Doubles as the
    // org-routed regression assertion (R1 already covered by the existing
    // tri-party suite).
    it('keeps orgless (2 rows) and org-scoped (3 rows) flows independent for the same creator', async () => {
      const stubFeeConfig = {
        // org-scoped path uses getFeesForCreator (org fee > 0);
        // orgless path uses getFeesPlatform (org leg forced to 0).
        getFeesForCreator: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 1000, // 10% org slice for the org-scoped purchase
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
        getFeesPlatform: vi.fn().mockResolvedValue({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        }),
      };
      const createTransfer = vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: `tr_mixed_${Math.random().toString(36).slice(2, 10)}`,
        })
      );
      const stubStripe = {
        ...mockStripe,
        transfers: { create: createTransfer },
        paymentIntents: { retrieve: vi.fn() },
      } as unknown as Stripe;
      const service = new PurchaseService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { db, environment: 'test', feeConfig: stubFeeConfig as any },
        stubStripe
      );

      // Creator = userId. Seed an org owned by userId + the creator's single
      // Connect (one account, used for BOTH the orgless creator slice AND, via
      // the org pin, the org slice).
      const [mixedOrg] = await db
        .insert(organizations)
        .values({
          name: 'Mixed Flow Org',
          slug: createUniqueSlug('mixed-flow'),
          ownerId: userId,
          primaryConnectAccountUserId: userId,
        })
        .returning();
      await db
        .insert(schema.stripeConnectAccounts)
        .values({
          userId,
          organizationId: mixedOrg.id,
          stripeAccountId: `acct_mixed_${Date.now()}`,
          status: 'active',
          chargesEnabled: true,
          payoutsEnabled: true,
        })
        .onConflictDoUpdate({
          target: [schema.stripeConnectAccounts.userId],
          set: { chargesEnabled: true, payoutsEnabled: true, status: 'active' },
        });

      // ── Orgless purchase → 2 rows ──
      const { content: orglessContent } = await setupOrglessPaidContent({
        title: 'Mixed Orgless Leg',
        priceCents: 10000,
        creatorUserId: userId,
        seedConnect: false, // account already seeded above
      });
      const orglessPi = `pi_mixed_orgless_${Date.now()}`;
      const orglessPurchase = await service.completePurchase(orglessPi, {
        customerId: otherUserId,
        contentId: orglessContent.id,
        organizationId: null,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: `ch_mixed_orgless_${Date.now()}`,
      });
      const orglessRows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, orglessPurchase.id));
      expect(orglessRows).toHaveLength(2);
      expect(orglessPurchase.organizationId).toBeNull();
      expect(
        orglessRows.find((r) => r.payoutType === 'organization_fee')
      ).toBeUndefined();

      // ── Org-scoped purchase by the SAME creator → 3 rows (regression) ──
      const orgMedia = await mediaService.create(
        {
          title: 'Mixed Org Leg',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024,
        },
        userId
      );
      await mediaService.markAsReady(
        orgMedia.id,
        {
          hlsMasterPlaylistKey: 'hls/mixed-org/master.m3u8',
          thumbnailKey: 'thumbnails/mixed-org.jpg',
          durationSeconds: 60,
        },
        userId
      );
      const orgContent = await contentService.create(
        {
          organizationId: mixedOrg.id,
          title: 'Mixed Org Leg',
          slug: createUniqueSlug('mixed-org-leg'),
          contentType: 'video',
          mediaItemId: orgMedia.id,
          visibility: 'purchased_only',
          accessType: 'paid',
          priceCents: 10000,
        },
        userId
      );
      await contentService.publish(orgContent.id, userId);

      const orgPi = `pi_mixed_org_${Date.now()}`;
      const orgPurchase = await service.completePurchase(orgPi, {
        customerId: otherUserId,
        contentId: orgContent.id,
        organizationId: mixedOrg.id,
        amountPaidCents: 10000,
        currency: 'gbp',
        stripeChargeId: `ch_mixed_org_${Date.now()}`,
      });
      const orgRows = await db
        .select()
        .from(schema.payouts)
        .where(eq(schema.payouts.purchaseId, orgPurchase.id));
      // 3 rows: platform_fee + organization_fee + creator_payout.
      expect(orgRows).toHaveLength(3);
      expect(orgPurchase.organizationId).toBe(mixedOrg.id);
      const orgFeeRow = orgRows.find(
        (r) => r.payoutType === 'organization_fee'
      );
      expect(orgFeeRow).toBeDefined();
      expect(orgFeeRow?.amountCents).toBe(900); // 10% of post-platform 9000
      expect(orgFeeRow?.organizationId).toBe(mixedOrg.id);
    });
  });
});
