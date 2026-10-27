/**
 * Failed refunds whose re-pay the server refused for good, for the rest of the
 * session (Codex-2hxff.28 review):
 *
 * - a later cause (`REPAY_BLOCKED_BY_LATER_CAUSE`): a later chargeback or
 *   refund took the payees' shares too, so re-paying would pay them twice;
 * - a step only a person can read (`REFUND_CLAWBACK_NEEDS_PERSON`): retrying
 *   never helps.
 *
 * The server refuses either every time. Once it has said so for a row, the
 * queue disables that row's Re-pay and says why, and support settles it as
 * "refunded another way" or by hand instead of retrying. Module state, so
 * it outlives switching tabs or opening a charge and coming back; a reload
 * forgets it, and the server simply refuses again.
 */

import { SvelteMap } from 'svelte/reactivity';

export type RepayBlockReason = 'chargeback' | 'later_refunds' | 'needs_person';

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
