/**
 * The 30-day price-change rule (Codex-2hxff.3) against a mocked Stripe.
 * The hourly step that works the recorded rows is covered in
 * price-moves-sweep.integration.test.ts; this file pins the per-subscription
 * decision, the notice-first order (D-P3, Codex-2hxff.43), the waiting-move
 * rules (Codex-2hxff.16, Part A rules 1 and 2) and the renewal-date
 * arithmetic.
 */
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PriceChangeStageError } from '../../errors';
import {
  applyDuePendingPriceChange,
  FAN_OUT_STRIPE_REQUEST,
  FAN_OUT_STRIPE_TIMEOUT_MS,
  firstRenewalOnOrAfter,
  isDefinitiveStripeRefusal,
  moveFailureAlert,
  noticeFailureAlert,
  PRICE_CHANGE_NOTICE_SECONDS,
  PRICE_NOTICE_TIMEOUT_MS,
  type PriceChangeNotice,
  platformWriteMetadata,
  schedulePriceChange,
  sendPriceChangeNotice,
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

function fakeStripe(
  subscription: Stripe.Subscription,
  archived: readonly string[] = []
) {
  const update = vi.fn().mockResolvedValue({});
  const prices = {
    retrieve: vi.fn(async (id: string) => ({
      id,
      active: !archived.includes(id),
    })),
    update: vi.fn(async (id: string) => ({ id, active: true })),
  };
  const stripe = {
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue(subscription),
      update,
    },
    prices,
  } as unknown as Stripe;
  return { stripe, update, prices };
}

const target = {
  stripeSubscriptionId: 'sub_1',
  newPriceId: 'price_new',
  newAmountCents: 700,
  interval: 'month' as const,
  noticeAt: NOTICE,
};

/** A notice notifications-api accepted. */
const accept = async () => true;

