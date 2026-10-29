/**
 * The support screen's reading of the ledger (Codex-2hxff.28; data design §2):
 * the history rule, and the labels made for Stripe's codes. Pure functions, so
 * no database: each fixture is the `payout_reversals` rows the engine writes.
 */

import type { PayoutReversal } from '@codex/database/schema';
import { MAX_CLAWBACK_ATTEMPTS } from '@codex/payments';
import { describe, expect, it } from 'vitest';
import {
  type CreditView,
  causeKey,
  chargebackState,
  creditAction,
  creditState,
  debtErrorLabel,
  debtStanding,
  type HistoryContext,
  previewLabel,
  refundFailureLabel,
  sliceHistory,
} from '../services/support-ledger';
import type { CreditAction } from '../support-types';

const SLICE = 'slice-1';
const REPAY = 'repay-1';
let clock = 0;

function step(overrides: Partial<PayoutReversal>): PayoutReversal {
  clock += 1;
  return {
    id: `step-${clock}`,
    payoutId: SLICE,
    causeType: 'refund',
    causeId: 're_1',
    amountCents: 100,
    kind: 'transfer_reversal',
    status: 'done',
    stripeReversalId: null,
    attempt: 0,
    attemptedAt: null,
    lastErrorCode: null,
    repaidByPayoutId: null,
    createdAt: new Date(1_000_000 + clock * 1000),
    updatedAt: new Date(1_000_000 + clock * 1000),
    resolvedAt: null,
    ...overrides,
  };
}

function context(overrides: Partial<HistoryContext> = {}): HistoryContext {
  return {
    causeAmounts: new Map([
      [causeKey('refund', 're_1'), 600],
      [causeKey('dispute', 'du_1'), 2400],
    ]),
    wonDisputeIds: new Set(),
    debtResolutions: new Map(),
    disputeDates: new Map(),
    credits: new Map(),
    ...overrides,
  };
}

describe('sliceHistory', () => {
  it('reads a done step as taken, with its cause and the cause amount', () => {
    const { history, takenCents, owedCents } = sliceHistory(
      SLICE,
      [step({ amountCents: 540 })],
      context()
    );
    expect(history).toEqual([
      {
        causeType: 'refund',
        causeId: 're_1',
        causeAmountCents: 600,
        amountCents: 540,
        outcome: 'taken',
        repayPayoutId: null,
        debtResolution: null,
        disputeOpenedAt: null,
        disputeWonAt: null,
        systemDecision: null,
        credit: null,
      },
    ]);
    expect(takenCents).toBe(540);
    expect(owedCents).toBe(0);
  });

  it('dates a dispute line from its dispute (opened, and won once won); a refund line has no dates', () => {
    const { history } = sliceHistory(
      SLICE,
      [
        step({ amountCents: 540 }),
        step({ causeType: 'dispute', causeId: 'du_1', amountCents: 300 }),
      ],
      context({
        disputeDates: new Map([
          [
            'du_1',
            {
              openedAt: '2026-10-01T09:00:00.000Z',
              wonAt: '2026-10-20T09:00:00.000Z',
            },
          ],
        ]),
      })
    );
    expect(
      history.map((line) => [
        line.causeType,
        line.disputeOpenedAt,
        line.disputeWonAt,
      ])
    ).toEqual([
      ['refund', null, null],
      ['dispute', '2026-10-01T09:00:00.000Z', '2026-10-20T09:00:00.000Z'],
    ]);
  });

  it('reads a moved_to_repay step as taken_from_repay, from its re-pay row, never not_taken', () => {
    // A chargeback reversed the slice and was won: its re-pay row pays the
    // payee again. A later refund's step on the slice moved to that row.
    const won = step({
      causeType: 'dispute',
      causeId: 'du_1',
      amountCents: 2430,
      repaidByPayoutId: REPAY,
    });
    const moved = step({
      amountCents: 486,
      status: 'cancelled',
      lastErrorCode: 'moved_to_repay',
    });
    const onRepay = step({
      payoutId: REPAY,
      amountCents: 486,
      kind: 'pending_reduction',
    });
    const { history, takenCents } = sliceHistory(
      SLICE,
      [won, moved, onRepay],
      context({ wonDisputeIds: new Set(['du_1']) })
    );

    expect(history.map((line) => line.outcome)).toEqual([
      'paid_back',
      'taken_from_repay',
    ]);
    expect(history.some((line) => line.outcome === 'not_taken')).toBe(false);
    expect(history[1]).toMatchObject({
      causeId: 're_1',
      amountCents: 486,
      repayPayoutId: REPAY,
    });
    // The won chargeback nets to nothing; the refund's share was taken.
    expect(takenCents).toBe(486);
  });

  it('shows a moved step whose re-pay rows carry nothing yet as in progress', () => {
    const { history } = sliceHistory(
      SLICE,
      [
        step({
          repaidByPayoutId: REPAY,
          causeType: 'dispute',
          causeId: 'du_1',
        }),
        step({ status: 'cancelled', lastErrorCode: 'moved_to_repay' }),
      ],
      context()
    );
    expect(history.map((line) => line.outcome)).toEqual([
      'paid_back',
      'in_progress',
    ]);
  });

  it('reads a cancelled step without that code as not taken', () => {
    const { history, takenCents } = sliceHistory(
      SLICE,
      [step({ status: 'cancelled', causeType: 'dispute', causeId: 'du_1' })],
      context()
    );
    expect(history[0]?.outcome).toBe('not_taken');
    expect(takenCents).toBe(0);
  });

  it('counts an open debt as owed and a settled one as settled, not owed', () => {
    const open = step({ status: 'debt', lastErrorCode: 'insufficient_funds' });
    const settled = step({
      status: 'debt',
      causeId: 're_2',
      amountCents: 70,
      lastErrorCode: 'slice_repaid',
    });
    const { history, owedCents, takenCents } = sliceHistory(
      SLICE,
      [open, settled],
      context({
        debtResolutions: new Map([
          [open.id, null],
          [settled.id, 'creator_absorbed'],
        ]),
      })
    );
    expect(history.map((line) => [line.outcome, line.debtResolution])).toEqual([
      ['owed', null],
      ['owed', 'creator_absorbed'],
    ]);
    expect(owedCents).toBe(100);
    expect(takenCents).toBe(0);
  });

  it('tells a step still retrying from one Stripe refused on every try', () => {
    const { history } = sliceHistory(
      SLICE,
      [
        step({ status: 'pending' }),
        step({ status: 'failed', attempt: MAX_CLAWBACK_ATTEMPTS - 1 }),
        step({ status: 'failed', attempt: MAX_CLAWBACK_ATTEMPTS }),
      ],
      context()
    );
    expect(history.map((line) => line.outcome)).toEqual([
      'in_progress',
      'retrying',
      'refused',
    ]);
  });

  it("does not count a won chargeback's step as taken, and ignores other slices", () => {
    const { history, takenCents } = sliceHistory(
      SLICE,
      [
        step({ causeType: 'dispute', causeId: 'du_1', amountCents: 300 }),
        step({ payoutId: 'another-slice', amountCents: 999 }),
      ],
      context({ wonDisputeIds: new Set(['du_1']) })
    );
    expect(history).toHaveLength(1);
    expect(takenCents).toBe(0);
  });
});

