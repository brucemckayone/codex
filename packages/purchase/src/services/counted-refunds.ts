/**
 * Which recorded refunds count against their charge as the buyer's money
 * back. One rule for the support screen, the admin revenue figures and the
 * studio Sales tiles, so they can't drift (owner decisions Q-C and
 * 2026-11-09, "Count it as refunded"; Codex-3xnta):
 *
 * - a standing refund (`STANDING_REFUND_STATUSES`): made at Stripe and not
 *   undone;
 * - a failed one support settled as refunded elsewhere: the buyer has that
 *   money back another way, so it counts as if it had succeeded. A failed one
 *   not yet settled counts nothing (Codex-2hxff.28).
 *
 * What went back to a payment's buyer, the admin revenue's `taken` and the
 * studio Sales "Refunds" alike, is those refunds plus its lost chargebacks,
 * never more than it paid (`takenBack`). Both read our record, never a
 * purchase's own `refund_amount_cents`, which a failed full refund leaves at
 * the full amount until support settles it (owner decision 2026-11-09). Net
 * and Count follow the purchase's status, so a purchase whose only refund
 * failed and isn't settled yet drops out of both until support settles it:
 * `refunded` also drives the buyer's access (owner decision 2026-11-09).
 *
 * Each refund counts once: only a failed row holds a resolution
 * (`check_refunds_resolution`), a failed refund is final at Stripe and in our
 * record (`recordRefund`), and no standing status is `failed`. A reader that
 * adds Stripe's own list to our record skips a recorded row Stripe shows
 * standing (the support charge page).
 *
 * Each figure is also capped at its charge. Two refunds can both count for
 * one payment: the late-win runbook refunds a late win's failed refund again
 * through Stripe, then settles the failed one as refunded elsewhere. So every
 * reader clamps its total to what was paid (`LEAST`, `Math.min`).
 *
 * And every reader ties a refund or a chargeback to its payment by one key: a
 * charge's readers by `stripe_charge_id` (`refundsOfCharge`,
 * `disputesOfCharge`), a purchase's by `refundsOfPurchase` and
 * `disputesOfPurchase`, and one payment's readers outside the ledger (what a
 * blocked payment is owed, the restore, the late win's refund, and support's
 * queue deferring a refund to its chargeback) by its charge
 * (`refundsOfPayment`, `countedRefundOf`, `refundOfDispute`; review r7).
 */

