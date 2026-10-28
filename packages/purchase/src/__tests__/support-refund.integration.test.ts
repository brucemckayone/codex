/**
 * Support refunds, the purchase side (Codex-2hxff.28):
 *
 * - `recordRefund` copies who in support issued a refund (its
 *   `metadata.codex_requested_by`) onto `refunds.requested_by_user_id`, once,
 *   whichever event records the refund first, and never fails the webhook on
 *   an id no user has (Q3);
 * - `restoreAfterFailedRefund` gives a failed FULL refund's access back when
 *   support re-pays the payees (Q5d), undoing exactly what `processRefund`
 *   did, and touches nothing when another refund, a dispute or a newer
 *   purchase decides the access;
 * - `restateStandingRefunds`: a failed part refund stops counting as refunded,
 *   with the same restatement (owner decision 2026-10-24).
 *
 * Every row is created here and deleted in afterAll; nothing cleans a table.
 */

import { PURCHASE_STATUS } from '@codex/constants';
import {
  content,
  contentAccess,
  disputes,
  entitlements,
  organizations,
  type Purchase,
  purchases,
  refunds,
} from '@codex/database/schema';
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
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PurchaseService,
  supportRequesterOf,
} from '../services/purchase-service';

const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 10);

describe('support refunds: the purchase side', () => {
  let db: Database;
  let service: PurchaseService;
  let creatorId: string;
  let supportId: string;
  let orgId: string;
  const created = {
    purchaseIds: [] as string[],
    contentIds: [] as string[],
    stripeRefundIds: [] as string[],
    stripeDisputeIds: [] as string[],
  };

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, supportId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Support Purchase Org', slug: createUniqueSlug('sp') })
        .returning()
    ).id;
    service = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
  });

  afterAll(async () => {
    if (created.stripeRefundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, created.stripeRefundIds));
    }
    if (created.stripeDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, created.stripeDisputeIds));
    }
    if (created.purchaseIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.sourceRef, created.purchaseIds));
      await db
        .delete(purchases)
        .where(inArray(purchases.id, created.purchaseIds));
    }
    if (created.contentIds.length > 0) {
      await db
        .delete(contentAccess)
        .where(inArray(contentAccess.contentId, created.contentIds));
      await db.delete(content).where(inArray(content.id, created.contentIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  async function item() {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('support-refund'),
          })
        )
        .returning()
    );
    created.contentIds.push(row.id);
    return row;
  }

  /** A purchase with its entitlement and access row, as completion writes them. */
  async function purchase(
    buyerId: string,
    contentId: string,
    status: string = PURCHASE_STATUS.COMPLETED
  ): Promise<Purchase> {
    const row = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          contentId,
          organizationId: orgId,
          status,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 135,
          creatorPayoutCents: 765,
          stripePaymentIntentId: `pi_spr${uid()}`,
          purchasedAt: new Date(),
        })
        .returning()
    );
    created.purchaseIds.push(row.id);
    await db.insert(entitlements).values({
      userId: buyerId,
      organizationId: orgId,
      contentId,
      source: 'content_purchase',
      sourceRef: row.id,
      ...(status === PURCHASE_STATUS.COMPLETED
        ? {}
        : { revokedAt: new Date() }),
    });
    await db
      .insert(contentAccess)
      .values({
        userId: buyerId,
        contentId,
        organizationId: orgId,
        accessType: 'purchased',
      })
      .onConflictDoNothing();
    return row;
  }

  /** What `processRefund` did to a purchase refunded in full. */
  async function refundedInFull(row: Purchase, stripeRefundId: string) {
    const at = new Date();
    await db
      .update(purchases)
      .set({
        status: PURCHASE_STATUS.REFUNDED,
        refundedAt: at,
        refundAmountCents: 1000,
        stripeRefundId,
        refundReason: 'requested_by_customer',
      })
      .where(eq(purchases.id, row.id));
    await db
      .update(entitlements)
      .set({ revokedAt: at })
      .where(eq(entitlements.sourceRef, row.id));
    await db
      .update(contentAccess)
      .set({ deletedAt: at })
      .where(eq(contentAccess.contentId, row.contentId ?? ''));
  }

  async function refundRow(
    row: Purchase,
    amountCents: number,
    status: string,
    createdAt = new Date()
  ) {
    const id = `re_spr${uid()}`;
    created.stripeRefundIds.push(id);
    await db.insert(refunds).values({
      stripeRefundId: id,
      stripeChargeId: chargeOf(row),
      purchaseId: row.id,
      amountCents,
      currency: 'gbp',
      status,
      reason: 'requested_by_customer',
      stripeCreatedAt: createdAt,
    });
    return id;
  }

  /** The purchase's charge: every refund of it is on this charge. */
  const chargeOf = (row: Purchase) =>
    `ch_spr${row.id.replaceAll('-', '').slice(0, 16)}`;

  const restore = (row: Purchase) =>
    db.transaction((tx) =>
      service.restoreAfterFailedRefund(tx, row.id, chargeOf(row))
    );

  async function readState(row: Purchase) {
    const [now] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, row.id));
    const [entitlement] = await db
      .select({ revokedAt: entitlements.revokedAt })
      .from(entitlements)
      .where(eq(entitlements.sourceRef, row.id));
    const [access] = await db
      .select({ deletedAt: contentAccess.deletedAt })
      .from(contentAccess)
      .where(eq(contentAccess.contentId, row.contentId ?? ''));
    return {
      purchase: now,
      entitlementRevoked: entitlement?.revokedAt != null,
      accessDeleted: access?.deletedAt != null,
    };
  }

  // ── who asked (Q3) ────────────────────────────────────────────────────

  describe('recordRefund: who in support issued it', () => {
    const recordInput = (stripeRefundId: string) => ({
      stripeRefundId,
      stripeChargeId: `ch_spr${uid()}`,
      paymentIntentId: null,
      amountCents: 300,
      currency: 'gbp',
      status: 'succeeded',
      reason: 'requested_by_customer',
      failureReason: null,
      stripeCreatedAt: new Date(),
    });

    async function requesterOf(stripeRefundId: string) {
      const [row] = await db
        .select({ requestedByUserId: refunds.requestedByUserId })
        .from(refunds)
        .where(eq(refunds.stripeRefundId, stripeRefundId));
      return row?.requestedByUserId;
    }

    it('writes the requester the metadata names', async () => {
      const id = `re_spr${uid()}`;
      created.stripeRefundIds.push(id);
      await service.recordRefund({
        ...recordInput(id),
        requestedByUserId: supportId,
      });
      expect(await requesterOf(id)).toBe(supportId);
    });

    it('fills it in when an event that names no requester recorded the refund first', async () => {
      const id = `re_spr${uid()}`;
      created.stripeRefundIds.push(id);
      const input = recordInput(id);
      // refund.updated: no requester.
      await service.recordRefund(input);
      // charge.refunded, same status: the forward-only guard skips the row.
      await service.recordRefund({ ...input, requestedByUserId: supportId });
      expect(await requesterOf(id)).toBe(supportId);
    });

    it('an id no user has is dropped, never a failed webhook', async () => {
      const id = `re_spr${uid()}`;
      created.stripeRefundIds.push(id);
      await expect(
        service.recordRefund({
          ...recordInput(id),
          requestedByUserId: 'nobodyWithThisId',
        })
      ).resolves.toBe(true);
      expect(await requesterOf(id)).toBeNull();
    });

    it('reads the requester from the refund metadata, refusing what no id could be', () => {
      const of = (value: string | undefined) =>
        supportRequesterOf({
          metadata: value === undefined ? {} : { codex_requested_by: value },
        } as Pick<Stripe.Refund, 'metadata'>);
      expect(of('user123')).toBe('user123');
      expect(of(undefined)).toBeNull();
      expect(of('')).toBeNull();
      expect(of('a\0b')).toBeNull();
      expect(of('x'.repeat(256))).toBeNull();
    });
  });

  // ── access back (Q5d) ─────────────────────────────────────────────────

  describe('restoreAfterFailedRefund', () => {
    it("gives a failed full refund's access back, and names the refunds that still stand", async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const earlier = await refundRow(
        bought,
        200,
        'succeeded',
        new Date(Date.now() - 60_000)
      );
      const failed = await refundRow(bought, 800, 'failed');
      await refundedInFull(bought, failed);

      const result = await restore(bought);

      expect(result).toEqual({
        restored: true,
        reason: null,
        userId: buyer,
        organizationId: orgId,
      });
      const state = await readState(bought);
      expect(state.purchase).toMatchObject({
        status: PURCHASE_STATUS.COMPLETED,
        refundedAt: null,
        // The part refund made before still stands.
        refundAmountCents: 200,
        stripeRefundId: earlier,
      });
      expect(state.entitlementRevoked).toBe(false);
      expect(state.accessDeleted).toBe(false);
    });

    it('leaves access ended while the refunds that stand still cover the payment', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const failed = await refundRow(bought, 1000, 'failed');
      // The Dashboard refunded it in full again after the first one failed.
      const again = await refundRow(bought, 1000, 'succeeded');
      await refundedInFull(bought, failed);

      expect(await restore(bought)).toMatchObject({
        restored: false,
        reason: 'still_refunded',
      });
      const state = await readState(bought);
      // Still refunded, now naming the refund that stands, not the failed one.
      expect(state.purchase).toMatchObject({
        status: PURCHASE_STATUS.REFUNDED,
        refundAmountCents: 1000,
        stripeRefundId: again,
      });
      expect(state.entitlementRevoked).toBe(true);
    });

    it('counts a standing refund of the charge recorded before the purchase existed (no purchase_id)', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const failed = await refundRow(bought, 1000, 'failed');
      await refundedInFull(bought, failed);
      const orphan = `re_spr${uid()}`;
      created.stripeRefundIds.push(orphan);
      await db.insert(refunds).values({
        stripeRefundId: orphan,
        stripeChargeId: chargeOf(bought),
        purchaseId: null,
        amountCents: 1000,
        currency: 'gbp',
        status: 'succeeded',
        stripeCreatedAt: new Date(),
      });

      expect((await restore(bought))?.reason).toBe('still_refunded');
      expect((await readState(bought)).purchase?.status).toBe(
        PURCHASE_STATUS.REFUNDED
      );
    });

    it('leaves a disputed purchase to its dispute', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const failed = await refundRow(bought, 1000, 'failed');
      await refundedInFull(bought, failed);
      const disputeId = `du_spr${uid()}`;
      created.stripeDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeOf(bought),
        purchaseId: bought.id,
        amountCents: 1000,
        currency: 'gbp',
        status: 'lost',
        stripeCreatedAt: new Date(),
      });

      expect((await restore(bought))?.reason).toBe('dispute_holds');
      expect((await readState(bought)).purchase?.status).toBe(
        PURCHASE_STATUS.REFUNDED
      );
    });

    it('finds a holding dispute by the charge when it names no purchase', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const failed = await refundRow(bought, 1000, 'failed');
      await refundedInFull(bought, failed);
      const disputeId = `du_spr${uid()}`;
      created.stripeDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeOf(bought),
        purchaseId: null,
        amountCents: 1000,
        currency: 'gbp',
        status: 'needs_response',
        stripeCreatedAt: new Date(),
      });

      expect((await restore(bought))?.reason).toBe('dispute_holds');
      expect((await readState(bought)).accessDeleted).toBe(true);
    });

    it('leaves it alone when the buyer bought the item again since', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const thing = await item();
      const first = await purchase(buyer ?? '', thing.id);
      const failed = await refundRow(first, 1000, 'failed');
      await refundedInFull(first, failed);
      // Bought again after the refund: the one completed purchase per item.
      await purchase(buyer ?? '', thing.id);

      // Restoring would break uq_purchases_completed_customer_content and
      // roll the whole settlement back.
      expect(await restore(first)).toMatchObject({
        restored: false,
        reason: 'rebought',
      });
      // Still refunded, but the failed refund no longer counts (LOW-2).
      expect((await readState(first)).purchase).toMatchObject({
        status: PURCHASE_STATUS.REFUNDED,
        refundAmountCents: null,
        stripeRefundId: null,
      });
    });

    it('says a duplicate payment, or a purchase in another status, is left as it is', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const thing = await item();
      const owner = await purchase(buyer ?? '', thing.id);
      const duplicate = await purchase(
        buyer ?? '',
        thing.id,
        PURCHASE_STATUS.REFUNDED
      );
      await db
        .update(purchases)
        .set({ duplicateOfPurchaseId: owner.id })
        .where(eq(purchases.id, duplicate.id));
      const [other] = await seedTestUsers(db, 1);
      const pending = await purchase(
        other ?? '',
        (await item()).id,
        PURCHASE_STATUS.PENDING
      );

      expect((await restore(duplicate))?.reason).toBe('duplicate');
      expect((await restore(pending))?.reason).toBe('not_refunded');
    });

    it('does nothing to a purchase a part refund left completed', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      await refundRow(bought, 400, 'failed');

      expect((await restore(bought))?.reason).toBe('partial');
      expect((await readState(bought)).purchase?.status).toBe(
        PURCHASE_STATUS.COMPLETED
      );
    });
  });

  // ── a failed part refund (owner decision 2026-10-24) ─────────────────

  describe('restateStandingRefunds: a refund that failed or was canceled returned nothing', () => {
    /** A refund as `recordRefund` writes it from the refund's events. */
    async function recordRefund(
      row: Purchase,
      stripeRefundId: string,
      amountCents: number,
      status: string,
      reason: string,
      createdAt: Date
    ) {
      await service.recordRefund({
        stripeRefundId,
        stripeChargeId: chargeOf(row),
        paymentIntentId: row.stripePaymentIntentId,
        amountCents,
        currency: 'gbp',
        status,
        reason,
        failureReason: status === 'failed' ? 'expired_or_canceled_card' : null,
        stripeCreatedAt: createdAt,
      });
    }

    /** What `processRefund`'s part-refund path wrote: it only ever raises. */
    async function partRefunded(
      row: Purchase,
      refundAmountCents: number,
      stripeRefundId: string,
      refundReason: string
    ) {
      await db
        .update(purchases)
        .set({ refundAmountCents, stripeRefundId, refundReason })
        .where(eq(purchases.id, row.id));
    }

    const refundedInSales = async () =>
      (await service.getSalesStats(orgId, {})).refundedCents;

    it('a £3 refund of £10 that fails leaves nothing refunded, and Sales agrees', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const id = `re_spr${uid()}`;
      created.stripeRefundIds.push(id);
      await recordRefund(bought, id, 300, 'pending', 'duplicate', new Date());
      await partRefunded(bought, 300, id, 'duplicate');
      const before = await refundedInSales();

      await recordRefund(bought, id, 300, 'failed', 'duplicate', new Date());
      await service.restateStandingRefunds(
        bought.stripePaymentIntentId,
        chargeOf(bought)
      );

      expect((await readState(bought)).purchase).toMatchObject({
        status: PURCHASE_STATUS.COMPLETED,
        refundAmountCents: null,
        stripeRefundId: null,
        refundReason: null,
      });
      expect(await refundedInSales()).toBe(before - 300);
    });

    it('a £3 refund of £10 that is canceled leaves nothing refunded, as a failed one (owner decision 2026-10-25)', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const id = `re_spr${uid()}`;
      created.stripeRefundIds.push(id);
      // Waiting on the customer, then canceled: it never paid out.
      await recordRefund(
        bought,
        id,
        300,
        'requires_action',
        'requested_by_customer',
        new Date()
      );
      await partRefunded(bought, 300, id, 'requested_by_customer');
      const before = await refundedInSales();

      await recordRefund(
        bought,
        id,
        300,
        'canceled',
        'requested_by_customer',
        new Date()
      );
      await service.restateStandingRefunds(
        bought.stripePaymentIntentId,
        chargeOf(bought)
      );

      expect((await readState(bought)).purchase).toMatchObject({
        status: PURCHASE_STATUS.COMPLETED,
        refundAmountCents: null,
        stripeRefundId: null,
        refundReason: null,
      });
      expect(await refundedInSales()).toBe(before - 300);
    });

    it('a refund that still stands keeps its amount, and is named again', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const kept = `re_spr${uid()}`;
      const lost = `re_spr${uid()}`;
      created.stripeRefundIds.push(kept, lost);
      const earlier = new Date(Date.now() - 60_000);
      await recordRefund(
        bought,
        kept,
        300,
        'succeeded',
        'requested_by_customer',
        earlier
      );
      await recordRefund(bought, lost, 200, 'pending', 'duplicate', new Date());
      await partRefunded(bought, 500, lost, 'duplicate');
      const before = await refundedInSales();

      await recordRefund(bought, lost, 200, 'failed', 'duplicate', new Date());
      await service.restateStandingRefunds(
        bought.stripePaymentIntentId,
        chargeOf(bought)
      );

      expect((await readState(bought)).purchase).toMatchObject({
        status: PURCHASE_STATUS.COMPLETED,
        refundAmountCents: 300,
        stripeRefundId: kept,
        refundReason: 'requested_by_customer',
      });
      expect(await refundedInSales()).toBe(before - 200);
    });

    it('leaves a failed full refund to support', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const failed = await refundRow(bought, 1000, 'failed');
      await refundedInFull(bought, failed);

      await service.restateStandingRefunds(
        bought.stripePaymentIntentId,
        chargeOf(bought)
      );

      expect((await readState(bought)).purchase).toMatchObject({
        status: PURCHASE_STATUS.REFUNDED,
        refundAmountCents: 1000,
        stripeRefundId: failed,
      });
    });
  });

  // ── review round 1: purchase_id heals; a stale charge.refunded ────────

  describe('refunds.purchase_id heals, and a stale charge.refunded changes nothing', () => {
    async function orphanRefund(
      row: Purchase,
      amountCents: number,
      status: string
    ) {
      const id = `re_spr${uid()}`;
      created.stripeRefundIds.push(id);
      await db.insert(refunds).values({
        stripeRefundId: id,
        stripeChargeId: chargeOf(row),
        purchaseId: null,
        amountCents,
        currency: 'gbp',
        status,
        stripeCreatedAt: new Date(),
      });
      return id;
    }

    const purchaseIdOf = async (stripeRefundId: string) =>
      takeFirst(
        await db
          .select({ purchaseId: refunds.purchaseId })
          .from(refunds)
          .where(eq(refunds.stripeRefundId, stripeRefundId))
      ).purchaseId;

    it('recordRefund fills a missing purchase_id, even when the status is unchanged', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const id = await orphanRefund(bought, 300, 'succeeded');

      await service.recordRefund({
        stripeRefundId: id,
        stripeChargeId: chargeOf(bought),
        paymentIntentId: bought.stripePaymentIntentId,
        amountCents: 300,
        currency: 'gbp',
        status: 'succeeded',
        reason: null,
        failureReason: null,
        stripeCreatedAt: new Date(),
      });

      expect(await purchaseIdOf(id)).toBe(bought.id);
    });

    it("processRefund links the charge's refunds recorded before the purchase existed", async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const id = await orphanRefund(bought, 300, 'succeeded');

      await service.processRefund(bought.stripePaymentIntentId, {
        charge: { id: chargeOf(bought), amountCents: 1000 },
        stripeRefundId: id,
        refundAmountCents: 300,
      });

      expect(await purchaseIdOf(id)).toBe(bought.id);
    });

    it('a restated part refund stays restated when a stale charge.refunded finds nothing standing (MED-2)', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      // £3 failed and was restated: nothing refunded.
      await refundRow(bought, 300, 'failed');

      // The webhook passes what stands now (nothing), not the event's 300.
      await service.processRefund(bought.stripePaymentIntentId, {
        charge: { id: chargeOf(bought), amountCents: 1000 },
        refundAmountCents: 0,
      });

      expect((await readState(bought)).purchase).toMatchObject({
        status: PURCHASE_STATUS.COMPLETED,
        refundAmountCents: null,
        stripeRefundId: null,
      });
    });

    it('a restored purchase stays restored when a stale full-refund event finds nothing standing (MED-2)', async () => {
      const [buyer] = await seedTestUsers(db, 1);
      const bought = await purchase(buyer ?? '', (await item()).id);
      const failed = await refundRow(bought, 1000, 'failed');
      await refundedInFull(bought, failed);
      expect((await restore(bought))?.restored).toBe(true);

      await service.processRefund(bought.stripePaymentIntentId, {
        charge: { id: chargeOf(bought), amountCents: 1000 },
        refundAmountCents: 0,
      });

      const state = await readState(bought);
      expect(state.purchase?.status).toBe(PURCHASE_STATUS.COMPLETED);
      expect(state.entitlementRevoked).toBe(false);
      expect(state.accessDeleted).toBe(false);
    });
  });
});