describe('a late take-back on a settled step (Codex-2hxff.73, data design §7.6)', () => {
  function creditOf(
    stepId: string,
    overrides: Partial<CreditView & { action: CreditAction | null }> = {}
  ): HistoryContext['credits'] {
    return new Map([
      [
        stepId,
        {
          id: 'credit-1',
          effect: 'reversal_landed',
          amountCents: 700,
          settledAs: 'cancelled',
          resolution: null,
          repayPayout: null,
          needsPerson: false,
          siblingTook: false,
          action: 'repay',
          ...overrides,
        },
      ],
    ]);
  }

  it('reads a cancelled step with an open, confirmed credit as taken_after_settled, owed back for what Stripe took', () => {
    const cancelled = step({ status: 'cancelled', amountCents: 765 });
    const { history, takenCents, owedToPayeeCents } = sliceHistory(
      SLICE,
      [cancelled],
      context({ credits: creditOf(cancelled.id) })
    );
    expect(history[0]).toMatchObject({
      outcome: 'taken_after_settled',
      amountCents: 765,
      credit: {
        creditId: 'credit-1',
        state: 'owed',
        amountCents: 700,
        action: 'repay',
        repayPayout: null,
      },
    });
    expect(owedToPayeeCents).toBe(700);
    expect(takenCents).toBe(700);
  });

  it('once re-paid, the line is paid_back with its pending re-pay, and nothing is taken or owed back', () => {
    const cancelled = step({ status: 'cancelled' });
    const { history, takenCents, owedToPayeeCents } = sliceHistory(
      SLICE,
      [cancelled],
      context({
        credits: creditOf(cancelled.id, {
          resolution: 'repaid',
          repayPayout: { id: 'repay-9', status: 'pending' },
          action: null,
        }),
      })
    );
    expect(history[0]).toMatchObject({
      outcome: 'paid_back',
      credit: {
        state: 'repaid',
        action: null,
        repayPayout: { id: 'repay-9', status: 'pending' },
      },
    });
    expect([takenCents, owedToPayeeCents]).toEqual([0, 0]);
  });

  it('a debt step with a credit is taken_after_settled while its debt still counts as owed', () => {
    const debt = step({ status: 'debt', amountCents: 700 });
    const { history, owedCents, owedToPayeeCents } = sliceHistory(
      SLICE,
      [debt],
      context({
        debtResolutions: new Map([[debt.id, null]]),
        credits: creditOf(debt.id, {
          settledAs: 'debt',
          action: 'count_against_debt',
        }),
      })
    );
    expect(history[0]).toMatchObject({
      outcome: 'taken_after_settled',
      debtResolution: null,
      credit: { action: 'count_against_debt' },
    });
    expect([owedCents, owedToPayeeCents]).toEqual([700, 700]);
  });

  it('a credit that needs a check, or is not owed, leaves the line as the step alone reads', () => {
    const a = step({ status: 'cancelled' });
    const b = step({ status: 'cancelled', causeId: 're_2' });
    const { history, owedToPayeeCents } = sliceHistory(
      SLICE,
      [a, b],
      context({
        credits: new Map([
          ...creditOf(a.id, {
            effect: 'unverified',
            amountCents: null,
            action: 'check',
          }),
          ...creditOf(b.id, {
            id: 'credit-2',
            resolution: 'not_owed',
            action: null,
          }),
        ]),
      })
    );
    expect(history.map((line) => [line.outcome, line.credit?.state])).toEqual([
      ['not_taken', 'needs_check'],
      ['not_taken', 'not_owed'],
    ]);
    expect(owedToPayeeCents).toBe(0);
  });

  it('names what the system decided for a stranded step (Codex-2hxff.71)', () => {
    const took = step({
      lastErrorCode: 'system_took_share',
      kind: 'cancellation',
    });
    const kept = step({
      status: 'cancelled',
      causeId: 're_2',
      kind: 'cancellation',
      lastErrorCode: 'system_payee_kept',
    });
    const other = step({
      causeId: 're_3',
      lastErrorCode: 'insufficient_funds',
      status: 'debt',
    });
    const { history } = sliceHistory(SLICE, [took, kept, other], context());
    expect(history.map((line) => line.systemDecision)).toEqual([
      'took_share',
      'payee_kept',
      null,
    ]);
  });
});

