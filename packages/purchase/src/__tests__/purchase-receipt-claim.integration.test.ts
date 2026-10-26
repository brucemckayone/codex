/**
 * One receipt per purchase (Codex-mat01; owner decision 2026-10-25).
 *
 * `claimReceipt` is the gate the checkout webhook sends the receipt behind:
 * true for exactly one caller, the first to find the purchase live
 * (`completed`) with `receipt_sent_at` unset. Real Postgres, because the
 * once-only promise is the conditional UPDATE, and two deliveries racing is
 * what it has to survive.
 */

import { randomUUID } from 'node:crypto';
import { content, organizations, purchases } from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

describe('PurchaseService.claimReceipt (Codex-mat01)', () => {
  const token = randomUUID().slice(0, 8);
  let db: Database;
  let service: PurchaseService;
  let buyerId: string;
  let creatorId: string;
  let orgId: string;
  const contentIds: string[] = [];
  const purchaseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: `Receipt Claim Org ${token}`,
          slug: createUniqueSlug(`receipt-claim-${token}`),
        })
        .returning()
    ).id;
    service = new PurchaseService(
      { db, environment: 'test' },
      createMockStripe()
    );
  });

  afterAll(async () => {
    if (purchaseIds.length > 0) {
      // duplicate_of_purchase_id is ON DELETE RESTRICT: duplicates go first.
      await db
        .delete(purchases)
        .where(
          and(
            inArray(purchases.id, purchaseIds),
            isNotNull(purchases.duplicateOfPurchaseId)
          )
        );
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await teardownTestDatabase();
  });

  /** A purchase of its own content item, so no unique index ties two together. */
  async function seedPurchase(
    fields: Partial<typeof purchases.$inferInsert> = {}
  ) {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug(`receipt-claim-${token}`),
          })
        )
        .returning()
    );
    contentIds.push(item.id);
    const purchase = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          contentId: item.id,
          organizationId: orgId,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 135,
          creatorPayoutCents: 765,
          stripePaymentIntentId: `pi_receipt_${token}_${randomUUID().slice(0, 8)}`,
          status: 'completed',
          purchasedAt: new Date(),
          ...fields,
        })
        .returning()
    );
    purchaseIds.push(purchase.id);
    return purchase;
  }

  async function receiptSentAt(purchaseId: string) {
    const row = takeFirst(
      await db
        .select({ receiptSentAt: purchases.receiptSentAt })
        .from(purchases)
        .where(eq(purchases.id, purchaseId))
    );
    return row.receiptSentAt;
  }

  it('a live purchase is claimed once: the first caller gets true, every later one false', async () => {
    const purchase = await seedPurchase();

    expect(await service.claimReceipt(purchase.id)).toBe(true);
    expect(await receiptSentAt(purchase.id)).toBeInstanceOf(Date);
    expect(await service.claimReceipt(purchase.id)).toBe(false);
    expect(await service.claimReceipt(purchase.id)).toBe(false);
  });

  it('two deliveries claiming at once: exactly one wins', async () => {
    const purchase = await seedPurchase();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.claimReceipt(purchase.id))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('a purchase refunded in full before its checkout landed is never claimed', async () => {
    const purchase = await seedPurchase({
      status: 'refunded',
      refundedAt: new Date(),
      refundAmountCents: 1000,
    });

    expect(await service.claimReceipt(purchase.id)).toBe(false);
    expect(await receiptSentAt(purchase.id)).toBeNull();
  });

  it('a purchase partly refunded first is still completed, and gets its one receipt', async () => {
    const purchase = await seedPurchase({
      refundedAt: new Date(),
      refundAmountCents: 400,
    });

    expect(await service.claimReceipt(purchase.id)).toBe(true);
    expect(await service.claimReceipt(purchase.id)).toBe(false);
  });

  it('a held duplicate payment (pending) is never claimed', async () => {
    const original = await seedPurchase();
    const duplicate = await seedPurchase({
      status: 'pending',
      duplicateOfPurchaseId: original.id,
    });

    expect(await service.claimReceipt(duplicate.id)).toBe(false);
  });

  it('an unknown purchase claims nothing', async () => {
    expect(await service.claimReceipt(randomUUID())).toBe(false);
  });
});
