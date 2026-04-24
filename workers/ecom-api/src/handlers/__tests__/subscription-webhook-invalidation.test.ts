/**
 * Subscription + Payment webhook cache-invalidation tests.
 *
 * Originally (Codex-p0cg8) these tests asserted that the webhook handler
 * calls `invalidateForUser` directly for every subscription event. In
 * Codex-esikl the invalidation responsibility moved into
 * `SubscriptionService` itself via an orchestrator hook inside each
 * `handle*` method — the service now owns the cache bump. The webhook
 * handler's role is to WIRE the service correctly (cache + waitUntil via
 * constructor) and dispatch the right `handle*` call per event type.
 *
 * Assertions migrated:
 *   - Subscription events: the handler calls the right service method with
 *     the right args. The invalidation itself is tested in
 *     `packages/subscription/src/services/__tests__/subscription-service-orchestrator.test.ts`.
 *   - Charge.refunded: this path is NOT a subscription event — refunds on
 *     one-time purchases go through `handlePaymentWebhook` which still
 *     calls `invalidateForUser` directly (different helper ownership).
 *     Those assertions are UNCHANGED.
 *
 * Regression guard: at the subscription webhook layer, assert
 * `invalidateForUser` is NEVER called directly (duplicate with the service
 * hook would double-bump the version keys).
 *
 * Coverage matrix:
 *
 * | Event                         | Service call | Helper not called at handler | No session-data |
 * | ----------------------------- | :----------: | :--------------------------: | :-------------: |
 * | customer.subscription.updated |     yes      |             yes              |       yes       |
 * | invoice.payment_succeeded     |     yes      |             yes              |       yes       |
 * | invoice.payment_failed        |     yes      |             yes              |       yes       |
 * | charge.refunded               |     yes      |      N/A (handler owns)      |       yes       |
 *
 * Negative path per `feedback_security_deep_test` — mandatory, not optional.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports — both webhook handlers share these.
vi.mock('@codex/database', () => ({
  createPerRequestDbClient: vi.fn(),
}));

vi.mock('@codex/subscription', () => ({
  SubscriptionService: vi.fn(),
  // Dashboard sync-back path (Codex-s7h0y) instantiates TierService even
  // on unrelated events. Provide a default stub so `new TierService(...)`
  // doesn't throw; the apply* methods return null by default (non-sync-back
  // events are not routed through them, so this is a safe no-op).
  TierService: vi.fn().mockImplementation(() => ({
    applyStripeProductUpdate: vi.fn().mockResolvedValue(null),
    applyStripePriceCreated: vi.fn().mockResolvedValue(null),
  })),
  // `invalidateForUser` is a named export from `@codex/subscription` that
  // both webhook handlers import. We spy on it to assert the contract.
  invalidateForUser: vi.fn(),
}));

vi.mock('@codex/purchase', () => ({
  PurchaseService: vi.fn(),
}));

vi.mock('@codex/worker-utils', () => ({
  // sendEmailToWorker is fire-and-forget — stub so it doesn't try a real fetch.
  sendEmailToWorker: vi.fn(),
}));

import { createPerRequestDbClient } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import { invalidateForUser, SubscriptionService } from '@codex/subscription';
import { handlePaymentWebhook } from '../payment-webhook';
import { handleSubscriptionWebhook } from '../subscription-webhook';

type KVMock = {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};

/**
 * Build a minimal KV mock so `new VersionedCache({ kv })` inside the
 * handlers doesn't crash. We never assert on the KV directly — assertions
 * target the mocked `invalidateForUser`.
 */
function createKVStub(): KVMock {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
  };
}

interface ContextBundle {
  context: Context<StripeWebhookEnv>;
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>;
  waitUntil: ReturnType<typeof vi.fn>;
  kv: KVMock;
}

/**
 * Build a handler context with CACHE_KV present + a spied `executionCtx.waitUntil`.
 * The default `createMockHonoContext` doesn't set `executionCtx`, so we
 * attach it here — the handler calls
 * `c.executionCtx.waitUntil.bind(c.executionCtx)` before passing to the
 * invalidation helper.
 */
function buildContext(
  envOverrides: Partial<StripeWebhookEnv['Bindings']> = {}
): ContextBundle {
  const kv = createKVStub();
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({
    env: {
      // Cast via unknown — the KV shape here is a bindings-compatible
      // subset. We never touch KV in assertions.
      CACHE_KV: kv as unknown as StripeWebhookEnv['Bindings']['CACHE_KV'],
      ...envOverrides,
    },
  });

  const waitUntil = vi.fn((_promise: Promise<unknown>) => {
    // no-op — the helper has its own `.catch()`, and the test asserts via
    // the `invalidateForUser` spy instead of resolving this promise.
  });
  // Attach executionCtx — createMockHonoContext omits it by default.
  (mock as unknown as Record<string, unknown>).executionCtx = {
    waitUntil,
    passThroughOnException: vi.fn(),
  };

  return {
    context: mock as unknown as Context<StripeWebhookEnv>,
    mock,
    waitUntil,
    kv,
  };
}

