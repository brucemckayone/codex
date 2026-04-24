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
  organizations,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
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

  beforeEach(() => {
    stripe = createMockStripe();
    service = new SubscriptionService({ db, environment: 'test' }, stripe);
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
      const stripeSubId = 'sub_verify_complete_123';
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

  // ─── changeTier ───────────────────────────────────────────────────

  describe('changeTier', () => {
    it('should update subscription tier with proration', async () => {
      const { org, tier1, tier2 } = await createFullOrg('change-tier');
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(otherCreatorId, org.id, tier1.id));

      await service.changeTier(otherCreatorId, org.id, tier2.id, 'month');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          proration_behavior: 'create_prorations',
        })
      );

      // Verify local DB updated
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

      const seed = await Promise.all([
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(creatorId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: 'sub_partial_ok_1',
            })
          )
          .returning(),
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: 'sub_partial_fail',
            })
          )
          .returning(),
        db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(thirdUserId, org.id, tier1.id, {
              status: 'active',
              stripeSubscriptionId: 'sub_partial_ok_2',
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
      const [okRow] = await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(creatorId, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: 'sub_guard_active',
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
            stripeSubscriptionId: `sub_guard_${status}_${idx}`,
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
          stripeSubscriptionId: 'sub_proration_1',
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
            stripeSubscriptionId: 'sub_idempo_1',
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
      for (const [idx, uid] of newUserIds.entries()) {
        await db.insert(subscriptions).values(
          createTestSubscriptionInput(uid, org.id, tier1.id, {
            status: 'active',
            stripeSubscriptionId: `sub_batch_${idx}`,
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
  });
});
