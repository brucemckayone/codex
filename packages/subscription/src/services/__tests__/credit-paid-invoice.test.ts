/**
 * The support alert for an invoice customer credit paid (Codex-2hxff.97):
 * once per invoice, ids and amounts only, never throwing.
 */
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  alertIfCreditPaid,
  CREDIT_ALERTED_KEY,
  creditCoveredCents,
} from '../credit-paid-invoice';

const IDS = {
  stripeSubscriptionId: 'sub_b',
  subscriptionId: '00000000-0000-4000-8000-0000000000b1',
  organizationId: '00000000-0000-4000-8000-0000000000b2',
  kind: 'tier' as const,
};

function invoice(fields: Partial<Stripe.Invoice>): Stripe.Invoice {
  return {
    id: 'in_b',
    total: 1000,
    starting_balance: 0,
    amount_paid: 1000,
    metadata: {},
    ...fields,
  } as Stripe.Invoice;
}

function harness(live: { metadata?: Record<string, string> } | Error = {}) {
  const retrieve = vi.fn(async () => {
    if (live instanceof Error) throw live;
    return { metadata: {}, ...live };
  });
  const update = vi.fn(async () => ({}));
  const obs = { error: vi.fn(), warn: vi.fn() };
  const stripe = { invoices: { retrieve, update } } as unknown as Stripe;
  return { stripe, obs, retrieve, update };
}

const ALERT = expect.stringContaining('Customer credit paid');

describe('creditCoveredCents', () => {
  it.each([
    [
      'the credit covers it all',
      { starting_balance: -6493, total: 1000 },
      1000,
    ],
    ['the credit covers part', { starting_balance: -300, total: 1000 }, 300],
    ['the card pays alone', { starting_balance: 0, total: 1000 }, 0],
    ['a debt on the balance', { starting_balance: 500, total: 1000 }, 0],
    ['nothing to pay', { starting_balance: -6493, total: 0 }, 0],
    [
      'a bill that is itself a credit',
      { starting_balance: -6493, total: -500 },
      0,
    ],
  ])('%s', (_, fields, covered) => {
    expect(creditCoveredCents(fields)).toBe(covered);
  });
});

describe('alertIfCreditPaid', () => {
  it('credit covers the whole bill: one alert, then the invoice is marked', async () => {
    const h = harness();

    await alertIfCreditPaid(
      h,
      invoice({ starting_balance: -6493, total: 1000, amount_paid: 0 }),
      IDS
    );

    expect(h.obs.error).toHaveBeenCalledExactlyOnceWith(ALERT, {
      errorId: expect.any(String),
      invoiceId: 'in_b',
      ...IDS,
      creditCoveredCents: 1000,
      amountPaidCents: 0,
    });
    expect(h.update).toHaveBeenCalledExactlyOnceWith('in_b', {
      metadata: { [CREDIT_ALERTED_KEY]: expect.any(String) },
    });
    // The alert is logged before the mark is written.
    expect(h.obs.error.mock.invocationCallOrder[0]).toBeLessThan(
      h.update.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('credit covers part of it: the alert names both amounts', async () => {
    const h = harness();

    await alertIfCreditPaid(
      h,
      invoice({ starting_balance: -300, total: 1000, amount_paid: 700 }),
      IDS
    );

    expect(h.obs.error).toHaveBeenCalledExactlyOnceWith(
      ALERT,
      expect.objectContaining({ creditCoveredCents: 300, amountPaidCents: 700 })
    );
  });

  it('the card pays alone: silent, and Stripe is not asked', async () => {
    const h = harness();

    await alertIfCreditPaid(h, invoice({ starting_balance: 0 }), IDS);

    expect(h.obs.error).not.toHaveBeenCalled();
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('a replay of a marked invoice: silent', async () => {
    const h = harness({
      metadata: { [CREDIT_ALERTED_KEY]: '2027-01-12T10:59:00.000Z' },
    });

    await alertIfCreditPaid(
      h,
      // The event's copy predates the mark.
      invoice({ starting_balance: -6493, total: 1000, amount_paid: 0 }),
      IDS
    );

    expect(h.obs.error).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('the re-read fails: it alerts anyway', async () => {
    const h = harness(new Error('Stripe is unavailable'));

    await alertIfCreditPaid(
      h,
      invoice({ starting_balance: -6493, total: 1000, amount_paid: 0 }),
      IDS
    );

    expect(h.obs.error).toHaveBeenCalledExactlyOnceWith(
      ALERT,
      expect.any(Object)
    );
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('the mark fails: the alert stands, a warning names the invoice, and nothing throws', async () => {
    const h = harness();
    h.update.mockRejectedValueOnce(new Error('Stripe is unavailable'));

    await expect(
      alertIfCreditPaid(
        h,
        invoice({ starting_balance: -6493, total: 1000, amount_paid: 0 }),
        IDS
      )
    ).resolves.toBeUndefined();

    expect(h.obs.error).toHaveBeenCalledTimes(1);
    expect(h.obs.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not mark'),
      expect.objectContaining({ invoiceId: 'in_b' })
    );
  });
});
