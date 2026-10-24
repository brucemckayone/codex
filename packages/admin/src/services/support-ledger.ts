/**
 * The support screen's reading of the ledger (Codex-2hxff.28; data design
 * §2, §3): what each step did to a slice, and the plain labels the page shows
 * for Stripe's codes. Pure functions over rows already read, so the rules are
 * tested on their own.
 */

import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_INQUIRY_STATUSES,
} from '@codex/constants';
import type { PayoutReversal } from '@codex/database/schema';
import {
  type ClawbackPlanMethod,
  MAX_CLAWBACK_ATTEMPTS,
} from '@codex/payments';
import type {
  ChargebackState,
  HistoryLine,
  HistoryOutcome,
} from '../support-types';

/**
 * The code a `cancelled` step carries when its share moved off its slice to
 * the slice's re-pay rows (`payout_reversals`, Codex-2hxff.59). The share was
 * taken, from the re-pay row: it is never "not taken".
 */
const MOVED_TO_REPAY = 'moved_to_repay';

/** A chargeback that took the money and was not won: it blocks a refund. */
export const BLOCKING_DISPUTE_STATUSES: readonly string[] = [
  ...DISPUTE_CHARGEBACK_OPEN_STATUSES,
  'lost',
];

/** A dispute's Stripe status, as the screen groups it; null for a closed inquiry. */
export function chargebackState(status: string): ChargebackState | null {
  if ((DISPUTE_INQUIRY_STATUSES as readonly string[]).includes(status)) {
    return 'inquiry';
  }
  if (
    (DISPUTE_CHARGEBACK_OPEN_STATUSES as readonly string[]).includes(status)
  ) {
    return 'open';
  }
  if (status === 'won' || status === 'lost') return status;
  return null;
}

/** A cause's key in the lookups below. */
export function causeKey(causeType: string, causeId: string): string {
  return `${causeType}:${causeId}`;
}

/** What `sliceHistory` reads besides the steps. */
export interface HistoryContext {
  /** Each cause's own amount, by `causeKey`. */
  causeAmounts: ReadonlyMap<string, number>;
  /** Disputes won: their steps net to nothing, so they are not "taken". */
  wonDisputeIds: ReadonlySet<string>;
  /** A debt step's review resolution (null while open), by step id. */
  debtResolutions: ReadonlyMap<string, string | null>;
}

export interface SliceHistory {
  history: HistoryLine[];
  takenCents: number;
  owedCents: number;
}

/**
 * What every refund and chargeback did to one slice (data design §2's rule).
 * `steps` holds the slice's own steps and those on its re-pay rows (any
 * others are ignored). A slice's re-pay rows are the payouts its steps were
 * paid back by (`repaid_by_payout_id`).
 *
 * - On the slice: `done` is taken, or paid back once a re-pay row names it;
 *   `debt` is owed; `cancelled` is not taken; `pending` is in progress; and
 *   `failed` is retrying until Stripe has refused it on every try.
 * - A `cancelled` step marked `moved_to_repay` was taken from the re-pay
 *   rows: it shows as the same cause's steps there, `taken_from_repay` when
 *   done, each naming its row. Never "not taken".
 * - `takenCents` counts taken and taken from re-pay, but not a won
 *   chargeback's, which was paid back. `owedCents` counts open debts.
 */
