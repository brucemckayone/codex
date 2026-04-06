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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
      await db
        .insert(subscriptions)
        .values(
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
  });

  // ─── cancelSubscription ───────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('should set cancel_at_period_end and status to CANCELLING', async () => {
      const { org, tier1 } = await createFullOrg('cancel');
      await db
        .insert(subscriptions)
        .values(
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
  });

  // ─── reactivateSubscription ───────────────────────────────────────

  describe('reactivateSubscription', () => {
    it('should remove cancel_at_period_end and set status to ACTIVE', async () => {
      const { org, tier1 } = await createFullOrg('reactivate');
      await db
        .insert(subscriptions)
        .values(
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
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(otherCreatorId, org.id, tier1.id, {
            status: 'active',
          })
        );

      await expect(
        service.reactivateSubscription(otherCreatorId, org.id)
      ).rejects.toThrow(SubscriptionCheckoutError);
    });
  });

  // ─── getSubscription ──────────────────────────────────────────────

  describe('getSubscription', () => {
    it('should return subscription with nested tier', async () => {
      const { org, tier1 } = await createFullOrg('get-sub');
      await db
        .insert(subscriptions)
        .values(
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
  });
});
