/**
 * Payment webhook — `charge.refunded` handler integration tests
 * (Codex-iozhq characterization safety net — before refactor).
 *
 * Mirrors the structure of `payment-webhook-dispute.test.ts`. The handler
 * contract for a refund event:
 *   1. extract paymentIntentId from the Stripe Charge
 *   2. call `PurchaseService.processRefund(paymentIntentId, …)`
 *   3. on success: bump COLLECTION_USER_LIBRARY via `invalidateForUser`
 *      (requires CACHE_KV + userId)
 *   4. on success: write `AccessRevocation.revoke(userId, orgId, 'refund')`
 *      ONLY when the refund is subscription-linked (orgId returned by the
 *      service). One-time-purchase refunds deliberately skip revocation —
 *      see the inline rationale in the handler.
 *   5. send `refund-processed` email when billing_details.email or
 *      receipt_email is present on the charge
 *
 * Coverage matrix (positive + negative + idempotent — feedback_security_deep_test):
 *
 * | Scenario                                                      | processRefund | invalidateForUser | revoke | sendEmail |
 * | ------------------------------------------------------------- | :-----------: | :---------------: | :----: | :-------: |
 * | positive one-time: { userId } only → cache bump, NO revocation|      yes      |        yes        |   no   |    yes    |
 * | positive subscription-linked: { userId, orgId } → all three   |      yes      |        yes        |   yes  |    yes    |
 * | negative: unknown charge (processRefund returns void)         |      yes      |        no         |   no   |    yes*   |
 * | negative: missing payment_intent → no service call            |      no       |        no         |   no   |    no     |
 * | negative: no CACHE_KV binding → service runs, no KV writes    |      yes      |        no         |   no   |    yes    |
 * | idempotent: same event twice → monotonic side-effects         |    yes x 2    |      yes x 2      |   no   |   yes x 2 |
 * | fire-and-forget: revoke rejection does NOT surface            |      yes      |        yes        |   yes  |    yes    |
 * | no email addresses on charge → sendEmail NOT called           |      yes      |        yes        |   no   |    no     |
 * | refund metadata round-trip: latestRefund fields → service     |      yes      |        -          |   -    |     -     |
 *
 * *email: the handler dispatches the refund email even when processRefund
 *  returned void, because the email branch only depends on charge email
 *  fields, not on the service result. This is intentional — we always
 *  acknowledge a refund to the payer; whether the DB side found a matching
 *  purchase row is a separate concern.
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { WebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';

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
import { createWebhookServices, sendEmailToWorker } from '@codex/worker-utils';
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
 * Build a `charge.refunded` Stripe event payload. Overrides let individual
 * tests tweak charge fields — `refunds.data[0]` is the latest refund and
 * its id/reason are what the service receives.
 */
