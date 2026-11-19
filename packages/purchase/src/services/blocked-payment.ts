/**
 * The two kinds of payment that grant and pay nothing, and are owed back in
 * full (Codex-2hxff.14, Codex-z1t3c): a second payment for an item the buyer
 * already owned, and a blocked sale of an item no longer available. Shared
 * by the purchase service, the short-loss read (`short-loss.ts`) and
 * support's queue.
 */

import {
  ITEM_UNAVAILABLE_REFUND_REASON,
  PURCHASE_STATUS,
} from '@codex/constants';
import type { Purchase } from '@codex/database/schema';
import { disputes, purchases } from '@codex/database/schema';
import { noOpenChargeback } from '@codex/payments';
import { type SQL, sql } from 'drizzle-orm';

/**
 * A second payment for an item the buyer already owned (Codex-2hxff.14):
 * `pending` while its refund is owed, `refunded` once Stripe has made it.
 */
export function isDuplicatePayment(
  purchase: Pick<Purchase, 'duplicateOfPurchaseId'>
): boolean {
  return purchase.duplicateOfPurchaseId != null;
}

/**
 * A payment that landed when access would refuse its buyer the content
 * (`contentRefusesBuyers`: deleted, team-only, its organisation deleted,
 * detached and more; Codex-z1t3c, owner 2026-11-15, "block and refund", and
 * D54, "match access exactly"): a blocked sale. It
 * grants and pays nothing, and is `pending` while its refund is owed and
 * `refunded` once Stripe has made it, as a duplicate is. The marker is
 * `refund_reason` (no migration): written at insert, and kept by every later
 * writer of the refund fields (`keepUnavailableMarker`), which would
 * otherwise write Stripe's reason over it.
 */
export function isUnavailableBlock(
  purchase: Pick<Purchase, 'refundReason'>
): boolean {
  return purchase.refundReason === ITEM_UNAVAILABLE_REFUND_REASON;
}

/**
 * The two kinds of payment that grant and pay nothing: a second payment for
 * an item the buyer already owns (`duplicate`; they kept the item), and a
 * blocked sale of an item no longer available (`unavailable`; they have
 * nothing).
 */
export type BlockedPaymentKind = 'duplicate' | 'unavailable';

/**
 * What kind of payment that grants and pays nothing this is, if it is one: a
 * blocked sale of an unavailable item, a duplicate, or null for a sale. A
 * row is one or the other: an unavailable item is blocked whoever owns it.
 * Support's queue reads it too (owner D55, D57).
 */
export function blockedKind(
  purchase: Pick<Purchase, 'duplicateOfPurchaseId' | 'refundReason'>
): BlockedPaymentKind | null {
  if (isUnavailableBlock(purchase)) return 'unavailable';
  return isDuplicatePayment(purchase) ? 'duplicate' : null;
}

/**
 * A blocked payment (`blockedKind`), for the outer query's `purchases` row.
 * One fragment, so no part can be dropped (`and()` and `or()` drop an
 * undefined argument).
 */
export function blockedPayment(): SQL {
  return sql`(${purchases.duplicateOfPurchaseId} IS NOT NULL OR ${purchases.refundReason} = ${ITEM_UNAVAILABLE_REFUND_REASON})`;
}

/**
 * A blocked payment still owed its refund: `pending` until Stripe has
 * refunded it.
 */
export function owedBlockedRefund(): SQL {
  return sql`(${blockedPayment()} AND ${purchases.status} = ${PURCHASE_STATUS.PENDING})`;
}

/**
 * One the owed-refund sweep may ask Stripe to refund: no chargeback on it is
 * open (owner D56, widened to duplicates by D57; `noOpenChargeback`, read
 * from the disputes table). Stripe refuses a refund of a disputed charge, so
 * asking would only raise "refund them by hand" every hour for weeks, and the
 * dispute decides it: a loss records it refunded (`processLostDispute`).
 * Any other end (a win, `prevented`, a close never recorded) leaves it owed,
 * and once the chargeback is no longer open the next sweep refunds it. Never
 * `disputed_at`: only a win clears that, so another end held the row forever.
 * Support's queue reads it too: a failed refund of such a payment waits for
 * the payment's own refund, which includes it (review r8).
 *
 * Nor one whose chargeback was lost (`noLostChargeback`, review r9): the
 * loss owns it. Until the loss is applied the row is still `pending`, and
 * the bank's return pays most or all of it, so a refund of what the one
 * count leaves would mark it refunded first and the loss would never write
 * what the buyer has back. Once applied it is `refunded`, and a short one is
 * the short stage's.
 */
export function owedBlockedPayment(): SQL {
  return sql`(${owedBlockedRefund()} AND ${noOpenChargeback('purchase', purchases.id)} AND ${noLostChargeback()})`;
}

/** No chargeback of the outer query's purchase stands lost. */
function noLostChargeback(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.purchaseId} = ${purchases.id} AND ${disputes.status} = ${'lost'})`;
}
