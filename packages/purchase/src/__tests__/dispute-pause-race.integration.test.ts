/**
 * A win racing a re-run of a chargeback's opening (Codex-2hxff.58, review
 * round 2). The hourly reconcile re-runs an open chargeback. If the dispute is
 * won between the reconcile's record of it and its pause, the pause must not
 * undo the win: the buyer of a won sale would otherwise be locked out for good,
 * with nothing left to restore them.
 *
 * Real DB. Every row hangs off this file's own organisation and users, and is
 * deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  contentAccess,
  disputes,
  entitlements,
  organizations,
  purchases,
  users,
} from '@codex/database/schema';
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
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

const uid = () => randomUUID().slice(0, 8);

describe('a dispute pause racing a win', () => {
  let db: Database;
  let service: PurchaseService;
  let buyerId: string;
  let creatorId: string;
  let orgId: string;
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new PurchaseService(
      { db, environment: 'test' },
      createMockStripe()
    );
    [buyerId, creatorId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Pause Race Org',
          slug: createUniqueSlug('pause-race'),
        })
        .returning()
    ).id;
  });

  afterAll(async () => {
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    await db.delete(entitlements).where(eq(entitlements.userId, buyerId));
    await db.delete(contentAccess).where(eq(contentAccess.userId, buyerId));
    await db.delete(purchases).where(eq(purchases.customerId, buyerId));
    await db.delete(content).where(eq(content.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(inArray(users.id, [buyerId, creatorId]));
    await teardownTestDatabase();
  });

  /** A completed purchase (no charge id, so no payout slices) and its dispute. */
  async function disputedSale() {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('pause-race'),
          })
        )
        .returning()
    );
    const tag = uid();
    const paymentIntentId = `pi_race_${tag}`;
    const stripeDisputeId = `dp_race_${tag}`;
    disputeIds.push(stripeDisputeId);
    await service.completePurchase(paymentIntentId, {
      contentId: item.id,
      customerId: buyerId,
      organizationId: orgId,
      amountPaidCents: 1000,
      currency: 'gbp',
    });
    const record = (status: string) =>
      service.recordDispute({
        stripeDisputeId,
        stripeChargeId: `ch_race_${tag}`,
        paymentIntentId,
        amountCents: 1000,
        currency: 'gbp',
        status,
        reason: 'fraudulent',
        stripeCreatedAt: new Date(),
      });
    return { contentId: item.id, paymentIntentId, stripeDisputeId, record };
  }

  async function purchaseOf(paymentIntentId: string) {
    return takeFirst(
      await db
        .select()
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
    );
  }

  async function hasAccess(sale: {
    contentId: string;
    paymentIntentId: string;
  }) {
    const purchase = await purchaseOf(sale.paymentIntentId);
    const [grant] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.sourceRef, purchase.id));
    const [row] = await db
      .select()
      .from(contentAccess)
      .where(
        and(
          eq(contentAccess.userId, buyerId),
          eq(contentAccess.contentId, sale.contentId)
        )
      );
    return (
      grant?.revokedAt === null &&
      row?.deletedAt === null &&
      (await service.verifyPurchase(sale.contentId, buyerId))
    );
  }

  it("a win recorded between the reconcile's record and its pause: the buyer is not paused, and the caller is told not to block", async () => {
    const sale = await disputedSale();
    // The reconcile records the chargeback, still open…
    await sale.record('needs_response');
    // …and the webhook's win lands before the reconcile's pause.
    await sale.record('won');
    await service.restoreDisputedPurchase(sale.paymentIntentId);

    const paused = await service.processDispute(sale.paymentIntentId, {
      stripeDisputeId: sale.stripeDisputeId,
      disputeReason: 'fraudulent',
    });

    expect(paused).toMatchObject({ accessEnded: false });
    expect((await purchaseOf(sale.paymentIntentId)).disputedAt).toBeNull();
    expect(await hasAccess(sale)).toBe(true);
  });

  it('an open chargeback still pauses the sale, and so does a lost one', async () => {
    for (const status of ['needs_response', 'lost']) {
      const sale = await disputedSale();
      await sale.record(status);

      const paused = await service.processDispute(sale.paymentIntentId, {
        stripeDisputeId: sale.stripeDisputeId,
      });

      expect(paused).toMatchObject({ accessEnded: true });
      expect(
        (await purchaseOf(sale.paymentIntentId)).disputedAt
      ).not.toBeNull();
      expect(await hasAccess(sale)).toBe(false);
    }
  });
});
