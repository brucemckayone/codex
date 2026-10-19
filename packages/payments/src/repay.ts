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
 * Settle a WON dispute's clawback, idempotently:
 *
 * - a `done` transfer reversal gets one pending re-pay row;
 * - the platform fee's share (`retained_fee`) is cancelled, and a fee slice
 *   that share had marked `reversed` is paid again: the money is back;
 * - a step that had not run is `cancelled`;
 * - a debt (the payee could not cover it) is `cancelled`, and its
 *   `refund_reviews` row is closed as `dispute_won`.
 *
 * Rejects with a `ServiceUnavailableError` (a retry) while another delivery
 * holds one of the dispute's steps: once it finishes, the step is `done` and
 * a redelivery re-pays it.
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
    if (record.status === 'done' && record.kind === 'retained_fee') {
      await cancelRecord(deps, record, ['done']);
      await restoreFeeSlice(deps, slice.id);
      continue;
    }
    if (record.status === 'done') {
      if (record.repaidByPayoutId) continue;
      if (await writeRepay(deps, record, slice)) result.repaid++;
      continue;
    }
    if (record.status === 'debt') {
      if (await cancelRecord(deps, record, ['debt'])) {
        result.debtsClosed += await closeDebt(deps, record.id);
      }
      continue;
    }
    if (record.status === 'pending' || record.status === 'failed') {
      if (await cancelRecord(deps, record, ['pending', 'failed'], true)) {
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

/**
 * Cancel a step, from one of `from`. `unleased`: only if no delivery holds it,
 * the condition its own claim uses.
 */
async function cancelRecord(
  deps: ClawbackDeps,
  record: PayoutReversal,
  from: Array<PayoutReversal['status']>,
  unleased = false
): Promise<boolean> {
  const now = new Date();
  const leaseStart = new Date(
    now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000
  );
  const [cancelled] = await deps.db
    .update(payoutReversals)
    .set({ status: 'cancelled', attemptedAt: null, resolvedAt: now })
    .where(
      and(
        eq(payoutReversals.id, record.id),
        inArray(payoutReversals.status, from),
        unleased
          ? or(
              isNull(payoutReversals.attemptedAt),
              lt(payoutReversals.attemptedAt, leaseStart)
            )
          : undefined
      )
    )
    .returning();
  return cancelled !== undefined;
}

/** Close the dispute's debt for this reversal. Returns how many it closed. */
async function closeDebt(
  deps: ClawbackDeps,
  payoutReversalId: string
): Promise<number> {
  const closed = await deps.db
    .update(refundReviews)
    .set({ resolution: 'dispute_won', resolvedAt: new Date() })
    .where(
      and(
        eq(refundReviews.payoutReversalId, payoutReversalId),
        isNull(refundReviews.resolvedAt)
      )
    )
    .returning();
  return closed.length;
}

/**
 * A platform fee slice the dispute's share had marked `reversed` is `paid`
 * again once that share is cancelled and the rest no longer covers it.
 */
async function restoreFeeSlice(
  deps: ClawbackDeps,
  payoutId: string
): Promise<void> {
  // A parameter, not NOW(): Hyperdrive caches by the query's text.
  const now = new Date();
  await deps.db
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
}