describe('creditState and creditAction (§7.2, §7.4)', () => {
  const owed = {
    effect: 'reversal_landed',
    resolution: null,
    settledAs: 'cancelled',
    amountCents: 700,
    needsPerson: false,
    siblingTook: false,
  };
  const unlinked = { repaidByPayoutId: null };
  /** A cancellation the ledger cannot attribute to its step (MED-3). */
  const forPerson = {
    ...owed,
    effect: 'unverified',
    amountCents: null,
    needsPerson: true,
  };

  it('states', () => {
    expect(creditState(owed)).toBe('owed');
    expect(creditState({ ...owed, effect: 'unverified' })).toBe('needs_check');
    expect(creditState(forPerson)).toBe('needs_person');
    expect(creditState({ ...forPerson, resolution: 'not_owed' })).toBe(
      'not_owed'
    );
    for (const resolution of ['repaid', 'debt_collected', 'not_owed']) {
      expect(creditState({ ...owed, resolution })).toBe(resolution);
    }
  });

  it.each([
    ['a confirmed credit on a cancelled step', owed, unlinked, null, 'repay'],
    [
      'one Stripe never answered for',
      { ...owed, effect: 'unverified', amountCents: null },
      unlinked,
      null,
      'check',
    ],
    [
      'one found on a done step',
      { ...owed, settledAs: 'done' },
      unlinked,
      null,
      'settle_by_hand',
    ],
    [
      'one on a step already re-paid',
      owed,
      { repaidByPayoutId: 'repay-1' },
      null,
      'settle_by_hand',
    ],
    [
      'its own open debt, the same amount',
      { ...owed, settledAs: 'debt' },
      unlinked,
      { attemptedReversalCents: 700, resolvedAt: null, resolution: null },
      'count_against_debt',
    ],
    [
      'its own open debt, another amount (OQ4)',
      { ...owed, settledAs: 'debt' },
      unlinked,
      { attemptedReversalCents: 765, resolvedAt: null, resolution: null },
      'repay',
    ],
    [
      'its own debt, already settled',
      { ...owed, settledAs: 'debt' },
      unlinked,
      {
        attemptedReversalCents: 700,
        resolvedAt: new Date(),
        resolution: 'platform_absorbed',
      },
      'repay',
    ],
    [
      'a settled credit',
      { ...owed, resolution: 'repaid' },
      unlinked,
      null,
      null,
    ],
    [
      'a cancellation the ledger cannot attribute (MED-3): support decides',
      forPerson,
      unlinked,
      null,
      'decide',
    ],
    [
      'one of those on a step already re-paid',
      forPerson,
      { repaidByPayoutId: 'repay-1' },
      null,
      'settle_by_hand',
    ],
    [
      'one of those whose sibling step is done or re-paid (round 2 MED-1): settled by hand',
      { ...forPerson, siblingTook: true },
      unlinked,
      null,
      'settle_by_hand',
    ],
    [
      "on a debt step whose payee-paid debt's own re-pay went out first: Re-pay still goes ahead (round 2 LOW-3)",
      { ...owed, settledAs: 'debt' },
      { repaidByPayoutId: 'debt-repay-1' },
      {
        attemptedReversalCents: 1000,
        resolvedAt: new Date(),
        resolution: 'creator_absorbed',
      },
      'repay',
    ],
    [
      'on a debt step linked while its debt is still open: settled by hand',
      { ...owed, settledAs: 'debt' },
      { repaidByPayoutId: 'repay-1' },
      { attemptedReversalCents: 1000, resolvedAt: null, resolution: null },
      'settle_by_hand',
    ],
  ])('%s', (_name, credit, onStep, debt, expected) => {
    expect(creditAction(credit, onStep, debt)).toBe(expected);
  });
});

