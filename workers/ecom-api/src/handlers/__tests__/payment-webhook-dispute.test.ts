/**
 * Payment webhook — the dispute lifecycle (`charge.dispute.*`; Codex-sxu5a,
 * Codex-2hxff.9; design in docs/payments/dispute-record.md).
 *
 * Every event records the dispute (forward only), then acts on the status the
 * RECORD has, not the event's, because Stripe delivers out of order:
 *
 * | Recorded status            | Access                         | Money                                    |
 * | -------------------------- | ------------------------------ | ---------------------------------------- |
 * | inquiry (`warning_*`)      | kept                           | nothing; the open record holds payouts   |
 * | chargeback open            | paused (processDispute)        | both sources clawed back                 |
 * | won                        | restored                       | settleWonDispute (paid back)             |
 * | lost                       | purchase refunded              | both sources clawed back, then outcome   |
 * | inquiry closed             | —                              | outcome marked                           |
 * | prevented                  | —                              | outcome marked; alert if it clawed back  |
 *
 * Strategy: mock the webhook composition root (`createWebhookServices`),
 * `@codex/subscription` (`invalidateForUser`) and `@codex/access`
 * (`AccessRevocation`), and assert on the spies. The services' own behaviour is
 * covered by their integration suites.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { WebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

// Mock modules before imports.
vi.mock('@codex/subscription', () => ({
  invalidateForUser: vi.fn(),
}));

// The handler gets its PurchaseService and SubscriptionService from the
// webhook composition root (Codex-2hxff.54); mock that seam so each test
// hands over its own stubs. Every other export stays real.
vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    createWebhookServices: vi.fn(),
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
import { invalidateForUser } from '@codex/subscription';
import { createWebhookServices } from '@codex/worker-utils';
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

describe('handlePaymentWebhook — disputes', () => {
  let mockStripe: Stripe;
  let mockRetrieve: ReturnType<typeof vi.fn>;
  let mockRelease: ReturnType<typeof vi.fn>;
  let purchase: Record<string, ReturnType<typeof vi.fn>>;
  let subscription: Record<string, ReturnType<typeof vi.fn>>;
  let mockReverseSubscription: ReturnType<typeof vi.fn>;
  /** The order the handler's steps ran in. */
  let calls: string[];

  const charge = { id: 'ch_test', amountCents: 1999 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
    mockIsRevoked.mockReset();
    mockIsRevoked.mockResolvedValue(null);
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);

    mockRelease = vi.fn();
    mockRetrieve = vi.fn().mockResolvedValue({
      id: 'ch_test',
      amount: 1999,
      payment_intent: 'pi_test_dispute',
      metadata: {},
    });
    mockStripe = { charges: { retrieve: mockRetrieve } } as unknown as Stripe;
    calls = [];
    mockReverseSubscription = vi.fn().mockImplementation(async () => {
      calls.push('clawback');
    });
    subscription = {
      reverseSubscriptionPayoutsForCharge: mockReverseSubscription,
      // A purchase's dispute by default: no subscription to act on.
      pauseForDispute: vi.fn().mockImplementation(async () => {
        calls.push('pause');
        return undefined;
      }),
      pauseBillingForDispute: vi.fn().mockImplementation(async () => {
        calls.push('pauseBilling');
      }),
      restoreAfterDispute: vi.fn().mockImplementation(async () => {
        calls.push('restore');
        return undefined;
      }),
      cancelForLostDispute: vi.fn().mockImplementation(async () => {
        calls.push('cancel');
        return undefined;
      }),
    };
    purchase = {
      // The record echoes the event's status unless a test says otherwise.
      recordDispute: vi.fn().mockImplementation(async (d) => ({
        stripeDisputeId: d.stripeDisputeId,
        status: d.status,
        amountCents: d.amountCents,
        outcomeAppliedAt: null,
      })),
      processDispute: vi.fn().mockResolvedValue(undefined),
      clawBackPurchaseCharge: vi.fn().mockResolvedValue(undefined),
      restoreDisputedPurchase: vi.fn().mockResolvedValue(undefined),
      processLostDispute: vi.fn().mockResolvedValue(undefined),
      settleWonDispute: vi.fn().mockResolvedValue(undefined),
      markDisputeOutcomeApplied: vi.fn().mockResolvedValue(undefined),
      processRefund: vi.fn().mockResolvedValue(undefined),
    };

    // The registry's services, as the composition root hands them over.
    vi.mocked(createWebhookServices).mockResolvedValue({
      services: {
        purchase,
        subscription,
      } as unknown as WebhookServices['services'],
      background: (promise) => promise,
      release: mockRelease,
    });
  });

  function recordedAs(status: string, extra: Record<string, unknown> = {}) {
    purchase.recordDispute?.mockResolvedValueOnce({
      stripeDisputeId: 'dp_test_dispute',
      status,
      amountCents: 1999,
      outcomeAppliedAt: null,
      ...extra,
    });
  }

  it('records the dispute from the event and its charge', async () => {
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent({ created: 1_790_000_000 }),
      mockStripe,
      bundle.context
    );

    expect(mockRetrieve).toHaveBeenCalledWith('ch_test');
    expect(purchase.recordDispute).toHaveBeenCalledWith({
      stripeDisputeId: 'dp_test_dispute',
      stripeChargeId: 'ch_test',
      paymentIntentId: 'pi_test_dispute',
      amountCents: 1999,
      currency: 'gbp',
      status: 'needs_response',
      reason: 'fraudulent',
      stripeCreatedAt: new Date(1_790_000_000 * 1000),
    });
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('a chargeback opens: access paused (library bumped, revocation written) and both sources clawed back', async () => {
    purchase.processDispute?.mockResolvedValueOnce({
      userId: 'user_disp',
      orgId: 'org_disp',
      accessEnded: true,
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(purchase.processDispute).toHaveBeenCalledWith('pi_test_dispute', {
      stripeDisputeId: 'dp_test_dispute',
      disputeReason: 'fraudulent',
    });
    expect(invalidateForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ userId: 'user_disp', reason: 'refund' }),
      expect.anything()
    );
    expect(mockRevoke).toHaveBeenCalledWith('user_disp', 'org_disp', 'refund');
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
    expect(purchase.clawBackPurchaseCharge).toHaveBeenCalledWith(
      'pi_test_dispute',
      charge
    );
    expect(purchase.markDisputeOutcomeApplied).not.toHaveBeenCalled();
  });

  it('a chargeback on an item the buyer keeps (a duplicate payment) bumps the library but writes no org-wide block (Codex-2hxff.14)', async () => {
    purchase.processDispute?.mockResolvedValueOnce({
      userId: 'user_kept',
      orgId: 'org_kept',
      accessEnded: false,
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(invalidateForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ userId: 'user_kept' }),
      expect.anything()
    );
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('the RECORDED status is acted on: a stale "opened" event after the dispute was won takes the won path', async () => {
    recordedAs('won');
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );

    expect(purchase.processDispute).not.toHaveBeenCalled();
    expect(purchase.restoreDisputedPurchase).toHaveBeenCalledWith(
      'pi_test_dispute'
    );
    expect(purchase.settleWonDispute).toHaveBeenCalledWith('dp_test_dispute');
  });

  it('an inquiry is recorded and nothing else happens: access kept, nothing clawed back (owner decision Q1)', async () => {
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent({ status: 'warning_needs_response' }),
      mockStripe,
      bundle.context
    );

    expect(purchase.recordDispute).toHaveBeenCalledOnce();
    expect(purchase.processDispute).not.toHaveBeenCalled();
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(purchase.clawBackPurchaseCharge).not.toHaveBeenCalled();
    expect(purchase.markDisputeOutcomeApplied).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('an inquiry that closes is marked applied; its record releases the held payouts', async () => {
    const bundle = buildContext();

    await handlePaymentWebhook(
      {
        ...createDisputeEvent({ status: 'warning_closed' }),
        type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
      } as Stripe.Event,
      mockStripe,
      bundle.context
    );

    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledWith(
      'dp_test_dispute'
    );
    expect(mockReverseSubscription).not.toHaveBeenCalled();
  });

  it('won: access restored, the clawback paid back, nothing clawed again', async () => {
    purchase.restoreDisputedPurchase?.mockResolvedValueOnce({
      userId: 'user_won',
      orgId: 'org_won',
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      {
        ...createDisputeEvent({ status: 'won' }),
        type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
      } as Stripe.Event,
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(purchase.restoreDisputedPurchase).toHaveBeenCalledWith(
      'pi_test_dispute'
    );
    expect(invalidateForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ userId: 'user_won' }),
      expect.anything()
    );
    expect(purchase.settleWonDispute).toHaveBeenCalledWith('dp_test_dispute');
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    // The streaming block the chargeback wrote is lifted.
    expect(mockClear).toHaveBeenCalledWith('user_won', 'org_won');
  });

  it('won: a re-pay that rejects is rethrown for Stripe to redeliver, and the webhook marks no outcome itself', async () => {
    // `repayDispute` can reject with the clawback's error once it re-runs a
    // refund against the new re-pay rows; `settleWonDispute` marks the
    // outcome only after it succeeds.
    const failure = new Error('clawback after re-pay failed (test)');
    purchase.settleWonDispute?.mockRejectedValueOnce(failure);
    const bundle = buildContext();

    await expect(
      handlePaymentWebhook(
        {
          ...createDisputeEvent({ status: 'won' }),
          type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
        } as Stripe.Event,
        mockStripe,
        bundle.context
      )
    ).rejects.toBe(failure);

    expect(purchase.markDisputeOutcomeApplied).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('lost: the purchase is refunded, both sources clawed back (held slices cancelled), THEN the outcome marked', async () => {
    purchase.processLostDispute?.mockResolvedValueOnce({
      userId: 'user_lost',
      orgId: 'org_lost',
      accessEnded: true,
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      {
        ...createDisputeEvent({ status: 'lost' }),
        type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
      } as Stripe.Event,
      mockStripe,
      bundle.context
    );

    expect(purchase.processLostDispute).toHaveBeenCalledWith(
      'pi_test_dispute',
      1999
    );
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
    expect(purchase.clawBackPurchaseCharge).toHaveBeenCalledWith(
      'pi_test_dispute',
      charge
    );
    expect(
      purchase.markDisputeOutcomeApplied?.mock.invocationCallOrder[0]
    ).toBeGreaterThan(
      purchase.clawBackPurchaseCharge?.mock.invocationCallOrder[0] ?? Infinity
    );
    // A dispute that opened already lost never paused access: block it now.
    expect(mockRevoke).toHaveBeenCalledWith('user_lost', 'org_lost', 'refund');
  });

  it('an outcome already applied stops at the record: a redelivered won or lost does nothing more', async () => {
    recordedAs('lost', { outcomeAppliedAt: new Date() });
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent({ status: 'lost' }),
      mockStripe,
      bundle.context
    );

    expect(purchase.processLostDispute).not.toHaveBeenCalled();
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(purchase.markDisputeOutcomeApplied).not.toHaveBeenCalled();
  });

  it("a subscription invoice's chargeback (no purchase for the PaymentIntent) still claws back the subscription's slices", async () => {
    purchase.processDispute?.mockResolvedValueOnce(undefined);
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
  });

  it('no PaymentIntent on the charge or the dispute: no purchase step, the subscription source still runs', async () => {
    mockRetrieve.mockResolvedValueOnce({
      id: 'ch_test',
      amount: 1999,
      payment_intent: null,
      metadata: {},
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent({ payment_intent: null }),
      mockStripe,
      bundle.context
    );

    expect(purchase.processDispute).not.toHaveBeenCalled();
    expect(purchase.clawBackPurchaseCharge).not.toHaveBeenCalled();
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
  });

  it("another environment's charge is ignored and not recorded", async () => {
    mockRetrieve.mockResolvedValueOnce({
      id: 'ch_test',
      amount: 1999,
      payment_intent: 'pi_test_dispute',
      metadata: { codex_env: 'development' },
    });
    const bundle = buildContext({ ENVIRONMENT: 'production' });

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );

    expect(purchase.recordDispute).not.toHaveBeenCalled();
    expect(purchase.processDispute).not.toHaveBeenCalled();
  });

  it('a status the record does not know is recorded as nothing, and nothing happens', async () => {
    purchase.recordDispute?.mockResolvedValueOnce(undefined);
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );

    expect(purchase.processDispute).not.toHaveBeenCalled();
    expect(mockReverseSubscription).not.toHaveBeenCalled();
  });

  it.each([
    STRIPE_EVENTS.CHARGE_DISPUTE_CREATED,
    STRIPE_EVENTS.CHARGE_DISPUTE_UPDATED,
    STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
    STRIPE_EVENTS.CHARGE_DISPUTE_FUNDS_WITHDRAWN,
    STRIPE_EVENTS.CHARGE_DISPUTE_FUNDS_REINSTATED,
  ])('%s is handled: the dispute is recorded', async (type) => {
    const bundle = buildContext();

    await handlePaymentWebhook(
      { ...createDisputeEvent(), type } as Stripe.Event,
      mockStripe,
      bundle.context
    );

    expect(purchase.recordDispute).toHaveBeenCalledOnce();
  });

  it('no CACHE_KV binding: the services still run, with no cache or revocation side-effects', async () => {
    purchase.processDispute?.mockResolvedValueOnce({
      userId: 'user_nokv',
      orgId: 'org_nokv',
    });
    const bundle = buildContext({ CACHE_KV: undefined });

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );

    expect(purchase.processDispute).toHaveBeenCalledOnce();
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(AccessRevocation).not.toHaveBeenCalled();
  });

  it('fire-and-forget: an AccessRevocation.revoke rejection does NOT surface', async () => {
    purchase.processDispute?.mockResolvedValueOnce({
      userId: 'user_fire',
      orgId: 'org_fire',
      accessEnded: true,
    });
    mockRevoke.mockRejectedValueOnce(new Error('KV unreachable'));
    const bundle = buildContext();

    await expect(
      handlePaymentWebhook(createDisputeEvent(), mockStripe, bundle.context)
    ).resolves.not.toThrow();
    await expect(drainWaitUntil(bundle)).resolves.not.toThrow();
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  // ── a subscription invoice's dispute (docs/payments/subscription-disputes.md)

  const disputedSubscription = {
    kind: 'tier',
    id: 'sub_row',
    stripeSubscriptionId: 'sub_stripe',
    userId: 'user_sub',
    organizationId: 'org_sub',
    status: 'active',
  };
  const disputeInput = {
    stripeDisputeId: 'dp_test_dispute',
    chargeId: 'ch_test',
    paymentIntentId: 'pi_test_dispute',
  };

  it('a chargeback on a subscription invoice pauses its access first, and its billing only after the clawback', async () => {
    subscription.pauseForDispute?.mockImplementationOnce(async () => {
      calls.push('pause');
      return disputedSubscription;
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(subscription.pauseForDispute).toHaveBeenCalledWith(disputeInput);
    expect(mockRevoke).toHaveBeenCalledWith('user_sub', 'org_sub', 'refund');
    expect(subscription.pauseBillingForDispute).toHaveBeenCalledWith(
      disputedSubscription,
      'dp_test_dispute'
    );
    expect(calls).toEqual(['pause', 'clawback', 'pauseBilling']);
  });

  it.each([
    ['pausing the purchase', 'processDispute'],
    ['the clawback', 'clawBackPurchaseCharge'],
  ] as const)('a chargeback whose opening fails at %s is alerted at error with an errorId, then rethrown for Stripe to redeliver', async (_step, method) => {
    const failure = new Error('database unavailable (test)');
    purchase[method]?.mockRejectedValueOnce(failure);
    recordedAs('needs_response', {
      purchaseId: 'purchase_open',
      subscriptionId: null,
      courseSubscriptionId: null,
    });
    const bundle = buildContext();

    await expect(
      handlePaymentWebhook(createDisputeEvent(), mockStripe, bundle.context)
    ).rejects.toBe(failure);

    expect(bundle.mock._obs.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'A chargeback was recorded but opening it failed'
      ),
      {
        errorId: expect.any(String),
        disputeId: 'dp_test_dispute',
        chargeId: 'ch_test',
        purchaseId: 'purchase_open',
        subscriptionId: null,
        courseSubscriptionId: null,
        error: 'database unavailable (test)',
      }
    );
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('a chargeback whose subscription billing pause fails at Stripe is alerted and rethrown, after its access pause and clawback', async () => {
    subscription.pauseForDispute?.mockImplementationOnce(async () => {
      calls.push('pause');
      return disputedSubscription;
    });
    const refused = new Error('No such subscription (test)');
    subscription.pauseBillingForDispute?.mockRejectedValueOnce(refused);
    const bundle = buildContext();

    await expect(
      handlePaymentWebhook(createDisputeEvent(), mockStripe, bundle.context)
    ).rejects.toBe(refused);

    expect(calls).toEqual(['pause', 'clawback']);
    expect(bundle.mock._obs.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'A chargeback was recorded but opening it failed'
      ),
      expect.objectContaining({
        errorId: expect.any(String),
        disputeId: 'dp_test_dispute',
        error: 'No such subscription (test)',
      })
    );
  });

  it('a chargeback on a purchase pauses no subscription billing', async () => {
    const bundle = buildContext();

    await handlePaymentWebhook(
      createDisputeEvent(),
      mockStripe,
      bundle.context
    );

    expect(subscription.pauseBillingForDispute).not.toHaveBeenCalled();
  });

  it('won: the subscription is restored before the outcome is marked, and its block cleared', async () => {
    recordedAs('won');
    subscription.restoreAfterDispute?.mockImplementationOnce(async () => {
      calls.push('restore');
      return { subscription: disputedSubscription, restored: true };
    });
    purchase.settleWonDispute?.mockImplementationOnce(async () => {
      calls.push('settle');
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      {
        ...createDisputeEvent({ status: 'won' }),
        type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
      } as Stripe.Event,
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(subscription.restoreAfterDispute).toHaveBeenCalledWith(disputeInput);
    expect(mockClear).toHaveBeenCalledWith('user_sub', 'org_sub');
    expect(calls).toEqual(['restore', 'settle']);
  });

  it('won while another chargeback keeps the subscription paused: its block stays', async () => {
    recordedAs('won');
    subscription.restoreAfterDispute?.mockResolvedValueOnce({
      subscription: disputedSubscription,
      restored: false,
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      {
        ...createDisputeEvent({ status: 'won' }),
        type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
      } as Stripe.Event,
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(mockClear).not.toHaveBeenCalledWith('user_sub', 'org_sub');
  });

  it('lost: the subscription access ends first, the clawback runs, then it is cancelled at Stripe, then the outcome is marked', async () => {
    recordedAs('lost');
    subscription.pauseForDispute?.mockImplementationOnce(async () => {
      calls.push('pause');
      return disputedSubscription;
    });
    purchase.markDisputeOutcomeApplied?.mockImplementationOnce(async () => {
      calls.push('mark');
    });
    const bundle = buildContext();

    await handlePaymentWebhook(
      {
        ...createDisputeEvent({ status: 'lost' }),
        type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
      } as Stripe.Event,
      mockStripe,
      bundle.context
    );
    await drainWaitUntil(bundle);

    expect(subscription.cancelForLostDispute).toHaveBeenCalledWith(
      disputeInput
    );
    expect(mockRevoke).toHaveBeenCalledWith('user_sub', 'org_sub', 'refund');
    expect(calls).toEqual(['pause', 'clawback', 'cancel', 'mark']);
  });

  // ── `prevented` (Codex-2hxff.59 item 5) ──────────────────────────────────
  // Stripe defines it as a dispute "prevented from becoming a formal
  // chargeback": a closed inquiry, with nothing to restore or re-pay.

  function preventedEvent(): Stripe.Event {
    return {
      ...createDisputeEvent({ status: 'prevented' }),
      type: STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED,
    } as Stripe.Event;
  }

  it('prevented is a closed inquiry: marked applied, nothing restored, re-paid or clawed back, and no alert', async () => {
    purchase.countDisputeReversalSteps = vi.fn().mockResolvedValue(0);
    const bundle = buildContext();

    await handlePaymentWebhook(preventedEvent(), mockStripe, bundle.context);

    expect(purchase.countDisputeReversalSteps).toHaveBeenCalledWith(
      'dp_test_dispute'
    );
    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledWith(
      'dp_test_dispute'
    );
    expect(purchase.restoreDisputedPurchase).not.toHaveBeenCalled();
    expect(purchase.settleWonDispute).not.toHaveBeenCalled();
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(bundle.mock._obs.error).not.toHaveBeenCalled();
  });

  it('a prevented dispute that has a dispute reversal step anyway is alerted at error with an errorId, and still marked applied', async () => {
    purchase.countDisputeReversalSteps = vi.fn().mockResolvedValue(2);
    recordedAs('prevented', {
      purchaseId: 'purchase_prev',
      subscriptionId: null,
      courseSubscriptionId: null,
    });
    const bundle = buildContext();

    await handlePaymentWebhook(preventedEvent(), mockStripe, bundle.context);

    // The chargeback handling ran too, so access and billing may be paused.
    expect(bundle.mock._obs.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /ended 'prevented' after money was clawed back.*access and the subscription's billing may still be paused/
      ),
      {
        errorId: expect.any(String),
        disputeId: 'dp_test_dispute',
        chargeId: 'ch_test',
        purchaseId: 'purchase_prev',
        subscriptionId: null,
        courseSubscriptionId: null,
        reversalSteps: 2,
      }
    );
    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledWith(
      'dp_test_dispute'
    );
    expect(purchase.settleWonDispute).not.toHaveBeenCalled();
  });
});
