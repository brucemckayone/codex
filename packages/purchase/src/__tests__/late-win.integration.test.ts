/**
 * The late-win undo in @codex/purchase (Codex-2hxff.70; late-win data design
 * §3.3, §4.2, §4.5, §4.8, §7): a lost dispute that Stripe later turns to won.
 * The buyer's restore by outcome, a row settled by hand under release step
 * R18 left alone, the loss that must not run after the win, the first
 * payment's refund for a buyer who bought again, the email claim and the
 * hourly re-check's read. The record's transition is in
 * refund-clawback.integration.test.ts; the order the webhook runs these steps
 * in is ecom-api's (payment-webhook-dispute.test.ts); the engine's money is
 * packages/payments/src/__tests__/late-win.integration.test.ts.
 *
 * Real DB; Stripe is faked at the client. Every row hangs off this file's own
 * organisation and users, and is deleted in afterAll: payouts and disputes
 * feed global sweeps, and so does a pending duplicate.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  contentAccess,
  courseEnrollments,
  courses,
  disputes,
  entitlements,
  organizations,
  payoutReversals,
  payouts,
  purchases,
  refundReviews,
  refunds,
  users,
} from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
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
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LateWinRefundRefusedError } from '../errors';
import { writeCoursePurchaseEntitlement } from '../services/entitlement-writer';
import { PurchaseService } from '../services/purchase-service';

const uid = () => randomUUID().slice(0, 8);
const DAY_MS = 24 * 3600_000;
/**
 * The duplicate sweep is global. A row this file creates in 2001 is the only
 * one the sweep reaches when it is told to take rows older than `before`.
 */
const SWEEP_ONLY_THIS_FILE = {
  created: new Date('2001-01-01T00:00:00Z'),
  before: new Date('2001-01-02T00:00:00Z'),
};

interface Sale {
  buyerId: string;
  purchaseId: string;
  paymentIntentId: string;
  charge: { id: string; amountCents: number };
  contentId: string | null;
  courseId: string | null;
}

