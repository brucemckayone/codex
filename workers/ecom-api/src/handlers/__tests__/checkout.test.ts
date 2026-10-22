/**
 * Checkout Webhook Handler Tests
 *
 * Tests the handleCheckoutCompleted function which processes
 * checkout.session.completed Stripe webhook events.
 *
 * Key test scenarios:
 * - Successful purchase completion
 * - Payment status validation (skips non-paid)
 * - Metadata validation (handles invalid gracefully)
 * - Error handling (logs errors, doesn't throw)
 * - Idempotency (duplicate events handled safely)
 */

import { CURRENCY } from '@codex/constants';
import {
  createMockHonoContext,
  createMockStripeCheckoutEvent,
  type MockHonoContext,
} from '@codex/test-utils';
import type { WebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports
// The handler gets its PurchaseService from the webhook composition root
// (Codex-2hxff.54). Mock that seam so each test hands over its own stub;
// every other export stays real.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    createWebhookServices: vi.fn(),
  };
});

vi.mock('@codex/validation', () => ({
  courseCheckoutSessionMetadataSchema: {
    parse: vi.fn((data) => ({
      kind: 'course',
      customerId: data.customerId,
      courseId: data.courseId,
      organizationId: data.organizationId || null,
    })),
  },
  checkoutSessionMetadataSchema: {
    parse: vi.fn((data) => {
      if (!data?.customerId || !data?.contentId) {
        throw new Error('Invalid metadata');
      }
      return {
        customerId: data.customerId,
        contentId: data.contentId,
        organizationId: data.organizationId || null,
      };
    }),
  },
}));

import { checkoutSessionMetadataSchema } from '@codex/validation';
import { createWebhookServices } from '@codex/worker-utils';
// Import after mocks
import { handleCheckoutCompleted } from '../checkout';

/**
 * Helper to create context with StripeWebhookEnv bindings.
 * Returns both the typed context for the handler and the mock for assertions.
 *
 * We cast through `unknown` because MockHonoContext implements only the subset
 * of Hono's Context methods actually used by the handler (get, env).
 */
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

/**
 * Attach an `executionCtx` — createMockHonoContext omits it. Only the
 * service-initialisation tests need one, to prove the handler hands the
 * request's own context to `createWebhookServices`.
 */
function attachExecutionCtx(
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>
): ExecutionContext {
  const executionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  (mock as unknown as Record<string, unknown>).executionCtx = executionCtx;
  return executionCtx;
}

