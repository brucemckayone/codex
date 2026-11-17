/**
 * A blocked payment is owed back in full, and twice it can be owed money
 * Stripe won't refund (owner D59-D64), each a `ShortLossStage`:
 * - `short`: its chargeback was lost for less than the payment. The bank
 *   returned part, and nobody refunds the rest (D59). Support pays it another
 *   way and marks it on the charge page (D60, D61), which writes the dispute's
 *   `refunded_outside_stripe_at` and what was paid, `paid_another_way_cents`.
 * - `owed_again`: that chargeback was then won late, so the bank took it back
 *   from the buyer, and the late win made no refund (D62). Support pays it
 *   another way and marks it a second time (D63), which writes
 *   `late_win_refunded_outside_stripe_at`.
 *
 * One count of what is owed for both (`owedAfterLoss`, D64), read by the loss
 * that writes the refunded amount, the hourly report, the late win's alert
 * and support's charge page, so none of them can disagree (review r3, r4).
 * No date is compared: the first mark is known by its stored amount.
 */

import { PURCHASE_STATUS, type ShortLossStage } from '@codex/constants';
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

/** What the outer query's purchase has back through Stripe: its standing refunds' total. */
function refundedThroughStripe(
  chargeId: SQLWrapper | string | null
): SQL<number> {
  return sql<number>`COALESCE((SELECT SUM(${refunds.amountCents}) FROM ${refunds} WHERE ${standingRefundOf(purchases.id, chargeId)}), 0)::int`.mapWith(
    Number
  );
}

/**
 * The one count of what a blocked payment's buyer is owed (owner D64): what
 * they paid, less the refunds standing on the charge (`standingRefundOf`;
 * `chargeId` is the dispute's), what support paid them another way
 * (`paidAnotherWayCents`, null for none) and the chargeback while it stands
 * lost (`lostCents`), never below 0. Read from the refunds, never the row's
 * `refund_amount_cents`: a pending blocked payment records no part refund of
 * its own (owner D59, review r3). A refund that stands at the mark and later
 * fails stops standing, so what is owed rises by it.
 */
function owedCount(
  chargeId: SQLWrapper | string | null,
  paidAnotherWayCents: SQLWrapper | null,
  lostCents: SQLWrapper | number
): SQL<number> {
  const paidAnotherWay =
    paidAnotherWayCents === null
      ? sql`0`
      : sql`COALESCE(${paidAnotherWayCents}, 0)`;
  return sql<number>`GREATEST(0, ${purchases.amountPaidCents} - ${refundedThroughStripe(chargeId)} - ${paidAnotherWay} - ${lostCents})::int`.mapWith(
    Number
  );
}

/**
 * What a chargeback lost for `lostCents` leaves the outer query's purchase
 * owed before anything is paid another way: the one count (`owedCount`) for
 * a lost dispute with no mark. The loss writes what the buyer has back from
 * it, and for a blocked payment what it leaves is still owed, which the
 * alert at the loss reads. Any other sale lost for less keeps the bank's
 * decision.
 */
export function unrecoveredAfterLoss(
  chargeId: SQLWrapper | string | null,
  lostCents: SQLWrapper | number
): SQL<number> {
  return owedCount(chargeId, null, lostCents);
}

/**
 * What the outer query's purchase is owed on its dispute row (joined as
 * `disputes`): the one count (`owedCount`), less what the first mark paid,
 * and less the chargeback only while it stands lost. Once it is won, the
 * bank has taken it back from the buyer.
 */
function owedAfterLoss(): SQL<number> {
  return owedCount(
    disputes.stripeChargeId,
    disputes.paidAnotherWayCents,
    sql`(CASE WHEN ${disputes.status} = ${'lost'} THEN ${disputes.amountCents} ELSE 0 END)`
  );
}

/** A blocked payment owed what Stripe won't refund, at one of its two stages. */
export interface ShortLoss {
  stage: ShortLossStage;
  purchaseId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  stripeDisputeId: string;
  kind: BlockedPaymentKind;
  amountPaidCents: number;
  /** The chargeback's amount: what the bank returned, while it stood lost. */
  lostCents: number;
  /** The refunds standing on the charge: what the buyer has back through Stripe. */
  refundedThroughStripeCents: number;
  /** What the buyer is owed now (`owedAfterLoss`): 0 once the first mark paid it. */
  owedCents: number;
  currency: string;
  /** When Stripe opened the dispute. */
  openedAt: Date;
  /** The first mark (`paid_another_way_cents`): what support paid another way. */
  paidAnotherWayCents: number | null;
  /** The first mark's date (`refunded_outside_stripe_at`), only with its amount. */
  paidAnotherWayAt: Date | null;
  /** When the chargeback was won late; set at `owed_again`. */
  lateWonAt: Date | null;
  /** The second mark (`late_win_refunded_outside_stripe_at`). */
  paidAgainAt: Date | null;
}

