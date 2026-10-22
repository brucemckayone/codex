/**
 * issueRefund (architecture C5, Codex-2hxff.14): the platform's one way to
 * give a payment back. It only asks Stripe; charge.refunded does the rest.
 */

import { createMockStripe } from '@codex/test-utils';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { issueRefund } from '../refund';

const input = {
  paymentIntentId: 'pi_duplicate',
  reason: 'duplicate' as const,
  idempotencyKey: 'refund_duplicate_pi_duplicate',
  environment: 'test',
};

describe('issueRefund', () => {
  it('refunds the PaymentIntent in full under the caller key, tagged with the environment', async () => {
    const stripe = createMockStripe();

    const result = await issueRefund(stripe, input);

    expect(result.alreadyRefunded).toBe(false);
    expect(result.refundId).toMatch(/^re_/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    // `create` is overloaded; the mock types its calls by the last overload.
    const [params, options] = (vi.mocked(stripe.refunds.create).mock.calls[0] ??
      []) as unknown as [Stripe.RefundCreateParams?, Stripe.RequestOptions?];
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
});
