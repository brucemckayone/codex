/**
 * Paying back what a won dispute clawed back (Codex-2hxff.9; design in
 * docs/payments/dispute-record.md §3, owner decision Q2, "Next sweep pays it").
 *
 * A transfer reversal cannot be undone, so each reversed slice is paid again
 * by a NEW pending `payouts` row for the reversed amount, which the drain pays
 * like any other: the minimum-transfer floor, Connect readiness and retries
 * all apply. The re-pay row has no charge id, so its transfer comes from the
 * platform balance (no `source_transaction`), and the one-slice-per-charge
 * unique indexes do not apply. `payout_reversals.repaid_by_payout_id` links
 * the reversal to it: that link is what makes a redelivery a no-op, and what
 * keeps the clawback from ever treating a re-pay row as a slice of the charge.
 * A payee credit's re-pay is linked the same way, or, once a payee-paid debt's
 * own re-pay has taken the step's link (`repayDebtStep`), by its credit's
 * `repay_payout_id`.
 *
 * A failed refund that support settles as `creators_repaid` is paid back the
 * same way, by the same row writer (`repayFailedRefund`, Codex-2hxff.28).
 */

import {
  disputes,
  type Payout,
  type PayoutReversal,
  payeeCredits,
  payoutReversals,
  payouts,
  refundReviews,
  refunds,
} from '@codex/database/schema';
import {
  BusinessLogicError,
  InternalServiceError,
  ServiceUnavailableError,
} from '@codex/service-errors';
import { and, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import {
  type ClawbackDeps,
  type ClawbackSource,
  cancelUnclaimedStep,
  chargebacksFor,
  failedRefundRepayBlock,
  findLandedReversal,
  isDefinitiveStripeError,
  listClawableRefunds,
  MAX_CLAWBACK_ATTEMPTS,
  type PayeeCreditWrite,
  type RepayBlockReason,
  recordedClawableRefunds,
  recordPayeeCredit,
  reportPayeeCreditWrite,
  reverseCharge,
  type SliceTaken,
  settleIfFullyReversed,
  sliceTakenByOf,
} from './clawback';
import { lateTransferOf, PAYOUT_ATTEMPT_LEASE_MINUTES } from './payout-ledger';

export interface DisputeRepayResult {
  /** Reversed slices given a re-pay row by this call. */
  repaid: number;
  /** Steps that had not run, cancelled because the dispute was won. */
  cancelled: number;
  /** Debts the dispute caused, closed as `dispute_won`. */
  debtsClosed: number;
}

/**
 * A debt settled one of these ways was paid by the payee, so a won dispute
 * pays it back like a reversal. `platform_absorbed` was not: nothing to pay.
 */
export const PAYEE_PAID_RESOLUTIONS: ReadonlySet<string> = new Set([
  'manually_reversed',
  'creator_absorbed',
]);

type Tx = Parameters<Parameters<ClawbackDeps['db']['transaction']>[0]>[0];
/** The database, or a transaction on it. */
type Client = ClawbackDeps['db'] | Tx;

/**
 * Settle a WON dispute's clawback, idempotently:
 *
 * - a `done` transfer reversal gets one pending re-pay row;
 * - a step that had not finished is checked with Stripe first, because its
 *   outcome may never have been recorded (a timeout, or a crash after Stripe
 *   answered): a reversal found for it is recorded `done` and paid back, and
 *   only a step that never reached Stripe is `cancelled`. A cancellation
 *   whose slice the dispute already cancelled is decided by the system, as a
 *   failed refund's is (`settleStrandedDisputeCancellation`);
 * - a debt is `cancelled` and its open `refund_reviews` row closed as
 *   `dispute_won`; one the payee already settled is paid back instead;
 * - the platform fee's share (`retained_fee`) is cancelled, and a fee slice
 *   that share had marked `reversed` is paid again: the money is back;
 * - a refund that settled while the chargeback held the whole slice then
 *   takes its share off the new re-pay row (`clawBackRefundsUnderDispute`),
 *   so the payee keeps what the refund alone would have left them.
 *
 * The dispute's status is `won` before this runs, so no clawback can claim one
 * of its steps any more (`reverseCharge`). Rejects with a
 * `ServiceUnavailableError` (a retry) while a delivery that claimed a step
 * before the win still holds it: once it finishes, a redelivery pays it back.
 */
export async function repayDispute(
  deps: ClawbackDeps,
  input: { disputeId: string }
): Promise<DisputeRepayResult> {
  const steps = await deps.db
    .select({ record: payoutReversals, slice: payouts, version: stepVersion() })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payoutReversals.payoutId, payouts.id))
    .where(
      and(
        eq(payoutReversals.causeType, 'dispute'),
        eq(payoutReversals.causeId, input.disputeId)
      )
    );

  const result: DisputeRepayResult = {
    repaid: 0,
    cancelled: 0,
    debtsClosed: 0,
  };
  let busy = 0;
  for (const { record, slice, version } of steps) {
    if (record.kind === 'retained_fee') {
      if (record.status === 'cancelled') continue;
      // Not under a clawback that claimed it before the win: it would mark
      // the step done after.
      if (!(await cancelFeeShare(deps, record, slice.id))) busy++;
      continue;
    }
    if (record.status === 'done') {
      if (
        !record.repaidByPayoutId &&
        (await writeRepay(deps.db, record, slice, false, deps.obs))
      ) {
        result.repaid++;
      }
      continue;
    }
    if (record.status === 'debt') {
      const settled = await settleDebt(deps, record, slice);
      if (settled === 'repaid') result.repaid++;
      if (settled === 'closed') result.debtsClosed++;
      continue;
    }
    if (record.status === 'pending' || record.status === 'failed') {
      if (isLeased(record)) {
        busy++;
        continue;
      }
      // A slice the drain marked `reversed` after the cancel too
      // (Codex-2hxff.88): the same rule decides it.
      if (
        record.kind === 'cancellation' &&
        (slice.status === 'cancelled_by_dispute' || slice.status === 'reversed')
      ) {
        const settled = await settleStrandedDisputeCancellation(
          deps,
          input.disputeId,
          record,
          slice,
          version
        );
        if (settled === 'repaid') result.repaid++;
        if (settled === 'cancelled') result.cancelled++;
        if (settled === 'busy') busy++;
        continue;
      }
      const landed =
        record.kind === 'transfer_reversal' && slice.stripeTransferId
          ? await findLandedReversal(deps, slice.stripeTransferId, record.id)
          : undefined;
      if (landed) {
        const done = await recordLanded(deps, record, version, landed);
        if (!done) {
          busy++;
          continue;
        }
        // As the clawback does after a reversal: a slice reversed whole is
        // `reversed`, so totals count its re-pay row and not it as well.
        await settleIfFullyReversed(deps, slice.id);
        if (await writeRepay(deps.db, done, slice, false, deps.obs)) {
          result.repaid++;
        }
      } else if (await cancelUnfinished(deps.db, record.id, version)) {
        result.cancelled++;
      } else {
        busy++;
      }
    }
  }
  await clawBackRefundsUnderDispute(
    deps,
    input.disputeId,
    steps.map(({ slice }) => slice)
  );

  if (busy > 0) {
    throw new ServiceUnavailableError(
      'A step of this dispute is being clawed back; retry to pay it back',
      { disputeId: input.disputeId, busySteps: busy }
    );
  }
  deps.obs.info('Won dispute paid back', {
    disputeId: input.disputeId,
    ...result,
  });
  return result;
}

