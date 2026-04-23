/**
 * Purchase Test Helpers
 *
 * Seeders that mirror the side-effects of `PurchaseService.completePurchase()`
 * so integration tests can bypass the real service while still satisfying
 * access-layer checks that read from `contentAccess`.
 *
 * Key difference vs. a raw `db.insert(purchases)`:
 * - Also inserts a paired `contentAccess` row in the same transaction.
 * - Computes the Phase 1 revenue split (10% / 0% / 90%) from `FEES`.
 *
 * Without the paired `contentAccess` row, `ContentAccessService.savePlaybackProgress`
 * throws `ForbiddenError: No active access for this content` even though a
 * purchases row exists (see Codex-dewjd).
 */

import { randomUUID } from 'node:crypto';
import { ACCESS_TYPES, FEES, PURCHASE_STATUS } from '@codex/constants';
import type { Purchase } from '@codex/database/schema';
import { contentAccess, purchases } from '@codex/database/schema';
import type { Database } from './database';

export interface SeedPurchaseWithAccessInput {
  customerId: string;
  contentId: string;
  organizationId: string;
  amountPaidCents: number;
  /** Platform fee in basis points. Default: `FEES.PLATFORM_PERCENT` (10%). */
  platformFeePercentage?: number;
  /** Org fee in basis points. Default: `FEES.ORG_PERCENT` (0%). */
  organizationFeePercentage?: number;
  /** Stripe intent ID. Auto-generated unique value if omitted. */
  stripePaymentIntentId?: string;
  /** Access type granted. Default: `'purchased'`. */
  accessType?: string;
}

/**
 * Seed a completed purchase + matching contentAccess row atomically.
 *
 * Mirrors `PurchaseService.completePurchase()` for integration tests that
 * need an access grant without going through Stripe.
 *
 * @example
 * const purchase = await seedPurchaseWithAccess(db, {
 *   customerId: userId,
 *   contentId: content.id,
 *   organizationId: org.id,
 *   amountPaidCents: 999,
 * });
 */
export async function seedPurchaseWithAccess(
  db: Database,
  input: SeedPurchaseWithAccessInput
): Promise<Purchase> {
  const {
    customerId,
    contentId,
    organizationId,
    amountPaidCents,
    platformFeePercentage = FEES.PLATFORM_PERCENT,
    organizationFeePercentage = FEES.ORG_PERCENT,
    stripePaymentIntentId = `pi_test_${Date.now()}_${randomUUID().slice(0, 8)}`,
    accessType = ACCESS_TYPES.PURCHASED,
  } = input;

  const platformFeeCents = Math.ceil(
    (amountPaidCents * platformFeePercentage) / 10000
  );
  const remainingAfterPlatform = amountPaidCents - platformFeeCents;
  const organizationFeeCents = Math.ceil(
    (remainingAfterPlatform * organizationFeePercentage) / 10000
  );
  const creatorPayoutCents =
    amountPaidCents - platformFeeCents - organizationFeeCents;

  return await db.transaction(async (tx) => {
    const [purchase] = await tx
      .insert(purchases)
      .values({
        customerId,
        contentId,
        organizationId,
        status: PURCHASE_STATUS.COMPLETED,
        amountPaidCents,
        platformFeeCents,
        organizationFeeCents,
        creatorPayoutCents,
        stripePaymentIntentId,
        purchasedAt: new Date(),
      })
      .returning();

    if (!purchase) {
      throw new Error('seedPurchaseWithAccess: failed to insert purchase row');
    }

    await tx
      .insert(contentAccess)
      .values({
        userId: customerId,
        contentId,
        organizationId,
        accessType,
        expiresAt: null,
      })
      .onConflictDoUpdate({
        target: [contentAccess.userId, contentAccess.contentId],
        set: {
          deletedAt: null,
          accessType,
          updatedAt: new Date(),
        },
      });

    return purchase;
  });
}
