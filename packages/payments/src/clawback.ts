/**
 * The clawback engine: reverse the payout slices of a refunded charge
 * (the `clawback` module in docs/payments/architecture.md §4.3; Codex-2hxff.56).
 *
 * Stripe does NOT reverse a separate `transfers.create` when the charge it
 * was funded from is refunded, so without this the platform pays the whole
 * refund while creators and organisations keep their slices.
 *
 * WP3b-2 (Codex-2hxff.56.3) moved the purchase and subscription copies here
 * without changing what either does. The copies had drifted. That drift is
 * kept as one TEMPORARY profile per source (`profileFor`): each field is a
 * divergence the 2026-10-19 map found, and names the behaviour PR that
 * deletes it. Once the last field goes, every source runs one path, as the
 * spec requires (docs/payments/purchases.md, subscriptions.md §refunds).
 *
 * Pinned, defects included, by refund-reversal.characterisation.test.ts
 * (@codex/purchase) and subscription-refund-reversal.characterisation.test.ts
 * (@codex/subscription).
 */

import { stripeEnvMetadata } from '@codex/constants';
import { type Payout, payouts, refundReviews } from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import {
  cancelUnpaidPayoutForRefund,
  type LedgerDeps,
  type RefundCancelOutcome,
} from './payout-ledger';

interface ClawbackLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
}

/** The ledger's deps, with a logger that can also warn and inform. */
export interface ClawbackDeps extends LedgerDeps {
  obs: ClawbackLogger;
}

/** The refund being clawed back, as the `charge.refunded` webhook reads it. */
export interface ClawbackRefund {
  /** A value below the source's denominator reverses each slice in part. */
  refundAmountCents: number | null;
  /** Keys the reversal, so two equal-value refunds stay distinct. */
  stripeRefundId: string | null;
}

/** Whose slices are reversed. */
export type ClawbackSource =
  | { sourceType: 'purchase'; purchaseId: string; amountPaidCents: number }
  | { sourceType: 'subscription'; chargeId: string };

interface InsufficientFundsInput {
  row: Payout;
  attemptedReversalCents: number;
  errorId: string;
  error: unknown;
}

/**
 * TEMPORARY: what each source still does differently. Delete a field in the
 * PR that makes both sources agree on it.
 */
interface ClawbackProfile {
  /** Which rows are the refund's. D8 → by charge id, falling back to the source ref. */
  where: SQL;
  /** Denominator of a partial refund. D1 → the Stripe charge amount, for every source. */
  denominator: (rows: readonly Payout[]) => number;
  /**
   * Whether a row whose cancel threw makes the call reject once every other
   * row is done, so the webhook's 500 has Stripe redeliver (subscription).
   * The purchase source cannot use a retry yet: it records the purchase
   * refunded first, and a redelivery stops at that gate before reaching the
   * row. D2 (one record per payout and refund) lets it retry, and deletes
   * this field.
   */
  retriesIncompleteCancels: boolean;
  /** The source's id field on every log line. */
  logContext: Record<string, string>;
  messages: {
    flooredToZero: string;
    reversalFailed: string;
    updateFailed: string;
  };
  /** Whether the reversal-failure log carries an errorId (subscription only). */
  reversalFailedHasErrorId: boolean;
  /** Source fields on the reversal's Stripe metadata. */
  reversalMetadata: (row: Payout) => Record<string, string>;
  /**
   * An `insufficient_funds` reversal. Returns true to leave the row paid,
   * false to mark it reversed anyway. D5 → one refund_reviews row per
   * (payout, refund) for every source; D7 → `balance_insufficient` too.
   */
  onInsufficientFunds: (
    deps: ClawbackDeps,
    input: InsufficientFundsInput
  ) => Promise<boolean>;
}

/**
 * `and()` is typed `SQL | undefined`, and an undefined where-clause selects
 * every payout row, so a scope that failed to build must stop the reversal.
 */
function scoped(where: SQL | undefined): SQL {
  if (!where) {
    throw new InternalServiceError('Clawback row scope did not build');
  }
  return where;
}