/** A refund the clawback acts on: settled at Stripe, either way. */
const SETTLED_REFUND_STATUSES = ['succeeded', 'failed'];

/**
 * Claw back, from the re-pay rows just written, the refunds a full chargeback
 * left no slice for (Codex-2hxff.59). A refund created before the dispute can
 * settle after it opens. The chargeback had already reversed the whole slice,
 * so the refund's run found nothing left and wrote no step, and the re-pay
 * returns the refund's share with the chargeback's.
 *
 * The charge's clawback runs again for each source: a refund with no step on
 * a re-paid slice takes its share off the re-pay row, by a step on that row
 * (`reverseCharge`, the re-paid path), exactly as a refund after the win
 * would. That step is also what stops a later run of the same refund from
 * taking it a second time. A refund that already has a step is skipped, so
 * the usual case pays back the whole reversal.
 *
 * Only a charge with a settled refund on record asks Stripe anything. A
 * failure rejects: the webhook retries, and this runs again.
 */
async function clawBackRefundsUnderDispute(
  deps: ClawbackDeps,
  disputeId: string,
  slices: readonly Payout[]
): Promise<void> {
  if (slices.length === 0) return;
  const [dispute] = await deps.db
    .select({ chargeId: disputes.stripeChargeId })
    .from(disputes)
    .where(eq(disputes.stripeDisputeId, disputeId))
    .limit(1);
  if (!dispute) return;
  const [refund] = await deps.db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.stripeChargeId, dispute.chargeId),
        inArray(refunds.status, SETTLED_REFUND_STATUSES)
      )
    )
    .limit(1);
  if (!refund) return;

  const charge = await deps.stripe.charges.retrieve(dispute.chargeId);
  const sources = new Map<string, ClawbackSource>();
  for (const slice of slices) {
    if (slice.sourceType === 'purchase' && slice.purchaseId) {
      sources.set(slice.purchaseId, {
        sourceType: 'purchase',
        purchaseId: slice.purchaseId,
      });
    } else {
      sources.set('subscription', { sourceType: 'subscription' });
    }
  }
  for (const source of sources.values()) {
    await reverseCharge(deps, {
      charge: { id: charge.id, amountCents: charge.amount },
      source,
      refunds: () => listClawableRefunds(deps.stripe, charge.id),
    });
  }
}

/** A re-pay row `repayFailedRefund` wrote. */
export interface FailedRefundRepay {
  /** The new pending `payouts` row. */
  payoutId: string;
  /** Who it pays: null for an organisation's slice with no owner yet. */
  payeeUserId: string | null;
  amountCents: number;
}

/** The steps that took money from a payee: every kind but the fee's share. */
const PAYEE_STEP_KINDS: ReadonlySet<string> = new Set([
  'transfer_reversal',
  'pending_reduction',
  'cancellation',
]);

/**
 * The codes a refused `creators_repaid` settlement carries: the context
 * `code` of its `BusinessLogicError` (422). Each tells support something
 * different to do. Not exported: admin passes the errors through as they
 * are, and the web matches the strings (review round 3 LOW-I).
 */
const REFUND_REPAY_CODES = {
  /** A later cause was shared against the refund: settle by hand, or mark it refunded elsewhere. */
  BLOCKED_BY_LATER_CAUSE: 'REPAY_BLOCKED_BY_LATER_CAUSE',
  /** A step of its clawback is still running: try again later. */
  CLAWBACK_UNFINISHED: 'REFUND_CLAWBACK_UNFINISHED',
  /** A step only a person can read: retrying will not help. */
  CLAWBACK_NEEDS_PERSON: 'REFUND_CLAWBACK_NEEDS_PERSON',
} as const;

/**
 * The typed refusal of a `creators_repaid` settlement that a later cause was
 * shared against (`failedRefundRepayBlock`; owner decision 2026-10-25). A 422
 * whose context is the code and the reason only. Support's route throws it
 * before the transaction, and `repayFailedRefund` throws it inside, so both
 * read the same.
 */
export function repayBlockedError(
  reason: RepayBlockReason
): BusinessLogicError {
  return new BusinessLogicError(
    reason === 'chargeback'
      ? 'This charge has a chargeback, which was shared against this refund. Settle it by hand, or mark it refunded elsewhere.'
      : 'A later refund of this charge was shared against this one. Settle it by hand, or mark it refunded elsewhere.',
    { code: REFUND_REPAY_CODES.BLOCKED_BY_LATER_CAUSE, reason }
  );
}

/**
 * A step `settleUnfinishedRefundSteps` checked with Stripe and found no
 * reversal for, as it read it. `repayFailedRefund` cancels it only if it is
 * still that version.
 */
export interface StrandedStep {
  id: string;
  /** Its `updated_at` in microseconds (`stepVersion`). */
  version: string;
  /**
   * The system decided this cancellation's slice went out to the payee, who
   * kept it (data design §6.2): cancelled as `system_payee_kept`, with a
   * born-resolved `transfer_kept` credit, under `alertErrorId`. Never re-paid.
   * Its alert waits for the settlement to commit (`reportPayeeKept`).
   */
  payeeKept?: { stripeTransferId: string; alertErrorId: string };
}

/**
 * A stranded cancellation the system found the payee kept a transfer for,
 * cancelled by the write that settled it: what `reportPayeeKept` alerts once
 * that write has committed.
 */
export interface PayeeKeptStep {
  payoutReversalId: string;
  /** The step's slice. */
  payoutId: string;
  payeeUserId: string | null;
  amountCents: number;
  stripeTransferId: string;
  /** The errorId its credit already carries. */
  alertErrorId: string;
  /** What its credit's write did (`recordPayeeCredit`), reported with it. */
  creditWrite: PayeeCreditWrite;
}