describe('the late-win undo in @codex/purchase (Codex-2hxff.70)', () => {
  let db: Database;
  let stripe: Stripe;
  let creatorId: string;
  let orgId: string;
  const buyerIds: string[] = [];
  const disputeIds: string[] = [];
  const chargeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Late Win Org', slug: createUniqueSlug('late-win') })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  afterAll(async () => {
    // A re-pay row carries its slice's organisation, so every payout row of
    // this file is the organisation's. Reversals reference a row twice.
    const rows = (
      await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(eq(payouts.organizationId, orgId))
    ).map((row) => row.id);
    if (rows.length > 0) {
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, rows));
      await db
        .delete(payoutReversals)
        .where(
          or(
            inArray(payoutReversals.payoutId, rows),
            inArray(payoutReversals.repaidByPayoutId, rows)
          )
        );
      await db.delete(payouts).where(inArray(payouts.id, rows));
    }
    if (chargeIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeChargeId, chargeIds));
    }
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    if (buyerIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.userId, buyerIds));
      await db
        .delete(courseEnrollments)
        .where(inArray(courseEnrollments.userId, buyerIds));
      await db
        .delete(contentAccess)
        .where(inArray(contentAccess.userId, buyerIds));
      await db.delete(purchases).where(inArray(purchases.customerId, buyerIds));
    }
    await db.delete(content).where(eq(content.organizationId, orgId));
    await db.delete(courses).where(eq(courses.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(inArray(users.id, [creatorId, ...buyerIds]));
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function makeService(): PurchaseService {
    return new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
  }

  async function newBuyer(): Promise<string> {
    const [buyerId] = await seedTestUsers(db, 1);
    if (!buyerId) throw new Error('no buyer seeded');
    buyerIds.push(buyerId);
    return buyerId;
  }

  function newPayment() {
    const tag = uid();
    const chargeId = `ch_lw_${tag}`;
    chargeIds.push(chargeId);
    return {
      paymentIntentId: `pi_lw_${tag}`,
      charge: { id: chargeId, amountCents: 1000 },
    };
  }

  async function newContent(): Promise<string> {
    return takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('late-win'),
          })
        )
        .returning()
    ).id;
  }

  /** A completed content purchase: its access row and entitlement granted. */
  async function contentSale(
    existing?: Pick<Sale, 'buyerId' | 'contentId'>
  ): Promise<Sale> {
    const buyerId = existing?.buyerId ?? (await newBuyer());
    const contentId = existing?.contentId ?? (await newContent());
    const payment = newPayment();
    const purchase = await makeService().completePurchase(
      payment.paymentIntentId,
      {
        contentId,
        customerId: buyerId,
        organizationId: orgId,
        amountPaidCents: 1000,
        currency: 'gbp',
      }
    );
    return {
      buyerId,
      purchaseId: purchase.id,
      ...payment,
      contentId,
      courseId: null,
    };
  }

  /** A completed course purchase and its entitlement. */
  async function courseSale(): Promise<Sale> {
    const buyerId = await newBuyer();
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug('late-win-course'),
          title: 'Late Win Course',
          status: 'published',
          priceCents: 1000,
        })
        .returning()
    );
    const payment = newPayment();
    const purchase = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          courseId: course.id,
          organizationId: orgId,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 135,
          creatorPayoutCents: 765,
          stripePaymentIntentId: payment.paymentIntentId,
          status: 'completed',
          purchasedAt: new Date(),
        })
        .returning()
    );
    await writeCoursePurchaseEntitlement(db, {
      userId: buyerId,
      organizationId: orgId,
      courseId: course.id,
      purchaseId: purchase.id,
    });
    return {
      buyerId,
      purchaseId: purchase.id,
      ...payment,
      contentId: null,
      courseId: course.id,
    };
  }

  function record(
    sale: Pick<Sale, 'paymentIntentId' | 'charge'>,
    disputeId: string,
    status: string,
    amountCents = 1000,
    service = makeService()
  ) {
    return service.recordDispute({
      stripeDisputeId: disputeId,
      stripeChargeId: sale.charge.id,
      paymentIntentId: sale.paymentIntentId,
      amountCents,
      currency: 'gbp',
      status,
      reason: 'fraudulent',
      stripeCreatedAt: new Date(),
    });
  }

  function newDisputeId(): string {
    const id = `dp_lw_${uid()}`;
    disputeIds.push(id);
    return id;
  }

  /**
   * A chargeback opened on the sale, then lost, as the webhook runs them:
   * access paused, the purchase refunded, the outcome applied. `finished:
   * false` stops after the record: a loss whose handling never ran.
   */
  async function loseIt(
    sale: Sale,
    options: { amountCents?: number; finished?: boolean } = {}
  ): Promise<string> {
    const { amountCents = 1000, finished = true } = options;
    const disputeId = newDisputeId();
    const service = makeService();
    await record(sale, disputeId, 'needs_response', amountCents);
    await service.processDispute(sale.paymentIntentId, {
      stripeDisputeId: disputeId,
    });
    await record(sale, disputeId, 'lost', amountCents);
    if (finished) {
      await service.processLostDispute(
        sale.paymentIntentId,
        amountCents,
        disputeId
      );
      await service.markDisputeOutcomeApplied(disputeId, { status: 'lost' });
    }
    return disputeId;
  }

  /**
   * The creator's paid slice of the first charge, reversed when its
   * chargeback opened; the chargeback then lost and its outcome applied, and
   * the buyer bought the item again, so a late win's refund would be due.
   */
  async function lostAfterAPaidSlice(first: Sale, service: PurchaseService) {
    const slice = takeFirst(
      await db
        .insert(payouts)
        .values({
          purchaseId: first.purchaseId,
          organizationId: orgId,
          userId: creatorId,
          payoutType: 'creator_payout',
          amountCents: 765,
          status: 'paid',
          sourceType: 'purchase',
          stripeChargeId: first.charge.id,
          stripeTransferId: `tr_lw_${uid()}`,
          resolvedAt: new Date(),
        })
        .returning()
    );
    const disputeId = newDisputeId();
    await record(first, disputeId, 'needs_response');
    await service.clawBackPurchaseCharge(first.paymentIntentId, first.charge);
    await service.processDispute(first.paymentIntentId, {
      stripeDisputeId: disputeId,
    });
    await record(first, disputeId, 'lost');
    await service.processLostDispute(first.paymentIntentId, 1000, disputeId);
    await service.markDisputeOutcomeApplied(disputeId, { status: 'lost' });
    await contentSale(first);
    return { slice, disputeId };
  }

  async function readPurchase(id: string) {
    return takeFirst(
      await db.select().from(purchases).where(eq(purchases.id, id))
    );
  }

  async function readDispute(id: string) {
    return takeFirst(
      await db.select().from(disputes).where(eq(disputes.stripeDisputeId, id))
    );
  }

  async function grantOf(purchaseId: string) {
    return takeFirst(
      await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.sourceRef, purchaseId))
    );
  }

  async function accessRow(sale: Sale) {
    return takeFirst(
      await db
        .select()
        .from(contentAccess)
        .where(
          and(
            eq(contentAccess.userId, sale.buyerId),
            eq(contentAccess.contentId, sale.contentId ?? '')
          )
        )
    );
  }

  /** What Stripe lists as a charge's refunds, by charge. */
  function stripeListsRefunds(
    byCharge: Record<string, Array<{ id: string; status: string }>>
  ) {
    vi.mocked(stripe.refunds.list).mockImplementation((async (params?: {
      charge?: string;
    }) => ({
      object: 'list',
      data: (byCharge[params?.charge ?? ''] ?? []).map((refund, i) => ({
        object: 'refund',
        amount: 1000,
        currency: 'gbp',
        created: Math.floor(Date.now() / 1000) + i,
        reason: 'duplicate',
        ...refund,
      })),
      has_more: false,
    })) as never);
  }

  // ── restoreAfterLateWin (§4.2) ────────────────────────────────────────

  describe('restoreAfterLateWin, by outcome', () => {
    it('restored: the purchase the loss refunded is completed again, its access row and entitlement back; a refund made before the dispute is restated, not the disputed amount', async () => {
      const sale = await contentSale();
      const service = makeService();
      // A partial refund before the dispute: the purchase stays completed (P-1).
      const earlier = `re_lw_before_${uid()}`;
      await service.recordRefund({
        stripeRefundId: earlier,
        stripeChargeId: sale.charge.id,
        paymentIntentId: sale.paymentIntentId,
        amountCents: 300,
        currency: 'gbp',
        status: 'succeeded',
        reason: 'requested_by_customer',
        failureReason: null,
        stripeCreatedAt: new Date(Date.now() - DAY_MS),
      });
      await service.processRefund(sale.paymentIntentId, {
        charge: sale.charge,
        stripeRefundId: earlier,
        refundAmountCents: 300,
        refundReason: 'requested_by_customer',
      });
      const disputeId = await loseIt(sale, { amountCents: 700 });
      // The loss raised the refunded amount by the disputed 700.
      expect(await readPurchase(sale.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
      });
      await record(sale, disputeId, 'won', 700);

      const result = await service.restoreAfterLateWin(disputeId);

      expect(result).toEqual({
        outcome: 'restored',
        userId: sale.buyerId,
        orgId,
        purchaseId: sale.purchaseId,
        email: {
          contentTitle: expect.any(String),
          amountCents: 1000,
          paidAt: expect.any(String),
          isCourse: false,
        },
      });
      const restored = await readPurchase(sale.purchaseId);
      expect(restored).toMatchObject({
        status: 'completed',
        refundedAt: null,
        disputedAt: null,
        refundAmountCents: 300,
        stripeRefundId: earlier,
        refundReason: 'requested_by_customer',
      });
      expect((await accessRow(sale)).deletedAt).toBeNull();
      expect((await grantOf(sale.purchaseId)).revokedAt).toBeNull();
      expect(
        await service.verifyPurchase(sale.contentId ?? '', sale.buyerId)
      ).toBe(true);

      // A redelivery, or the hourly retry: the same answer, the same row.
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'restored'
      );
      const again = await readPurchase(sale.purchaseId);
      expect({ ...again, updatedAt: null }).toEqual({
        ...restored,
        updatedAt: null,
      });
    });

    it('restored: a course purchase’s entitlement is restored, so its lessons open again; the email names the course', async () => {
      const sale = await courseSale();
      const disputeId = await loseIt(sale);
      expect((await grantOf(sale.purchaseId)).revokedAt).not.toBeNull();
      await record(sale, disputeId, 'won');

      const result = await makeService().restoreAfterLateWin(disputeId);

      expect(result).toMatchObject({
        outcome: 'restored',
        email: {
          contentTitle: 'Late Win Course',
          isCourse: true,
        },
      });
      expect((await grantOf(sale.purchaseId)).revokedAt).toBeNull();
      expect(await readPurchase(sale.purchaseId)).toMatchObject({
        status: 'completed',
        disputedAt: null,
      });
    });

    it('restored: a loss whose handling never ran leaves the purchase completed; it is unpaused as a normal win would', async () => {
      const sale = await contentSale();
      const disputeId = await loseIt(sale, { finished: false });
      expect((await readPurchase(sale.purchaseId)).disputedAt).not.toBeNull();
      expect((await accessRow(sale)).deletedAt).not.toBeNull();
      await record(sale, disputeId, 'won');

      const result = await makeService().restoreAfterLateWin(disputeId);

      expect(result?.outcome).toBe('restored');
      expect(await readPurchase(sale.purchaseId)).toMatchObject({
        status: 'completed',
        disputedAt: null,
        refundAmountCents: null,
      });
      expect((await accessRow(sale)).deletedAt).toBeNull();
      expect((await grantOf(sale.purchaseId)).revokedAt).toBeNull();
    });

    it('rebought: the first purchase stays refunded with its refund fields restated and its entitlement revoked; the content access the new purchase grants is untouched', async () => {
      const first = await contentSale();
      const disputeId = await loseIt(first);
      const second = await contentSale(first);
      const accessBefore = await accessRow(first);
      expect(accessBefore.deletedAt).toBeNull();
      await record(first, disputeId, 'won');

      const result = await makeService().restoreAfterLateWin(disputeId);

      expect(result).toMatchObject({ outcome: 'rebought', email: null });
      expect(await readPurchase(first.purchaseId)).toMatchObject({
        status: 'refunded',
        disputedAt: null,
        // No refund stands: the disputed amount the loss added is gone.
        refundAmountCents: null,
        stripeRefundId: null,
      });
      expect((await grantOf(first.purchaseId)).revokedAt).not.toBeNull();
      expect((await grantOf(second.purchaseId)).revokedAt).toBeNull();
      expect(await accessRow(first)).toEqual(accessBefore);
      expect(await readPurchase(second.purchaseId)).toMatchObject({
        status: 'completed',
      });
    });

    it('duplicate: a duplicate payment stays as it is, its disputed mark cleared; the purchase it repeats is untouched', async () => {
      const owned = await contentSale();
      const pendingDuplicate = async () => {
        const payment = newPayment();
        const row = takeFirst(
          await db
            .insert(purchases)
            .values({
              customerId: owned.buyerId,
              contentId: owned.contentId,
              organizationId: orgId,
              amountPaidCents: 1000,
              platformFeeCents: 100,
              organizationFeeCents: 135,
              creatorPayoutCents: 765,
              stripePaymentIntentId: payment.paymentIntentId,
              status: 'pending',
              duplicateOfPurchaseId: owned.purchaseId,
            })
            .returning()
        );
        return { ...owned, purchaseId: row.id, ...payment };
      };
      // Its loss ran: the duplicate is refunded by the bank's decision.
      const lostOne = await pendingDuplicate();
      const lostId = await loseIt(lostOne);
      const lostBefore = await readPurchase(lostOne.purchaseId);
      // Its loss never ran: the duplicate is still owed its refund.
      const owedOne = await pendingDuplicate();
      const owedId = await loseIt(owedOne, { finished: false });
      await record(lostOne, lostId, 'won');
      await record(owedOne, owedId, 'won');
      const service = makeService();

      expect((await service.restoreAfterLateWin(lostId))?.outcome).toBe(
        'duplicate'
      );
      expect((await service.restoreAfterLateWin(owedId))?.outcome).toBe(
        'duplicate'
      );

      expect(await readPurchase(lostOne.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: lostBefore.refundAmountCents,
        disputedAt: null,
      });
      expect(await readPurchase(owedOne.purchaseId)).toMatchObject({
        status: 'pending',
        disputedAt: null,
      });
      expect(await readPurchase(owned.purchaseId)).toMatchObject({
        status: 'completed',
      });
      expect((await accessRow(owned)).deletedAt).toBeNull();
    });

    it('still_refunded: refunds that still stand cover what was paid, so it stays refunded with its refund fields restated', async () => {
      const sale = await contentSale();
      const service = makeService();
      const refundIds = [`re_lw_a_${uid()}`, `re_lw_b_${uid()}`];
      for (const [i, id] of refundIds.entries()) {
        await service.recordRefund({
          stripeRefundId: id,
          stripeChargeId: sale.charge.id,
          paymentIntentId: sale.paymentIntentId,
          amountCents: 500,
          currency: 'gbp',
          status: 'succeeded',
          reason: 'requested_by_customer',
          failureReason: null,
          stripeCreatedAt: new Date(Date.now() - (2 - i) * DAY_MS),
        });
      }
      await service.processRefund(sale.paymentIntentId, {
        charge: sale.charge,
        stripeRefundId: refundIds[1],
        refundAmountCents: 1000,
      });
      const disputeId = await loseIt(sale);
      await record(sale, disputeId, 'won');

      const result = await service.restoreAfterLateWin(disputeId);

      expect(result).toMatchObject({ outcome: 'still_refunded', email: null });
      expect(await readPurchase(sale.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
        stripeRefundId: refundIds[1],
        disputedAt: null,
      });
      expect((await grantOf(sale.purchaseId)).revokedAt).not.toBeNull();
      expect((await accessRow(sale)).deletedAt).not.toBeNull();
    });

    it('dispute_holds: another chargeback on the purchase is open, so nothing is written and it decides', async () => {
      const sale = await contentSale();
      const disputeId = await loseIt(sale);
      const otherId = newDisputeId();
      await record(sale, otherId, 'needs_response');
      await record(sale, disputeId, 'won');
      const before = await readPurchase(sale.purchaseId);

      const result = await makeService().restoreAfterLateWin(disputeId);

      expect(result).toMatchObject({ outcome: 'dispute_holds', email: null });
      expect(await readPurchase(sale.purchaseId)).toEqual(before);
      expect(before.disputedAt).not.toBeNull();
    });

    it('nothing, and undefined, for a dispute that is not a late win being undone: a normal win, a lost one, and a subscription’s', async () => {
      const service = makeService();
      const normal = await contentSale();
      const normalId = newDisputeId();
      await record(normal, normalId, 'needs_response');
      await service.processDispute(normal.paymentIntentId, {
        stripeDisputeId: normalId,
      });
      await record(normal, normalId, 'won');
      const lost = await contentSale();
      const lostId = await loseIt(lost);
      const subscriptionId = newDisputeId();
      await db.insert(disputes).values({
        stripeDisputeId: subscriptionId,
        stripeChargeId: newPayment().charge.id,
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        lateWonAt: new Date(),
        stripeCreatedAt: new Date(),
      });
      const normalBefore = await readPurchase(normal.purchaseId);
      const lostBefore = await readPurchase(lost.purchaseId);

      expect(await service.restoreAfterLateWin(normalId)).toBeUndefined();
      expect(await service.restoreAfterLateWin(lostId)).toBeUndefined();
      expect(await service.restoreAfterLateWin(subscriptionId)).toBeUndefined();
      expect(await readPurchase(normal.purchaseId)).toEqual(normalBefore);
      expect(await readPurchase(lost.purchaseId)).toEqual(lostBefore);
    });
  });

  // ── an applied late win (lead decision 2; release step R18) ───────────

  it('a late win applied by hand under R18 is left alone: nothing is re-paid, restored, refunded or emailed again, and the re-check does not list it', async () => {
    const first = await contentSale();
    const service = makeService();
    const { slice, disputeId } = await lostAfterAPaidSlice(first, service);
    // R18: settled by hand before the deploy, recorded as an applied late win.
    await db
      .update(disputes)
      .set({
        status: 'won',
        lateWonAt: new Date(),
        lostAppliedAt: sql`${disputes.outcomeAppliedAt}`,
      })
      .where(eq(disputes.stripeDisputeId, disputeId));
    const settled = await readDispute(disputeId);
    expect(settled.outcomeAppliedAt).not.toBeNull();
    const purchaseBefore = await readPurchase(first.purchaseId);
    const steps = () =>
      db
        .select()
        .from(payoutReversals)
        .where(eq(payoutReversals.causeId, disputeId));
    const stepsBefore = await steps();
    expect(stepsBefore).toMatchObject([
      { payoutId: slice.id, status: 'done', repaidByPayoutId: null },
    ]);

    // The webhook stops at the applied record; a stale lost event is flagged.
    expect(await record(first, disputeId, 'won')).toMatchObject({
      status: 'won',
      outcomeAppliedAt: settled.outcomeAppliedAt,
    });
    expect(await record(first, disputeId, 'lost')).toMatchObject({
      refusedLost: true,
    });
    // Every step of the undo, called anyway, does nothing.
    expect(await service.restoreAfterLateWin(disputeId)).toBeUndefined();
    expect(await service.repayWonDispute(disputeId)).toEqual({
      repaid: 0,
      cancelled: 0,
      debtsClosed: 0,
    });
    expect(
      await service.refundFirstPaymentAfterLateWin(
        disputeId,
        first.charge,
        'test'
      )
    ).toBe('none');
    expect(await service.claimLateWinBuyerEmail(disputeId)).toBe(false);
    const recheck = await service.findLostDisputesToRecheck({
      since: new Date(Date.now() - 365 * DAY_MS),
      updatedBefore: new Date(Date.now() + 60_000),
      limit: 10_000,
    });
    expect(recheck.map((row) => row.stripeDisputeId)).not.toContain(disputeId);

    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(await steps()).toEqual(stepsBefore);
    expect(await readPurchase(first.purchaseId)).toEqual(purchaseBefore);
    expect(await readDispute(disputeId)).toMatchObject({
      buyerToldAt: null,
      lateWinRefundId: null,
    });
  });

  // ── the loss racing the late win (§4.8) ───────────────────────────────

  it('the loss after a late win does nothing: a re-run of the unfinished loss neither refunds the restored purchase nor asks for a streaming block', async () => {
    const sale = await contentSale();
    const service = makeService();
    // The reconcile records the loss, still unfinished…
    const disputeId = await loseIt(sale, { finished: false });
    // …the late win lands and is undone…
    await record(sale, disputeId, 'won');
    expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
      'restored'
    );

    // …then the reconcile's stale run of the loss reaches its purchase step.
    const ended = await service.processLostDispute(
      sale.paymentIntentId,
      1000,
      disputeId
    );

    expect(ended).toMatchObject({ accessEnded: false });
    expect(await readPurchase(sale.purchaseId)).toMatchObject({
      status: 'completed',
      refundedAt: null,
      disputedAt: null,
    });
    expect((await accessRow(sale)).deletedAt).toBeNull();
    expect((await grantOf(sale.purchaseId)).revokedAt).toBeNull();
  });

  it("the loss's mark after a late win marks nothing: the late win stays unapplied, and its undo still restores the buyer and re-pays the creator", async () => {
    const first = await contentSale();
    const service = makeService();
    // The creator's paid slice, reversed when the chargeback opened.
    const slice = takeFirst(
      await db
        .insert(payouts)
        .values({
          purchaseId: first.purchaseId,
          organizationId: orgId,
          userId: creatorId,
          payoutType: 'creator_payout',
          amountCents: 765,
          status: 'paid',
          sourceType: 'purchase',
          stripeChargeId: first.charge.id,
          stripeTransferId: `tr_lw_${uid()}`,
          resolvedAt: new Date(),
        })
        .returning()
    );
    const disputeId = newDisputeId();
    await record(first, disputeId, 'needs_response');
    await service.clawBackPurchaseCharge(first.paymentIntentId, first.charge);
    await service.processDispute(first.paymentIntentId, {
      stripeDisputeId: disputeId,
    });
    // A run of the loss reads the row lost and starts…
    expect((await record(first, disputeId, 'lost'))?.status).toBe('lost');
    // …the late win's `won` event records the late win meanwhile…
    expect(await record(first, disputeId, 'won')).toMatchObject({
      status: 'won',
      outcomeAppliedAt: null,
      lostAppliedAt: null,
    });
    // …and the loss run carries on to its mark: nothing to refund or cut.
    await service.processLostDispute(first.paymentIntentId, 1000, disputeId);
    await service.clawBackPurchaseCharge(first.paymentIntentId, first.charge);
    expect(
      await service.markDisputeOutcomeApplied(disputeId, { status: 'lost' })
    ).toBe('moved');

    expect(await readDispute(disputeId)).toMatchObject({
      status: 'won',
      outcomeAppliedAt: null,
    });
    // The undo is not shut out: the buyer back, the reversed slice re-paid.
    expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
      'restored'
    );
    const repaid = await service.repayWonDispute(disputeId);
    expect(repaid.repaid).toBe(1);
    const [step] = await db
      .select()
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.payoutId, slice.id),
          eq(payoutReversals.causeId, disputeId)
        )
      );
    expect(step?.repaidByPayoutId).not.toBeNull();
    expect(
      await service.markDisputeOutcomeApplied(disputeId, { status: 'won' })
    ).toBe('marked');
    expect(
      await service.markDisputeOutcomeApplied(disputeId, { status: 'won' })
    ).toBe('already_marked');
  });

  // ── the first payment's refund (Q1; §4.5) ─────────────────────────────

  describe('refundFirstPaymentAfterLateWin', () => {
    /** A buyer who bought the item again after the loss, then won late. */
    async function reboughtLateWin() {
      const first = await contentSale();
      const disputeId = await loseIt(first);
      const second = await contentSale(first);
      await record(first, disputeId, 'won');
      const service = makeService();
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'rebought'
      );
      await service.repayWonDispute(disputeId);
      return { first, second, disputeId, service };
    }

    function stripeMakesRefund(id: string, status: string) {
      vi.mocked(stripe.refunds.create).mockResolvedValue({
        id,
        object: 'refund',
        status,
        amount: 1000,
        created: Math.floor(Date.now() / 1000),
      } as never);
    }

    it('refunds what is left of the first charge under its own key, reason and metadata; writes its id; records it; restates the purchase; done', async () => {
      const { first, second, disputeId, service } = await reboughtLateWin();
      const refundId = `re_lw_first_${uid()}`;
      stripeMakesRefund(refundId, 'succeeded');
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'succeeded' }],
      });

      const step = await service.refundFirstPaymentAfterLateWin(
        disputeId,
        first.charge,
        'test'
      );

      expect(step).toBe('done');
      expect(stripe.refunds.create).toHaveBeenCalledOnce();
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        {
          charge: first.charge.id,
          reason: 'duplicate',
          metadata: expect.objectContaining({
            codex_late_win_dispute: disputeId,
            codex_env: 'test',
          }),
        },
        { idempotencyKey: `late_win_refund_${disputeId}` }
      );
      expect((await readDispute(disputeId)).lateWinRefundId).toBe(refundId);
      expect(
        await db
          .select({ purchaseId: refunds.purchaseId, status: refunds.status })
          .from(refunds)
          .where(eq(refunds.stripeRefundId, refundId))
      ).toEqual([{ purchaseId: first.purchaseId, status: 'succeeded' }]);
      expect(await readPurchase(first.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
        stripeRefundId: refundId,
      });
      expect(await readPurchase(second.purchaseId)).toMatchObject({
        status: 'completed',
      });

      // A redelivery before the outcome is marked: the refund already made
      // is read, never made again.
      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          first.charge,
          'test'
        )
      ).toBe('done');
      expect(stripe.refunds.create).toHaveBeenCalledOnce();

      // Its charge.refunded, after the mark: the refund email's late-win note.
      await service.markDisputeOutcomeApplied(disputeId, { status: 'won' });
      const refunded = await service.processRefund(first.paymentIntentId, {
        charge: first.charge,
        stripeRefundId: refundId,
        refundAmountCents: 1000,
      });
      const kept = await readPurchase(second.purchaseId);
      expect(refunded).toMatchObject({
        accessEnded: false,
        lateWinKeptThrough: {
          purchasedAt: (kept.purchasedAt ?? kept.createdAt).toISOString(),
        },
      });
      // Any other refund of an already-refunded purchase has no such note.
      const other = await service.processRefund(first.paymentIntentId, {
        charge: first.charge,
        stripeRefundId: `re_lw_other_${uid()}`,
        refundAmountCents: 1000,
      });
      expect(other?.lateWinKeptThrough).toBeNull();
    });

    it('pending: waits for Stripe, and a later run finishes it without a second refund', async () => {
      const { first, disputeId, service } = await reboughtLateWin();
      const refundId = `re_lw_pending_${uid()}`;
      stripeMakesRefund(refundId, 'pending');
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'pending' }],
      });

      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          first.charge,
          'test'
        )
      ).toBe('pending');
      expect((await readDispute(disputeId)).lateWinRefundId).toBe(refundId);
      // A pending refund stands: the purchase counts it already.
      expect((await readPurchase(first.purchaseId)).refundAmountCents).toBe(
        1000
      );

      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'succeeded' }],
      });
      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          first.charge,
          'test'
        )
      ).toBe('done');
      expect(stripe.refunds.create).toHaveBeenCalledOnce();
    });

    it('refused, or Stripe out of reach: a typed, retryable error with ids and what Stripe answered (code, type, status), never its message; nothing is written, and the retry asks Stripe under the same key', async () => {
      const { first, disputeId, service } = await reboughtLateWin();
      vi.mocked(stripe.refunds.create)
        .mockRejectedValueOnce(
          Object.assign(new Error('Insufficient platform balance'), {
            type: 'StripeInvalidRequestError',
            code: 'balance_insufficient',
            statusCode: 400,
          })
        )
        .mockRejectedValueOnce(
          Object.assign(new Error('An error occurred with our connection'), {
            type: 'StripeConnectionError',
          })
        );
      const attempt = () =>
        service
          .refundFirstPaymentAfterLateWin(disputeId, first.charge, 'test')
          .catch((error: unknown) => error);

      const refused = await attempt();
      expect(refused).toBeInstanceOf(LateWinRefundRefusedError);
      expect(refused).toBeInstanceOf(ServiceUnavailableError);
      expect((refused as LateWinRefundRefusedError).context).toEqual({
        disputeId,
        purchaseId: first.purchaseId,
        stripeCode: 'balance_insufficient',
        stripeType: 'StripeInvalidRequestError',
        stripeStatusCode: 400,
      });
      // Only a refusal says "refused"; never Stripe's own words.
      expect((refused as LateWinRefundRefusedError).message).toBe(
        "The late win's refund of the payment was refused; it is retried"
      );
      const unreached = await attempt();
      expect(unreached).toBeInstanceOf(LateWinRefundRefusedError);
      expect((unreached as LateWinRefundRefusedError).context).toEqual({
        disputeId,
        purchaseId: first.purchaseId,
        stripeCode: null,
        stripeType: 'StripeConnectionError',
        stripeStatusCode: null,
      });
      expect((unreached as LateWinRefundRefusedError).message).toBe(
        "The late win's refund of the payment could not be made; it is retried"
      );
      expect((await readDispute(disputeId)).lateWinRefundId).toBeNull();

      const refundId = `re_lw_retry_${uid()}`;
      stripeMakesRefund(refundId, 'succeeded');
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'succeeded' }],
      });
      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          first.charge,
          'test'
        )
      ).toBe('done');
      const calls = vi.mocked(stripe.refunds.create).mock
        .calls as unknown as Array<[unknown, { idempotencyKey?: string }?]>;
      const keys = calls.map(([, options]) => options?.idempotencyKey);
      expect(keys).toEqual([
        `late_win_refund_${disputeId}`,
        `late_win_refund_${disputeId}`,
        `late_win_refund_${disputeId}`,
      ]);
    });

    it('none: a restored buyer, who paid once, is not refunded', async () => {
      const sale = await contentSale();
      const disputeId = await loseIt(sale);
      await record(sale, disputeId, 'won');
      const service = makeService();
      await service.restoreAfterLateWin(disputeId);

      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          sale.charge,
          'test'
        )
      ).toBe('none');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('a loss that refunded the payment but never marked its outcome still owes a buyer who bought again their first payment: refunded exactly once', async () => {
      const first = await contentSale();
      const service = makeService();
      // The loss refunds the purchase, then a later step fails (a clawback,
      // say): the outcome is never marked, so the late win copies a null
      // into lost_applied_at.
      const disputeId = await loseIt(first, { finished: false });
      await service.processLostDispute(first.paymentIntentId, 1000, disputeId);
      const second = await contentSale(first);
      await record(first, disputeId, 'won');
      expect(await readDispute(disputeId)).toMatchObject({
        status: 'won',
        lostAppliedAt: null,
        outcomeAppliedAt: null,
      });
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'rebought'
      );
      await service.repayWonDispute(disputeId);
      const refundId = `re_lw_unmarked_${uid()}`;
      stripeMakesRefund(refundId, 'succeeded');
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'succeeded' }],
      });
      const step = () =>
        service.refundFirstPaymentAfterLateWin(disputeId, first.charge, 'test');

      expect(await step()).toBe('done');
      // A retry before the outcome is marked reads the refund already made.
      expect(await step()).toBe('done');

      expect(stripe.refunds.create).toHaveBeenCalledOnce();
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: first.charge.id }),
        { idempotencyKey: `late_win_refund_${disputeId}` }
      );
      expect((await readDispute(disputeId)).lateWinRefundId).toBe(refundId);
      expect(await readPurchase(first.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
        stripeRefundId: refundId,
      });
      expect(await readPurchase(second.purchaseId)).toMatchObject({
        status: 'completed',
      });
    });

    /** A pending duplicate of `owned`'s purchase, on a payment of its own. */
    async function duplicateOf(owned: Sale, createdAt?: Date): Promise<Sale> {
      const payment = newPayment();
      const row = takeFirst(
        await db
          .insert(purchases)
          .values({
            customerId: owned.buyerId,
            contentId: owned.contentId,
            organizationId: orgId,
            amountPaidCents: 1000,
            platformFeeCents: 100,
            organizationFeeCents: 135,
            creatorPayoutCents: 765,
            stripePaymentIntentId: payment.paymentIntentId,
            status: 'pending',
            duplicateOfPurchaseId: owned.purchaseId,
            ...(createdAt ? { createdAt } : {}),
          })
          .returning()
      );
      return { ...owned, purchaseId: row.id, ...payment };
    }

    it('duplicate: a late-won duplicate payment whose loss ran is refunded on its own disputed charge; the purchase it repeats is untouched; done', async () => {
      const owned = await contentSale();
      const duplicate = await duplicateOf(owned);
      const disputeId = await loseIt(duplicate);
      await record(duplicate, disputeId, 'won');
      const service = makeService();
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'duplicate'
      );
      await service.repayWonDispute(disputeId);
      const refundId = `re_lw_dup_${uid()}`;
      stripeMakesRefund(refundId, 'succeeded');
      stripeListsRefunds({
        [duplicate.charge.id]: [{ id: refundId, status: 'succeeded' }],
      });

      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          duplicate.charge,
          'test'
        )
      ).toBe('done');

      // The disputed charge, the one the dispute row holds; never the
      // payment the duplicate repeats.
      expect((await readDispute(disputeId)).stripeChargeId).toBe(
        duplicate.charge.id
      );
      expect(stripe.refunds.create).toHaveBeenCalledOnce();
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: duplicate.charge.id }),
        { idempotencyKey: `late_win_refund_${disputeId}` }
      );
      expect((await readDispute(disputeId)).lateWinRefundId).toBe(refundId);
      expect(
        await db
          .select({ purchaseId: refunds.purchaseId, status: refunds.status })
          .from(refunds)
          .where(eq(refunds.stripeRefundId, refundId))
      ).toEqual([{ purchaseId: duplicate.purchaseId, status: 'succeeded' }]);
      expect(await readPurchase(duplicate.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
        stripeRefundId: refundId,
        disputedAt: null,
      });
      expect(
        await db
          .select({ id: refunds.id })
          .from(refunds)
          .where(eq(refunds.stripeChargeId, owned.charge.id))
      ).toEqual([]);
      expect(await readPurchase(owned.purchaseId)).toMatchObject({
        status: 'completed',
        stripeRefundId: null,
      });
      expect((await accessRow(owned)).deletedAt).toBeNull();

      // Its charge.refunded: the email's duplicate note ("a second payment"),
      // never the late win's "your first payment".
      await service.markDisputeOutcomeApplied(disputeId, { status: 'won' });
      expect(
        await service.processRefund(duplicate.paymentIntentId, {
          charge: duplicate.charge,
          stripeRefundId: refundId,
          refundAmountCents: 1000,
        })
      ).toMatchObject({
        accessEnded: false,
        duplicatePayment: true,
        lateWinKeptThrough: null,
      });
    });

    it('a late-won duplicate whose original purchase was refunded since is refunded too (owner, "Refund it"): the buyer holds nothing, and paid once', async () => {
      const owned = await contentSale();
      const duplicate = await duplicateOf(owned);
      const disputeId = await loseIt(duplicate);
      const service = makeService();
      // Support refunds the original in full since, as charge.refunded
      // records it: nothing grants the item any more.
      const original = `re_lw_original_${uid()}`;
      stripeListsRefunds({
        [owned.charge.id]: [{ id: original, status: 'succeeded' }],
      });
      await service.recordChargeRefunds({
        id: owned.charge.id,
        paymentIntentId: owned.paymentIntentId,
      });
      await service.processRefund(owned.paymentIntentId, {
        charge: owned.charge,
        stripeRefundId: original,
        refundAmountCents: 1000,
      });
      expect(await readPurchase(owned.purchaseId)).toMatchObject({
        status: 'refunded',
      });

      await record(duplicate, disputeId, 'won');
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'duplicate'
      );
      await service.repayWonDispute(disputeId);
      const refundId = `re_lw_dup_alone_${uid()}`;
      stripeMakesRefund(refundId, 'succeeded');
      stripeListsRefunds({
        [duplicate.charge.id]: [{ id: refundId, status: 'succeeded' }],
      });

      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          duplicate.charge,
          'test'
        )
      ).toBe('done');
      expect(stripe.refunds.create).toHaveBeenCalledOnce();
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: duplicate.charge.id }),
        { idempotencyKey: `late_win_refund_${disputeId}` }
      );
      expect((await readDispute(disputeId)).lateWinRefundId).toBe(refundId);
      expect(await readPurchase(duplicate.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
        stripeRefundId: refundId,
      });
    });

    it("a pending duplicate the loss never got to is the sweep's: none before the sweep refunds it; after, the late win's refund meets charge_already_refunded and is done, so it is refunded exactly once", async () => {
      const owned = await contentSale();
      // Created long ago, so the sweep below reaches this row and no other.
      const duplicate = await duplicateOf(owned, SWEEP_ONLY_THIS_FILE.created);
      const disputeId = await loseIt(duplicate, { finished: false });
      await record(duplicate, disputeId, 'won');
      const service = makeService();
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'duplicate'
      );
      await service.repayWonDispute(disputeId);
      const step = () =>
        service.refundFirstPaymentAfterLateWin(
          disputeId,
          duplicate.charge,
          'test'
        );

      // Still pending: nothing to refund yet.
      expect(await step()).toBe('none');
      expect(stripe.refunds.create).not.toHaveBeenCalled();

      const swept = `re_lw_sweep_${uid()}`;
      stripeMakesRefund(swept, 'succeeded');
      expect(
        await service.settleOwedDuplicates({
          olderThanMs: Date.now() - SWEEP_ONLY_THIS_FILE.before.getTime(),
          limit: 10,
        })
      ).toEqual({ settled: 1, stillOwed: [] });
      expect(await readPurchase(duplicate.purchaseId)).toMatchObject({
        status: 'refunded',
        stripeRefundId: swept,
      });

      // Refunded now, by the sweep and not the loss, and its charge.refunded
      // is not recorded yet. A retry of the late win's undo lands in exactly
      // this window: its refund asks Stripe, which answers that the charge is
      // refunded in full already, and that is done.
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
        Object.assign(new Error('Charge has already been refunded (test)'), {
          type: 'StripeInvalidRequestError',
          code: 'charge_already_refunded',
          statusCode: 400,
        })
      );
      stripeListsRefunds({
        [duplicate.charge.id]: [{ id: swept, status: 'succeeded' }],
      });
      expect(await step()).toBe('done');

      // Two asks, and one refund: the sweep's.
      const calls = vi.mocked(stripe.refunds.create).mock
        .calls as unknown as Array<[unknown, { idempotencyKey?: string }?]>;
      expect(calls.map(([, options]) => options?.idempotencyKey)).toEqual([
        `refund_duplicate_${duplicate.paymentIntentId}`,
        `late_win_refund_${disputeId}`,
      ]);
      expect(
        await db
          .select({ id: refunds.stripeRefundId })
          .from(refunds)
          .where(eq(refunds.stripeChargeId, duplicate.charge.id))
      ).toEqual([{ id: swept }]);
      expect((await readDispute(disputeId)).lateWinRefundId).toBeNull();
      expect(await readPurchase(duplicate.purchaseId)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 1000,
        stripeRefundId: swept,
      });
    });

    it('a payment refunded in full before its chargeback was lost is not refunded again when the chargeback is won late: none', async () => {
      const first = await contentSale();
      const service = makeService();
      // Refunded in full first, as charge.refunded records it.
      const earlier = `re_lw_before_${uid()}`;
      stripeListsRefunds({
        [first.charge.id]: [{ id: earlier, status: 'succeeded' }],
      });
      await service.recordChargeRefunds({
        id: first.charge.id,
        paymentIntentId: first.paymentIntentId,
      });
      await service.processRefund(first.paymentIntentId, {
        charge: first.charge,
        stripeRefundId: earlier,
        refundAmountCents: 1000,
      });
      await contentSale(first);
      // The buyer disputed it anyway: the loss found it refunded and wrote
      // nothing, and the outcome was marked.
      const disputeId = await loseIt(first);
      await record(first, disputeId, 'won');
      expect((await readDispute(disputeId)).lostAppliedAt).not.toBeNull();
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'rebought'
      );
      await service.repayWonDispute(disputeId);

      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          first.charge,
          'test'
        )
      ).toBe('none');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('canceled: a refund Stripe canceled counts as settled and is done, takes nothing from the creators, and is alerted at error with ids only for support to settle by hand', async () => {
      const first = await contentSale();
      const service = makeService();
      const { slice, disputeId } = await lostAfterAPaidSlice(first, service);
      await record(first, disputeId, 'won');
      expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
        'rebought'
      );
      expect((await service.repayWonDispute(disputeId)).repaid).toBe(1);
      // The creator's money: every payout row and clawback step of this
      // file's organisation, the slice's held re-pay row among them.
      const ledger = async () => {
        const rows = await db
          .select()
          .from(payouts)
          .where(eq(payouts.organizationId, orgId))
          .orderBy(payouts.id);
        const steps = await db
          .select()
          .from(payoutReversals)
          .where(
            inArray(
              payoutReversals.payoutId,
              rows.map((row) => row.id)
            )
          )
          .orderBy(payoutReversals.id);
        return { rows, steps };
      };
      const before = await ledger();
      const repay = before.steps.find((step) => step.payoutId === slice.id);
      expect(
        before.rows.find((row) => row.id === repay?.repaidByPayoutId)
      ).toMatchObject({ status: 'pending', amountCents: 765 });
      vi.mocked(stripe.transfers.createReversal).mockClear();
      const refundId = `re_lw_canceled_${uid()}`;
      stripeMakesRefund(refundId, 'canceled');
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'canceled' }],
      });
      const alerts = vi.spyOn(
        (
          service as unknown as {
            obs: { error: (message: string, meta?: object) => void };
          }
        ).obs,
        'error'
      );

      expect(
        await service.refundFirstPaymentAfterLateWin(
          disputeId,
          first.charge,
          'test'
        )
      ).toBe('done');
      // A canceled refund is not clawable (listClawableRefunds): the held
      // re-pay row is untouched, no step is written, no transfer reversed.
      expect(await ledger()).toEqual(before);
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect(alerts).toHaveBeenCalledOnce();
      expect(alerts).toHaveBeenCalledWith(
        'Late win: Stripe canceled the refund of the payment, so the buyer was not refunded. Support must settle it by hand',
        {
          errorId: expect.any(String),
          disputeId,
          purchaseId: first.purchaseId,
          refundId,
          status: 'canceled',
        }
      );
    });

    it('failed: a pending refund later found failed counts as settled and is done, but is alerted at error with ids, as in Failed refunds, never with the info line of a refund made', async () => {
      const { first, disputeId, service } = await reboughtLateWin();
      const refundId = `re_lw_failed_${uid()}`;
      stripeMakesRefund(refundId, 'pending');
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'pending' }],
      });
      const obs = (
        service as unknown as {
          obs: {
            error: (message: string, meta?: object) => void;
            info: (message: string, meta?: object) => void;
          };
        }
      ).obs;
      const alerts = vi.spyOn(obs, 'error');
      const notes = vi.spyOn(obs, 'info');
      const step = () =>
        service.refundFirstPaymentAfterLateWin(disputeId, first.charge, 'test');

      expect(await step()).toBe('pending');
      // It failed at Stripe; the next hourly run records it so.
      stripeListsRefunds({
        [first.charge.id]: [{ id: refundId, status: 'failed' }],
      });
      expect(await step()).toBe('done');

      expect(stripe.refunds.create).toHaveBeenCalledOnce();
      expect(
        await db
          .select({ status: refunds.status })
          .from(refunds)
          .where(eq(refunds.stripeRefundId, refundId))
      ).toEqual([{ status: 'failed' }]);
      expect(alerts).toHaveBeenCalledExactlyOnceWith(
        'Late win: the refund of the payment failed at Stripe, so the buyer was not refunded; it is in Failed refunds',
        {
          errorId: expect.any(String),
          disputeId,
          purchaseId: first.purchaseId,
          refundId,
          status: 'failed',
        }
      );
      expect(notes).not.toHaveBeenCalledWith(
        "Late win: the payment's refund is clawed back",
        expect.anything()
      );
    });

    it("failed, after the creator was paid: done and alerted, and the creator's share of the first payment IS clawed back and stays so, as any failed refund (Hold it for support); a canceled one, its contrast, takes nothing", async () => {
      const service = makeService();
      const alerts = vi.spyOn(
        (
          service as unknown as {
            obs: { error: (message: string, meta?: object) => void };
          }
        ).obs,
        'error'
      );
      /**
       * A sale whose creator was paid, lost with its outcome applied, bought
       * again, then won late and re-paid; its late-win refund Stripe reports
       * as `status`. What its slice, the slice's held re-pay row and the
       * refund's own steps are afterwards.
       */
      async function lateWinRefundEnds(status: 'failed' | 'canceled') {
        const first = await contentSale();
        const { slice, disputeId } = await lostAfterAPaidSlice(first, service);
        await record(first, disputeId, 'won');
        expect((await service.restoreAfterLateWin(disputeId))?.outcome).toBe(
          'rebought'
        );
        expect((await service.repayWonDispute(disputeId)).repaid).toBe(1);
        const [repaidStep] = await db
          .select({ repayId: payoutReversals.repaidByPayoutId })
          .from(payoutReversals)
          .where(
            and(
              eq(payoutReversals.payoutId, slice.id),
              eq(payoutReversals.causeId, disputeId)
            )
          );
        const repayId = repaidStep?.repayId;
        if (!repayId) throw new Error('the win wrote no re-pay row');
        const refundId = `re_lw_${status}_paid_${uid()}`;
        stripeMakesRefund(refundId, status);
        stripeListsRefunds({ [first.charge.id]: [{ id: refundId, status }] });

        const run = () =>
          service.refundFirstPaymentAfterLateWin(
            disputeId,
            first.charge,
            'test'
          );
        const ledger = async () => ({
          repay: takeFirst(
            await db.select().from(payouts).where(eq(payouts.id, repayId))
          ),
          refundSteps: await db
            .select()
            .from(payoutReversals)
            .where(eq(payoutReversals.causeId, refundId)),
        });
        return { run, ledger, disputeId, refundId, repayId };
      }

      // Failed: the refund's share of the slice comes off its held re-pay
      // row, which is cancelled: the creator is not paid back for the first
      // payment while the buyer is owed it (Failed refunds).
      const failed = await lateWinRefundEnds('failed');
      expect(await failed.run()).toBe('done');
      expect(alerts).toHaveBeenCalledWith(
        'Late win: the refund of the payment failed at Stripe, so the buyer was not refunded; it is in Failed refunds',
        expect.objectContaining({
          disputeId: failed.disputeId,
          refundId: failed.refundId,
          status: 'failed',
        })
      );
      const clawedBack = await failed.ledger();
      expect(clawedBack.repay).toMatchObject({
        status: 'cancelled_by_refund',
        amountCents: 765,
        stripeTransferId: null,
      });
      expect(clawedBack.refundSteps).toMatchObject([
        {
          payoutId: failed.repayId,
          causeType: 'refund',
          kind: 'cancellation',
          status: 'done',
          amountCents: 765,
        },
      ]);
      // It stands: a re-run and the outcome's mark change nothing.
      expect(await failed.run()).toBe('done');
      await service.markDisputeOutcomeApplied(failed.disputeId, {
        status: 'won',
      });
      expect(await failed.ledger()).toEqual(clawedBack);

      // Canceled, its contrast: the held re-pay row is untouched.
      const canceled = await lateWinRefundEnds('canceled');
      expect(await canceled.run()).toBe('done');
      const untouched = await canceled.ledger();
      expect(untouched.repay).toMatchObject({
        status: 'pending',
        amountCents: 765,
      });
      expect(untouched.refundSteps).toEqual([]);
    });
  });

  // ── the buyer's email claim (§7) ──────────────────────────────────────

  it('claimLateWinBuyerEmail: true once for a late win, after its outcome is marked too; never for a normal win', async () => {
    const service = makeService();
    const sale = await contentSale();
    const disputeId = await loseIt(sale);
    await record(sale, disputeId, 'won');
    await service.restoreAfterLateWin(disputeId);
    // The webhook marks the outcome, then claims.
    await service.markDisputeOutcomeApplied(disputeId, { status: 'won' });

    expect(await service.claimLateWinBuyerEmail(disputeId)).toBe(true);
    expect(await service.claimLateWinBuyerEmail(disputeId)).toBe(false);
    expect((await readDispute(disputeId)).buyerToldAt).toBeInstanceOf(Date);

    const normal = await contentSale();
    const normalId = newDisputeId();
    await record(normal, normalId, 'needs_response');
    await record(normal, normalId, 'won');
    expect(await service.claimLateWinBuyerEmail(normalId)).toBe(false);
  });

  it('markDisputeOutcomeApplied never writes a time before late_won_at: a mark by a worker whose clock is behind still lets the email be claimed', async () => {
    const service = makeService();
    const sale = await contentSale();
    const disputeId = await loseIt(sale);
    await record(sale, disputeId, 'won');
    // The worker that recorded the late win ran a minute ahead of this one.
    const ahead = new Date(Date.now() + 60_000);
    await db
      .update(disputes)
      .set({ lateWonAt: ahead })
      .where(eq(disputes.stripeDisputeId, disputeId));
    await service.restoreAfterLateWin(disputeId);
    await service.markDisputeOutcomeApplied(disputeId, { status: 'won' });

    expect((await readDispute(disputeId)).outcomeAppliedAt?.getTime()).toBe(
      ahead.getTime()
    );
    expect(await service.claimLateWinBuyerEmail(disputeId)).toBe(true);

    // No late win: GREATEST skips the null, and the mark is this clock's.
    const normal = await contentSale();
    const normalId = newDisputeId();
    await record(normal, normalId, 'needs_response');
    await record(normal, normalId, 'won');
    await service.markDisputeOutcomeApplied(normalId, { status: 'won' });
    expect((await readDispute(normalId)).outcomeAppliedAt).toBeInstanceOf(Date);
  });

  // ── the hourly re-check's read (§5 source 3) ──────────────────────────

  it('findLostDisputesToRecheck: lost rows opened since `since` and untouched since `updatedBefore`, newest first', async () => {
    const service = makeService();
    const chargeId = newPayment().charge.id;
    const now = Date.now();
    const rows = {
      young: { createdDaysAgo: 30, touchedMinutesAgo: 60, status: 'lost' },
      younger: { createdDaysAgo: 5, touchedMinutesAgo: 60, status: 'lost' },
      fresh: { createdDaysAgo: 5, touchedMinutesAgo: 1, status: 'lost' },
      tooOld: { createdDaysAgo: 400, touchedMinutesAgo: 60, status: 'lost' },
      won: { createdDaysAgo: 5, touchedMinutesAgo: 60, status: 'won' },
    };
    const ids: Record<string, string> = {};
    for (const [name, row] of Object.entries(rows)) {
      const id = newDisputeId();
      ids[name] = id;
      await db.insert(disputes).values({
        stripeDisputeId: id,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: row.status,
        stripeCreatedAt: new Date(now - row.createdDaysAgo * DAY_MS),
        updatedAt: new Date(now - row.touchedMinutesAgo * 60_000),
      });
    }

    const found = await service.findLostDisputesToRecheck({
      since: new Date(now - 365 * DAY_MS),
      updatedBefore: new Date(now - 15 * 60_000),
      limit: 10_000,
    });

    const mine = found
      .map((row) => row.stripeDisputeId)
      .filter((id) => Object.values(ids).includes(id));
    expect(mine).toEqual([ids.younger, ids.young]);
    expect(found.find((row) => row.stripeDisputeId === ids.young)).toEqual({
      stripeDisputeId: ids.young,
      stripeCreatedAt: new Date(now - 30 * DAY_MS),
    });
  });
});
