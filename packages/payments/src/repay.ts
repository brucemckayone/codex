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
 */

import {
  type Payout,
  type PayoutReversal,
  payoutReversals,
  payouts,
  refundReviews,
} from '@codex/database/schema';
import { ConflictError, ServiceUnavailableError } from '@codex/service-errors';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ClawbackDeps } from './clawback';
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
 *   that share had marked `reversed` is paid again: the money is back.
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
    .select({ record: payoutReversals, slice: payouts })
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
  for (const { record, slice } of steps) {
    if (record.kind === 'retained_fee') {
      if (record.status === 'cancelled') continue;
      await cancelFeeShare(deps, record, slice.id);
      continue;
    }
    if (record.status === 'done') {
      if (!record.repaidByPayoutId && (await writeRepay(deps, record, slice))) {
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
        await recordLanded(deps, record, landed);
        if (await writeRepay(deps, record, slice)) result.repaid++;
      } else if (await cancelUnfinished(deps, record)) {
        result.cancelled++;
      } else {
        busy++;
      }
    }
  }

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

function leaseStart(now: Date): Date {
  return new Date(now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000);
}

function isLeased(record: PayoutReversal): boolean {
  return (
    record.attemptedAt !== null && record.attemptedAt >= leaseStart(new Date())
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

async function recordLanded(
  deps: ClawbackDeps,
  record: PayoutReversal,
  landed: { id: string }
): Promise<void> {
  await deps.db
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
    );
  deps.obs.warn(
    'A won dispute found a reversal the clawback never recorded; paying it back',
    { payoutReversalId: record.id, stripeReversalId: landed.id }
  );
}

/**
 * The re-pay row and its link, in one transaction: a concurrent delivery that
 * linked first rolls this one back. False when it lost that race.
 */
async function writeRepay(
  deps: ClawbackDeps,
  record: PayoutReversal,
  slice: Payout
): Promise<boolean> {
  try {
    await deps.db.transaction(async (tx) => {
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
      if (!repay) throw new ConflictError('The re-pay row was not written');
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
    });
    return true;
  } catch (error) {
    if (error instanceof ConflictError) return false;
    throw error;
  }
}

/** Cancel a step that never reached Stripe, if no delivery holds it. */
async function cancelUnfinished(
  deps: ClawbackDeps,
  record: PayoutReversal
): Promise<boolean> {
  const now = new Date();
  const [cancelled] = await deps.db
    .update(payoutReversals)
    .set({ status: 'cancelled', attemptedAt: null, resolvedAt: now })
    .where(
      and(
        eq(payoutReversals.id, record.id),
        inArray(payoutReversals.status, ['pending', 'failed']),
        or(
          isNull(payoutReversals.attemptedAt),
          lt(payoutReversals.attemptedAt, leaseStart(now))
        )
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
 */
async function settleDebt(
  deps: ClawbackDeps,
  record: PayoutReversal,
  slice: Payout
): Promise<'repaid' | 'closed' | 'none'> {
  const [review] = await deps.db
    .select()
    .from(refundReviews)
    .where(eq(refundReviews.payoutReversalId, record.id))
    .limit(1);
  if (
    review?.resolvedAt &&
    review.resolution &&
    PAYEE_PAID_RESOLUTIONS.has(review.resolution)
  ) {
    if (record.repaidByPayoutId) return 'none';
    return (await writeRepay(deps, record, slice)) ? 'repaid' : 'none';
  }

  return deps.db.transaction(async (tx) => {
    if (!(await cancelIn(tx, record, ['debt']))) return 'none' as const;
    const closed = await tx
      .update(refundReviews)
      .set({ resolution: 'dispute_won', resolvedAt: new Date() })
      .where(
        and(
          eq(refundReviews.payoutReversalId, record.id),
          isNull(refundReviews.resolvedAt)
        )
      )
      .returning();
    return closed.length > 0 ? ('closed' as const) : ('none' as const);
  });
}

/**
 * The platform fee's share: cancelled, and a fee slice that share had marked
 * `reversed` paid again once the rest no longer covers it. One transaction.
 */
async function cancelFeeShare(
  deps: ClawbackDeps,
  record: PayoutReversal,
  payoutId: string
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await cancelIn(tx, record, ['pending', 'failed', 'done']);
    // A parameter, not NOW(): Hyperdrive caches by the query's text.
    const now = new Date();
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
  });
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