/** What `repayFailedRefund` wrote, for its caller to report after the commit. */
export interface FailedRefundRepayResult {
  repaid: FailedRefundRepay[];
  /** Cancelled as kept by the payee: alert each once the transaction commits. */
  payeeKept: PayeeKeptStep[];
}

/**
 * The alert for a stranded cancellation whose payee kept the slice's
 * transfer: support reconciles the slice, and nothing is re-paid. Raised
 * only AFTER the write that cancelled the step committed (Codex-2hxff.71,
 * review LOW-8), under the errorId its credit carries, so a refused
 * settlement says nothing and a retry raises no second alert for one step.
 */
export function reportPayeeKept(
  obs: ClawbackDeps['obs'],
  cause: { stripeRefundId: string } | { disputeId: string },
  kept: readonly PayeeKeptStep[]
): void {
  for (const step of kept) {
    obs.error(
      'A stranded cancellation took its slice, but a transfer went out for the slice and was never reversed: the payee kept it. Not re-paid; reconcile the slice',
      {
        errorId: step.alertErrorId,
        ...cause,
        payoutReversalId: step.payoutReversalId,
        payoutId: step.payoutId,
        creatorUserId: step.payeeUserId,
        amountCents: step.amountCents,
        stripeTransferId: step.stripeTransferId,
      }
    );
    reportPayeeCreditWrite(
      obs,
      {
        effect: 'transfer_kept',
        amountCents: null,
        alertErrorId: step.alertErrorId,
      },
      step.creditWrite,
      { ...cause, payoutReversalId: step.payoutReversalId }
    );
  }
}

/**
 * Pay back what a FAILED refund's clawback took, when support settles it as
 * `creators_repaid`: the customer is not to be refunded some other way, so
 * the payees keep their part (Codex-2hxff.28 §8; owner decisions Q5a, Q5b).
 * A won dispute's re-pay, for a refund:
 *
 * - each `done` step of the refund that took money from a payee (a transfer
 *   reversal, or a reduction or cancellation of an unpaid row), on a slice or
 *   on a re-pay row, gets one pending re-pay row for its amount, linked by
 *   `repaid_by_payout_id`. That column is unique, so a second run writes
 *   nothing.
 *
 * The caller runs, in this order: `failedRefundRepayBlock`, then
 * `settleUnfinishedRefundSteps` (it asks Stripe, so it is outside the
 * transaction), then this, inside the transaction that locks the `refunds`
 * row and records the resolution, passing the pre-step's `unlanded` steps and
 * the charge's amount. The settlement commits whole or not at all. Once it
 * has, the clawback leaves the refund out (`withoutRepaidRefunds`).
 *
 * Owner rules (2026-10-24, 2026-10-25):
 *
 * 1. A step that can never move money is cancelled, here, so a refused
 *    settlement leaves it to be finished. One never claimed never reached
 *    Stripe. One no retry will run (a lease that ran out, or out of attempts)
 *    is checked with Stripe first by `settleUnfinishedRefundSteps`, which
 *    records a reversal Stripe made as `done`, and lists the rest as
 *    `unlanded`; each of those is cancelled only if it has not moved since
 *    (compare-and-set); one the system found the payee kept is marked so, with
 *    its born-resolved credit. Any other step still pending or failed is still
 *    running (a retry is due, a delivery holds it, Stripe could not be asked,
 *    or it moved since the check), so this throws
 *    `REFUND_CLAWBACK_UNFINISHED`: support tries again later. One the ledger
 *    cannot read (`needsAPerson`) throws `REFUND_CLAWBACK_NEEDS_PERSON`
 *    instead, because retrying will not help.
 * 2. A debt the payee already settled (`creator_absorbed`,
 *    `manually_reversed`) gets a re-pay row too; one the platform wrote off
 *    (`platform_absorbed`) gets nothing. The refund's open debts close as
 *    `refund_failed`, with who settled them and the note. A debt with no
 *    review (a slice with no payee) is cancelled, as `settleDebt` does.
 * 3. The platform fee's share (`retained_fee`) is cancelled, and a fee slice
 *    it had marked `reversed` is `paid` again, with no re-pay row: the money is
 *    back in the platform's balance.
 * 4. A later cause shared against the refund refuses the settlement
 *    (`repayBlockedError`). The caller checks it on Stripe's list. This checks
 *    it again from the recorded `refunds` and `disputes`, because a chargeback
 *    or a refund can be recorded after the caller's check. What remains is a
 *    refund or chargeback recorded after this read, whose clawback runs before
 *    the commit. That clawback reads this refund's resolution without a lock,
 *    so it still counts this refund, for the length of this transaction
 *    (under a second).
 */
