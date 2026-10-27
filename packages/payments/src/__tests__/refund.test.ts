/**
 * issueRefund (architecture C5, Codex-2hxff.14): the platform's one way to
 * give a payment back. It only asks Stripe; charge.refunded does the rest.
 * Support refunds through it too, in part or in full, inside `refundWindow`
 * (Codex-2hxff.28).
 */

import { createMockStripe } from '@codex/test-utils';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { issueRefund, refundWindow } from '../refund';

const input = {
  paymentIntentId: 'pi_duplicate',
  reason: 'duplicate' as const,
  idempotencyKey: 'refund_duplicate_pi_duplicate',
  environment: 'test',
};

/** The params and options of the nth `refunds.create` call. */
function createCall(
  stripe: Stripe,
  nth = 0
): [Stripe.RefundCreateParams?, Stripe.RequestOptions?] {
  // `create` is overloaded; the mock types its calls by the last overload.
  return (vi.mocked(stripe.refunds.create).mock.calls[nth] ??
    []) as unknown as [Stripe.RefundCreateParams?, Stripe.RequestOptions?];
}

describe('issueRefund', () => {
  it('refunds the PaymentIntent in full under the caller key, tagged with the environment', async () => {
    const stripe = createMockStripe();

    const result = await issueRefund(stripe, input);

    expect(result.alreadyRefunded).toBe(false);
    expect(result.refundId).toMatch(/^re_/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    const [params, options] = createCall(stripe);
    // No amount: a full refund.
    expect(params).toEqual({
      payment_intent: 'pi_duplicate',
      reason: 'duplicate',
      metadata: { codex_env: 'test' },
    });
    expect(options).toEqual({
      idempotencyKey: 'refund_duplicate_pi_duplicate',
    });
  });

  it('a partial refund of a charge sends Stripe the amount', async () => {
    const stripe = createMockStripe();

    await issueRefund(stripe, {
      chargeId: 'ch_partial',
      reason: 'requested_by_customer',
      amountCents: 350,
      idempotencyKey: 'support_refund_ch_partial_0_350',
      environment: 'test',
    });

    const [params] = createCall(stripe);
    expect(params).toEqual({
      charge: 'ch_partial',
      amount: 350,
      reason: 'requested_by_customer',
      metadata: { codex_env: 'test' },
    });
  });

  it("the caller's metadata goes on the refund, and codex_env is always the caller's environment", async () => {
    const stripe = createMockStripe();

    await issueRefund(stripe, {
      ...input,
      metadata: {
        codex_support_key: 'support_refund_ch_x_0_1000',
        codex_requested_by: 'user_support',
        // A caller can never file the refund's events under another
        // environment: the tag is merged last.
        codex_env: 'production',
      },
    });

    const [params] = createCall(stripe);
    expect(params?.metadata).toEqual({
      codex_support_key: 'support_refund_ch_x_0_1000',
      codex_requested_by: 'user_support',
      codex_env: 'test',
    });
  });

  it("returns Stripe's status, amount and created, so a pending or failed refund can be shown as such", async () => {
    const stripe = createMockStripe();
    vi.mocked(stripe.refunds.create).mockResolvedValueOnce({
      id: 're_pending',
      object: 'refund',
      status: 'pending',
      amount: 350,
      created: 1_792_800_000,
    } as never);

    await expect(
      issueRefund(stripe, { ...input, amountCents: 350 })
    ).resolves.toEqual({
      refundId: 're_pending',
      alreadyRefunded: false,
      status: 'pending',
      amountCents: 350,
      createdAt: 1_792_800_000,
    });
  });

  it('a charge already refunded is done, not an error (a retry after Stripe forgot the key)', async () => {
    const stripe = createMockStripe();
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      Object.assign(new Error('Charge has already been refunded.'), {
        code: 'charge_already_refunded',
        statusCode: 400,
      })
    );

    await expect(issueRefund(stripe, input)).resolves.toEqual({
      refundId: null,
      alreadyRefunded: true,
      status: null,
      amountCents: null,
      createdAt: null,
    });
  });

  it('any other failure is thrown, so the webhook answers 500 and Stripe retries', async () => {
    const stripe = createMockStripe();
    const outage = Object.assign(new Error('Stripe is down'), {
      statusCode: 503,
    });
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(outage);

    await expect(issueRefund(stripe, input)).rejects.toBe(outage);
  });

  it("Stripe refusing a support refund is thrown as Stripe's own error, for the route to map", async () => {
    const stripe = createMockStripe();
    const disputed = Object.assign(new Error('Charge has been charged back'), {
      code: 'charge_disputed',
      statusCode: 400,
    });
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(disputed);

    await expect(
      issueRefund(stripe, { ...input, amountCents: 100 })
    ).rejects.toBe(disputed);
  });
});

describe('refundWindow (14 × 24 h from the charge)', () => {
  const MINUTE = 60;
  const DAY = 24 * 60 * MINUTE;
  const charged = 1_792_000_000;
  const at = (seconds: number) => new Date(seconds * 1000);

  it('closes 14 days to the second after the charge was created', () => {
    expect(refundWindow(charged, at(charged)).closesAt).toEqual(
      at(charged + 14 * DAY)
    );
  });

  it('13 days 23 hours 59 minutes after the charge: open', () => {
    const now = at(charged + 13 * DAY + 23 * 60 * MINUTE + 59 * MINUTE);

    expect(refundWindow(charged, now).isOpen).toBe(true);
  });

  it('exactly 14 days after the charge: closed', () => {
    expect(refundWindow(charged, at(charged + 14 * DAY)).isOpen).toBe(false);
  });

  it("a renewal is measured from its own charge, not the subscription's first", () => {
    const renewal = charged + 30 * DAY;
    const now = at(renewal + 5 * DAY);

    expect(refundWindow(charged, now).isOpen).toBe(false);
    expect(refundWindow(renewal, now)).toEqual({
      closesAt: at(renewal + 14 * DAY),
      isOpen: true,
    });
  });
});
