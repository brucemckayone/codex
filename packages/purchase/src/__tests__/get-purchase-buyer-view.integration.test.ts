/**
 * A buyer reading their own purchase by id (`GET /purchases/:id`) never gets
 * the org's fee split (Codex-kn94e; owner decision 2026-10-27, "Hide it, same
 * as subs"). `getPurchase` leaves out the three fee columns, both agreement
 * ids, `duplicateOfPurchaseId` and the dispute's Stripe id and reason, as
 * subscriptions do (`SUBSCRIBER_HIDDEN_COLUMNS`, Codex-mbs2l). Real Postgres,
 * because the exclusion is drizzle's `columns`: what leaves the database is
 * what the route answers.
 */

import { randomUUID } from 'node:crypto';
import { content, organizations, purchases } from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurchaseNotFoundError } from '../errors';
import { PurchaseService } from '../services/purchase-service';

/** What the buyer must never receive. */
const HIDDEN = [
  'platformFeeCents',
  'organizationFeeCents',
  'creatorPayoutCents',
  'platformAgreementId',
  'creatorOrgAgreementId',
  'duplicateOfPurchaseId',
  'disputeReason',
  'stripeDisputeId',
] as const;

describe('PurchaseService.getPurchase: the buyer view (Codex-kn94e)', () => {
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
          name: `Buyer View Org ${token}`,
          slug: createUniqueSlug(`buyer-view-${token}`),
        })
        .returning()
    ).id;
    service = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
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
            slug: createUniqueSlug(`buyer-view-${token}`),
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
          stripePaymentIntentId: `pi_buyer_view_${token}_${randomUUID().slice(0, 8)}`,
          status: 'completed',
          purchasedAt: new Date(),
          ...fields,
        })
        .returning()
    );
    purchaseIds.push(purchase.id);
    return purchase;
  }

  it('a disputed purchase: the split, the dispute id and reason stay home; what the buyer paid comes back', async () => {
    const disputedAt = new Date();
    const stored = await seedPurchase({
      disputedAt,
      disputeReason: 'fraudulent',
      stripeDisputeId: `dp_buyer_view_${token}`,
    });
    // The row holds every hidden value, so their absence below is the
    // exclusion, not an empty column.
    expect(stored).toMatchObject({
      platformFeeCents: 100,
      organizationFeeCents: 135,
      creatorPayoutCents: 765,
      disputeReason: 'fraudulent',
      stripeDisputeId: `dp_buyer_view_${token}`,
    });

    const read = await service.getPurchase(stored.id, buyerId);

    for (const key of HIDDEN) expect(read).not.toHaveProperty(key);
    expect(read).toMatchObject({
      id: stored.id,
      customerId: buyerId,
      contentId: stored.contentId,
      amountPaidCents: 1000,
      currency: 'gbp',
      status: 'completed',
      stripePaymentIntentId: stored.stripePaymentIntentId,
      disputedAt,
    });
  });

  it('a duplicate payment: the purchase it repeats stays home', async () => {
    const original = await seedPurchase();
    const duplicate = await seedPurchase({
      status: 'pending',
      duplicateOfPurchaseId: original.id,
    });

    const read = await service.getPurchase(duplicate.id, buyerId);

    for (const key of HIDDEN) expect(read).not.toHaveProperty(key);
    expect(read.status).toBe('pending');
  });

  it("another buyer's purchase is not found", async () => {
    const stored = await seedPurchase();

    await expect(service.getPurchase(stored.id, creatorId)).rejects.toThrow(
      PurchaseNotFoundError
    );
  });
});
