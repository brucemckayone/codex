/**
 * Payment webhook — `charge.dispute.created` handler integration tests
 * (Codex-sxu5a).
 *
 * The handler sits alongside `charge.refunded` and mirrors its contract:
 *   1. call `PurchaseService.processDispute(paymentIntentId, …)`
 *   2. on success: bump COLLECTION_USER_LIBRARY via `invalidateForUser`
 *   3. on success: write `AccessRevocation.revoke(userId, orgId, 'refund')`
 *   4. do nothing when the purchase is unknown or CACHE_KV is absent
 *
 * Strategy: mock `@codex/purchase`, `@codex/subscription`
 * (`invalidateForUser`), and `@codex/access` (`AccessRevocation`). Assert
 * on the spies — the actual DB / KV semantics are covered by unit tests
 * (purchase-service.test.ts) and the access-revocation unit tests.
 *
 * Coverage matrix (per feedback_security_deep_test — positive + negative + idempotent):
 *
 * | Scenario                                                   | processDispute | invalidateForUser | AccessRevocation.revoke |
 * | ---------------------------------------------------------- | :------------: | :---------------: | :---------------------: |
 * | positive: known purchase → scope returned                  |      yes       |        yes        |           yes           |
 * | negative: unknown charge (processDispute returns void)     |      yes       |        no         |           no            |
 * | negative: no CACHE_KV binding → service still runs, no KV  |      yes       |        no         |           no            |
 * | negative: missing payment_intent on dispute → no service   |      no        |        no         |           no            |
 * | idempotent: fire the same event twice → monotonic behaviour|   yes x 2      |       yes x 2     |         yes x 2         |
 * | fire-and-forget: KV revoke rejection does NOT surface      |      yes       |        yes        |           yes           |
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports.
vi.mock('@codex/database', () => ({
  createPerRequestDbClient: vi.fn(),
}));

vi.mock('@codex/subscription', () => ({
  invalidateForUser: vi.fn(),
}));

vi.mock('@codex/purchase', () => ({
  PurchaseService: vi.fn(),
}));

// `createWebhookDbClient` must remain a real export — it forwards to the
// (mocked) `createPerRequestDbClient`, so use importOriginal + spread.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    sendEmailToWorker: vi.fn(),
  };
});

const mockRevoke = vi.fn().mockResolvedValue(undefined);
const mockIsRevoked = vi.fn().mockResolvedValue(null);
const mockClear = vi.fn().mockResolvedValue(undefined);
vi.mock('@codex/access', () => ({
  AccessRevocation: vi.fn().mockImplementation(() => ({
    revoke: mockRevoke,
    isRevoked: mockIsRevoked,
    clear: mockClear,
  })),
}));

import { AccessRevocation } from '@codex/access';
import { createPerRequestDbClient } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import { invalidateForUser } from '@codex/subscription';
import { handlePaymentWebhook } from '../payment-webhook';

type KVMock = {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};

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
  waitUntilPromises: Array<Promise<unknown>>;
  kv: KVMock;
}

function buildContext(
  envOverrides: Partial<StripeWebhookEnv['Bindings']> = {}
): ContextBundle {
  const kv = createKVStub();
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({
    env: {
      CACHE_KV: kv as unknown as StripeWebhookEnv['Bindings']['CACHE_KV'],
      ...envOverrides,
    },
  });

  const waitUntilPromises: Array<Promise<unknown>> = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  });
  (mock as unknown as Record<string, unknown>).executionCtx = {
    waitUntil,
    passThroughOnException: vi.fn(),
  };

  return {
    context: mock as unknown as Context<StripeWebhookEnv>,
    mock,
    waitUntil,
    waitUntilPromises,
    kv,
  };
}

async function drainWaitUntil(bundle: ContextBundle): Promise<void> {
  await Promise.allSettled(bundle.waitUntilPromises);
}

/**
 * Build a `charge.dispute.created` Stripe event payload. Overrides let
 * individual tests tweak the dispute fields.
 */
