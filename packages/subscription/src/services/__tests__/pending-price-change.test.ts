/**
 * The 30-day price-change rule (Codex-2hxff.3) against a mocked Stripe.
 * The fan-out services are covered in subscription-service.test.ts; this file
 * pins the per-subscription decision, the notice-first order (D-P3,
 * Codex-2hxff.43) and the renewal-date arithmetic.
 */
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  alertFanOutOutOfTime,
  applyDuePendingPriceChange,
  FAN_OUT_ALERT_CHUNK,
  firstRenewalOnOrAfter,
  isDefinitiveStripeRefusal,
  moveFailureAlert,
  noticeFailureAlert,
  PRICE_CHANGE_NOTICE_SECONDS,
  type PriceChangeNotice,
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
      { idempotencyKey: 'price-change-now:sub_1:price_new' }
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

    expect(outcome.kind).toBe('skipped');
    expect(update).not.toHaveBeenCalled();
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

  it('a failed read (no notice) is not notified and not moved', () => {
    const alert = moveFailureAlert(
      'Tier: ',
      new Error('x'),
      undefined,
      new Date()
    );

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

// Review A, silent #1: one alert, one errorId, at most 200 ids per line.
describe('alertFanOutOutOfTime', () => {
  it('splits the subscribers into lines of at most 200 that share one errorId', () => {
    const logError = vi.fn();
    const subscribers = Array.from({ length: 450 }, (_, n) => ({
      subscriptionId: `sub_${n}`,
    }));

    alertFanOutOutOfTime(logError, {
      errorId: 'err_1',
      context: { tierId: 'tier_1' },
      subscribers,
    });

    expect(FAN_OUT_ALERT_CHUNK).toBe(200);
    expect(logError).toHaveBeenCalledTimes(3);
    const lines = logError.mock.calls.map(([, data]) => data);
    expect(lines.map((data) => data.subscribers.length)).toEqual([
      200, 200, 50,
    ]);
    for (const [n, data] of lines.entries()) {
      expect(data).toMatchObject({
        errorId: 'err_1',
        tierId: 'tier_1',
        unhandled: 450,
        chunk: n + 1,
        chunks: 3,
      });
    }
    expect(lines.flatMap((data) => data.subscribers)).toEqual(subscribers);
    expect(String(logError.mock.calls[0]?.[0])).toContain(
      'ran out of time; these subscribers were not notified or moved'
    );
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