export async function repayFailedRefund(
  tx: Tx,
  input: {
    stripeRefundId: string;
    resolvedByUserId: string;
    note: string;
    now: Date;
    /** The charge's amount, from Stripe: the running total's cap. */
    chargeAmountCents: number;
    /** `settleUnfinishedRefundSteps`' `unlanded`: cancelled if unchanged. */
    unlanded?: readonly StrandedStep[];
    /** For the alert of a re-pay that cannot be linked (`writeRepay`). */
    obs?: ClawbackDeps['obs'];
  }
): Promise<FailedRefundRepayResult> {
  const [refund] = await tx
    .select({ chargeId: refunds.stripeChargeId })
    .from(refunds)
    .where(eq(refunds.stripeRefundId, input.stripeRefundId))
    .limit(1);
  if (!refund) {
    throw new InternalServiceError('The refund to re-pay is not recorded', {
      stripeRefundId: input.stripeRefundId,
    });
  }
  const blocked = failedRefundRepayBlock({
    chargeAmountCents: input.chargeAmountCents,
    refunds: await recordedClawableRefunds(tx, refund.chargeId),
    chargebacks: await chargebacksFor(tx, refund.chargeId),
    stripeRefundId: input.stripeRefundId,
  });
  if (blocked) throw repayBlockedError(blocked);

  const steps = await tx
    .select({ record: payoutReversals, payout: payouts })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payoutReversals.payoutId, payouts.id))
    .where(
      and(
        eq(payoutReversals.causeType, 'refund'),
        eq(payoutReversals.causeId, input.stripeRefundId)
      )
    );

  const checked = new Map(
    (input.unlanded ?? []).map((step) => [step.id, step])
  );
  let unfinished = 0;
  let forPerson = 0;
  const payeeKept: PayeeKeptStep[] = [];
  for (const { record, payout } of steps) {
    if (record.status !== 'pending' && record.status !== 'failed') continue;
    if (await needsAPerson(tx, record, payout)) {
      forPerson++;
      continue;
    }
    if (await cancelUnclaimedStep(tx, record.id)) continue;
    const stranded = checked.get(record.id);
    const cancelled = stranded
      ? await cancelStranded(tx, record, payout, stranded)
      : false;
    if (cancelled === false) {
      unfinished++;
      continue;
    }
    if (cancelled !== true) payeeKept.push(cancelled);
  }
  if (forPerson > 0) {
    throw new BusinessLogicError(
      "A person must check this refund's clawback before it can be re-paid. Trying again will not help.",
      { code: REFUND_REPAY_CODES.CLAWBACK_NEEDS_PERSON, steps: forPerson }
    );
  }
  if (unfinished > 0) {
    throw new BusinessLogicError(
      "This refund's clawback is still running. Try again later.",
      {
        code: REFUND_REPAY_CODES.CLAWBACK_UNFINISHED,
        unfinishedSteps: unfinished,
      }
    );
  }

  const repaid: FailedRefundRepay[] = [];
  const repay = async (
    record: PayoutReversal,
    payout: Payout,
    takeOverCreditLink = false
  ) => {
    const row = await writeRepay(
      tx,
      record,
      payout,
      takeOverCreditLink,
      input.obs
    );
    if (row) {
      repaid.push({
        payoutId: row.id,
        payeeUserId: row.userId,
        amountCents: row.amountCents,
      });
    }
  };
  for (const { record, payout } of steps) {
    if (record.status !== 'done') continue;
    if (record.kind === 'retained_fee') {
      await cancelFeeShareIn(tx, record, payout.id);
    } else if (PAYEE_STEP_KINDS.has(record.kind) && !record.repaidByPayoutId) {
      await repay(record, payout);
    }
  }

  // Locked, as `settleDebt` locks its review: support settling one of these
  // debts at the same moment waits, so a payee's payment is never closed
  // instead of paid back.
  const debts = steps.filter(({ record }) => record.status === 'debt');
  const reviews =
    debts.length === 0
      ? []
      : await tx
          .select()
          .from(refundReviews)
          .where(
            inArray(
              refundReviews.payoutReversalId,
              debts.map(({ record }) => record.id)
            )
          )
          .for('update');
  for (const { record, payout } of debts) {
    const review = reviews.find((row) => row.payoutReversalId === record.id);
    if (!review) {
      // A slice with no payee, so no one owes it. Left `debt`, it would read
      // "owed" for ever.
      await cancelIn(tx, record, ['debt']);
      continue;
    }
    if (!review.resolvedAt) {
      await tx
        .update(refundReviews)
        .set({
          resolution: 'refund_failed',
          resolvedAt: input.now,
          resolvedByUserId: input.resolvedByUserId,
          resolutionNote: input.note,
        })
        .where(
          and(eq(refundReviews.id, review.id), isNull(refundReviews.resolvedAt))
        );
    } else if (
      review.resolution &&
      PAYEE_PAID_RESOLUTIONS.has(review.resolution)
    ) {
      // `repayDebtStep`: a credit's re-pay on the step leaves this one to do.
      await repay(record, payout, true);
    }
  }
  return { repaid, payeeKept };
}

/** What `settleUnfinishedRefundSteps` found. */
export interface UnfinishedRefundSteps {
  /** Steps whose reversal Stripe had made: recorded `done`, so they are re-paid. */
  landed: number;
  /**
   * The slices whose stranded cancellation the system found took the share,
   * with the money back (data design §6.2): recorded `done` here, so the
   * settlement re-pays it. One whose payee kept a transfer is in `unlanded`,
   * marked `payeeKept`, and the settlement reports it once it cancels it.
   */
  decided: string[];
  /** Steps Stripe has no reversal for: pass them to `repayFailedRefund`, which cancels them. */
  unlanded: StrandedStep[];
  /** Steps the ledger cannot read, logged for a person: the settlement refuses them. */
  forPerson: number;
}

/**
 * Check with Stripe the steps of a failed refund that no retry will ever run,
 * before its `creators_repaid` settlement (Codex-2hxff.28, silent F3, money
 * LOW-4 and LOW-B). It asks Stripe, so the caller runs it BEFORE the
 * settlement's transaction. It is safe to repeat.
 *
 * Such a step is either `pending` with a lease that ran out (the delivery
 * that claimed it died), or `failed` and out of attempts, so the cron no
 * longer selects it. Its last try may have landed at Stripe, so, as for a won
 * dispute (`repayDispute`):
 *
 * - a transfer reversal Stripe made for it is recorded `done` here. That is
 *   true whatever the settlement decides, and the settlement then re-pays it;
 * - one Stripe has no reversal for, and a reduction or a fee share (database
 *   only, so an unfinished one did nothing), is returned in `unlanded` with
 *   the version that was checked, NOT cancelled. Cancelling is the
 *   settlement's decision: `repayFailedRefund` cancels it in its transaction,
 *   so a refused settlement leaves it for a redelivery to finish;
 * - a cancellation whose slice is already `cancelled_by_refund` is decided
 *   by the system (owner decision Q6; `decideStrandedCancellation`): if it
 *   took the slice and the money is back with the platform, it is recorded
 *   `done` (`system_took_share`), so the settlement re-pays it; if the payee
 *   kept a transfer made for the slice, it is returned in `unlanded` marked
 *   `payeeKept`, and the settlement cancels it and then alerts it; if Stripe cannot be
 *   asked, it is left, and the settlement refuses it as still running. Only
 *   one the rule cannot decide is logged for a person (`needsAPerson`).
 *
 * A step never claimed, a step due another retry, and a step a delivery holds
 * are left as they are. The settlement cancels the first and refuses the
 * other two.
 *
 * Stripe: `transfers.listReversals`, for each such transfer reversal, and
 * `decideStrandedCancellation`'s reads for each such cancellation.
 */
