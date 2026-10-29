/**
 * The bank-payout formula and its clock (Codex-2hxff.29, .30): pure, no
 * database and no Stripe. Design: batch-b-data-design.md §3.2-§3.3, §4.1, §5.4.
 */

import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  BANK_HOLD_MS,
  type BankTransfer,
  bankOnFor,
  chargeTimesWanted,
  debtRule,
  episodeCausesFrom,
  firstLondon0800After,
  gbpBalance,
  isBankPayoutRun,
  isSubrequestLimit,
  type LedgerSale,
  londonDate,
  londonDaysBetween,
  nextBalanceEpisode,
  payoutReleasedBankFields,
  planBankPayout,
  planBankPayouts,
  projectNextPayout,
  runReadingEnd,
  type TakeBackCause,
  takeBackKind,
  toBankTransfer,
  towardsTakeBack,
  type UnsentSale,
  unsentSales,
  withChargeTimes,
} from '../bank-payouts';

const at = (iso: string) => new Date(iso);
const DAY = 24 * 60 * 60 * 1000;

/** A sale's transfer: its charge was made `daysAgo` before `runAt`. */
function sale(
  id: string,
  runAt: Date,
  daysAgo: number,
  netCents: number
): BankTransfer {
  return {
    id,
    netCents,
    chargeCreatedMs: runAt.getTime() - daysAgo * DAY,
  };
}

/** A Stripe transfer as `transfers.list` returns it, expanded. */
function stripeTransfer(overrides: {
  id?: string;
  amount: number;
  amount_reversed?: number;
  currency?: string;
  created: number;
  source_transaction: { object: 'charge'; created: number } | string | null;
}): Stripe.Transfer {
  return {
    id: overrides.id ?? 'tr_1',
    object: 'transfer',
    amount: overrides.amount,
    amount_reversed: overrides.amount_reversed ?? 0,
    currency: overrides.currency ?? 'gbp',
    created: overrides.created,
    source_transaction: overrides.source_transaction,
  } as unknown as Stripe.Transfer;
}

describe('planBankPayout (§3.2)', () => {
  const runAt = at('2027-01-15T08:00:00Z');

  it.each([
    {
      name: 'no young money: everything available goes',
      balance: { availableCents: 5000, pendingCents: 0 },
      transfers: [sale('tr_old', runAt, 30, 5000)],
      expected: { youngCents: 0, heldCents: 0, payoutCents: 5000 },
    },
    {
      name: 'all the young money still pending: the available is old',
      balance: { availableCents: 2000, pendingCents: 3000 },
      transfers: [sale('tr_a', runAt, 1, 1000), sale('tr_b', runAt, 2, 2000)],
      expected: { youngCents: 3000, heldCents: 0, payoutCents: 2000 },
    },
    {
      // The design's worked example.
      name: 'some young money available: only the old part goes (£100.00)',
      balance: { availableCents: 12_000, pendingCents: 3000 },
      transfers: [
        sale('tr_d2', runAt, 2, 2000),
        sale('tr_d3', runAt, 3, 1000),
        sale('tr_d9', runAt, 9, 2500 - 500),
      ],
      expected: { youngCents: 5000, heldCents: 2000, payoutCents: 10_000 },
    },
    {
      name: 'a young transfer partly reversed is held for what is left of it',
      balance: { availableCents: 3000, pendingCents: 0 },
      transfers: [sale('tr_part', runAt, 5, 2500 - 1000)],
      expected: { youngCents: 1500, heldCents: 1500, payoutCents: 1500 },
    },
    {
      name: 'available below zero: nothing goes',
      balance: { availableCents: -800, pendingCents: 0 },
      transfers: [],
      expected: { youngCents: 0, heldCents: 0, payoutCents: 0 },
    },
  ])('$name', ({ balance, transfers, expected }) => {
    expect(planBankPayout({ runAt, balance, transfers })).toEqual({
      ...expected,
      pendingExceedsYoung: false,
    });
  });

  it('pending above young: ALL the young money is held, never young money early', () => {
    const plan = planBankPayout({
      runAt,
      balance: { availableCents: 1000, pendingCents: 500 },
      transfers: [sale('tr_y', runAt, 4, 300)],
    });
    expect(plan).toEqual({
      youngCents: 300,
      heldCents: 300,
      payoutCents: 700,
      pendingExceedsYoung: true,
    });
  });

  it('ignores non-GBP money in the balance and in the transfers', () => {
    expect(
      gbpBalance({
        available: [
          { amount: 1200, currency: 'gbp', source_types: {} },
          { amount: 999, currency: 'eur', source_types: {} },
        ],
        pending: [{ amount: 50, currency: 'usd', source_types: {} }],
      } as unknown as Stripe.Balance)
    ).toEqual({
      availableCents: 1200,
      pendingCents: 0,
      pots: [{ sourceType: 'card', availableCents: 1200, pendingCents: 0 }],
    });
    expect(
      toBankTransfer(
        stripeTransfer({
          amount: 500,
          currency: 'eur',
          created: 1,
          source_transaction: null,
        })
      )
    ).toBeNull();
  });

  // A won chargeback's re-pay and support's .72 Re-pay are both payouts rows
  // with no charge, so the drain sends them from the platform balance with no
  // source_transaction. Paid 5 minutes before the run, already available.
  it.each([
    { kind: 'a won chargeback re-pay' },
    { kind: 'a .72 Re-pay' },
  ])('$kind is never young: paid in full at this run, as if old', () => {
    const runSeconds = runAt.getTime() / 1000;
    const repay = toBankTransfer(
      stripeTransfer({
        id: 'tr_repay',
        amount: 840,
        created: runSeconds - 5 * 60,
        source_transaction: null,
      })
    );
    expect(repay).toEqual({
      id: 'tr_repay',
      netCents: 840,
      chargeCreatedMs: null,
      sourceType: 'card',
    });
    const young = sale('tr_young', runAt, 3, 1000);
    const balance = { availableCents: 840 + 1000, pendingCents: 0 };
    const withRepay = planBankPayout({
      runAt,
      balance,
      transfers: [repay as BankTransfer, young],
    });
    const asOldSale = planBankPayout({
      runAt,
      balance,
      transfers: [sale('tr_repay', runAt, 40, 840), young],
    });
    expect(withRepay.payoutCents).toBe(840);
    expect(withRepay).toEqual(asOldSale);
  });

  it('a day-40 drain transfer of an old charge is judged by the charge: old', () => {
    const runSeconds = runAt.getTime() / 1000;
    const drained = toBankTransfer(
      stripeTransfer({
        amount: 1500,
        created: runSeconds - 60 * 60,
        source_transaction: {
          object: 'charge',
          created: runSeconds - 40 * 24 * 60 * 60,
        },
      })
    );
    expect(
      planBankPayout({
        runAt,
        balance: { availableCents: 1500, pendingCents: 0 },
        transfers: [drained as BankTransfer],
      }).payoutCents
    ).toBe(1500);
  });

  it('a source left as a bare id is held by the transfer time (it can only hold longer)', () => {
    const runSeconds = runAt.getTime() / 1000;
    const transfer = toBankTransfer(
      stripeTransfer({
        amount: 700,
        created: runSeconds - 2 * 24 * 60 * 60,
        source_transaction: 'ch_unexpanded',
      })
    );
    expect(transfer?.chargeCreatedMs).toBe((runSeconds - 2 * 86_400) * 1000);
  });

  it('the boundary: a charge 1 ms older than the cutoff is old; exactly at it, young', () => {
    const cutoff = runAt.getTime() - BANK_HOLD_MS;
    const balance = { availableCents: 1000, pendingCents: 0 };
    const old = planBankPayout({
      runAt,
      balance,
      transfers: [{ id: 'tr_b', netCents: 1000, chargeCreatedMs: cutoff - 1 }],
    });
    const young = planBankPayout({
      runAt,
      balance,
      transfers: [{ id: 'tr_b', netCents: 1000, chargeCreatedMs: cutoff }],
    });
    expect(old.payoutCents).toBe(1000);
    expect(young.payoutCents).toBe(0);
  });
});

