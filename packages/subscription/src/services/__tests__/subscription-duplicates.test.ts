import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { CREDIT_NOT_RETURNED_KEY } from '../credit-paid-invoice';
import {
  cancelAndRefundDuplicate,
  isDuplicateSubscription,
} from '../subscription-duplicates';

interface FakeInvoice {
  id: string;
  amount_paid: number;
  charge: string | null;
  /** Below 0 when customer credit was on the balance. */
  starting_balance?: number;
  total?: number;
}

function stripeWith(opts: {
  status: string;
  invoices: FakeInvoice[];
  refundError?: { code: string };
  /** Invoices whose live copy already carries the not-returned mark. */
  marked?: string[];
}) {
  const refundsCreate = vi.fn(async () => {
    if (opts.refundError) throw opts.refundError;
    return { id: 're_1' };
  });
  const cancel = vi.fn(async () => ({ id: 'sub_dup', status: 'canceled' }));
  const update = vi.fn(async () => ({}));
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
          starting_balance: inv.starting_balance ?? 0,
          total: inv.total ?? inv.amount_paid,
          metadata: {},
          payments: {
            data: inv.charge ? [{ payment: { charge: inv.charge } }] : [],
          },
        })),
      })),
      retrieve: vi.fn(async (id: string) => ({
        id,
        payments: { data: [] },
        metadata: opts.marked?.includes(id)
          ? { [CREDIT_NOT_RETURNED_KEY]: '2027-01-12T10:59:00.000Z' }
          : {},
      })),
      update,
    },
    refunds: { create: refundsCreate },
  };
  const obs = { error: vi.fn(), warn: vi.fn() };
  return {
    stripe: stripe as unknown as Stripe,
    cancel,
    refundsCreate,
    update,
    obs,
  };
}

const IDS = {
  subscriptionId: '00000000-0000-4000-8000-0000000000d1',
  organizationId: '00000000-0000-4000-8000-0000000000d2',
  userId: 'user_dup',
  kind: 'tier' as const,
};

/** The call's params, with the harness's logger. */
function params(obs: { error: () => void; warn: () => void }) {
  return {
    stripeSubscriptionId: 'sub_dup',
    environment: 'test',
    obs,
    ids: IDS,
  };
}

const NOT_RETURNED = expect.stringContaining(
  "Customer credit paid a cancelled duplicate's invoice"
);

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
    const { stripe, cancel, refundsCreate, obs } = stripeWith({
      status: 'active',
      invoices: [
        { id: 'in_1', amount_paid: 1000, charge: 'ch_1' },
        { id: 'in_0', amount_paid: 0, charge: null },
      ],
    });

    const result = await cancelAndRefundDuplicate(stripe, params(obs));

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
    const { stripe, cancel, refundsCreate, obs } = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: 'ch_1' }],
    });

    await cancelAndRefundDuplicate(stripe, params(obs));

    expect(cancel).not.toHaveBeenCalled();
    expect(refundsCreate).toHaveBeenCalledTimes(1);
  });

  it('counts a charge already refunded as done', async () => {
    const { stripe, obs } = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: 'ch_1' }],
      refundError: { code: 'charge_already_refunded' },
    });

    await expect(
      cancelAndRefundDuplicate(stripe, params(obs))
    ).resolves.toEqual({ refundedInvoices: 1 });
  });

  it('throws when a paid invoice has no charge to refund, and when Stripe refuses', async () => {
    const noCharge = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: null }],
    });
    await expect(
      cancelAndRefundDuplicate(noCharge.stripe, params(noCharge.obs))
    ).rejects.toThrow('no charge to refund');

    const refused = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_1', amount_paid: 1000, charge: 'ch_1' }],
      refundError: { code: 'charge_disputed' },
    });
    await expect(
      cancelAndRefundDuplicate(refused.stripe, params(refused.obs))
    ).rejects.toEqual({ code: 'charge_disputed' });
    // A refund that failed has told support nothing yet: the retry does.
    expect(refused.obs.error).not.toHaveBeenCalled();
  });

  // ─── Customer credit is not given back (Codex-2hxff.98) ──────────────────

  it('a duplicate customer credit paid in full: no card refund, and one alert naming the whole amount', async () => {
    const { stripe, refundsCreate, update, obs } = stripeWith({
      status: 'canceled',
      invoices: [
        {
          id: 'in_credit',
          amount_paid: 0,
          charge: null,
          starting_balance: -6493,
          total: 1000,
        },
      ],
    });

    const result = await cancelAndRefundDuplicate(stripe, params(obs));

    expect(result).toEqual({ refundedInvoices: 0 });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(obs.error).toHaveBeenCalledExactlyOnceWith(NOT_RETURNED, {
      errorId: expect.any(String),
      invoiceId: 'in_credit',
      stripeSubscriptionId: 'sub_dup',
      ...IDS,
      cause: 'duplicate',
      creditNotReturnedCents: 1000,
      cardRefundedCents: 0,
    });
    expect(update).toHaveBeenCalledExactlyOnceWith('in_credit', {
      metadata: { [CREDIT_NOT_RETURNED_KEY]: expect.any(String) },
    });
  });

  it('a duplicate credit paid part of: the card part is still refunded, then one alert names both parts', async () => {
    const { stripe, refundsCreate, obs } = stripeWith({
      status: 'canceled',
      invoices: [
        {
          id: 'in_part',
          amount_paid: 700,
          charge: 'ch_part',
          starting_balance: -300,
          total: 1000,
        },
      ],
    });

    const result = await cancelAndRefundDuplicate(stripe, params(obs));

    expect(result).toEqual({ refundedInvoices: 1 });
    expect(refundsCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ charge: 'ch_part', reason: 'duplicate' }),
      { idempotencyKey: 'refund_duplicate_in_part' }
    );
    expect(obs.error).toHaveBeenCalledExactlyOnceWith(
      NOT_RETURNED,
      expect.objectContaining({
        invoiceId: 'in_part',
        creditNotReturnedCents: 300,
        cardRefundedCents: 700,
      })
    );
    // The alert says the card part WAS refunded, so it comes after.
    expect(refundsCreate.mock.invocationCallOrder[0]).toBeLessThan(
      obs.error.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('a duplicate the card paid alone: refunded, no alert, and Stripe is not asked about a mark', async () => {
    const { stripe, refundsCreate, update, obs } = stripeWith({
      status: 'canceled',
      invoices: [{ id: 'in_card', amount_paid: 1000, charge: 'ch_card' }],
    });

    await cancelAndRefundDuplicate(stripe, params(obs));

    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(obs.error).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a replay of an invoice already alerted: the refund is asked again under its key, and support is not told twice', async () => {
    const { stripe, refundsCreate, update, obs } = stripeWith({
      status: 'canceled',
      invoices: [
        {
          id: 'in_part',
          amount_paid: 700,
          charge: 'ch_part',
          starting_balance: -300,
          total: 1000,
        },
      ],
      marked: ['in_part'],
    });

    await cancelAndRefundDuplicate(stripe, params(obs));

    expect(refundsCreate).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      idempotencyKey: 'refund_duplicate_in_part',
    });
    expect(obs.error).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
