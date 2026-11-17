/**
 * The two kinds of payment that grant and pay nothing, and are owed back in
 * full (Codex-2hxff.14, Codex-z1t3c): a second payment for an item the buyer
 * already owned, and a blocked sale of an item no longer available. Shared
 * by the purchase service, the short-loss read (`short-loss.ts`) and
 * support's queue.
 */

import { ITEM_UNAVAILABLE_REFUND_REASON } from '@codex/constants';
import type { Purchase } from '@codex/database/schema';
import { purchases } from '@codex/database/schema';
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