export async function settleUnfinishedRefundSteps(
  deps: ClawbackDeps,
  input: { stripeRefundId: string }
): Promise<UnfinishedRefundSteps> {
  const steps = await deps.db
    .select({
      record: payoutReversals,
      payout: payouts,
      version: stepVersion(),
    })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payoutReversals.payoutId, payouts.id))
    .where(
      and(
        eq(payoutReversals.causeType, 'refund'),
        eq(payoutReversals.causeId, input.stripeRefundId),
        inArray(payoutReversals.status, ['pending', 'failed'])
      )
    );
  const result: UnfinishedRefundSteps = {
    landed: 0,
    decided: [],
    unlanded: [],
    forPerson: 0,
  };
  for (const { record, payout, version } of steps) {
    if (!isStranded(record)) continue;
    if (
      record.kind === 'cancellation' &&
      (payout.status === 'cancelled_by_refund' || payout.status === 'reversed')
    ) {
      const decision = await decideStrandedCancellation(deps, record, payout);
      if (decision.kind === 'undecidable') {
        result.forPerson++;
        deps.obs.error(
          "A failed refund's cancellation step never finished, and the ledger cannot tell whether it took its slice: a person must decide before the refund is re-paid",
          {
            errorId: crypto.randomUUID(),
            stripeRefundId: input.stripeRefundId,
            payoutReversalId: record.id,
            payoutId: payout.id,
            sliceStatus: payout.status,
            why: decision.why,
          }
        );
      } else if (decision.kind === 'took_share') {
        // Not recorded if it moved since it was read: the settlement refuses
        // it as still running.
        if (await recordSystemTook(deps, record, payout, version, decision)) {
          result.decided.push(payout.id);
        }
      } else if (decision.kind === 'payee_kept') {
        // Alerted by the settlement once it has cancelled the step
        // (`reportPayeeKept`): a refused settlement changes nothing.
        result.unlanded.push({
          id: record.id,
          version,
          payeeKept: {
            stripeTransferId: decision.transferId,
            alertErrorId: crypto.randomUUID(),
          },
        });
      }
      // Stripe could not be asked: left, so the settlement refuses it as
      // still running (`REFUND_CLAWBACK_UNFINISHED`).
      continue;
    }
    if (record.kind === 'transfer_reversal' && payout.stripeTransferId) {
      const landed = await findLandedReversal(
        deps,
        payout.stripeTransferId,
        record.id
      );
      if (landed) {
        // Not recorded if it moved since it was read: a delivery has it, so
        // the settlement refuses it as still running.
        if (await recordLanded(deps, record, version, landed)) {
          await settleIfFullyReversed(deps, payout.id);
          result.landed++;
        }
        continue;
      }
    }
    result.unlanded.push({ id: record.id, version });
  }
  return result;
}

/**
 * A step the ledger cannot read: a cancellation no retry will run whose slice
 * is already `cancelled_by_refund`, or `reversed` by the drain since
 * (Codex-2hxff.88), where `sliceTakenBy` cannot say whether this step took it
 * (another cancellation is on the slice and the lease does not match; on a
 * `reversed` one, any other cancellation or transfer reversal). A person must
 * look (`REFUND_CLAWBACK_NEEDS_PERSON`). Every other such step the system
 * decides (`decideStrandedCancellation`). A `reversed` slice whose recorded
 * transfer Stripe says is NOT reversed in full is only known from Stripe:
 * the pre-step alerts it for a person, and this refuses it as unfinished.
 */
async function needsAPerson(
  db: Client,
  record: PayoutReversal,
  payout: Payout
): Promise<boolean> {
  return (
    isStranded(record) &&
    record.kind === 'cancellation' &&
    (payout.status === 'cancelled_by_refund' || payout.status === 'reversed') &&
    !(await sliceTakenByOf(db, record, payout))
  );
}

/**
 * The markers a stranded cancellation carries in `last_error_code` once the
 * system has decided it (owner decision Q6, 2026-10-27; data design §6.2), as
 * `moved_to_repay` and `slice_repaid` mark theirs. Support's history reads
 * them (support-ledger.ts).
 */
const SYSTEM_TOOK_SHARE = 'system_took_share';
const SYSTEM_PAYEE_KEPT = 'system_payee_kept';

/** What Stripe says of a stranded cancellation (`decideStrandedCancellation`). */
type StrandedDecision =
  /** It took the slice, and the money is back with the platform: done, so re-paid. */
  | { kind: 'took_share'; transferId?: string; reversalId?: string }
  /** It took the slice, but a transfer went out for it and was never reversed: cancelled, never re-paid. */
  | { kind: 'payee_kept'; transferId: string }
  /** Stripe could not be asked: left for a retry. */
  | { kind: 'unknown' }
  /**
   * The ledger cannot say whether this step took the slice (`sliceTakenBy`
   * fails), or it says `reversed` and Stripe says the transfer is not.
   */
  | {
      kind: 'undecidable';
      why: 'another_step_on_the_slice' | 'transfer_not_fully_reversed';
    };

/**
 * Decide a stranded `cancellation` step whose slice is cancelled by its cause
 * type, or `reversed` by the drain since (Codex-2hxff.88): the one rule both
 * paths use (owner decisions Q6, "The system decides", and 2026-10-28, "Re-pay
 * them, same rule"; data design §6.2). The step took the slice when
 * `sliceTakenBy` says so. Stripe then says whether money went out for it: a
 * transfer made for the slice anyway (`lateTransferOf`), or, on a `reversed`
 * slice, the transfer it records; and for that transfer, a reversal naming
 * the step (`findLandedReversal`) or the transfer reversed in full. It only
 * reads; the caller writes the outcome.
 *
 * Stripe: `transfers.list` for each account the payee has had (not for a
 * `reversed` slice), then, for a transfer, `transfers.listReversals` and
 * `transfers.retrieve`.
 */
async function decideStrandedCancellation(
  deps: ClawbackDeps,
  record: PayoutReversal,
  slice: Payout
): Promise<StrandedDecision> {
  const taken: SliceTaken | null = await sliceTakenByOf(deps.db, record, slice);
  if (!taken) return { kind: 'undecidable', why: 'another_step_on_the_slice' };
  let transferId: string;
  if (taken.by === 'reversed') {
    transferId = taken.transferId;
  } else {
    const late = await lateTransferOf(deps, slice);
    if (late.kind === 'unknown') return { kind: 'unknown' };
    if (late.kind === 'none') return { kind: 'took_share' };
    transferId = late.transferId;
  }
  try {
    const landed = await findLandedReversal(deps, transferId, record.id);
    if (landed) {
      return { kind: 'took_share', transferId, reversalId: landed.id };
    }
    // Asked directly, not through `isTransferFullyReversed`, which reads a
    // failed lookup as "not reversed": here that would mean "the payee kept it".
    const transfer = await deps.stripe.transfers.retrieve(transferId);
    if (transfer.reversed) return { kind: 'took_share', transferId };
    // The ledger says the drain reversed it, and Stripe says not in full:
    // they disagree, so a person decides.
    return taken.by === 'reversed'
      ? { kind: 'undecidable', why: 'transfer_not_fully_reversed' }
      : { kind: 'payee_kept', transferId };
  } catch (error) {
    const fields = {
      payoutReversalId: record.id,
      payoutId: slice.id,
      stripeTransferId: transferId,
      error: error instanceof Error ? error.message : String(error),
    };
    // A definitive refusal never succeeds on a retry: the step stays
    // undecided for good (the refund says "try again later", the dispute's
    // webhook retries until Stripe gives up), so a person is told.
    if (isDefinitiveStripeError(error)) {
      deps.obs.error(
        "A stranded cancellation cannot be decided: Stripe refused to say whether its slice's transfer was reversed. Check it by hand",
        { errorId: crypto.randomUUID(), ...fields }
      );
    } else {
      deps.obs.warn(
        "A stranded cancellation was not decided: Stripe could not say whether its slice's transfer was reversed",
        fields
      );
    }
    return { kind: 'unknown' };
  }
}