function profileFor(source: ClawbackSource): ClawbackProfile {
  switch (source.sourceType) {
    case 'purchase':
      return {
        where: eq(payouts.purchaseId, source.purchaseId),
        denominator: () => source.amountPaidCents,
        retriesIncompleteCancels: false,
        logContext: { purchaseId: source.purchaseId },
        messages: {
          flooredToZero: 'Reversal amount floored to zero, platform absorbs',
          reversalFailed: 'Failed to reverse Stripe transfer for refund',
          updateFailed: 'Failed to update payouts row after refund',
        },
        reversalFailedHasErrorId: false,
        reversalMetadata: () => ({ purchase_id: source.purchaseId }),
        onInsufficientFunds: async (deps, input) => {
          // No payee, no review: the row falls through to 'reversed'.
          if (!input.row.userId) return false;
          await recordRefundReview(deps, {
            purchaseId: source.purchaseId,
            payoutId: input.row.id,
            creatorUserId: input.row.userId,
            attemptedReversalCents: input.attemptedReversalCents,
            errorCode: 'insufficient_funds',
            errorMessage:
              input.error instanceof Error ? input.error.message : null,
          });
          return true;
        },
      };
    case 'subscription':
      return {
        // One-time purchase rows on the same charge carry
        // sourceType='purchase' and are the purchase source's, so running
        // both sources on every `charge.refunded` never reverses a transfer
        // twice.
        where: scoped(
          and(
            eq(payouts.stripeChargeId, source.chargeId),
            eq(payouts.sourceType, 'subscription')
          )
        ),
        // The charged amount, rebuilt as the sum of the recorded slices
        // (platform + org + creator), whatever their status.
        denominator: (rows) => rows.reduce((sum, r) => sum + r.amountCents, 0),
        retriesIncompleteCancels: true,
        logContext: { chargeId: source.chargeId },
        messages: {
          flooredToZero:
            'Subscription reversal amount floored to zero, platform absorbs',
          reversalFailed: 'Failed to reverse subscription transfer for refund',
          updateFailed:
            'Failed to update subscription payouts row after refund',
        },
        reversalFailedHasErrorId: true,
        reversalMetadata: (row) => ({
          subscription_id: row.subscriptionId ?? '',
          charge_id: source.chargeId,
        }),
        onInsufficientFunds: async (deps, input) => {
          // The creator already withdrew their slice; the customer's refund
          // still came out of the platform balance, so the platform holds a
          // clawback obligation that is only in the logs:
          // refund_reviews.purchaseId is NOT NULL (Codex-13v21).
          deps.obs.error(
            'Subscription clawback obligation unresolved (insufficient_funds) — NOT yet queued in refund_reviews',
            {
              errorId: input.errorId,
              chargeId: source.chargeId,
              payoutId: input.row.id,
              creatorUserId: input.row.userId,
              attemptedReversalCents: input.attemptedReversalCents,
            }
          );
          return true;
        },
      };
  }
}

/**
 * Reverse a refund's share of every payout slice of the source.
 *
 * - `platform_fee` had no transfer: the platform kept it, so the row is
 *   marked `reversed` and the refund itself returns the money.
 * - `creator_payout` and `organization_fee` were each a `transfers.create`
 *   against the charge, and are reversed with `transfers.createReversal`.
 * - A pending or failed row is cancelled FIRST, so nothing can settle it
 *   afterwards, then Stripe is asked whether its transfer went out anyway
 *   (in flight when the refund arrived, or made but never recorded,
 *   Codex-2hxff.11). Such a transfer is reversed like a paid row's.
 *
 * A partial refund reverses `floor(row.amountCents * refund / denominator)`
 * of each slice; the rounding stays on the platform balance. A share that
 * floors to zero is not reversed and the row stays paid.
 *
 * One row's failure never stops the others (Codex-2hxff.51). A cancel that
 * failed is logged with an errorId; for a source that retries, the call then
 * rejects with an `InternalServiceError` whose cause is the failure (an
 * `AggregateError` when several rows failed), so the webhook classifies it
 * as transient or permanent exactly as it would the failure itself. Rows
 * already `reversed` or `cancelled_by_refund` are skipped, so a redelivered
 * webhook retries only what is left.
 */
