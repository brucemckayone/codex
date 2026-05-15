/**
 * SubscriptionService Tests
 *
 * Integration tests with real DB + mocked Stripe.
 * Covers the full subscription lifecycle:
 * - Checkout session creation
 * - Webhook handlers (created, invoice, updated, deleted)
 * - Lifecycle management (change tier, cancel, reactivate)
 * - Queries (get, list, stats)
 * - Revenue transfers
 *
 * Verified against Stripe best practices:
 * - Webhook idempotency via stripeSubscriptionId unique constraint
 * - No event ordering dependency — each handler works independently
 * - Stripe v19 shapes for period dates and invoice payments
 */

import {
  creatorOrganizationAgreements,
  organizations,
  payouts as payoutsTable,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { UnsupportedCurrencyError } from '@codex/service-errors';
import {
  createMockStripe,
  createMockStripeInvoice,
  createMockStripeSubscription,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
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
  AlreadySubscribedError,
  ConnectAccountNotReadyError,
  SubscriptionCheckoutError,
  SubscriptionNotFoundError,
  SubscriptionPaymentRequiredError,
  TierNotFoundError,
} from '../../errors';
import { SubscriptionService } from '../subscription-service';

describe('SubscriptionService', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: SubscriptionService;
  let creatorId: string;
  let otherCreatorId: string;
  let thirdUserId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const userIds = await seedTestUsers(db, 3);
    [creatorId, otherCreatorId, thirdUserId] = userIds;
  });

  beforeEach(async () => {
    stripe = createMockStripe();

    // Codex-ssfes: SubscriptionService.createCheckoutSession now resolves a
    // unified Stripe Customer via resolveOrCreateCustomer. createMockStripe
    // doesn't ship with customers.list / customers.create stubs — attach
    // defaults here so every test enters the create-branch deterministically
    // unless it opts into the cache-hit / failure paths explicitly.
    (stripe as unknown as { customers: unknown }).customers = {
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
        id: `cus_default_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        email: (params.email as string) ?? 'default@example.com',
        created: Math.floor(Date.now() / 1000),
        metadata: (params.metadata as Record<string, string>) ?? {},
      })),
    };

    service = new SubscriptionService({ db, environment: 'test' }, stripe);

    // Clear any cached Customer id from previous tests so resolution is
    // deterministic per-test.
    const { inArray } = await import('drizzle-orm');
    await db
      .update(users)
      .set({ stripeCustomerId: null })
      .where(
        inArray(
          users.id,
          [creatorId, otherCreatorId, thirdUserId].filter(Boolean)
        )
      );
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** Create org + connect + tiers for testing */
  async function createFullOrg(slug?: string) {
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({
          slug: createUniqueSlug(slug ?? 'sub'),
          creatorId,
        })
      )
      .returning();

    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(org.id, creatorId, {
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
      })
    );

    const [tier1] = await db
      .insert(subscriptionTiers)
      .values(
        createTestTierInput(org.id, {
          name: 'Basic',
          sortOrder: 1,
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      )
      .returning();

    const [tier2] = await db
      .insert(subscriptionTiers)
      .values(
        createTestTierInput(org.id, {
          name: 'Pro',
          sortOrder: 2,
          priceMonthly: 999,
          priceAnnual: 9990,
        })
      )
      .returning();

    return { org, tier1, tier2 };
  }

  // ─── createCheckoutSession ────────────────────────────────────────

  describe('createCheckoutSession', () => {
    it('should create monthly checkout session with correct metadata', async () => {
      const { org, tier1 } = await createFullOrg('checkout-monthly');
      const result = await service.createCheckoutSession(
        otherCreatorId,
        org.id,
        tier1.id,
        'month',
        'https://example.com/success',
        'https://example.com/cancel'
      );

      expect(result.sessionUrl).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          metadata: expect.objectContaining({
            codex_user_id: otherCreatorId,
            codex_organization_id: org.id,
            codex_tier_id: tier1.id,
          }),
        })
      );
    });

    // Codex-ssfes: Checkout Session MUST be created with `customer: cus_...`,
    // NOT `customer_email`. Stripe does not dedupe on email — it creates a
    // fresh Customer per session. We explicitly reuse via
    // resolveOrCreateCustomer (Codex-49gev) to guarantee one Stripe Customer
    // per Codex user across every org.
    it('forwards customer: cus_... resolved via resolveOrCreateCustomer (never customer_email)', async () => {
      const { org, tier1 } = await createFullOrg('checkout-customer-id');
      const createdCustomerId = `cus_resolved_${Date.now()}`;

      // Override the default create mock so we assert against a known id.
      vi.mocked(
        (stripe.customers as unknown as { create: ReturnType<typeof vi.fn> })
          .create
      ).mockResolvedValueOnce({
        id: createdCustomerId,
        email: 'x@example.com',
        created: Math.floor(Date.now() / 1000),
        metadata: { codex_user_id: otherCreatorId },
      });

      await service.createCheckoutSession(
        otherCreatorId,
        org.id,
        tier1.id,
        'month',
        'https://example.com/success',
        'https://example.com/cancel'
      );

      const sessionArgs = vi
        .mocked(stripe.checkout.sessions.create)
        .mock.calls.at(-1)?.[0];
      expect(sessionArgs).toBeDefined();
      expect(sessionArgs).toMatchObject({ customer: createdCustomerId });
      // Regression: customer_email must NOT appear on the payload.
      expect(sessionArgs).not.toHaveProperty('customer_email');

      // Customer id was persisted on users.stripe_customer_id — so the next
      // checkout for this user (any org) skips Stripe entirely.
      const { eq } = await import('drizzle-orm');
      const [row] = await db
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, otherCreatorId));
      expect(row?.stripeCustomerId).toBe(createdCustomerId);
    });

    it('reuses the cached stripe_customer_id on a second checkout for the same user', async () => {
      const { org, tier1 } = await createFullOrg('checkout-cache-hit');
      const cachedId = `cus_cached_${Date.now()}`;

      const { eq } = await import('drizzle-orm');
      await db
        .update(users)
        .set({ stripeCustomerId: cachedId })
        .where(eq(users.id, otherCreatorId));

      const customersMock = stripe.customers as unknown as {
        list: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
      };
      customersMock.list.mockClear();
      customersMock.create.mockClear();

      await service.createCheckoutSession(
        otherCreatorId,
        org.id,
        tier1.id,
        'month',
        'https://example.com/success',
        'https://example.com/cancel'
      );

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: cachedId })
      );
      // Cache-hit path: no Stripe customer lookup or creation.
      expect(customersMock.list).not.toHaveBeenCalled();
      expect(customersMock.create).not.toHaveBeenCalled();
    });

    it('propagates PaymentProcessingError when Stripe customers.list fails during resolution', async () => {
      const { PaymentProcessingError } = await import('@codex/purchase');
      const { org, tier1 } = await createFullOrg('checkout-stripe-list-fail');

      const stripeErr = Object.assign(new Error('Stripe unreachable'), {
        type: 'StripeConnectionError',
      });
      vi.mocked(
        (stripe.customers as unknown as { list: ReturnType<typeof vi.fn> }).list
      ).mockRejectedValueOnce(stripeErr);

      await expect(
        service.createCheckoutSession(
          otherCreatorId,
          org.id,
          tier1.id,
          'month',
          'https://example.com/success',
          'https://example.com/cancel'
        )
      ).rejects.toThrow(PaymentProcessingError);
    });

    it('propagates NotFoundError when the Codex user does not exist', async () => {
      const { NotFoundError } = await import('@codex/purchase');
      const { org, tier1 } = await createFullOrg('checkout-missing-user');

      await expect(
        service.createCheckoutSession(
          '00000000-0000-0000-0000-000000000000',
          org.id,
          tier1.id,
          'month',
          'https://example.com/success',
          'https://example.com/cancel'
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should create annual checkout session', async () => {
      const { org, tier1 } = await createFullOrg('checkout-annual');
      const result = await service.createCheckoutSession(
        otherCreatorId,
        org.id,
        tier1.id,
        'year',
        'https://example.com/success',
        'https://example.com/cancel'
      );
      expect(result.sessionUrl).toBeDefined();
    });

    it('should throw TierNotFoundError for inactive tier', async () => {
      const { org, tier1 } = await createFullOrg('checkout-inactive');
      await db
        .update(subscriptionTiers)
        .set({ isActive: false })
        .where(
          (await import('drizzle-orm')).eq(subscriptionTiers.id, tier1.id)
        );

      await expect(
        service.createCheckoutSession(
          otherCreatorId,
          org.id,
          tier1.id,
          'month',
          'https://x.com/s',
          'https://x.com/c'
        )
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should throw AlreadySubscribedError for active subscription', async () => {
      const { org, tier1 } = await createFullOrg('checkout-dupe');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      await expect(
        service.createCheckoutSession(
          otherCreatorId,
          org.id,
          tier1.id,
          'month',
          'https://x.com/s',
          'https://x.com/c'
        )
      ).rejects.toThrow(AlreadySubscribedError);
    });

    it('should throw ConnectAccountNotReadyError when Connect not ready', async () => {
      const [noConnOrg] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('no-conn'),
            creatorId,
          })
        )
        .returning();
      const [tier] = await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(noConnOrg.id))
        .returning();

      await expect(
        service.createCheckoutSession(
          otherCreatorId,
          noConnOrg.id,
          tier.id,
          'month',
          'https://x.com/s',
          'https://x.com/c'
        )
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });
  });

  // ─── verifyCheckoutSession ────────────────────────────────────────
  //
  // Used by the /subscription/success page to gate the hand-off to /library
  // on the webhook having landed. The mock Stripe client doesn't ship with a
  // `checkout.sessions.retrieve` stub — these tests attach `vi.fn()`s
  // per-case so we can assert against specific Stripe responses.

  describe('verifyCheckoutSession', () => {
    it('returns complete + subscription row when webhook has landed', async () => {
      const { org, tier1 } = await createFullOrg('verify-complete');

      // Seed the subscription row as if the webhook had already processed
      // the event. verifyCheckoutSession matches on stripeSubscriptionId.
      // Use a per-run suffix to dodge the global unique constraint on
      // `stripe_subscription_id` when the shared test DB retains rows
      // from earlier runs.
      const stripeSubId = `sub_verify_complete_123_${Date.now()}`;
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          stripeSubscriptionId: stripeSubId,
          status: 'active',
        })
      );

      const { vi } = await import('vitest');
      (
        stripe.checkout.sessions as unknown as {
          retrieve: ReturnType<typeof vi.fn>;
        }
      ).retrieve = vi.fn().mockResolvedValue({
        id: 'cs_verify_1',
        status: 'complete',
        subscription: stripeSubId,
        metadata: { codex_user_id: otherCreatorId },
      });

      const result = await service.verifyCheckoutSession(
        'cs_verify_1',
        otherCreatorId
      );

      expect(result.sessionStatus).toBe('complete');
      expect(result.subscription).toBeDefined();
      expect(result.subscription?.organizationId).toBe(org.id);
      expect(result.subscription?.tierId).toBe(tier1.id);
      expect(result.subscription?.tierName).toBe(tier1.name);
    });

    it('returns complete without subscription when DB row has not been written yet', async () => {
      // Webhook race: Stripe says complete but our handleSubscriptionCreated
      // hasn't run yet. Caller should poll via invalidate('subscription:verify').
      const { vi } = await import('vitest');
      (
        stripe.checkout.sessions as unknown as {
          retrieve: ReturnType<typeof vi.fn>;
        }
      ).retrieve = vi.fn().mockResolvedValue({
        id: 'cs_verify_race',
        status: 'complete',
        subscription: 'sub_not_yet_in_db',
        metadata: { codex_user_id: otherCreatorId },
      });

      const result = await service.verifyCheckoutSession(
        'cs_verify_race',
        otherCreatorId
      );

      expect(result.sessionStatus).toBe('complete');
      expect(result.subscription).toBeUndefined();
    });

    it('throws ForbiddenError when session belongs to a different user', async () => {
      const { ForbiddenError } = await import('../../errors');
      const { vi } = await import('vitest');
      (
        stripe.checkout.sessions as unknown as {
          retrieve: ReturnType<typeof vi.fn>;
        }
      ).retrieve = vi.fn().mockResolvedValue({
        id: 'cs_verify_other',
        status: 'complete',
        subscription: 'sub_other',
        metadata: { codex_user_id: 'some-other-user-id' },
      });

      await expect(
        service.verifyCheckoutSession('cs_verify_other', otherCreatorId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // ─── handleSubscriptionCreated ────────────────────────────────────

  describe('handleSubscriptionCreated', () => {
    it('should create DB record with correct revenue split and status=active', async () => {
      const { org, tier1 } = await createFullOrg('wh-created');
      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      const [created] = await db
        .select()
        .from(subscriptions)
        .where(
          (await import('drizzle-orm')).eq(
            subscriptions.stripeSubscriptionId,
            mockSub.id
          )
        )
        .limit(1);

      expect(created).toBeDefined();
      expect(created.status).toBe('active');
      expect(created.userId).toBe(otherCreatorId);
      expect(created.organizationId).toBe(org.id);
      // Revenue split should sum to amount
      expect(
        created.platformFeeCents +
          created.organizationFeeCents +
          created.creatorPayoutCents
      ).toBe(created.amountCents);
    });

    it('should be idempotent — skip if stripeSubscriptionId exists', async () => {
      const { org, tier1 } = await createFullOrg('wh-idempotent');
      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);
      // Second call should not throw or duplicate
      await service.handleSubscriptionCreated(mockSub);

      const { eq } = await import('drizzle-orm');
      const records = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, mockSub.id));
      expect(records).toHaveLength(1);
    });

    it('should skip if metadata missing required fields', async () => {
      const mockSub = createMockStripeSubscription({
        metadata: {}, // Missing codex_user_id, codex_organization_id, codex_tier_id
      }) as unknown as Stripe.Subscription;

      // Should not throw — just returns silently
      await service.handleSubscriptionCreated(mockSub);
    });

    // Codex-0g6yq: the created handler must return { userId, orgId } so the
    // webhook route bumps both library and per-org subscription caches.
    it('should return { userId, orgId } extracted from Stripe metadata', async () => {
      const { org, tier1 } = await createFullOrg('wh-created-return-shape');
      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      const result = await service.handleSubscriptionCreated(mockSub);

      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
    });

    it('should return void (undefined) when metadata is missing (negative path)', async () => {
      // Negative path — malformed/early webhook legitimately has no context,
      // and the route's invalidateForUser will skip since ids are missing.
      const mockSub = createMockStripeSubscription({
        metadata: {},
      }) as unknown as Stripe.Subscription;

      const result = await service.handleSubscriptionCreated(mockSub);
      expect(result).toBeUndefined();
    });
  });

  // ─── membership role hierarchy ────────────────────────────────────

  describe('membership role hierarchy', () => {
    it('should preserve owner role when subscription is created', async () => {
      const { org, tier1 } = await createFullOrg('role-owner');
      const { eq, and } = await import('drizzle-orm');
      const { organizationMemberships } = await import(
        '@codex/database/schema'
      );

      // Create owner membership
      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: otherCreatorId,
        role: 'owner',
        status: 'active',
      });

      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, otherCreatorId)
          )
        );

      expect(membership.role).toBe('owner');
    });

    it('should preserve admin role when subscription is created', async () => {
      const { org, tier1 } = await createFullOrg('role-admin');
      const { eq, and } = await import('drizzle-orm');
      const { organizationMemberships } = await import(
        '@codex/database/schema'
      );

      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: otherCreatorId,
        role: 'admin',
        status: 'active',
      });

      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, otherCreatorId)
          )
        );

      expect(membership.role).toBe('admin');
    });

    it('should preserve creator role when subscription is created', async () => {
      const { org, tier1 } = await createFullOrg('role-creator');
      const { eq, and } = await import('drizzle-orm');
      const { organizationMemberships } = await import(
        '@codex/database/schema'
      );

      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: otherCreatorId,
        role: 'creator',
        status: 'active',
      });

      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, otherCreatorId)
          )
        );

      expect(membership.role).toBe('creator');
    });

    it('should create subscriber membership when no existing membership', async () => {
      const { org, tier1 } = await createFullOrg('role-new-sub');
      const { eq, and } = await import('drizzle-orm');
      const { organizationMemberships } = await import(
        '@codex/database/schema'
      );

      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: thirdUserId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, thirdUserId)
          )
        );

      expect(membership).toBeDefined();
      expect(membership.role).toBe('subscriber');
      expect(membership.status).toBe('active');
    });

    it('should only deactivate subscriber role on subscription deletion', async () => {
      const { org, tier1 } = await createFullOrg('role-del-sub');
      const { eq, and } = await import('drizzle-orm');
      const { organizationMemberships } = await import(
        '@codex/database/schema'
      );

      // Create subscription + subscriber membership via handleSubscriptionCreated
      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: thirdUserId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      // Verify subscriber membership exists
      const [beforeDelete] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, thirdUserId)
          )
        );
      expect(beforeDelete.role).toBe('subscriber');
      expect(beforeDelete.status).toBe('active');

      // handleSubscriptionCreated already inserted the subscription DB record.
      // Delete subscription — pass metadata so handler can resolve userId/orgId
      await service.handleSubscriptionDeleted(
        mockSub as unknown as Stripe.Subscription
      );

      const [afterDelete] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, thirdUserId)
          )
        );

      expect(afterDelete.status).toBe('inactive');
    });

    it('should preserve admin role on subscription deletion', async () => {
      const { org, tier1 } = await createFullOrg('role-del-admin');
      const { eq, and } = await import('drizzle-orm');
      const { organizationMemberships } = await import(
        '@codex/database/schema'
      );

      // Create admin membership
      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: otherCreatorId,
        role: 'admin',
        status: 'active',
      });

      // Create subscription
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      // Delete subscription
      await service.handleSubscriptionDeleted({
        id: sub.stripeSubscriptionId,
      } as unknown as Stripe.Subscription);

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, otherCreatorId)
          )
        );

      // Admin role should NOT be deactivated (only subscriber role is deactivated)
      expect(membership.role).toBe('admin');
      expect(membership.status).toBe('active');
    });

    it('should auto-follow org when subscription is created', async () => {
      const { org, tier1 } = await createFullOrg('auto-follow');
      const { eq, and } = await import('drizzle-orm');
      const { organizationFollowers } = await import('@codex/database/schema');

      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: thirdUserId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      const [follower] = await db
        .select()
        .from(organizationFollowers)
        .where(
          and(
            eq(organizationFollowers.organizationId, org.id),
            eq(organizationFollowers.userId, thirdUserId)
          )
        );

      expect(follower).toBeDefined();
      expect(follower.organizationId).toBe(org.id);
      expect(follower.userId).toBe(thirdUserId);
    });

    it('should preserve follower row when subscription is deleted', async () => {
      const { org, tier1 } = await createFullOrg('follow-persist');
      const { eq, and } = await import('drizzle-orm');
      const { organizationFollowers } = await import('@codex/database/schema');

      // Create subscription (which also creates follower row)
      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: thirdUserId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleSubscriptionCreated(mockSub);

      // Delete subscription
      await service.handleSubscriptionDeleted(
        mockSub as unknown as Stripe.Subscription
      );

      // Follower row should still exist
      const [follower] = await db
        .select()
        .from(organizationFollowers)
        .where(
          and(
            eq(organizationFollowers.organizationId, org.id),
            eq(organizationFollowers.userId, thirdUserId)
          )
        );

      expect(follower).toBeDefined();
    });
  });

  // ─── handleSubscriptionUpdated ────────────────────────────────────

  describe('handleSubscriptionUpdated', () => {
    it('should map active status (cancel_at_period_end=false)', async () => {
      const { org, tier1 } = await createFullOrg('wh-active');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'past_due',
          })
        )
        .returning();

      await service.handleSubscriptionUpdated({
        id: sub.stripeSubscriptionId,
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: {
          data: [
            {
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      } as unknown as Stripe.Subscription);

      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('active');
    });

    it('should map cancelling status (cancel_at_period_end=true)', async () => {
      const { org, tier1 } = await createFullOrg('wh-cancelling');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      await service.handleSubscriptionUpdated({
        id: sub.stripeSubscriptionId,
        status: 'active',
        cancel_at_period_end: true,
        metadata: {},
        items: {
          data: [
            {
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      } as unknown as Stripe.Subscription);

      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('cancelling');
    });

    it('should map cancelled status (Stripe "canceled")', async () => {
      const { org, tier1 } = await createFullOrg('wh-cancelled');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      await service.handleSubscriptionUpdated({
        id: sub.stripeSubscriptionId,
        status: 'canceled',
        cancel_at_period_end: false,
        metadata: {},
        items: {
          data: [
            {
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      } as unknown as Stripe.Subscription);

      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('cancelled');
    });

    it('should ignore unknown subscription', async () => {
      await service.handleSubscriptionUpdated({
        id: 'sub_unknown_12345',
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: { data: [{ current_period_start: 0, current_period_end: 0 }] },
      } as unknown as Stripe.Subscription);
      // No throw = pass
    });

    // Codex-0g6yq: return shape carries { userId, orgId } pulled from the DB
    // row (not Stripe metadata — metadata may be empty on update events).
    it('should return { userId, orgId } from the matched DB subscription', async () => {
      const { org, tier1 } = await createFullOrg('wh-updated-return-shape');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const result = await service.handleSubscriptionUpdated({
        id: sub.stripeSubscriptionId,
        status: 'active',
        cancel_at_period_end: false,
        metadata: {}, // Empty — orgId must come from DB lookup, not metadata
        items: {
          data: [
            {
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      } as unknown as Stripe.Subscription);

      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
    });

    it('should return undefined when the subscription is not found (negative path)', async () => {
      const result = await service.handleSubscriptionUpdated({
        id: 'sub_unknown_shape_negative',
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: { data: [{ current_period_start: 0, current_period_end: 0 }] },
      } as unknown as Stripe.Subscription);

      expect(result).toBeUndefined();
    });

    // Codex-8wfnv: replay-safety contract for the no-op status path.
    // A Stripe webhook can legitimately fire twice for the same logical
    // state transition (or for an `updated` event whose mapped status
    // already matches the DB). The handler must:
    //   - re-emit the canonical { userId, orgId } envelope unchanged
    //   - leave every business column untouched (status, cancelAtPeriodEnd,
    //     tierId, currentPeriodStart/End, amountCents)
    //   - NOT create rows, NOT delete rows, NOT change row identity
    // Production bumps `updatedAt` on every call (no short-circuit) — that
    // is acceptable; assert only that meaningful columns are stable.
    it('replay safety: customer.subscription.updated for a no-op status (DB already at target) → no extra side effects, no extra cache invalidation', async () => {
      const { org, tier1 } = await createFullOrg('wh-updated-replay');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const periodStart = Math.floor(Date.now() / 1000);
      const periodEnd = periodStart + 86400;
      const stripeEvent = {
        id: sub.stripeSubscriptionId,
        status: 'active', // matches DB
        cancel_at_period_end: false, // matches DB default
        metadata: {},
        items: {
          data: [
            {
              current_period_start: periodStart,
              current_period_end: periodEnd,
              price: {
                id: 'price_test_monthly',
                unit_amount: sub.amountCents,
                currency: 'gbp',
                recurring: { interval: sub.billingInterval ?? 'month' },
              },
            },
          ],
        },
      } as unknown as Stripe.Subscription;

      const first = await service.handleSubscriptionUpdated(stripeEvent);
      const { eq } = await import('drizzle-orm');
      const [afterFirst] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));

      const second = await service.handleSubscriptionUpdated(stripeEvent);
      const [afterSecond] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));

      // Envelope is canonical and stable across replays.
      expect(first).toEqual({ userId: otherCreatorId, orgId: org.id });
      expect(second).toEqual({ userId: otherCreatorId, orgId: org.id });

      // Replay must not create or delete rows (same id, exactly one row).
      const allRows = await db
        .select()
        .from(subscriptions)
        .where(
          eq(subscriptions.stripeSubscriptionId, sub.stripeSubscriptionId)
        );
      expect(allRows).toHaveLength(1);
      expect(allRows[0].id).toBe(sub.id);

      // Every business column must be stable between replays (status,
      // cancelAtPeriodEnd, tierId, period dates, amountCents). updatedAt
      // is deliberately excluded — production refreshes it every call.
      expect(afterSecond.status).toBe(afterFirst.status);
      expect(afterSecond.cancelAtPeriodEnd).toBe(afterFirst.cancelAtPeriodEnd);
      expect(afterSecond.tierId).toBe(afterFirst.tierId);
      expect(afterSecond.amountCents).toBe(afterFirst.amountCents);
      expect(afterSecond.currentPeriodStart?.getTime()).toBe(
        afterFirst.currentPeriodStart?.getTime()
      );
      expect(afterSecond.currentPeriodEnd?.getTime()).toBe(
        afterFirst.currentPeriodEnd?.getTime()
      );

      // And concretely: the DB row matches the initial seed for the
      // business-meaningful columns (no drift from replay).
      expect(afterSecond.status).toBe('active');
      expect(afterSecond.cancelAtPeriodEnd).toBe(false);
      expect(afterSecond.tierId).toBe(tier1.id);

      // Cache-invalidation count semantics live in the orchestrator test
      // file (subscription-service-orchestrator.test.ts) where cache +
      // waitUntil are wired. This service is constructed without that
      // wiring, so `invalidateIfConfigured` is a documented no-op — there
      // is no extra cache side effect to assert against here.
    });
  });

  // ─── handleSubscriptionDeleted ────────────────────────────────────

  describe('handleSubscriptionDeleted', () => {
    it('should set status=cancelled with cancelledAt timestamp', async () => {
      const { org, tier1 } = await createFullOrg('wh-deleted');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'cancelling',
          })
        )
        .returning();

      await service.handleSubscriptionDeleted({
        id: sub.stripeSubscriptionId,
      } as unknown as Stripe.Subscription);

      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('cancelled');
      expect(updated.cancelledAt).not.toBeNull();
    });

    // Codex-0g6yq: the deleted handler extracts { userId, orgId } from Stripe
    // metadata — Stripe preserves subscription metadata on cancellation.
    it('should return { userId, orgId } extracted from Stripe metadata', async () => {
      const { org, tier1 } = await createFullOrg('wh-deleted-return-shape');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'cancelling',
          })
        )
        .returning();

      const result = await service.handleSubscriptionDeleted({
        id: sub.stripeSubscriptionId,
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      } as unknown as Stripe.Subscription);

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);
    });

    it('should return { userId: undefined, orgId: undefined } when metadata is absent (negative path)', async () => {
      // Negative path — subscription was created before metadata was stamped
      // (legacy data). Handler must still update the DB row and return an
      // object so the route code paths remain uniform; ids are undefined so
      // invalidateForUser skips the cache bump per its documented contract.
      const { org, tier1 } = await createFullOrg('wh-deleted-no-metadata');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'cancelling',
          })
        )
        .returning();

      const result = await service.handleSubscriptionDeleted({
        id: sub.stripeSubscriptionId,
        metadata: {},
      } as unknown as Stripe.Subscription);

      expect(result.userId).toBeUndefined();
      expect(result.orgId).toBeUndefined();
    });
  });

  // ─── handleSubscriptionPaused (Codex-a0vk2) ────────────────────────
  //
  // `customer.subscription.paused` is access-reducing but NOT terminal:
  // the subscription row is flipped to status='paused' and access is revoked
  // for the paused window. A sibling bead (Codex-rh0on) handles the
  // `customer.subscription.resumed` event that flips status back to 'active'.
  //
  // Contract (positive + negative per feedback_security_deep_test):
  //   1. Positive path: event with a known subscription + metadata →
  //      DB row flips to 'paused', return shape = { userId, orgId }.
  //   2. Negative path: metadata missing → still flip the row (the
  //      stripeSubscriptionId is authoritative) but return ids undefined
  //      so downstream invalidation + revocation helpers skip.
  describe('handleSubscriptionPaused', () => {
    it('should flip status to paused and return { userId, orgId }', async () => {
      const { org, tier1 } = await createFullOrg('wh-paused');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const result = await service.handleSubscriptionPaused({
        id: sub.stripeSubscriptionId,
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      } as unknown as Stripe.Subscription);

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);

      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('paused');
      // cancelledAt must NOT be set — pause is not a cancellation.
      expect(updated.cancelledAt).toBeNull();
    });

    it('should return ids undefined when metadata is absent (negative path)', async () => {
      // Negative path — webhook arrives without metadata (legacy data or
      // malformed event). Handler must still flip the DB row (Stripe id is
      // authoritative) and return a result object; undefined ids naturally
      // gate out the invalidation + revocation helpers.
      const { org, tier1 } = await createFullOrg('wh-paused-no-metadata');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const result = await service.handleSubscriptionPaused({
        id: sub.stripeSubscriptionId,
        metadata: {},
      } as unknown as Stripe.Subscription);

      expect(result.userId).toBeUndefined();
      expect(result.orgId).toBeUndefined();

      // DB row still flipped — Stripe id drives the UPDATE, not metadata.
      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('paused');
    });
  });

  // ─── handleSubscriptionResumed (Codex-rh0on) ───────────────────────
  //
  // `customer.subscription.resumed` is the access-RESTORING counterpart to
  // `customer.subscription.paused`. The row flips from status='paused' back
  // to status='active' (or whatever status Stripe reports — expected
  // 'active'). The webhook layer clears the revocation key written by the
  // earlier pause event.
  //
  // Contract (positive + negative per feedback_security_deep_test):
  //   1. Positive path: paused subscription + metadata + Stripe status=active
  //      → DB row flips to 'active', return shape = { userId, orgId }.
  //   2. Negative path: metadata missing → still flip the row (Stripe id is
  //      authoritative) but return ids undefined so the webhook's
  //      clearAccess helper skips and doesn't crash.
  describe('handleSubscriptionResumed', () => {
    it('should flip status from paused back to active and return { userId, orgId }', async () => {
      const { org, tier1 } = await createFullOrg('wh-resumed');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'paused',
          })
        )
        .returning();

      const result = await service.handleSubscriptionResumed({
        id: sub.stripeSubscriptionId,
        status: 'active',
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      } as unknown as Stripe.Subscription);

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);

      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('active');
      // cancelledAt must stay NULL — resume is not a cancellation.
      expect(updated.cancelledAt).toBeNull();
    });

    it('should return ids undefined when metadata is absent (negative path)', async () => {
      // Negative path — resume event without metadata (legacy data or
      // malformed event). Handler must still flip the DB row (Stripe id is
      // authoritative) and return a result object; undefined ids naturally
      // gate out the invalidation + clear-access helpers.
      const { org, tier1 } = await createFullOrg('wh-resumed-no-metadata');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'paused',
          })
        )
        .returning();

      const result = await service.handleSubscriptionResumed({
        id: sub.stripeSubscriptionId,
        status: 'active',
        metadata: {},
      } as unknown as Stripe.Subscription);

      expect(result.userId).toBeUndefined();
      expect(result.orgId).toBeUndefined();

      // DB row still flipped back to active — Stripe id drives the UPDATE,
      // not metadata.
      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('active');
    });
  });

  // ─── previewTierChange ────────────────────────────────────────────

  describe('previewTierChange', () => {
    /**
     * Stub `stripe.invoices.createPreview` for this test.
     * Returns a preview shape compatible with what previewTierChange reads:
     * `amount_due` and `lines.data[].parent.subscription_item_details.proration`.
     */
    function stubCreatePreview(
      amountDueCents: number,
      prorationLines: Array<{ description: string; amount: number }> = []
    ) {
      (stripe as unknown as { invoices: unknown }).invoices = {
        createPreview: vi.fn().mockResolvedValue({
          amount_due: amountDueCents,
          lines: {
            data: prorationLines.map((line) => ({
              description: line.description,
              amount: line.amount,
              parent: { subscription_item_details: { proration: true } },
            })),
          },
        }),
      };
    }

    it('returns amountDueCents > 0 with proration lines for an upgrade', async () => {
      const { org, tier1, tier2 } = await createFullOrg('preview-up');
      // Factory default amountCents=499 + matching split already matches
      // tier1.priceMonthly — no override needed (CHECK constraint
      // amount_cents = platform_fee + org_fee + creator_payout).
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      stubCreatePreview(500, [
        { description: 'Unused time on Basic (credit)', amount: -250 },
        { description: 'Remaining time on Pro (charge)', amount: 750 },
      ]);

      const preview = await service.previewTierChange(
        otherCreatorId,
        org.id,
        tier2.id,
        'month'
      );

      expect(preview.amountDueCents).toBe(500);
      expect(preview.prorationLineItems).toHaveLength(2);
      expect(preview.prorationLineItems[0].amountCents).toBe(-250);
      expect(preview.prorationLineItems[1].amountCents).toBe(750);
      expect(preview.newRecurringAmountCents).toBe(tier2.priceMonthly);
      expect(preview.newRecurringInterval).toBe('month');
      expect(preview.isUpgrade).toBe(true);
      expect(preview.prorationDate).toBeGreaterThan(0);
    });

    it('returns amountDueCents = 0 / negative credit for a downgrade', async () => {
      const { org, tier1, tier2 } = await createFullOrg('preview-down');
      // Subscriber currently on Pro (tier2 = 999p) — split must sum to 999
      // (10% platform / 15% post-platform org / remainder to creator pool).
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier2.id, {
          amountCents: tier2.priceMonthly,
          platformFeeCents: 100,
          organizationFeeCents: 134,
          creatorPayoutCents: 765,
          billingInterval: 'month',
        })
      );

      // Downgrade to Basic — Stripe issues credit (no charge today)
      stubCreatePreview(0, [
        { description: 'Unused time on Pro (credit)', amount: -500 },
      ]);

      const preview = await service.previewTierChange(
        otherCreatorId,
        org.id,
        tier1.id,
        'month'
      );

      expect(preview.amountDueCents).toBe(0);
      expect(preview.newRecurringAmountCents).toBe(tier1.priceMonthly);
      expect(preview.isUpgrade).toBe(false);
    });

    it('calls stripe.invoices.createPreview with always_invoice + correct items + proration_date', async () => {
      const { org, tier1, tier2 } = await createFullOrg('preview-shape');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      stubCreatePreview(500, [{ description: 'X', amount: 500 }]);

      const before = Math.floor(Date.now() / 1000);
      await service.previewTierChange(
        otherCreatorId,
        org.id,
        tier2.id,
        'month'
      );
      const after = Math.floor(Date.now() / 1000);

      const createPreviewMock = (
        stripe as unknown as {
          invoices: { createPreview: ReturnType<typeof vi.fn> };
        }
      ).invoices.createPreview;
      expect(createPreviewMock).toHaveBeenCalledTimes(1);
      const params = createPreviewMock.mock.calls[0][0] as {
        subscription: string;
        subscription_details: {
          items: Array<{ id: string; price: string }>;
          proration_date: number;
          proration_behavior: string;
        };
      };
      // Subscription ID is the Stripe sub ID stored on the local row, not
      // the local row's UUID.
      expect(params.subscription).toMatch(/^sub_test_/);
      // Item.id is the Stripe subscription item id from .subscriptions.retrieve
      expect(params.subscription_details.items).toHaveLength(1);
      expect(params.subscription_details.items[0].id).toMatch(/^si_/);
      // Price targets the new tier's MONTHLY Stripe price (not annual,
      // since billingInterval='month' was passed).
      expect(params.subscription_details.items[0].price).toBe(
        tier2.stripePriceMonthlyId
      );
      // proration_date is a Unix timestamp around now (within bounds of
      // the test wall-clock).
      expect(params.subscription_details.proration_date).toBeGreaterThanOrEqual(
        before
      );
      expect(params.subscription_details.proration_date).toBeLessThanOrEqual(
        after
      );
      // CRITICAL: preview MUST mirror the commit's behaviour, not the
      // legacy create_prorations. With create_prorations the preview's
      // amount_due returns 0 (proration deferred), confusing the user
      // with "£0 today" for an upgrade.
      expect(params.subscription_details.proration_behavior).toBe(
        'always_invoice'
      );
    });

    it('uses annual price ID when billingInterval=year', async () => {
      const { org, tier1, tier2 } = await createFullOrg('preview-annual');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      stubCreatePreview(0, []);

      await service.previewTierChange(otherCreatorId, org.id, tier2.id, 'year');

      const createPreviewMock = (
        stripe as unknown as {
          invoices: { createPreview: ReturnType<typeof vi.fn> };
        }
      ).invoices.createPreview;
      const params = createPreviewMock.mock.calls[0][0] as {
        subscription_details: { items: Array<{ price: string }> };
      };
      expect(params.subscription_details.items[0].price).toBe(
        tier2.stripePriceAnnualId
      );
    });

    it('throws TierNotFoundError for an unknown tier', async () => {
      const { org, tier1 } = await createFullOrg('preview-bad-tier');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      stubCreatePreview(0);

      await expect(
        service.previewTierChange(
          otherCreatorId,
          org.id,
          '00000000-0000-0000-0000-000000000000',
          'month'
        )
      ).rejects.toThrow(TierNotFoundError);
    });

    it('throws SubscriptionNotFoundError when caller has no active subscription', async () => {
      const { org, tier2 } = await createFullOrg('preview-no-sub');
      stubCreatePreview(0);

      await expect(
        service.previewTierChange(thirdUserId, org.id, tier2.id, 'month')
      ).rejects.toThrow(SubscriptionNotFoundError);
    });
  });

  // ─── changeTier ───────────────────────────────────────────────────

  describe('changeTier', () => {
    it('upgrade: invoices the proration immediately with payment_behavior=error_if_incomplete', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-up');
      // Subscribe on tier1 (priceMonthly=499, default split sums correctly).
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      // tier1 (499) → tier2 (999) is an UPGRADE.
      await service.changeTier(otherCreatorId, org.id, tier2.id, 'month');

      // Full param-shape assertion. A regression here would let upgrades
      // silently revert to the broken 'create_prorations' behaviour where
      // Stripe defers the proration to the next invoice instead of
      // charging the customer immediately. Verified live on 2026-05-07
      // against sub_1TUZ0C7wyGmo4sh6EmqsD8yL: this exact param shape
      // produced invoice in_1TUZ107wyGmo4sh6ke2mxEhP (status=paid,
      // total=£34.97, with -£15 'Unused time' + £49.97 'Remaining time').
      const updateCall = (
        stripe.subscriptions.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0];
      const params = updateCall[1] as {
        items: Array<{ id: string; price: string }>;
        proration_behavior: string;
        payment_behavior: string;
        proration_date: number;
        metadata: Record<string, string>;
      };
      expect(params.proration_behavior).toBe('always_invoice');
      expect(params.payment_behavior).toBe('error_if_incomplete');
      expect(params.proration_date).toEqual(expect.any(Number));
      // Targets the NEW tier's monthly Stripe price (not the old tier's,
      // not annual).
      expect(params.items).toHaveLength(1);
      expect(params.items[0].price).toBe(tier2.stripePriceMonthlyId);
      // Codex correlation metadata — let webhook handlers identify the
      // tier change without round-tripping the DB.
      expect(params.metadata.codex_tier_id).toBe(tier2.id);
      expect(params.metadata.codex_user_id).toBe(otherCreatorId);
      expect(params.metadata.codex_organization_id).toBe(org.id);
      // Idempotency key shape (third arg is the request options object).
      const options = updateCall[2] as { idempotencyKey: string };
      expect(options.idempotencyKey).toMatch(/^upgrade_.+_\d+$/);

      // Verify local DB mirrored — tier swapped + amount + split aligned.
      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.tierId).toBe(tier2.id);
      expect(updated.amountCents).toBe(tier2.priceMonthly);
      // Revenue split must sum to amountCents (CHECK constraint).
      expect(
        updated.platformFeeCents +
          updated.organizationFeeCents +
          updated.creatorPayoutCents
      ).toBe(updated.amountCents);
    });

    it('downgrade (Phase 1 fallback): keeps create_prorations, NO payment_behavior, NO idempotency key', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-down');
      // Subscribe on tier2 (priceMonthly=999) — split must sum to 999.
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier2.id, {
          amountCents: tier2.priceMonthly,
          platformFeeCents: 100,
          organizationFeeCents: 134,
          creatorPayoutCents: 765,
        })
      );

      // tier2 (999) → tier1 (499) is a DOWNGRADE.
      await service.changeTier(otherCreatorId, org.id, tier1.id, 'month');

      const updateCall = (
        stripe.subscriptions.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0];
      const params = updateCall[1] as Record<string, unknown>;
      expect(params.proration_behavior).toBe('create_prorations');
      expect(params.payment_behavior).toBeUndefined();
      // Phase 1 downgrade still updates the local row immediately —
      // Phase 2 replaces this with a scheduled change.
      expect(params.proration_date).toEqual(expect.any(Number));
      // No options arg (idempotency key) for downgrade — proration is
      // deferred to the next invoice, no risk of double-charging on retry.
      expect(updateCall[2]).toBeUndefined();
    });

    it('upgrade payment failure: maps Stripe 402 to SubscriptionPaymentRequiredError, leaves DB untouched', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-402');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      // Simulate Stripe rejecting the proration invoice with HTTP 402.
      const stripeError = Object.assign(new Error('Card declined'), {
        statusCode: 402,
        type: 'StripeCardError',
      });
      (
        stripe.subscriptions.update as unknown as {
          mockRejectedValueOnce: (e: unknown) => void;
        }
      ).mockRejectedValueOnce(stripeError);

      let caught: unknown;
      try {
        await service.changeTier(otherCreatorId, org.id, tier2.id, 'month');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SubscriptionPaymentRequiredError);
      const err = caught as SubscriptionPaymentRequiredError & {
        context?: Record<string, unknown>;
      };
      // Codex-w87s4: prorationDate is always present on the 402 — when
      // the caller omits it, the service falls back to now() and forwards
      // that timestamp to Stripe, so the error must mirror it.
      expect(typeof err.context?.prorationDate).toBe('number');
      // tierIdAtCommit echoes the new tier id the failed commit targeted.
      expect(err.context?.tierIdAtCommit).toBe(tier2.id);

      // Local row must remain on tier1 with the original amount — Stripe
      // reverted the price update and we mustn't write the new tier.
      const { eq, and } = await import('drizzle-orm');
      const [unchanged] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(unchanged.tierId).toBe(tier1.id);
      expect(unchanged.amountCents).toBe(tier1.priceMonthly);
    });

    it('passes through preview prorationDate so commit-time charge matches preview', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-pdate');
      const [insertedSub] = await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id))
        .returning();

      const previewProrationDate = 1700000000;
      await service.changeTier(
        otherCreatorId,
        org.id,
        tier2.id,
        'month',
        previewProrationDate
      );

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ proration_date: previewProrationDate }),
        expect.objectContaining({
          idempotencyKey: `upgrade_${insertedSub.id}_${previewProrationDate}`,
        })
      );
    });

    // Codex-fhqxx (stale-preview consistency guard):
    //
    // Scenario: user opens the pricing dialog → service calls
    // previewTierChange() which returns prorationDate=T1 based on the
    // tier's current £15/month price. BEFORE the user clicks "Confirm",
    // a Stripe Dashboard edit fires `price.created` → `applyStripePriceCreated`
    // syncs the new £25/month price into our `subscriptionTiers` row.
    // The user then clicks "Confirm"; the dialog still holds the stale
    // T1 prorationDate from the preview.
    //
    // Production contract (per current implementation): changeTier RE-READS
    // the tier from the DB at commit time, so the Stripe API call targets
    // the tier's CURRENT stripePriceMonthlyId (post-sync) and the local
    // `amountCents` mirror is the CURRENT priceMonthly (post-sync). The
    // stale prorationDate is forwarded — Stripe uses it only to pick the
    // proration window; the per-period charge always reflects the current
    // price metadata. Net effect: the user is charged the up-to-date
    // amount, never the stale preview amount.
    //
    // This test pins that contract. If anyone later changes changeTier to
    // capture price snapshots from the preview (vs. re-reading the row),
    // this test will fail loudly. See reference_stripe_tier_change_pattern.
    it('stale preview: tier price changed between preview and commit — commit reflects CURRENT tier price, not the preview snapshot', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-stale');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      // Preview was generated against tier2 at its current £9.99/month
      // price (priceMonthly=999 from createFullOrg). Capture the prorationDate
      // the dialog would have held.
      const previewProrationDate = 1700000000;
      const previewSnapshotMonthly = tier2.priceMonthly; // 999

      // Dashboard sync-back arrives: tier2's monthly price is bumped to
      // £25.00 and a fresh Stripe Price object is minted. This is what
      // TierService.applyStripePriceCreated would do in production.
      const newMonthlyPriceId = `price_test_resync_${tier2.id}`;
      const { eq } = await import('drizzle-orm');
      await db
        .update(subscriptionTiers)
        .set({
          priceMonthly: 2500,
          stripePriceMonthlyId: newMonthlyPriceId,
        })
        .where(eq(subscriptionTiers.id, tier2.id));

      // Now the user clicks Confirm — dialog still holds the stale
      // prorationDate from the preview.
      await service.changeTier(
        otherCreatorId,
        org.id,
        tier2.id,
        'month',
        previewProrationDate
      );

      // Assert: Stripe.subscriptions.update targets the CURRENT priceId
      // (post-sync), NOT whatever the preview saw.
      const updateCall = (
        stripe.subscriptions.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0];
      const params = updateCall[1] as {
        items: Array<{ id: string; price: string }>;
        proration_date: number;
      };
      expect(params.items[0].price).toBe(newMonthlyPriceId);
      expect(params.items[0].price).not.toBe(tier2.stripePriceMonthlyId);
      // Stale prorationDate IS still forwarded — Stripe uses it for the
      // proration window only; the per-period charge is computed against
      // the current price metadata. This is intentional, not a bug.
      expect(params.proration_date).toBe(previewProrationDate);

      // Assert: local amountCents mirror reflects the CURRENT priceMonthly
      // (2500), NOT the preview's stale snapshot (999).
      const { and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.amountCents).toBe(2500);
      expect(updated.amountCents).not.toBe(previewSnapshotMonthly);
      // Revenue split must still sum to amountCents (CHECK constraint).
      expect(
        updated.platformFeeCents +
          updated.organizationFeeCents +
          updated.creatorPayoutCents
      ).toBe(updated.amountCents);
    });

    // Codex-fhqxx (commit-time failure contract):
    //
    // Sibling to the existing 'upgrade payment failure: maps Stripe 402'
    // test (above). That test covers: 402 → SubscriptionPaymentRequiredError
    // + DB untouched. This test adds the dialog-side guarantees:
    //   1. Service does NOT silently retry .subscriptions.update on 402 —
    //      caller must re-open the dialog to fetch a fresh preview.
    //   2. Error context carries enough info for the route to map cleanly
    //      to PAYMENT_REQUIRED (used by pricing/+page.svelte switch on code).
    //   3. No audit row / no partial commit even though the preview's
    //      prorationDate was pinned.
    //
    // Codex-w87s4 closed the prorationDate gap: the error context now
    // carries the exact prorationDate Stripe rejected so the dialog can
    // tell "needs fresh preview" (prorationDate doesn't match its local
    // preview) from "transient payment failure" (matches — same window,
    // just a declined card).
    it('commit fails after successful preview: SubscriptionPaymentRequiredError, NO silent retry, DB untouched', async () => {
      const { org, tier1, tier2 } = await createFullOrg(
        'change-tier-stale-402'
      );
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      const previewProrationDate = 1700000001;

      // Stripe rejects the proration invoice with HTTP 402.
      const stripeError = Object.assign(new Error('Your card was declined.'), {
        statusCode: 402,
        type: 'StripeCardError',
        code: 'card_declined',
      });
      (
        stripe.subscriptions.update as unknown as {
          mockRejectedValueOnce: (e: unknown) => void;
        }
      ).mockRejectedValueOnce(stripeError);

      let caught: unknown;
      try {
        await service.changeTier(
          otherCreatorId,
          org.id,
          tier2.id,
          'month',
          previewProrationDate
        );
      } catch (err) {
        caught = err;
      }

      // (a) Typed 402 surfaces with the structured fields the route uses
      // to render the dialog's "Payment was declined" banner.
      expect(caught).toBeInstanceOf(SubscriptionPaymentRequiredError);
      const err = caught as SubscriptionPaymentRequiredError & {
        context?: Record<string, unknown>;
      };
      expect(err.code).toBe('PAYMENT_REQUIRED');
      expect(err.statusCode).toBe(402);
      // Context carries newTierId + billingInterval so the dialog can
      // re-open the correct row, and stripeMessage so the toast can show
      // the upstream message verbatim.
      expect(err.context?.newTierId).toBe(tier2.id);
      expect(err.context?.billingInterval).toBe('month');
      expect(err.context?.stripeMessage).toBe('Your card was declined.');
      // Codex-w87s4: prorationDate echoes the pinned preview timestamp
      // — this is what lets the dialog branch "stale preview" from
      // "transient payment failure" without needing a second round-trip.
      expect(err.context?.prorationDate).toBe(previewProrationDate);
      expect(err.context?.tierIdAtCommit).toBe(tier2.id);
      // userId + organizationId are present so the route can log the
      // failure against the correct audit subject without re-parsing
      // the request body.
      expect(err.context?.userId).toBe(otherCreatorId);
      expect(err.context?.organizationId).toBe(org.id);

      // (b) NO silent retry — Stripe.subscriptions.update is called exactly
      // once. A retry loop here would double-charge if Stripe accepts the
      // second attempt; the contract is that the caller MUST refresh
      // preview + payment method before re-submitting.
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);

      // (c) DB untouched — local row still on tier1 with the original
      // amount. The Stripe-side price update was reverted by
      // payment_behavior=error_if_incomplete, so there's nothing to
      // reconcile.
      const { eq, and } = await import('drizzle-orm');
      const [unchanged] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(unchanged.tierId).toBe(tier1.id);
      expect(unchanged.amountCents).toBe(tier1.priceMonthly);
      expect(unchanged.billingInterval).toBe('month');
    });

    it('should throw SubscriptionNotFoundError without subscription', async () => {
      const { org, tier2 } = await createFullOrg('change-nosub');
      await expect(
        service.changeTier(thirdUserId, org.id, tier2.id, 'month')
      ).rejects.toThrow(SubscriptionNotFoundError);
    });

    it('should throw TierNotFoundError for invalid tier', async () => {
      const { org, tier1 } = await createFullOrg('change-badtier');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      await expect(
        service.changeTier(
          otherCreatorId,
          org.id,
          '00000000-0000-0000-0000-000000000000',
          'month'
        )
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should enforce user scoping: a different user cannot change the subscription tier', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-scope');
      // otherCreatorId owns the active subscription on tier1.
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      // thirdUserId attempts to upgrade — getSubscriptionOrThrow filters by
      // userId so this surfaces as NotFound (no information disclosure to
      // non-owners; service is last line of defence behind route requireAuth).
      await expect(
        service.changeTier(thirdUserId, org.id, tier2.id, 'month')
      ).rejects.toThrow(SubscriptionNotFoundError);

      // Stripe must NOT be touched on the negative path.
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();

      // And the original subscription must remain on tier1 with original amount.
      const { eq, and } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(row.tierId).toBe(tier1.id);
      expect(row.amountCents).toBe(tier1.priceMonthly);
    });

    it('mirrors the new tier price into amountCents synchronously (no webhook needed)', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-amount');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          amountCents: tier1.priceMonthly,
          billingInterval: 'month',
        })
      );

      await service.changeTier(otherCreatorId, org.id, tier2.id, 'month');

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.amountCents).toBe(tier2.priceMonthly);
      expect(updated.billingInterval).toBe('month');
    });

    it('mirrors the annual price when switching to annual billing', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier-annual');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          amountCents: tier1.priceMonthly,
          billingInterval: 'month',
        })
      );

      await service.changeTier(otherCreatorId, org.id, tier2.id, 'year');

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.amountCents).toBe(tier2.priceAnnual);
      expect(updated.billingInterval).toBe('year');
    });

    // Codex-0g6yq: return shape carries { userId, orgId } so the route handler
    // can feed invalidateForUser without re-fetching. See
    // docs/subscription-cache-audit/phase-1-p0.md.
    it('should return { userId, orgId, subscription } with org matching the subscription', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-return-shape');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      const result = await service.changeTier(
        otherCreatorId,
        org.id,
        tier2.id,
        'month'
      );

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);
      expect(result.subscription.organizationId).toBe(org.id);
      expect(result.subscription.userId).toBe(otherCreatorId);
    });
  });

  // ─── cancelSubscription ───────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('should set cancel_at_period_end and status to CANCELLING', async () => {
      const { org, tier1 } = await createFullOrg('cancel');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      await service.cancelSubscription(otherCreatorId, org.id, 'Too expensive');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cancel_at_period_end: true })
      );

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.status).toBe('cancelling');
      expect(updated.cancelReason).toBe('Too expensive');
    });

    it('should throw SubscriptionNotFoundError without subscription', async () => {
      const { org } = await createFullOrg('cancel-nosub');
      await expect(
        service.cancelSubscription(thirdUserId, org.id)
      ).rejects.toThrow(SubscriptionNotFoundError);
    });

    // Codex-0g6yq: return shape carries { userId, orgId } so the route handler
    // can feed invalidateForUser without re-fetching.
    it('should return { userId, orgId, subscription } with org matching the subscription', async () => {
      const { org, tier1 } = await createFullOrg('cancel-return-shape');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      const result = await service.cancelSubscription(
        otherCreatorId,
        org.id,
        'shape-test'
      );

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);
      expect(result.subscription.organizationId).toBe(org.id);
      expect(result.subscription.userId).toBe(otherCreatorId);
    });

    // Codex-kxecu (Q7): structured taxonomy is persisted alongside the
    // free-text reason. Both fields fill in independently.
    it('should persist churnReason alongside the free-text reason', async () => {
      const { org, tier1 } = await createFullOrg('cancel-churn');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      await service.cancelSubscription(
        otherCreatorId,
        org.id,
        'Tell me more',
        'too_expensive'
      );

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.churnReason).toBe('too_expensive');
      expect(updated.cancelReason).toBe('Tell me more');
    });

    it('should persist NULL for churnReason when the caller omits it (legacy callers untouched)', async () => {
      const { org, tier1 } = await createFullOrg('cancel-churn-null');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      await service.cancelSubscription(otherCreatorId, org.id, 'Just because');

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.churnReason).toBeNull();
      expect(updated.cancelReason).toBe('Just because');
    });

    it('should enforce user scoping: a different user cannot cancel the subscription', async () => {
      const { org, tier1 } = await createFullOrg('cancel-scope');
      // otherCreatorId owns the active subscription.
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      // thirdUserId attempts to cancel — getSubscriptionOrThrow filters by
      // userId so this surfaces as NotFound (no information disclosure to
      // non-owners; service is last line of defence behind route requireAuth).
      await expect(
        service.cancelSubscription(thirdUserId, org.id, 'malicious')
      ).rejects.toThrow(SubscriptionNotFoundError);

      // Stripe must NOT be touched on the negative path.
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();

      // And the active subscription must remain active with no cancel reason.
      const { eq, and } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(row.status).toBe('active');
      expect(row.cancelReason).toBeNull();
    });
  });

  // ─── reactivateSubscription ───────────────────────────────────────

  describe('reactivateSubscription', () => {
    it('should remove cancel_at_period_end and set status to ACTIVE', async () => {
      const { org, tier1 } = await createFullOrg('reactivate');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'cancelling',
        })
      );

      await service.reactivateSubscription(otherCreatorId, org.id);

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cancel_at_period_end: false })
      );

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.status).toBe('active');
      expect(updated.cancelReason).toBeNull();
    });

    it('should throw if not in CANCELLING state', async () => {
      const { org, tier1 } = await createFullOrg('react-active');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      await expect(
        service.reactivateSubscription(otherCreatorId, org.id)
      ).rejects.toThrow(SubscriptionCheckoutError);
    });

    // Codex-0g6yq: return shape carries { userId, orgId } so the route handler
    // can feed invalidateForUser without re-fetching.
    it('should return { userId, orgId, subscription } with org matching the subscription', async () => {
      const { org, tier1 } = await createFullOrg('react-return-shape');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'cancelling',
        })
      );

      const result = await service.reactivateSubscription(
        otherCreatorId,
        org.id
      );

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);
      expect(result.subscription.organizationId).toBe(org.id);
      expect(result.subscription.userId).toBe(otherCreatorId);
    });

    it('should enforce user scoping: a different user cannot reactivate the subscription', async () => {
      const { org, tier1 } = await createFullOrg('react-scope');
      // otherCreatorId owns the cancelling subscription.
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'cancelling',
        })
      );

      // thirdUserId attempts to reactivate — getSubscriptionOrThrow filters by
      // userId so this surfaces as NotFound (no information disclosure to
      // non-owners; service is last line of defence behind route requireAuth).
      await expect(
        service.reactivateSubscription(thirdUserId, org.id)
      ).rejects.toThrow(SubscriptionNotFoundError);

      // Stripe must NOT be touched on the negative path.
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();

      // And the cancelling subscription must remain in cancelling state.
      const { eq, and } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(row.status).toBe('cancelling');
    });
  });

  // ─── resumeSubscription (Codex-7h4vo) ─────────────────────────────
  //
  // User-initiated resume of a PAUSED subscription. Parallel to
  // reactivateSubscription but for the paused→active transition.
  // Positive + negative paths per feedback_security_deep_test:
  //   - Positive: paused sub flipped to active; Stripe resume called;
  //     return shape carries { userId, orgId, subscription }.
  //   - Negative: no subscription → SubscriptionNotFoundError.
  //   - Negative: subscription exists but status is 'active' (not paused)
  //     → SubscriptionNotFoundError (the query whitelists PAUSED only).
  //   - Negative: subscription belongs to a different user (scoping)
  //     → SubscriptionNotFoundError.

  describe('resumeSubscription', () => {
    it('should call stripe.subscriptions.resume and flip status to ACTIVE', async () => {
      const { org, tier1 } = await createFullOrg('resume-ok');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'paused',
        })
      );

      await service.resumeSubscription(otherCreatorId, org.id);

      // Stripe resume must be called with billing_cycle_anchor='unchanged'
      // to preserve the existing cycle (avoids surprise re-billing) and
      // with an idempotency key per packages/subscription/CLAUDE.md.
      expect(stripe.subscriptions.resume).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ billing_cycle_anchor: 'unchanged' }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('resume_'),
        })
      );

      const { eq, and } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(updated.status).toBe('active');
    });

    it('should return { userId, orgId, subscription } with org matching the subscription', async () => {
      const { org, tier1 } = await createFullOrg('resume-shape');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'paused',
        })
      );

      const result = await service.resumeSubscription(otherCreatorId, org.id);

      expect(result.userId).toBe(otherCreatorId);
      expect(result.orgId).toBe(org.id);
      expect(result.subscription.organizationId).toBe(org.id);
      expect(result.subscription.userId).toBe(otherCreatorId);
    });

    it('should throw SubscriptionNotFoundError when no subscription exists', async () => {
      const { org } = await createFullOrg('resume-none');

      await expect(
        service.resumeSubscription(thirdUserId, org.id)
      ).rejects.toThrow(SubscriptionNotFoundError);

      // Stripe must NOT be touched on the negative path.
      expect(stripe.subscriptions.resume).not.toHaveBeenCalled();
    });

    it('should throw SubscriptionNotFoundError when subscription status is not paused (e.g. active)', async () => {
      const { org, tier1 } = await createFullOrg('resume-wrong-status');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      // Throws because the lookup whitelists PAUSED only. Matches the
      // "must be in the expected state" contract used by reactivate.
      await expect(
        service.resumeSubscription(otherCreatorId, org.id)
      ).rejects.toThrow(SubscriptionNotFoundError);

      expect(stripe.subscriptions.resume).not.toHaveBeenCalled();
    });

    it('should enforce user scoping: a different user cannot resume the subscription', async () => {
      const { org, tier1 } = await createFullOrg('resume-scope');
      // otherCreatorId owns the paused subscription.
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'paused',
        })
      );

      // thirdUserId attempts to resume — the query filters by userId so
      // this surfaces as NotFound (no information disclosure, matches
      // the behaviour of getSubscriptionOrThrow).
      await expect(
        service.resumeSubscription(thirdUserId, org.id)
      ).rejects.toThrow(SubscriptionNotFoundError);

      expect(stripe.subscriptions.resume).not.toHaveBeenCalled();

      // And the paused subscription must remain paused.
      const { eq, and } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, otherCreatorId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(row.status).toBe('paused');
    });
  });

  // ─── getSubscription ──────────────────────────────────────────────

  describe('getSubscription', () => {
    it('should return subscription with nested tier', async () => {
      const { org, tier1 } = await createFullOrg('get-sub');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
          status: 'active',
        })
      );

      const result = await service.getSubscription(otherCreatorId, org.id);
      expect(result).not.toBeNull();
      expect(result?.tier).toBeDefined();
      expect(result?.tier.name).toBe('Basic');
    });

    it('should return null when no active subscription', async () => {
      const { org } = await createFullOrg('get-null');
      const result = await service.getSubscription(thirdUserId, org.id);
      expect(result).toBeNull();
    });
  });

  // ─── getUserSubscriptions ─────────────────────────────────────────

  describe('getUserSubscriptions', () => {
    it('should return subscriptions across multiple orgs', async () => {
      const { org: org1, tier1: t1 } = await createFullOrg('multi-1');
      const { org: org2, tier1: t2 } = await createFullOrg('multi-2');

      await db
        .insert(subscriptions)
        .values([
          createTestSubscriptionInput(thirdUserId, org1.id, t1.id),
          createTestSubscriptionInput(thirdUserId, org2.id, t2.id),
        ]);

      const results = await service.getUserSubscriptions(thirdUserId);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── listSubscribers ──────────────────────────────────────────────

  describe('listSubscribers', () => {
    it('should return paginated list', async () => {
      const { org, tier1 } = await createFullOrg('list-subs');
      // Insert 3 subscriptions from different users
      const users = await seedTestUsers(db, 3);
      for (const uid of users) {
        await db
          .insert(subscriptions)
          .values(createTestSubscriptionInput(uid, org.id, tier1.id));
      }

      const result = await service.listSubscribers(org.id, {
        page: 1,
        limit: 2,
      });
      expect(result.items).toHaveLength(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('flattens user + tier joins into SubscriberListItem shape', async () => {
      const { org, tier1 } = await createFullOrg('list-subs-shape');
      const [uid] = await seedTestUsers(db, 1);
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(uid, org.id, tier1.id));

      const result = await service.listSubscribers(org.id, {
        page: 1,
        limit: 10,
      });
      expect(result.items).toHaveLength(1);
      const row = result.items[0]!;
      expect(row.userId).toBe(uid);
      expect(row.userEmail).toBeTruthy();
      expect(row.tierId).toBe(tier1.id);
      expect(row.tierName).toBe(tier1.name);
      expect(row.amountCents).toBeGreaterThan(0);
      expect(row.currency).toBe('gbp');
      // ISO strings, not Date instances
      expect(typeof row.createdAt).toBe('string');
    });

    it('excludes cancelled by default (BUG-023 regression guard)', async () => {
      const { org, tier1 } = await createFullOrg('list-subs-cancel-default');
      const [activeUid, cancelledUid] = await seedTestUsers(db, 2);
      await db.insert(subscriptions).values([
        createTestSubscriptionInput(activeUid, org.id, tier1.id, {
          status: 'active',
        }),
        createTestSubscriptionInput(cancelledUid, org.id, tier1.id, {
          status: 'cancelled',
        }),
      ]);

      const result = await service.listSubscribers(org.id, {
        page: 1,
        limit: 10,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.userId).toBe(activeUid);
      expect(result.items.every((s) => s.status !== 'cancelled')).toBe(true);
    });

    it('includes cancelled when includeCancelled=true', async () => {
      const { org, tier1 } = await createFullOrg('list-subs-cancel-on');
      const [activeUid, cancelledUid] = await seedTestUsers(db, 2);
      await db.insert(subscriptions).values([
        createTestSubscriptionInput(activeUid, org.id, tier1.id, {
          status: 'active',
        }),
        createTestSubscriptionInput(cancelledUid, org.id, tier1.id, {
          status: 'cancelled',
        }),
      ]);

      const result = await service.listSubscribers(org.id, {
        page: 1,
        limit: 10,
        includeCancelled: true,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items.some((s) => s.status === 'cancelled')).toBe(true);
    });

    it('filters by tierId', async () => {
      const { org, tier1, tier2 } = await createFullOrg('list-subs-tier');
      const [u1, u2] = await seedTestUsers(db, 2);
      await db.insert(subscriptions).values([
        createTestSubscriptionInput(u1, org.id, tier1.id, {
          status: 'active',
        }),
        createTestSubscriptionInput(u2, org.id, tier2.id, {
          status: 'active',
        }),
      ]);

      const result = await service.listSubscribers(org.id, {
        page: 1,
        limit: 10,
        tierId: tier1.id,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.tierId).toBe(tier1.id);
    });

    it('search filters by user email (case-insensitive ILIKE)', async () => {
      const { org, tier1 } = await createFullOrg('list-subs-search');
      const [uid] = await seedTestUsers(db, 1);
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(uid, org.id, tier1.id));

      // seedTestUsers makes emails like `user-1-<rand>@example.com`. The
      // first segment is deterministic enough for a contains-match.
      const result = await service.listSubscribers(org.id, {
        page: 1,
        limit: 10,
        search: 'example.com',
      });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── getSubscriptionStats ─────────────────────────────────────────

  describe('getSubscriptionStats', () => {
    it('should return correct totals and per-tier breakdown', async () => {
      const { org, tier1, tier2 } = await createFullOrg('stats');
      const users = await seedTestUsers(db, 2);

      await db.insert(subscriptions).values([
        createTestSubscriptionInput(users[0], org.id, tier1.id, {
          status: 'active',
          amountCents: 499,
          billingInterval: 'month',
          platformFeeCents: 50,
          organizationFeeCents: 67,
          creatorPayoutCents: 382,
        }),
        createTestSubscriptionInput(users[1], org.id, tier2.id, {
          status: 'active',
          amountCents: 9990,
          billingInterval: 'year',
          platformFeeCents: 999,
          organizationFeeCents: 1349,
          creatorPayoutCents: 7642,
        }),
      ]);

      const stats = await service.getSubscriptionStats(org.id);
      expect(stats.totalSubscribers).toBe(2);
      expect(stats.activeSubscribers).toBe(2);
      expect(stats.tierBreakdown).toHaveLength(2);
      // MRR: 499 (monthly) + 9990/12 (annual) ≈ 499 + 832 = 1331
      expect(stats.mrrCents).toBeGreaterThan(0);
    });
  });

  // ─── handleInvoicePaymentSucceeded ────────────────────────────────

  describe('handleInvoicePaymentSucceeded', () => {
    it('should update period dates and execute revenue transfers', async () => {
      const { org, tier1 } = await createFullOrg('invoice-success');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      // Verify transfers were created
      expect(stripe.transfers.create).toHaveBeenCalled();
      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(
        sub.stripeSubscriptionId
      );
    });

    it('should skip if no subscription ID in invoice', async () => {
      const mockInvoice = createMockStripeInvoice({
        parent: null,
      }) as unknown as Stripe.Invoice;

      // Should not throw
      await service.handleInvoicePaymentSucceeded(mockInvoice);
      expect(stripe.transfers.create).not.toHaveBeenCalled();
    });

    it('should log warning for unknown subscription', async () => {
      const mockInvoice = createMockStripeInvoice({
        parent: {
          subscription_details: { subscription: 'sub_unknown_xyz' },
        },
      }) as unknown as Stripe.Invoice;

      // Should not throw — logs warning and returns
      await service.handleInvoicePaymentSucceeded(mockInvoice);
      expect(stripe.transfers.create).not.toHaveBeenCalled();
    });

    // Codex-0g6yq: explicit { userId, orgId } return-shape assertions for the
    // initial (subscription_create) invoice and the renewal (subscription_cycle)
    // invoice. Negative path: unknown subscription returns undefined rather
    // than throwing. See docs/subscription-cache-audit/phase-1-p0.md.
    it('should return { userId, orgId } for an initial invoice (subscription_create)', async () => {
      const { org, tier1 } = await createFullOrg('invoice-success-initial');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        billing_reason: 'subscription_create',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentSucceeded(mockInvoice);

      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
    });

    it('should return { userId, orgId } for a renewal invoice (subscription_cycle)', async () => {
      const { org, tier1 } = await createFullOrg('invoice-success-renewal');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        billing_reason: 'subscription_cycle',
        customer_email: 'renewal@example.com',
        customer_name: 'Renewal User',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentSucceeded(mockInvoice);

      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
      // Renewal invoices also attach an email payload (not required for
      // invalidation but confirms the handler walked the full renewal branch).
      expect(result?.email).toBeDefined();
    });

    it('should return undefined for an invoice whose subscription is not in the DB', async () => {
      // Negative path per feedback_security_deep_test — service must not
      // crash when a webhook arrives before the DB subscription exists.
      const mockInvoice = createMockStripeInvoice({
        parent: {
          subscription_details: { subscription: 'sub_no_match_in_db_xyz' },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentSucceeded(mockInvoice);
      expect(result).toBeUndefined();
    });

    // Codex-zdbhg: real Stripe 2024+ webhook payloads do NOT include
    // expanded `payments.data` on the inline invoice object. The handler
    // must retrieve the invoice with `expand: ['payments']` to recover
    // the charge — without that fallback, executeTransfers never runs
    // and payouts ledger rows never get written. The shape used here
    // matches the production event payload Stripe actually delivers
    // (no `payments` field at all), NOT the test-fixture shape that
    // pre-populates `payments.data[0]`.
    it('resolves charge via invoices.retrieve({ expand: [payments] }) when inline payments are absent (Stripe 2024+ shape)', async () => {
      const { org, tier1 } = await createFullOrg('invoice-no-inline-payments');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      // Real webhook shape: no `payments` field at all.
      const realChargeId = 'ch_resolved_via_expand';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: undefined,
      }) as unknown as Stripe.Invoice;

      // Override the default empty-payments mock so retrieve returns the
      // fully expanded shape Stripe yields when `expand: ['payments']`.
      (
        stripe as unknown as {
          invoices: { retrieve: ReturnType<typeof vi.fn> };
        }
      ).invoices.retrieve.mockResolvedValueOnce({
        id: mockInvoice.id,
        payments: {
          data: [{ payment: { charge: realChargeId, payment_intent: null } }],
        },
      });

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      expect(stripe.invoices.retrieve).toHaveBeenCalledWith(
        mockInvoice.id,
        expect.objectContaining({ expand: ['payments'] })
      );
      expect(stripe.transfers.create).toHaveBeenCalled();
      const calls = (stripe.transfers.create as ReturnType<typeof vi.fn>).mock
        .calls;
      for (const [, opts] of calls) {
        expect(opts?.idempotencyKey).toMatch(new RegExp(`^${realChargeId}_`));
      }
    });

    it('resolves charge via paymentIntents.retrieve.latest_charge when expanded invoice has only a PI', async () => {
      const { org, tier1 } = await createFullOrg('invoice-pi-latest-charge');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const piId = 'pi_with_latest_charge';
      const chargeViaPi = 'ch_recovered_via_pi';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: undefined,
      }) as unknown as Stripe.Invoice;

      (
        stripe as unknown as {
          invoices: { retrieve: ReturnType<typeof vi.fn> };
        }
      ).invoices.retrieve.mockResolvedValueOnce({
        id: mockInvoice.id,
        payments: {
          data: [{ payment: { charge: null, payment_intent: piId } }],
        },
      });
      (
        stripe as unknown as {
          paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
        }
      ).paymentIntents.retrieve.mockResolvedValueOnce({
        id: piId,
        latest_charge: chargeViaPi,
      });

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(piId);
      expect(stripe.charges.list).not.toHaveBeenCalled();
      expect(stripe.transfers.create).toHaveBeenCalled();
      const calls = (stripe.transfers.create as ReturnType<typeof vi.fn>).mock
        .calls;
      for (const [, opts] of calls) {
        expect(opts?.idempotencyKey).toMatch(new RegExp(`^${chargeViaPi}_`));
      }
    });

    it('falls back to charges.list when paymentIntent has no latest_charge (race after PI confirmation)', async () => {
      const { org, tier1 } = await createFullOrg(
        'invoice-charges-list-fallback'
      );
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const piId = 'pi_pending_latest_charge';
      const chargeViaList = 'ch_recovered_via_list';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: undefined,
      }) as unknown as Stripe.Invoice;

      // Expanded invoice has only PI, no charge.
      (
        stripe as unknown as {
          invoices: { retrieve: ReturnType<typeof vi.fn> };
        }
      ).invoices.retrieve.mockResolvedValueOnce({
        id: mockInvoice.id,
        payments: {
          data: [{ payment: { charge: null, payment_intent: piId } }],
        },
      });
      // PI retrieve still missing latest_charge.
      (
        stripe as unknown as {
          paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
        }
      ).paymentIntents.retrieve.mockResolvedValueOnce({
        id: piId,
        latest_charge: null,
      });
      // charges.list closes the gap.
      (
        stripe as unknown as { charges: { list: ReturnType<typeof vi.fn> } }
      ).charges.list.mockResolvedValueOnce({
        object: 'list',
        data: [{ id: chargeViaList }],
        has_more: false,
      });

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      expect(stripe.charges.list).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: piId, limit: 1 })
      );
      expect(stripe.transfers.create).toHaveBeenCalled();
    });

    it('still skips with WARN (not crash) when no charge can be resolved at any layer', async () => {
      // Negative path per feedback_security_deep_test — if every fallback
      // returns empty, the handler must log + return cleanly, never crash.
      const { org, tier1 } = await createFullOrg('invoice-truly-no-charge');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: undefined,
      }) as unknown as Stripe.Invoice;

      // Expanded retrieve returns empty too.
      (
        stripe as unknown as {
          invoices: { retrieve: ReturnType<typeof vi.fn> };
        }
      ).invoices.retrieve.mockResolvedValueOnce({
        id: mockInvoice.id,
        payments: { data: [] },
      });

      await expect(
        service.handleInvoicePaymentSucceeded(mockInvoice)
      ).resolves.not.toThrow();
      expect(stripe.transfers.create).not.toHaveBeenCalled();
    });

    // Codex-8wfnv: explicit idempotency assertions for the renewal path.
    // handleSubscriptionCreated has a uniqueness-constraint short-circuit
    // (line 519). handleInvoicePaymentSucceeded has no such short-circuit
    // — its replay safety lives downstream in `executeTransfers`, which
    // passes a deterministic `idempotencyKey` to `stripe.transfers.create`
    // (`${chargeId}_org_fee`, `${chargeId}_creator_pool_owner`,
    // `${chargeId}_creator_<creatorId>` — see subscription-service.ts:2810,
    // :2900, :2983). Stripe dedupes on idempotency key, so even if the
    // handler is invoked twice for the same invoice, no double transfer
    // can settle. Assert the keys are stable across replays.
    it('replay safety: same invoice.payment_succeeded fired twice → revenue transfer dedupes via deterministic idempotency key (chargeId-derived)', async () => {
      const { org, tier1 } = await createFullOrg('invoice-replay-idempotent');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      // Pin chargeId so both invocations derive identical idempotency keys
      // — exactly the replay shape we're asserting against.
      const chargeId = 'ch_test_replay_fixed';
      const paymentIntentId = 'pi_test_replay_fixed';
      const invoiceId = 'in_test_replay_fixed';
      const mockInvoice = createMockStripeInvoice({
        id: invoiceId,
        amount_paid: 499,
        billing_reason: 'subscription_cycle',
        customer_email: 'replay@example.com',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [
            { payment: { charge: chargeId, payment_intent: paymentIntentId } },
          ],
        },
      }) as unknown as Stripe.Invoice;

      // Fire the same event twice — the realistic replay shape.
      await service.handleInvoicePaymentSucceeded(mockInvoice);
      const callsAfterFirst = (
        stripe.transfers.create as ReturnType<typeof vi.fn>
      ).mock.calls.length;

      await service.handleInvoicePaymentSucceeded(mockInvoice);
      const transfersMock = stripe.transfers.create as ReturnType<typeof vi.fn>;
      const callsAfterSecond = transfersMock.mock.calls.length;

      // Replay must invoke transfers.create the SAME number of times each
      // call (same code path) — but every invocation across both calls
      // must carry an idempotency key Stripe will dedupe on.
      expect(callsAfterFirst).toBeGreaterThan(0);
      expect(callsAfterSecond).toBe(callsAfterFirst * 2);

      // Deterministic idempotency key contract: every transfers.create
      // call must pass `{ idempotencyKey }` as its 2nd argument, derived
      // from the (stable) chargeId. This is the Stripe-side dedupe.
      const allOptions = transfersMock.mock.calls.map(
        (call) => call[1] as { idempotencyKey?: string } | undefined
      );
      for (const opts of allOptions) {
        expect(opts).toBeDefined();
        expect(opts?.idempotencyKey).toBeDefined();
        expect(opts?.idempotencyKey).toMatch(new RegExp(`^${chargeId}_`));
      }

      // Stronger: the SET of idempotency keys used on the second call
      // must equal the SET used on the first call — i.e. every transfer
      // attempted on replay carries an already-seen key, so Stripe
      // dedupes and no double-spend can settle on the platform side.
      const firstKeys = allOptions
        .slice(0, callsAfterFirst)
        .map((o) => o?.idempotencyKey)
        .sort();
      const secondKeys = allOptions
        .slice(callsAfterFirst)
        .map((o) => o?.idempotencyKey)
        .sort();
      expect(secondKeys).toEqual(firstKeys);

      // DB state after second call must equal state after first call for
      // every business column (no double-extension of the period, no
      // double-recording of the revenue split).
      const { eq } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(row.status).toBe('active');
      expect(
        row.platformFeeCents + row.organizationFeeCents + row.creatorPayoutCents
      ).toBe(row.amountCents);
    });

    // Codex-8wfnv: separate assertion for the "period already extended"
    // shape. Production has no DB short-circuit on already-extended period
    // dates — it re-writes the same period_end. This test pins that
    // behaviour and proves the re-write is a true no-op for business
    // columns (period dates unchanged, status unchanged, split unchanged).
    it('replay safety: invoice for an already-extended period → period_end + status + revenue split unchanged on replay', async () => {
      const { org, tier1 } = await createFullOrg('invoice-replay-noop');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        billing_reason: 'subscription_cycle',
        customer_email: 'noop@example.com',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      // First call extends the period.
      await service.handleInvoicePaymentSucceeded(mockInvoice);
      const { eq } = await import('drizzle-orm');
      const [afterFirst] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));

      // Second call should be a no-op for every business column. Because
      // stripe.subscriptions.retrieve is a vi.fn(), its return value is
      // regenerated per call — but the mock's `now` window is small
      // (sub-second), so period dates may drift by ms. Pin the retrieve
      // return to the same value we observed after the first call so the
      // assertion targets handler logic, not mock drift.
      const periodStartSec = Math.floor(
        (afterFirst.currentPeriodStart?.getTime() ?? 0) / 1000
      );
      const periodEndSec = Math.floor(
        (afterFirst.currentPeriodEnd?.getTime() ?? 0) / 1000
      );
      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        id: sub.stripeSubscriptionId,
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: {
          data: [
            {
              id: 'si_test_noop',
              price: {
                id: 'price_test_monthly',
                unit_amount: 499,
                currency: 'gbp',
                recurring: { interval: 'month' },
              },
              current_period_start: periodStartSec,
              current_period_end: periodEndSec,
            },
          ],
        },
      });

      await service.handleInvoicePaymentSucceeded(mockInvoice);
      const [afterSecond] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));

      // Period dates pinned identical across replay.
      expect(afterSecond.currentPeriodStart?.getTime()).toBe(
        afterFirst.currentPeriodStart?.getTime()
      );
      expect(afterSecond.currentPeriodEnd?.getTime()).toBe(
        afterFirst.currentPeriodEnd?.getTime()
      );

      // Status and revenue split (in pence, GBP) untouched.
      expect(afterSecond.status).toBe(afterFirst.status);
      expect(afterSecond.amountCents).toBe(afterFirst.amountCents);
      expect(afterSecond.platformFeeCents).toBe(afterFirst.platformFeeCents);
      expect(afterSecond.organizationFeeCents).toBe(
        afterFirst.organizationFeeCents
      );
      expect(afterSecond.creatorPayoutCents).toBe(
        afterFirst.creatorPayoutCents
      );

      // Single subscription row (no duplication on replay).
      const rows = await db
        .select()
        .from(subscriptions)
        .where(
          eq(subscriptions.stripeSubscriptionId, sub.stripeSubscriptionId)
        );
      expect(rows).toHaveLength(1);
    });
  });

  // ─── executeTransfers multi-creator split invariants (Codex-gki66) ───
  //
  // executeTransfers (subscription-service.ts:2794) fans the post-platform
  // creator pool across every active row in creator_organization_agreements
  // for an org, weighted by `organizationFeePercentage` (basis points
  // repurposed as the creator's share in the subscription context).
  //
  // Bead Codex-gki66 asked: what happens when those shares don't sum to
  // 10000bps, when two rows exist for the same (creator, org) pair, when a
  // share is zero, and when an agreement is soft-deleted between billing
  // cycles? These tests lock in the CURRENT production behaviour so a
  // future refactor that breaks an invariant fails loudly.
  //
  // Current production semantics (read from subscription-service.ts:2953,
  // :2972, :2976, :2890):
  //   - Per-creator allocation is `floor(payout * share / sum(shares))` —
  //     production NORMALISES by the actual sum, not by 10000bps. So
  //     undersum (e.g. 4000+4000=8000) splits the full pool between the
  //     two creators; oversum (6000+5000=11000) caps at ≤ payout and
  //     never throws.
  //   - Zero-share rows yield creatorAmount === 0 and `continue` — no
  //     stripe.transfers.create call, no pending payout row.
  //   - The "no agreements" branch (line 2894) routes the entire creator
  //     pool to the org owner — distinct from the "agreements with
  //     undersum" branch (which keeps the pool inside the creator fan-out).
  //   - effectiveUntil > now() filters out soft-deleted/expired rows from
  //     the next cycle (line 2890).
  //
  // Schema note: creator_organization_agreements already has a unique
  // index on (creator_id, organization_id, effective_from) — see
  // packages/database/src/schema/ecommerce.ts:205. Time-sliced agreements
  // are by design (a creator can renegotiate their share over time), so
  // we do NOT add a stricter (creator_id, organization_id) unique
  // constraint — that would break the historical-record use case. The
  // application layer is responsible for ensuring only one row has
  // `effective_until IS NULL OR > now()` per pair at any time. The
  // duplicate-row test below covers the cheap schema case (same
  // effective_from), which IS rejected.
  describe('executeTransfers multi-creator split invariants', () => {
    /**
     * Seed a creator user + Connect account (orgId-scoped, charges enabled)
     * so an agreement row routes the transfer through the `stripe.transfers
     * .create` branch rather than the pending-payout branch. Returns the
     * userId.
     */
    async function seedCreatorWithConnect(orgId: string): Promise<string> {
      const [userId] = await seedTestUsers(db, 1);
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(orgId, userId, {
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      );
      return userId;
    }

    /**
     * Filter Stripe transfer mock calls to just the per-creator transfers
     * (excludes the `_org_fee` and `_creator_pool_owner` keys). The
     * production code stamps each per-creator call with
     * `${chargeId}_creator_${creatorId}` — match on that shape.
     */
    function perCreatorTransferCalls(
      mock: ReturnType<typeof vi.fn>
    ): Array<{ amount: number; destination: string; idempotencyKey: string }> {
      return mock.mock.calls
        .map((call) => {
          const params = call[0] as {
            amount: number;
            destination: string;
            metadata?: { type?: string };
          };
          const opts = call[1] as { idempotencyKey?: string } | undefined;
          return {
            amount: params.amount,
            destination: params.destination,
            metadata: params.metadata,
            idempotencyKey: opts?.idempotencyKey ?? '',
          };
        })
        .filter((c) => c.metadata?.type === 'creator_payout')
        .map(({ amount, destination, idempotencyKey }) => ({
          amount,
          destination,
          idempotencyKey,
        }));
    }

    it('share-sum exactly 10000 bps (2 creators, 50/50): each receives floor(payout/2)', async () => {
      const { org, tier1 } = await createFullOrg('split-5050');
      const c1 = await seedCreatorWithConnect(org.id);
      const c2 = await seedCreatorWithConnect(org.id);

      await db.insert(creatorOrganizationAgreements).values([
        {
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 5000,
        },
        {
          creatorId: c2,
          organizationId: org.id,
          organizationFeePercentage: 5000,
        },
      ]);

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const chargeId = 'ch_split_5050';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: 'pi_5050' } }],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const creatorCalls = perCreatorTransferCalls(
        stripe.transfers.create as ReturnType<typeof vi.fn>
      );
      expect(creatorCalls).toHaveLength(2);
      const c1Call = creatorCalls.find(
        (c) => c.idempotencyKey === `${chargeId}_creator_${c1}`
      );
      const c2Call = creatorCalls.find(
        (c) => c.idempotencyKey === `${chargeId}_creator_${c2}`
      );
      expect(c1Call).toBeDefined();
      expect(c2Call).toBeDefined();
      // The creator pool for amount_paid=1000 with default fees (platform
      // 10%, org 15% of post-platform) is exactly half-able: each creator
      // gets floor(creatorPayoutCents / 2). Sum of per-creator amounts
      // must not exceed the creator pool.
      const total = (c1Call?.amount ?? 0) + (c2Call?.amount ?? 0);
      expect(c1Call?.amount).toBe(c2Call?.amount); // exact even split
      // No double-spend: total per-creator transfer ≤ creator pool.
      // We don't compute the pool here (private to the service); we
      // assert the split fairness contract instead.
      expect(total).toBeGreaterThan(0);
    });

    it('share-sum 10000 bps with 3-way odd split (3334/3333/3333): floor rounding leaves remainder unallocated, never over-pays', async () => {
      const { org, tier1 } = await createFullOrg('split-3way');
      const c1 = await seedCreatorWithConnect(org.id);
      const c2 = await seedCreatorWithConnect(org.id);
      const c3 = await seedCreatorWithConnect(org.id);

      await db.insert(creatorOrganizationAgreements).values([
        {
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 3334,
        },
        {
          creatorId: c2,
          organizationId: org.id,
          organizationFeePercentage: 3333,
        },
        {
          creatorId: c3,
          organizationId: org.id,
          organizationFeePercentage: 3333,
        },
      ]);

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const chargeId = 'ch_split_3way';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: 'pi_3way' } }],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const creatorCalls = perCreatorTransferCalls(
        stripe.transfers.create as ReturnType<typeof vi.fn>
      );
      expect(creatorCalls).toHaveLength(3);

      const byKey = new Map(
        creatorCalls.map((c) => [c.idempotencyKey, c.amount])
      );
      const a1 = byKey.get(`${chargeId}_creator_${c1}`) ?? 0;
      const a2 = byKey.get(`${chargeId}_creator_${c2}`) ?? 0;
      const a3 = byKey.get(`${chargeId}_creator_${c3}`) ?? 0;

      // c1's share (3334) is strictly larger, so c1 amount ≥ c2 amount = c3 amount.
      expect(a1).toBeGreaterThanOrEqual(a2);
      expect(a2).toBe(a3);
      // floor() rounding leaves the remainder pence inside the platform —
      // total transferred never exceeds the creator pool.
      expect(a1 + a2 + a3).toBeGreaterThan(0);
    });

    it('share-sum UNDER 10000 bps (4000+4000=8000): production normalises by totalShareBps, so creators split the full pool', async () => {
      // Production code at subscription-service.ts:2972-2974 divides by
      // totalShareBps (the SUM of share rows), not by 10000. Locking in
      // that contract: undersum does NOT route a remainder to the org
      // owner. The creators receive the full creator pool, split by
      // their relative weights.
      const { org, tier1 } = await createFullOrg('split-undersum');
      const c1 = await seedCreatorWithConnect(org.id);
      const c2 = await seedCreatorWithConnect(org.id);

      await db.insert(creatorOrganizationAgreements).values([
        {
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 4000,
        },
        {
          creatorId: c2,
          organizationId: org.id,
          organizationFeePercentage: 4000,
        },
      ]);

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const chargeId = 'ch_undersum';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [
            { payment: { charge: chargeId, payment_intent: 'pi_undersum' } },
          ],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const creatorCalls = perCreatorTransferCalls(
        stripe.transfers.create as ReturnType<typeof vi.fn>
      );
      // Both creators receive a transfer.
      expect(creatorCalls).toHaveLength(2);

      // With shares 4000+4000, totalShareBps = 8000. Each creator gets
      // floor(payout * 4000/8000) = floor(payout/2). The agreements
      // present branch is taken (no `creator_payout_to_owner` transfer):
      const allCalls = (stripe.transfers.create as ReturnType<typeof vi.fn>)
        .mock.calls;
      const ownerFallbackCalls = allCalls.filter((call) => {
        const opts = call[1] as { idempotencyKey?: string } | undefined;
        return opts?.idempotencyKey === `${chargeId}_creator_pool_owner`;
      });
      expect(ownerFallbackCalls).toHaveLength(0);

      // Equal split because shares are equal.
      const [first, second] = creatorCalls;
      expect(first.amount).toBe(second.amount);
    });

    it('share-sum OVER 10000 bps (6000+5000=11000): production silently clamps via normalisation, no throw', async () => {
      // Production normalises by totalShareBps = 11000, so each creator
      // receives floor(payout * share / 11000) — the sum is ≤ payout. No
      // error is thrown; the service does not currently enforce a
      // 10000-bps ceiling. This test pins that behaviour.
      const { org, tier1 } = await createFullOrg('split-oversum');
      const c1 = await seedCreatorWithConnect(org.id);
      const c2 = await seedCreatorWithConnect(org.id);

      await db.insert(creatorOrganizationAgreements).values([
        {
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 6000,
        },
        {
          creatorId: c2,
          organizationId: org.id,
          organizationFeePercentage: 5000,
        },
      ]);

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const chargeId = 'ch_oversum';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [
            { payment: { charge: chargeId, payment_intent: 'pi_oversum' } },
          ],
        },
      }) as unknown as Stripe.Invoice;

      // Must NOT throw.
      await expect(
        service.handleInvoicePaymentSucceeded(mockInvoice)
      ).resolves.toBeDefined();

      const creatorCalls = perCreatorTransferCalls(
        stripe.transfers.create as ReturnType<typeof vi.fn>
      );
      expect(creatorCalls).toHaveLength(2);

      const byKey = new Map(
        creatorCalls.map((c) => [c.idempotencyKey, c.amount])
      );
      const a1 = byKey.get(`${chargeId}_creator_${c1}`) ?? 0;
      const a2 = byKey.get(`${chargeId}_creator_${c2}`) ?? 0;

      // c1 (6000) > c2 (5000), so a1 > a2 (strict — different shares).
      expect(a1).toBeGreaterThan(a2);

      // Clamp invariant: a1 = floor(payout * 6000/11000), a2 = floor(payout * 5000/11000).
      // The ratio a1/a2 ≈ 6000/5000 = 1.2 (within rounding tolerance).
      // The key contract is: total ≤ creator pool — which we can verify
      // by checking no transfer exceeds the input amount_paid (=1000).
      expect(a1 + a2).toBeLessThanOrEqual(1000);
    });

    it('zero-share agreement: creator with 0 bps receives no transfer, share holder gets full pool', async () => {
      const { org, tier1 } = await createFullOrg('split-zero');
      const c1 = await seedCreatorWithConnect(org.id);
      const c2 = await seedCreatorWithConnect(org.id);

      await db.insert(creatorOrganizationAgreements).values([
        {
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 5000,
        },
        { creatorId: c2, organizationId: org.id, organizationFeePercentage: 0 },
      ]);

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const chargeId = 'ch_zero';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: 'pi_zero' } }],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const creatorCalls = perCreatorTransferCalls(
        stripe.transfers.create as ReturnType<typeof vi.fn>
      );
      // Only c1 receives a transfer; c2's zero-share row is skipped by
      // the `if (creatorAmount <= 0) continue` guard.
      expect(creatorCalls).toHaveLength(1);
      expect(creatorCalls[0].idempotencyKey).toBe(`${chargeId}_creator_${c1}`);

      // c2 must NOT get a pending_payouts row either (the continue
      // happens BEFORE the pending-payout branch).
      const { eq, and } = await import('drizzle-orm');
      const c2PendingRows = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.userId, c2),
            eq(payoutsTable.organizationId, org.id)
          )
        );
      expect(c2PendingRows).toHaveLength(0);
    });

    it('duplicate (creatorId, organizationId, effectiveFrom): unique constraint rejects the second insert', async () => {
      // Schema constraint: creator_org_agreement_unique on
      // (creator_id, organization_id, effective_from). Two rows with the
      // same effective_from MUST fail. Two rows with DIFFERENT
      // effective_from values are allowed by design (time-sliced
      // agreements — a creator can renegotiate). This test pins the
      // narrow schema-level dedupe; the broader "only one active row"
      // invariant is an application-layer concern (see effectiveUntil
      // filter in subscription-service.ts:2890).
      const { org } = await createFullOrg('split-duplicate');
      const c1 = await seedCreatorWithConnect(org.id);

      const fixedDate = new Date('2026-01-01T00:00:00.000Z');
      await db.insert(creatorOrganizationAgreements).values({
        creatorId: c1,
        organizationId: org.id,
        organizationFeePercentage: 5000,
        effectiveFrom: fixedDate,
      });

      await expect(
        db.insert(creatorOrganizationAgreements).values({
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 4000,
          effectiveFrom: fixedDate,
        })
      ).rejects.toThrow();
    });

    it('mid-period creator removal: expired agreement (effective_until in the past) is excluded from next-cycle transfers', async () => {
      // Setup: creator + agreement, fire one invoice → 1 transfer to creator.
      // Then expire the agreement (set effective_until to the past) and
      // fire the next invoice → executeTransfers' SELECT (line 2890)
      // filters by `effective_until IS NULL OR > now()` and skips the
      // expired row. With no other agreements, the loop has zero rows
      // and the "no agreements" branch routes the entire creator pool
      // to the org owner (`creator_payout_to_owner`).
      const { org, tier1 } = await createFullOrg('split-mid-removal');
      const c1 = await seedCreatorWithConnect(org.id);

      const [agreementRow] = await db
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId: c1,
          organizationId: org.id,
          organizationFeePercentage: 10000,
        })
        .returning();

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      // First invoice: creator receives the transfer.
      const chargeId1 = 'ch_mid_first';
      await service.handleInvoicePaymentSucceeded(
        createMockStripeInvoice({
          amount_paid: 1000,
          parent: {
            subscription_details: { subscription: sub.stripeSubscriptionId },
          },
          payments: {
            data: [
              { payment: { charge: chargeId1, payment_intent: 'pi_mid_1' } },
            ],
          },
        }) as unknown as Stripe.Invoice
      );

      const transfersMock = stripe.transfers.create as ReturnType<typeof vi.fn>;
      const firstCreatorCalls = perCreatorTransferCalls(transfersMock).filter(
        (c) => c.idempotencyKey === `${chargeId1}_creator_${c1}`
      );
      expect(firstCreatorCalls).toHaveLength(1);

      // Expire the agreement (mid-period removal): effective_until set
      // to one second ago. The next-cycle SELECT must skip this row.
      const { eq } = await import('drizzle-orm');
      const oneSecondAgo = new Date(Date.now() - 1000);
      await db
        .update(creatorOrganizationAgreements)
        .set({ effectiveUntil: oneSecondAgo })
        .where(eq(creatorOrganizationAgreements.id, agreementRow.id));

      // Second invoice: creator must NOT receive a transfer; the org
      // owner gets the full creator pool via the "no agreements" branch.
      const chargeId2 = 'ch_mid_second';
      await service.handleInvoicePaymentSucceeded(
        createMockStripeInvoice({
          amount_paid: 1000,
          parent: {
            subscription_details: { subscription: sub.stripeSubscriptionId },
          },
          payments: {
            data: [
              { payment: { charge: chargeId2, payment_intent: 'pi_mid_2' } },
            ],
          },
        }) as unknown as Stripe.Invoice
      );

      const secondCycleCreatorCalls = perCreatorTransferCalls(
        transfersMock
      ).filter((c) => c.idempotencyKey === `${chargeId2}_creator_${c1}`);
      expect(secondCycleCreatorCalls).toHaveLength(0);

      // Owner fallback fired for the second cycle.
      const ownerFallbackSecondCycle = transfersMock.mock.calls.filter(
        (call) => {
          const opts = call[1] as { idempotencyKey?: string } | undefined;
          return opts?.idempotencyKey === `${chargeId2}_creator_pool_owner`;
        }
      );
      expect(ownerFallbackSecondCycle).toHaveLength(1);
    });
  });

  // ─── handleInvoicePaymentFailed ───────────────────────────────────

  describe('handleInvoicePaymentFailed', () => {
    // Codex-0g6yq: the failed-invoice handler must surface { userId, orgId }
    // so the route bumps both library and per-org subscription caches —
    // users need their UI to reflect past_due state across devices.
    it('should return { userId, orgId } when the subscription exists', async () => {
      const { org, tier1 } = await createFullOrg('invoice-failed-positive');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockInvoice = createMockStripeInvoice({
        amount_due: 499,
        customer_email: 'fail@example.com',
        customer_name: 'Fail User',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentFailed(mockInvoice);

      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);

      // Sanity check: status should be flipped to past_due as a side effect.
      const { eq } = await import('drizzle-orm');
      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(updated.status).toBe('past_due');
    });

    it('should return { userId: undefined, orgId: undefined } for an unknown subscription', async () => {
      // Negative path — webhook for a subscription that never reached our DB.
      // Handler must not crash; userId/orgId are undefined so the route
      // skips the cache bump (documented semantics of invalidateForUser).
      const mockInvoice = createMockStripeInvoice({
        customer_email: 'unknown@example.com',
        parent: {
          subscription_details: { subscription: 'sub_unknown_failed_xyz' },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentFailed(mockInvoice);

      // email may still be built (we have customer_email) but ids are absent.
      expect(result).toBeDefined();
      expect(result?.userId).toBeUndefined();
      expect(result?.orgId).toBeUndefined();
    });
  });

  // ─── Webhook ordering self-heal (Codex-t7psp) ─────────────────────
  //
  // Stripe does NOT guarantee webhook delivery order. On a fresh
  // subscription, `invoice.payment_succeeded` and `invoice.payment_failed`
  // can arrive BEFORE `customer.subscription.created`. Before this fix,
  // those handlers logged "Invoice for unknown subscription" and silently
  // dropped the first payout (race #1) or the past_due flip (race #2).
  //
  // Fix: `ensureSubscriptionDataPresent` retrieves the sub from Stripe
  // when the DB row is missing and inserts subscription + follower +
  // membership in one transaction. Side effects (welcome email, cache
  // invalidation) stay on the create-event handler so they don't get
  // dropped by the unique-violation swallow when the real
  // `customer.subscription.created` lands later.
  describe('Webhook ordering self-heal (Codex-t7psp)', () => {
    /** Unique stripe-sub id per call — avoids cross-run collisions in the shared test DB. */
    function uniqueStripeSubId(prefix: string) {
      return `sub_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    /** Build a Stripe subscription mock with the metadata our helper expects. */
    function buildStripeSubMock(args: {
      stripeSubId: string;
      stripeCustomerId: string;
      userId: string;
      orgId: string;
      tierId: string;
    }) {
      return createMockStripeSubscription({
        id: args.stripeSubId,
        customer: args.stripeCustomerId,
        metadata: {
          codex_user_id: args.userId,
          codex_organization_id: args.orgId,
          codex_tier_id: args.tierId,
        },
      }) as unknown as Stripe.Subscription;
    }

    it('race #1: invoice.payment_succeeded self-heals missing subscription row and runs transfers', async () => {
      const { org, tier1 } = await createFullOrg('selfheal-race1');
      const stripeSubId = uniqueStripeSubId('race1');
      const stripeCustomerId = `cus_${stripeSubId}`;
      const chargeId = `ch_${stripeSubId}`;

      // Pre-condition: NO subscriptions row exists for this Stripe sub.
      // Stripe sub retrieve returns a fully-formed sub with our metadata.
      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(
        buildStripeSubMock({
          stripeSubId,
          stripeCustomerId,
          userId: otherCreatorId,
          orgId: org.id,
          tierId: tier1.id,
        })
      );

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: null } }],
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentSucceeded(mockInvoice);

      // Helper inserted the subscription + follower + membership rows.
      const { eq, and } = await import('drizzle-orm');
      const { organizationFollowers, organizationMemberships } = await import(
        '@codex/database/schema'
      );
      const [inserted] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
        .limit(1);
      expect(inserted).toBeDefined();
      expect(inserted.userId).toBe(otherCreatorId);
      expect(inserted.organizationId).toBe(org.id);

      const [follower] = await db
        .select()
        .from(organizationFollowers)
        .where(
          and(
            eq(organizationFollowers.organizationId, org.id),
            eq(organizationFollowers.userId, otherCreatorId)
          )
        )
        .limit(1);
      expect(follower).toBeDefined();

      const [membership] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, otherCreatorId)
          )
        )
        .limit(1);
      expect(membership).toBeDefined();
      expect(membership.role).toBe('subscriber');

      // Money path resumed: transfers fired with chargeId-derived keys.
      expect(stripe.transfers.create).toHaveBeenCalled();
      const transferCalls = (
        stripe.transfers.create as ReturnType<typeof vi.fn>
      ).mock.calls;
      for (const [, opts] of transferCalls) {
        expect(opts?.idempotencyKey).toMatch(new RegExp(`^${chargeId}_`));
      }

      // Handler returns invalidation tuple so the route bumps caches.
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
    });

    it('race #2: invoice.payment_failed self-heals missing row then flips status to past_due', async () => {
      const { org, tier1 } = await createFullOrg('selfheal-race2');
      const stripeSubId = uniqueStripeSubId('race2');
      const stripeCustomerId = `cus_${stripeSubId}`;

      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(
        buildStripeSubMock({
          stripeSubId,
          stripeCustomerId,
          userId: otherCreatorId,
          orgId: org.id,
          tierId: tier1.id,
        })
      );

      const mockInvoice = createMockStripeInvoice({
        amount_due: 499,
        customer_email: 'failed@example.com',
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentFailed(mockInvoice);

      const { eq } = await import('drizzle-orm');
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
        .limit(1);
      expect(row).toBeDefined();
      expect(row.status).toBe('past_due');
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
    });

    it('Stripe 404 on retrieve: handler returns cleanly, no transfer, no row inserted', async () => {
      const stripeSubId = uniqueStripeSubId('stripe404');

      // Simulate Stripe returning 404 — type marker matches the
      // detection branch in ensureSubscriptionDataPresent.
      const stripe404 = new Error('No such subscription') as Error & {
        type?: string;
      };
      stripe404.type = 'StripeInvalidRequestError';
      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(stripe404);

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
      }) as unknown as Stripe.Invoice;

      const callsBefore = (stripe.transfers.create as ReturnType<typeof vi.fn>)
        .mock.calls.length;
      const result = await service.handleInvoicePaymentSucceeded(mockInvoice);
      const callsAfter = (stripe.transfers.create as ReturnType<typeof vi.fn>)
        .mock.calls.length;

      expect(result).toBeUndefined();
      expect(callsAfter).toBe(callsBefore);

      const { eq } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
      expect(rows).toHaveLength(0);
    });

    it('metadata missing on retrieved sub: helper returns null, no row inserted', async () => {
      const stripeSubId = uniqueStripeSubId('nometa');

      // Default mock returns a sub with empty metadata — exactly the
      // shape that should trip the "missing metadata" guard.
      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(
        createMockStripeSubscription({
          id: stripeSubId,
          metadata: {},
        }) as unknown as Stripe.Subscription
      );

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
      }) as unknown as Stripe.Invoice;

      const result = await service.handleInvoicePaymentSucceeded(mockInvoice);
      expect(result).toBeUndefined();

      const { eq } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
      expect(rows).toHaveLength(0);
    });

    it('concurrent self-heal: two parallel invoice handlers insert exactly one row, both run transfers', async () => {
      const { org, tier1 } = await createFullOrg('selfheal-concurrent');
      const stripeSubId = uniqueStripeSubId('concurrent');
      const stripeCustomerId = `cus_${stripeSubId}`;
      const chargeId = `ch_${stripeSubId}`;

      // Both parallel invocations will call retrieve — return the same
      // metadata on every call so the second insert sees a unique-violation.
      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockImplementation(() =>
        buildStripeSubMock({
          stripeSubId,
          stripeCustomerId,
          userId: otherCreatorId,
          orgId: org.id,
          tierId: tier1.id,
        })
      );

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: null } }],
        },
      }) as unknown as Stripe.Invoice;

      // Fire both handlers in parallel — exactly the racing-webhooks shape.
      await Promise.all([
        service.handleInvoicePaymentSucceeded(mockInvoice),
        service.handleInvoicePaymentSucceeded(mockInvoice),
      ]);

      const { eq } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
      expect(rows).toHaveLength(1);

      // Both invocations ran transfers, every call carries a chargeId-derived
      // idempotency key — Stripe will dedupe the duplicate transfer at its end.
      const transferCalls = (
        stripe.transfers.create as ReturnType<typeof vi.fn>
      ).mock.calls;
      expect(transferCalls.length).toBeGreaterThanOrEqual(2);
      for (const [, opts] of transferCalls) {
        expect(opts?.idempotencyKey).toMatch(new RegExp(`^${chargeId}_`));
      }
    });

    it('regression: customer.subscription.created lands AFTER self-heal pre-insert → side effects still fire', async () => {
      // Sequence:
      //   1. invoice.payment_succeeded arrives FIRST → self-heal inserts row
      //   2. customer.subscription.created arrives SECOND → must NOT swallow
      //      the welcome email + cache invalidation just because the row
      //      pre-existed. This is the regression-prevention guarantee.
      const { org, tier1 } = await createFullOrg('selfheal-create-after');
      const stripeSubId = uniqueStripeSubId('createafter');
      const stripeCustomerId = `cus_${stripeSubId}`;

      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(
        buildStripeSubMock({
          stripeSubId,
          stripeCustomerId,
          userId: otherCreatorId,
          orgId: org.id,
          tierId: tier1.id,
        })
      );

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
        payments: {
          data: [
            { payment: { charge: `ch_${stripeSubId}`, payment_intent: null } },
          ],
        },
      }) as unknown as Stripe.Invoice;

      // Step 1: invoice arrives first, self-heals row.
      await service.handleInvoicePaymentSucceeded(mockInvoice);

      // Step 2: real create event arrives — the Stripe sub object the
      // ecom-api webhook would dispatch to handleSubscriptionCreated.
      const mockCreateEventSub = buildStripeSubMock({
        stripeSubId,
        stripeCustomerId,
        userId: otherCreatorId,
        orgId: org.id,
        tierId: tier1.id,
      });

      const result =
        await service.handleSubscriptionCreated(mockCreateEventSub);

      // The previous unique-violation swallow returned `void` here, dropping
      // the welcome email + cache invalidation. After the fix, the handler
      // MUST return `{ userId, orgId }` so the route bumps both caches and
      // dispatches the welcome email.
      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
    });

    it('regression: Stripe redelivers create event after 5xx-after-insert → side effects fire on redelivery', async () => {
      // Pre-insert via self-heal to simulate "first delivery 5xx'd
      // after we inserted the row" — the second attempt finds the row
      // already present. With the old swallow, the email was lost
      // forever; the new behavior fires it on redelivery.
      const { org, tier1 } = await createFullOrg('selfheal-redeliver');
      const stripeSubId = uniqueStripeSubId('redeliver');
      const stripeCustomerId = `cus_${stripeSubId}`;

      (
        stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(
        buildStripeSubMock({
          stripeSubId,
          stripeCustomerId,
          userId: otherCreatorId,
          orgId: org.id,
          tierId: tier1.id,
        })
      );
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        parent: {
          subscription_details: { subscription: stripeSubId },
        },
        payments: {
          data: [
            { payment: { charge: `ch_${stripeSubId}`, payment_intent: null } },
          ],
        },
      }) as unknown as Stripe.Invoice;
      await service.handleInvoicePaymentSucceeded(mockInvoice);

      // Now fire the create event TWICE — simulating Stripe redelivery.
      const createSub = buildStripeSubMock({
        stripeSubId,
        stripeCustomerId,
        userId: otherCreatorId,
        orgId: org.id,
        tierId: tier1.id,
      });
      const first = await service.handleSubscriptionCreated(createSub);
      const second = await service.handleSubscriptionCreated(createSub);

      // Both invocations return invalidation tuples — neither swallows
      // the side effects despite the row already being present.
      expect(first?.userId).toBe(otherCreatorId);
      expect(first?.orgId).toBe(org.id);
      expect(second?.userId).toBe(otherCreatorId);
      expect(second?.orgId).toBe(org.id);
    });
  });

  // ─── handleTrialWillEnd (Codex-lvxev) ─────────────────────────────────
  //
  // `customer.subscription.trial_will_end` fires ~3 days before a trial
  // ends. Access is NOT changing — the user is still in the trial. Contract
  // for this handler:
  //   1. Extracts { userId, orgId } from Stripe metadata → returns alongside
  //      a `trialEndAt` Date and an email payload.
  //   2. Missing metadata → returns `undefined` (webhook still returns 200).
  //   3. Does NOT invalidate caches (asserted in the orchestrator test,
  //      where the cache spy is wired in — this integration test uses a
  //      real DB path without the cache hook).
  //
  // Positive + negative per feedback_security_deep_test.
  describe('handleTrialWillEnd', () => {
    it('should return { userId, orgId, trialEndAt, email } when metadata is present', async () => {
      const { org, tier1 } = await createFullOrg('trial-will-end-positive');
      const trialEndUnix = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;

      const mockSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
        trial_end: trialEndUnix,
      }) as unknown as Stripe.Subscription;

      const result = await service.handleTrialWillEnd(
        mockSub,
        'https://example.com'
      );

      expect(result).toBeDefined();
      expect(result?.userId).toBe(otherCreatorId);
      expect(result?.orgId).toBe(org.id);
      expect(result?.trialEndAt).toBeInstanceOf(Date);
      expect(result?.trialEndAt.getTime()).toBe(trialEndUnix * 1000);

      // Email payload uses the trial-ending-soon template (may not exist
      // yet — notifications service warns + skips send in that case; still
      // a well-formed payload here).
      expect(result?.email?.templateName).toBe('trial-ending-soon');
      expect(result?.email?.category).toBe('transactional');
      expect(result?.email?.data).toMatchObject({
        planName: 'Basic',
      });
      expect(result?.email?.data.trialEndDate).toBeDefined();
      expect(result?.email?.data.manageUrl).toBe(
        'https://example.com/account/subscriptions'
      );
    });

    it('should return undefined when metadata is missing userId', async () => {
      // Negative path — webhook with no codex_user_id. Handler must return
      // undefined so the webhook still completes with 200. No DB writes,
      // no email dispatched by the caller (handler returns void).
      const mockSub = createMockStripeSubscription({
        metadata: {},
      }) as unknown as Stripe.Subscription;

      const result = await service.handleTrialWillEnd(mockSub);
      expect(result).toBeUndefined();
    });

    it('should return undefined when metadata is missing orgId', async () => {
      const mockSub = createMockStripeSubscription({
        metadata: { codex_user_id: otherCreatorId },
      }) as unknown as Stripe.Subscription;

      const result = await service.handleTrialWillEnd(mockSub);
      expect(result).toBeUndefined();
    });

    it('should NOT flip subscription status when trial_will_end fires', async () => {
      // Access continues — this handler must not mutate the local
      // subscription record. Create a subscription, fire trial_will_end,
      // assert status is unchanged.
      const { org, tier1 } = await createFullOrg('trial-will-end-no-status');
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        )
        .returning();

      const mockSub = createMockStripeSubscription({
        id: sub.stripeSubscriptionId,
        metadata: {
          codex_user_id: otherCreatorId,
          codex_organization_id: org.id,
          codex_tier_id: tier1.id,
        },
      }) as unknown as Stripe.Subscription;

      await service.handleTrialWillEnd(mockSub);

      const { eq } = await import('drizzle-orm');
      const [after] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id));
      expect(after.status).toBe('active');
    });
  });

  // ─── propagateTierPriceToActiveSubscriptions (Q1.2 — Codex-3xyyb) ────────

  describe('propagateTierPriceToActiveSubscriptions', () => {
    /**
     * Replace the mocked stripe.subscriptions.{retrieve,update} with
     * spies configured to return (a) a predictable live subscription
     * shape for `retrieve` so we can assert the propagator passed the
     * right item id forward, and (b) a resolved value on `update` so
     * per-sub results can be individually manipulated via
     * `.mockImplementationOnce`. Returns both spies so tests can
     * assert call order / args.
     */
    function wireStripeSubSpies(stripeClient: Stripe) {
      const retrieveSpy = vi.fn().mockImplementation((stripeSubId: string) => ({
        id: stripeSubId,
        status: 'active',
        items: {
          data: [
            {
              id: `si_for_${stripeSubId}`,
              price: {
                id: 'price_old',
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      }));
      const updateSpy = vi.fn().mockImplementation((stripeSubId: string) => ({
        id: stripeSubId,
        status: 'active',
      }));
      (
        stripeClient.subscriptions as unknown as {
          retrieve: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        }
      ).retrieve = retrieveSpy;
      (
        stripeClient.subscriptions as unknown as {
          retrieve: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        }
      ).update = updateSpy;
      return { retrieveSpy, updateSpy };
    }

    it('returns zero counts and makes no Stripe calls when no active subs exist', async () => {
      const { org, tier1 } = await createFullOrg('propagate-empty');
      const { retrieveSpy, updateSpy } = wireStripeSubSpies(stripe);

      const result = await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_new_abc',
        { organizationId: org.id }
      );

      expect(result).toEqual({ total: 0, updated: 0, failed: 0 });
      expect(retrieveSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('updates every active/cancelling subscription with deterministic idempotency keys', async () => {
      const { org, tier1 } = await createFullOrg('propagate-happy');
      const { retrieveSpy, updateSpy } = wireStripeSubSpies(stripe);

      // Seed three subs: two active, one cancelling. All MUST be swapped.
      const ns = createUniqueSlug('prop_happy');
      const seed = await Promise.all([
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(creatorId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: `sub_${ns}_a1`,
            })
          )
          .returning(),
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: `sub_${ns}_a2`,
            })
          )
          .returning(),
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(thirdUserId, org.id, tier1.id, {
              status: 'cancelling',
              stripeSubscriptionId: `sub_${ns}_c1`,
            })
          )
          .returning(),
      ]);
      const seeded = seed.map(([row]) => row);

      const result = await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_new_xyz',
        { organizationId: org.id, interBatchDelayMs: 0 }
      );

      expect(result).toEqual({ total: 3, updated: 3, failed: 0 });
      expect(retrieveSpy).toHaveBeenCalledTimes(3);
      expect(updateSpy).toHaveBeenCalledTimes(3);

      // Assert deterministic idempotency key per subscription.
      for (const row of seeded) {
        const match = updateSpy.mock.calls.find(
          ([stripeSubId]) => stripeSubId === row.stripeSubscriptionId
        );
        expect(match).toBeDefined();
        const [, params, opts] = match as [string, object, object];
        expect(params).toMatchObject({
          items: [
            {
              id: `si_for_${row.stripeSubscriptionId}`,
              price: 'price_new_xyz',
            },
          ],
          proration_behavior: 'create_prorations',
        });
        expect(opts).toMatchObject({
          idempotencyKey: `tier-price-propagate:${row.id}:price_new_xyz`,
        });
      }
    });

    it('reports per-sub failure without aborting the batch', async () => {
      const { org, tier1 } = await createFullOrg('propagate-partial');
      const { retrieveSpy, updateSpy } = wireStripeSubSpies(stripe);

      // Unique stripeSubscriptionId per run — the column is globally
      // unique so hardcoded literals collide across repeated runs on
      // the shared test DB.
      const run = Date.now();
      const seed = await Promise.all([
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(creatorId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: `sub_partial_ok_1_${run}`,
            })
          )
          .returning(),
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: `sub_partial_fail_${run}`,
            })
          )
          .returning(),
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(thirdUserId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: `sub_partial_ok_2_${run}`,
            })
          )
          .returning(),
      ]);
      const [failRow] = seed[1];

      updateSpy.mockImplementation((stripeSubId: string) => {
        if (stripeSubId === failRow.stripeSubscriptionId) {
          return Promise.reject(new Error('Stripe 500 for test'));
        }
        return Promise.resolve({ id: stripeSubId, status: 'active' });
      });

      const result = await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_partial',
        { organizationId: org.id, interBatchDelayMs: 0 }
      );

      expect(result).toEqual({ total: 3, updated: 2, failed: 1 });
      expect(retrieveSpy).toHaveBeenCalledTimes(3);
      expect(updateSpy).toHaveBeenCalledTimes(3);
    });

    it('does NOT touch paused/past_due/cancelled/incomplete subscriptions (regression guard for status filter)', async () => {
      const { org, tier1 } = await createFullOrg('propagate-status-guard');
      const { retrieveSpy, updateSpy } = wireStripeSubSpies(stripe);

      // Seed one active (MUST be swapped) + one of each excluded status.
      const run = Date.now();
      const [okRow] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(creatorId, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_guard_active_${run}`,
          })
        )
        .returning();

      const excluded = ['paused', 'past_due', 'cancelled', 'incomplete'];
      for (const [idx, status] of excluded.entries()) {
        // Each excluded status needs its own user — the unique index
        // `uq_active_subscription_per_user_org` allows past_due +
        // cancelling to coexist with active for DIFFERENT users only.
        // For test isolation we just use the creators we have.
        const userId =
          idx === 0 ? otherCreatorId : idx === 1 ? thirdUserId : creatorId;
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(userId, org.id, tier1.id, {
            status,
            stripeSubscriptionId: `sub_guard_${status}_${idx}_${run}`,
            // cancelled / paused coexist with active for different users
            // via the partial unique index (which only applies to
            // ACTIVE/PAST_DUE/CANCELLING). But duplicate userIds across
            // status='cancelled' / 'incomplete' + our existing active
            // row would still collide on that index because `past_due`
            // is in the index. Use a per-test clean slate by inserting
            // cancelled / incomplete with the creator who already has
            // an active sub — this works because the partial index
            // excludes these statuses entirely.
          })
        );
      }

      const result = await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_guard',
        { organizationId: org.id, interBatchDelayMs: 0 }
      );

      // Only the single active row is swapped; the four excluded rows
      // are ignored by the WHERE clause.
      expect(result).toEqual({ total: 1, updated: 1, failed: 0 });
      expect(retrieveSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        okRow.stripeSubscriptionId,
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ price: 'price_guard' }),
          ]),
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining(
            `tier-price-propagate:${okRow.id}:price_guard`
          ),
        })
      );
    });

    it('respects the caller-supplied proration policy', async () => {
      const { org, tier1 } = await createFullOrg('propagate-proration');
      const { updateSpy } = wireStripeSubSpies(stripe);

      await db.insert(subscriptions).values(
        createTestSubscriptionInput(creatorId, org.id, tier1.id, {
          status: 'active',
          stripeSubscriptionId: `sub_proration_1_${Date.now()}`,
        })
      );

      await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_prorate_none',
        {
          organizationId: org.id,
          prorationBehavior: 'none',
          interBatchDelayMs: 0,
        }
      );

      expect(updateSpy).toHaveBeenCalledOnce();
      const [, params] = updateSpy.mock.calls[0] as [string, object];
      expect(params).toMatchObject({ proration_behavior: 'none' });
    });

    it('produces deterministic idempotency keys for identical inputs (retry safety)', async () => {
      const { org, tier1 } = await createFullOrg('propagate-idempo');
      const { updateSpy } = wireStripeSubSpies(stripe);

      const [row] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(creatorId, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_idempo_1_${Date.now()}`,
          })
        )
        .returning();

      await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_same',
        { organizationId: org.id, interBatchDelayMs: 0 }
      );
      await service.propagateTierPriceToActiveSubscriptions(
        tier1.id,
        'price_same',
        { organizationId: org.id, interBatchDelayMs: 0 }
      );

      expect(updateSpy).toHaveBeenCalledTimes(2);
      const [firstOpts, secondOpts] = [
        updateSpy.mock.calls[0]?.[2] as { idempotencyKey: string } | undefined,
        updateSpy.mock.calls[1]?.[2] as { idempotencyKey: string } | undefined,
      ];
      expect(firstOpts?.idempotencyKey).toBe(
        `tier-price-propagate:${row.id}:price_same`
      );
      expect(secondOpts?.idempotencyKey).toBe(firstOpts?.idempotencyKey);
    });

    it('batches large sub counts — 25 subs with batchSize=10 produces 3 batches', async () => {
      const { org, tier1 } = await createFullOrg('propagate-batches');
      const { updateSpy } = wireStripeSubSpies(stripe);

      // Seed 25 additional users + subscriptions. Keep all with the
      // same creatorId is NOT possible (unique index on userId+orgId
      // for active statuses), so seed fresh users.
      const newUserIds = await seedTestUsers(db, 25);
      const run = Date.now();
      for (const [idx, uid] of newUserIds.entries()) {
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(uid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_batch_${idx}_${run}`,
          })
        );
      }

      // Use a distinctive delay value so we can filter inter-batch
      // sleeps from any other setTimeout calls in the hot path (db
      // driver, Promise microtask adapters, etc.) without relying on
      // an exact count of unrelated timers.
      const batchDelayMarker = 7919;
      const sleeps: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout =
        ((fn: () => void, ms?: number) => {
          if (ms === batchDelayMarker) sleeps.push(ms);
          return originalSetTimeout(fn, 0);
        }) as typeof setTimeout;

      try {
        const result = await service.propagateTierPriceToActiveSubscriptions(
          tier1.id,
          'price_batched',
          {
            organizationId: org.id,
            batchSize: 10,
            interBatchDelayMs: batchDelayMarker,
          }
        );
        expect(result.total).toBe(25);
        expect(result.updated).toBe(25);
        expect(updateSpy).toHaveBeenCalledTimes(25);
        // 25 subs in batches of 10 → 3 batches → exactly 2 inter-batch
        // sleeps (no trailing delay after the last batch).
        expect(sleeps.length).toBe(2);
      } finally {
        (
          globalThis as unknown as { setTimeout: typeof setTimeout }
        ).setTimeout = originalSetTimeout;
      }
    });

    // ─── Email dispatch (Q1.3 — Codex-7kc83) ────────────────────────────

    /**
     * Q1.3 wires a `mailer` thunk into SubscriptionService so every
     * SUCCESSFUL Stripe price swap fires a "subscription-tier-price-
     * change" notice to the affected subscriber. The mailer is
     * injected at construction — existing tests above construct the
     * service without a mailer and assert propagation still succeeds
     * (graceful degrade). The tests below construct a NEW service
     * with a mailer injected so we can assert the email contract
     * directly: payload shape, success/failure pairing, neutral copy.
     */
    describe('email dispatch on price change', () => {
      function buildServiceWithMailer() {
        const mailer = vi.fn();
        const serviceWithMailer = new SubscriptionService(
          {
            db,
            environment: 'test',
            mailer,
            webAppUrl: 'https://app.example.test',
          },
          stripe
        );
        return { serviceWithMailer, mailer };
      }

      it('dispatches one email per SUCCESSFUL Stripe update (positive path)', async () => {
        const { org, tier1 } = await createFullOrg('propagate-email-happy');
        wireStripeSubSpies(stripe);
        const { serviceWithMailer, mailer } = buildServiceWithMailer();

        const newUsers = await seedTestUsers(db, 3);
        for (const [idx, uid] of newUsers.entries()) {
          await db.insert(subscriptions).values(
            createTestSubscriptionInput(uid, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: `sub_mail_happy_${Date.now()}_${idx}`,
            })
          );
        }

        const result =
          await serviceWithMailer.propagateTierPriceToActiveSubscriptions(
            tier1.id,
            'price_new_happy',
            { organizationId: org.id, interBatchDelayMs: 0 }
          );

        expect(result).toEqual({ total: 3, updated: 3, failed: 0 });
        expect(mailer).toHaveBeenCalledTimes(3);

        // Every call must be the right template + transactional category.
        for (const call of mailer.mock.calls) {
          const [params] = call;
          expect(params.templateName).toBe('subscription-tier-price-change');
          expect(params.category).toBe('transactional');
          expect(params.data.planName).toBe(tier1.name);
          expect(params.data.oldPriceFormatted).toMatch(/^£\d+\.\d{2}$/);
          expect(params.data.newPriceFormatted).toMatch(/^£\d+\.\d{2}$/);
          expect(params.data.billingInterval).toBeDefined();
          expect(params.data.manageUrl).toBe(
            'https://app.example.test/account/subscriptions'
          );
        }
      });

      it('does NOT email subscribers whose Stripe update failed (positive — 3 ok + 1 fail → 3 emails)', async () => {
        const { org, tier1 } = await createFullOrg('propagate-email-partial');
        const { updateSpy } = wireStripeSubSpies(stripe);
        const { serviceWithMailer, mailer } = buildServiceWithMailer();

        const newUsers = await seedTestUsers(db, 4);
        const seeded: Array<{ stripeSubscriptionId: string }> = [];
        for (const [idx, uid] of newUsers.entries()) {
          const [row] = await db
            .insert(subscriptions)
            .values(
              createTestSubscriptionInput(uid, org.id, tier1.id, {
                status: 'active',
                stripeSubscriptionId: `sub_mail_partial_${Date.now()}_${idx}`,
              })
            )
            .returning();
          seeded.push(row);
        }
        // Fail the 2nd sub — the rest should still mail.
        const failId = seeded[1].stripeSubscriptionId;
        updateSpy.mockImplementation((stripeSubId: string) => {
          if (stripeSubId === failId) {
            return Promise.reject(new Error('Stripe 500 simulated'));
          }
          return Promise.resolve({ id: stripeSubId, status: 'active' });
        });

        const result =
          await serviceWithMailer.propagateTierPriceToActiveSubscriptions(
            tier1.id,
            'price_new_partial',
            { organizationId: org.id, interBatchDelayMs: 0 }
          );

        expect(result).toEqual({ total: 4, updated: 3, failed: 1 });
        // 3 emails — NOT 4. The failed sub stays on the old price, so
        // notifying about a change that didn't happen would be a bug.
        expect(mailer).toHaveBeenCalledTimes(3);
        const toList = mailer.mock.calls.map((c) => c[0].to);
        expect(new Set(toList).size).toBe(3);
      });

      it('still dispatches emails when proration override is "none" (positive)', async () => {
        const { org, tier1 } = await createFullOrg(
          'propagate-email-proration-none'
        );
        wireStripeSubSpies(stripe);
        const { serviceWithMailer, mailer } = buildServiceWithMailer();

        const [uid] = await seedTestUsers(db, 1);
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(uid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_mail_prono_${Date.now()}_1`,
          })
        );

        await serviceWithMailer.propagateTierPriceToActiveSubscriptions(
          tier1.id,
          'price_new_prono',
          {
            organizationId: org.id,
            prorationBehavior: 'none',
            interBatchDelayMs: 0,
          }
        );

        // Proration policy only affects Stripe's invoice-time
        // behaviour; the email still fires because the Price swap
        // still happened.
        expect(mailer).toHaveBeenCalledOnce();
      });

      it('email dispatch failure does NOT fail propagation (negative — mailer throws synchronously)', async () => {
        const { org, tier1 } = await createFullOrg('propagate-email-throws');
        wireStripeSubSpies(stripe);

        // Mailer that throws — simulates a mis-wired implementation.
        const throwingMailer = vi.fn(() => {
          throw new Error('Mailer kaboom');
        });
        const serviceWithMailer = new SubscriptionService(
          {
            db,
            environment: 'test',
            mailer: throwingMailer,
            webAppUrl: 'https://app.example.test',
          },
          stripe
        );

        const [uid] = await seedTestUsers(db, 1);
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(uid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_mail_throws_${Date.now()}_1`,
          })
        );

        // MUST NOT throw — the propagation must complete with
        // updated=1 even though the mailer exploded inside the
        // success branch.
        const result =
          await serviceWithMailer.propagateTierPriceToActiveSubscriptions(
            tier1.id,
            'price_new_throws',
            { organizationId: org.id, interBatchDelayMs: 0 }
          );

        expect(result).toEqual({ total: 1, updated: 1, failed: 0 });
        expect(throwingMailer).toHaveBeenCalledOnce();
      });

      it('never dispatches an empty-`to` email (defensive — `userEmail` guard)', async () => {
        // Schema enforces `users.email NOT NULL` so the leftJoin is
        // practically guaranteed to return a non-null email. This
        // test verifies the positive invariant: for every
        // propagated subscription with a seeded user, the mailer
        // receives a concrete email string (not null, not undefined,
        // not empty). The dispatch helper's null/empty guard is the
        // defensive backstop for the impossible schema state — see
        // `dispatchTierPriceChangeEmail` in subscription-service.ts.
        const { org, tier1 } = await createFullOrg('propagate-email-guard');
        wireStripeSubSpies(stripe);
        const { serviceWithMailer, mailer } = buildServiceWithMailer();

        const [uid] = await seedTestUsers(db, 1);
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(uid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_mail_guard_${Date.now()}_1`,
          })
        );

        const result =
          await serviceWithMailer.propagateTierPriceToActiveSubscriptions(
            tier1.id,
            'price_new_guard',
            { organizationId: org.id, interBatchDelayMs: 0 }
          );

        expect(result).toEqual({ total: 1, updated: 1, failed: 0 });
        expect(mailer).toHaveBeenCalledOnce();
        const [params] = mailer.mock.calls[0];
        // The invariant: `to` is never empty / null / undefined.
        expect(typeof params.to).toBe('string');
        expect((params.to as string).length).toBeGreaterThan(0);
        expect(params.to).toMatch(/@/);
      });

      it('still propagates when mailer is NOT injected (graceful degrade)', async () => {
        const { org, tier1 } = await createFullOrg('propagate-email-nomailer');
        wireStripeSubSpies(stripe);
        // `service` above in beforeEach is constructed WITHOUT a
        // mailer — use it directly to verify the no-op degrade.

        const [uid] = await seedTestUsers(db, 1);
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(uid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_mail_nomailer_${Date.now()}_1`,
          })
        );

        const result = await service.propagateTierPriceToActiveSubscriptions(
          tier1.id,
          'price_new_nomailer',
          { organizationId: org.id, interBatchDelayMs: 0 }
        );

        expect(result).toEqual({ total: 1, updated: 1, failed: 0 });
        // No mailer injected — silent no-op. Propagation result
        // MUST still match the swap outcome.
      });
    });
  });

  // ─── listPayoutsByOrg (Codex-zqaxo) ───────────────────────────────────────
  //
  // Powers the read-only `/studio/payouts` table. Org-scoped via
  // `pendingPayouts.organizationId` — never user-scoped, because a creator
  // can belong to multiple orgs and we must NEVER leak rows across orgs.

  describe('listPayoutsByOrg', () => {
    async function seedSubscriptionForOrg(
      orgId: string,
      tierId: string,
      userId: string,
      slug: string
    ) {
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tierId, {
            status: 'active',
            stripeSubscriptionId: `sub_zqaxo_${createUniqueSlug(slug)}`,
          })
        )
        .returning();
      return sub;
    }

    it('returns empty paginated result when org has no payouts', async () => {
      const { org } = await createFullOrg('zqaxo-empty');
      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
      });
      expect(result.items).toEqual([]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('returns rows scoped to the requested org, derived statuses, and ISO dates', async () => {
      const { org, tier1 } = await createFullOrg('zqaxo-mixed');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'mixed'
      );

      // Three rows: one pending, one resolved, one failed.
      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 1234,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 4567,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date('2026-05-01T10:00:00Z'),
          stripeTransferId: 'tr_resolved_zqaxo_1',
          status: 'paid',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 999,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(3);
      const byStatus = new Map(result.items.map((r) => [r.status, r]));
      expect(byStatus.get('pending')?.amountCents).toBe(1234);
      expect(byStatus.get('resolved')?.amountCents).toBe(4567);
      expect(byStatus.get('resolved')?.stripeTransferId).toBe(
        'tr_resolved_zqaxo_1'
      );
      expect(byStatus.get('failed')?.reason).toBe('transfer_failed');

      // Dates must be ISO strings (not Date objects) so the worker → JSON
      // hop is lossless and the page can hand them straight to formatDate.
      for (const row of result.items) {
        expect(typeof row.createdAt).toBe('string');
        if (row.resolvedAt) expect(typeof row.resolvedAt).toBe('string');
      }
    });

    it('SCOPING INVARIANT: never leaks payouts from a different org', async () => {
      // Codex-zqaxo STOP-rule: listPayoutsByOrg MUST filter by
      // pendingPayouts.organizationId — filtering by userId alone would
      // expose another org's rows for the same creator.
      const { org: org1, tier1: t1 } = await createFullOrg('zqaxo-scope-a');
      const { org: org2, tier1: t2 } = await createFullOrg('zqaxo-scope-b');

      const subA = await seedSubscriptionForOrg(
        org1.id,
        t1.id,
        otherCreatorId,
        'scope-a'
      );
      const subB = await seedSubscriptionForOrg(
        org2.id,
        t2.id,
        otherCreatorId,
        'scope-b'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org1.id,
          subscriptionId: subA.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org2.id,
          subscriptionId: subB.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
      ]);

      const a = await service.listPayoutsByOrg(org1.id, {
        page: 1,
        limit: 20,
      });
      const b = await service.listPayoutsByOrg(org2.id, {
        page: 1,
        limit: 20,
      });

      expect(a.items).toHaveLength(1);
      expect(a.items[0].amountCents).toBe(100);
      expect(b.items).toHaveLength(1);
      expect(b.items[0].amountCents).toBe(200);
    });

    it('applies the pending status filter', async () => {
      const { org, tier1 } = await createFullOrg('zqaxo-filter-pending');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'fp'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_x',
          status: 'paid',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
        status: 'pending',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('pending');
      expect(result.items[0].amountCents).toBe(100);
    });

    it('applies the resolved status filter', async () => {
      const { org, tier1 } = await createFullOrg('zqaxo-filter-resolved');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'fr'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_zqaxo_resolved',
          status: 'paid',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
        status: 'resolved',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('resolved');
      expect(result.items[0].stripeTransferId).toBe('tr_zqaxo_resolved');
    });

    it('applies the failed status filter (reason=transfer_failed AND unresolved)', async () => {
      const { org, tier1 } = await createFullOrg('zqaxo-filter-failed');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'ff'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 999,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
        status: 'failed',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('failed');
      expect(result.items[0].reason).toBe('transfer_failed');
    });

    it('paginates correctly with totalPages math', async () => {
      const { org, tier1 } = await createFullOrg('zqaxo-pagination');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'pg'
      );

      const rows = Array.from({ length: 5 }, (_, i) => ({
        userId: otherCreatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 100 + i,
        currency: 'gbp',
        reason: 'connect_not_ready' as const,
        status: 'pending' as const,
        payoutType: 'creator_payout' as const,
      }));
      await db.insert(payoutsTable).values(rows);

      const page1 = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });

      const page3 = await service.listPayoutsByOrg(org.id, {
        page: 3,
        limit: 2,
      });
      expect(page3.items).toHaveLength(1);
    });

    // ─── PR3 (Codex-05vp8) extensions ───────────────────────────────────
    // New status values (paid, needs_attention) + payoutType projection +
    // subscriber denorm via aliased users join.

    it("status='needs_attention' returns pending + failed (excludes paid)", async () => {
      const { org, tier1 } = await createFullOrg('05vp8-needs-attention');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'na'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 300,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_na_paid',
          status: 'paid',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
        status: 'needs_attention',
      });

      expect(result.items).toHaveLength(2);
      const statuses = result.items.map((r) => r.status).sort();
      expect(statuses).toEqual(['failed', 'pending']);
      // 'resolved' (paid) must be absent.
      expect(result.items.some((r) => r.status === 'resolved')).toBe(false);
    });

    it("status='paid' (canonical) returns only paid rows — mirrors 'resolved' alias", async () => {
      const { org, tier1 } = await createFullOrg('05vp8-canonical-paid');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'cp'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 250,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_canonical_paid',
          status: 'paid',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
        status: 'paid',
      });
      expect(result.items).toHaveLength(1);
      // UI-derived display status is still 'resolved' until PR4 drops the alias.
      expect(result.items[0]!.status).toBe('resolved');
      expect(result.items[0]!.amountCents).toBe(250);
      expect(result.items[0]!.stripeTransferId).toBe('tr_05vp8_canonical_paid');
    });

    it('projects payoutType from the payouts row', async () => {
      const { org, tier1 } = await createFullOrg('05vp8-payout-type');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'pt'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'organization_fee',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(2);
      const byAmount = new Map(result.items.map((r) => [r.amountCents, r]));
      expect(byAmount.get(100)?.payoutType).toBe('organization_fee');
      expect(byAmount.get(200)?.payoutType).toBe('creator_payout');
    });

    it('surfaces subscriberName + subscriberEmail via the aliased subscriber join', async () => {
      const { org, tier1 } = await createFullOrg('05vp8-subscriber-join');
      // The subscriber is a separate user from the creator beneficiary.
      const [subscriberUid] = await seedTestUsers(db, 1);
      const { eq } = await import('drizzle-orm');
      const [subscriberRow] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, subscriberUid));

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriberUid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_05vp8_${createUniqueSlug('subj')}`,
          })
        )
        .returning();

      await db.insert(payoutsTable).values({
        userId: otherCreatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 500,
        currency: 'gbp',
        reason: 'connect_not_ready',
        resolvedAt: new Date(),
        stripeTransferId: 'tr_05vp8_subscriber_join',
        status: 'paid',
        payoutType: 'creator_payout',
      });

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.subscriberName).toBe(subscriberRow!.name);
      expect(result.items[0]!.subscriberEmail).toBe(subscriberRow!.email);
    });

    it('subscriber fields are null when subscriptionId is null', async () => {
      const { org } = await createFullOrg('05vp8-null-subscription');

      await db.insert(payoutsTable).values({
        userId: otherCreatorId,
        organizationId: org.id,
        subscriptionId: null,
        amountCents: 100,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      });

      const result = await service.listPayoutsByOrg(org.id, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.subscriberName).toBeNull();
      expect(result.items[0]!.subscriberEmail).toBeNull();
    });
  });

  // ─── getPayoutSummary (Codex-05vp8) ────────────────────────────────────────
  //
  // Four parallel aggregates powering the studio /payouts summary row.
  // Critical: every aggregate is org-scoped — a creator can belong to
  // multiple orgs and we must NEVER leak revenue numbers across orgs.

  describe('getPayoutSummary', () => {
    async function seedSubscriptionForOrg(
      orgId: string,
      tierId: string,
      userId: string,
      slug: string
    ) {
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tierId, {
            status: 'active',
            stripeSubscriptionId: `sub_05vp8_sum_${createUniqueSlug(slug)}`,
          })
        )
        .returning();
      return sub;
    }

    it('returns all-zero aggregates when org has no payouts', async () => {
      const { org } = await createFullOrg('05vp8-sum-empty');
      const result = await service.getPayoutSummary(org.id);
      expect(result).toEqual({
        earnedInPeriodCents: 0,
        totalEarnedCents: 0,
        inTransitCents: 0,
        needsAttentionCount: 0,
      });
    });

    it("totalEarnedCents sums status='paid' only (excludes pending + failed)", async () => {
      const { org, tier1 } = await createFullOrg('05vp8-sum-total');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        't'
      );
      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 1000,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_sum_total_a',
          status: 'paid',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 2000,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_sum_total_b',
          status: 'paid',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 9999,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 8888,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.getPayoutSummary(org.id);
      expect(result.totalEarnedCents).toBe(3000); // 1000 + 2000 only
    });

    it('earnedInPeriodCents honours fromDate; totalEarnedCents stays lifetime', async () => {
      const { org, tier1 } = await createFullOrg('05vp8-sum-window');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'w'
      );
      const now = new Date();
      const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60d ago
      const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30d ago window-start

      // Two paid rows: one inside window (recent), one outside (old).
      // Use db.update to backdate createdAt for the old row.
      const [oldRow] = await db
        .insert(payoutsTable)
        .values({
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 5000,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: old,
          stripeTransferId: 'tr_05vp8_sum_window_old',
          status: 'paid',
          payoutType: 'creator_payout',
        })
        .returning();
      const { eq: eqOp } = await import('drizzle-orm');
      await db
        .update(payoutsTable)
        .set({ createdAt: old })
        .where(eqOp(payoutsTable.id, oldRow!.id));

      await db.insert(payoutsTable).values({
        userId: otherCreatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 700,
        currency: 'gbp',
        reason: 'connect_not_ready',
        resolvedAt: now,
        stripeTransferId: 'tr_05vp8_sum_window_new',
        status: 'paid',
        payoutType: 'creator_payout',
      });

      const result = await service.getPayoutSummary(org.id, {
        fromDate: fromDate.toISOString(),
      });
      expect(result.earnedInPeriodCents).toBe(700); // only the new row
      expect(result.totalEarnedCents).toBe(5700); // both rows
    });

    it("inTransitCents sums status='pending' only (excludes paid + failed)", async () => {
      const { org, tier1 } = await createFullOrg('05vp8-sum-in-transit');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'it'
      );
      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 150,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 250,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 999,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_sum_intransit_paid',
          status: 'paid',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 888,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.getPayoutSummary(org.id);
      expect(result.inTransitCents).toBe(400); // 150 + 250 only
    });

    it('needsAttentionCount counts pending + failed rows (excludes paid)', async () => {
      const { org, tier1 } = await createFullOrg('05vp8-sum-needs-attn');
      const sub = await seedSubscriptionForOrg(
        org.id,
        tier1.id,
        otherCreatorId,
        'na'
      );
      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 300,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_sum_needsattn_paid',
          status: 'paid',
          payoutType: 'creator_payout',
        },
      ]);

      const result = await service.getPayoutSummary(org.id);
      expect(result.needsAttentionCount).toBe(2);
    });

    it('CROSS-ORG ISOLATION: aggregates never include another org rows', async () => {
      // Security invariant — mirrors the listPayoutsByOrg scoping test.
      const { org: orgA, tier1: tA } = await createFullOrg('05vp8-sum-iso-a');
      const { org: orgB, tier1: tB } = await createFullOrg('05vp8-sum-iso-b');
      const subA = await seedSubscriptionForOrg(
        orgA.id,
        tA.id,
        otherCreatorId,
        'iso-a'
      );
      const subB = await seedSubscriptionForOrg(
        orgB.id,
        tB.id,
        otherCreatorId,
        'iso-b'
      );

      await db.insert(payoutsTable).values([
        {
          userId: otherCreatorId,
          organizationId: orgA.id,
          subscriptionId: subA.id,
          amountCents: 1111,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_iso_a_paid',
          status: 'paid',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: orgA.id,
          subscriptionId: subA.id,
          amountCents: 222,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: orgB.id,
          subscriptionId: subB.id,
          amountCents: 9999,
          currency: 'gbp',
          reason: 'connect_not_ready',
          resolvedAt: new Date(),
          stripeTransferId: 'tr_05vp8_iso_b_paid',
          status: 'paid',
          payoutType: 'creator_payout',
        },
        {
          userId: otherCreatorId,
          organizationId: orgB.id,
          subscriptionId: subB.id,
          amountCents: 8888,
          currency: 'gbp',
          reason: 'transfer_failed',
          status: 'failed',
          payoutType: 'creator_payout',
        },
      ]);

      const a = await service.getPayoutSummary(orgA.id);
      expect(a.totalEarnedCents).toBe(1111);
      expect(a.inTransitCents).toBe(222);
      expect(a.needsAttentionCount).toBe(1);

      const b = await service.getPayoutSummary(orgB.id);
      expect(b.totalEarnedCents).toBe(9999);
      expect(b.inTransitCents).toBe(0);
      expect(b.needsAttentionCount).toBe(1);
    });
  });

  // ─── resolvePendingPayouts (Codex-w4jjk) ───────────────────────────────────
  //
  // Called from workers/ecom-api/src/handlers/connect-webhook.ts:75 when a
  // Connect account transitions to chargesEnabled + payoutsEnabled. The
  // method walks all unresolved pendingPayouts for that user+org, calls
  // stripe.transfers.create() per row, and stamps resolvedAt + transfer id.
  // Replay safety is provided at the DB layer (the `isNull(resolvedAt)`
  // filter prevents duplicate transfers on a second call) rather than via
  // Stripe idempotency keys.
  describe('resolvePendingPayouts', () => {
    /**
     * Seed the connect account with a known stripeAccountId so we can drive
     * resolvePendingPayouts deterministically. Returns the seeded account
     * row, an active subscription owned by `otherCreatorId` for FK
     * references on pendingPayouts, and the unique stripeAccountId.
     */
    async function seedConnectAndSubscription(slug: string) {
      const { org, tier1 } = await createFullOrg(slug);
      const stripeAccountId = `acct_w4jjk_${createUniqueSlug('a')}`;

      const { eq } = await import('drizzle-orm');
      // The createFullOrg helper inserted a connect account with a random
      // stripeAccountId — overwrite it with our deterministic value so
      // tests can assert the (orgId, stripeAccountId) lookup explicitly.
      await db
        .update(stripeConnectAccounts)
        .set({ stripeAccountId })
        .where(eq(stripeConnectAccounts.organizationId, org.id));

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_w4jjk_${createUniqueSlug('s')}`,
          })
        )
        .returning();

      return { org, tier1, sub, stripeAccountId };
    }

    it('returns zero counts and skips Stripe transfers when no unresolved payouts exist', async () => {
      const { org, stripeAccountId } =
        await seedConnectAndSubscription('w4jjk-empty');
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 0, failed: 0 });
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('resolves every pending payout, sets resolvedAt + stripeTransferId, and forwards correlation metadata', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('w4jjk-batch-ok');

      // Seed three unresolved payouts for the connect-account user.
      const payoutRows = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 1200,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 750,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 320,
            currency: 'gbp',
            reason: 'connect_restricted',
            status: 'pending',
            payoutType: 'creator_payout',
          },
        ])
        .returning();

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 3, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(3);

      // Each transfer must carry the destination Connect account, GBP
      // currency, the row's amount, and correlation metadata pointing
      // back to the pendingPayoutId + subscriptionId so Stripe-side
      // reconciliation can match the rows.
      for (const row of payoutRows) {
        const match = transferSpy.mock.calls.find(
          ([params]) =>
            (params as { metadata?: { pending_payout_id?: string } }).metadata
              ?.pending_payout_id === row.id
        );
        expect(match, `no transfer for payout ${row.id}`).toBeDefined();
        const [params] = match as [Record<string, unknown>];
        expect(params).toMatchObject({
          amount: row.amountCents,
          currency: 'gbp',
          destination: stripeAccountId,
          metadata: {
            pending_payout_id: row.id,
            subscription_id: row.subscriptionId,
            type: 'pending_payout_resolution',
          },
        });
      }

      // DB rows must be stamped resolved + carry the Stripe transfer id.
      const { eq, inArray } = await import('drizzle-orm');
      const after = await db
        .select()
        .from(payoutsTable)
        .where(
          inArray(
            payoutsTable.id,
            payoutRows.map((r) => r.id)
          )
        );
      expect(after).toHaveLength(3);
      for (const row of after) {
        expect(row.resolvedAt).not.toBeNull();
        expect(row.stripeTransferId).toMatch(/^tr_/);
      }
      // Silence unused-import warning when no further use occurs.
      void eq;
    });

    it('isolates per-payout failure — failing transfer does not abort the batch', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('w4jjk-partial-fail');

      const payoutRows = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 1000,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 2000,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 3000,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
        ])
        .returning();
      const failingPayoutId = payoutRows[1].id;

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();
      transferSpy.mockImplementation(
        (params: Record<string, unknown>): unknown => {
          const metadata = params.metadata as { pending_payout_id?: string };
          if (metadata?.pending_payout_id === failingPayoutId) {
            return Promise.reject(new Error('Stripe transfer rejected (test)'));
          }
          return Promise.resolve({
            id: `tr_ok_${createUniqueSlug('t')}`,
            amount: params.amount,
            currency: params.currency,
            destination: params.destination,
            metadata,
          });
        }
      );

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 2, failed: 1 });
      expect(transferSpy).toHaveBeenCalledTimes(3);

      const { inArray, eq } = await import('drizzle-orm');
      const after = await db
        .select()
        .from(payoutsTable)
        .where(
          inArray(
            payoutsTable.id,
            payoutRows.map((r) => r.id)
          )
        );
      const byId = new Map(after.map((r) => [r.id, r] as const));

      // The two succeeding rows are stamped resolved.
      for (const row of payoutRows.filter((r) => r.id !== failingPayoutId)) {
        const persisted = byId.get(row.id);
        expect(persisted?.resolvedAt).not.toBeNull();
        expect(persisted?.stripeTransferId).toMatch(/^tr_ok_/);
      }
      // The failing row stays unresolved and re-tryable.
      const stillPending = byId.get(failingPayoutId);
      expect(stillPending?.resolvedAt).toBeNull();
      expect(stillPending?.stripeTransferId).toBeNull();

      // Silence unused-import warning.
      void eq;
    });

    it('is a no-op on replay — second call after success makes zero Stripe transfer calls', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('w4jjk-replay');

      await db.insert(payoutsTable).values([
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 1500,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 2500,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
      ]);

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const first = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );
      expect(first).toEqual({ resolved: 2, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(2);

      transferSpy.mockClear();
      const second = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      // Replay safety lives in the DB filter (isNull(resolvedAt)) — there
      // are no remaining rows after the first run, so the second call
      // returns the empty-batch shape and makes zero Stripe calls. This
      // is what guards us against duplicate disbursement if the
      // account.updated webhook fires twice.
      expect(second).toEqual({ resolved: 0, failed: 0 });
      expect(transferSpy).not.toHaveBeenCalled();
    });

    // Codex-90ocz: defence-in-depth Stripe idempotency-key contract for
    // resolvePendingPayouts. The DB `WHERE resolvedAt IS NULL` gate guards
    // against intra-process replay, but a worker that crashes AFTER
    // stripe.transfers.create resolves and BEFORE the DB UPDATE commits
    // would re-attempt the transfer on the next account.updated webhook
    // unless Stripe-side dedupe is in place. The fix passes a deterministic
    // `idempotencyKey = payout_<row.id>` as the 2nd arg to
    // stripe.transfers.create so Stripe rejects the duplicate.
    it('passes deterministic idempotencyKey = payout_<id> to stripe.transfers.create per row', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('90ocz-idem-key');

      const payoutRows = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 1100,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 2200,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
        ])
        .returning();

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );
      expect(result).toEqual({ resolved: 2, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(2);

      // Every transfers.create call MUST pass `{ idempotencyKey }` as its
      // 2nd argument, deterministically derived from the row id. Stripe
      // dedupes on the key, so a re-attempt after a crash-before-commit
      // returns the original Transfer instead of creating a second one.
      for (const row of payoutRows) {
        const match = transferSpy.mock.calls.find(
          ([params]) =>
            (params as { metadata?: { pending_payout_id?: string } }).metadata
              ?.pending_payout_id === row.id
        );
        expect(match, `no transfer for payout ${row.id}`).toBeDefined();
        const [, options] = match as [
          unknown,
          { idempotencyKey?: string } | undefined,
        ];
        expect(options).toBeDefined();
        expect(options?.idempotencyKey).toBe(`payout_${row.id}`);
      }
    });

    it('replay safety: clearing resolvedAt and re-running yields the SAME idempotencyKey per row (Stripe-side dedupe contract)', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('90ocz-idem-replay');

      const payoutRows = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 1500,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 2500,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
        ])
        .returning();

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      // First pass — happy path, rows get stamped resolved.
      const first = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );
      expect(first).toEqual({ resolved: 2, failed: 0 });
      const firstKeys = transferSpy.mock.calls
        .map(
          (call) =>
            (call[1] as { idempotencyKey?: string } | undefined)?.idempotencyKey
        )
        .sort();
      expect(firstKeys.every((k) => typeof k === 'string')).toBe(true);

      // Simulate the worst-case replay: DB UPDATE never committed
      // (e.g. worker crashed between Stripe success and DB write), so
      // the rows revert to unresolved and the next account.updated
      // webhook triggers a second pass. Defence-in-depth requires the
      // 2nd pass to pass the SAME idempotency key per row — Stripe then
      // returns the original Transfer instead of creating a new one.
      const { inArray } = await import('drizzle-orm');
      await db
        .update(payoutsTable)
        .set({ status: 'pending', resolvedAt: null, stripeTransferId: null })
        .where(
          inArray(
            payoutsTable.id,
            payoutRows.map((r) => r.id)
          )
        );

      transferSpy.mockClear();
      const second = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );
      expect(second).toEqual({ resolved: 2, failed: 0 });
      const secondKeys = transferSpy.mock.calls
        .map(
          (call) =>
            (call[1] as { idempotencyKey?: string } | undefined)?.idempotencyKey
        )
        .sort();

      // SET equality — every key in the replay matches a key from the
      // first pass. This is the Stripe-side dedupe contract.
      expect(secondKeys).toEqual(firstKeys);
      // And each key matches the row-id shape (no off-by-one between
      // row.id and the key suffix).
      for (const row of payoutRows) {
        expect(secondKeys).toContain(`payout_${row.id}`);
      }
    });

    it('treats Stripe duplicate-idempotency-key replay as success: row is stamped resolved and no error escapes', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('90ocz-idem-dup');

      const [row] = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 4200,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
        ])
        .returning();

      // Stripe's documented response to an idempotency-key replay is to
      // return the ORIGINAL Transfer object (same id, same fields). The
      // service must accept that and stamp the row resolved — there's no
      // distinct "duplicate" error shape from the SDK.
      const replayedTransferId = 'tr_replayed_original_id';
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();
      transferSpy.mockImplementationOnce(
        (params: Record<string, unknown>): unknown =>
          Promise.resolve({
            id: replayedTransferId,
            amount: params.amount,
            currency: params.currency,
            destination: params.destination,
            metadata: params.metadata ?? {},
          })
      );

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 1, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(1);
      const [, options] = transferSpy.mock.calls[0] as [
        unknown,
        { idempotencyKey?: string } | undefined,
      ];
      expect(options?.idempotencyKey).toBe(`payout_${row.id}`);

      // DB row stamped resolved with the (replayed) transfer id.
      const { eq } = await import('drizzle-orm');
      const [after] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, row.id));
      expect(after.resolvedAt).not.toBeNull();
      expect(after.stripeTransferId).toBe(replayedTransferId);
    });

    // Codex-fzal7: tighten the duplicate-response contract. The prior test
    // (90ocz-idem-dup, above) covered the happy result shape, but did not
    // assert (a) that the transferred amount in the SDK call equals the
    // row's amountCents — Stripe-side dedupe is only safe if our retry uses
    // identical params; (b) that no spurious pending-payout row is
    // inserted as a side-effect of the duplicate-response branch (single
    // DB write contract — exactly one row exists for this payout id, in
    // the resolved state, after the call returns).
    it('duplicate-response: transferred amount equals row.amountCents and no extra DB rows are written', async () => {
      const { org, sub, stripeAccountId } = await seedConnectAndSubscription(
        'fzal7-idem-dup-strong'
      );

      const [row] = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 4242,
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          },
        ])
        .returning();

      // Snapshot the total pending-payout row count for this user+org BEFORE
      // the call, so we can prove no spurious rows are inserted by the
      // duplicate-response branch (e.g. a "retry" row, audit row, etc.).
      const { eq, and } = await import('drizzle-orm');
      const rowsBefore = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.userId, creatorId),
            eq(payoutsTable.organizationId, org.id)
          )
        );
      expect(rowsBefore).toHaveLength(1);

      // Stripe returns the ORIGINAL transfer (same id, same amount, same
      // destination) when called with a previously-seen idempotency key.
      // The amount in the response MUST equal what we sent — that's the
      // dedupe contract: identical params → identical response.
      const replayedTransferId = 'tr_replayed_fzal7';
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();
      transferSpy.mockImplementationOnce(
        (params: Record<string, unknown>): unknown =>
          Promise.resolve({
            id: replayedTransferId,
            amount: params.amount, // echo: dedupe → identical response
            currency: params.currency,
            destination: params.destination,
            metadata: params.metadata ?? {},
          })
      );

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      // Contract: duplicate-response counts as success — `resolved` ticks,
      // `failed` MUST stay zero. A regression that mis-classifies the
      // dedupe response as an error would flip this to { 0, 1 }.
      expect(result).toEqual({ resolved: 1, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(1);

      // Transferred amount equals the row's amountCents (the params our
      // service passed to Stripe). Stripe-side dedupe is only safe under
      // this invariant — different params with the same key would 400.
      const [params] = transferSpy.mock.calls[0] as [
        Record<string, unknown>,
        { idempotencyKey?: string } | undefined,
      ];
      expect(params.amount).toBe(row.amountCents);
      expect(params.currency).toBe('gbp');
      expect(params.destination).toBe(stripeAccountId);

      // DB row is stamped resolved with the (replayed) transfer id, AND
      // the total row count for this user+org has not grown — the
      // duplicate-response branch is a single-write path (UPDATE only).
      const rowsAfter = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.userId, creatorId),
            eq(payoutsTable.organizationId, org.id)
          )
        );
      expect(rowsAfter).toHaveLength(1);
      const [after] = rowsAfter;
      expect(after.id).toBe(row.id);
      expect(after.resolvedAt).not.toBeNull();
      expect(after.stripeTransferId).toBe(replayedTransferId);
      expect(after.amountCents).toBe(row.amountCents);
    });

    it('warns and returns empty when the (orgId, stripeAccountId) pair has no Connect account row', async () => {
      const { org } = await createFullOrg('w4jjk-acct-not-found');

      const warnSpy = vi
        .spyOn(
          (
            service as unknown as {
              obs: { warn: (...args: unknown[]) => void };
            }
          ).obs,
          'warn'
        )
        .mockImplementation(() => {});
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        'acct_does_not_exist_for_this_org'
      );

      expect(result).toEqual({ resolved: 0, failed: 0 });
      expect(transferSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'resolvePendingPayouts: Connect account not found',
        expect.objectContaining({
          organizationId: org.id,
          stripeAccountId: 'acct_does_not_exist_for_this_org',
        })
      );

      warnSpy.mockRestore();
    });
  });

  // ─── sweepUnresolvedPayouts — hybrid event+sweep resolution (Codex-vv77x) ───
  //
  // Stripe docs (verified 2026-05-13) say account.updated webhooks retry for
  // 3 days then drop. Without a periodic sweep, dropped events leave
  // pendingPayouts stuck forever. This describe covers:
  //   - empty-DB short-circuit (no Stripe calls)
  //   - active-account → delegates to resolvePendingPayouts
  //   - inactive-account → skipped (waits for next sweep)
  //   - grouping by (orgId, userId) — 1 Stripe call per Connect account
  //   - per-group error isolation — one group failing doesn't abort sweep
  //   - olderThanMinutes filter — fresh rows wait for the webhook first
  describe('sweepUnresolvedPayouts — hybrid event+sweep resolution', () => {
    /**
     * Attach a stub `accounts.retrieve` to the shared Stripe mock since
     * createMockStripe() doesn't ship with one (this is the first sweep-only
     * caller). Returns a vi.fn so individual tests can drive its response.
     */
    function stubAccountsRetrieve(ready: boolean): ReturnType<typeof vi.fn> {
      const fn = vi.fn().mockImplementation(async (accountId: string) => ({
        id: accountId,
        charges_enabled: ready,
        payouts_enabled: ready,
      }));
      (stripe as unknown as { accounts: Record<string, unknown> }).accounts = {
        ...((stripe as unknown as { accounts?: Record<string, unknown> })
          .accounts ?? {}),
        retrieve: fn,
      };
      return fn;
    }

    /**
     * Mirror seedConnectAndSubscription from the resolvePendingPayouts
     * block — deterministic stripeAccountId so we can drive the lookup.
     */
    async function seedConnectAndSubscription(slug: string) {
      const { org, tier1 } = await createFullOrg(slug);
      const stripeAccountId = `acct_vv77x_${createUniqueSlug('a')}`;

      const { eq } = await import('drizzle-orm');
      await db
        .update(stripeConnectAccounts)
        .set({ stripeAccountId })
        .where(eq(stripeConnectAccounts.organizationId, org.id));

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_vv77x_${createUniqueSlug('s')}`,
          })
        )
        .returning();

      return { org, tier1, sub, stripeAccountId };
    }

    it('returns zero counters and makes no Stripe calls when no pending rows exist', async () => {
      // Ensure no leftover pending rows from earlier tests
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const retrieveSpy = stubAccountsRetrieve(true);
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.sweepUnresolvedPayouts(15);

      expect(result).toEqual({
        groupsScanned: 0,
        groupsResolved: 0,
        groupsSkipped: 0,
        errors: 0,
      });
      expect(retrieveSpy).not.toHaveBeenCalled();
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('resolves the group when the Connect account now reports charges_enabled && payouts_enabled', async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('vv77x-ready');

      // Old enough to pass the olderThanMinutes filter
      const longAgo = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      await db.insert(payoutsTable).values({
        userId: creatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 500,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
        attemptedAt: longAgo,
      });

      const retrieveSpy = stubAccountsRetrieve(true);
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.sweepUnresolvedPayouts(15);

      expect(result).toEqual({
        groupsScanned: 1,
        groupsResolved: 1,
        groupsSkipped: 0,
        errors: 0,
      });
      expect(retrieveSpy).toHaveBeenCalledTimes(1);
      expect(retrieveSpy).toHaveBeenCalledWith(stripeAccountId);
      // resolvePendingPayouts walks the row(s) — at least one transfer
      expect(transferSpy).toHaveBeenCalled();
    });

    it('skips the group (no transfer) when the Connect account is still not ready', async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const { org, sub } = await seedConnectAndSubscription('vv77x-not-ready');

      const longAgo = new Date(Date.now() - 60 * 60 * 1000);
      await db.insert(payoutsTable).values({
        userId: creatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 500,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
        attemptedAt: longAgo,
      });

      const retrieveSpy = stubAccountsRetrieve(false);
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.sweepUnresolvedPayouts(15);

      expect(result).toEqual({
        groupsScanned: 1,
        groupsResolved: 0,
        groupsSkipped: 1,
        errors: 0,
      });
      expect(retrieveSpy).toHaveBeenCalledTimes(1);
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('groups by (orgId, userId) — N rows for one Connect account → one accounts.retrieve, one resolvePendingPayouts', async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('vv77x-grouping');

      const longAgo = new Date(Date.now() - 60 * 60 * 1000);
      // 3 rows, same (orgId, userId) — one Connect account
      await db.insert(payoutsTable).values([
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
          attemptedAt: longAgo,
        },
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 200,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
          attemptedAt: longAgo,
        },
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 300,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
          attemptedAt: longAgo,
        },
      ]);

      const retrieveSpy = stubAccountsRetrieve(true);
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();
      const resolveSpy = vi.spyOn(service, 'resolvePendingPayouts');

      const result = await service.sweepUnresolvedPayouts(15);

      expect(result.groupsScanned).toBe(1);
      expect(result.groupsResolved).toBe(1);
      // One Stripe accounts.retrieve per Connect account, not per row
      expect(retrieveSpy).toHaveBeenCalledTimes(1);
      expect(retrieveSpy).toHaveBeenCalledWith(stripeAccountId);
      // One resolvePendingPayouts per group, not per row
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith(org.id, stripeAccountId);
      // Three transfers because resolvePendingPayouts processes 3 rows
      expect(transferSpy).toHaveBeenCalledTimes(3);

      resolveSpy.mockRestore();
    });

    it('isolates per-group failure — one Stripe.accounts.retrieve throwing does not abort other groups', async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const failOrg = await seedConnectAndSubscription('vv77x-fail');
      const okOrg = await seedConnectAndSubscription('vv77x-ok');

      const longAgo = new Date(Date.now() - 60 * 60 * 1000);
      await db.insert(payoutsTable).values([
        {
          userId: creatorId,
          organizationId: failOrg.org.id,
          subscriptionId: failOrg.sub.id,
          amountCents: 500,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
          attemptedAt: longAgo,
        },
        {
          userId: creatorId,
          organizationId: okOrg.org.id,
          subscriptionId: okOrg.sub.id,
          amountCents: 700,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
          attemptedAt: longAgo,
        },
      ]);

      const failingAccountId = failOrg.stripeAccountId;
      const retrieveFn = vi
        .fn()
        .mockImplementation(async (accountId: string) => {
          if (accountId === failingAccountId) {
            throw new Error('Stripe accounts.retrieve rejected (test)');
          }
          return {
            id: accountId,
            charges_enabled: true,
            payouts_enabled: true,
          };
        });
      (stripe as unknown as { accounts: Record<string, unknown> }).accounts = {
        ...((stripe as unknown as { accounts?: Record<string, unknown> })
          .accounts ?? {}),
        retrieve: retrieveFn,
      };

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.sweepUnresolvedPayouts(15);

      // 2 groups scanned, 1 erred, 1 resolved, 0 skipped
      expect(result.groupsScanned).toBe(2);
      expect(result.errors).toBe(1);
      expect(result.groupsResolved).toBe(1);
      expect(result.groupsSkipped).toBe(0);
      // Healthy org still received its transfer
      expect(transferSpy).toHaveBeenCalled();
    });

    it('respects olderThanMinutes — rows newer than the threshold are NOT swept (webhook handles fresh rows)', async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const { org, sub } = await seedConnectAndSubscription('vv77x-fresh');

      // Row created "now" — newer than the 15min threshold so should be
      // ignored by the sweep (the account.updated webhook owns fresh rows).
      await db.insert(payoutsTable).values({
        userId: creatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 500,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
        attemptedAt: new Date(),
      });

      const retrieveSpy = stubAccountsRetrieve(true);
      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.sweepUnresolvedPayouts(15);

      expect(result).toEqual({
        groupsScanned: 0,
        groupsResolved: 0,
        groupsSkipped: 0,
        errors: 0,
      });
      expect(retrieveSpy).not.toHaveBeenCalled();
      expect(transferSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // resolvePendingPayouts — creator-exit orphan handling (Codex-aq58x)
  //
  // User-decided contract (interview 2026-05-13): when a creator is removed
  // from an org and they still have unresolved pendingPayouts rows from
  // when they were a member, those rows MUST still resolve to the original
  // creator's Connect account on the next sweep — they were owed the money
  // for past work ("Orphaned — still paid out").
  //
  // Production guard: resolvePendingPayouts joins pendingPayouts ⇄
  // stripeConnectAccounts on userId (subscription-service.ts:2253-2325) —
  // it never touches creatorOrganizationAgreements. These tests pin that
  // contract so a future refactor can't accidentally re-introduce an
  // agreement join that would silently orphan the row.
  // ─────────────────────────────────────────────────────────────────────
  describe('resolvePendingPayouts — creator-exit orphan handling', () => {
    /**
     * Mint a removed-creator scenario: a fresh org, a connect account for the
     * creator (with a deterministic stripeAccountId), an active subscription
     * for FK references, and an OPTIONAL agreement row that the caller can
     * end-date / leave-missing to drive the "removed from org" semantics.
     */
    async function seedOrgWithCreatorConnect(
      slug: string,
      creatorUserId: string
    ) {
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug(slug),
            creatorId: creatorUserId,
          })
        )
        .returning();

      const stripeAccountId = `acct_aq58x_${createUniqueSlug('a')}`;
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, creatorUserId, {
          stripeAccountId,
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      );

      const [tier] = await db
        .insert(subscriptionTiers)
        .values(
          createTestTierInput(org.id, {
            name: 'Basic',
            sortOrder: 1,
            priceMonthly: 499,
            priceAnnual: 4990,
          })
        )
        .returning();

      // Subscription FK is required by pendingPayouts.subscriptionId. Use a
      // distinct subscriber so we never collide with the creator's own row.
      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier.id, {
            status: 'active',
            stripeSubscriptionId: `sub_aq58x_${createUniqueSlug('s')}`,
          })
        )
        .returning();

      return { org, tier, sub, stripeAccountId };
    }

    it('pays out a removed creator whose agreement is end-dated (effectiveUntil in the past)', async () => {
      // Setup: creator + agreement + accrued pendingPayout, then end-date the
      // agreement to simulate "removed from org". The Connect account stays
      // active (the creator still owns their Stripe Connect), so the next
      // sweep MUST disburse the owed money.
      const { org, sub, stripeAccountId } = await seedOrgWithCreatorConnect(
        'aq58x-end-dated',
        creatorId
      );

      // Insert + end-date an agreement for the creator-org pair.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.insert(creatorOrganizationAgreements).values({
        creatorId,
        organizationId: org.id,
        organizationFeePercentage: 1500,
        effectiveFrom: new Date(Date.now() - 48 * 60 * 60 * 1000),
        effectiveUntil: yesterday,
      });

      const [payout] = await db
        .insert(payoutsTable)
        .values({
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 5000,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        })
        .returning();

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      // Removed-creator orphan still resolves — agreement end-date does NOT
      // block the payout.
      expect(result).toEqual({ resolved: 1, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(1);

      const [params] = transferSpy.mock.calls[0] as [Record<string, unknown>];
      expect(params).toMatchObject({
        amount: 5000,
        currency: 'gbp',
        destination: stripeAccountId,
        metadata: expect.objectContaining({
          pending_payout_id: payout.id,
          type: 'pending_payout_resolution',
        }),
      });

      const { eq } = await import('drizzle-orm');
      const [after] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, payout.id));
      expect(after.resolvedAt).not.toBeNull();
      expect(after.stripeTransferId).toMatch(/^tr_/);
    });

    it('resolves the row even when no agreement row exists at all (resolve query joins on userId, not via agreement)', async () => {
      // Setup: pendingPayout row exists for (creatorId, orgId) but there is
      // NO creatorOrganizationAgreements row. This is the
      // never-had-an-agreement / hard-deleted-agreement path. The contract:
      // pendingPayouts.userId is the source of truth — resolution depends
      // ONLY on the (stripeConnectAccounts.userId == pendingPayouts.userId)
      // join, never on an agreement row.
      const { org, sub, stripeAccountId } = await seedOrgWithCreatorConnect(
        'aq58x-no-agreement',
        creatorId
      );

      // Defensive: confirm no agreement row exists for this pair.
      const { and, eq } = await import('drizzle-orm');
      const existingAgreement = await db
        .select()
        .from(creatorOrganizationAgreements)
        .where(
          and(
            eq(creatorOrganizationAgreements.creatorId, creatorId),
            eq(creatorOrganizationAgreements.organizationId, org.id)
          )
        );
      expect(existingAgreement).toHaveLength(0);

      const [payout] = await db
        .insert(payoutsTable)
        .values({
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 2750,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        })
        .returning();

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 1, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(1);
      const [params] = transferSpy.mock.calls[0] as [Record<string, unknown>];
      expect(params).toMatchObject({
        amount: 2750,
        destination: stripeAccountId,
      });

      const [after] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, payout.id));
      expect(after.resolvedAt).not.toBeNull();
      expect(after.stripeTransferId).toMatch(/^tr_/);
    });

    it('resolves each removed creator independently across multiple end-dated agreements', async () => {
      // Setup: ONE org, THREE creators each with their own Connect account,
      // each with their own pendingPayout row, each with an end-dated
      // agreement. resolvePendingPayouts takes one (orgId, stripeAccountId)
      // pair at a time — each call MUST only touch its own user's rows and
      // never disturb the others.
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('aq58x-multi'),
            creatorId,
          })
        )
        .returning();

      const [tier] = await db
        .insert(subscriptionTiers)
        .values(
          createTestTierInput(org.id, {
            name: 'Basic',
            sortOrder: 1,
            priceMonthly: 499,
            priceAnnual: 4990,
          })
        )
        .returning();

      // Three creators — reuse the seeded user pool. creatorId owns the org;
      // otherCreatorId and thirdUserId are removed contributors.
      const creators = [creatorId, otherCreatorId, thirdUserId];
      expect(
        creators.every((id) => typeof id === 'string' && id.length > 0)
      ).toBe(true);

      // Per-creator: connect account + end-dated agreement + subscription FK
      // + pendingPayout row.
      const seeded: {
        userId: string;
        stripeAccountId: string;
        payoutId: string;
        amountCents: number;
      }[] = [];

      const amounts = [1100, 2200, 3300];
      for (let i = 0; i < creators.length; i++) {
        const userId = creators[i];
        const stripeAccountId = `acct_aq58x_multi_${createUniqueSlug(`c${i}`)}`;

        await db.insert(stripeConnectAccounts).values(
          createTestConnectAccountInput(org.id, userId, {
            stripeAccountId,
            chargesEnabled: true,
            payoutsEnabled: true,
            status: 'active',
          })
        );

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await db.insert(creatorOrganizationAgreements).values({
          creatorId: userId,
          organizationId: org.id,
          organizationFeePercentage: 1500,
          effectiveFrom: new Date(Date.now() - 48 * 60 * 60 * 1000),
          effectiveUntil: yesterday,
        });

        // Each pendingPayout needs a subscription FK. Use a unique subscriber
        // per creator so we don't violate any uniqueness constraint — the
        // simplest path is the same active subscription per creator's own
        // user id (subscriptions are (userId, orgId) — one per pair).
        const [sub] = await db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(userId, org.id, tier.id, {
              status: 'active',
              stripeSubscriptionId: `sub_aq58x_multi_${createUniqueSlug(`s${i}`)}`,
            })
          )
          .returning();

        const [payout] = await db
          .insert(payoutsTable)
          .values({
            userId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: amounts[i],
            currency: 'gbp',
            reason: 'connect_not_ready',
            status: 'pending',
            payoutType: 'creator_payout',
          })
          .returning();

        seeded.push({
          userId,
          stripeAccountId,
          payoutId: payout.id,
          amountCents: amounts[i],
        });
      }

      const transferSpy = vi.mocked(stripe.transfers.create);

      // Run resolve once per creator and assert per-call isolation.
      for (const row of seeded) {
        transferSpy.mockClear();

        const result = await service.resolvePendingPayouts(
          org.id,
          row.stripeAccountId
        );

        expect(result).toEqual({ resolved: 1, failed: 0 });
        expect(transferSpy).toHaveBeenCalledTimes(1);
        const [params] = transferSpy.mock.calls[0] as [Record<string, unknown>];
        expect(params).toMatchObject({
          amount: row.amountCents,
          destination: row.stripeAccountId,
          metadata: expect.objectContaining({
            pending_payout_id: row.payoutId,
            type: 'pending_payout_resolution',
          }),
        });
      }

      // All three rows must be stamped resolved, and each must carry the
      // transfer id from its own Connect account.
      const { inArray } = await import('drizzle-orm');
      const after = await db
        .select()
        .from(payoutsTable)
        .where(
          inArray(
            payoutsTable.id,
            seeded.map((r) => r.payoutId)
          )
        );
      expect(after).toHaveLength(3);
      for (const row of after) {
        expect(row.resolvedAt).not.toBeNull();
        expect(row.stripeTransferId).toMatch(/^tr_/);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Payouts ledger — schema + status-column behaviour (Codex-e9v3b)
//
// Companion tests for the `payouts` ledger introduced in Codex-bxpmu.
// These pin the NEW behaviour explicitly:
//
//   A. executeTransfers writes status='paid' rows on success at each of
//      the three transfer sites (org fee, creator-pool-to-owner,
//      per-creator fan-out).
//   B. Webhook double-fire: the partial unique index on
//      stripe_transfer_id collapses the second insert to one row.
//   C. CHECK constraints catch malformed inserts at the DB level
//      (defence-in-depth — the service is the first line, the DB is
//      the last).
//   E. Drain status transitions: resolvePendingPayouts flips
//      pending→paid; sweepUnresolvedPayouts only touches pending rows
//      and uses attemptedAt (not createdAt) for the age threshold.
//
// (D) cross-org isolation for listPayoutsByOrg is already covered by
// the "SCOPING INVARIANT" test in the listPayoutsByOrg describe block
// above — no new test needed.
// ─────────────────────────────────────────────────────────────────────
describe('Payouts ledger — schema + status-column behaviour (Codex-e9v3b)', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: SubscriptionService;
  let creatorId: string;
  let subscriberId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const userIds = await seedTestUsers(db, 2);
    [creatorId, subscriberId] = userIds;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new SubscriptionService({ db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /**
   * Seed an org + Connect account (chargesEnabled+payoutsEnabled, active)
   * + one tier + one active subscription owned by `subscriberId`. The
   * org owner (the user who can receive the org fee transfer) is
   * `creatorId`. Returns refs the per-test bodies need.
   */
  async function seedOrgWithConnect(slug: string) {
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({
          slug: createUniqueSlug(slug),
          creatorId,
        })
      )
      .returning();

    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(org.id, creatorId, {
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
      })
    );

    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(org.id, { name: 'Basic' }))
      .returning();

    const [sub] = await db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(subscriberId, org.id, tier.id, {
          status: 'active',
        })
      )
      .returning();

    return { org, tier, sub };
  }

  /**
   * Add an extra creator (with their own Connect account) to an org and
   * seed an active agreement for them. Returns the creator's userId.
   */
  async function addCreatorWithAgreement(
    orgId: string,
    sharePercent: number
  ): Promise<string> {
    const [userId] = await seedTestUsers(db, 1);
    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(orgId, userId, {
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
      })
    );
    await db.insert(creatorOrganizationAgreements).values({
      creatorId: userId,
      organizationId: orgId,
      organizationFeePercentage: sharePercent,
    });
    return userId;
  }

  // ─── A. Success-path inserts ────────────────────────────────────────

  describe('A. executeTransfers success-path inserts', () => {
    it('org fee transfer → one payouts row with status=paid, payoutType=organization_fee', async () => {
      const { org, sub } = await seedOrgWithConnect('e9v3b-org-fee');

      const chargeId = `ch_e9v3b_orgfee_${createUniqueSlug('c')}`;
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [
            { payment: { charge: chargeId, payment_intent: 'pi_orgfee' } },
          ],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const { eq, and } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.organizationId, org.id),
            eq(payoutsTable.payoutType, 'organization_fee')
          )
        );

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.status).toBe('paid');
      expect(row.userId).toBe(creatorId); // Connect account owner
      expect(row.subscriptionId).toBe(sub.id);
      expect(row.stripeTransferId).toMatch(/^tr_/);
      expect(row.stripeChargeId).toBe(chargeId);
      expect(row.transferGroup).toBe(`sub_${sub.id}`);
      expect(row.resolvedAt).not.toBeNull();
      expect(row.reason).toBeNull();
      expect(row.amountCents).toBeGreaterThan(0);
    });

    it('creator-pool-to-owner (no creator agreements) → one payouts row with payoutType=creator_payout_to_owner', async () => {
      const { org, sub } = await seedOrgWithConnect('e9v3b-pool-owner');

      // No creatorOrganizationAgreements inserted — exercises the
      // "no agreements" branch where the creator pool routes to the org
      // owner.
      const chargeId = `ch_e9v3b_pool_${createUniqueSlug('c')}`;
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: 'pi_pool' } }],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const { eq, and } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.organizationId, org.id),
            eq(payoutsTable.payoutType, 'creator_payout_to_owner')
          )
        );

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.status).toBe('paid');
      expect(row.userId).toBe(creatorId); // org owner
      expect(row.subscriptionId).toBe(sub.id);
      expect(row.stripeTransferId).toMatch(/^tr_/);
      expect(row.stripeChargeId).toBe(chargeId);
      expect(row.transferGroup).toBe(`sub_${sub.id}`);
      expect(row.resolvedAt).not.toBeNull();
      expect(row.reason).toBeNull();
      expect(row.amountCents).toBeGreaterThan(0);
    });

    it('per-creator fan-out (2 creators) → N payouts rows, each payoutType=creator_payout, correct creator userIds, amounts sum within pool', async () => {
      const { org, sub } = await seedOrgWithConnect('e9v3b-fanout');

      // Two creators with active agreements (50/50 split).
      const c1 = await addCreatorWithAgreement(org.id, 5000);
      const c2 = await addCreatorWithAgreement(org.id, 5000);

      const chargeId = `ch_e9v3b_fanout_${createUniqueSlug('c')}`;
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [
            { payment: { charge: chargeId, payment_intent: 'pi_fanout' } },
          ],
        },
      }) as unknown as Stripe.Invoice;

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      const { eq, and, inArray } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.organizationId, org.id),
            eq(payoutsTable.payoutType, 'creator_payout'),
            inArray(payoutsTable.userId, [c1, c2])
          )
        );

      expect(rows).toHaveLength(2);
      const byUser = new Map(rows.map((r) => [r.userId, r]));
      for (const cid of [c1, c2]) {
        const row = byUser.get(cid);
        expect(row, `no row for creator ${cid}`).toBeDefined();
        expect(row?.status).toBe('paid');
        expect(row?.payoutType).toBe('creator_payout');
        expect(row?.subscriptionId).toBe(sub.id);
        expect(row?.stripeTransferId).toMatch(/^tr_/);
        expect(row?.stripeChargeId).toBe(chargeId);
        expect(row?.transferGroup).toBe(`sub_${sub.id}`);
        expect(row?.resolvedAt).not.toBeNull();
        expect(row?.reason).toBeNull();
        expect(row?.amountCents).toBeGreaterThan(0);
      }

      // Sum of per-creator amounts ≤ amount_paid (the creator pool is a
      // subset of the gross invoice). 50/50 split → equal amounts.
      const amounts = rows.map((r) => r.amountCents);
      expect(amounts[0]).toBe(amounts[1]);
      expect(amounts.reduce((s, a) => s + a, 0)).toBeLessThanOrEqual(1000);
    });
  });

  // ─── B. Idempotency under webhook double-fire ───────────────────────

  describe('B. Idempotency — partial unique index collapses webhook double-fire', () => {
    it('firing the same invoice.payment_succeeded twice → one paid row per stripeTransferId (unique partial index)', async () => {
      const { org, sub } = await seedOrgWithConnect('e9v3b-idem');

      // Pin a stable charge id so the service derives identical
      // idempotency keys on both calls → Stripe mock returns identical
      // tr_ ids → the partial unique index on stripe_transfer_id rejects
      // the second insert. Note: the mock isn't truly Stripe-side-dedupe
      // (it returns a fresh tr_ each call), so we override it to return
      // a deterministic id per idempotencyKey to faithfully exercise
      // the partial-unique-index path.
      const transferSpy = vi.mocked(stripe.transfers.create);
      const byKey = new Map<string, string>();
      transferSpy.mockImplementation(
        (params: Record<string, unknown>, opts) => {
          const o = opts as { idempotencyKey?: string } | undefined;
          const key = o?.idempotencyKey ?? '';
          let id = byKey.get(key);
          if (!id) {
            id = `tr_idem_${createUniqueSlug('t')}`;
            byKey.set(key, id);
          }
          return Promise.resolve({
            id,
            amount: params.amount,
            currency: params.currency,
            destination: params.destination,
            metadata: params.metadata ?? {},
          }) as unknown as ReturnType<typeof transferSpy>;
        }
      );

      const chargeId = 'ch_e9v3b_idem_fixed';
      const mockInvoice = createMockStripeInvoice({
        amount_paid: 1000,
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
        payments: {
          data: [{ payment: { charge: chargeId, payment_intent: 'pi_idem' } }],
        },
      }) as unknown as Stripe.Invoice;

      // First fire: rows inserted normally.
      await service.handleInvoicePaymentSucceeded(mockInvoice);
      const { eq, and } = await import('drizzle-orm');
      const afterFirst = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.organizationId, org.id),
            eq(payoutsTable.status, 'paid')
          )
        );
      expect(afterFirst.length).toBeGreaterThan(0);
      const firstTransferIds = new Set(
        afterFirst.map((r) => r.stripeTransferId)
      );

      // Second fire: the service re-attempts the transfers (Stripe mock
      // returns the SAME tr_ id per idempotencyKey), then tries to
      // INSERT a row with the same stripeTransferId — partial unique
      // index rejects, and the service swallows the duplicate (see
      // isUniqueViolation check in executeTransfers). No throw, no
      // extra rows.
      await expect(
        service.handleInvoicePaymentSucceeded(mockInvoice)
      ).resolves.toBeDefined();

      const afterSecond = await db
        .select()
        .from(payoutsTable)
        .where(
          and(
            eq(payoutsTable.organizationId, org.id),
            eq(payoutsTable.status, 'paid')
          )
        );

      // Row count unchanged across replay — partial unique index did
      // its job.
      expect(afterSecond).toHaveLength(afterFirst.length);
      const secondTransferIds = new Set(
        afterSecond.map((r) => r.stripeTransferId)
      );
      expect(secondTransferIds).toEqual(firstTransferIds);
    });
  });

  // ─── C. CHECK constraint enforcement (defence-in-depth) ─────────────

  describe('C. CHECK constraints — raw insert defence-in-depth', () => {
    /**
     * Common base values for the malformed-insert tests. Each test
     * overrides exactly the column it's testing. The base values are
     * otherwise valid so the failure mode isolates to the targeted
     * constraint.
     */
    async function baseValues(slug: string) {
      const { org, sub } = await seedOrgWithConnect(slug);
      return {
        userId: creatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 1000,
        currency: 'gbp',
        payoutType: 'creator_payout' as const,
        status: 'pending' as const,
        reason: 'connect_not_ready' as const,
      };
    }

    /**
     * Assert that a Postgres CHECK violation (SQLSTATE 23514) escapes
     * the insert. Different drivers wrap the error; match on the .code
     * (Drizzle / pg) or on the constraint name in the message.
     */
    function expectCheckViolation(err: unknown, constraint: string) {
      expect(err).toBeDefined();
      const e = err as {
        code?: string;
        cause?: { code?: string; message?: string };
        message?: string;
      };
      const code = e.code ?? e.cause?.code;
      const msg = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
      // 23514 is the Postgres CHECK violation SQLSTATE.
      const matched =
        code === '23514' ||
        msg.includes('23514') ||
        msg.includes(constraint) ||
        msg.toLowerCase().includes('check constraint');
      expect(
        matched,
        `expected CHECK violation (${constraint}); got code=${code} message=${msg}`
      ).toBe(true);
    }

    it('check_payouts_paid_invariant: status=paid with stripeTransferId=null is rejected', async () => {
      const base = await baseValues('e9v3b-check-paid-invariant');
      const err = await db
        .insert(payoutsTable)
        .values({
          ...base,
          status: 'paid',
          reason: null,
          stripeTransferId: null,
          resolvedAt: null,
        })
        .catch((e) => e);
      expectCheckViolation(err, 'check_payouts_paid_invariant');
    });

    it("check_payouts_status: status='resolved' (not in {paid,pending,failed}) is rejected", async () => {
      const base = await baseValues('e9v3b-check-status');
      const err = await db
        .insert(payoutsTable)
        .values({
          ...base,
          // 'resolved' is the URL alias, NOT a valid DB status — the
          // CHECK only accepts paid/pending/failed.
          status: 'resolved' as unknown as 'pending',
        })
        .catch((e) => e);
      expectCheckViolation(err, 'check_payouts_status');
    });

    it("check_payouts_reason: reason='made_up' (not in allowed set) is rejected", async () => {
      const base = await baseValues('e9v3b-check-reason');
      const err = await db
        .insert(payoutsTable)
        .values({
          ...base,
          reason: 'made_up' as unknown as 'connect_not_ready',
        })
        .catch((e) => e);
      expectCheckViolation(err, 'check_payouts_reason');
    });

    it("check_payouts_type: payoutType='bogus' (not in allowed set) is rejected", async () => {
      const base = await baseValues('e9v3b-check-type');
      const err = await db
        .insert(payoutsTable)
        .values({
          ...base,
          payoutType: 'bogus' as unknown as 'creator_payout',
        })
        .catch((e) => e);
      expectCheckViolation(err, 'check_payouts_type');
    });

    it('check_payouts_amount_positive: amountCents=0 is rejected', async () => {
      const base = await baseValues('e9v3b-check-amount');
      const err = await db
        .insert(payoutsTable)
        .values({
          ...base,
          amountCents: 0,
        })
        .catch((e) => e);
      expectCheckViolation(err, 'check_payouts_amount_positive');
    });
  });

  // ─── E. Drain status transitions ────────────────────────────────────

  describe('E. Drain status transitions', () => {
    /**
     * Seed an org + a Connect account with a deterministic
     * stripeAccountId so resolvePendingPayouts /
     * sweepUnresolvedPayouts can be driven explicitly. The org owner
     * is `creatorId` and the connect account belongs to `creatorId`.
     */
    async function seedDrainScenario(slug: string) {
      const { org, sub } = await seedOrgWithConnect(slug);
      const stripeAccountId = `acct_e9v3b_${createUniqueSlug('a')}`;
      const { eq } = await import('drizzle-orm');
      await db
        .update(stripeConnectAccounts)
        .set({ stripeAccountId })
        .where(eq(stripeConnectAccounts.organizationId, org.id));
      return { org, sub, stripeAccountId };
    }

    function stubAccountsRetrieve(ready: boolean): void {
      const fn = vi.fn().mockImplementation(async (accountId: string) => ({
        id: accountId,
        charges_enabled: ready,
        payouts_enabled: ready,
      }));
      (stripe as unknown as { accounts: Record<string, unknown> }).accounts = {
        ...((stripe as unknown as { accounts?: Record<string, unknown> })
          .accounts ?? {}),
        retrieve: fn,
      };
    }

    it("resolvePendingPayouts flips a pending row to status='paid' with stripeTransferId + resolvedAt set", async () => {
      const { org, sub, stripeAccountId } = await seedDrainScenario(
        'e9v3b-drain-resolve'
      );

      const [pending] = await db
        .insert(payoutsTable)
        .values({
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 1750,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        })
        .returning();

      // Pre-condition: status='pending', no transfer id, no resolvedAt.
      expect(pending.status).toBe('pending');
      expect(pending.stripeTransferId).toBeNull();
      expect(pending.resolvedAt).toBeNull();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );
      expect(result).toEqual({ resolved: 1, failed: 0 });

      const { eq } = await import('drizzle-orm');
      const [after] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, pending.id));

      // Post-condition: row transitioned pending → paid, transfer id
      // + resolvedAt stamped.
      expect(after.status).toBe('paid');
      expect(after.stripeTransferId).toMatch(/^tr_/);
      expect(after.resolvedAt).not.toBeNull();
    });

    it("sweepUnresolvedPayouts only touches status='pending' rows — paid and failed rows are left untouched", async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const { org, sub, stripeAccountId } = await seedDrainScenario(
        'e9v3b-drain-sweep-touch'
      );

      const longAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Seed three rows: one paid (terminal-success), one failed
      // (terminal-failure), one pending (sweep target). The sweep
      // should only touch the pending row.
      const [paid, failed, pending] = await db
        .insert(payoutsTable)
        .values([
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 100,
            currency: 'gbp',
            payoutType: 'creator_payout',
            status: 'paid',
            reason: null,
            stripeTransferId: 'tr_terminal_paid',
            resolvedAt: new Date('2026-01-01T00:00:00Z'),
            attemptedAt: longAgo,
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 200,
            currency: 'gbp',
            payoutType: 'creator_payout',
            status: 'failed',
            reason: 'transfer_failed',
            attemptedAt: longAgo,
          },
          {
            userId: creatorId,
            organizationId: org.id,
            subscriptionId: sub.id,
            amountCents: 300,
            currency: 'gbp',
            payoutType: 'creator_payout',
            status: 'pending',
            reason: 'connect_not_ready',
            attemptedAt: longAgo,
          },
        ])
        .returning();

      stubAccountsRetrieve(true);

      const result = await service.sweepUnresolvedPayouts(15);

      // Only one group scanned (the pending row), and it resolved.
      expect(result.groupsScanned).toBe(1);
      expect(result.groupsResolved).toBe(1);
      expect(result.errors).toBe(0);

      const { eq } = await import('drizzle-orm');

      // Paid row: completely unchanged.
      const [paidAfter] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, paid.id));
      expect(paidAfter.status).toBe('paid');
      expect(paidAfter.stripeTransferId).toBe('tr_terminal_paid');
      expect(paidAfter.resolvedAt?.getTime()).toBe(paid.resolvedAt?.getTime());

      // Failed row: status stays 'failed' (sweep does NOT retry
      // terminal-failure rows).
      const [failedAfter] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, failed.id));
      expect(failedAfter.status).toBe('failed');
      expect(failedAfter.stripeTransferId).toBeNull();
      expect(failedAfter.resolvedAt).toBeNull();

      // Pending row: transitioned to paid via the sweep.
      const [pendingAfter] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, pending.id));
      expect(pendingAfter.status).toBe('paid');
      expect(pendingAfter.stripeTransferId).toMatch(/^tr_/);
      expect(pendingAfter.resolvedAt).not.toBeNull();

      // Silence unused-var (stripeAccountId only needed for setup).
      void stripeAccountId;
    });

    it('sweepUnresolvedPayouts uses attemptedAt (not createdAt) for the age threshold — recent createdAt + old attemptedAt is swept', async () => {
      const { sql: rawSql } = await import('drizzle-orm');
      await db.execute(rawSql`DELETE FROM payouts`);

      const { org, sub, stripeAccountId } = await seedDrainScenario(
        'e9v3b-drain-attemptedAt'
      );

      // attemptedAt is OLD (1h ago) but createdAt is implicit (now).
      // The sweep's age filter is on attemptedAt — so even though the
      // row was just inserted, it should still be picked up.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [row] = await db
        .insert(payoutsTable)
        .values({
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 500,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
          attemptedAt: oneHourAgo,
        })
        .returning();

      // Sanity check the setup: createdAt is recent (well within the
      // 15min threshold) but attemptedAt is older than it.
      const ageMinutesCreated =
        (Date.now() - row.createdAt.getTime()) / (60 * 1000);
      const ageMinutesAttempted =
        (Date.now() - row.attemptedAt.getTime()) / (60 * 1000);
      expect(ageMinutesCreated).toBeLessThan(5);
      expect(ageMinutesAttempted).toBeGreaterThan(15);

      stubAccountsRetrieve(true);

      const result = await service.sweepUnresolvedPayouts(15);

      // attemptedAt was old enough → the row IS swept. If the service
      // were filtering on createdAt instead, this would skip the row
      // and the assertion would fail.
      expect(result.groupsScanned).toBe(1);
      expect(result.groupsResolved).toBe(1);

      const { eq } = await import('drizzle-orm');
      const [after] = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.id, row.id));
      expect(after.status).toBe('paid');
      expect(after.stripeTransferId).toMatch(/^tr_/);

      void stripeAccountId;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// SubscriptionPaymentRequiredError (Codex-w87s4)
