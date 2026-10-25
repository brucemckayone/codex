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
 *
 * A failed refund that support settles as `creators_repaid` is paid back the
 * same way, by the same row writer (`repayFailedRefund`, Codex-2hxff.28).
 */

import {
  disputes,
  type Payout,
  type PayoutReversal,
  payoutReversals,
  payouts,
  refundReviews,
  refunds,
} from '@codex/database/schema';
import {
  BusinessLogicError,
  ConflictError,
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
  listClawableRefunds,
  MAX_CLAWBACK_ATTEMPTS,
  type RepayBlockReason,
  recordedClawableRefunds,
  reverseCharge,
  settleIfFullyReversed,
} from './clawback';
import { PAYOUT_ATTEMPT_LEASE_MINUTES } from './payout-ledger';

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
const PAYEE_PAID_RESOLUTIONS: ReadonlySet<string> = new Set([
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
 *   only a step that never reached Stripe is `cancelled`;
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
        (await writeRepay(deps.db, record, slice))
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
      const landed =
        record.kind === 'transfer_reversal' && slice.stripeTransferId
          ? await findLandedReversal(deps, slice.stripeTransferId, record.id)
          : undefined;
      if (landed) {
        const done = await recordLanded(deps, record, landed);
        if (!done) {
          busy++;
          continue;
        }
        // As the clawback does after a reversal: a slice reversed whole is
        // `reversed`, so totals count its re-pay row and not it as well.
        await settleIfFullyReversed(deps, slice.id);
        if (await writeRepay(deps.db, done, slice)) result.repaid++;
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
 * different to do.
 */
export const REFUND_REPAY_CODES = {
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
 *    (compare-and-set). Any other step still pending or failed is still
 *    running (a retry is due, a delivery holds it, or it moved since the
 *    check), so this throws `REFUND_CLAWBACK_UNFINISHED`: support tries again
 *    later. One the ledger cannot read (`needsAPerson`) throws
 *    `REFUND_CLAWBACK_NEEDS_PERSON` instead, because retrying will not help.
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
  }
): Promise<FailedRefundRepay[]> {
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
    (input.unlanded ?? []).map((step) => [step.id, step.version])
  );
  let unfinished = 0;
  let forPerson = 0;
  for (const { record, payout } of steps) {
    if (record.status !== 'pending' && record.status !== 'failed') continue;
    if (needsAPerson(record, payout)) {
      forPerson++;
      continue;
    }
    if (await cancelUnclaimedStep(tx, record.id)) continue;
    const version = checked.get(record.id);
    if (version && (await cancelUnfinished(tx, record.id, version))) continue;
    unfinished++;
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
  const repay = async (record: PayoutReversal, payout: Payout) => {
    const row = await writeRepay(tx, record, payout);
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
      PAYEE_PAID_RESOLUTIONS.has(review.resolution) &&
      !record.repaidByPayoutId
    ) {
      await repay(record, payout);
    }
  }
  return repaid;
}

/** What `settleUnfinishedRefundSteps` found. */
export interface UnfinishedRefundSteps {
  /** Steps whose reversal Stripe had made: recorded `done`, so they are re-paid. */
  landed: number;
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
 * - a cancellation whose slice is already `cancelled_by_refund` is left
 *   alone and logged for a person (`needsAPerson`).
 *
 * A step never claimed, a step due another retry, and a step a delivery holds
 * are left as they are. The settlement cancels the first and refuses the
 * other two.
 *
 * Stripe: `transfers.listReversals`, for each such transfer reversal.
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
    unlanded: [],
    forPerson: 0,
  };
  for (const { record, payout, version } of steps) {
    if (!isStranded(record)) continue;
    if (needsAPerson(record, payout)) {
      result.forPerson++;
      deps.obs.error(
        "A failed refund's cancellation step never finished, and its slice is cancelled: a person must decide whether it took the slice before the refund is re-paid",
        {
          errorId: crypto.randomUUID(),
          stripeRefundId: input.stripeRefundId,
          payoutReversalId: record.id,
          payoutId: payout.id,
        }
      );
      continue;
    }
    if (record.kind === 'transfer_reversal' && payout.stripeTransferId) {
      const landed = await findLandedReversal(
        deps,
        payout.stripeTransferId,
        record.id
      );
      if (landed) {
        if (await recordLanded(deps, record, landed)) {
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
 * is already `cancelled_by_refund`. It cannot tell whether this step's cancel
 * took the slice, or whether a transfer it then reversed went out, so a
 * person must look (`REFUND_CLAWBACK_NEEDS_PERSON`).
 */
function needsAPerson(record: PayoutReversal, payout: Payout): boolean {
  return (
    isStranded(record) &&
    record.kind === 'cancellation' &&
    payout.status === 'cancelled_by_refund'
  );
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
 * The reversal Stripe made for this step, if any: every reversal the engine
 * makes names its step in `payout_reversal_id`.
 */
async function findLandedReversal(
  deps: ClawbackDeps,
  transferId: string,
  payoutReversalId: string
): Promise<{ id: string } | undefined> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await deps.stripe.transfers.listReversals(transferId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = page.data.find(
      (reversal) => reversal.metadata?.payout_reversal_id === payoutReversalId
    );
    if (found) return { id: found.id };
    const last = page.data.at(-1);
    if (!page.has_more || !last) return undefined;
    startingAfter = last.id;
  }
}

/**
 * Record the reversal Stripe made as the step's outcome. Returns the step if
 * it is now `done`, by this call or a concurrent one; undefined if it moved
 * to anything else, which the caller retries.
 */
async function recordLanded(
  deps: ClawbackDeps,
  record: PayoutReversal,
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
        inArray(payoutReversals.status, ['pending', 'failed'])
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
 * A step's re-pay row and its link, in one transaction: a concurrent run that
 * linked first rolls this one back. On a transaction already open (the
 * failed-refund re-pay), it is a savepoint, so only this row rolls back. The
 * row pays the step's amount to the same payee, organisation and source as
 * `slice`, the step's own payout. Undefined when it lost that race.
 */
async function writeRepay(
  db: Client,
  record: PayoutReversal,
  slice: Payout
): Promise<Payout | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const [repay] = await tx
        .insert(payouts)
        .values({
          organizationId: slice.organizationId,
          userId: slice.userId,
          subscriptionId: slice.subscriptionId,
          purchaseId: slice.purchaseId,
          courseSubscriptionId: slice.courseSubscriptionId,
          transferGroup: slice.transferGroup,
          amountCents: record.amountCents,
          currency: slice.currency,
          payoutType: slice.payoutType,
          status: 'pending',
          sourceType: slice.sourceType,
          // A payee-less organisation slice waits for its next owner.
          reason: slice.userId ? null : 'no_owner',
        })
        .returning();
      if (!repay) {
        throw new InternalServiceError('The re-pay row was not written', {
          payoutReversalId: record.id,
        });
      }
      const [linked] = await tx
        .update(payoutReversals)
        .set({ repaidByPayoutId: repay.id })
        .where(
          and(
            eq(payoutReversals.id, record.id),
            isNull(payoutReversals.repaidByPayoutId)
          )
        )
        .returning();
      if (!linked) {
        throw new ConflictError('Another delivery paid this reversal back', {
          payoutReversalId: record.id,
        });
      }
      return repay;
    });
  } catch (error) {
    // The one ConflictError above is the lost link: a concurrent run set this
    // step's repaid_by_payout_id between the caller's read and this write, so
    // the step IS re-paid, by that run's row, and this row rolls back with its
    // savepoint. It is the expected repeat of a won dispute's concurrent
    // deliveries. A failed refund's re-pay holds its refunds row FOR UPDATE, so
    // it never meets it.
    if (error instanceof ConflictError) return undefined;
    throw error;
  }
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

/**
 * Cancel a step Stripe has no reversal for, if no delivery holds it and it is
 * still the version that was checked: compare-and-set (money LOW-B). A step
 * that moved since (a redelivery claimed and tried it) may have landed, so it
 * is left, and the caller treats it as unfinished.
 */
async function cancelUnfinished(
  db: Client,
  stepId: string,
  version: string
): Promise<boolean> {
  const now = new Date();
  const [cancelled] = await db
    .update(payoutReversals)
    .set({ status: 'cancelled', attemptedAt: null, resolvedAt: now })
    .where(
      and(
        eq(payoutReversals.id, stepId),
        inArray(payoutReversals.status, ['pending', 'failed']),
        unleased(now),
        sql`(extract(epoch from ${payoutReversals.updatedAt}) * 1000000)::bigint = ${version}::bigint`
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
  if (record.repaidByPayoutId) return 'none';
  return (await writeRepay(deps.db, record, slice)) ? 'repaid' : 'none';
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