/**
 * Record the system's `took_share`: the step `done` on the version that was
 * decided (compare-and-set), marked `system_took_share`, with the reversal
 * Stripe made for it, and a slice whose transfer went out and is back marked
 * `reversed` with that transfer. One transaction. The step if this call made
 * it `done`; undefined if it moved since.
 */
async function recordSystemTook(
  deps: ClawbackDeps,
  record: PayoutReversal,
  slice: Payout,
  version: string,
  decision: Extract<StrandedDecision, { kind: 'took_share' }>
): Promise<PayoutReversal | undefined> {
  const now = new Date();
  const done = await deps.db.transaction(async (tx) => {
    const [step] = await tx
      .update(payoutReversals)
      .set({
        status: 'done',
        lastErrorCode: SYSTEM_TOOK_SHARE,
        attemptedAt: null,
        resolvedAt: now,
        ...(decision.reversalId
          ? { stripeReversalId: decision.reversalId }
          : {}),
      })
      .where(
        and(
          eq(payoutReversals.id, record.id),
          inArray(payoutReversals.status, ['pending', 'failed']),
          unleased(now),
          atVersion(version)
        )
      )
      .returning();
    if (!step) return undefined;
    if (decision.transferId) {
      await tx
        .update(payouts)
        .set({
          status: 'reversed',
          stripeTransferId: decision.transferId,
          updatedAt: now,
        })
        .where(
          and(
            eq(payouts.id, slice.id),
            eq(payouts.status, slice.status),
            isNull(payouts.stripeTransferId)
          )
        );
    }
    return step;
  });
  if (done) {
    deps.obs.info(
      'A stranded cancellation took its slice: settled by the system, and paid back',
      {
        payoutReversalId: record.id,
        payoutId: slice.id,
        stripeTransferId: decision.transferId ?? null,
        stripeReversalId: decision.reversalId ?? null,
      }
    );
  }
  return done;
}

/**
 * A stranded step `settleUnfinishedRefundSteps` listed, cancelled in the
 * settlement's transaction if it has not moved since; one the system found
 * the payee kept is marked so, with its born-resolved credit, in the same
 * transaction. False if it moved; else true, or the kept step to report once
 * the transaction commits.
 */
async function cancelStranded(
  tx: Tx,
  record: PayoutReversal,
  payout: Payout,
  stranded: StrandedStep
): Promise<boolean | PayeeKeptStep> {
  const kept = stranded.payeeKept;
  if (
    !(await cancelUnfinished(
      tx,
      stranded.id,
      stranded.version,
      kept ? SYSTEM_PAYEE_KEPT : undefined
    ))
  ) {
    return false;
  }
  if (!kept) return true;
  const creditWrite = await recordPayeeCredit(tx, {
    payoutReversalId: stranded.id,
    payout,
    effect: 'transfer_kept',
    amountCents: null,
    stripeTransferId: kept.stripeTransferId,
    settledAs: 'cancelled',
    alertErrorId: kept.alertErrorId,
  });
  return {
    payoutReversalId: record.id,
    payoutId: payout.id,
    payeeUserId: payout.userId,
    amountCents: record.amountCents,
    stripeTransferId: kept.stripeTransferId,
    alertErrorId: kept.alertErrorId,
    creditWrite,
  };
}

/**
 * A won dispute's stranded `cancellation` on a slice the dispute cancelled
 * (data design §6.2, the dispute path):
 *
 * - it took the slice, and the money is back: `done`, then re-paid like any
 *   done step;
 * - the payee kept a transfer made for the slice: cancelled as
 *   `system_payee_kept`, with a born-resolved `transfer_kept` credit and an
 *   alert to reconcile the slice;
 * - Stripe cannot be asked: `busy`, so the webhook retries;
 * - the rule cannot decide (the residual): cancelled as before, now with an
 *   error alert and an `unverified` credit, which support's queue shows as
 *   `needs_person`: check in Stripe, then decide (owner decisions 2026-10-28).
 *   Never silently.
 *
 * A slice the drain marked `reversed` after the cancel is decided the same
 * way (Codex-2hxff.88).
 *
 * Each cancel and its credit are one transaction, on the decided version.
 */
async function settleStrandedDisputeCancellation(
  deps: ClawbackDeps,
  disputeId: string,
  record: PayoutReversal,
  slice: Payout,
  version: string
): Promise<'repaid' | 'cancelled' | 'busy' | 'none'> {
  const decision = await decideStrandedCancellation(deps, record, slice);
  if (decision.kind === 'unknown') return 'busy';
  if (decision.kind === 'took_share') {
    const done = await recordSystemTook(deps, record, slice, version, decision);
    if (!done) return 'busy';
    return (await writeRepay(deps.db, done, slice, false, deps.obs))
      ? 'repaid'
      : 'none';
  }
  const kept = decision.kind === 'payee_kept' ? decision : undefined;
  const alertErrorId = crypto.randomUUID();
  const cancelled = await deps.db.transaction(async (tx) => {
    if (
      !(await cancelUnfinished(
        tx,
        record.id,
        version,
        kept ? SYSTEM_PAYEE_KEPT : undefined
      ))
    ) {
      return undefined;
    }
    return recordPayeeCredit(tx, {
      payoutReversalId: record.id,
      payout: slice,
      effect: kept ? 'transfer_kept' : 'unverified',
      amountCents: null,
      stripeTransferId: kept?.transferId ?? null,
      settledAs: 'cancelled',
      alertErrorId,
    });
  });
  if (!cancelled) return 'busy';
  if (kept) {
    // Raised after the commit, under the id its credit already carries.
    reportPayeeKept(deps.obs, { disputeId }, [
      {
        payoutReversalId: record.id,
        payoutId: slice.id,
        payeeUserId: slice.userId,
        amountCents: record.amountCents,
        stripeTransferId: kept.transferId,
        alertErrorId,
        creditWrite: cancelled,
      },
    ]);
  } else {
    reportPayeeCreditWrite(
      deps.obs,
      { effect: 'unverified', amountCents: null, alertErrorId },
      cancelled,
      { disputeId, payoutReversalId: record.id }
    );
    deps.obs.error(
      "A won dispute's cancellation step never finished, and the ledger cannot tell whether it took its slice: cancelled, and queued for support to check in Stripe and decide",
      {
        errorId: alertErrorId,
        disputeId,
        payoutReversalId: record.id,
        payoutId: slice.id,
        creatorUserId: slice.userId,
        amountCents: record.amountCents,
        sliceStatus: slice.status,
        why: decision.kind === 'undecidable' ? decision.why : null,
      }
    );
  }
  return 'cancelled';
}

