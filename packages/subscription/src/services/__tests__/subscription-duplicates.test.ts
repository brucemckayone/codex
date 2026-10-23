import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  cancelAndRefundDuplicate,
  isDuplicateSubscription,
} from '../subscription-duplicates';

function stripeWith(opts: {
  status: string;
  invoices: Array<{ id: string; amount_paid: number; charge: string | null }>;
  refundError?: { code: string };
}) {
  const refundsCreate = vi.fn(async () => {
    if (opts.refundError) throw opts.refundError;
    return { id: 're_1' };
  });
  const cancel = vi.fn(async () => ({ id: 'sub_dup', status: 'canceled' }));
  const stripe = {
    subscriptions: {
      retrieve: vi.fn(async () => ({ id: 'sub_dup', status: opts.status })),
      cancel,
    },
    invoices: {
      list: vi.fn(async () => ({
        data: opts.invoices.map((inv) => ({
          id: inv.id,
          amount_paid: inv.amount_paid,
          payments: {
            data: inv.charge ? [{ payment: { charge: inv.charge } }] : [],
          },
        })),
      })),
      retrieve: vi.fn(async (id: string) => ({ id, payments: { data: [] } })),
    },
    refunds: { create: refundsCreate },
  };
  return { stripe: stripe as unknown as Stripe, cancel, refundsCreate };
}

describe('isDuplicateSubscription', () => {
  it('reads either table marker', () => {
    expect(isDuplicateSubscription({ duplicateOfSubscriptionId: 'a' })).toBe(
      true
    );
    expect(isDuplicateSubscription({ duplicateOfSubscriptionId: null })).toBe(
      false
    );
    expect(
      isDuplicateSubscription({ duplicateOfCourseSubscriptionId: 'b' })
    ).toBe(true);
    expect(
      isDuplicateSubscription({ duplicateOfCourseSubscriptionId: null })
    ).toBe(false);
  });
});

describe('cancelAndRefundDuplicate', () => {
  it('cancels a live duplicate without proration, then refunds each paid invoice by its charge', async () => {
    const { stripe, cancel, refundsCreate } = stripeWith({
      status: 'active',
      invoices: [
        { id: 'in_1', amount_paid: 1000, charge: 'ch_1' },
        { id: 'in_0', amount_paid: 0, charge: null },
      ],
    });

    const result = await cancelAndRefundDuplicate(stripe, {
      stripeSubscriptionId: 'sub_dup',
      environment: 'test',
    });

    expect(result).toEqual({ refundedInvoices: 1 });
    expect(cancel).toHaveBeenCalledWith(
      'sub_dup',
      expect.objectContaining({ prorate: false }),
      { idempotencyKey: 'dup_cancel_sub_dup' }
    );
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ charge: 'ch_1', reason: 'duplicate' }),
      { idempotencyKey: 'refund_duplicate_in_1' }
    );
    // Cancelling first: the refund's charge.refunded finds it ended.
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      refundsCreate.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('does not cancel one Stripe has already ended, but still refunds it', async () => {
    const { stripe, cancel, refundsCreate } = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: 'ch_1' }],
    });

    await cancelAndRefundDuplicate(stripe, {
      stripeSubscriptionId: 'sub_dup',
      environment: 'test',
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(refundsCreate).toHaveBeenCalledTimes(1);
  });

  it('counts a charge already refunded as done', async () => {
    const { stripe } = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: 'ch_1' }],
      refundError: { code: 'charge_already_refunded' },
    });

    await expect(
      cancelAndRefundDuplicate(stripe, {
        stripeSubscriptionId: 'sub_dup',
        environment: 'test',
      })
    ).resolves.toEqual({ refundedInvoices: 1 });
  });

  it('throws when a paid invoice has no charge to refund, and when Stripe refuses', async () => {
    const noCharge = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: null }],
    });
    await expect(
      cancelAndRefundDuplicate(noCharge.stripe, {
        stripeSubscriptionId: 'sub_dup',
        environment: 'test',
      })
    ).rejects.toThrow('no charge to refund');

    const refused = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: 'ch_1' }],
      refundError: { code: 'charge_disputed' },
    });
    await expect(
      cancelAndRefundDuplicate(refused.stripe, {
        stripeSubscriptionId: 'sub_dup',
        environment: 'test',
      })
    ).rejects.toEqual({ code: 'charge_disputed' });
  });
});
