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

import type { KVNamespace } from '@cloudflare/workers-types';
import { STRIPE_EVENTS } from '@codex/constants';
import { AfterCommitError } from '@codex/service-errors';
import {
  createMockHonoContext,
  createMockStripeSubscription,
  type MockHonoContext,
} from '@codex/test-utils';
import type { WebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports
vi.mock('@codex/subscription', () => ({
  // The renewal-time price swap (Codex-2hxff.3).
  applyDuePendingPriceChange: vi.fn().mockResolvedValue(false),
  PENDING_PRICE_ID_KEY: 'codex_pending_price_id',
  // The handler also imports `invalidateForUser` — stub it so the module
  // mock is complete. Cache-invalidation contract is tested separately in
  // `subscription-webhook-invalidation.test.ts`.
  invalidateForUser: vi.fn(),
  // The handler calls the STATIC `isCourseSubscription` to discriminate course
  // subs (mode=subscription on this same webhook, `type: 'course_subscription'`
  // metadata) at three sites. A vi.mock factory is a CLOSED namespace, so the
  // class must be here even though its instance now comes from the registry
  // (`services.courseSubscription`, Codex-2hxff.54).
  CourseSubscriptionService: {
    // MIRRORS the real predicate rather than hardcoding `false`
    // (course-subscription-service.ts:677 — metadata.type ===
    // COURSE_SUBSCRIPTION_METADATA_TYPE). A constant `false` would pass today,
    // because every fixture here is an ORG subscription, and would then
    // silently mis-route the first test that does add course metadata. The
    // literal is inlined because a vi.mock factory is hoisted above imports
    // and so cannot reference the exported constant.
    isCourseSubscription: vi.fn(
      (sub: { metadata?: Record<string, string> | null }) =>
        (sub?.metadata?.type ?? null) === 'course_subscription'
    ),
  },
}));

// The subscription-webhook handler dispatches emails via `sendEmailToWorker`
// from `@codex/worker-utils`. Mock it so no real fetch is attempted and so
// the trial_will_end tests can assert on dispatch. The handler gets its
// services from `createWebhookServices` (Codex-2hxff.54); mock that seam so
// each test hands over its own stubs. Every other export stays real.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    createWebhookServices: vi.fn(),
    sendEmailToWorker: vi.fn(),
  };
});

