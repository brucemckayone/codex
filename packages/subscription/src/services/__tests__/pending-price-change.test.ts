/**
 * The 30-day price-change rule (Codex-2hxff.3) against a mocked Stripe.
 * The fan-out services are covered in subscription-service.test.ts; this file
 * pins the per-subscription decision and the renewal-date arithmetic.
 */
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  applyDuePendingPriceChange,
  firstRenewalOnOrAfter,
  PRICE_CHANGE_NOTICE_SECONDS,
  schedulePriceChange,
} from '../pending-price-change';

const DAY = 24 * 60 * 60;
const NOTICE = new Date('2026-10-13T12:00:00Z');
const NOTICE_SEC = NOTICE.getTime() / 1000;

function fakeSub(opts: {
  renewal: number;
  status?: Stripe.Subscription.Status;
  interval?: 'month' | 'year';
  priceId?: string;
  unitAmount?: number;
  metadata?: Record<string, string>;
}): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: opts.status ?? 'active',
    billing_cycle_anchor: opts.renewal,
    metadata: opts.metadata ?? {},
    items: {
      data: [
        {
          id: 'si_1',
          current_period_end: opts.renewal,
          price: {
            id: opts.priceId ?? 'price_old',
            unit_amount: opts.unitAmount ?? 500,
            recurring: { interval: opts.interval ?? 'month' },
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function fakeStripe(subscription: Stripe.Subscription) {
  const update = vi.fn().mockResolvedValue({});
  const stripe = {
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue(subscription),
      update,
    },
  } as unknown as Stripe;
  return { stripe, update };
}

const target = {
  stripeSubscriptionId: 'sub_1',
  newPriceId: 'price_new',
  newAmountCents: 700,
  interval: 'month' as const,
  noticeAt: NOTICE,
};

describe('schedulePriceChange', () => {
  it('renewal ≥ 30 days after the notice → swaps now with no proration', async () => {
    const renewal = NOTICE_SEC + 40 * DAY;
    const { stripe, update } = fakeStripe(fakeSub({ renewal }));

    const outcome = await schedulePriceChange(stripe, target);

    expect(outcome).toEqual({
      kind: 'applied',
      effectiveAt: new Date(renewal * 1000),
    });
    expect(update).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_new' }],
        proration_behavior: 'none',
      }),
      { idempotencyKey: 'price-change-now:sub_1:price_new' }
    );
  });

  it('renewal sooner → pending from exactly notice + 30 days; the item is untouched', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 10 * DAY })
    );

    const outcome = await schedulePriceChange(stripe, target);

    expect(outcome.kind).toBe('pending');
    const [, params] = update.mock.calls[0] ?? [];
    expect(params).toEqual({
      metadata: {
        codex_pending_price_id: 'price_new',
        codex_pending_price_from: String(
          NOTICE_SEC + PRICE_CHANGE_NOTICE_SECONDS
        ),
      },
    });
  });

  it('never crosses intervals', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 200 * DAY, interval: 'year' })
    );

    const outcome = await schedulePriceChange(stripe, target);

    expect(outcome.kind).toBe('skipped');
    expect(update).not.toHaveBeenCalled();
  });

  it('a past-due subscription is marked pending even when its renewal is far off', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 40 * DAY, status: 'past_due' })
    );

    const outcome = await schedulePriceChange(stripe, target);

    expect(outcome.kind).toBe('pending');
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('items');
  });

  it('same amount as today → unchanged: swapped silently, any pending change dropped', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({
        renewal: NOTICE_SEC + 10 * DAY,
        unitAmount: 700,
        metadata: { codex_pending_price_id: 'price_older' },
      })
    );

    const outcome = await schedulePriceChange(stripe, target);

    expect(outcome).toEqual({ kind: 'unchanged' });
    expect(update).toHaveBeenCalledWith(
      'sub_1',
      {
        items: [{ id: 'si_1', price: 'price_new' }],
        proration_behavior: 'none',
        metadata: { codex_pending_price_id: '', codex_pending_price_from: '' },
      },
      expect.anything()
    );
  });

  it('latest wins: a second change overwrites the pending one', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({
        renewal: NOTICE_SEC + 10 * DAY,
        metadata: {
          codex_pending_price_id: 'price_first',
          codex_pending_price_from: '1',
        },
      })
    );

    await schedulePriceChange(stripe, {
      ...target,
      newPriceId: 'price_second',
    });

    expect(update.mock.calls[0]?.[1]).toMatchObject({
      metadata: { codex_pending_price_id: 'price_second' },
    });
  });
});