/**
 * A step no retry will ever run: claimed with a lease that ran out (`pending`,
 * which the cron never selects), or `failed` and out of attempts. A step never
 * claimed, one due another retry, or one a delivery holds is not.
 */
function isStranded(record: PayoutReversal): boolean {
  if (isLeased(record)) return false;
  if (record.status === 'pending') return record.attemptedAt !== null;
  return record.attempt >= MAX_CLAWBACK_ATTEMPTS;
}

function leaseStart(now: Date): Date {
  return new Date(now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000);
}

function isLeased(record: PayoutReversal): boolean {
  return (
    record.attemptedAt !== null && record.attemptedAt >= leaseStart(new Date())
  );
}

/** No delivery holds the step's lease. */
function unleased(now: Date): SQL | undefined {
  return or(
    isNull(payoutReversals.attemptedAt),
    lt(payoutReversals.attemptedAt, leaseStart(now))
  );
}

/**
 * Record the reversal Stripe made as the step's outcome, if the step is still
 * the version that was read: the compare-and-set every path that settles a
 * step uses (Codex-2hxff.72). Returns the step if it is now `done`, by this
 * call or another; undefined if it moved to anything else (a delivery claimed
 * it since), which the caller retries.
 */
async function recordLanded(
  deps: ClawbackDeps,
  record: PayoutReversal,
  version: string,
  landed: { id: string }
): Promise<PayoutReversal | undefined> {
  const [recorded] = await deps.db
    .update(payoutReversals)
    .set({
      status: 'done',
      stripeReversalId: landed.id,
      lastErrorCode: null,
      attemptedAt: null,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(payoutReversals.id, record.id),
        inArray(payoutReversals.status, ['pending', 'failed']),
        atVersion(version)
      )
    )
    .returning();
  if (recorded) {
    deps.obs.warn(
      'Stripe made a reversal the clawback never recorded: recorded now, and paid back',
      { payoutReversalId: record.id, stripeReversalId: landed.id }
    );
    return recorded;
  }
  const [current] = await deps.db
    .select()
    .from(payoutReversals)
    .where(eq(payoutReversals.id, record.id))
    .limit(1);
  return current?.status === 'done' ? current : undefined;
}

/**
 * A step's re-pay row and its link, in one transaction that reads the step's
 * link FOR UPDATE first and decides on it as it stands, never on the caller's
 * earlier read (round 2 LOW-2): unlinked, a row is written and linked;
 * linked, the step is re-paid already and nothing is written, unless
 * `takeOverCreditLink` and the link is a payee credit's re-pay
 * (`repayDebtStep`). A concurrent run waits on the lock, then finds the
 * link. On a transaction already open (the failed-refund re-pay) it is a
 * savepoint. The row pays the step's amount to the same payee, organisation
 * and source as `slice`, the step's own payout. Undefined when nothing was
 * written.
 */
async function writeRepay(
  db: Client,
  record: PayoutReversal,
  slice: Payout,
  takeOverCreditLink = false,
  obs?: ClawbackDeps['obs']
): Promise<Payout | undefined> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ link: payoutReversals.repaidByPayoutId })
      .from(payoutReversals)
      .where(eq(payoutReversals.id, record.id))
      .for('update');
    if (!locked) {
      throw new InternalServiceError('The step to re-pay is not recorded', {
        payoutReversalId: record.id,
      });
    }
    const link = locked.link;
    if (link !== null) {
      if (!takeOverCreditLink || !(await isCreditRepay(tx, link))) {
        return undefined;
      }
    }
    const repay = await insertRepayRow(tx, slice, record.amountCents);
    const [linked] = await tx
      .update(payoutReversals)
      .set({ repaidByPayoutId: repay.id })
      .where(
        and(
          eq(payoutReversals.id, record.id),
          link === null
            ? isNull(payoutReversals.repaidByPayoutId)
            : eq(payoutReversals.repaidByPayoutId, link)
        )
      )
      .returning();
    if (!linked) {
      // The step is locked, so this cannot miss; if it does, it is never
      // swallowed: the re-pay rolls back, with what the step now says.
      const [now] = await tx
        .select({ link: payoutReversals.repaidByPayoutId })
        .from(payoutReversals)
        .where(eq(payoutReversals.id, record.id));
      const errorId = crypto.randomUUID();
      obs?.error(
        'A re-pay could not be linked on its locked step: rolled back, not re-paid. Check it by hand',
        {
          errorId,
          payoutReversalId: record.id,
          payoutId: slice.id,
          expectedLink: link,
          link: now?.link ?? null,
        }
      );
      throw new InternalServiceError(
        'The re-pay could not be linked on its step',
        { payoutReversalId: record.id, errorId }
      );
    }
    return repay;
  });
}

/**
 * A payee-paid debt's re-pay (`settleDebt`, `repayFailedRefund`): one pending
 * re-pay row for the step's amount, linked on the step, as `writeRepay`
 * writes it. A link a payee credit's Re-pay set (its `repay_payout_id`) is
 * that credit's re-pay of what Stripe took late, NOT the debt's (owner
 * decision 2026-10-28 on review MED-4, "Still re-pay the £10"): the debt's
 * re-pay still goes ahead and takes the step's link, decided under the
 * step's row lock, and the credit's row stays a re-pay row through its
 * credit (`sourceScope`, `isDrainablePayout`). Any other link is the debt's
 * own re-pay: nothing is written. The other order is `resolvePayeeCredit`'s.
 */
async function repayDebtStep(
  db: Client,
  record: PayoutReversal,
  slice: Payout,
  obs?: ClawbackDeps['obs']
): Promise<Payout | undefined> {
  return writeRepay(db, record, slice, true, obs);
}

/** Whether a payout is a payee credit's re-pay (`repay_payout_id`). */
async function isCreditRepay(db: Client, payoutId: string): Promise<boolean> {
  const [credit] = await db
    .select({ id: payeeCredits.id })
    .from(payeeCredits)
    .where(eq(payeeCredits.repayPayoutId, payoutId))
    .limit(1);
  return credit !== undefined;
}