// HIGH-1, owner: "Pay each pot separately". Stripe keeps a balance per source
// type and a payout draws on one, so each pot is paid on its own formula.
describe('each pot separately (planBankPayouts)', () => {
  const runAt = at('2027-01-14T08:00:00Z');
  const twoPots = (card: number, bankAccount: number) =>
    gbpBalance({
      available: [
        {
          amount: card + bankAccount,
          currency: 'gbp',
          source_types: { bank_account: bankAccount, card },
        },
      ],
      pending: [{ amount: 0, currency: 'gbp', source_types: { card: 0 } }],
    } as unknown as Stripe.Balance);

  it('reads each source type into its own pot, card first', () => {
    expect(
      gbpBalance({
        available: [
          {
            amount: 1500,
            currency: 'gbp',
            source_types: { bank_account: 500, card: 1000 },
          },
        ],
        pending: [
          {
            amount: 200,
            currency: 'gbp',
            source_types: { bank_account: 200, card: 0 },
          },
        ],
      } as unknown as Stripe.Balance)
    ).toEqual({
      availableCents: 1500,
      pendingCents: 200,
      pots: [
        { sourceType: 'card', availableCents: 1000, pendingCents: 0 },
        { sourceType: 'bank_account', availableCents: 500, pendingCents: 200 },
      ],
    });
  });

  it('a transfer carries its pot; one Stripe gives no source type is card', () => {
    const transfer = stripeTransfer({
      amount: 300,
      created: 1,
      source_transaction: null,
    });
    expect(
      toBankTransfer({
        ...transfer,
        source_type: 'bank_account',
      } as Stripe.Transfer)?.sourceType
    ).toBe('bank_account');
    expect(toBankTransfer(transfer)?.sourceType).toBe('card');
  });

  it('a young bank_account transfer holds only its own pot', () => {
    const plans = planBankPayouts({
      runAt,
      balance: twoPots(2000, 1000),
      transfers: [
        { ...sale('tr_ach', runAt, 3, 600), sourceType: 'bank_account' },
        sale('tr_old', runAt, 30, 2000),
      ],
    });
    expect(
      plans.map(({ sourceType, heldCents, payoutCents }) => ({
        sourceType,
        heldCents,
        payoutCents,
      }))
    ).toEqual([
      { sourceType: 'card', heldCents: 0, payoutCents: 2000 },
      { sourceType: 'bank_account', heldCents: 600, payoutCents: 400 },
    ]);
  });

  it('a debt in one pot is not netted against the other', () => {
    expect(
      planBankPayouts({
        runAt,
        balance: twoPots(-500, 800),
        transfers: [],
      }).map((plan) => plan.payoutCents)
    ).toEqual([0, 800]);
  });

  it('one pot, as every GBP balance is today: the same plan as before', () => {
    const balance = { availableCents: 12_000, pendingCents: 3000 };
    const transfers = [
      sale('tr_d2', runAt, 2, 2000),
      sale('tr_d3', runAt, 3, 1000),
      sale('tr_d9', runAt, 9, 2000),
    ];
    const before = planBankPayout({ runAt, balance, transfers });
    expect(before.payoutCents).toBe(10_000);
    expect(planBankPayouts({ runAt, balance, transfers })).toEqual([
      { sourceType: 'card', ...balance, ...before },
    ]);
    expect(
      planBankPayouts({
        runAt,
        balance: gbpBalance({
          available: [
            { amount: 12_000, currency: 'gbp', source_types: { card: 12_000 } },
          ],
          pending: [
            { amount: 3000, currency: 'gbp', source_types: { card: 3000 } },
          ],
        } as unknown as Stripe.Balance),
        transfers,
      })
    ).toEqual([{ sourceType: 'card', ...balance, ...before }]);
  });
});