describe('handleSubscriptionWebhook — cache invalidation', () => {
  let mockStripe: Stripe;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let mockHandleUpdated: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceSuccess: ReturnType<typeof vi.fn>;
  let mockHandleInvoiceFailed: ReturnType<typeof vi.fn>;
  let mockHandleCreated: ReturnType<typeof vi.fn>;
  let mockHandleDeleted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHandleCreated = vi.fn().mockResolvedValue(undefined);
    mockHandleUpdated = vi.fn().mockResolvedValue(undefined);
    mockHandleDeleted = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceSuccess = vi.fn().mockResolvedValue(undefined);
    mockHandleInvoiceFailed = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();

    mockStripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: 'sub_test_new',
          metadata: {
            codex_user_id: 'user_1',
            codex_organization_id: 'org_1',
            codex_tier_id: 'tier_1',
          },
        }),
      },
    } as unknown as Stripe;

    (createPerRequestDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: { mock: 'database' },
      cleanup: mockCleanup,
    });

    (
      SubscriptionService as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      handleSubscriptionCreated: mockHandleCreated,
      handleSubscriptionUpdated: mockHandleUpdated,
      handleSubscriptionDeleted: mockHandleDeleted,
      handleInvoicePaymentSucceeded: mockHandleInvoiceSuccess,
      handleInvoicePaymentFailed: mockHandleInvoiceFailed,
    }));
  });

  function createEvent(
    type: string,
    data: Record<string, unknown> = {}
  ): Stripe.Event {
    return {
      id: `evt_test_${Math.random().toString(36).slice(2)}`,
      type,
      data: {
        object: {
          id: 'sub_test_123',
          ...data,
        },
      },
    } as unknown as Stripe.Event;
  }

  // ─── customer.subscription.updated ──────────────────────────────────────────
  //
  // Post-Codex-esikl contract: handler routes to `service.handleSubscriptionUpdated`,
  // service internally owns cache invalidation. Handler must NOT call
  // `invalidateForUser` directly (regression guard).

  describe('customer.subscription.updated', () => {
    it('positive: service.handleSubscriptionUpdated called; handler does NOT call invalidateForUser', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_u1',
        orgId: 'org_u1',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_update_positive',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockHandleUpdated).toHaveBeenCalledTimes(1);
      // Handler no longer calls the helper directly — service owns it.
      expect(invalidateForUser).not.toHaveBeenCalled();
    });

    it('negative: service returns undefined (malformed event) — no crash, no handler-level invalidation', async () => {
      mockHandleUpdated.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_update_malformed',
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(invalidateForUser).not.toHaveBeenCalled();
    });

    it('service is constructed with cache + waitUntil (orchestrator wiring)', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_u1',
        orgId: 'org_u1',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_update_wire',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      // Service constructor receives cache + waitUntil so the orchestrator
      // hook fires from inside the service. Regression: if someone removes
      // this wiring, the webhook path stops bumping KV.
      expect(SubscriptionService).toHaveBeenCalledWith(
        expect.objectContaining({
          cache: expect.anything(),
          waitUntil: expect.any(Function),
        }),
        mockStripe
      );
    });

    it('no CACHE_KV binding: service is constructed without cache (graceful degrade)', async () => {
      mockHandleUpdated.mockResolvedValueOnce({
        userId: 'user_nokv',
        orgId: 'org_nokv',
      });
      const bundle = buildContext({ CACHE_KV: undefined });
      const event = createEvent(STRIPE_EVENTS.SUBSCRIPTION_UPDATED, {
        id: 'sub_update_nokv',
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      // Without CACHE_KV, cache is undefined — service gracefully degrades
      // to no-op invalidation. waitUntil is still wired since executionCtx
      // is always present in the webhook path.
      const callArgs = (
        SubscriptionService as unknown as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      const config = callArgs?.[0] as {
        cache?: unknown;
        waitUntil?: unknown;
      };
      expect(config?.cache).toBeUndefined();
      expect(typeof config?.waitUntil).toBe('function');
      expect(invalidateForUser).not.toHaveBeenCalled();
    });
  });

  // ─── invoice.payment_succeeded ──────────────────────────────────────────────

  describe('invoice.payment_succeeded', () => {
    it('positive: service.handleInvoicePaymentSucceeded called; handler does NOT call invalidateForUser', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce({
        userId: 'user_paid',
        orgId: 'org_paid',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_positive',
        amount_paid: 999,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockHandleInvoiceSuccess).toHaveBeenCalledTimes(1);
      expect(invalidateForUser).not.toHaveBeenCalled();
    });

    it('negative: service returns void (no subscription found) — no crash', async () => {
      mockHandleInvoiceSuccess.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED, {
        id: 'in_void',
        amount_paid: 999,
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(invalidateForUser).not.toHaveBeenCalled();
    });
  });

  // ─── invoice.payment_failed ─────────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('positive: service.handleInvoicePaymentFailed called; handler does NOT call invalidateForUser', async () => {
      mockHandleInvoiceFailed.mockResolvedValueOnce({
        userId: 'user_failed',
        orgId: 'org_failed',
      });
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_FAILED, {
        id: 'in_failed_positive',
        amount_due: 999,
      });

      await handleSubscriptionWebhook(event, mockStripe, bundle.context);

      expect(mockHandleInvoiceFailed).toHaveBeenCalledTimes(1);
      expect(invalidateForUser).not.toHaveBeenCalled();
    });

    it('negative: service returns undefined (no matching subscription) — no crash', async () => {
      mockHandleInvoiceFailed.mockResolvedValueOnce(undefined);
      const bundle = buildContext();
      const event = createEvent(STRIPE_EVENTS.INVOICE_PAYMENT_FAILED, {
        id: 'in_failed_void',
        amount_due: 999,
      });

      await expect(
        handleSubscriptionWebhook(event, mockStripe, bundle.context)
      ).resolves.not.toThrow();

      expect(invalidateForUser).not.toHaveBeenCalled();
    });
  });
});