import { applyDuePendingPriceChange } from '@codex/subscription';
import { createWebhookServices, sendEmailToWorker } from '@codex/worker-utils';
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
  // The handler hands it to `createWebhookServices` and reads
  // `c.executionCtx.waitUntil` for its own invalidation helpers (course
  // buyer, Dashboard sync-back), so the property must exist for
  // `.bind(c.executionCtx)`. `release` is mocked, so every waitUntil call
  // a test sees is the handler's own.
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
  let mockRelease: ReturnType<typeof vi.fn>;
  let mockHandleCreated: ReturnType<typeof vi.fn>;
  let mockHandleUpdated: ReturnType<typeof vi.fn>;
  let mockHandleDeleted: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceSuccess: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceFailed: ReturnType<typeof vi.fn>;
  let mockHandleTrialWillEnd: ReturnType<typeof vi.fn>;
  let mockHandlePaused: ReturnType<typeof vi.fn>;
  let mockHandleResumed: ReturnType<typeof vi.fn>;
  let mockApplyProductUpdate: ReturnType<typeof vi.fn>;
  let mockRecordPriceDrift: ReturnType<typeof vi.fn>;
  let mockMarkCheckoutCompleted: ReturnType<typeof vi.fn>;
  let mockHandleCourseCreated: ReturnType<typeof vi.fn>;
  let mockHandleCourseInvoiceSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHandleCreated = vi.fn().mockResolvedValue(undefined);
    mockMarkCheckoutCompleted = vi.fn().mockResolvedValue(undefined);
    mockHandleCourseCreated = vi.fn().mockResolvedValue(undefined);
    mockHandleCourseInvoiceSuccess = vi.fn().mockResolvedValue(undefined);
    mockHandleUpdated = vi.fn().mockResolvedValue(undefined);
    mockHandleDeleted = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceSuccess = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceFailed = vi.fn().mockResolvedValue(undefined);
    mockHandleTrialWillEnd = vi.fn().mockResolvedValue(undefined);
    mockHandlePaused = vi.fn().mockResolvedValue(undefined);
    mockHandleResumed = vi.fn().mockResolvedValue(undefined);
    // Default the sync-back methods to null (no-match / no-op) so the
    // happy-path non-drift events exercise the non-changed branch without
    // surprising any unrelated test that fires a product/price event.
    mockApplyProductUpdate = vi.fn().mockResolvedValue(null);
    mockRecordPriceDrift = vi.fn().mockResolvedValue(undefined);
    mockRelease = vi.fn();

    const mockSubRetrieve = vi.fn().mockResolvedValue(
      createMockStripeSubscription({
        metadata: { userId: 'user_1', orgId: 'org_1', tierId: 'tier_1' },
      })
    );
    mockStripe = {
      subscriptions: { retrieve: mockSubRetrieve },
    } as unknown as Stripe;

    // The registry's services, as the composition root hands them over.
    vi.mocked(createWebhookServices).mockResolvedValue({
      services: {
        subscription: {
          handleSubscriptionCreated: mockHandleCreated,
          handleSubscriptionUpdated: mockHandleUpdated,
          handleSubscriptionDeleted: mockHandleDeleted,
          handleSubscriptionPaused: mockHandlePaused,
          handleSubscriptionResumed: mockHandleResumed,
          handleInvoicePaymentSucceeded: mockHandleInvoiceSuccess,
          handleInvoicePaymentFailed: mockHandleInvoiceFailed,
          handleTrialWillEnd: mockHandleTrialWillEnd,
          // The paid checkout's reservation (Codex-2hxff.15).
          markCheckoutSessionCompleted: mockMarkCheckoutCompleted,
        },
        // Dashboard sync-back path (Codex-s7h0y) goes through TierService,
        // stubbed with controllable apply* method behaviour.
        tier: {
          applyStripeProductUpdate: mockApplyProductUpdate,
          recordStripePriceDrift: mockRecordPriceDrift,
        },
        // Stubbed rather than left bare so a course-sub test gets a mock
        // method instead of a TypeError.
        courseSubscription: {
          handleCourseSubscriptionCreated: mockHandleCourseCreated,
          handleCourseSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
          handleCourseSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
          handleCourseInvoicePaymentSucceeded: mockHandleCourseInvoiceSuccess,
        },
      } as unknown as WebhookServices['services'],
      background: (promise) => promise,
      release: mockRelease,
    });
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
      expect(mockMarkCheckoutCompleted).not.toHaveBeenCalled();
    });

    // One open checkout per buyer per org or course plan (Codex-2hxff.15,
    // owner decision 2026-10-22): once paid, its reservation is completed so
    // a new checkout is never handed the same session.
    it('marks the paid checkout session completed, after the subscription is recorded', async () => {
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        id: 'cs_paid_tier',
        mode: 'subscription',
        subscription: 'sub_new_123',
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockMarkCheckoutCompleted).toHaveBeenCalledExactlyOnceWith(
        'cs_paid_tier'
      );
      expect(mockHandleCreated.mock.invocationCallOrder[0]).toBeLessThan(
        mockMarkCheckoutCompleted.mock.invocationCallOrder[0] ?? 0
      );
    });

    it("marks a course plan's paid checkout session completed too", async () => {
      vi.mocked(mockStripe.subscriptions.retrieve).mockResolvedValueOnce(
        createMockStripeSubscription({
          metadata: { type: 'course_subscription' },
        }) as never
      );
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        id: 'cs_paid_course',
        mode: 'subscription',
        subscription: 'sub_course_123',
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockHandleCourseCreated).toHaveBeenCalledOnce();
      expect(mockHandleCreated).not.toHaveBeenCalled();
      expect(mockMarkCheckoutCompleted).toHaveBeenCalledExactlyOnceWith(
        'cs_paid_course'
      );
      expect(mockHandleCourseCreated.mock.invocationCallOrder[0]).toBeLessThan(
        mockMarkCheckoutCompleted.mock.invocationCallOrder[0] ?? 0
      );
    });

    it('a checkout whose subscription could not be recorded is left open, so Stripe redelivers it', async () => {
      mockHandleCreated.mockRejectedValueOnce(new Error('refund refused'));
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        id: 'cs_unrecorded',
        mode: 'subscription',
        subscription: 'sub_new_123',
      });
      const { context } = createContext();

      await expect(
        handleSubscriptionWebhook(event, mockStripe, context)
      ).rejects.toThrow('refund refused');
      expect(mockMarkCheckoutCompleted).not.toHaveBeenCalled();
    });

    it('a payment-mode checkout marks no subscription session', async () => {
      const event = createEvent(STRIPE_EVENTS.CHECKOUT_COMPLETED, {
        mode: 'payment',
        subscription: null,
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockMarkCheckoutCompleted).not.toHaveBeenCalled();
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

    // Codex-2hxff.3: a renewal is a customer.subscription.updated — the moment
    // a pending Studio price change becomes due.
    it('offers the subscription to the pending-price swap AFTER the DB sync', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_renewal_1',
        status: 'active',
      });
      const { context } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      const swap = vi.mocked(applyDuePendingPriceChange);
      expect(swap).toHaveBeenCalledWith(
        mockStripe,
        expect.objectContaining({ id: 'sub_renewal_1' })
      );
      const syncOrder = mockHandleUpdated.mock.invocationCallOrder[0] ?? 0;
      const swapOrder = swap.mock.invocationCallOrder.at(-1) ?? 0;
      expect(syncOrder).toBeGreaterThan(0);
      expect(swapOrder).toBeGreaterThan(syncOrder);
    });

    // Codex-2hxff.3 review (H3): a swap Stripe refuses for good must not end
    // as the generic "permanent error (acknowledged)" warning.
    it('a permanent swap failure is acknowledged but logged at ERROR level with context', async () => {
      const refused = Object.assign(new Error('No such price: price_gone'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
      });
      vi.mocked(applyDuePendingPriceChange).mockRejectedValueOnce(refused);
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_swap_refused',
        status: 'active',
        metadata: { codex_pending_price_id: 'price_gone' },
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Pending price change could not be applied',
        expect.objectContaining({
          subscriptionId: 'sub_swap_refused',
          pendingPriceId: 'price_gone',
          errorType: 'StripeInvalidRequestError',
          errorCode: 'resource_missing',
        })
      );
    });

    it('a transient swap failure is rethrown so Stripe redelivers', async () => {
      const flaky = Object.assign(new Error('connection reset'), {
        type: 'StripeConnectionError',
      });
      vi.mocked(applyDuePendingPriceChange).mockRejectedValueOnce(flaky);
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_swap_flaky',
        status: 'active',
      });
      const { context } = createContext();

      await expect(
        handleSubscriptionWebhook(event, mockStripe, context)
      ).rejects.toBe(flaky);
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

    // Codex-2hxff.67: the payout committed, then the clawback of a refund
    // that preceded it failed (`AfterCommitError`, carrying the result).
    describe('a clawback that fails after the payout committed', () => {
      const email = {
        to: 'subscriber@example.com',
        templateName: 'subscription-renewed',
        category: 'transactional',
        data: {},
      };
      const permanent = () =>
        Object.assign(new Error('No such charge'), {
          type: 'StripeInvalidRequestError',
          statusCode: 404,
        });
      const transient = () =>
        Object.assign(new Error('Connection to Stripe failed'), {
          type: 'StripeConnectionError',
        });
      const kv = () =>
        ({
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
        }) as unknown as KVNamespace;

      it('permanent (tier) → the renewal email still goes, then it rejects', async () => {
        const failure = new AfterCommitError(
          'clawback failed',
          { userId: 'user_1', orgId: 'org_1', email },
          permanent()
        );
        mockHandleInvoiceSuccess.mockRejectedValueOnce(failure);
        const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
          id: 'in_after_commit',
        });
        const { context, mock } = createContext();

        await expect(
          handleSubscriptionWebhook(event, mockStripe, context)
        ).rejects.toBe(failure);

        expect(sendEmailToWorker).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          email
        );
        expect(mock._obs.info).toHaveBeenCalledWith(
          'Invoice payment succeeded',
          expect.objectContaining({ invoiceId: 'in_after_commit' })
        );
        expect(mockRelease).toHaveBeenCalledOnce();
      });

      it('transient (tier) → rejects before the email: the redelivery sends it once', async () => {
        const failure = new AfterCommitError(
          'clawback failed',
          { userId: 'user_1', orgId: 'org_1', email },
          transient()
        );
        mockHandleInvoiceSuccess.mockRejectedValueOnce(failure);
        const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
          id: 'in_after_commit_transient',
        });

        await expect(
          handleSubscriptionWebhook(event, mockStripe, createContext().context)
        ).rejects.toBe(failure);

        expect(sendEmailToWorker).not.toHaveBeenCalled();
      });

      it("permanent (course plan) → the buyer's library is still bumped, then it rejects", async () => {
        const failure = new AfterCommitError(
          'clawback failed',
          { userId: 'user_1', organizationId: 'org_1' },
          permanent()
        );
        mockHandleCourseInvoiceSuccess.mockRejectedValueOnce(failure);
        const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
          id: 'in_course_after_commit',
          parent: {
            subscription_details: {
              subscription: 'sub_course_1',
              metadata: { type: 'course_subscription' },
            },
          },
        });
        const { context, mock } = createContext({ CACHE_KV: kv() });

        await expect(
          handleSubscriptionWebhook(event, mockStripe, context)
        ).rejects.toBe(failure);

        expect(mockHandleCourseInvoiceSuccess).toHaveBeenCalled();
        expect(context.executionCtx.waitUntil).toHaveBeenCalled();
        expect(mock._obs.info).toHaveBeenCalledWith(
          'Course subscription invoice payment succeeded',
          expect.objectContaining({ invoiceId: 'in_course_after_commit' })
        );
      });
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

  // ─── Dashboard sync-back (product.updated / price.created / price.updated) ─
  // Q1 product decision (Codex-kqmvd epic): Stripe Dashboard edits to
  // Codex-managed tier Products/Prices auto-propagate back to the
  // subscriptionTiers table. Q1.1 (Codex-s7h0y) wires the sync-back via
  // TierService.applyStripeProductUpdate + applyStripePriceCreated.
  // A Codex-managed tier is identified by metadata we set in TierService
  // (codex_type='subscription_tier' on products, codex_organization_id on
  // prices). The price.updated arm remains detect-only (adoption happens
  // on price.created — Dashboard amount-change workflow).

  describe('product.updated (Dashboard sync-back)', () => {
    it('should mirror the edit to the tier and invalidate the org cache when changed', async () => {
      mockApplyProductUpdate.mockResolvedValue({
        tierId: 'tier-1',
        organizationId: 'org-1',
        changed: true,
      });
      const fakeKV = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      } as unknown as KVNamespace;
      const { context, mock } = createContext({ CACHE_KV: fakeKV });

      const product = {
        id: 'prod_tier_123',
        name: 'Renamed in Dashboard',
        description: 'New description',
        metadata: {
          codex_type: 'subscription_tier',
          codex_organization_id: 'org-1',
        },
      };
      const event = createEvent(STRIPE_EVENTS.PRODUCT_UPDATED, product);

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockApplyProductUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'prod_tier_123' })
      );
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Synced Stripe Dashboard product edit to tier',
        expect.objectContaining({
          tierId: 'tier-1',
          organizationId: 'org-1',
          stripeProductId: 'prod_tier_123',
        })
      );
      // Cache invalidation went through waitUntil (fire-and-forget).
      expect(context.executionCtx.waitUntil).toHaveBeenCalledTimes(1);
    });

    it('should skip cache invalidation when sync-back reports no change (idempotent replay)', async () => {
      mockApplyProductUpdate.mockResolvedValue({
        tierId: 'tier-2',
        organizationId: 'org-2',
        changed: false,
      });
      const fakeKV = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      } as unknown as KVNamespace;
      const { context, mock } = createContext({ CACHE_KV: fakeKV });

      const event = createEvent(STRIPE_EVENTS.PRODUCT_UPDATED, {
        id: 'prod_tier_noop',
        metadata: {
          codex_type: 'subscription_tier',
          codex_organization_id: 'org-2',
        },
      });

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockApplyProductUpdate).toHaveBeenCalledOnce();
      expect(mock._obs.info).not.toHaveBeenCalledWith(
        'Synced Stripe Dashboard product edit to tier',
        expect.anything()
      );
      expect(context.executionCtx.waitUntil).not.toHaveBeenCalled();
    });

    it('should pass non-Codex products through the service (which returns null)', async () => {
      // applyStripeProductUpdate filters on metadata itself and returns
      // null for non-Codex products. The handler only logs + invalidates
      // on a `changed: true` result — null triggers neither.
      mockApplyProductUpdate.mockResolvedValue(null);
      const event = createEvent(STRIPE_EVENTS.PRODUCT_UPDATED, {
        id: 'prod_external_456',
        metadata: { something: 'else' },
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockApplyProductUpdate).toHaveBeenCalledOnce();
      expect(mock._obs.info).not.toHaveBeenCalledWith(
        'Synced Stripe Dashboard product edit to tier',
        expect.anything()
      );
      expect(context.executionCtx.waitUntil).not.toHaveBeenCalled();
    });
  });

  // Studio is the only place a tier price is set (Codex-2hxff.3): a Price
  // created in the Dashboard is handed to the drift log — never adopted, never
  // propagated, no cache to bump.
  describe('price.created (drift log only)', () => {
    it('hands the Price to recordStripePriceDrift and changes nothing else', async () => {
      const fakeKV = {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      } as unknown as KVNamespace;
      const { context } = createContext({ CACHE_KV: fakeKV });

      const event = createEvent(STRIPE_EVENTS.PRICE_CREATED, {
        id: 'price_dashboard_15_00',
        active: true,
        unit_amount: 1500,
        recurring: { interval: 'month' },
        product: 'prod_tier_pc',
        metadata: {},
      });

      await handleSubscriptionWebhook(event, mockStripe, context);

      expect(mockRecordPriceDrift).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'price_dashboard_15_00' })
      );
      // No org-cache invalidation and no subscriber fan-out.
      expect(context.executionCtx.waitUntil).not.toHaveBeenCalled();
    });
  });

  describe('price.updated (Dashboard drift detection — log only)', () => {
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

      expect(mockRelease).toHaveBeenCalledOnce();
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

      expect(mockRelease).toHaveBeenCalledOnce();
    });
  });

  // ─── Service initialisation ─────────────────────────────────────────────────
  //
  // Codex-2hxff.54: the handler no longer builds its DB client or services;
  // the registry does, from the bindings and Stripe client the handler passes
  // to createWebhookServices. These assert that hand-off.

  describe('service initialisation', () => {
    it('should pass the database bindings to createWebhookServices', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_init',
      });
      const { context } = createContext({
        DATABASE_URL: 'postgresql://test-sub-db',
        DB_METHOD: 'NEON',
      });

      await handleSubscriptionWebhook(event, mockStripe, context);

      // The per-request DB client is now built by the registry from these.
      expect(createWebhookServices).toHaveBeenCalledWith(
        expect.objectContaining({
          DATABASE_URL: 'postgresql://test-sub-db',
          DB_METHOD: 'NEON',
        }),
        context.executionCtx,
        expect.anything()
      );
    });

    it('should leave the environment default to the registry', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_env',
      });
      const { context } = createContext({ ENVIRONMENT: undefined });

      await handleSubscriptionWebhook(event, mockStripe, context);

      // The 'development' default moved into the registry's getEnvironment().
      expect(createWebhookServices).toHaveBeenCalledWith(
        context.env,
        context.executionCtx,
        expect.objectContaining({ stripe: mockStripe })
      );
      const [env] = vi.mocked(createWebhookServices).mock.calls[0] ?? [];
      expect(env?.ENVIRONMENT).toBeUndefined();
    });

    it('should pass stripe client to createWebhookServices', async () => {
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_stripe',
      });
      const { context, mock } = createContext();

      await handleSubscriptionWebhook(event, mockStripe, context);

      // The webhook's verified Stripe client; the registry shares it with
      // every Stripe-backed service it builds.
      expect(createWebhookServices).toHaveBeenCalledWith(
        context.env,
        context.executionCtx,
        expect.objectContaining({ obs: mock._obs, stripe: mockStripe })
      );
    });
  });
});