// Amendment 3 (owner: "Exact amounts, oldest first").
describe('towardsTakeBack', () => {
  const sale = (payoutId: string, iso: string, netCents: number) => ({
    payoutId,
    netCents,
    soldAt: at(iso),
  });

  it('the owner’s example: £6 and £2.40 went towards the −£8.40; £8.60 goes to the bank', () => {
    // A £6 sale whose bank day ran in the episode, and a young £11 that
    // cleared it: at the clearing reading the balance held £8.60.
    expect(
      towardsTakeBack({
        sales: [
          sale('young11', '2026-10-30T12:00:00Z', 1100),
          sale('old6', '2026-10-14T12:00:00Z', 600),
        ],
        inStripeCents: 860,
      })
    ).toEqual({
      cents: 840,
      rows: [
        { payoutId: 'old6', towardsCents: 600 },
        { payoutId: 'young11', towardsCents: 240 },
      ],
    });
  });

  it('below zero, all of it went towards the take-back', () => {
    expect(
      towardsTakeBack({
        sales: [
          sale('a', '2026-10-14T12:00:00Z', 600),
          sale('b', '2026-10-20T12:00:00Z', 1100),
        ],
        inStripeCents: -840,
      })
    ).toEqual({
      cents: 1700,
      rows: [
        { payoutId: 'a', towardsCents: 600 },
        { payoutId: 'b', towardsCents: 1100 },
      ],
    });
  });

  it('nothing went towards when Stripe holds all of it, or more', () => {
    const sales = [sale('a', '2026-10-14T12:00:00Z', 600)];
    expect(towardsTakeBack({ sales, inStripeCents: 600 })).toEqual({
      cents: 0,
      rows: [],
    });
    expect(towardsTakeBack({ sales, inStripeCents: 900 })).toEqual({
      cents: 0,
      rows: [],
    });
  });

  it('same sale time: by id', () => {
    const sameTime = '2026-10-14T12:00:00Z';
    expect(
      towardsTakeBack({
        sales: [
          sale('p_b', sameTime, 500),
          sale('p_a', sameTime, 500),
          sale('p_c', sameTime, 500),
        ],
        inStripeCents: 800,
      }).rows
    ).toEqual([
      { payoutId: 'p_a', towardsCents: 500 },
      { payoutId: 'p_b', towardsCents: 200 },
    ]);
  });
});

describe('what the money went towards (takeBackKind)', () => {
  const of = (...kinds: TakeBackCause[]) =>
    kinds.map((causeType) => ({ causeType }));

  it('one kind is named; none or a mix names neither', () => {
    expect(takeBackKind(of('dispute'))).toBe('dispute');
    expect(takeBackKind(of('refund', 'refund'))).toBe('refund');
    expect(takeBackKind(of('dispute', 'refund'))).toBeNull();
    expect(takeBackKind([])).toBeNull();
  });

  it('as many as are named (20) is unknown: an older one could be the other kind', () => {
    const refunds = (n: number) =>
      of(...Array<TakeBackCause>(n).fill('refund'));
    expect(takeBackKind(refunds(19))).toBe('refund');
    expect(takeBackKind(refunds(20))).toBeNull();
  });

  it('an episode’s causes start at the last check above zero, else 7 days before it was seen', () => {
    const since = at('2026-11-02T08:00:00Z');
    const lastCheck = at('2026-11-01T08:00:00Z');
    expect(episodeCausesFrom(since, lastCheck)).toEqual(lastCheck);
    expect(episodeCausesFrom(since, null)).toEqual(at('2026-10-26T08:00:00Z'));
  });
});

