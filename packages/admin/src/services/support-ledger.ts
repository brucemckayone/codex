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
  DEBT_INVOICE_AFTER_DAYS,
  debtRule,
  MAX_CLAWBACK_ATTEMPTS,
  PAYEE_PAID_RESOLUTIONS,
  STRIPE_WRITE_OFF_AFTER_DAYS,
} from '@codex/payments';
import type {
  ChargebackState,
  CreatorDebtPerson,
  CreditAction,
  CreditState,
  HistoryCredit,
  HistoryLine,
  HistoryOutcome,
  SystemDecision,
} from '../support-types';

/**
 * The code a `cancelled` step carries when its share moved off its slice to
 * the slice's re-pay rows (`payout_reversals`, Codex-2hxff.59). The share was
 * taken, from the re-pay row: it is never "not taken".
 */
const MOVED_TO_REPAY = 'moved_to_repay';

/**
 * The codes a stranded cancellation carries once the system decided it
 * (`repay.ts`, Codex-2hxff.71; data design §6.3).
 */
const SYSTEM_DECISIONS: Readonly<Record<string, SystemDecision>> = {
  system_took_share: 'took_share',
  system_payee_kept: 'payee_kept',
};

/** A `payee_credits` row, as the history and the queue read it. */
export interface CreditView {
  id: string;
  effect: string;
  amountCents: number | null;
  /** The step's status when the late effect was found. */
  settledAs: string;
  resolution: string | null;
  /** Its re-pay payout, once support re-paid it. */
  repayPayout: { id: string; status: string } | null;
  /**
   * Open, unverified, and on a cancellation the ledger cannot attribute to
   * its step: its slice is cancelled or reversed, with an ambiguous sibling
   * (`payeeCreditsNeedingAPerson`; review MED-3, round 2 MED-1).
   */
  needsPerson: boolean;
  /**
   * A needs-person row whose sibling step on the slice is done or re-paid:
   * Re-pay could pay the share twice, so it is settled by hand.
   */
  siblingTook: boolean;
}

/** A credit's state (data design §7.2). */
export function creditState(
  credit: Pick<CreditView, 'effect' | 'resolution' | 'needsPerson'>
): CreditState {
  switch (credit.resolution) {
    case 'repaid':
      return 'repaid';
    case 'debt_collected':
      return 'debt_collected';
    case 'not_owed':
      return 'not_owed';
    default:
      if (credit.effect !== 'unverified') return 'owed';
      return credit.needsPerson ? 'needs_person' : 'needs_check';
  }
}

/**
 * An open credit's one action (§7.4; owner decisions Q11, OQ4, MED-3), by the
 * same rules the resolve route enforces: a check while Stripe never answered;
 * by hand on a step another path paid back already (but not when that is
 * the payee-paid debt's own re-pay: the two are independent, round 2 LOW-3),
 * or on a needs-person row a sibling step already took; decide (Re-pay or
 * Not owed, with a note) on any other needs-person row; Count it against
 * the step's own debt only while that debt is open and Stripe took exactly
 * its amount; otherwise Re-pay. Null once the credit is settled.
 */
export function creditAction(
  credit: Pick<
    CreditView,
    | 'effect'
    | 'resolution'
    | 'settledAs'
    | 'amountCents'
    | 'needsPerson'
    | 'siblingTook'
  >,
  step: { repaidByPayoutId: string | null },
  debt: {
    attemptedReversalCents: number;
    resolvedAt: Date | null;
    resolution: string | null;
  } | null
): CreditAction | null {
  const state = creditState(credit);
  if (state === 'needs_check') return 'check';
  if (state !== 'owed' && state !== 'needs_person') return null;
  const besideDebtRepay =
    credit.settledAs === 'debt' &&
    debt !== null &&
    debt.resolvedAt !== null &&
    debt.resolution !== null &&
    PAYEE_PAID_RESOLUTIONS.has(debt.resolution);
  if (
    credit.settledAs === 'done' ||
    (step.repaidByPayoutId !== null && !besideDebtRepay) ||
    (state === 'needs_person' && credit.siblingTook)
  ) {
    return 'settle_by_hand';
  }
  if (state === 'needs_person') return 'decide';
  if (
    credit.settledAs === 'debt' &&
    debt !== null &&
    debt.resolvedAt === null &&
    debt.attemptedReversalCents === credit.amountCents
  ) {
    return 'count_against_debt';
  }
  return 'repay';
}

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
  /** A dispute's dates, by dispute id: opened, and won (null unless won). */
  disputeDates: ReadonlyMap<string, { openedAt: string; wonAt: string | null }>;
  /**
   * A late take-back's credit, by step id, with its one action worked out
   * (`creditAction`; Codex-2hxff.73).
   */
  credits: ReadonlyMap<string, CreditView & { action: CreditAction | null }>;
}

