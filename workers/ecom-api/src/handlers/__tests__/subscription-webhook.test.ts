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
}));

import { createPerRequestDbClient } from '@codex/database';
import { SubscriptionService } from '@codex/subscription';
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

  beforeEach(() => {
    vi.clearAllMocks();

    mockHandleCreated = vi.fn().mockResolvedValue(undefined);
    mockHandleUpdated = vi.fn().mockResolvedValue(undefined);
    mockHandleDeleted = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceSuccess = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();
    mockDb = { mock: 'database' };

    const mockSubRetrieve = vi
      .fn()
      .mockResolvedValue(
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
      handleInvoicePaymentSucceeded: mockHandleInvoiceSuccess,
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
      expect(mockHandleCreated).toHaveBeenCalled();
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
    it('should call handleSubscriptionDeleted with subscription object', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_DELETED, {
        id: 'sub_del_321',
        status: 'canceled',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_del_321' })
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Subscription deleted',
        expect.objectContaining({ subscriptionId: 'sub_del_321' })
      );
    });
  });

  // ─── invoice.payment_succeeded ──────────────────────────────────────────────

  describe('invoice.payment_succeeded', () => {
    it('should call handleInvoicePaymentSucceeded with invoice object', async () => {
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_success_001',
        amount_paid: 999,
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleInvoiceSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'in_success_001' })
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Invoice payment succeeded',
        expect.objectContaining({ invoiceId: 'in_success_001' })
      );
    });
  });

  // ─── invoice.payment_failed ─────────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('should log warning but not call any service method', async () => {
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
      expect(mockHandleCreated).not.toHaveBeenCalled();
      expect(mockHandleUpdated).not.toHaveBeenCalled();
      expect(mockHandleDeleted).not.toHaveBeenCalled();
      expect(mockHandleInvoiceSuccess).not.toHaveBeenCalled();
    });
  });

  // ─── Unhandled event types ──────────────────────────────────────────────────

  describe('unhandled event types', () => {
    it('should log info for unrecognised event types', async () => {
      const event = createEvent('customer.subscription.paused');
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.info).toHaveBeenCalledWith(
        'Unhandled subscription webhook event',
        expect.objectContaining({ type: 'customer.subscription.paused' })
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