import type { RefundStatus } from '@codex/database/schema';
import { disputes, payouts, purchases, refunds } from '@codex/database/schema';
import {
  type AnyColumn,
  eq,
  inArray,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm';

/**
 * The refunds that count against what was paid: made and not undone. A failed
 * or canceled refund gave the buyer nothing (Codex-2hxff.28): support may
 * refund that amount again, and a failed full refund gives access back.
 */
export const STANDING_REFUND_STATUSES: readonly RefundStatus[] = [
  'pending',
  'requires_action',
  'succeeded',
];

/** The resolution that counts a failed refund as refunded. */
const REFUNDED_ELSEWHERE = 'refunded_elsewhere';

/** A failed refund support settled as refunded elsewhere, on `refunds`. */
export function settledElsewhere(): SQL {
  return eq(refunds.resolution, REFUNDED_ELSEWHERE);
}

/**
 * The refunds that count against their charge, as a predicate on `refunds`
 * (unaliased). Joined with `sql`, never `or()`, so it is never undefined:
 * `and()` would drop an undefined filter without a word.
 */
export function countsAgainstCharge(): SQL {
  return sql`(${inArray(refunds.status, [...STANDING_REFUND_STATUSES])} OR ${settledElsewhere()})`;
}

/**
 * The outer query's purchase (`purchases`, unaliased) owns this row: by its
 * `purchase_id`, or, for a row recorded without it (before the purchase
 * existed, Codex-aa08z), by the purchase's charge. `purchases` holds no
 * charge id, only its PaymentIntent, and neither `refunds` nor `disputes`
 * holds a PaymentIntent, so the charge is the one the purchase's ledger
 * slices name (`payouts`), the same link the support search reads its charge
 * id by. That is the charge the detail and the revenue count by
 * `stripe_charge_id`, so a purchase's row and its charge count the same rows.
 * A purchase with no slices (before the ledger, or a blocked payment) matches
 * by `purchase_id` only, so a reader of one payment outside the ledger keys
 * on its charge instead (`refundsOfPayment`).
 *
 * Its own `sql`: interpolated whole, its columns keep their table even in a
 * single-table select (drizzle writes a field's TOP-LEVEL columns bare there,
 * and `purchase_id = id` would then read the row's own id).
 */
function ownedByPurchase(purchaseId: AnyColumn, chargeId: AnyColumn): SQL {
  return sql`(${purchaseId} = ${purchases.id} OR (${purchaseId} IS NULL AND ${chargeId} IN (SELECT ${payouts.stripeChargeId} FROM ${payouts} WHERE ${payouts.purchaseId} = ${purchases.id} AND ${payouts.stripeChargeId} IS NOT NULL)))`;
}

/** A `refunds` row (unaliased) of the outer query's purchase (`ownedByPurchase`). */
export function refundsOfPurchase(): SQL {
  return ownedByPurchase(refunds.purchaseId, refunds.stripeChargeId);
}

/** A `disputes` row (unaliased) of the outer query's purchase (`ownedByPurchase`). */
export function disputesOfPurchase(): SQL {
  return ownedByPurchase(disputes.purchaseId, disputes.stripeChargeId);
}

/** A `refunds` row (unaliased) of the charge `chargeId` names: a column, or a CTE's. */
export function refundsOfCharge(chargeId: AnyColumn | SQL): SQL {
  return sql`${refunds.stripeChargeId} = ${chargeId}`;
}

/**
 * A `refunds` row (unaliased) of one payment, read outside the ledger, keyed
 * on its CHARGE (`chargeId`, review r7): every refund of that charge, linked
 * to the purchase or not (one recorded before the purchase existed has no
 * `purchase_id`, Codex-aa08z). Only with no charge known, the purchase's own
 * rows (`purchaseId`). Each is a value or the outer query's column.
 *
 * Never the purchase's rows as well: every writer of `refunds.purchase_id`
 * derives it from the refund's own PaymentIntent, and a PaymentIntent has one
 * charge, so on real data the purchase's rows are its charge's; a union would
 * only let a wrong or missing charge id pass unseen, and widen the count the
 * day a writer links a refund some other way. Nor `purchase_id IS NULL` on
 * the charge's: no reader can meet another purchase's refund on a charge.
 * Never through the payout slices, as `refundsOfPurchase` is: a blocked
 * payment writes none (review r6).
 */
export function refundsOfPayment(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL {
  return chargeId === null
    ? sql`(${refunds.purchaseId} = ${purchaseId})`
    : sql`(${refunds.stripeChargeId} = ${chargeId})`;
}

/**
 * A `refunds` row (unaliased) of the payment the outer query's `disputes` row
 * (unaliased) disputes: on its charge (`refundsOfPayment`). The key support's
 * queue defers a blocked payment's failed refund to its chargeback by, the
 * same one its debt is counted by, so the queue and the owed count can't
 * drift (review r7).
 */
export function refundOfDispute(): SQL {
  return refundsOfPayment(disputes.purchaseId, disputes.stripeChargeId);
}

/**
 * The refunds that count against one payment (`refundsOfPayment`,
 * `countsAgainstCharge`): standing, or failed and settled refunded
 * elsewhere. The one rule what a blocked payment is owed, a lost dispute's
 * refunded amount, the failed-refund restore and the late win's refund all
 * read (owner D66, D69), so none of them can disagree.
 */
export function countedRefundOf(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL {
  return sql`(${refundsOfPayment(purchaseId, chargeId)} AND ${countsAgainstCharge()})`;
}

/** A `disputes` row (unaliased) of the charge `chargeId` names: a column, or a CTE's. */
export function disputesOfCharge(chargeId: AnyColumn | SQL): SQL {
  return sql`${disputes.stripeChargeId} = ${chargeId}`;
}

/**
 * What went back to one payment's buyer: its refunds that count
 * (`countsAgainstCharge`) and its lost chargebacks, never more than `paid`
 * (owner decisions Q-C and 2026-11-09). `refundOf` ties a `refunds` row to
 * the payment and `disputeOf` a `disputes` row, both unaliased: a charge's
 * (`refundsOfCharge`, `disputesOfCharge`) or a purchase's
 * (`refundsOfPurchase`, `disputesOfPurchase`). Its own `sql`, so it nests
 * whole (see `ownedByPurchase`).
 */
export function takenBack(
  paid: AnyColumn | SQL,
  refundOf: SQL,
  disputeOf: SQL
): SQL {
  return sql`LEAST(${paid}, COALESCE((SELECT SUM(${refunds.amountCents}) FROM ${refunds} WHERE ${refundOf} AND ${countsAgainstCharge()}), 0) + COALESCE((SELECT SUM(${disputes.amountCents}) FROM ${disputes} WHERE ${disputeOf} AND ${disputes.status} = 'lost'), 0))`;
}

/** What the failed refunds settled as refunded elsewhere add up to, of rows already read. */
export function settledElsewhereCentsIn(
  recorded: ReadonlyArray<{ amountCents: number; resolution: string | null }>
): number {
  return recorded
    .filter((row) => row.resolution === REFUNDED_ELSEWHERE)
    .reduce((sum, row) => sum + row.amountCents, 0);
}