/**
 * The blocked payments owed what Stripe won't refund, at `stage` (both when
 * absent): newest first by when it became owed (the late win, else the
 * dispute), up to `limit`, with how many there are in all (`total`, so a
 * long tail beyond the limit is visible). Linked by `disputes.purchase_id`,
 * as the loss is; only a refunded blocked payment.
 * - `short`: the dispute lost, no first mark, something owed;
 * - `owed_again`: the dispute won late after a first mark, no late-win
 *   refund (D62 made none), no second mark, something owed.
 * `includeMarked` adds the ones marked at their stage, whatever is owed
 * (support's charge page shows the after-state); `chargeId` narrows it to
 * one charge.
 */
export async function findShortLosses(
  db: DatabaseClient | Tx,
  params: {
    stage?: ShortLossStage;
    chargeId?: string;
    includeMarked: boolean;
    limit: number;
  }
): Promise<{ rows: ShortLoss[]; total: number }> {
  const owedCents = owedAfterLoss();
  const owing = (mark: SQLWrapper): SQL =>
    params.includeMarked
      ? sql`(${mark} IS NOT NULL OR ${owedCents} > 0)`
      : sql`(${mark} IS NULL AND ${owedCents} > 0)`;
  const stages: Record<ShortLossStage, SQL> = {
    short: sql`(${disputes.status} = ${'lost'} AND ${owing(disputes.paidAnotherWayCents)})`,
    owed_again: sql`(${disputes.status} = ${'won'} AND ${disputes.lateWonAt} IS NOT NULL AND ${disputes.paidAnotherWayCents} IS NOT NULL AND ${disputes.lateWinRefundId} IS NULL AND ${owing(disputes.lateWinRefundedOutsideStripeAt)})`,
  };
  const inStage =
    params.stage === undefined
      ? sql`(${stages.short} OR ${stages.owed_again})`
      : stages[params.stage];
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
      disputeStatus: disputes.status,
      stripeChargeId: disputes.stripeChargeId,
      stripeDisputeId: disputes.stripeDisputeId,
      lostCents: disputes.amountCents,
      openedAt: disputes.stripeCreatedAt,
      refundedOutsideStripeAt: disputes.refundedOutsideStripeAt,
      paidAnotherWayCents: disputes.paidAnotherWayCents,
      lateWonAt: disputes.lateWonAt,
      paidAgainAt: disputes.lateWinRefundedOutsideStripeAt,
      refundedThroughStripeCents: refundedThroughStripe(
        disputes.stripeChargeId
      ),
      owedCents,
      total: sql<number>`(count(*) OVER ())::int`.mapWith(Number),
    })
    .from(purchases)
    .innerJoin(disputes, eq(disputes.purchaseId, purchases.id))
    .where(
      sql`(${blockedPayment()} AND ${purchases.status} = ${PURCHASE_STATUS.REFUNDED} AND ${inStage} AND ${ofCharge})`
    )
    .orderBy(
      desc(sql`COALESCE(${disputes.lateWonAt}, ${disputes.stripeCreatedAt})`),
      desc(disputes.stripeDisputeId)
    )
    .limit(params.limit);
  const rows = found.flatMap((row): ShortLoss[] => {
    const kind = blockedKind(row);
    if (kind === null) return [];
    return [
      {
        stage: row.disputeStatus === 'lost' ? 'short' : 'owed_again',
        purchaseId: row.purchaseId,
        stripePaymentIntentId: row.stripePaymentIntentId,
        stripeChargeId: row.stripeChargeId,
        stripeDisputeId: row.stripeDisputeId,
        kind,
        amountPaidCents: row.amountPaidCents,
        lostCents: row.lostCents,
        refundedThroughStripeCents: row.refundedThroughStripeCents,
        owedCents: row.owedCents,
        currency: row.currency,
        openedAt: row.openedAt,
        paidAnotherWayCents: row.paidAnotherWayCents,
        // The first mark is known by its amount: another writer of the date
        // (a late win settled by hand) is not this mark.
        paidAnotherWayAt:
          row.paidAnotherWayCents === null ? null : row.refundedOutsideStripeAt,
        lateWonAt: row.lateWonAt,
        paidAgainAt: row.paidAgainAt,
      },
    ];
  });
  return { rows, total: found[0]?.total ?? 0 };
}

/**
 * What one dispute leaves a purchase's buyer owed now (`owedAfterLoss`), and
 * what the first mark paid them another way: the late win's alert on a
 * charge marked paid another way (owner D62, D64). Undefined when the
 * dispute isn't recorded.
 */
export async function owedOnDispute(
  db: DatabaseClient | Tx,
  params: { purchaseId: string; stripeDisputeId: string }
): Promise<
  { owedCents: number; paidAnotherWayCents: number | null } | undefined
> {
  const [row] = await db
    .select({
      owedCents: owedAfterLoss(),
      paidAnotherWayCents: disputes.paidAnotherWayCents,
    })
    .from(disputes)
    .innerJoin(purchases, eq(purchases.id, params.purchaseId))
    .where(eq(disputes.stripeDisputeId, params.stripeDisputeId))
    .limit(1);
  return row;
}
