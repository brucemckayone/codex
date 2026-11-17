/**
 * A blocked payment whose chargeback was lost for less than the payment: the
 * bank returned part, nobody refunds the rest, and the buyer is owed it
 * (owner D59). Support pays it another way and marks it on the charge page
 * (owner D60, D61), which sets the dispute's `refunded_outside_stripe_at`.
 *
 * One count of what is still owed (`unrecoveredAfterLoss`), used by the loss
 * that writes the refunded amount, by the hourly report and by support's
 * charge page, so the three can never disagree (review r3, r4).
 */

import { PURCHASE_STATUS } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { disputes, purchases, refunds } from '@codex/database/schema';
import { desc, eq, inArray, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import {
  type BlockedPaymentKind,
  blockedKind,
  blockedPayment,
} from './blocked-payment';
import { STANDING_REFUND_STATUSES } from './counted-refunds';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * The refunds that still stand on a purchase's charge
 * (`STANDING_REFUND_STATUSES`: a failed or canceled one returned nothing):
 * the purchase's own, and one of `chargeId` still without a `purchase_id`
 * (recorded before the purchase existed, Codex-aa08z). Each is a value or
 * the outer query's column; with no `chargeId`, the purchase's own only.
 * One fragment, so no part can be dropped.
 */
export function standingRefundOf(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL {
  const ofCharge =
    chargeId === null
      ? sql`FALSE`
      : sql`(${refunds.purchaseId} IS NULL AND ${refunds.stripeChargeId} = ${chargeId})`;
  return sql`((${refunds.purchaseId} = ${purchaseId} OR ${ofCharge}) AND ${inArray(refunds.status, STANDING_REFUND_STATUSES)})`;
}

/**
 * What the buyer has NOT had back of the outer query's purchase once a
 * chargeback on it is lost: what they paid, less the refunds standing on the
 * charge (`standingRefundOf`; `chargeId` is the dispute's) and the
 * chargeback's `lostCents`, never below 0. Read from the refunds, never the
 * row's `refund_amount_cents`: a pending blocked payment records no part
 * refund of its own (owner D59, review r3). The one count of it: the loss
 * writes what the buyer has back from it, and for a blocked payment what it
 * leaves is still owed, which the alert at the loss, the hourly report and
 * the charge page read (`findShortLosses`). Any other sale lost for less
 * keeps the bank's decision.
 */
export function unrecoveredAfterLoss(
  chargeId: SQLWrapper | string | null,
  lostCents: SQLWrapper | number
): SQL<number> {
  return sql<number>`GREATEST(0, ${purchases.amountPaidCents} - COALESCE((SELECT SUM(${refunds.amountCents}) FROM ${refunds} WHERE ${standingRefundOf(purchases.id, chargeId)}), 0) - ${lostCents})::int`.mapWith(
    Number
  );
}

/** A blocked payment a lost chargeback refunded only in part. */
export interface ShortLoss {
  purchaseId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  stripeDisputeId: string;
  kind: BlockedPaymentKind;
  amountPaidCents: number;
  /** What the bank returned: the lost chargeback's amount. */
  lostCents: number;
  /** The rest, still owed (`unrecoveredAfterLoss`); once marked, what was paid another way. */
  owedCents: number;
  currency: string;
  /** When Stripe opened the dispute. */
  openedAt: Date;
  /** The dispute's `refunded_outside_stripe_at`: support paid the rest another way. */
  paidAnotherWayAt: Date | null;
}

/**
 * The blocked payments a lost chargeback refunded only in part, newest
 * dispute first, up to `limit`, with how many there are in all (`total`, so
 * a long tail beyond the limit is visible). One marked paid another way is
 * left out unless `includePaidAnotherWay`; `chargeId` narrows it to one
 * charge. Linked by `disputes.purchase_id`, as the loss is.
 */
export async function findShortLosses(
  db: DatabaseClient | Tx,
  params: { chargeId?: string; includePaidAnotherWay: boolean; limit: number }
): Promise<{ rows: ShortLoss[]; total: number }> {
  const owedCents = unrecoveredAfterLoss(
    disputes.stripeChargeId,
    disputes.amountCents
  );
  const unmarked = params.includePaidAnotherWay
    ? sql`TRUE`
    : sql`${disputes.refundedOutsideStripeAt} IS NULL`;
  const ofCharge =
    params.chargeId === undefined
      ? sql`TRUE`
      : sql`${disputes.stripeChargeId} = ${params.chargeId}`;
  const found = await db
    .select({
      purchaseId: purchases.id,
      stripePaymentIntentId: purchases.stripePaymentIntentId,
      duplicateOfPurchaseId: purchases.duplicateOfPurchaseId,
      refundReason: purchases.refundReason,
      amountPaidCents: purchases.amountPaidCents,
      currency: purchases.currency,
      stripeChargeId: disputes.stripeChargeId,
      stripeDisputeId: disputes.stripeDisputeId,
      lostCents: disputes.amountCents,
      openedAt: disputes.stripeCreatedAt,
      paidAnotherWayAt: disputes.refundedOutsideStripeAt,
      owedCents,
      total: sql<number>`(count(*) OVER ())::int`.mapWith(Number),
    })
    .from(purchases)
    .innerJoin(disputes, eq(disputes.purchaseId, purchases.id))
    .where(
      sql`(${blockedPayment()} AND ${purchases.status} = ${PURCHASE_STATUS.REFUNDED} AND ${disputes.status} = ${'lost'} AND ${owedCents} > 0 AND ${unmarked} AND ${ofCharge})`
    )
    .orderBy(desc(disputes.stripeCreatedAt), desc(disputes.stripeDisputeId))
    .limit(params.limit);
  const rows = found.flatMap((row): ShortLoss[] => {
    const kind = blockedKind(row);
    if (kind === null) return [];
    return [
      {
        purchaseId: row.purchaseId,
        stripePaymentIntentId: row.stripePaymentIntentId,
        stripeChargeId: row.stripeChargeId,
        stripeDisputeId: row.stripeDisputeId,
        kind,
        amountPaidCents: row.amountPaidCents,
        lostCents: row.lostCents,
        owedCents: row.owedCents,
        currency: row.currency,
        openedAt: row.openedAt,
        paidAnotherWayAt: row.paidAnotherWayAt,
      },
    ];
  });
  return { rows, total: found[0]?.total ?? 0 };
}