export function sliceHistory(
  sliceId: string,
  steps: readonly PayoutReversal[],
  context: HistoryContext
): SliceHistory {
  const onSlice = steps.filter((step) => step.payoutId === sliceId);
  const repayIds = new Set(
    onSlice.flatMap((step) =>
      step.repaidByPayoutId ? [step.repaidByPayoutId] : []
    )
  );
  const onRepay = steps.filter((step) => repayIds.has(step.payoutId));

  const placed: Array<{ step: PayoutReversal; line: HistoryLine }> = [];
  const place = (
    step: PayoutReversal,
    outcome: HistoryOutcome,
    repayPayoutId: string | null
  ) => {
    placed.push({
      step,
      line: {
        causeType: step.causeType === 'dispute' ? 'dispute' : 'refund',
        causeId: step.causeId,
        causeAmountCents:
          context.causeAmounts.get(causeKey(step.causeType, step.causeId)) ??
          null,
        amountCents: step.amountCents,
        outcome,
        repayPayoutId,
        debtResolution:
          outcome === 'owed'
            ? (context.debtResolutions.get(step.id) ?? null)
            : null,
      },
    });
  };

  for (const step of onSlice) {
    if (step.status === 'cancelled' && step.lastErrorCode === MOVED_TO_REPAY) {
      const carried = onRepay.some(
        (other) =>
          other.causeType === step.causeType && other.causeId === step.causeId
      );
      // Its share waits on the re-pay rows (an open chargeback holds them
      // rather than cutting them): not taken yet, and not "not taken".
      if (!carried) place(step, 'in_progress', null);
      continue;
    }
    place(step, outcomeOf(step, 'taken'), null);
  }
  for (const step of onRepay) {
    place(step, outcomeOf(step, 'taken_from_repay'), step.payoutId);
  }

  placed.sort(
    (a, b) =>
      a.step.createdAt.getTime() - b.step.createdAt.getTime() ||
      a.step.id.localeCompare(b.step.id)
  );
  const history = placed.map(({ line }) => line);
  const takenCents = history
    .filter(
      (line) =>
        (line.outcome === 'taken' || line.outcome === 'taken_from_repay') &&
        !(
          line.causeType === 'dispute' &&
          context.wonDisputeIds.has(line.causeId)
        )
    )
    .reduce((sum, line) => sum + line.amountCents, 0);
  const owedCents = history
    .filter((line) => line.outcome === 'owed' && line.debtResolution === null)
    .reduce((sum, line) => sum + line.amountCents, 0);
  return { history, takenCents, owedCents };
}

/** A step's outcome; `taken` is what a done step that was not paid back reads. */
function outcomeOf(
  step: PayoutReversal,
  taken: 'taken' | 'taken_from_repay'
): HistoryOutcome {
  switch (step.status) {
    case 'done':
      return step.repaidByPayoutId ? 'paid_back' : taken;
    case 'debt':
      return 'owed';
    case 'cancelled':
      return 'not_taken';
    case 'failed':
      return step.attempt >= MAX_CLAWBACK_ATTEMPTS ? 'refused' : 'retrying';
    default:
      return 'in_progress';
  }
}

/** Plain words for Stripe's refund `failure_reason` (the mockup's table). */
const FAILURE_LABELS: Readonly<Record<string, string>> = {
  expired_or_canceled_card: 'The card has expired or been cancelled',
  lost_or_stolen_card: 'The card was reported lost or stolen',
  declined: "Stripe's banking partner declined it",
  insufficient_funds: "The platform's Stripe balance was too low for too long",
  charge_for_pending_refund_disputed:
    'The buyer disputed the charge while the refund was pending',
  merchant_request: "Cancelled at the platform's request",
  unknown: 'Stripe gave no reason',
};

export function refundFailureLabel(failureReason: string | null): string {
  if (!failureReason) return FAILURE_LABELS.unknown as string;
  return FAILURE_LABELS[failureReason] ?? `Stripe's reason: ${failureReason}`;
}

/**
 * Plain words for a debt's `error_code`. Never the stored Stripe message,
 * which can name accounts.
 */
export function debtErrorLabel(
  errorCode: string,
  payeeName: string | null
): string {
  if (
    errorCode === 'insufficient_funds' ||
    errorCode === 'balance_insufficient'
  ) {
    return `${payeeName ? `${payeeName}'s` : "The payee's"} Stripe balance was too low to take it back`;
  }
  if (errorCode === 'slice_repaid') {
    return 'Already paid back after a won chargeback, and that payout had gone out';
  }
  return 'Stripe refused the reversal';
}

/**
 * How a preview line is taken, in words. No names: the preview carries none,
 * and the page joins `payoutId` to the charge's slices. A Record over the
 * engine's own union, so a method added there fails to compile here.
 */
const PREVIEW_LABELS: Readonly<Record<ClawbackPlanMethod, string>> = {
  transfer_reversal:
    "Reversed from the payee's Stripe balance; a low balance makes it a debt",
  reduce_unpaid: 'Taken off the payout not yet made',
  cancel_unpaid: 'The payout not yet made is cancelled',
  platform_bears: 'The platform bears its share; nothing moves',
  from_repay_payout: 'Taken off the re-pay payout not yet made',
  needs_person:
    'Owed: the re-pay payout has gone out, so a person must recover it',
  rounding: 'The rounding stays with the platform',
};

export function previewLabel(
  method: ClawbackPlanMethod,
  isFinal: boolean
): string {
  if (method === 'rounding' && !isFinal) {
    return "A part refund's rounding stays with the platform";
  }
  return PREVIEW_LABELS[method];
}