export async function reverseCharge(
  deps: ClawbackDeps,
  source: ClawbackSource,
  refund: ClawbackRefund
): Promise<void> {
  const profile = profileFor(source);
  const rows = await deps.db.select().from(payouts).where(profile.where);

  if (rows.length === 0) return;

  const denominator = profile.denominator(rows);
  const { refundAmountCents, stripeRefundId } = refund;
  // `refund < denominator` with `refund > 0` already implies a positive
  // denominator, so neither source needs its own zero guard.
  const partialNumerator =
    refundAmountCents !== null &&
    refundAmountCents > 0 &&
    refundAmountCents < denominator
      ? refundAmountCents
      : null;
  const reversalAmount = (rowAmountCents: number): number =>
    partialNumerator !== null
      ? Math.floor((rowAmountCents * partialNumerator) / denominator)
      : rowAmountCents;
  // The refund id is unique per refund, so two refunds of equal value get
  // distinct keys. The cents fallback is for callers that never pass the id.
  const idempotencySuffix = stripeRefundId
    ? `_${stripeRefundId}`
    : refundAmountCents !== null
      ? `_${refundAmountCents}`
      : '';

  const failedCancels: unknown[] = [];

  for (const listed of rows) {
    let row: Payout = listed;
    if (row.status === 'reversed' || row.status === 'cancelled_by_refund') {
      continue;
    }

    let transferId = row.stripeTransferId;
    if (row.status === 'pending' || row.status === 'failed') {
      let cancel: RefundCancelOutcome;
      try {
        cancel = await cancelUnpaidPayoutForRefund(deps, row);
      } catch (cancelErr) {
        // Isolated, so the rest of the charge is still clawed back. The row
        // stays pending until a retry cancels it.
        failedCancels.push(cancelErr);
        deps.obs.error('Failed to cancel payouts row for refund', {
          errorId: crypto.randomUUID(),
          ...profile.logContext,
          payoutId: row.id,
          error:
            cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
        });
        continue;
      }
      if (cancel.kind === 'changed') {
        // Paid since it was read: reverse it as paid. Anything else was
        // handled by a concurrent delivery of this refund.
        if (cancel.row?.status !== 'paid') continue;
        row = cancel.row;
        transferId = row.stripeTransferId;
      } else if (cancel.transferId === undefined) {
        continue;
      } else {
        transferId = cancel.transferId;
      }
    }

    // Two cases leave the row paid, because its transfer really did
    // succeed: the reversal hit insufficient funds and the source recorded
    // the obligation, or the share floored to zero (Codex-d9t5r).
    let leavePaid = false;
    if (transferId) {
      const amount = reversalAmount(row.amountCents);
      if (amount === 0) {
        leavePaid = true;
        deps.obs.info(profile.messages.flooredToZero, {
          ...profile.logContext,
          payoutId: row.id,
          rowAmountCents: row.amountCents,
          refundAmountCents,
        });
      } else {
        try {
          await deps.stripe.transfers.createReversal(
            transferId,
            {
              amount,
              metadata: {
                ...profile.reversalMetadata(row),
                payout_id: row.id,
                type: 'refund_reversal',
                ...stripeEnvMetadata(deps.environment),
              },
            },
            { idempotencyKey: `${transferId}_reversal${idempotencySuffix}` }
          );
        } catch (reverseErr) {
          const code = (reverseErr as { code?: string } | null)?.code;
          const errorId = crypto.randomUUID();
          deps.obs.error(profile.messages.reversalFailed, {
            ...(profile.reversalFailedHasErrorId ? { errorId } : {}),
            ...profile.logContext,
            payoutId: row.id,
            stripeTransferId: transferId,
            attemptedReversalCents: amount,
            code: code ?? null,
            error:
              reverseErr instanceof Error
                ? reverseErr.message
                : String(reverseErr),
          });
          if (code === 'insufficient_funds') {
            leavePaid = await profile.onInsufficientFunds(deps, {
              row,
              attemptedReversalCents: amount,
              errorId,
              error: reverseErr,
            });
          }
          // Any other failure falls through and the row is marked reversed
          // (a defect both sources share: D3).
        }
      }
    }

    if (leavePaid) continue;

    // Every row left here moved money (a paid slice, the platform's retained
    // fee, or a cancelled row whose transfer had gone out) and is now
    // reversed, with its transfer recorded (Codex-92ej7).
    const nextStatus = 'reversed' as const;
    try {
      await deps.db
        .update(payouts)
        .set({
          status: nextStatus,
          stripeTransferId: transferId,
          resolvedAt: row.resolvedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(payouts.id, row.id));
    } catch (updateErr) {
      deps.obs.error(profile.messages.updateFailed, {
        ...profile.logContext,
        payoutId: row.id,
        nextStatus,
        error:
          updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
    }
  }

  if (failedCancels.length > 0 && profile.retriesIncompleteCancels) {
    throw new InternalServiceError(
      'Refund clawback incomplete: a payout row could not be cancelled',
      { failedRows: failedCancels.length },
      {
        cause:
          failedCancels.length === 1
            ? failedCancels[0]
            : new AggregateError(failedCancels),
      }
    );
  }
}

/**
 * Queue a purchase clawback that Stripe refused for `insufficient_funds`
 * (Codex-d9t5r / DQ-7). The payouts row stays paid, because the original
 * transfer succeeded; this row is the obligation, for ops to settle as
 * creator-absorbed, platform-absorbed or manual.
 */
async function recordRefundReview(
  deps: ClawbackDeps,
  input: {
    purchaseId: string;
    payoutId: string;
    creatorUserId: string;
    attemptedReversalCents: number;
    errorCode: string;
    errorMessage: string | null;
  }
): Promise<void> {
  try {
    await deps.db
      .insert(refundReviews)
      .values({
        purchaseId: input.purchaseId,
        payoutId: input.payoutId,
        creatorUserId: input.creatorUserId,
        attemptedReversalCents: input.attemptedReversalCents,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      })
      // Webhook replay safety: targets the partial unique index
      // `uq_refund_reviews_open_per_payout`, so a second delivery collapses
      // while resolved history rows stay insertable.
      .onConflictDoNothing({
        target: refundReviews.payoutId,
        where: sql`${refundReviews.resolvedAt} IS NULL`,
      });
    deps.obs.warn('Refund review queued for ops resolution', {
      purchaseId: input.purchaseId,
      payoutId: input.payoutId,
      creatorUserId: input.creatorUserId,
      attemptedReversalCents: input.attemptedReversalCents,
      errorCode: input.errorCode,
    });
  } catch (insertErr) {
    deps.obs.error('Failed to write refund_reviews row', {
      purchaseId: input.purchaseId,
      payoutId: input.payoutId,
      error: insertErr instanceof Error ? insertErr.message : String(insertErr),
    });
  }
}
