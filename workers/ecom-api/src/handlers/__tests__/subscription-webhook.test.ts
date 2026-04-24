/**
 * Subscription Webhook Handler Tests
 *
 * Tests the handleSubscriptionWebhook function which routes Stripe
 * subscription lifecycle events to the SubscriptionService.
 *
 * Key test scenarios:
 * - Event routing (checkout, updated, deleted, invoice success/failure)
 * - Subscription mode filtering (ignores non-subscription checkouts)
 * - Missing subscription ID handling
 * - Error propagation (no catch, errors bubble to createWebhookHandler)
 * - DB cleanup always runs (finally block)
 */

import { STRIPE_EVENTS } from '@codex/constants';
import {
  createMockHonoContext,
  createMockStripeInvoice,
  createMockStripeSubscription,
  type MockHonoContext,
} from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports
vi.mock('@codex/database', () => ({
  createPerRequestDbClient: vi.fn(),
}));

vi.mock('@codex/subscription', () => ({
  SubscriptionService: vi.fn(),
  // The handler also imports `invalidateForUser` — stub it so the module
  // mock is complete. Cache-invalidation contract is tested separately in
  // `subscription-webhook-invalidation.test.ts`.
  invalidateForUser: vi.fn(),
}));

// The subscription-webhook handler dispatches emails via `sendEmailToWorker`
// from `@codex/worker-utils`. Mock it so no real fetch is attempted and so
// the trial_will_end tests can assert on dispatch.
vi.mock('@codex/worker-utils', () => ({
  sendEmailToWorker: vi.fn(),
}));

import { createPerRequestDbClient } from '@codex/database';
import { SubscriptionService } from '@codex/subscription';
import { sendEmailToWorker } from '@codex/worker-utils';
import { handleSubscriptionWebhook } from '../subscription-webhook';

function createContext(
  envOverrides: Partial<StripeWebhookEnv['Bindings']> = {}
): {
  context: Context<StripeWebhookEnv>;
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>;
} {
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({
    env: envOverrides,
  });
  // Attach executionCtx — createMockHonoContext omits it by default.
  // The webhook handler (since Codex-esikl) reads `c.executionCtx.waitUntil`
  // to wire the SubscriptionService orchestrator hook. Tests in this file
  // mock SubscriptionService so the waitUntil is never actually invoked,
  // but we still need the property to exist for `.bind(c.executionCtx)`.
  (mock as unknown as Record<string, unknown>).executionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
  return {
    context: mock as unknown as Context<StripeWebhookEnv>,
    mock,
  };
}