export interface SliceHistory {
  history: HistoryLine[];
  takenCents: number;
  owedCents: number;
  /** Owed back TO the payee: open, confirmed credits (`taken_after_settled`). */
  owedToPayeeCents: number;
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
 * - A `cancelled` or `debt` step with an open, confirmed credit (a late
 *   take-back reached Stripe after it was settled) is `taken_after_settled`,
 *   and once support re-pays the credit, `paid_back` (Codex-2hxff.73).
 * - `takenCents` counts taken and taken from re-pay, but not a won
 *   chargeback's, which was paid back, and an open credit's amount (what
 *   Stripe took). `owedCents` counts open debts; `owedToPayeeCents`, open
 *   credits.
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
    baseOutcome: HistoryOutcome,
    repayPayoutId: string | null
  ) => {
    const dates =
      step.causeType === 'dispute'
        ? context.disputeDates.get(step.causeId)
        : undefined;
    const credit = context.credits.get(step.id);
    const outcome = credit
      ? creditOutcome(step, credit, baseOutcome)
      : baseOutcome;
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
        // A debt step's, whatever its line reads: a late take-back on an open
        // debt is `taken_after_settled` while the debt stays owed.
        debtResolution:
          step.status === 'debt'
            ? (context.debtResolutions.get(step.id) ?? null)
            : null,
        disputeOpenedAt: dates?.openedAt ?? null,
        disputeWonAt: dates?.wonAt ?? null,
        systemDecision:
          (step.lastErrorCode && SYSTEM_DECISIONS[step.lastErrorCode]) || null,
        credit: credit ? historyCredit(credit) : null,
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
  // What Stripe took after the step was settled: the credit's amount.
  const owedToPayeeCents = history
    .filter((line) => line.outcome === 'taken_after_settled')
    .reduce((sum, line) => sum + (line.credit?.amountCents ?? 0), 0);
  const takenCents =
    history
      .filter(
        (line) =>
          (line.outcome === 'taken' || line.outcome === 'taken_from_repay') &&
          !(
            line.causeType === 'dispute' &&
            context.wonDisputeIds.has(line.causeId)
          )
      )
      .reduce((sum, line) => sum + line.amountCents, 0) + owedToPayeeCents;
  const owedCents = placed
    .filter(
      ({ step, line }) => step.status === 'debt' && line.debtResolution === null
    )
    .reduce((sum, { line }) => sum + line.amountCents, 0);
  return { history, takenCents, owedCents, owedToPayeeCents };
}

/**
 * A step's line under a credit: `taken_after_settled` while a confirmed one
 * is open on a `cancelled` or `debt` step, `paid_back` once support re-paid
 * it; otherwise what the step alone reads.
 */
function creditOutcome(
  step: PayoutReversal,
  credit: CreditView,
  baseOutcome: HistoryOutcome
): HistoryOutcome {
  if (step.status !== 'cancelled' && step.status !== 'debt') {
    return baseOutcome;
  }
  const state = creditState(credit);
  if (state === 'owed') return 'taken_after_settled';
  if (state === 'repaid') return 'paid_back';
  return baseOutcome;
}

function historyCredit(
  credit: CreditView & { action: CreditAction | null }
): HistoryCredit {
  return {
    creditId: credit.id,
    state: creditState(credit),
    amountCents: credit.amountCents,
    action: credit.action,
    repayPayout: credit.repayPayout,
  };
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a person's Stripe-held debt stands (data design §4.1, owner decision
 * Q4), on what they owe NOW (studio S1, option A): over £50 is invoiced 90
 * days after the balance first went below zero, and is `to_invoice` from that
 * instant; £50 or less is written off when Stripe collects it at 180 days.
 * `daysLeft` counts whole days to that instant, 0 once it has come.
 */
export function debtStanding(
  owedCents: number,
  negativeSince: Date,
  now: Date
): Pick<CreatorDebtPerson, 'state' | 'clock'> {
  const rule = debtRule(owedCents, negativeSince);
  const days =
    rule.kind === 'invoice'
      ? DEBT_INVOICE_AFTER_DAYS
      : STRIPE_WRITE_OFF_AFTER_DAYS;
  const dueAt = negativeSince.getTime() + days * DAY_MS;
  return {
    state:
      rule.kind === 'invoice' && now.getTime() >= dueAt
        ? 'to_invoice'
        : 'recovering',
    clock: {
      kind: rule.kind,
      on: rule.on,
      daysLeft: Math.max(0, Math.ceil((dueAt - now.getTime()) / DAY_MS)),
    },
  };
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