describe('applyDuePendingPriceChange', () => {
  const pending = {
    codex_pending_price_id: 'price_new',
    codex_pending_price_from: String(NOTICE_SEC + 30 * DAY),
  };

  it('swaps once the next renewal reaches the pending date', async () => {
    const sub = fakeSub({ renewal: NOTICE_SEC + 41 * DAY, metadata: pending });
    const { stripe, update } = fakeStripe(sub);

    expect(await applyDuePendingPriceChange(stripe, sub)).toBe(true);
    expect(update).toHaveBeenCalledWith(
      'sub_1',
      {
        items: [{ id: 'si_1', price: 'price_new' }],
        proration_behavior: 'none',
        metadata: { codex_pending_price_id: '', codex_pending_price_from: '' },
      },
      { idempotencyKey: 'price-change-apply:sub_1:price_new' }
    );
  });

  it('waits while the next renewal is still too soon', async () => {
    const sub = fakeSub({ renewal: NOTICE_SEC + 11 * DAY, metadata: pending });
    const { stripe, update } = fakeStripe(sub);

    expect(await applyDuePendingPriceChange(stripe, sub)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('waits while the subscription is not active', async () => {
    const sub = fakeSub({
      renewal: NOTICE_SEC + 41 * DAY,
      status: 'past_due',
      metadata: pending,
    });
    const { stripe, update } = fakeStripe(sub);

    expect(await applyDuePendingPriceChange(stripe, sub)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing without a pending change — and costs no Stripe call', async () => {
    const sub = fakeSub({ renewal: NOTICE_SEC + 41 * DAY });
    const { stripe, update } = fakeStripe(sub);

    expect(await applyDuePendingPriceChange(stripe, sub)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  // Codex-2hxff.3 review (H2): the decision is made on the LIVE subscription,
  // never the event's copy, which can be stale.
  describe('a stale event', () => {
    it('carrying a superseded marker defers to the newer live one', async () => {
      const stale = fakeSub({
        renewal: NOTICE_SEC + 41 * DAY,
        metadata: pending,
      });
      const live = fakeSub({
        renewal: NOTICE_SEC + 41 * DAY,
        metadata: {
          codex_pending_price_id: 'price_newer',
          codex_pending_price_from: String(NOTICE_SEC + 90 * DAY),
        },
      });
      const { stripe, update } = fakeStripe(live);

      expect(await applyDuePendingPriceChange(stripe, stale)).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });

    it('whose marker was cleared live (changeTier) swaps nothing', async () => {
      const stale = fakeSub({
        renewal: NOTICE_SEC + 41 * DAY,
        metadata: pending,
      });
      const live = fakeSub({
        renewal: NOTICE_SEC + 41 * DAY,
        priceId: 'price_other_tier',
      });
      const { stripe, update } = fakeStripe(live);

      expect(await applyDuePendingPriceChange(stripe, stale)).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });
  });
});

describe('firstRenewalOnOrAfter', () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  it('monthly: the renewal after a too-soon one', () => {
    expect(
      firstRenewalOnOrAfter({
        nextRenewal: at('2026-10-20T09:00:00Z'),
        anchor: at('2026-01-20T09:00:00Z'),
        interval: 'month',
        earliest: at('2026-11-12T12:00:00Z'),
      })
    ).toBe(at('2026-11-20T09:00:00Z'));
  });

  it("monthly: an anchor on the 31st renews on February's last day, then the 31st", () => {
    const args = {
      anchor: at('2026-01-31T09:00:00Z'),
      interval: 'month' as const,
    };
    expect(
      firstRenewalOnOrAfter({
        ...args,
        nextRenewal: at('2027-01-31T09:00:00Z'),
        earliest: at('2027-02-01T00:00:00Z'),
      })
    ).toBe(at('2027-02-28T09:00:00Z'));
    expect(
      firstRenewalOnOrAfter({
        ...args,
        nextRenewal: at('2027-02-28T09:00:00Z'),
        earliest: at('2027-03-01T00:00:00Z'),
      })
    ).toBe(at('2027-03-31T09:00:00Z'));
  });

  it('annual: a renewal inside the notice window moves a year on', () => {
    expect(
      firstRenewalOnOrAfter({
        nextRenewal: at('2026-10-25T09:00:00Z'),
        anchor: at('2024-10-25T09:00:00Z'),
        interval: 'year',
        earliest: at('2026-11-12T12:00:00Z'),
      })
    ).toBe(at('2027-10-25T09:00:00Z'));
  });
});