describe('handleSubscriptionWebhook', () => {
  let mockStripe: Stripe;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let mockDb: Record<string, unknown>;
  let mockHandleCreated: ReturnType<typeof vi.fn>;
  let mockHandleUpdated: ReturnType<typeof vi.fn>;
  let mockHandleDeleted: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceSuccess: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceFailed: ReturnType<typeof vi.fn>;
  let mockHandleTrialWillEnd: ReturnType<typeof vi.fn>;
  let mockHandlePaused: ReturnType<typeof vi.fn>;
  let mockHandleResumed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHandleCreated = vi.fn().mockResolvedValue(undefined);
    mockHandleUpdated = vi.fn().mockResolvedValue(undefined);
    mockHandleDeleted = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceSuccess = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceFailed = vi.fn().mockResolvedValue(undefined);
    mockHandleTrialWillEnd = vi.fn().mockResolvedValue(undefined);
    mockHandlePaused = vi.fn().mockResolvedValue(undefined);
    mockHandleResumed = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();
    mockDb = { mock: 'database' };

    const mockSubRetrieve = vi.fn().mockResolvedValue(
      createMockStripeSubscription({
        metadata: { userId: 'user_1', orgId: 'org_1', tierId: 'tier_1' },
      })
    );
    mockStripe = {
      subscriptions: { retrieve: mockSubRetrieve },
    } as unknown as Stripe;

    (createPerRequestDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: mockDb,
      cleanup: mockCleanup,
    });

    (
      SubscriptionService as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      handleSubscriptionCreated: mockHandleCreated,
      handleSubscriptionUpdated: mockHandleUpdated,
      handleSubscriptionDeleted: mockHandleDeleted,
      handleSubscriptionPaused: mockHandlePaused,
      handleSubscriptionResumed: mockHandleResumed,
      handleInvoicePaymentSucceeded: mockHandleInvoiceSuccess,
      handleInvoicePaymentFailed: mockHandleInvoiceFailed,
      handleTrialWillEnd: mockHandleTrialWillEnd,
    }));
  });

  function createEvent(
    type: string,
    data: Record<string, unknown> = {}
  ): Stripe.Event {
    return {
      id: `evt_test_${Date.now()}`,
      type,
      data: {
        object: {
          id: 'sub_test_123',
          ...data,
        },
      },
    } as unknown as Stripe.Event;
  }

  // ─── checkout.session.completed (subscription mode) ─────────────────────────

  describe('checkout.session.completed (subscription)', () => {
    it('should create subscription from checkout session', async () => {
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        mode: 'subscription',
        subscription: 'sub_new_123',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_new_123'
      );
      expect(mockHandleCreated).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String)
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Subscription created from checkout',
        expect.objectContaining({ subscriptionId: 'sub_new_123' })
      );
    });

    it('should handle subscription as object with id', async () => {
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        mode: 'subscription',
        subscription: { id: 'sub_obj_456' },
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_obj_456'
      );
      expect(mockHandleCreated).toHaveBeenCalled();
    });

    it('should skip non-subscription checkout sessions', async () => {
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        mode: 'payment',
        subscription: 'sub_should_skip',
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(mockHandleCreated).not.toHaveBeenCalled();
    });

    it('should warn and return if subscription ID is missing', async () => {
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        id: 'cs_no_sub',
        mode: 'subscription',
        subscription: null,
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.warn).toHaveBeenCalledWith(
        'Subscription checkout missing subscription ID',
        expect.objectContaining({ sessionId: 'cs_no_sub' })
      );
      expect(mockHandleCreated).not.toHaveBeenCalled();
    });
  });

  // ─── customer.subscription.updated ──────────────────────────────────────────

  describe('customer.subscription.updated', () => {
    it('should call handleSubscriptionUpdated with subscription object', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_update_789',
        status: 'active',
        cancel_at_period_end: true,
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_update_789' })
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Subscription updated',
        expect.objectContaining({ subscriptionId: 'sub_update_789' })
      );
    });
  });

  // ─── customer.subscription.deleted ──────────────────────────────────────────

  describe('customer.subscription.deleted', () => {
    it('should call handleSubscriptionDeleted with subscription object and webAppUrl', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED, {
        id: 'sub_del_321',
        status: 'canceled',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_del_321' }),
        expect.any(String)
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Subscription deleted',
        expect.objectContaining({ subscriptionId: 'sub_del_321' })
      );
    });
  });

  // ─── invoice.payment_succeeded ──────────────────────────────────────────────

  describe('invoice.payment_succeeded', () => {
    it('should call handleInvoicePaymentSucceeded with invoice object and webAppUrl', async () => {
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_success_001',
        amount_paid: 999,
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleInvoiceSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'in_success_001' }),
        expect.any(String)
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Invoice payment succeeded',
        expect.objectContaining({ invoiceId: 'in_success_001' })
      );
    });
  });

  // ─── invoice.payment_failed ─────────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('should log warning and call handleInvoicePaymentFailed', async () => {
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_FAILED, {
        id: 'in_fail_002',
        amount_due: 999,
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.warn).toHaveBeenCalledWith(
        'Invoice payment failed',
        expect.objectContaining({
          invoiceId: 'in_fail_002',
          amountDue: 999,
        })
      );
      expect(mockHandleInvoiceFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'in_fail_002' }),
        expect.any(String)
      );
      // Other service methods should not be called
      expect(mockHandleCreated).not.toHaveBeenCalled();
      expect(mockHandleUpdated).not.toHaveBeenCalled();
      expect(mockHandleDeleted).not.toHaveBeenCalled();
      expect(mockHandleInvoiceSuccess).not.toHaveBeenCalled();
    });
  });

  // ─── customer.subscription.trial_will_end (Codex-lvxev) ────────────────────
  //
  // Trial-will-end is handled but is a deliberate non-participant in the
  // cache + revocation system:
  //   - Service method (`handleTrialWillEnd`) is called with the Stripe
  //     subscription object + webAppUrl.
  //   - Email is dispatched via `sendEmailToWorker` when the service
  //     returns an email payload.
  //   - No revocation write, no cache bump — asserted at the service-level
  //     orchestrator test; here we assert the handler returns 200 cleanly.
  //   - Missing metadata (service returns undefined) is tolerated — no
  //     crash, no email dispatch.

  describe('customer.subscription.trial_will_end', () => {
    it('positive: calls handleTrialWillEnd and dispatches email', async () => {
      mockHandleTrialWillEnd.mockResolvedValueOnce({
        userId: 'user_trial',
        orgId: 'org_trial',
        trialEndAt: new Date(),
        email: {
          to: 'trial@example.com',
          toName: 'Trial User',
          templateName: 'trial-ending-soon',
          category: 'transactional',
          userId: 'user_trial',
          data: {
            userName: 'Trial User',
            planName: 'Basic',
            trialEndDate: '01/01/2026',
            manageUrl: 'https://example.com/account/subscriptions',
          },
        },
      });

      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_TRIAL_WILL_END, {
        id: 'sub_trial_end_1',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      // Service method dispatched with the subscription object + webAppUrl.
      expect(mockHandleTrialWillEnd).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_trial_end_1' }),
        expect.any(String)
      );

      // Email dispatched once via sendEmailToWorker.
      expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
      expect(sendEmailToWorker).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          templateName: 'trial-ending-soon',
          to: 'trial@example.com',
        })
      );

      // Logged at info level.
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Subscription trial will end',
        expect.objectContaining({ subscriptionId: 'sub_trial_end_1' })
      );

      // Access-reducing handlers MUST NOT be called for this event.
      expect(mockHandleDeleted).not.toHaveBeenCalled();
      expect(mockHandleUpdated).not.toHaveBeenCalled();
      expect(mockHandleInvoiceFailed).not.toHaveBeenCalled();
    });

    it('negative: missing metadata (service returns undefined) → no email, still 200', async () => {
      // Service returns undefined when metadata.codex_user_id is missing.
      // The handler must not crash and must not dispatch an email.
      mockHandleTrialWillEnd.mockResolvedValueOnce(undefined);

      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_TRIAL_WILL_END, {
        id: 'sub_trial_end_noop',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleTrialWillEnd).toHaveBeenCalledTimes(1);
      expect(sendEmailToWorker).not.toHaveBeenCalled();

      // Handler still runs to completion and logs the info line.
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Subscription trial will end',
        expect.objectContaining({ subscriptionId: 'sub_trial_end_noop' })
      );
    });
  });

  // ─── Unhandled event types ──────────────────────────────────────────────────

  // ─── Dashboard drift detection (product.updated / price.updated) ───────────
  // Stripe Dashboard edits to Codex-managed tier Products/Prices don't sync
  // back to the subscriptionTiers table today. The handler logs an obs.error
  // so operators can reconcile manually. A Codex-managed tier is identified
  // by metadata we set in TierService (codex_type='subscription_tier' on
  // products, codex_organization_id on prices).

  describe('product.updated (Dashboard drift detection)', () => {
    it('should log obs.error when a Codex-managed tier Product is edited', async () => {
      const event = createEvent(STRIPE_EVENTS.PRODUCT_UPDATED, {
        id: 'prod_tier_123',
        name: 'Renamed in Dashboard',
        metadata: {
          codex_type: 'subscription_tier',
          codex_organization_id: 'org-1',
        },
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Codex-managed tier Product edited in Stripe Dashboard',
        expect.objectContaining({
          stripeProductId: 'prod_tier_123',
          organizationId: 'org-1',
          productName: 'Renamed in Dashboard',
        })
      );
    });

    it('should silently ignore product.updated for non-Codex products', async () => {
      const event = createEvent(STRIPE_EVENTS.PRODUCT_UPDATED, {
        id: 'prod_external_456',
        metadata: { something: 'else' },
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.error).not.toHaveBeenCalled();
    });

    it('should silently ignore product.updated with no metadata', async () => {
      const event = createEvent(STRIPE_EVENTS.PRODUCT_UPDATED, {
        id: 'prod_bare',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.error).not.toHaveBeenCalled();
    });
  });

  describe('price.updated (Dashboard drift detection)', () => {
    it('should log obs.error when a Codex-managed tier Price is edited', async () => {
      const event = createEvent(STRIPE_EVENTS.PRICE_UPDATED, {
        id: 'price_tier_abc',
        active: false,
        metadata: { codex_organization_id: 'org-2', interval: 'month' },
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Codex-managed tier Price edited in Stripe Dashboard',
        expect.objectContaining({
          stripePriceId: 'price_tier_abc',
          organizationId: 'org-2',
          priceActive: false,
        })
      );
    });

    it('should silently ignore price.updated for non-Codex prices', async () => {
      const event = createEvent(STRIPE_EVENTS.PRICE_UPDATED, {
        id: 'price_external_xyz',
        metadata: {},
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.error).not.toHaveBeenCalled();
    });
  });

  describe('unhandled event types', () => {
    it('should log info for unrecognised event types', async () => {
      // Codex-a0vk2 added `customer.subscription.paused`, Codex-rh0on added
      // `customer.subscription.resumed` — pick an event type that remains
      // genuinely unhandled to preserve this test's contract (the switch's
      // `default` arm). `pending_update_applied` is a real Stripe event the
      // handler does not currently case on.
      const event = createEvent('customer.subscription.pending_update_applied');
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.info).toHaveBeenCalledWith(
        'Unhandled subscription webhook event',
        expect.objectContaining({
          type: 'customer.subscription.pending_update_applied',
        })
      );
    });
  });

  // ─── Error propagation ──────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('should propagate errors from service methods (no inner catch)', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_err_123',
      });
      const { context } = createContext();

      const dbError = new Error('Connection timeout');
      mockHandleUpdated.mockRejectedValueOnce(dbError);

      await expect(
        handleSubscriptionWebhook(event, mockStripe, context)
      ).rejects.toThrow('Connection timeout');
    });

    it('should always cleanup database connection on success', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_clean_ok',
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should always cleanup database connection on error', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_clean_err',
      });
      const { context } = createContext();

      mockHandleUpdated.mockRejectedValueOnce(new Error('DB error'));

      try {
        await handleSubscriptionWebhook(event, mockStripe, context);
      } catch {
        // Expected to throw
      }

      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  // ─── Service initialisation ─────────────────────────────────────────────────

  describe('service initialisation', () => {
    it('should pass correct config to createPerRequestDbClient', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_init',
      });
      const { context } = createContext({
        DATABASE_URL: 'postgresql://test-sub-db',
        DB_METHOD: 'NEON',
      });

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(createPerRequestDbClient).toHaveBeenCalledWith(
        expect.objectContaining({
          DATABASE_URL: 'postgresql://test-sub-db',
          DB_METHOD: 'NEON',
        })
      );
    });

    it('should default environment to development when not set', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_env',
      });
      const { context } = createContext({ ENVIRONMENT: undefined });

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(SubscriptionService).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'development' }),
        mockStripe
      );
    });

    it('should pass stripe client to SubscriptionService', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_stripe',
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(SubscriptionService).toHaveBeenCalledWith(
        expect.anything(),
        mockStripe
      );
    });
  });
});
