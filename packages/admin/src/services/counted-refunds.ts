/**
 * Which recorded refunds count against their charge as the buyer's money
 * back. One rule for the support screen and the revenue figures, so the two
 * can't drift (owner decisions Q-C and 2026-11-09, "Count it as refunded";
 * Codex-3xnta):
 *
 * - a standing refund (`STANDING_REFUND_STATUSES`): made at Stripe and not
 *   undone;
 * - a failed one support settled as refunded elsewhere: the buyer has that
 *   money back another way, so it counts as if it had succeeded.
 *
 * Never counted twice: only a failed row holds a resolution
 * (`check_refunds_resolution`), a failed refund is final at Stripe and in our
 * record (`recordRefund`), and no standing status is `failed`.
 */

import { refunds } from '@codex/database/schema';
import { STANDING_REFUND_STATUSES } from '@codex/purchase';
import { eq, inArray, type SQL, sql } from 'drizzle-orm';

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

/** What the failed refunds settled as refunded elsewhere add up to, of rows already read. */
export function settledElsewhereCentsIn(
  recorded: ReadonlyArray<{ amountCents: number; resolution: string | null }>
): number {
  return recorded
    .filter((row) => row.resolution === REFUNDED_ELSEWHERE)
    .reduce((sum, row) => sum + row.amountCents, 0);
}