function createRefundEvent(
  overrides: Record<string, unknown> = {}
): Stripe.Event {
  return {
    id: `evt_refund_${Math.random().toString(36).slice(2)}`,
    type: STRIPE_EVENTS.CHARGE_REFUNDED,
    data: {
      object: {
        id: 'ch_test_refund',
        object: 'charge',
        payment_intent: 'pi_test_refund',
        amount: 1999,
        amount_refunded: 1999,
        currency: 'gbp',
        billing_details: {
          email: 'buyer@example.com',
          name: 'Test Buyer',
        },
        receipt_email: null,
        refunds: {
          data: [
            {
              id: 're_test_refund',
              reason: 'requested_by_customer',
            },
          ],
        },
        metadata: {
          contentTitle: 'Test Content',
        },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

describe('handlePaymentWebhook — charge.refunded', () => {
  let mockStripe: Stripe;
  let mockRelease: ReturnType<typeof vi.fn>;
  let mockProcessRefund: ReturnType<typeof vi.fn>;
  let mockReverseSubscription: ReturnType<typeof vi.fn>;
  let mockRecordRefund: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
    mockIsRevoked.mockReset();
    mockIsRevoked.mockResolvedValue(null);
    mockClear.mockReset();
    mockClear.mockResolvedValue(undefined);

    mockProcessRefund = vi.fn().mockResolvedValue(undefined);
    mockReverseSubscription = vi.fn().mockResolvedValue(undefined);
    mockRecordRefund = vi.fn().mockResolvedValue(true);
    mockRelease = vi.fn();
    mockStripe = {} as Stripe;

    // The registry's services, as the composition root hands them over.
    vi.mocked(createWebhookServices).mockResolvedValue({
      services: {
        purchase: {
          processRefund: mockProcessRefund,
          processDispute: vi.fn().mockResolvedValue(undefined),
          recordRefund: mockRecordRefund,
        },
        // charge.refunded reverses subscription payouts first (Codex-13v21).
        subscription: {
          reverseSubscriptionPayoutsForCharge: mockReverseSubscription,
        },
      } as unknown as WebhookServices['services'],
      background: (promise) => promise,
      release: mockRelease,
    });
  });

  it('positive one-time purchase: processRefund returns { userId } only → library cache bumped, NO revocation written', async () => {
    // One-time purchase refunds return userId WITHOUT orgId. Revocation is
    // org-scoped per-user, so we deliberately skip it — the library cache
    // bump is sufficient because `processRefund` already soft-deletes
    // `contentAccess` for the affected content.
    mockProcessRefund.mockResolvedValueOnce({ userId: 'user_one_time' });

    const bundle = buildContext();
    const event = createRefundEvent();

    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ userId: 'user_one_time', reason: 'refund' }),
      expect.anything()
    );

    // No orgId → no revocation.
    expect(AccessRevocation).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('positive subscription-linked: processRefund returns { userId, orgId } → library bump + revocation written', async () => {
    // Forward-compatibility path: when subscription-linked refunds start
    // returning orgId, revocation must fire without another round of
    // plumbing (see the inline comment in the handler).
    mockProcessRefund.mockResolvedValueOnce({
      userId: 'user_sub',
      orgId: 'org_sub',
    });

    const bundle = buildContext();
    const event = createRefundEvent();

    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(invalidateForUser).toHaveBeenCalledTimes(1);
    expect(AccessRevocation).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith('user_sub', 'org_sub', 'refund');
  });

  it('negative: processRefund returns void (unknown charge) → no cache bump, no revocation, email still sent', async () => {
    mockProcessRefund.mockResolvedValueOnce(undefined);
    const bundle = buildContext();
    const event = createRefundEvent({ payment_intent: 'pi_unknown' });

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();
    await drainWaitUntil(bundle);

    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();

    // Refund-processed email fires regardless of service result — the
    // payer gets acknowledged even if the DB row wasn't found.
    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
  });

  it('negative: missing payment_intent on charge → processRefund NOT called, no side-effects', async () => {
    const bundle = buildContext();
    const event = createRefundEvent({ payment_intent: null });

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(sendEmailToWorker).not.toHaveBeenCalled();
  });

  it('negative: no CACHE_KV binding → service runs, no KV side-effects, email still sent', async () => {
    mockProcessRefund.mockResolvedValueOnce({
      userId: 'user_nokv',
      orgId: 'org_nokv',
    });
    const bundle = buildContext({ CACHE_KV: undefined });
    const event = createRefundEvent();

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();

    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(AccessRevocation).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
  });

  it('idempotent: same refund event fired twice → service + cache monotonic (no revocation without orgId)', async () => {
    mockProcessRefund.mockResolvedValue({ userId: 'user_idem' });

    const bundle = buildContext();
    const event = createRefundEvent();

    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await handlePaymentWebhook(event, mockStripe, bundle.context);
    await drainWaitUntil(bundle);

    expect(mockProcessRefund).toHaveBeenCalledTimes(2);
    expect(invalidateForUser).toHaveBeenCalledTimes(2);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(sendEmailToWorker).toHaveBeenCalledTimes(2);
  });

  it('fire-and-forget: AccessRevocation.revoke rejection does NOT surface, handler resolves', async () => {
    mockProcessRefund.mockResolvedValueOnce({
      userId: 'user_fire',
      orgId: 'org_fire',
    });
    mockRevoke.mockRejectedValueOnce(new Error('KV unreachable'));

    const bundle = buildContext();
    const event = createRefundEvent();

    await expect(
      handlePaymentWebhook(event, mockStripe, bundle.context)
    ).resolves.not.toThrow();
    await expect(drainWaitUntil(bundle)).resolves.not.toThrow();

    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  it('no email addresses on charge → sendEmailToWorker NOT called', async () => {
    mockProcessRefund.mockResolvedValueOnce({ userId: 'user_noemail' });
    const bundle = buildContext();
    const event = createRefundEvent({
      billing_details: { email: null, name: 'Anon' },
      receipt_email: null,
    });

    await handlePaymentWebhook(event, mockStripe, bundle.context);

    expect(sendEmailToWorker).not.toHaveBeenCalled();
  });

  it('falls back to receipt_email when billing_details.email is absent', async () => {
    mockProcessRefund.mockResolvedValueOnce({ userId: 'u' });
    const bundle = buildContext();
    const event = createRefundEvent({
      billing_details: { email: null, name: 'Fallback' },
      receipt_email: 'fallback@example.com',
    });

    await handlePaymentWebhook(event, mockStripe, bundle.context);

    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
    const call = (sendEmailToWorker as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[2];
    expect(call?.to).toBe('fallback@example.com');
    expect(call?.templateName).toBe('refund-processed');
  });

  it('refund metadata round-trip: stripeRefundId + amount_refunded + reason → processRefund', async () => {
    mockProcessRefund.mockResolvedValueOnce({ userId: 'u' });
    const bundle = buildContext();
    const event = createRefundEvent({
      payment_intent: 'pi_meta',
      amount_refunded: 500,
      refunds: {
        data: [{ id: 're_meta', reason: 'fraudulent' }],
      },
    });

    await handlePaymentWebhook(event, mockStripe, bundle.context);

    // The charge (id + amount) is the clawback's denominator for both
    // sources (Codex-2hxff.8, D1).
    const charge = { id: 'ch_test_refund', amountCents: 1999 };
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
    expect(mockProcessRefund).toHaveBeenCalledWith('pi_meta', {
      charge,
      stripeRefundId: 're_meta',
      refundAmountCents: 500,
      refundReason: 'fraudulent',
    });
  });

  // ── refund.updated / refund.failed (Codex-2hxff.8) ───────────────────
  // A refund still pending when charge.refunded arrived is clawed back once it
  // has succeeded or failed (owner decisions 2026-10-19). The refund was
  // recorded and its email sent already.

  function refundUpdatedEvent(refund: Record<string, unknown>): Stripe.Event {
    return {
      id: `evt_refund_updated_${Math.random().toString(36).slice(2)}`,
      type: STRIPE_EVENTS.REFUND_UPDATED,
      data: {
        object: {
          id: 're_pending_then_paid',
          object: 'refund',
          charge: 'ch_updated',
          amount: 1000,
          currency: 'gbp',
          created: 1_790_000_000,
          status: 'succeeded',
          reason: 'requested_by_customer',
          ...refund,
        },
      },
    } as unknown as Stripe.Event;
  }

  function stripeWithCharge(metadata: Record<string, string> = {}) {
    const retrieve = vi.fn().mockResolvedValue({
      id: 'ch_updated',
      amount: 3000,
      amount_refunded: 1000,
      payment_intent: 'pi_updated',
      metadata,
    });
    return {
      stripe: { charges: { retrieve } } as unknown as Stripe,
      retrieve,
    };
  }

  it('refund.updated succeeded: recorded, claws back both sources on the retrieved charge, sends no email', async () => {
    const bundle = buildContext();
    const { stripe, retrieve } = stripeWithCharge();

    await handlePaymentWebhook(refundUpdatedEvent({}), stripe, bundle.context);

    expect(retrieve).toHaveBeenCalledWith('ch_updated');
    expect(mockRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeRefundId: 're_pending_then_paid',
        status: 'succeeded',
      })
    );
    const charge = { id: 'ch_updated', amountCents: 3000 };
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
    expect(mockProcessRefund).toHaveBeenCalledWith('pi_updated', {
      charge,
      stripeRefundId: 're_pending_then_paid',
      refundAmountCents: 1000,
      refundReason: 'requested_by_customer',
    });
    expect(sendEmailToWorker).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('refund.updated still pending: its status is recorded and nothing is clawed back', async () => {
    const bundle = buildContext();
    const { stripe } = stripeWithCharge();

    await handlePaymentWebhook(
      refundUpdatedEvent({ status: 'pending' }),
      stripe,
      bundle.context
    );

    expect(mockRecordRefund).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it('refund.updated failed: recorded for support, alerted once, and the clawback stands', async () => {
    // Owner decision 2026-10-19, "Hold it for support": Stripe returns the
    // money, but the customer must still be refunded another way.
    const bundle = buildContext();
    const { stripe } = stripeWithCharge();

    await handlePaymentWebhook(
      refundUpdatedEvent({
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      }),
      stripe,
      bundle.context
    );

    expect(mockRecordRefund).toHaveBeenCalledWith({
      stripeRefundId: 're_pending_then_paid',
      stripeChargeId: 'ch_updated',
      paymentIntentId: 'pi_updated',
      amountCents: 1000,
      currency: 'gbp',
      status: 'failed',
      reason: 'requested_by_customer',
      failureReason: 'expired_or_canceled_card',
      stripeCreatedAt: new Date(1_790_000_000 * 1000),
    });
    expect(bundle.mock._obs.error).toHaveBeenCalledWith(
      expect.stringContaining('support must refund the customer another way'),
      expect.objectContaining({
        errorId: expect.any(String),
        refundId: 're_pending_then_paid',
        failureReason: 'expired_or_canceled_card',
      })
    );
    const charge = { id: 'ch_updated', amountCents: 3000 };
    expect(mockReverseSubscription).toHaveBeenCalledWith(charge);
    expect(mockProcessRefund).toHaveBeenCalledWith(
      'pi_updated',
      expect.objectContaining({
        charge,
        stripeRefundId: 're_pending_then_paid',
      })
    );
    // Recorded before the clawback, so support sees it while a step retries.
    expect(mockRecordRefund.mock.invocationCallOrder[0]).toBeLessThan(
      mockReverseSubscription.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('refund.failed is handled the same way, and a redelivery raises no second alert', async () => {
    const bundle = buildContext();
    const { stripe } = stripeWithCharge();
    mockRecordRefund.mockResolvedValue(false);

    await handlePaymentWebhook(
      {
        ...refundUpdatedEvent({ status: 'failed' }),
        type: STRIPE_EVENTS.REFUND_FAILED,
      } as Stripe.Event,
      stripe,
      bundle.context
    );

    expect(mockRecordRefund).toHaveBeenCalledOnce();
    expect(bundle.mock._obs.error).not.toHaveBeenCalled();
    expect(mockReverseSubscription).toHaveBeenCalledOnce();
  });

  it("refund.updated canceled: recorded, nothing is clawed back, and the buyer's access is flagged for a person once", async () => {
    const bundle = buildContext();
    const { stripe } = stripeWithCharge();

    await handlePaymentWebhook(
      refundUpdatedEvent({ status: 'canceled' }),
      stripe,
      bundle.context
    );
    mockRecordRefund.mockResolvedValue(false);
    await handlePaymentWebhook(
      refundUpdatedEvent({ status: 'canceled' }),
      stripe,
      bundle.context
    );

    expect(mockRecordRefund).toHaveBeenCalledTimes(2);
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(bundle.mock._obs.error).toHaveBeenCalledOnce();
    expect(bundle.mock._obs.error).toHaveBeenCalledWith(
      expect.stringContaining("check the buyer's access"),
      expect.objectContaining({ errorId: expect.any(String) })
    );
  });

  it("refund.updated on another environment's charge is ignored and not recorded: the refund has no tag, so the charge's is read", async () => {
    const bundle = buildContext({ ENVIRONMENT: 'production' });
    const { stripe } = stripeWithCharge({ codex_env: 'development' });

    await handlePaymentWebhook(
      refundUpdatedEvent({ status: 'failed' }),
      stripe,
      bundle.context
    );

    expect(mockRecordRefund).not.toHaveBeenCalled();
    expect(mockReverseSubscription).not.toHaveBeenCalled();
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it('passes £-formatted refundAmount to the refund-processed email template', async () => {
    mockProcessRefund.mockResolvedValueOnce({ userId: 'u' });
    const bundle = buildContext();
    const event = createRefundEvent({
      amount: 2500,
      amount_refunded: 2500,
    });

    await handlePaymentWebhook(event, mockStripe, bundle.context);

    const call = (sendEmailToWorker as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[2];
    expect(call?.data.refundAmount).toBe('£25.00');
    expect(call?.data.originalAmount).toBe('£25.00');
    expect(call?.data.contentTitle).toBe('Test Content');
  });
});