/**
 * A pending re-pay row for `amountCents`, to the same payee, organisation,
 * source and type as `slice`. It has no charge id, so its transfer comes from
 * the platform balance (no `source_transaction`) and no per-charge unique
 * index applies. A payee-less organisation slice's waits for its next owner.
 * The caller links it (`repaid_by_payout_id`) in the same transaction:
 * `writeRepay`, and a payee credit's Re-pay (`resolvePayeeCredit`).
 */
export async function insertRepayRow(
  tx: Client,
  slice: Payout,
  amountCents: number
): Promise<Payout> {
  const [repay] = await tx
    .insert(payouts)
    .values({
      organizationId: slice.organizationId,
      userId: slice.userId,
      subscriptionId: slice.subscriptionId,
      purchaseId: slice.purchaseId,
      courseSubscriptionId: slice.courseSubscriptionId,
      transferGroup: slice.transferGroup,
      amountCents,
      currency: slice.currency,
      payoutType: slice.payoutType,
      status: 'pending',
      sourceType: slice.sourceType,
      reason: slice.userId ? null : 'no_owner',
    })
    .returning();
  if (!repay) {
    throw new InternalServiceError('The re-pay row was not written', {
      payoutId: slice.id,
    });
  }
  return repay;
}

/**
 * A step's version: its `updated_at` in microseconds, as text. Every write to
 * a step moves it (`$onUpdate`), so an equal version means the step has not
 * changed since it was read. `attempt` and `attempted_at` alone cannot say
 * that: a claim followed by a failure Stripe did not confirm puts both back
 * as they were. Microseconds, because a JS Date drops them.
 */
function stepVersion() {
  return sql<string>`(extract(epoch from ${payoutReversals.updatedAt}) * 1000000)::bigint::text`;
}

/** The step is still the `stepVersion` that was read. */
function atVersion(version: string): SQL {
  return sql`(extract(epoch from ${payoutReversals.updatedAt}) * 1000000)::bigint = ${version}::bigint`;
}

/**
 * Cancel a step Stripe has no reversal for, if no delivery holds it and it is
 * still the version that was checked: compare-and-set (money LOW-B). A step
 * that moved since (a redelivery claimed and tried it) may have landed, so it
 * is left, and the caller treats it as unfinished.
 */
async function cancelUnfinished(
  db: Client,
  stepId: string,
  version: string,
  /** The system's decision, for support's history (`system_payee_kept`). */
  marker?: string
): Promise<boolean> {
  const now = new Date();
  const [cancelled] = await db
    .update(payoutReversals)
    .set({
      status: 'cancelled',
      attemptedAt: null,
      resolvedAt: now,
      ...(marker ? { lastErrorCode: marker } : {}),
    })
    .where(
      and(
        eq(payoutReversals.id, stepId),
        inArray(payoutReversals.status, ['pending', 'failed']),
        unleased(now),
        atVersion(version)
      )
    )
    .returning();
  return cancelled !== undefined;
}

/**
 * A debt step. Settled by the payee (they paid it back, or support reversed
 * it by hand): paid back like a reversal. Otherwise cancelled, with its open
 * review closed as `dispute_won`, in one transaction, so a crash between the
 * two cannot leave a review open for a step a redelivery will now skip.
 *
 * The review is read under a row lock in that transaction: support resolving
 * it at the same moment waits, so a payee's payment is never cancelled
 * instead of paid back.
 */
async function settleDebt(
  deps: ClawbackDeps,
  record: PayoutReversal,
  slice: Payout
): Promise<'repaid' | 'closed' | 'none'> {
  const outcome = await deps.db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(refundReviews)
      .where(eq(refundReviews.payoutReversalId, record.id))
      .limit(1)
      .for('update');
    if (
      review?.resolvedAt &&
      review.resolution &&
      PAYEE_PAID_RESOLUTIONS.has(review.resolution)
    ) {
      return 'payee_paid' as const;
    }
    if (!(await cancelIn(tx, record, ['debt']))) return 'none' as const;
    if (!review || review.resolvedAt) return 'none' as const;
    await tx
      .update(refundReviews)
      .set({ resolution: 'dispute_won', resolvedAt: new Date() })
      .where(eq(refundReviews.id, review.id));
    return 'closed' as const;
  });
  if (outcome !== 'payee_paid') return outcome;
  return (await repayDebtStep(deps.db, record, slice, deps.obs))
    ? 'repaid'
    : 'none';
}

/**
 * The platform fee's share: cancelled, and a fee slice that share had marked
 * `reversed` paid again once the rest no longer covers it. One transaction.
 * False if a delivery holds the step, which the caller retries.
 */
async function cancelFeeShare(
  deps: ClawbackDeps,
  record: PayoutReversal,
  payoutId: string
): Promise<boolean> {
  return deps.db.transaction((tx) => cancelFeeShareIn(tx, record, payoutId));
}

/** `cancelFeeShare`'s two writes, in a transaction the caller holds. */
async function cancelFeeShareIn(
  tx: Tx,
  record: PayoutReversal,
  payoutId: string
): Promise<boolean> {
  // A parameter, not NOW(): Hyperdrive caches by the query's text.
  const now = new Date();
  const [cancelled] = await tx
    .update(payoutReversals)
    .set({ status: 'cancelled', attemptedAt: null, resolvedAt: now })
    .where(
      and(
        eq(payoutReversals.id, record.id),
        or(
          eq(payoutReversals.status, 'done'),
          and(
            inArray(payoutReversals.status, ['pending', 'failed']),
            unleased(now)
          )
        )
      )
    )
    .returning();
  if (!cancelled) return false;
  await tx
    .update(payouts)
    .set({ status: 'paid', updatedAt: now })
    .where(
      and(
        eq(payouts.id, payoutId),
        eq(payouts.status, 'reversed'),
        eq(payouts.payoutType, 'platform_fee'),
        sql`${payouts.amountCents} > (SELECT COALESCE(SUM(${payoutReversals.amountCents}), 0) FROM ${payoutReversals} WHERE ${payoutReversals.payoutId} = ${payoutId} AND ${payoutReversals.status} = 'done')`
      )
    );
  return true;
}

async function cancelIn(
  tx: Tx,
  record: PayoutReversal,
  from: Array<PayoutReversal['status']>
): Promise<boolean> {
  const [cancelled] = await tx
    .update(payoutReversals)
    .set({ status: 'cancelled', attemptedAt: null, resolvedAt: new Date() })
    .where(
      and(
        eq(payoutReversals.id, record.id),
        inArray(payoutReversals.status, from)
      )
    )
    .returning();
  return cancelled !== undefined;
}
