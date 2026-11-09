/**
 * Which recorded refunds count against their charge as the buyer's money
 * back. One rule for the support screen, the admin revenue figures and the
 * studio Sales tiles, so they can't drift (owner decisions Q-C and
 * 2026-11-09, "Count it as refunded"; Codex-3xnta):
 *
 * - a standing refund (`STANDING_REFUND_STATUSES`): made at Stripe and not
 *   undone;
 * - a failed one support settled as refunded elsewhere: the buyer has that
 *   money back another way, so it counts as if it had succeeded.
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
 * And every reader ties a refund to its payment by one key: a charge's
 * readers by `stripe_charge_id`, a purchase's by `refundsOfPurchase`.
 */

import type { RefundStatus } from '@codex/database/schema';
import { payouts, purchases, refunds } from '@codex/database/schema';
import { eq, inArray, type SQL, sql } from 'drizzle-orm';

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
 * The outer query's purchase (`purchases`, unaliased) owns this refund
 * (`refunds`, unaliased): by `purchase_id`, or, for a refund recorded without
 * it (before the purchase existed, Codex-aa08z), by the purchase's charge.
 * `purchases` holds no charge id, only its PaymentIntent, and `refunds` holds
 * no PaymentIntent, so the charge is the one the purchase's ledger slices
 * name (`payouts`), the same link the support search reads its charge id by.
 * That is the charge the detail counts by `stripe_charge_id`, so a purchase's
 * row and its charge's page count the same refunds. The same rule as
 * `standingRefundFields`, which restates `purchases.refund_amount_cents`. A
 * purchase with no slices (before the ledger) matches by `purchase_id` only.
 *
 * Its own `sql`: interpolated whole, its columns keep their table even in a
 * single-table select (drizzle writes a field's TOP-LEVEL columns bare there,
 * and `purchase_id = id` would then read the refund's own id).
 */
export function refundsOfPurchase(): SQL {
  return sql`(${refunds.purchaseId} = ${purchases.id} OR (${refunds.purchaseId} IS NULL AND ${refunds.stripeChargeId} IN (SELECT ${payouts.stripeChargeId} FROM ${payouts} WHERE ${payouts.purchaseId} = ${purchases.id} AND ${payouts.stripeChargeId} IS NOT NULL)))`;
}

/** What the failed refunds settled as refunded elsewhere add up to, of rows already read. */
export function settledElsewhereCentsIn(
  recorded: ReadonlyArray<{ amountCents: number; resolution: string | null }>
): number {
  return recorded
    .filter((row) => row.resolution === REFUNDED_ELSEWHERE)
    .reduce((sum, row) => sum + row.amountCents, 0);
}