describe('debtStanding (Q4, data design §4.1)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const since = new Date('2026-10-26T08:00:00.000Z');

  it('£50 or less is written off by Stripe at 180 days; over £50 is invoiced at 90', () => {
    const now = new Date(since.getTime() + 2 * DAY);
    expect(debtStanding(5000, since, now)).toEqual({
      state: 'recovering',
      clock: { kind: 'stripe_writes_off', on: '2027-04-24', daysLeft: 178 },
    });
    expect(debtStanding(5001, since, now)).toEqual({
      state: 'recovering',
      clock: { kind: 'invoice', on: '2027-01-24', daysLeft: 88 },
    });
  });

  it('turns to_invoice at exactly 90 days, not a moment before', () => {
    const due = since.getTime() + 90 * DAY;
    expect(debtStanding(6240, since, new Date(due - 1)).state).toBe(
      'recovering'
    );
    expect(debtStanding(6240, since, new Date(due))).toEqual({
      state: 'to_invoice',
      clock: { kind: 'invoice', on: '2027-01-24', daysLeft: 0 },
    });
  });

  it('follows the live amount: a debt that drops to £50 switches to the write-off rule', () => {
    const now = new Date(since.getTime() + 100 * DAY);
    expect(debtStanding(5000, since, now)).toMatchObject({
      state: 'recovering',
      clock: { kind: 'stripe_writes_off' },
    });
  });
});

describe('labels', () => {
  it("names Stripe's refund failure reasons, and says when there is none", () => {
    expect(refundFailureLabel('lost_or_stolen_card')).toBe(
      'The card was reported lost or stolen'
    );
    expect(refundFailureLabel(null)).toBe('Stripe gave no reason');
    expect(refundFailureLabel('a_new_code')).toBe(
      "Stripe's reason: a_new_code"
    );
  });

  it("names a debt's code, never Stripe's message", () => {
    expect(debtErrorLabel('balance_insufficient', 'Rowan Ellis')).toBe(
      "Rowan Ellis's Stripe balance was too low to take it back"
    );
    expect(debtErrorLabel('insufficient_funds', null)).toBe(
      "The payee's Stripe balance was too low to take it back"
    );
    expect(debtErrorLabel('slice_repaid', 'Maya')).toBe(
      'Already paid back after a won chargeback, and that payout had gone out'
    );
    expect(debtErrorLabel('transfer_reversed', 'Maya')).toBe(
      'Stripe refused the reversal'
    );
  });

  it("words a part refund's rounding differently from a final one's", () => {
    expect(previewLabel('rounding', false)).toBe(
      "A part refund's rounding stays with the platform"
    );
    expect(previewLabel('rounding', true)).not.toContain('part refund');
    expect(previewLabel('cancel_unpaid', true)).toBe(
      'The payout not yet made is cancelled'
    );
  });

  it('groups dispute statuses as the screen shows them', () => {
    expect(chargebackState('warning_needs_response')).toBe('inquiry');
    expect(chargebackState('under_review')).toBe('open');
    expect(chargebackState('won')).toBe('won');
    expect(chargebackState('lost')).toBe('lost');
    expect(chargebackState('warning_closed')).toBeNull();
  });
});