describe('unsentSales', () => {
  const manualPayoutsSince = at('2026-09-01T00:00:00Z');
  const row = (
    payoutId: string,
    createdIso: string,
    transferredIso: string,
    hasCharge = true
  ): LedgerSale => ({
    payoutId,
    stripeTransferId: `tr_${payoutId}`,
    sentCents: 500,
    takeBacks: [],
    createdAt: at(createdIso),
    transferredAt: at(transferredIso),
    hasCharge,
  });

  it('only sales not paid by any run before `from`, transferred by the reading', () => {
    // Wed 28 Oct 2026, GMT. `from` = Thu 29 Oct's run.
    const window = {
      from: at('2026-10-29T08:00:00Z'),
      readAt: at('2026-10-28T11:00:00Z'),
      manualPayoutsSince,
    };
    const ids = unsentSales(
      [
        // Its 14 days end Wed 28 Oct 12:00: due Thu 29 Oct. Unsent.
        row('due_29', '2026-10-14T12:00:00Z', '2026-10-14T12:00:05Z'),
        // Due Wed 28 Oct: this morning's run paid it.
        row('paid_28', '2026-10-13T12:00:00Z', '2026-10-13T12:00:05Z'),
        // A re-pay drained in the 08:00 wake may have gone this morning.
        row('wake', '2026-10-27T12:00:00Z', '2026-10-28T08:00:05Z', false),
        // Not transferred yet at `at`.
        row('later', '2026-10-28T12:00:00Z', '2026-10-28T12:00:05Z'),
        // Paid by Stripe's own schedule, before the switch.
        row('before_switch', '2026-08-20T12:00:00Z', '2026-08-20T12:00:05Z'),
      ],
      window
    ).map((sale) => sale.payoutId);
    expect(ids).toEqual(['due_29']);
  });

  it('a sale transferred before the switch was Stripe’s schedule’s to pay', () => {
    const ids = unsentSales(
      [
        row('before', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z'),
        row('after', '2026-10-22T12:00:00Z', '2026-10-22T12:00:05Z'),
      ],
      {
        from: at('2026-10-29T08:00:00Z'),
        readAt: at('2026-10-28T11:00:00Z'),
        manualPayoutsSince: at('2026-10-21T00:00:00Z'),
      }
    ).map((sale) => sale.payoutId);
    expect(ids).toEqual(['after']);
  });

  it('a whole episode: every sale due on or after its first run', () => {
    const ids = unsentSales(
      [
        row('due_25', '2026-10-10T12:00:00Z', '2026-10-10T12:00:05Z'),
        row('due_26', '2026-10-11T12:00:00Z', '2026-10-11T12:00:05Z'),
        row('due_14_nov', '2026-10-30T12:00:00Z', '2026-10-30T12:00:05Z'),
      ],
      {
        from: at('2026-10-26T08:00:00Z'),
        readAt: at('2026-11-02T08:00:00Z'),
        manualPayoutsSince,
      }
    ).map((sale) => sale.payoutId);
    expect(ids).toEqual(['due_26', 'due_14_nov']);
  });

  // The owner's example's window: below zero from Mon 26 Oct, cleared at
  // Mon 2 Nov's run.
  const episode = {
    from: at('2026-10-26T08:00:00Z'),
    readAt: runReadingEnd(at('2026-11-02T08:00:00Z')),
    manualPayoutsSince,
  };
  const young = row('young', '2026-10-30T12:00:00Z', '2026-10-30T12:00:05Z');
  const valued = (sale: LedgerSale) =>
    unsentSales([{ ...sale, sentCents: 1100 }], episode).map(
      ({ payoutId, netCents }) => ({ payoutId, netCents })
    );

  it('valued as it was at the reading: a refund after it leaves the episode alone (review r5 MED-2)', () => {
    const after = at('2026-11-04T12:00:00Z');
    expect(
      valued({ ...young, takeBacks: [{ at: after, cents: 1100 }] })
    ).toEqual([{ payoutId: 'young', netCents: 1100 }]);
    expect(
      valued({ ...young, takeBacks: [{ at: after, cents: 500 }] })
    ).toEqual([{ payoutId: 'young', netCents: 1100 }]);
  });

  it('a take-back done by the reading is off it, and one that took it all leaves nothing', () => {
    const before = at('2026-10-31T12:00:00Z');
    expect(
      valued({ ...young, takeBacks: [{ at: before, cents: 500 }] })
    ).toEqual([{ payoutId: 'young', netCents: 600 }]);
    expect(
      valued({ ...young, takeBacks: [{ at: before, cents: 1100 }] })
    ).toEqual([]);
  });

  it('the clearing run’s reading holds its wake’s own drain, which ran before the job read the account (review r5 LOW)', () => {
    const ids = unsentSales(
      [
        // A re-pay the cron's drain sent at 08:00:05: in the balance read.
        row(
          'cron_drain',
          '2026-11-02T07:30:00Z',
          '2026-11-02T08:00:05Z',
          false
        ),
        // Sent after the wake: in neither.
        row(
          'after_wake',
          '2026-11-02T07:30:00Z',
          '2026-11-02T08:20:00Z',
          false
        ),
      ],
      episode
    ).map((sale) => sale.payoutId);
    expect(ids).toEqual(['cron_drain']);
    expect(runReadingEnd(at('2026-11-02T08:00:00Z'))).toEqual(
      at('2026-11-02T08:14:59.999Z')
    );
  });

  it('judged by its charge’s time where Stripe gave it, as the job judges it (review r5 LOW)', () => {
    // Recorded on 20 Oct, days after its 10 Oct charge (webhooks
    // redelivered after an outage). By its row it is due Wed 4 Nov; the job,
    // reading the charge, paid it on Sun 25 Oct.
    const late = row('late', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z');
    const window = {
      from: at('2026-10-29T08:00:00Z'),
      readAt: at('2026-10-28T11:00:00Z'),
      manualPayoutsSince,
    };
    expect(unsentSales([late], window).map((s) => s.payoutId)).toEqual([
      'late',
    ]);
    const charged = withChargeTimes(
      [late],
      [
        {
          id: 'tr_late',
          netCents: 500,
          chargeCreatedMs: at('2026-10-10T12:00:00Z').getTime(),
        },
      ]
    );
    expect(charged[0]?.chargedAt).toEqual(at('2026-10-10T12:00:00Z'));
    expect(unsentSales(charged, window)).toEqual([]);
    // One still young by its charge stays, dated by the charge.
    const recent = withChargeTimes(
      [late],
      [
        {
          id: 'tr_late',
          netCents: 500,
          chargeCreatedMs: at('2026-10-19T12:00:00Z').getTime(),
        },
      ]
    );
    expect(unsentSales(recent, window)).toEqual([
      { payoutId: 'late', netCents: 500, soldAt: at('2026-10-19T12:00:00Z') },
    ]);
  });

  it('withChargeTimes: only a listed transfer with a charge gives one', () => {
    const [kept, repay, other] = withChargeTimes(
      [
        row('kept', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z'),
        row('repay', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z', false),
        row('other', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z'),
      ],
      [
        { id: 'tr_kept', netCents: 500, chargeCreatedMs: 1_000 },
        { id: 'tr_repay', netCents: 500, chargeCreatedMs: null },
      ]
    );
    expect(kept?.chargedAt).toEqual(new Date(1_000));
    expect(repay?.chargedAt).toBeUndefined();
    expect(other?.chargedAt).toBeUndefined();
  });

  describe('chargeTimesWanted', () => {
    const window = {
      from: at('2026-10-29T08:00:00Z'),
      readAt: at('2026-10-28T11:00:00Z'),
      manualPayoutsSince,
    };

    it('the span of the rows whose bank day hangs on their charge: a day early, a minute late', () => {
      expect(
        chargeTimesWanted(
          [
            row('due_29', '2026-10-14T12:00:00Z', '2026-10-14T12:00:05Z'),
            row('late', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z'),
          ],
          window
        )
      ).toEqual({
        since: at('2026-10-13T12:00:05Z'),
        until: at('2026-10-20T12:01:05Z'),
      });
    });

    it('none for a row that is unsent whatever its charge, paid by its own date, a re-pay, worth nothing, or already timed', () => {
      expect(
        chargeTimesWanted(
          [
            // Sent after the run before `from` (Wed 28 Oct's).
            row('sent_today', '2026-10-01T12:00:00Z', '2026-10-28T09:00:00Z'),
            // Due Wed 28 Oct by its row, and its charge was no later.
            row('paid_28', '2026-10-13T12:00:00Z', '2026-10-13T12:00:05Z'),
            row('repay', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z', false),
            {
              ...row('gone', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z'),
              takeBacks: [{ at: at('2026-10-21T12:00:00Z'), cents: 500 }],
            },
            {
              ...row('timed', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z'),
              chargedAt: at('2026-10-20T11:59:00Z'),
            },
          ],
          window
        )
      ).toBeNull();
    });

    it('none for a row a list already covered: its transfer is not on this account', () => {
      const late = row('late', '2026-10-20T12:00:00Z', '2026-10-20T12:00:05Z');
      expect(
        chargeTimesWanted([late], window, at('2026-10-19T12:00:05Z'))
      ).toBeNull();
      expect(
        chargeTimesWanted([late], window, at('2026-10-19T12:00:06Z'))
      ).not.toBeNull();
    });
  });
});

describe('the London clock', () => {
  const runsOn = (utcDay: string) =>
    Array.from(
      { length: 24 },
      (_, hour) =>
        new Date(`${utcDay}T00:00:00Z`).getTime() + hour * 60 * 60 * 1000
    ).filter((time) => isBankPayoutRun(time));

  it('isBankPayoutRun: 08:00 UTC in January, 07:00 UTC in July, and no other hour', () => {
    expect(runsOn('2027-01-15')).toEqual([
      at('2027-01-15T08:00:00Z').getTime(),
    ]);
    expect(runsOn('2026-07-15')).toEqual([
      at('2026-07-15T07:00:00Z').getTime(),
    ]);
  });

  it('a DST change day still has exactly one run', () => {
    // Clocks go forward 29 Mar 2026 and back 25 Oct 2026, both at 01:00 UTC.
    expect(runsOn('2026-03-29')).toEqual([
      at('2026-03-29T07:00:00Z').getTime(),
    ]);
    expect(runsOn('2026-10-25')).toEqual([
      at('2026-10-25T08:00:00Z').getTime(),
    ]);
  });

  it('firstLondon0800After is strictly after, and crosses the DST changes', () => {
    expect(firstLondon0800After(at('2027-01-15T07:59:59Z'))).toEqual(
      at('2027-01-15T08:00:00Z')
    );
    expect(firstLondon0800After(at('2027-01-15T08:00:00Z'))).toEqual(
      at('2027-01-16T08:00:00Z')
    );
    expect(firstLondon0800After(at('2026-07-15T06:30:00Z'))).toEqual(
      at('2026-07-15T07:00:00Z')
    );
    // Sat 24 Oct 08:30 BST → Sun 25 Oct 08:00 GMT.
    expect(firstLondon0800After(at('2026-10-24T07:30:00Z'))).toEqual(
      at('2026-10-25T08:00:00Z')
    );
    // Sat 28 Mar 08:30 GMT → Sun 29 Mar 08:00 BST.
    expect(firstLondon0800After(at('2026-03-28T08:30:00Z'))).toEqual(
      at('2026-03-29T07:00:00Z')
    );
    // Month and year ends.
    expect(firstLondon0800After(at('2026-12-31T09:00:00Z'))).toEqual(
      at('2027-01-01T08:00:00Z')
    );
  });

  it('londonDate is the London calendar date', () => {
    expect(londonDate(at('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(londonDate(at('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
    expect(londonDate(at('2027-01-01T00:30:00Z'))).toBe('2027-01-01');
  });
});

// mock-b-studio E1 and E6: Maya's seven sales of the last 14 days (£65.08),
// read on Wed 28 Oct 2026 11:00.
describe('the next payout and a covered chargeback (§3.3, studio S2)', () => {
  const now = at('2026-10-28T11:00:00Z');
  const charged = (
    iso: string,
    id: string,
    netCents: number
  ): BankTransfer => ({
    id,
    netCents,
    chargeCreatedMs: at(iso).getTime(),
  });
  const sevenSales = [
    charged('2026-10-14T12:00:00Z', 'tr_14', 600),
    charged('2026-10-15T06:00:00Z', 'tr_15', 1170),
    charged('2026-10-20T12:00:00Z', 'tr_20', 899),
    charged('2026-10-22T12:00:00Z', 'tr_22', 1170),
    charged('2026-10-24T12:00:00Z', 'tr_24', 600),
    charged('2026-10-26T12:00:00Z', 'tr_26', 1170),
    charged('2026-10-27T12:00:00Z', 'tr_27', 899),
  ];
  // The same seven, unsent (all young), as the sharing reads them.
  const unsent: UnsentSale[] = sevenSales.map((sale) => ({
    payoutId: sale.id,
    netCents: sale.netCents,
    soldAt: new Date(sale.chargeCreatedMs ?? 0),
  }));

  it('E1: £17.70 on Thu 29 Oct, from the sales of 14 and 15 Oct; nothing covered', () => {
    const balance = { availableCents: 1770, pendingCents: 4738 };
    expect(projectNextPayout({ now, balance, transfers: sevenSales })).toEqual({
      on: '2026-10-29',
      amountCents: 1770,
    });
    expect(
      towardsTakeBack({ sales: unsent, inStripeCents: 1770 + 4738 })
    ).toEqual({ cents: 0, rows: [] });
  });

  it('E6: a £23.10 chargeback the balance covered moves the next payout to Wed 4 Nov (£3.59)', () => {
    const balance = { availableCents: 1770 - 2310, pendingCents: 4738 };
    // Still at or above zero overall, but available is below: Stripe holds it.
    const covered = { availableCents: 0, pendingCents: 6508 - 2310 };
    expect(
      projectNextPayout({ now, balance: covered, transfers: sevenSales })
    ).toEqual({ on: '2026-11-04', amountCents: 359 });
    // The same figures the covering card always showed (amendment 3).
    expect(
      towardsTakeBack({ sales: unsent, inStripeCents: 6508 - 2310 })
    ).toEqual({
      cents: 2310,
      rows: [
        { payoutId: 'tr_14', towardsCents: 600 },
        { payoutId: 'tr_15', towardsCents: 1170 },
        { payoutId: 'tr_20', towardsCents: 540 },
      ],
    });
    expect(balance.availableCents + balance.pendingCents).toBe(6508 - 2310);
  });

  it('no next payout when the balance is empty or below zero overall', () => {
    expect(
      projectNextPayout({
        now,
        balance: { availableCents: -900, pendingCents: 600 },
        transfers: sevenSales,
      })
    ).toBeNull();
    expect(
      projectNextPayout({
        now,
        balance: { availableCents: 0, pendingCents: 0 },
        transfers: [],
      })
    ).toBeNull();
  });
});

describe('a balance below zero (§4.1)', () => {
  const since = at('2026-10-26T08:00:00Z');

  it('Q4: 5,000 pence is "£50 or less"; 5,001 is invoiced at 90 days', () => {
    expect(debtRule(5000, since)).toEqual({
      kind: 'stripe_writes_off',
      on: '2027-04-24',
    });
    expect(debtRule(5001, since)).toEqual({
      kind: 'invoice',
      on: '2027-01-24',
    });
  });

  it('the first negative check starts an episode after the last check', () => {
    const yesterday = at('2026-10-25T08:00:00Z');
    expect(
      nextBalanceEpisode(
        { negativeSince: null, checkedAt: yesterday, availableCents: 1200 },
        -840,
        since
      )
    ).toEqual({
      kind: 'started',
      negativeSince: since,
      negativeAfter: yesterday,
    });
    expect(
      nextBalanceEpisode(
        { negativeSince: null, checkedAt: null, availableCents: null },
        -1,
        since
      )
    ).toEqual({ kind: 'started', negativeSince: since, negativeAfter: null });
    expect(
      nextBalanceEpisode(
        { negativeSince: null, checkedAt: null, availableCents: null },
        0,
        since
      )
    ).toEqual({ kind: 'none' });
  });

  it('a negative account staying negative changes nothing', () => {
    expect(
      nextBalanceEpisode(
        { negativeSince: since, checkedAt: since, availableCents: -840 },
        -10,
        at('2026-11-01T08:00:00Z')
      )
    ).toEqual({ kind: 'none' });
  });

  // Cleared at REAL runs (08:00 London), the only instants the job writes. An
  // episode that starts in winter ends its day 180 at a summer run, an hour
  // short of 180 × 24 h (review MED-1); one that starts in summer, an hour over.
  it.each([
    {
      name: 'a winter (GMT) start, cleared in summer',
      since: '2026-10-26T08:00:00Z',
      day179: '2027-04-23T07:00:00Z',
      day180: '2027-04-24T07:00:00Z',
    },
    {
      name: 'a summer (BST) start, cleared in winter',
      since: '2026-07-15T07:00:00Z',
      day179: '2027-01-10T08:00:00Z',
      day180: '2027-01-11T08:00:00Z',
    },
  ])('$name: "recovered" at the day-179 run, "stripe_collected" at the day-180 run, owing the last negative reading', ({
    since: start,
    day179,
    day180,
  }) => {
    for (const run of [start, day179, day180])
      expect(isBankPayoutRun(at(run))).toBe(true);
    const lastNegative = {
      negativeSince: at(start),
      checkedAt: at(start),
      availableCents: -840,
    };
    expect(nextBalanceEpisode(lastNegative, 0, at(day179))).toEqual({
      kind: 'cleared',
      since: at(start),
      clearedAt: at(day179),
      reason: 'recovered',
      owedCents: 840,
    });
    expect(nextBalanceEpisode(lastNegative, 0, at(day180))).toEqual({
      kind: 'cleared',
      since: at(start),
      clearedAt: at(day180),
      reason: 'stripe_collected',
      owedCents: 840,
    });
  });

  it('a clearing with no negative reading on record owes null, never a made-up figure', () => {
    expect(
      nextBalanceEpisode(
        { negativeSince: since, checkedAt: since, availableCents: null },
        0,
        at('2026-11-01T08:00:00Z')
      )
    ).toMatchObject({ kind: 'cleared', owedCents: null });
  });

  it('the rule date counts London calendar days, even from a late-evening start', () => {
    // Tue 1 Dec 23:30 GMT + 180 days is Sun 30 May; 180 × 24 h is 00:30 BST on the 31st.
    expect(debtRule(100, at('2026-12-01T23:30:00Z'))).toEqual({
      kind: 'stripe_writes_off',
      on: '2027-05-30',
    });
    expect(
      londonDaysBetween(at('2026-10-26T08:00:00Z'), at('2027-04-24T07:00:00Z'))
    ).toBe(180);
    // One UTC date, two London dates: 23:30 BST on the 14th, 00:30 BST on the 15th.
    expect(
      londonDaysBetween(at('2026-07-14T22:30:00Z'), at('2026-07-14T23:30:00Z'))
    ).toBe(1);
  });
});

describe('bankOnFor (§3.3)', () => {
  const manualSince = at('2026-09-01T00:00:00Z');
  const paid = {
    status: 'paid',
    stripeTransferId: 'tr_1',
    stripeChargeId: 'ch_1',
    createdAt: at('2026-10-14T12:00:00Z'),
    resolvedAt: at('2026-10-14T12:00:05Z'),
  };

  it('a paid sale: the first 08:00 London more than 14 × 24 h after the row', () => {
    expect(bankOnFor(paid, manualSince)).toBe('2026-10-29');
  });

  // Round 6: nothing went to the bank while the balance was below zero.
  describe('after a below-zero episode that has cleared', () => {
    /** A sale charged at `iso`, transferred 5 s later. */
    const sold = (iso: string) => ({
      ...paid,
      createdAt: at(iso),
      resolvedAt: new Date(at(iso).getTime() + 5000),
    });
    // Mon 26 Oct to Mon 2 Nov 2026, GMT: runs at 08:00Z.
    const winter = {
      since: at('2026-10-26T08:00:00Z'),
      clearedAt: at('2026-11-02T08:00:00Z'),
    };

    it.each([
      {
        name: 'the day before it',
        sale: '2026-10-10T12:00:00Z',
        on: '2026-10-25',
      },
      { name: 'its first day', sale: '2026-10-11T12:00:00Z', on: '2026-11-02' },
      { name: 'inside it', sale: '2026-10-14T12:00:00Z', on: '2026-11-02' },
      {
        name: 'its last day below zero',
        sale: '2026-10-17T12:00:00Z',
        on: '2026-11-02',
      },
      {
        name: 'the day after it cleared',
        sale: '2026-10-19T12:00:00Z',
        on: '2026-11-03',
      },
    ])('a run $name goes on $on', ({ sale, on }) => {
      expect(bankOnFor(sold(sale), manualSince, winter)).toBe(on);
    });

    // Summer: runs at 07:00Z, 08:00 London. Mon 13 to Mon 20 Jul 2026, on an
    // account switched in May.
    const summer = {
      since: at('2026-07-13T07:00:00Z'),
      clearedAt: at('2026-07-20T07:00:00Z'),
    };
    const switchedInMay = at('2026-05-01T00:00:00Z');
    it.each([
      {
        name: 'the day before it',
        sale: '2026-06-27T12:00:00Z',
        on: '2026-07-12',
      },
      { name: 'its first day', sale: '2026-06-28T12:00:00Z', on: '2026-07-20' },
      {
        name: 'its last day below zero',
        sale: '2026-07-04T12:00:00Z',
        on: '2026-07-20',
      },
      {
        name: 'the day after it cleared',
        sale: '2026-07-06T12:00:00Z',
        on: '2026-07-21',
      },
    ])('in summer, a run $name goes on $on', ({ sale, on }) => {
      expect(bankOnFor(sold(sale), switchedInMay, summer)).toBe(on);
    });

    it('cleared by a run that was not the 08:00 one: the next 08:00', () => {
      expect(
        bankOnFor(sold('2026-10-14T12:00:00Z'), manualSince, {
          ...winter,
          clearedAt: at('2026-11-02T09:30:00Z'),
        })
      ).toBe('2026-11-03');
    });

    it('without an episode, the date stands', () => {
      expect(bankOnFor(sold('2026-10-14T12:00:00Z'), manualSince, null)).toBe(
        '2026-10-29'
      );
    });
  });

  it('null when unpaid, or while Stripe’s own schedule pays the account', () => {
    expect(bankOnFor({ ...paid, status: 'pending' }, manualSince)).toBeNull();
    expect(
      bankOnFor({ ...paid, stripeTransferId: null }, manualSince)
    ).toBeNull();
    expect(bankOnFor(paid, null)).toBeNull();
    expect(bankOnFor(paid, at('2026-10-20T00:00:00Z'))).toBeNull();
  });

  it('a re-pay row (no charge) goes at the next run after its transfer', () => {
    expect(
      bankOnFor(
        {
          ...paid,
          stripeChargeId: null,
          createdAt: at('2026-10-27T15:00:00Z'),
          resolvedAt: at('2026-10-28T09:00:00Z'),
        },
        manualSince
      )
    ).toBe('2026-10-29');
  });

  it('an old sale drained late goes at the next run after the drain', () => {
    expect(
      bankOnFor(
        {
          ...paid,
          createdAt: at('2026-09-10T12:00:00Z'),
          resolvedAt: at('2026-10-28T09:00:00Z'),
        },
        manualSince
      )
    ).toBe('2026-10-29');
  });

  // A row can't say which drain paid it, and only the cron's own goes that
  // morning: any other transfer made in the 08:00 wake may land after the
  // job read the account (review r2 LOW-1). So the date is never early.
  // Wed 28 Oct 2026 is GMT: the run is 08:00Z.
  it.each([
    {
      name: 'an old sale transferred in the wake',
      charge: true,
      at: '2026-10-28T08:00:05Z',
      on: '2026-10-29',
    },
    {
      name: 'a re-pay transferred in the wake',
      charge: false,
      at: '2026-10-28T08:03:00Z',
      on: '2026-10-29',
    },
    {
      name: 'an old sale transferred after the wake',
      charge: true,
      at: '2026-10-28T08:20:00Z',
      on: '2026-10-29',
    },
    {
      name: 'an old sale transferred just before the run',
      charge: true,
      at: '2026-10-28T07:59:59Z',
      on: '2026-10-28',
    },
  ])('$name goes on $on', ({ charge, at: transferredAt, on }) => {
    expect(
      bankOnFor(
        {
          ...paid,
          stripeChargeId: charge ? 'ch_1' : null,
          createdAt: at('2026-09-10T12:00:00Z'),
          resolvedAt: at(transferredAt),
        },
        manualSince
      )
    ).toBe(on);
  });

  it('a young sale transferred in the wake still waits out its 14 days', () => {
    expect(
      bankOnFor(
        {
          ...paid,
          createdAt: at('2026-10-20T12:00:00Z'),
          resolvedAt: at('2026-10-28T08:00:05Z'),
        },
        manualSince
      )
    ).toBe('2026-11-04');
  });
});

describe('payoutReleasedBankFields (§5.4, mock-b-studio M5 and M6)', () => {
  const september = (cents: number) => ({
    cents,
    createdAt: at('2026-09-20T12:00:00Z'),
    hasCharge: true,
  });

  it('M5: everything older than 14 days goes at the next daily payout', () => {
    expect(
      payoutReleasedBankFields({
        slices: [
          september(1000),
          september(1000),
          september(1000),
          september(1210),
        ],
        manualPayouts: true,
        now: at('2026-10-28T11:40:00Z'),
      })
    ).toEqual({
      bankSentence:
        'Every sale in it is more than 14 days old, so it goes to your bank at the next daily payout, on Thu 29 Oct. Your bank usually shows it within 2 working days.',
      bankLines: 'To your bank on Thu 29 Oct: £42.10',
      bankDate: 'Thu 29 Oct',
    });
  });

  it('M6: some from the last 14 days, each 14 days after its sale', () => {
    expect(
      payoutReleasedBankFields({
        slices: [
          september(1000),
          september(1000),
          september(1000),
          september(1000),
          september(670),
          {
            cents: 870,
            createdAt: at('2026-10-19T12:00:00Z'),
            hasCharge: true,
          },
          {
            cents: 1170,
            createdAt: at('2026-10-26T12:00:00Z'),
            hasCharge: true,
          },
        ],
        manualPayouts: true,
        now: at('2026-10-28T15:05:00Z'),
      })
    ).toEqual({
      bankSentence:
        '£46.70 is from sales more than 14 days old, so it goes to your bank at the next daily payout, on Thu 29 Oct. The other £20.40 is from sales in the last 14 days: each follows 14 days after its sale, the last on 10 Nov. Your bank usually shows a payout within 2 working days.',
      bankLines:
        'To your bank on Thu 29 Oct: £46.70 · Then 14 days after each sale: £20.40, the last on 10 Nov',
      bankDate: 'Tue 10 Nov',
    });
  });

  it('a re-pay counts as older money; all-young money names its last date', () => {
    const now = at('2026-10-28T15:05:00Z');
    expect(
      payoutReleasedBankFields({
        slices: [{ cents: 840, createdAt: now, hasCharge: false }],
        manualPayouts: true,
        now,
      }).bankLines
    ).toBe('To your bank on Thu 29 Oct: £8.40');
    expect(
      payoutReleasedBankFields({
        slices: [
          {
            cents: 1170,
            createdAt: at('2026-10-26T12:00:00Z'),
            hasCharge: true,
          },
        ],
        manualPayouts: true,
        now,
      })
    ).toEqual({
      bankSentence:
        'It is from sales in the last 14 days: each goes to your bank 14 days after its sale, the last on 10 Nov. Your bank usually shows a payout within 2 working days.',
      bankLines: '14 days after each sale: £11.70, the last on 10 Nov',
      bankDate: 'Tue 10 Nov',
    });
  });

  it('an account not switched yet keeps today’s "within 2 business days"', () => {
    expect(
      payoutReleasedBankFields({
        slices: [september(500)],
        manualPayouts: false,
        now: at('2026-10-28T15:05:00Z'),
      })
    ).toEqual({
      bankSentence:
        'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.',
      bankLines: 'To your bank on your Stripe payout schedule: £5.00',
      bankDate: 'Within 2 business days',
    });
  });

  it('every field is one line', () => {
    const fields = payoutReleasedBankFields({
      slices: [
        september(1000),
        { cents: 870, createdAt: at('2026-10-19T12:00:00Z'), hasCharge: true },
      ],
      manualPayouts: true,
      now: at('2026-10-28T15:05:00Z'),
    });
    for (const value of Object.values(fields)) expect(value).not.toMatch(/\n/);
  });

  // Review r2 LOW-1: only the cron's own drain runs ahead of the job.
  it.each([
    {
      who: 'the cron’s own drain',
      cronDrain: true,
      day: 'Wed 28 Oct',
    },
    {
      who: 'an account.updated or /connect/me/sync drain',
      cronDrain: false,
      day: 'Thu 29 Oct',
    },
  ])('inside the 08:00 wake, $who names $day', ({ cronDrain, day }) => {
    expect(
      payoutReleasedBankFields({
        slices: [september(1000)],
        manualPayouts: true,
        now: at('2026-10-28T08:00:05Z'),
        cronDrain,
      })
    ).toMatchObject({
      bankLines: `To your bank on ${day}: £10.00`,
      bankDate: day,
    });
  });

  it('the cron’s drain after its wake names tomorrow’s payout', () => {
    expect(
      payoutReleasedBankFields({
        slices: [september(1000)],
        manualPayouts: true,
        now: at('2026-10-28T09:00:05Z'),
        cronDrain: true,
      }).bankDate
    ).toBe('Thu 29 Oct');
  });
});

// Review r3 LOW-2: workerd's own error, bare or as the Stripe SDK wraps it.
describe('isSubrequestLimit', () => {
  it.each([
    {
      what: 'workerd’s error',
      error: new Error('Too many subrequests.'),
      is: true,
    },
    {
      what: 'a Stripe connection error wrapping it',
      error: Object.assign(
        new Error('An error occurred with our connection to Stripe.'),
        {
          type: 'StripeConnectionError',
          detail: new Error('Too many subrequests.'),
        }
      ),
      is: true,
    },
    {
      what: 'a Stripe connection error from an outage',
      error: Object.assign(
        new Error('An error occurred with our connection to Stripe.'),
        { type: 'StripeConnectionError', detail: new Error('ECONNRESET') }
      ),
      is: false,
    },
    { what: 'not an error', error: 'nope', is: false },
  ])('$what: $is', ({ error, is }) => {
    expect(isSubrequestLimit(error)).toBe(is);
  });
});
