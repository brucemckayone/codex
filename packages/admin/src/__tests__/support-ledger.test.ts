/**
 * The support screen's reading of the ledger (Codex-2hxff.28; data design §2):
 * the history rule, and the labels made for Stripe's codes. Pure functions, so
 * no database: each fixture is the `payout_reversals` rows the engine writes.
 */

import type { PayoutReversal } from '@codex/database/schema';
import { MAX_CLAWBACK_ATTEMPTS } from '@codex/payments';
import { describe, expect, it } from 'vitest';
import {
  causeKey,
  chargebackState,
  debtErrorLabel,
  type HistoryContext,
  previewLabel,
  refundFailureLabel,
  sliceHistory,
} from '../services/support-ledger';

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
      },
    ]);
    expect(takenCents).toBe(540);
    expect(owedCents).toBe(0);
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
