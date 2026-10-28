/**
 * The content-purchase read other domains go through (docs/payments/
 * architecture.md rule A8, Codex-2hxff.55): `@codex/access` asks "has this
 * customer bought this content?" here, instead of building a whole
 * PurchaseService with its fee configuration and mailers to read one row.
 * `PurchaseService.verifyPurchase` delegates to it.
 */

import { PURCHASE_STATUS } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { purchases } from '@codex/database/schema';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * True when `customerId` has a completed, undisputed purchase of
 * `contentId`.
 *
 * A disputed purchase keeps `status='completed'` by design (Stripe's
 * semantics — a chargeback doesn't refund until the dispute resolves) so a
 * status-only filter would still grant access during the dispute window.
 * processDispute soft-deletes the contentAccess row but a caller using
 * verifyPurchase directly would miss that. Filter `disputedAt IS NULL` here to
 * keep verifyPurchase aligned with the access-revocation invariant.
 */
export async function verifyPurchase(
  db: DatabaseClient,
  contentId: string,
  customerId: string
): Promise<boolean> {
  const purchase = await db.query.purchases.findFirst({
    where: and(
      eq(purchases.contentId, contentId),
      eq(purchases.customerId, customerId),
      eq(purchases.status, PURCHASE_STATUS.COMPLETED),
      isNull(purchases.disputedAt)
    ),
  });
  return !!purchase;
}
