/**
 * Failed refunds whose re-pay the server refused for good, for the rest of the
 * session (Codex-2hxff.28 review):
 *
 * - a later cause (`REPAY_BLOCKED_BY_LATER_CAUSE`): a later chargeback or
 *   refund took the payees' shares too, so re-paying would pay them twice;
 * - a step only a person can read (`REFUND_CLAWBACK_NEEDS_PERSON`): retrying
 *   never helps;
 * - a late win's own refund of the payment (`LATE_WIN_REFUND_NOT_REPAYABLE`,
 *   owner decision 6, 2026-11-08): it pays back a buyer who paid twice, so
 *   it is only ever settled as refunded another way;
 * - a blocked payment's refund (`BLOCKED_PAYMENT_REFUND_NOT_REPAYABLE`, owner
 *   D55, widened to duplicates by D57): a duplicate (`duplicate_payment`, the
 *   buyer kept the item) or a blocked sale of an item no longer available
 *   (`unavailable_sale`, Codex-z1t3c) paid no one and granted nothing, so the
 *   buyer is still owed it. The queue already knows one (`blockedPayment`);
 *   this covers a page older than that. A refusal naming neither kind reads
 *   `blocked_payment`, whose words fit both.
 *
 * The server refuses either every time. Once it has said so for a row, the
 * queue disables that row's Re-pay and says why, and support settles it as
 * "refunded another way" or by hand instead of retrying. Module state, so
 * it outlives switching tabs or opening a charge and coming back; a reload
 * forgets it, and the server simply refuses again.
 */

import type { FailedRefundItem } from '@codex/admin';
import { SvelteMap } from 'svelte/reactivity';

export type RepayBlockReason =
  | 'chargeback'
  | 'later_refunds'
  | 'needs_person'
  | 'late_win_refund'
  | 'duplicate_payment'
  | 'unavailable_sale'
  | 'blocked_payment';

/** The block a blocked payment's refund always has, by its kind. */
export const REPAY_BLOCK_OF_PAYMENT = {
  duplicate: 'duplicate_payment',
  unavailable: 'unavailable_sale',
} as const satisfies Record<
  NonNullable<FailedRefundItem['blockedPayment']>,
  RepayBlockReason
>;

/**
 * The block a server refusal names (`BLOCKED_PAYMENT_REFUND_NOT_REPAYABLE`'s
 * `reason`): its kind's, and for any other value, or none, words that fit
 * both kinds (`blocked_payment`), never one kind's by default.
 */
export function repayBlockOfRefusal(
  reason: string | null
):
  | (typeof REPAY_BLOCK_OF_PAYMENT)[keyof typeof REPAY_BLOCK_OF_PAYMENT]
  | 'blocked_payment' {
  switch (reason) {
    case 'duplicate':
      return REPAY_BLOCK_OF_PAYMENT.duplicate;
    case 'unavailable':
      return REPAY_BLOCK_OF_PAYMENT.unavailable;
    default:
      return 'blocked_payment';
  }
}

const blocks = new SvelteMap<string, RepayBlockReason>();

/** What blocked this failed refund's re-pay, or null while nothing has. */
export function repayBlockReason(refundId: string): RepayBlockReason | null {
  return blocks.get(refundId) ?? null;
}

export function markRepayBlocked(
  refundId: string,
  reason: RepayBlockReason
): void {
  blocks.set(refundId, reason);
}

/** For tests: a fresh session. */
export function clearRepayBlocks(): void {
  blocks.clear();
}