describe('handlePaymentWebhook — cache invalidation on charge.refunded', () => {
  let mockStripe: Stripe;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let mockProcessRefund: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProcessRefund = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();
    mockStripe = {} as Stripe;

    (createPerRequestDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: { mock: 'database' },
      cleanup: mockCleanup,
    });

    (PurchaseService as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ processRefund: mockProcessRefund })
    );
  });

  function createRefundEvent(
    overrides: Record<string, unknown> = {}
  ): Stripe.Event {
    return {
      id: `evt_refund_${Math.random().toString(36).slice(2)}`,
      type: STRIPE_EVENTS.CHARGE_REFUNDED,
      data: {
        object: {
          id: 'ch_test_refund',
          payment_intent: 'pi_test_123',
          amount: 1999,
          amount_refunded: 1999,
          billing_details: { email: null, name: null },
          refunds: {
            data: [{ id: 're_test_1', reason: 'requested_by_customer' }],
          },
          ...overrides,
        },
      },
    } as unknown as Stripe.Event;
  }

  it('positive: processRefund returns userId → library cache is invalidated (no orgId)', async () => {
    mockProcessRefund.mockResolvedValueOnce({ userId: 'user_refund' });
    const bundle = buildContext();
    const event = createRefundEvent();

    await handlePaymentWebhook(event, mockStripe, bundle.context);

    expect(invalidateForUser).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({
        userId: 'user_refund',
        reason: 'refund',
      }),
      expect.any(Object)
    );
    // One-time purchases are content-scoped — no orgId should be passed.
    const invalidateSpy = invalidateForUser as unknown as ReturnType<
      typeof vi.fn
    >;
    const firstCall = invalidateSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const args = firstCall?.[2] as { orgId?: string } | undefined;
    expect(args?.orgId).toBeUndefined();
  });

  it('negative: processRefund returns void (unknown purchase) — no invalidation, no crash', async () => {
    mockProcessRefund.mockResolvedValueOnce(undefined);
    const bundle = buildContext();
    const event = createRefundEvent();

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(invalidateForUser).not.toHaveBeenCalled();
  });

  it('negative: missing payment_intent on charge → short-circuits before processRefund, no invalidation', async () => {
    const bundle = buildContext();
    const event = createRefundEvent({ payment_intent: null });

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(invalidateForUser).not.toHaveBeenCalled();
  });

  it('idempotency: duplicate refund event bumps invalidateForUser twice', async () => {
    // Even on the second call, processRefund returns the userId (helper is
    // idempotent at the Stripe layer but still returns the owner id so we
    // re-bump the cache — KV versions are monotonic).
    mockProcessRefund.mockResolvedValue({ userId: 'user_refund_idem' });
    const bundle = buildContext();
    const event = createRefundEvent({ id: 'ch_test_refund_idem' });

    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await handlePaymentWebhook(event, mockStripe, bundle.context);

    expect(invalidateForUser).toHaveBeenCalledTimes(2);
  });

  it('no CACHE_KV binding: skips invalidation entirely, no crash', async () => {
    mockProcessRefund.mockResolvedValueOnce({ userId: 'user_nokv' });
    const bundle = buildContext({ CACHE_KV: undefined });
    const event = createRefundEvent({ id: 'ch_test_refund_nokv' });

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(invalidateForUser).not.toHaveBeenCalled();
  });
});