describe('schedulePriceChange', () => {
  it('renewal ≥ 30 days after the notice → swaps now with no proration', async () => {
    const renewal = NOTICE_SEC + 40 * DAY;
    const { stripe, update } = fakeStripe(fakeSub({ renewal }));

    const outcome = await schedulePriceChange(stripe, target, accept);

    expect(outcome).toEqual({
      kind: 'applied',
      effectiveAt: new Date(renewal * 1000),
      // What they pay today, read before the swap (Codex-2hxff.40).
      currentAmountCents: 500,
    });
    expect(update).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_new' }],
        proration_behavior: 'none',
      }),
      {
        timeout: 3_000,
        maxNetworkRetries: 0,
        idempotencyKey: 'price-change-now:sub_1:price_new',
      }
    );
  });

  it('renewal sooner → pending from exactly notice + 30 days; the item is untouched', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 10 * DAY })
    );

    const outcome = await schedulePriceChange(stripe, target, accept);

    expect(outcome).toMatchObject({ kind: 'pending', currentAmountCents: 500 });
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

  it('quotes a grandfathered subscriber their own amount, not the list price', async () => {
    const { stripe } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 40 * DAY, unitAmount: 350 })
    );

    const outcome = await schedulePriceChange(stripe, target, accept);

    expect(outcome).toMatchObject({ kind: 'applied', currentAmountCents: 350 });
  });

  it('never crosses intervals', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 200 * DAY, interval: 'year' })
    );

    const outcome = await schedulePriceChange(stripe, target, accept);

    expect(outcome).toEqual({ kind: 'skipped', reason: 'other_interval' });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['canceled', 'ended'],
    ['incomplete_expired', 'ended'],
  ] as const)('a %s subscription is skipped (%s): no notice, no write', async (status, reason) => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 40 * DAY, status })
    );
    const notify = vi.fn().mockResolvedValue(true);

    const outcome = await schedulePriceChange(stripe, target, notify);

    expect(outcome).toEqual({ kind: 'skipped', reason });
    expect(notify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a subscription with no items is skipped (no_items)', async () => {
    const sub = fakeSub({ renewal: NOTICE_SEC + 40 * DAY });
    (sub.items as { data: unknown[] }).data = [];
    const { stripe, update } = fakeStripe(sub);

    const outcome = await schedulePriceChange(stripe, target, accept);

    expect(outcome).toEqual({ kind: 'skipped', reason: 'no_items' });
    expect(update).not.toHaveBeenCalled();
  });

  // Part A rule 1 (Codex-2hxff.16): the live subscription is checked before
  // the email, as a move away can start after the row was written.
  it('skipLive names a reason: nobody is notified and nothing is written', async () => {
    const live = fakeSub({
      renewal: NOTICE_SEC + 40 * DAY,
      metadata: { codex_move_tier_id: 'tier_cheaper' },
    });
    const { stripe, update } = fakeStripe(live);
    const notify = vi.fn().mockResolvedValue(true);
    const skipLive = vi.fn(() => 'moving_away' as const);

    const outcome = await schedulePriceChange(
      stripe,
      { ...target, skipLive },
      notify
    );

    expect(outcome).toEqual({ kind: 'skipped', reason: 'moving_away' });
    expect(skipLive).toHaveBeenCalledWith(live);
    expect(notify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // Part A rule 2: a member waiting to move TO the repriced tier moves at the
  // price they confirmed; the new one starts at a renewal after the move, 30
  // days after their own notice, and is never swapped in now.
  describe('a member moving onto the tier (floorFrom)', () => {
    it('is left pending even when the next renewal is ≥ 30 days away', async () => {
      const renewal = NOTICE_SEC + 40 * DAY;
      const { stripe, update } = fakeStripe(fakeSub({ renewal }));
      // The move lands at this renewal; the floor is one second after it.
      const floorFrom = new Date((renewal + 1) * 1000);

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, floorFrom },
        accept
      );

      // The first renewal after the move: one month on.
      expect(outcome).toMatchObject({
        kind: 'pending',
        effectiveAt: new Date(
          firstRenewalOnOrAfter({
            nextRenewal: renewal,
            anchor: renewal,
            interval: 'month',
            earliest: renewal + 1,
          }) * 1000
        ),
      });
      expect(update.mock.calls[0]?.[1]).toEqual({
        metadata: {
          codex_pending_price_id: 'price_new',
          codex_pending_price_from: String(renewal + 1),
        },
      });
    });

    it('never swaps now, even when the floor has passed and the renewal is ≥ 30 days away', async () => {
      const renewal = NOTICE_SEC + 40 * DAY;
      const { stripe, update } = fakeStripe(fakeSub({ renewal }));

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, floorFrom: new Date((NOTICE_SEC + 5 * DAY) * 1000) },
        accept
      );

      expect(outcome).toMatchObject({
        kind: 'pending',
        effectiveAt: new Date(renewal * 1000),
      });
      expect(update.mock.calls[0]?.[1]).not.toHaveProperty('items');
    });

    it('the earliest date is max(notice + 30 days, floor): a floor before it changes nothing', async () => {
      const renewal = NOTICE_SEC + 10 * DAY;
      const { stripe, update } = fakeStripe(fakeSub({ renewal }));

      await schedulePriceChange(
        stripe,
        { ...target, floorFrom: new Date((renewal + 1) * 1000) },
        accept
      );

      expect(update.mock.calls[0]?.[1]).toEqual({
        metadata: {
          codex_pending_price_id: 'price_new',
          codex_pending_price_from: String(
            NOTICE_SEC + PRICE_CHANGE_NOTICE_SECONDS
          ),
        },
      });
    });
  });

  // Codex-2hxff.97: a switch to monthly billing waits for the year's end on
  // a Stripe schedule, and the item keeps the yearly Price until then.
  describe('a waiting change of billing, or a schedule attached', () => {
    const switching = {
      codex_move_tier_id: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b',
      codex_move_at: String(NOTICE_SEC + 40 * DAY),
      codex_hold_price_id: 'price_year',
      codex_hold_amount: '12000',
      codex_move_interval: 'month',
      codex_move_price_id: 'price_old',
      codex_move_amount: '500',
    };

    it('a mover onto the monthly price: judged on phase 2, quoted at what they will pay, the marker only', async () => {
      const renewal = NOTICE_SEC + 40 * DAY;
      const { stripe, update } = fakeStripe(
        fakeSub({
          renewal,
          interval: 'year',
          priceId: 'price_year',
          unitAmount: 12000,
          metadata: switching,
        })
      );

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, floorFrom: new Date((renewal + 1) * 1000) },
        accept
      );

      expect(outcome).toMatchObject({
        kind: 'pending',
        currentAmountCents: 500,
      });
      expect(update.mock.calls[0]?.[1]).not.toHaveProperty('items');
    });

    it('a change on the yearly price they are leaving: skipped, nothing written', async () => {
      const { stripe, update } = fakeStripe(
        fakeSub({
          renewal: NOTICE_SEC + 40 * DAY,
          interval: 'year',
          priceId: 'price_year',
          unitAmount: 12000,
          metadata: switching,
        })
      );

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, interval: 'year', newAmountCents: 13000 },
        accept
      );

      expect(outcome).toEqual({ kind: 'skipped', reason: 'other_interval' });
      expect(update).not.toHaveBeenCalled();
    });

    it('the same amount as phase 2: no item write (it would split the schedule)', async () => {
      const { stripe, update } = fakeStripe(
        fakeSub({
          renewal: NOTICE_SEC + 40 * DAY,
          interval: 'year',
          priceId: 'price_year',
          unitAmount: 12000,
          metadata: switching,
        })
      );

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, newAmountCents: 500 },
        accept
      );

      expect(outcome).toEqual({ kind: 'unchanged' });
      for (const [, params] of update.mock.calls) {
        expect(params).not.toHaveProperty('items');
      }
    });

    it('a schedule attached: the marker, never a swap now, even 30 days out', async () => {
      const renewal = NOTICE_SEC + 40 * DAY;
      const sub = fakeSub({ renewal });
      (sub as unknown as { schedule: string }).schedule = 'sub_sched_1';
      const { stripe, update } = fakeStripe(sub);

      const outcome = await schedulePriceChange(stripe, target, accept);

      expect(outcome).toMatchObject({ kind: 'pending' });
      expect(update.mock.calls[0]?.[1]).not.toHaveProperty('items');
    });
  });

  // The hourly step's last try for this person has an unknown outcome: the
  // email may have gone, or a run stopped after its write. Stripe already
  // carrying the change counts as moved: nothing is sent or written again.
  describe('a try whose outcome is unknown (mayBeTold)', () => {
    it('already on the new Price: moved, from the next renewal; not told again, nothing written', async () => {
      const renewal = NOTICE_SEC + 10 * DAY;
      const { stripe, update } = fakeStripe(
        fakeSub({ renewal, priceId: 'price_new', unitAmount: 700 })
      );
      const notify = vi.fn().mockResolvedValue(true);

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, mayBeTold: true },
        notify
      );

      expect(outcome).toEqual({
        kind: 'applied',
        effectiveAt: new Date(renewal * 1000),
        currentAmountCents: 700,
        landed: true,
      });
      expect(notify).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('marked pending for the new Price: moved, from the first renewal the marker allows; not told again', async () => {
      const renewal = NOTICE_SEC + 10 * DAY;
      const from = NOTICE_SEC + 31 * DAY;
      const { stripe, update } = fakeStripe(
        fakeSub({
          renewal,
          metadata: {
            codex_pending_price_id: 'price_new',
            codex_pending_price_from: String(from),
          },
        })
      );
      const notify = vi.fn().mockResolvedValue(true);

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, mayBeTold: true },
        notify
      );

      expect(outcome).toEqual({
        kind: 'pending',
        effectiveAt: new Date(
          firstRenewalOnOrAfter({
            nextRenewal: renewal,
            anchor: renewal,
            interval: 'month',
            earliest: from,
          }) * 1000
        ),
        currentAmountCents: 500,
        landed: true,
      });
      expect(notify).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('carrying another change: told and written as usual', async () => {
      const { stripe, update } = fakeStripe(
        fakeSub({
          renewal: NOTICE_SEC + 10 * DAY,
          metadata: {
            codex_pending_price_id: 'price_older',
            codex_pending_price_from: String(NOTICE_SEC + DAY),
          },
        })
      );
      const notify = vi.fn().mockResolvedValue(true);

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, mayBeTold: true },
        notify
      );

      expect(outcome.kind).toBe('pending');
      expect(outcome).not.toHaveProperty('landed');
      expect(notify).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledOnce();
    });
  });

  // Review C1, F1: the member can change plan while their notice is being
  // sent. The subscription is read again after the notice, and their change
  // is never written over.
  describe('a change of plan during the notice', () => {
    /** Stripe as it stands; `during` lands inside the notice. */
    function changingStripe(
      before: Stripe.Subscription,
      during: Stripe.Subscription
    ) {
      let current = before;
      const update = vi.fn().mockResolvedValue({});
      const stripe = {
        subscriptions: {
          retrieve: vi.fn(async () => current),
          update,
        },
      } as unknown as Stripe;
      const notify = vi.fn(async () => {
        current = during;
        return true;
      });
      return { stripe, update, notify };
    }
    /** The sweep's rule for a tier row on `tier_a`. */
    const leavingTierA = (live: Stripe.Subscription) => {
      const movingTo = live.metadata?.codex_move_tier_id;
      if (movingTo) return movingTo === 'tier_a' ? null : 'moving_away';
      const on = live.metadata?.codex_tier_id;
      return on && on !== 'tier_a' ? 'moving_away' : null;
    };
    const renewal = NOTICE_SEC + 40 * DAY;
    const onTierA = fakeSub({ renewal, metadata: { codex_tier_id: 'tier_a' } });

    it.each([
      [
        'a move to a cheaper tier',
        fakeSub({
          renewal,
          priceId: 'price_b',
          unitAmount: 300,
          metadata: {
            codex_tier_id: 'tier_a',
            codex_move_tier_id: 'tier_b',
            codex_move_at: String(renewal),
            codex_hold_price_id: 'price_old',
            codex_hold_amount: '500',
          },
        }),
      ],
      [
        'an upgrade',
        fakeSub({
          renewal,
          priceId: 'price_c',
          unitAmount: 900,
          metadata: { codex_tier_id: 'tier_c' },
        }),
      ],
    ])('%s: skipped, and nothing is written over it', async (_label, during) => {
      const { stripe, update, notify } = changingStripe(onTierA, during);

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, skipLive: leavingTierA },
        notify
      );

      expect(notify).toHaveBeenCalledOnce();
      expect(outcome).toEqual({ kind: 'skipped', reason: 'moving_away' });
      expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
      expect(update).not.toHaveBeenCalled();
    });

    it('a change that leaves them on the tier: the move is decided again, on what is there now', async () => {
      // Past due by the time the notice is accepted: no swap now, the marker.
      const { stripe, update, notify } = changingStripe(
        onTierA,
        fakeSub({
          renewal,
          status: 'past_due',
          metadata: { codex_tier_id: 'tier_a' },
        })
      );

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, skipLive: leavingTierA },
        notify
      );

      expect(outcome).toMatchObject({ kind: 'pending' });
      expect(update).toHaveBeenCalledOnce();
      expect(update.mock.calls[0]?.[1]).not.toHaveProperty('items');
    });

    it('found already on the new Price once told: moved, and not "landed" (the email went now)', async () => {
      const { stripe, update, notify } = changingStripe(
        onTierA,
        fakeSub({
          renewal,
          priceId: 'price_new',
          unitAmount: 700,
          metadata: { codex_tier_id: 'tier_a' },
        })
      );

      const outcome = await schedulePriceChange(stripe, target, notify);

      expect(outcome).toEqual({
        kind: 'applied',
        effectiveAt: new Date(renewal * 1000),
        currentAmountCents: 700,
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('nothing changed: the move is written from the first read', async () => {
      const { stripe, update, notify } = changingStripe(onTierA, onTierA);

      const outcome = await schedulePriceChange(
        stripe,
        { ...target, skipLive: leavingTierA },
        notify
      );

      expect(outcome).toMatchObject({ kind: 'applied' });
      expect(update).toHaveBeenCalledWith(
        'sub_1',
        expect.objectContaining({
          items: [{ id: 'si_1', price: 'price_new' }],
        }),
        expect.anything()
      );
    });
  });

  it('a past-due subscription is marked pending even when its renewal is far off', async () => {
    const { stripe, update } = fakeStripe(
      fakeSub({ renewal: NOTICE_SEC + 40 * DAY, status: 'past_due' })
    );

    const outcome = await schedulePriceChange(stripe, target, accept);

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

    const outcome = await schedulePriceChange(stripe, target, accept);

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

    await schedulePriceChange(
      stripe,
      {
        ...target,
        newPriceId: 'price_second',
      },
      accept
    );

    expect(update.mock.calls[0]?.[1]).toMatchObject({
      metadata: { codex_pending_price_id: 'price_second' },
    });
  });

  // Owner decision D-P3 (Codex-2hxff.43): the move is written only after the
  // subscriber's notice is accepted.
  describe('notice first, then move', () => {
    it.each([
      ['a swap now', 40],
      ['a pending marker', 10],
    ] as const)('a notice not accepted writes nothing: no %s', async (_label, renewsInDays) => {
      const { stripe, update } = fakeStripe(
        fakeSub({ renewal: NOTICE_SEC + renewsInDays * DAY })
      );
      const notify = vi.fn().mockResolvedValue(false);

      const outcome = await schedulePriceChange(stripe, target, notify);

      expect(outcome).toEqual({ kind: 'unnotified' });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it('the notice quotes the move, and is sent before it is written', async () => {
      const renewal = NOTICE_SEC + 40 * DAY;
      const { stripe, update } = fakeStripe(
        fakeSub({ renewal, unitAmount: 350 })
      );
      const order: string[] = [];
      update.mockImplementation(async () => {
        order.push('update');
        return {};
      });
      const notify = vi.fn().mockImplementation(async () => {
        order.push('notify');
        return true;
      });

      await schedulePriceChange(stripe, target, notify);

      expect(notify).toHaveBeenCalledWith({
        kind: 'applied',
        effectiveAt: new Date(renewal * 1000),
        currentAmountCents: 350,
        currentPending: null,
      });
      expect(order).toEqual(['notify', 'update']);
    });

    // Review A, correctness #6: a refused notice leaves an earlier accepted
    // change standing, so the alert must say where the subscriber lands.
    it('the notice carries an earlier pending change, which a refusal leaves standing', async () => {
      const from = NOTICE_SEC + 5 * DAY;
      const { stripe, update } = fakeStripe(
        fakeSub({
          renewal: NOTICE_SEC + 10 * DAY,
          metadata: {
            codex_pending_price_id: 'price_earlier',
            codex_pending_price_from: String(from),
          },
        })
      );
      const notify = vi.fn().mockResolvedValue(false);

      await schedulePriceChange(stripe, target, notify);

      expect(notify.mock.calls[0]?.[0]).toMatchObject({
        currentPending: {
          priceId: 'price_earlier',
          from: new Date(from * 1000),
        },
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('a notice that rejects writes nothing, and the rejection propagates', async () => {
      const { stripe, update } = fakeStripe(
        fakeSub({ renewal: NOTICE_SEC + 40 * DAY })
      );

      await expect(
        schedulePriceChange(stripe, target, async () => {
          throw new Error('mailer blew up');
        })
      ).rejects.toThrow('mailer blew up');
      expect(update).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the amount is unchanged',
        fakeSub({ renewal: NOTICE_SEC + 10 * DAY, unitAmount: 700 }),
      ],
      [
        'the subscription is on another interval',
        fakeSub({ renewal: NOTICE_SEC + 200 * DAY, interval: 'year' }),
      ],
    ])('nobody is notified when %s', async (_label, subscription) => {
      const { stripe } = fakeStripe(subscription);
      const notify = vi.fn().mockResolvedValue(true);

      await schedulePriceChange(stripe, target, notify);

      expect(notify).not.toHaveBeenCalled();
    });
  });

  // Review A round 2, correctness #1 / silent R2: the SDK's defaults (80 s,
  // two retries) would let one slow call hold up a whole batch of the hourly
  // step, so every call on a subscriber's path carries its own timeout. The
  // path makes one read and at most one write, and a second read after an
  // accepted notice (F1).
  describe('every Stripe call has a 3 s timeout and no retry', () => {
    it.each([
      ['a swap now', fakeSub({ renewal: NOTICE_SEC + 40 * DAY }), 2],
      ['a pending marker', fakeSub({ renewal: NOTICE_SEC + 10 * DAY }), 2],
      [
        'a same-amount swap',
        fakeSub({ renewal: NOTICE_SEC + 10 * DAY, unitAmount: 700 }),
        1,
      ],
      [
        'a same-amount clear',
        fakeSub({
          renewal: NOTICE_SEC + 10 * DAY,
          unitAmount: 700,
          priceId: 'price_new',
          metadata: {
            codex_pending_price_id: 'price_earlier',
            codex_pending_price_from: String(NOTICE_SEC + 5 * DAY),
          },
        }),
        1,
      ],
    ])('%s', async (_label, subscription, reads) => {
      const { stripe, update } = fakeStripe(subscription);
      const retrieve = vi.mocked(stripe.subscriptions.retrieve);

      await schedulePriceChange(stripe, target, accept);

      expect(FAN_OUT_STRIPE_REQUEST).toEqual({
        timeout: 3_000,
        maxNetworkRetries: 0,
      });
      expect(retrieve).toHaveBeenCalledTimes(reads);
      for (const call of retrieve.mock.calls) {
        expect(call).toEqual(['sub_1', FAN_OUT_STRIPE_REQUEST]);
      }
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]?.[2]).toMatchObject(FAN_OUT_STRIPE_REQUEST);
    });

    it('a subscriber waits at most 3 s per Stripe call and 5 s for the notice', () => {
      expect(FAN_OUT_STRIPE_TIMEOUT_MS).toBe(3_000);
      expect(PRICE_NOTICE_TIMEOUT_MS).toBe(5_000);
    });

    // What stripe-node throws when the timeout fires (RequestSender): a
    // connection error with no status.
    const timedOut = () =>
      new Stripe.errors.StripeConnectionError({
        type: 'api_error',
        message: 'Request aborted due to timeout being reached (3000ms)',
      });

    it('a timed-out read: could not read; not notified, not moved', async () => {
      const { stripe, update } = fakeStripe(fakeSub({ renewal: 0 }));
      vi.mocked(stripe.subscriptions.retrieve).mockRejectedValue(timedOut());
      const notify = vi.fn().mockResolvedValue(true);

      const error = await schedulePriceChange(stripe, target, notify).catch(
        (e: unknown) => e
      );
      const alert = moveFailureAlert('Tier: ', error, undefined, NOTICE);

      expect(alert.message).toContain('could not read the Stripe subscription');
      expect(alert.data).toMatchObject({
        outcome: 'not_moved',
        notified: false,
        stage: 'read',
        error: 'Request aborted due to timeout being reached (3000ms)',
      });
      expect(notify).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('a timed-out write after an accepted notice: the move is "outcome unknown"', async () => {
      const renewal = NOTICE_SEC + 40 * DAY;
      const { stripe, update } = fakeStripe(fakeSub({ renewal }));
      update.mockRejectedValue(timedOut());
      let accepted: PriceChangeNotice | undefined;

      const error = await schedulePriceChange(stripe, target, async (n) => {
        accepted = n;
        return true;
      }).catch((e: unknown) => e);
      const alert = moveFailureAlert('Tier: ', error, accepted, NOTICE);

      expect(alert.message).toContain(
        "notice sent; the move's outcome is unknown"
      );
      expect(alert.data).toMatchObject({
        outcome: 'move_unknown',
        notified: true,
        kind: 'applied',
      });
    });
  });

  // Review A round 2, correctness #2: a failed same-amount WRITE was
  // reported as "could not read the subscription". It names its stage, and
  // carries the pending change it failed to clear.
  describe('a failed same-amount write names its stage', () => {
    const from = NOTICE_SEC + 5 * DAY;
    const earlier = {
      codex_pending_price_id: 'price_earlier',
      codex_pending_price_from: String(from),
    };

    it.each([
      [
        'same_amount_swap',
        fakeSub({
          renewal: NOTICE_SEC + 10 * DAY,
          unitAmount: 700,
          metadata: earlier,
        }),
      ],
      [
        'same_amount_clear',
        fakeSub({
          renewal: NOTICE_SEC + 10 * DAY,
          unitAmount: 700,
          priceId: 'price_new',
          metadata: earlier,
        }),
      ],
    ] as const)('%s', async (stage, subscription) => {
      const { stripe, update } = fakeStripe(subscription);
      update.mockRejectedValue(
        Object.assign(new Error('down'), { statusCode: 500 })
      );

      const error = await schedulePriceChange(stripe, target, accept).catch(
        (e: unknown) => e
      );
      const alert = moveFailureAlert('Tier: ', error, undefined, NOTICE);

      expect(error).toBeInstanceOf(PriceChangeStageError);
      expect(error).toMatchObject({
        stage,
        currentPending: {
          priceId: 'price_earlier',
          from: new Date(from * 1000),
        },
      });
      expect(alert.message).toContain(
        'same-amount write failed; an earlier pending change may still land: price_earlier'
      );
      expect(alert.message).not.toContain('could not read');
      expect(alert.data).toMatchObject({
        outcome: 'same_amount_write_failed',
        notified: false,
        stage,
        definitive: false,
        currentPendingPriceId: 'price_earlier',
        currentPendingFrom: new Date(from * 1000).toISOString(),
        error: 'down',
      });
    });
  });
});

describe('sendPriceChangeNotice', () => {
  const params = {
    to: 'sub@example.test' as string | null,
    templateName: 'subscription-tier-price-change' as const,
    category: 'transactional' as const,
    userId: 'user_1',
    data: { planName: 'Basic' },
  };

  it('accepted → null, and the mailer gets the notice', async () => {
    const mailer = vi.fn().mockResolvedValue({ accepted: true });

    await expect(sendPriceChangeNotice(mailer, params)).resolves.toBeNull();
    expect(mailer).toHaveBeenCalledWith(params);
  });

  it.each([
    [
      'no address',
      vi.fn().mockResolvedValue({ accepted: true }),
      null,
      { reason: 'no_address' },
    ],
    [
      'a 4xx refusal',
      vi.fn().mockResolvedValue({ accepted: false, status: 422 }),
      params.to,
      { reason: 'refused', status: 422 },
    ],
    [
      'a skip',
      vi.fn().mockResolvedValue({ accepted: false, skipped: 'opted_out' }),
      params.to,
      { reason: 'skipped', skipped: 'opted_out' },
    ],
    // Review A, silent #8: these may have been delivered.
    [
      'a 5xx (unknown)',
      vi.fn().mockResolvedValue({ accepted: false, status: 500 }),
      params.to,
      { reason: 'unknown', status: 500 },
    ],
    [
      'a transport failure (unknown)',
      vi.fn().mockResolvedValue({ accepted: false, error: 'timeout' }),
      params.to,
      { reason: 'unknown', error: 'timeout' },
    ],
    [
      'a mailer that rejects (unknown)',
      vi.fn().mockRejectedValue(new Error('boom')),
      params.to,
      { reason: 'unknown', error: 'boom' },
    ],
  ] as const)('%s → not accepted', async (_label, mailer, to, failure) => {
    await expect(
      sendPriceChangeNotice(mailer, { ...params, to })
    ).resolves.toEqual(failure);
  });
});

// Review A, silent #7 and #8: an alert says only what is certain.
describe('the price-change alerts', () => {
  const notice: PriceChangeNotice = {
    kind: 'pending',
    effectiveAt: new Date('2026-12-14T00:00:00Z'),
    currentAmountCents: 500,
    currentPending: null,
  };

  it.each([
    [
      { reason: 'refused', status: 422 } as const,
      'not sent',
      'notice_not_sent',
    ],
    [{ reason: 'no_address' } as const, 'not sent', 'notice_not_sent'],
    [
      { reason: 'unknown', error: 'timeout' } as const,
      'outcome unknown',
      'notice_unknown',
    ],
  ])('a notice failure %o says "%s"', (failure, says, outcome) => {
    const alert = noticeFailureAlert('Tier: ', failure, notice);

    expect(alert.message).toContain(says);
    expect(alert.data).toMatchObject({ outcome, kind: 'pending' });
    if (outcome === 'notice_unknown') {
      expect(alert.message).not.toContain('not sent');
      expect(alert.message).not.toContain('kept on the old price');
    }
  });

  it('a refusal names an earlier pending change instead of "the old price"', () => {
    const alert = noticeFailureAlert(
      'Tier: ',
      { reason: 'refused', status: 422 },
      {
        ...notice,
        currentPending: {
          priceId: 'price_earlier',
          from: new Date('2026-11-01T00:00:00Z'),
        },
      }
    );

    expect(alert.message).toContain('earlier accepted change to price_earlier');
    expect(alert.message).not.toContain('old price');
    expect(alert.data).toMatchObject({
      currentPendingPriceId: 'price_earlier',
      currentPendingFrom: '2026-11-01T00:00:00.000Z',
    });
  });

  it.each([
    [
      Object.assign(new Error('bad'), { statusCode: 400 }),
      'move_refused',
      'refused the move',
    ],
    [
      Object.assign(new Error('down'), { statusCode: 500 }),
      'move_unknown',
      'outcome is unknown',
    ],
    [
      Object.assign(new Error('busy'), { statusCode: 409 }),
      'move_unknown',
      'outcome is unknown',
    ],
    [new Error('socket hang up'), 'move_unknown', 'outcome is unknown'],
  ])('after an accepted notice, %s → %s', (error, outcome, says) => {
    const noticeAt = new Date('2026-11-14T00:00:00Z');
    const alert = moveFailureAlert('Tier: ', error, notice, noticeAt);

    expect(alert.message).toContain(says);
    expect(alert.data).toMatchObject({
      outcome,
      notified: true,
      kind: 'pending',
      noticeAt: '2026-11-14T00:00:00.000Z',
      effectiveAt: '2026-12-14T00:00:00.000Z',
    });
  });

  // This test used to hand in ANY error without a notice and expect "not
  // notified and not moved" from a failed read. That pinned the defect: a
  // failed same-amount WRITE has no notice either, and was reported as a
  // failed read, hiding the pending change it may leave to land (review A
  // round 2, correctness #2). The read is now named by its stage, and a
  // same-amount write gets its own alert.
  it('a failed read (stage "read") is not notified and not moved', () => {
    const alert = moveFailureAlert(
      'Tier: ',
      new PriceChangeStageError('read', null, new Error('x')),
      undefined,
      new Date()
    );

    expect(alert.message).toContain('could not read the Stripe subscription');
    expect(alert.data).toMatchObject({
      outcome: 'not_moved',
      notified: false,
      stage: 'read',
      error: 'x',
    });
  });

  it.each([
    [400, true, 'pending-marker clear, refused by Stripe'],
    [500, false, 'pending-marker clear, outcome unknown'],
  ])('a same-amount write failing with %s says whether Stripe refused it', (statusCode, definitive, says) => {
    const pending = {
      priceId: 'price_earlier',
      from: new Date('2026-11-01T00:00:00Z'),
    };
    const alert = moveFailureAlert(
      'Tier: ',
      new PriceChangeStageError(
        'same_amount_clear',
        pending,
        Object.assign(new Error('stripe says no'), { statusCode })
      ),
      undefined,
      new Date()
    );

    expect(alert.message).toContain(
      'same-amount write failed; an earlier pending change may still land: price_earlier, due from 2026-11-01T00:00:00.000Z'
    );
    expect(alert.message).toContain(says);
    expect(alert.data).toMatchObject({
      outcome: 'same_amount_write_failed',
      stage: 'same_amount_clear',
      definitive,
      error: 'stripe says no',
    });
  });

  it('a same-amount swap with no pending change says nothing is left to land', () => {
    const alert = moveFailureAlert(
      'Tier: ',
      new PriceChangeStageError('same_amount_swap', null, new Error('down')),
      undefined,
      new Date()
    );

    expect(alert.message).toContain('same-amount write failed (item swap');
    expect(alert.message).toContain('no earlier change is pending');
    expect(alert.data).toMatchObject({
      outcome: 'same_amount_write_failed',
      currentPendingPriceId: null,
    });
  });

  it('a failure that is not a Stripe call, before any notice, is not called a read', () => {
    const alert = moveFailureAlert(
      'Tier: ',
      new Error('mailer blew up'),
      undefined,
      new Date()
    );

    expect(alert.message).toContain('failed before the notice was accepted');
    expect(alert.message).not.toContain('could not read');
    expect(alert.data).toMatchObject({ outcome: 'not_moved', notified: false });
  });

  it.each([
    [400, true],
    [404, true],
    [409, false],
    [429, false],
    [500, false],
    [undefined, false],
  ])('isDefinitiveStripeRefusal(%s) is %s', (statusCode, definitive) => {
    expect(isDefinitiveStripeRefusal({ statusCode })).toBe(definitive);
  });
});

describe('applyDuePendingPriceChange', () => {
  const pending = {
    codex_pending_price_id: 'price_new',
    codex_pending_price_from: String(NOTICE_SEC + 30 * DAY),
  };

  it('swaps once the next renewal reaches the pending date', async () => {
    const sub = fakeSub({ renewal: NOTICE_SEC + 41 * DAY, metadata: pending });
    const { stripe, update, prices } = fakeStripe(sub);

    expect(await applyDuePendingPriceChange(stripe, sub)).toBe(true);
    expect(prices.update).not.toHaveBeenCalled();
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

  // Review C1, F2: a newer save archived the pending Price before the step
  // reached this subscriber. Their accepted change still lands.
  it('a pending Price a newer save archived is made billable first, then swapped in', async () => {
    const sub = fakeSub({ renewal: NOTICE_SEC + 41 * DAY, metadata: pending });
    const { stripe, update, prices } = fakeStripe(sub, ['price_new']);
    const order: string[] = [];
    prices.update.mockImplementation(async (id: string) => {
      order.push('activate');
      return { id, active: true };
    });
    update.mockImplementation(async () => {
      order.push('swap');
      return {};
    });

    expect(await applyDuePendingPriceChange(stripe, sub)).toBe(true);
    expect(prices.update).toHaveBeenCalledExactlyOnceWith('price_new', {
      active: true,
      metadata: { codex_platform_write: expect.any(String) },
    });
    expect(order).toEqual(['activate', 'swap']);
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

describe('platformWriteMetadata', () => {
  // The price.updated webhook knows our write by the key CHANGING, so two
  // writes to the same Price must never carry the same value.
  it('gives every write a fresh codex_platform_write', () => {
    const first = platformWriteMetadata();
    const second = platformWriteMetadata();
    expect(Object.keys(first)).toEqual(['codex_platform_write']);
    expect(first.codex_platform_write).toEqual(expect.any(String));
    expect(second.codex_platform_write).not.toBe(first.codex_platform_write);
  });
});