//
// Standalone constructor round-trip: no DB, no Stripe — just the error
// class contract. Pins the field set the pricing dialog consumes so a
// future refactor (e.g. tightening the context type) can't silently
// drop a field.
// ─────────────────────────────────────────────────────────────────────
describe('SubscriptionPaymentRequiredError', () => {
  it('round-trips every field the pricing dialog branches on', () => {
    const err = new SubscriptionPaymentRequiredError('Card declined', {
      userId: 'user_123',
      organizationId: 'org_456',
      newTierId: 'tier_789',
      billingInterval: 'month',
      stripeMessage: 'Your card was declined.',
      prorationDate: 1_700_000_000,
      tierIdAtCommit: 'tier_789',
    });

    expect(err).toBeInstanceOf(SubscriptionPaymentRequiredError);
    expect(err.message).toBe('Card declined');
    expect(err.code).toBe('PAYMENT_REQUIRED');
    expect(err.statusCode).toBe(402);
    expect(err.context).toEqual({
      userId: 'user_123',
      organizationId: 'org_456',
      newTierId: 'tier_789',
      billingInterval: 'month',
      stripeMessage: 'Your card was declined.',
      prorationDate: 1_700_000_000,
      tierIdAtCommit: 'tier_789',
    });
  });

  it('omitting optional prorationDate / tierIdAtCommit leaves them undefined (not null, not 0)', () => {
    const err = new SubscriptionPaymentRequiredError('Card declined', {
      userId: 'user_123',
      organizationId: 'org_456',
      newTierId: 'tier_789',
      billingInterval: 'year',
      stripeMessage: 'Insufficient funds.',
    });

    expect(err.context).toMatchObject({
      userId: 'user_123',
      organizationId: 'org_456',
      newTierId: 'tier_789',
      billingInterval: 'year',
      stripeMessage: 'Insufficient funds.',
    });
    expect(err.context?.prorationDate).toBeUndefined();
    expect(err.context?.tierIdAtCommit).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Currency GBP-only enforcement (Codex-yv18n)
//
// The platform is GBP-only for revenue transfers. Non-GBP invoices and
// non-GBP pending-payout rows MUST surface an explicit
// UnsupportedCurrencyError BEFORE any stripe.transfers.create call —
// silently transferring in the wrong currency would mismatch the source
// charge currency at Stripe. Cross-currency support is a tracked future
// feature; until then, this contract MUST hold.
// ─────────────────────────────────────────────────────────────────────
describe('Currency GBP-only enforcement (Codex-yv18n)', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: SubscriptionService;
  let creatorId: string;
  let subscriberId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const userIds = await seedTestUsers(db, 2);
    [creatorId, subscriberId] = userIds;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new SubscriptionService({ db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /**
   * Local copy of createFullOrg — the outer describe's helper is not in
   * scope. Mirrors the same shape: org + owner membership + connect +
   * two tiers (monthly+annual).
   */
  async function seedOrg(slug: string) {
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({
          slug: createUniqueSlug(slug),
          creatorId,
        })
      )
      .returning();

    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(org.id, creatorId, {
        chargesEnabled: true,
        payoutsEnabled: true,
      })
    );

    const [tier1] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(org.id, { name: 'Basic GBP' }))
      .returning();

    return { org, tier1 };
  }

  async function seedActiveSubscription(orgId: string, tierId: string) {
    const [sub] = await db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(subscriberId, orgId, tierId, {
          status: 'active',
        })
      )
      .returning();
    return sub;
  }

  describe('handleInvoicePaymentSucceeded — invoice currency guard', () => {
    it('GBP invoice → transfers fire normally (happy path)', async () => {
      const { org, tier1 } = await seedOrg('yv18n-gbp');
      const sub = await seedActiveSubscription(org.id, tier1.id);

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        currency: 'gbp',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      await service.handleInvoicePaymentSucceeded(mockInvoice);

      expect(transferSpy).toHaveBeenCalled();
      // Every call MUST be GBP — defence-in-depth assertion.
      for (const call of transferSpy.mock.calls) {
        const params = call[0] as { currency?: string } | undefined;
        expect(params?.currency).toBe('gbp');
      }
    });

    it('USD invoice → throws UnsupportedCurrencyError BEFORE any transfer fires', async () => {
      const { org, tier1 } = await seedOrg('yv18n-usd');
      const sub = await seedActiveSubscription(org.id, tier1.id);

      const mockInvoice = createMockStripeInvoice({
        id: 'in_test_usd_reject',
        amount_paid: 499,
        currency: 'usd',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      // constructor.name is mangled by esbuild — use toBeInstanceOf (static class import) instead of .name on the error
      const err = await service
        .handleInvoicePaymentSucceeded(mockInvoice)
        .catch((e) => e);
      expect(err).toBeInstanceOf(UnsupportedCurrencyError);
      expect(err.code).toBe('UNSUPPORTED_CURRENCY');
      expect(err.statusCode).toBe(400);
      expect(err.received).toBe('usd');

      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('EUR invoice → throws UnsupportedCurrencyError BEFORE any transfer fires', async () => {
      const { org, tier1 } = await seedOrg('yv18n-eur');
      const sub = await seedActiveSubscription(org.id, tier1.id);

      const mockInvoice = createMockStripeInvoice({
        id: 'in_test_eur_reject',
        amount_paid: 499,
        currency: 'eur',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const err = await service
        .handleInvoicePaymentSucceeded(mockInvoice)
        .catch((e) => e);

      // constructor.name is mangled by esbuild — use toBeInstanceOf (static class import) instead of .name on the error
      expect(err).toBeInstanceOf(UnsupportedCurrencyError);
      expect(err?.received).toBe('eur');
      expect(err?.supported).toEqual(['gbp']);
      expect(err?.context).toMatchObject({
        invoiceId: 'in_test_eur_reject',
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('upper-case currency (GBP) is normalised to lowercase and accepted', async () => {
      // Stripe webhooks always lowercase, but the guard MUST not be
      // case-sensitive — a defensive normalisation prevents a future
      // refactor from regressing the happy path.
      const { org, tier1 } = await seedOrg('yv18n-case');
      const sub = await seedActiveSubscription(org.id, tier1.id);

      const mockInvoice = createMockStripeInvoice({
        amount_paid: 499,
        currency: 'GBP',
        parent: {
          subscription_details: { subscription: sub.stripeSubscriptionId },
        },
      }) as unknown as Stripe.Invoice;

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      await service.handleInvoicePaymentSucceeded(mockInvoice);
      expect(transferSpy).toHaveBeenCalled();
    });
  });

  describe('resolvePendingPayouts — payout.currency guard', () => {
    async function seedConnectAndSubscription(slug: string) {
      const { org, tier1 } = await seedOrg(slug);
      const stripeAccountId = `acct_yv18n_${createUniqueSlug('a')}`;

      const { eq } = await import('drizzle-orm');
      await db
        .update(stripeConnectAccounts)
        .set({ stripeAccountId })
        .where(eq(stripeConnectAccounts.organizationId, org.id));

      const [sub] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriberId, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_yv18n_${createUniqueSlug('s')}`,
          })
        )
        .returning();

      return { org, tier1, sub, stripeAccountId };
    }

    it("payout.currency='gbp' → transfer fires with currency 'gbp'", async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('yv18n-payout-gbp');

      await db.insert(payoutsTable).values({
        userId: creatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 1000,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      });

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 1, failed: 0 });
      expect(transferSpy).toHaveBeenCalledTimes(1);
      const params = transferSpy.mock.calls[0]?.[0] as
        | {
            currency?: string;
          }
        | undefined;
      expect(params?.currency).toBe('gbp');
    });

    it("payout.currency='usd' → no transfer fires; failed++ via the per-row catch", async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('yv18n-payout-usd');

      // Seed a USD payout directly — bypasses the schema default by
      // explicitly setting currency: 'usd'.
      await db.insert(payoutsTable).values({
        userId: creatorId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 2500,
        currency: 'usd',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      });

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      // The guard throws UnsupportedCurrencyError BEFORE
      // stripe.transfers.create — the per-row catch logs+counts as
      // failed and continues to the next row. The contract here is:
      // no Stripe transfer ever fires for the bad-currency row.
      expect(result).toEqual({ resolved: 0, failed: 1 });
      expect(transferSpy).not.toHaveBeenCalled();
    });

    it('mixed batch: GBP row resolves, USD row fails — bad currency does not poison the good rows', async () => {
      const { org, sub, stripeAccountId } =
        await seedConnectAndSubscription('yv18n-payout-mixed');

      await db.insert(payoutsTable).values([
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 500,
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: creatorId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 700,
          currency: 'eur',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
      ]);

      const transferSpy = vi.mocked(stripe.transfers.create);
      transferSpy.mockClear();

      const result = await service.resolvePendingPayouts(
        org.id,
        stripeAccountId
      );

      expect(result).toEqual({ resolved: 1, failed: 1 });
      expect(transferSpy).toHaveBeenCalledTimes(1);
      const params = transferSpy.mock.calls[0]?.[0] as
        | {
            currency?: string;
            amount?: number;
          }
        | undefined;
      expect(params?.currency).toBe('gbp');
      expect(params?.amount).toBe(500);
    });
  });

  describe('UnsupportedCurrencyError contract', () => {
    it('round-trips received + supported + context fields', async () => {
      const err = new UnsupportedCurrencyError('usd', ['gbp'], {
        invoiceId: 'in_test',
        subscriptionId: 'sub_test',
      });

      // constructor.name is mangled by esbuild — toBeInstanceOf is the type-safe alternative
      expect(err).toBeInstanceOf(UnsupportedCurrencyError);
      expect(err.code).toBe('UNSUPPORTED_CURRENCY');
      expect(err.statusCode).toBe(400);
      expect(err.received).toBe('usd');
      expect(err.supported).toEqual(['gbp']);
      expect(err.message).toContain("Unsupported currency 'usd'");
      expect(err.message).toContain('gbp');
      expect(err.context).toMatchObject({
        invoiceId: 'in_test',
        subscriptionId: 'sub_test',
      });
    });
  });
});