function createDisputeEvent(
  overrides: Record<string, unknown> = {}
): Stripe.Event {
  return {
    id: `evt_dispute_${Math.random().toString(36).slice(2)}`,
    type: STRIPE_EVENTS.CHARGE_DISPUTE_CREATED,
    data: {
      object: {
        id: 'dp_test_dispute',
        object: 'dispute',
        charge: 'ch_test',
        payment_intent: 'pi_test_dispute',
        amount: 1999,
        currency: 'gbp',
        reason: 'fraudulent',
        status: 'needs_response',
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

describe('handlePaymentWebhook — charge.dispute.created', () => {
  let mockStripe: Stripe;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let mockProcessDispute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
    mockIsRevoked.mockReset();
    mockIsRevoked.mockResolvedValue(null);
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);

    mockProcessDispute = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();
    mockStripe = {} as Stripe;

    (createPerRequestDbClient as ReturnType<typeof vi.fn>).mockReturnValue({
      db: { mock: 'database' },
      cleanup: mockCleanup,
    });

    (PurchaseService as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({
        processDispute: mockProcessDispute,
        // processRefund is unused in these tests but included so the
        // handler's other branches don't crash if a test accidentally
        // fires a refund event.
        processRefund: vi.fn().mockResolvedValue(undefined),
      })
    );
  });

  it('positive: processDispute returns { userId, orgId } → service called, library cache bumped, revocation written with reason="refund"', async () => {
    mockProcessDispute.mockResolvedValueOnce({
      userId: 'user_disp',
      orgId: 'org_disp',
    });

    const bundle = buildContext();
    const event = createDisputeEvent();

    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    // Service called with PI + metadata
    expect(mockProcessDispute).toHaveBeenCalledTimes(1);
    expect(mockProcessDispute).toHaveBeenCalledWith('pi_test_dispute', {
      stripeDisputeId: 'dp_test_dispute',
      disputeReason: 'fraudulent',
    });

    // Library cache bumped via the shared helper
    expect(invalidateForUser).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).toHaveBeenCalledWith(
      expect.anything(), // VersionedCache instance
      expect.any(Function), // bound waitUntil
      expect.objectContaining({
        userId: 'user_disp',
        reason: 'refund',
      }),
      expect.anything()
    );

    // Revocation written — reason='refund' (disputes are observability-
    // classified as the same access-reducing event as refunds).
    expect(AccessRevocation).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith('user_disp', 'org_disp', 'refund');
  });

  it('negative: processDispute returns void (unknown charge) → no cache bump, no revocation, no crash', async () => {
    mockProcessDispute.mockResolvedValueOnce(undefined);
    const bundle = buildContext();
    const event = createDisputeEvent({ payment_intent: 'pi_unknown' });

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();
    await drainWaitUntil(bundle);

    expect(mockProcessDispute).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(AccessRevocation).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('negative: missing payment_intent on the dispute object → processDispute NOT called, no crash', async () => {
    const bundle = buildContext();
    // Stripe Dispute objects are usually tied to a charge, which is tied to
    // a PaymentIntent. In the rare case the PI link is missing we short-
    // circuit before touching the service or KV.
    const event = createDisputeEvent({ payment_intent: null });

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(mockProcessDispute).not.toHaveBeenCalled();
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('negative: no CACHE_KV binding → service still runs, but no cache / revocation side-effects', async () => {
    mockProcessDispute.mockResolvedValueOnce({
      userId: 'user_nokv',
      orgId: 'org_nokv',
    });
    const bundle = buildContext({ CACHE_KV: undefined });
    const event = createDisputeEvent();

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(mockProcessDispute).toHaveBeenCalledTimes(1);
    // Without KV we intentionally skip BOTH the library cache bump and the
    // AccessRevocation write (both require CACHE_KV to be bound).
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(AccessRevocation).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('idempotent: same dispute event fired twice → service called twice, cache bumped twice, revocation written twice (all monotonic)', async () => {
    // Stripe retries webhooks on transient failures and we cannot assume a
    // deduplication layer. Every side-effect in this handler must be safe
    // to re-run — see feedback_security_deep_test.
    mockProcessDispute.mockResolvedValue({
      userId: 'user_idem_disp',
      orgId: 'org_idem_disp',
    });

    const bundle = buildContext();
    const event = createDisputeEvent();

    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(mockProcessDispute).toHaveBeenCalledTimes(2);
    expect(invalidateForUser).toHaveBeenCalledTimes(2);
    expect(mockRevoke).toHaveBeenCalledTimes(2);
    // Both writes use the same (userId, orgId, reason) — KV overwrite is
    // semantically a no-op with a refreshed TTL (see REVOCATION_TTL_SECONDS).
    expect(mockRevoke).toHaveBeenNthCalledWith(
      1,
      'user_idem_disp',
      'org_idem_disp',
      'refund'
    );
    expect(mockRevoke).toHaveBeenNthCalledWith(
      2,
      'user_idem_disp',
      'org_idem_disp',
      'refund'
    );
  });

  it('fire-and-forget: AccessRevocation.revoke rejection does NOT surface, handler resolves', async () => {
    mockProcessDispute.mockResolvedValueOnce({
      userId: 'user_fire',
      orgId: 'org_fire',
    });
    mockRevoke.mockRejectedValueOnce(new Error('KV unreachable'));

    const bundle = buildContext();
    const event = createDisputeEvent();

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();
    await expect(drainWaitUntil(bundle)).resolves.not.toThrow();

    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  it('passes dispute.reason through to processDispute (metadata round-trip)', async () => {
    mockProcessDispute.mockResolvedValueOnce({
      userId: 'u',
      orgId: 'o',
    });
    const bundle = buildContext();
    const event = createDisputeEvent({
      id: 'dp_reason_check',
      reason: 'product_not_received',
    });

    await handlePaymentWebhook(event, mockStripe, bundle.context);

    expect(mockProcessDispute).toHaveBeenCalledWith('pi_test_dispute', {
      stripeDisputeId: 'dp_reason_check',
      disputeReason: 'product_not_received',
    });
  });
});