describe('handleCheckoutCompleted', () => {
  let mockStripe: Stripe;
  let mockCompletePurchase: ReturnType<typeof vi.fn>;
  let mockMarkCheckoutSessionCompleted: ReturnType<typeof vi.fn>;
  let mockRelease: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStripe = {} as Stripe;
    mockCompletePurchase = vi.fn().mockResolvedValue({
      id: 'purchase_123',
      customerId: 'user_123',
      contentId: 'content_456',
      status: 'completed',
      duplicateOfPurchaseId: null,
    });
    mockMarkCheckoutSessionCompleted = vi.fn().mockResolvedValue(undefined);
    mockRelease = vi.fn();

    // The registry's services, as the composition root hands them over.
    vi.mocked(createWebhookServices).mockResolvedValue({
      services: {
        purchase: {
          completePurchase: mockCompletePurchase,
          completeCoursePurchase: mockCompletePurchase,
          markCheckoutSessionCompleted: mockMarkCheckoutSessionCompleted,
        },
      } as unknown as WebhookServices['services'],
      background: (promise) => promise,
      release: mockRelease,
    });
  });

  describe('successful purchase completion', () => {
    it('should process valid checkout.session.completed event', async () => {
      const event = createMockStripeCheckoutEvent({
        eventId: 'evt_test_123',
        sessionId: 'cs_test_abc',
        paymentIntentId: 'pi_test_xyz',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      // Verify the registry's services were built (once) for this event
      expect(createWebhookServices).toHaveBeenCalledOnce();

      // Verify completePurchase was called with correct params
      expect(mockCompletePurchase).toHaveBeenCalledWith(
        'pi_test_xyz',
        expect.objectContaining({
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
          amountPaidCents: 2999,
          currency: CURRENCY.GBP,
        })
      );

      // Verify success was logged
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Purchase completed successfully',
        expect.objectContaining({
          purchaseId: 'purchase_123',
          customerId: 'user_123',
          contentId: 'content_456',
        })
      );

      // Verify the services' pool was released
      expect(mockRelease).toHaveBeenCalledOnce();
    });

    // Codex-2hxff.2 review (H5): the sale time is the event's `created` (kept
    // on every redelivery), never the time the webhook happens to run.
    it("passes the event's created time as paidAt", async () => {
      const event = createMockStripeCheckoutEvent({
        eventId: 'evt_test_paid_at',
        sessionId: 'cs_test_paid_at',
        paymentIntentId: 'pi_test_paid_at',
        metadata: { customerId: 'user_123', contentId: 'content_456' },
      }) as unknown as Stripe.Event;
      const created = 1_760_000_000;
      (event as { created: number }).created = created;
      const { context } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        'pi_test_paid_at',
        expect.objectContaining({ paidAt: new Date(created * 1000) })
      );
    });

    // Codex-2hxff.64 Q1: the agreement resolves when the checkout STARTED, so
    // a checkout opened before a creator's removal completes at the old split.
    it.each([
      ['content', { customerId: 'user_123', contentId: 'content_456' }],
      ['course', { kind: 'course', customerId: 'user_123', courseId: 'c_1' }],
    ])("passes the %s session's own created time as offerAt, apart from paidAt", async (_kind, metadata) => {
      const event = createMockStripeCheckoutEvent({
        paymentIntentId: 'pi_test_offer_at',
        metadata,
      }) as unknown as Stripe.Event;
      const sessionCreated = 1_759_999_000;
      const paid = 1_760_000_000;
      (event as { created: number }).created = paid;
      (event.data.object as { created?: number }).created = sessionCreated;

      await handleCheckoutCompleted(event, mockStripe, createContext().context);

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        'pi_test_offer_at',
        expect.objectContaining({
          offerAt: new Date(sessionCreated * 1000),
          paidAt: new Date(paid * 1000),
        })
      );
    });

    it('should handle payment_intent as string', async () => {
      const event = createMockStripeCheckoutEvent({
        paymentIntentId: 'pi_string_123',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        'pi_string_123',
        expect.anything()
      );
    });
  });

  // Only a paid session completes a purchase (owner decision, Codex-2hxff.14).
  // A session completes `unpaid` when a delayed method is used: it is paid
  // later, if at all, so completing it now would grant what was not paid for.
  describe('payment status', () => {
    const metadata = {
      customerId: 'user_123',
      contentId: 'content_456',
      organizationId: 'org_789',
    };

    it('completes a paid session and marks its checkout completed', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_paid',
        paymentStatus: 'paid',
        metadata,
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).toHaveBeenCalled();
      expect(mockMarkCheckoutSessionCompleted).toHaveBeenCalledWith('cs_paid');
      expect(mock._obs.error).not.toHaveBeenCalled();
    });

    it.each([
      'unpaid',
      'no_payment_required',
    ])('skips a %s session: nothing is completed or marked', async (paymentStatus) => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_not_paid',
        paymentStatus,
        metadata,
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).not.toHaveBeenCalled();
      expect(mockMarkCheckoutSessionCompleted).not.toHaveBeenCalled();
      expect(mock._obs.error).toHaveBeenCalledWith(
        'Skipping unpaid checkout session',
        expect.objectContaining({ sessionId: 'cs_not_paid', paymentStatus })
      );
    });

    it('a failure to record the session paid is logged, not thrown: the purchase stands and the receipt still goes', async () => {
      mockMarkCheckoutSessionCompleted.mockRejectedValueOnce(
        new Error('connection reset')
      );
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_mark_fails',
        paymentStatus: 'paid',
        metadata,
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      await expect(
        handleCheckoutCompleted(event, mockStripe, context)
      ).resolves.toBeUndefined();

      expect(mockCompletePurchase).toHaveBeenCalled();
      expect(mock._obs.error).toHaveBeenCalledWith(
        'Paid checkout session could not be marked completed',
        expect.objectContaining({ sessionId: 'cs_mark_fails' })
      );
      // The handler carries on to the library bump and the receipt.
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Purchase completed successfully',
        expect.anything()
      );
    });

    it('a duplicate payment sends no receipt and bumps no library: its refund email says why', async () => {
      mockCompletePurchase.mockResolvedValueOnce({
        id: 'purchase_dup',
        customerId: 'user_123',
        contentId: 'content_456',
        status: 'refunded',
        duplicateOfPurchaseId: 'purchase_first',
      });
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_dup',
        paymentStatus: 'paid',
        metadata,
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();
      const executionCtx = attachExecutionCtx(mock);

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockMarkCheckoutSessionCompleted).toHaveBeenCalledWith('cs_dup');
      expect(executionCtx.waitUntil).not.toHaveBeenCalled();
      expect(mock._obs.warn).toHaveBeenCalledWith(
        'Duplicate payment refunded instead of completed',
        expect.objectContaining({ purchaseId: 'purchase_dup' })
      );
      expect(mock._obs.info).not.toHaveBeenCalledWith(
        'Purchase completed successfully',
        expect.anything()
      );
    });
  });

  describe('payment intent validation', () => {
    it('should log error and return early if payment_intent is missing', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_test_abc',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      // Remove payment_intent from the session
      (event.data.object as Stripe.Checkout.Session).payment_intent =
        null as unknown as string;

      const { context, mock } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Missing payment intent ID',
        expect.objectContaining({ sessionId: 'cs_test_abc' })
      );
      expect(mockCompletePurchase).not.toHaveBeenCalled();
    });
  });

  describe('metadata validation', () => {
    it('should log error for missing customerId in metadata', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_test_abc',
        metadata: {
          contentId: 'content_456',
          // Missing customerId - will cause validation to fail
        } as Record<string, string>,
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      // Make schema throw for missing customerId
      (
        checkoutSessionMetadataSchema.parse as ReturnType<typeof vi.fn>
      ).mockImplementationOnce(() => {
        throw new Error('Missing customerId');
      });

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Invalid checkout session metadata',
        expect.objectContaining({
          sessionId: 'cs_test_abc',
        })
      );
      expect(mockCompletePurchase).not.toHaveBeenCalled();
    });

    it('should log error for missing contentId in metadata', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_test_abc',
        metadata: {
          customerId: 'user_123',
          // Missing contentId
        } as Record<string, string>,
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      (
        checkoutSessionMetadataSchema.parse as ReturnType<typeof vi.fn>
      ).mockImplementationOnce(() => {
        throw new Error('Missing contentId');
      });

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Invalid checkout session metadata',
        expect.anything()
      );
      expect(mockCompletePurchase).not.toHaveBeenCalled();
    });

    it('should handle null organizationId gracefully', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          // No organizationId
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext();

      (
        checkoutSessionMetadataSchema.parse as ReturnType<typeof vi.fn>
      ).mockReturnValueOnce({
        customerId: 'user_123',
        contentId: 'content_456',
        organizationId: null,
      });

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: null,
        })
      );
    });
  });

  describe('amount validation', () => {
    it('should log error for invalid amount_total', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_test_abc',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      // Set invalid amount
      (event.data.object as Stripe.Checkout.Session).amount_total = null;

      const { context, mock } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        'Invalid amount_total',
        expect.objectContaining({ sessionId: 'cs_test_abc' })
      );
      expect(mockCompletePurchase).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    /**
     * Error contract (post-Wave 2-3 hardening):
     *
     * The handler intentionally lets PurchaseService errors propagate so the
     * outer createWebhookHandler() wrapper can classify them as transient
     * (return 500 → Stripe retries) vs permanent (return 200 → acknowledge).
     * See workers/ecom-api/src/utils/webhook-handler.ts and
     * workers/ecom-api/src/utils/error-classification.ts.
     *
     * The handler MUST still run release() on the error path via its
     * try { ... } finally { release(); } block — DB connection leaks
     * on errors are a real safety regression under load.
     */

    it('should rethrow PurchaseService errors so the wrapper can classify them', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext();

      const dbError = new Error('Database connection failed');
      mockCompletePurchase.mockRejectedValueOnce(dbError);

      // Handler MUST surface the error to createWebhookHandler so it can
      // decide whether to return 500 (transient → retry) or 200 (permanent).
      await expect(
        handleCheckoutCompleted(event, mockStripe, context)
      ).rejects.toThrow('Database connection failed');
    });

    it('should always cleanup database connection even on error', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext();

      mockCompletePurchase.mockRejectedValueOnce(new Error('Test error'));

      // Release runs in a `finally` block — assert it fired even though
      // the handler rethrew the underlying error.
      await expect(
        handleCheckoutCompleted(event, mockStripe, context)
      ).rejects.toThrow('Test error');

      expect(mockRelease).toHaveBeenCalledOnce();
    });

    it('should preserve error type and message for the wrapper to log', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_specific_session',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext();

      const testError = new Error('Specific failure reason');
      testError.name = 'PaymentProcessingError';
      mockCompletePurchase.mockRejectedValueOnce(testError);

      // Error must propagate intact (name + message) so the wrapper's
      // classification + log output retains full context.
      await expect(
        handleCheckoutCompleted(event, mockStripe, context)
      ).rejects.toMatchObject({
        name: 'PaymentProcessingError',
        message: 'Specific failure reason',
      });
    });
  });

  describe('idempotency', () => {
    it('should handle duplicate events gracefully via PurchaseService idempotency', async () => {
      const event = createMockStripeCheckoutEvent({
        paymentIntentId: 'pi_duplicate_123',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      // First call returns new purchase
      mockCompletePurchase.mockResolvedValueOnce({
        id: 'purchase_123',
        customerId: 'user_123',
        contentId: 'content_456',
      });

      await handleCheckoutCompleted(event, mockStripe, context);

      // Second call with same event returns existing purchase (idempotent)
      mockCompletePurchase.mockResolvedValueOnce({
        id: 'purchase_123', // Same ID
        customerId: 'user_123',
        contentId: 'content_456',
      });

      const { context: context2, mock: mock2 } = createContext();
      await handleCheckoutCompleted(event, mockStripe, context2);

      // Both should succeed without error
      expect(mock._obs.error).not.toHaveBeenCalled();
      expect(mock2._obs.error).not.toHaveBeenCalled();

      // Both should log success
      expect(mock._obs.info).toHaveBeenCalledWith(
        'Purchase completed successfully',
        expect.anything()
      );
      expect(mock2._obs.info).toHaveBeenCalledWith(
        'Purchase completed successfully',
        expect.anything()
      );
    });
  });

  describe('logging', () => {
    it('should log processing start with event details', async () => {
      const event = createMockStripeCheckoutEvent({
        sessionId: 'cs_log_test',
        paymentIntentId: 'pi_log_test',
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mock._obs.info).toHaveBeenCalledWith(
        'Processing checkout.session.completed',
        expect.objectContaining({
          sessionId: 'cs_log_test',
          paymentIntentId: 'pi_log_test',
        })
      );
    });
  });

  // Codex-2hxff.54: the handler no longer builds its DB client or
  // PurchaseService; the registry does, from the bindings and Stripe client
  // the handler passes to createWebhookServices. These assert that hand-off.
  describe('service initialization', () => {
    it('should pass the database bindings to createWebhookServices', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext({
        DATABASE_URL: 'postgresql://custom-test-url',
        DB_METHOD: 'PRODUCTION',
      });

      await handleCheckoutCompleted(event, mockStripe, context);

      // The per-request DB client is now built by the registry from these.
      expect(createWebhookServices).toHaveBeenCalledWith(
        expect.objectContaining({
          DATABASE_URL: 'postgresql://custom-test-url',
          DB_METHOD: 'PRODUCTION',
        }),
        context.executionCtx,
        expect.anything()
      );
    });

    it("should complete the purchase on the registry's PurchaseService", async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context } = createContext({
        ENVIRONMENT: 'production',
      });

      await handleCheckoutCompleted(event, mockStripe, context);

      // db + environment are now the registry's to wire; the handler hands
      // it the bindings (ENVIRONMENT included) and uses `services.purchase`.
      expect(createWebhookServices).toHaveBeenCalledWith(
        expect.objectContaining({ ENVIRONMENT: 'production' }),
        context.executionCtx,
        expect.anything()
      );
      expect(mockCompletePurchase).toHaveBeenCalledOnce();
    });

    it('should pass stripe client to createWebhookServices', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext();
      const executionCtx = attachExecutionCtx(mock);

      await handleCheckoutCompleted(event, mockStripe, context);

      // The webhook's verified Stripe client and the request's own
      // executionCtx (release() schedules pool cleanup on it).
      expect(createWebhookServices).toHaveBeenCalledWith(
        context.env,
        executionCtx,
        expect.objectContaining({ obs: mock._obs, stripe: mockStripe })
      );
    });

    it('should leave the environment default to the registry', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      const { context, mock } = createContext({
        ENVIRONMENT: undefined,
      });
      const executionCtx = attachExecutionCtx(mock);

      await handleCheckoutCompleted(event, mockStripe, context);

      // The 'development' default moved into the registry's getEnvironment().
      expect(createWebhookServices).toHaveBeenCalledWith(
        context.env,
        executionCtx,
        expect.objectContaining({ stripe: mockStripe })
      );
      const [env] = vi.mocked(createWebhookServices).mock.calls[0] ?? [];
      expect(env?.ENVIRONMENT).toBeUndefined();
    });
  });

  describe('currency handling', () => {
    /**
     * Platform default currency is GBP (see root CLAUDE.md "Currency" rule).
     * The handler hardcodes `CURRENCY.GBP` when calling `completePurchase`,
     * ignoring `session.currency`. This is intentional for the single-currency
     * MVP — Stripe Checkout sessions are created with GBP upstream.
     *
     * If multi-currency support is added later, the handler must read
     * `session.currency` and these tests must be updated together.
     */
    it('passes GBP through to completePurchase for a GBP session', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      (event.data.object as Stripe.Checkout.Session).currency = 'gbp';

      const { context } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          currency: CURRENCY.GBP,
        })
      );
    });

    it('still records GBP even when session.currency drifts (defends platform default)', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          customerId: 'user_123',
          contentId: 'content_456',
          organizationId: 'org_789',
        },
      }) as unknown as Stripe.Event;
      // Defence-in-depth: even if a session leaks through with a non-GBP
      // currency, the handler must persist GBP until multi-currency lands.
      (event.data.object as Stripe.Checkout.Session).currency = 'eur';

      const { context } = createContext();

      await handleCheckoutCompleted(event, mockStripe, context);

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          currency: CURRENCY.GBP,
        })
      );
      expect(mockCompletePurchase).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currency: 'usd' })
      );
      expect(mockCompletePurchase).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ currency: 'eur' })
      );
    });
  });

  // Codex-2hxff.11 (PAY-08): the charge id from the PaymentIntent is what
  // every payout slice is paid from. A TEMPORARY lookup failure used to be
  // logged and skipped, so the sale completed with no slices at all; it now
  // rejects, and createWebhookHandler answers 500 so Stripe retries.
  describe('the PaymentIntent lookup fails', () => {
    const outage = () =>
      Object.assign(new Error('Connection to Stripe failed'), {
        type: 'StripeConnectionError',
      });
    const missing = () =>
      Object.assign(new Error('No such payment_intent'), {
        type: 'StripeInvalidRequestError',
        statusCode: 404,
      });
    const stripeWhoseLookup = (error: Error) =>
      ({
        paymentIntents: { retrieve: vi.fn().mockRejectedValue(error) },
      }) as unknown as Stripe;

    it('temporarily (content) → rejects; the purchase is NOT completed without its charge', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: { customerId: 'user_123', contentId: 'content_456' },
      }) as unknown as Stripe.Event;

      await expect(
        handleCheckoutCompleted(
          event,
          stripeWhoseLookup(outage()),
          createContext().context
        )
      ).rejects.toThrow('Connection to Stripe failed');
      expect(mockCompletePurchase).not.toHaveBeenCalled();
    });

    it('temporarily (course) → rejects; the purchase is NOT completed without its charge', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: {
          kind: 'course',
          customerId: 'user_123',
          courseId: 'course_456',
        },
      }) as unknown as Stripe.Event;

      await expect(
        handleCheckoutCompleted(
          event,
          stripeWhoseLookup(outage()),
          createContext().context
        )
      ).rejects.toThrow('Connection to Stripe failed');
      expect(mockCompletePurchase).not.toHaveBeenCalled();
    });

    it('permanently → the purchase still completes (the buyer paid), with no charge id', async () => {
      const event = createMockStripeCheckoutEvent({
        metadata: { customerId: 'user_123', contentId: 'content_456' },
      }) as unknown as Stripe.Event;

      await handleCheckoutCompleted(
        event,
        stripeWhoseLookup(missing()),
        createContext().context
      );

      expect(mockCompletePurchase).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ stripeChargeId: null })
      );
    });
  });
});
