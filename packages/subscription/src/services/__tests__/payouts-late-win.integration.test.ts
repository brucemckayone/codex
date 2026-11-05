/**
 * What Studio's two payout lists say about a won chargeback's pay-back
 * (Codex-2hxff.70; late-win data design §6, Q4, mockups E1-E4 and P1):
 * `paysBack` on the re-pay row, `paidBack` on the share it pays back,
 * `cancelledFor` on a share the loss cancelled, and the re-pay row a refund
 * cancelled before it was paid left out of the rows and the total alike.
 * Org Payouts' `takenBack` (P0, owner "Add the line") too: every reversed
 * row's, scoped to the organisation.
 *
 * Real database: the lines are read from the chargeback's steps, and the
 * omission is a predicate in SQL.
 */

import {
  content,
  contentAccess,
  disputes,
  organizations,
  payoutReversals,
  payouts,
  purchases,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedPurchaseWithAccess,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SubscriptionService } from '../subscription-service';

const LOST_ON = new Date('2026-11-20T10:00:00Z');
const WON_LATE_AT = new Date('2026-12-14T16:20:00Z');
const REPAID_AT = new Date('2026-12-14T16:21:00Z');

describe('the payout lists after a won chargeback', () => {
  let db: Database;
  const orgIds: string[] = [];
  const contentIds: string[] = [];
  const purchaseIds: string[] = [];
  const disputeIds: string[] = [];
  const payoutIds: string[] = [];

  beforeAll(() => {
    db = setupTestDatabase();
  });

  // Every row this file wrote: the hourly drain and the money sweep are global.
  afterAll(async () => {
    if (payoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, payoutIds));
      await db.delete(payouts).where(inArray(payouts.id, payoutIds));
    }
    if (disputeIds.length > 0) {
      await db.delete(disputes).where(inArray(disputes.id, disputeIds));
    }
    if (purchaseIds.length > 0) {
      await db
        .delete(contentAccess)
        .where(inArray(contentAccess.contentId, contentIds));
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await teardownTestDatabase();
  });

  async function organisation(): Promise<string> {
    const id = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('late-win') })
        )
        .returning()
    ).id;
    orgIds.push(id);
    return id;
  }

  async function person(): Promise<string> {
    const [userId] = await seedTestUsers(db, 1);
    if (!userId) throw new Error('no user');
    return userId;
  }

  /** A £24.00 sale of `title`, and its chargeback, lost and then won late. */
  async function wonLateSale(orgId: string, creatorId: string, title: string) {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, { organizationId: orgId, title })
        )
        .returning()
    );
    contentIds.push(item.id);
    const purchase = await seedPurchaseWithAccess(db, {
      customerId: await person(),
      contentId: item.id,
      organizationId: orgId,
      amountPaidCents: 2400,
    });
    purchaseIds.push(purchase.id);
    const suffix = crypto.randomUUID().slice(0, 12);
    const dispute = takeFirst(
      await db
        .insert(disputes)
        .values({
          stripeDisputeId: `du_late_${suffix}`,
          stripeChargeId: `ch_late_${suffix}`,
          purchaseId: purchase.id,
          amountCents: 2400,
          currency: 'gbp',
          status: 'won',
          stripeCreatedAt: new Date('2026-10-26T09:00:00Z'),
          outcomeAppliedAt: new Date('2026-12-14T16:22:00Z'),
          lateWonAt: WON_LATE_AT,
          lostAppliedAt: LOST_ON,
        })
        .returning()
    );
    disputeIds.push(dispute.id);
    return {
      purchaseId: purchase.id,
      chargeId: dispute.stripeChargeId,
      disputeId: dispute.stripeDisputeId,
    };
  }

  async function row(values: typeof payouts.$inferInsert): Promise<string> {
    const id = takeFirst(
      await db
        .insert(payouts)
        .values({ currency: 'gbp', reason: null, ...values })
        .returning()
    ).id;
    payoutIds.push(id);
    return id;
  }

  /** The re-pay row a won chargeback writes: a copy of the share, pending. */
  function repayOf(
    share: typeof payouts.$inferInsert,
    values: Partial<typeof payouts.$inferInsert> = {}
  ): Promise<string> {
    return row({
      organizationId: share.organizationId,
      userId: share.userId,
      purchaseId: share.purchaseId,
      transferGroup: share.transferGroup,
      amountCents: share.amountCents,
      payoutType: share.payoutType,
      sourceType: share.sourceType,
      status: 'pending',
      createdAt: REPAID_AT,
      ...values,
    });
  }

  /** The chargeback's done step on a share, paid back by `repaidBy`. */
  async function step(
    payoutId: string,
    disputeId: string,
    values: Partial<typeof payoutReversals.$inferInsert> = {}
  ): Promise<void> {
    await db.insert(payoutReversals).values({
      payoutId,
      causeType: 'dispute',
      causeId: disputeId,
      amountCents: 1440,
      kind: 'transfer_reversal',
      status: 'done',
      stripeReversalId: `trr_late_${crypto.randomUUID().slice(0, 12)}`,
      resolvedAt: new Date('2026-10-26T10:00:00Z'),
      ...values,
    });
  }

  function service(): SubscriptionService {
    return new SubscriptionService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
  }

  /** A reversed £14.40 share of the sale, as a creator's. */
  function reversedShare(
    orgId: string,
    userId: string,
    sale: { purchaseId: string; chargeId: string },
    values: Partial<typeof payouts.$inferInsert> = {}
  ): typeof payouts.$inferInsert {
    return {
      organizationId: orgId,
      userId,
      purchaseId: sale.purchaseId,
      stripeChargeId: sale.chargeId,
      stripeTransferId: `tr_late_${crypto.randomUUID().slice(0, 12)}`,
      transferGroup: `purchase_${sale.purchaseId}`,
      amountCents: 1440,
      payoutType: 'creator_payout',
      sourceType: 'purchase',
      status: 'reversed',
      resolvedAt: new Date('2026-09-03T20:15:00Z'),
      createdAt: new Date('2026-09-03T20:15:00Z'),
      ...values,
    };
  }

  it('Earnings: the pay-back row names the chargeback, and the share it pays back says when (E1)', async () => {
    const orgId = await organisation();
    const maya = await person();
    const sale = await wonLateSale(orgId, maya, 'Winter Light');
    const shareValues = reversedShare(orgId, maya, sale);
    const share = await row(shareValues);
    const repay = await repayOf(shareValues);
    await step(share, sale.disputeId, { repaidByPayoutId: repay });
    const unrelated = await row({
      organizationId: orgId,
      userId: maya,
      amountCents: 899,
      payoutType: 'creator_payout',
      sourceType: 'purchase',
      status: 'paid',
      stripeChargeId: `ch_late_${crypto.randomUUID().slice(0, 12)}`,
      resolvedAt: new Date('2026-12-12T10:00:00Z'),
    });

    const { items } = await service().listPayoutsForCreator(maya, {
      page: 1,
      limit: 50,
    });
    const of = (id: string) => items.find((item) => item.id === id);

    expect(of(repay)).toMatchObject({
      paysBack: {
        causeType: 'dispute',
        title: 'Winter Light',
        wonOn: '2026-12-14',
      },
      paidBack: null,
      cancelledFor: null,
    });
    expect(of(share)).toMatchObject({
      takenBack: { causeType: 'dispute', on: '2026-10-26' },
      paidBack: { on: '2026-12-14' },
      paysBack: null,
      cancelledFor: null,
    });
    expect(of(unrelated)).toMatchObject({
      paysBack: null,
      paidBack: null,
      cancelledFor: null,
    });
  });

  it('Earnings: a share the loss cancelled says when, then that it was paid back (E3)', async () => {
    const orgId = await organisation();
    const jonah = await person();
    const sale = await wonLateSale(orgId, jonah, 'Colour Grading Masterclass');
    const heldValues = reversedShare(orgId, jonah, sale, {
      amountCents: 1980,
      status: 'cancelled_by_dispute',
      reason: 'connect_not_ready',
      stripeTransferId: null,
      resolvedAt: null,
    });
    const held = await row(heldValues);
    const repay = await repayOf(heldValues, { reason: 'connect_not_ready' });
    await step(held, sale.disputeId, {
      amountCents: 1980,
      kind: 'cancellation',
      stripeReversalId: null,
      resolvedAt: new Date('2026-11-21T09:00:00Z'),
      repaidByPayoutId: repay,
    });

    const { items } = await service().listPayoutsForCreator(jonah, {
      page: 1,
      limit: 50,
    });
    const of = (id: string) => items.find((item) => item.id === id);

    expect(of(held)).toMatchObject({
      takenBack: null,
      cancelledFor: { causeType: 'dispute', on: '2026-11-21' },
      paidBack: { on: '2026-12-14' },
    });
    expect(of(repay)?.paysBack).toEqual({
      causeType: 'dispute',
      title: 'Colour Grading Masterclass',
      wonOn: '2026-12-14',
    });
  });

  it('cancelledFor keys on the status only a lost chargeback writes: a share a refund cancelled says nothing of one', async () => {
    const orgId = await organisation();
    const creator = await person();
    const sale = await wonLateSale(orgId, creator, 'Night Ferry');
    // A lost chargeback's cancellation is on it, but a refund cancelled it.
    const refunded = await row(
      reversedShare(orgId, creator, sale, {
        status: 'cancelled_by_refund',
        stripeTransferId: null,
        resolvedAt: null,
      })
    );
    await step(refunded, sale.disputeId, {
      kind: 'cancellation',
      stripeReversalId: null,
      resolvedAt: new Date('2026-11-21T09:00:00Z'),
    });

    const { items } = await service().listPayoutsForCreator(creator, {
      page: 1,
      limit: 50,
    });

    expect(items.find((item) => item.id === refunded)).toMatchObject({
      status: 'cancelled_by_refund',
      cancelledFor: null,
    });
  });

  it('Earnings: a pay-back a refund cancelled before it was paid is not listed, nor counted, and its share was not paid back (E4)', async () => {
    const orgId = await organisation();
    const maya = await person();
    const sale = await wonLateSale(orgId, maya, 'The Making of Hollow Oak');
    const shareValues = reversedShare(orgId, maya, sale, {
      amountCents: 1200,
    });
    const share = await row(shareValues);
    const neverPaid = await repayOf(shareValues, {
      status: 'cancelled_by_refund',
    });
    await step(share, sale.disputeId, {
      amountCents: 1200,
      repaidByPayoutId: neverPaid,
    });
    // A share a refund cancelled is still listed: it is not a pay-back.
    const refundCancelled = await row({
      organizationId: orgId,
      userId: maya,
      amountCents: 500,
      payoutType: 'creator_payout',
      sourceType: 'purchase',
      status: 'cancelled_by_refund',
    });

    const { items, pagination } = await service().listPayoutsForCreator(maya, {
      page: 1,
      limit: 50,
    });

    expect(items.map((item) => item.id).sort()).toEqual(
      [share, refundCancelled].sort()
    );
    expect(pagination.total).toBe(2);
    expect(items.find((item) => item.id === share)?.paidBack).toBeNull();
  });

  it('Org Payouts: the same lines on the organisation’s rows, and the never-paid pay-back left out of the groups (P1)', async () => {
    const orgId = await organisation();
    const hannah = await person();
    const sale = await wonLateSale(orgId, hannah, 'Winter Light');
    const feeValues = reversedShare(orgId, hannah, sale, {
      amountCents: 720,
      payoutType: 'organization_fee',
    });
    const fee = await row(feeValues);
    const paidBack = await repayOf(feeValues, {
      status: 'paid',
      stripeTransferId: `tr_late_${crypto.randomUUID().slice(0, 12)}`,
      resolvedAt: new Date('2026-12-14T17:00:00Z'),
    });
    await step(fee, sale.disputeId, {
      amountCents: 720,
      repaidByPayoutId: paidBack,
    });
    // Another sale's share with no transfer group: its never-paid pay-back
    // would be a group of its own.
    const other = await wonLateSale(orgId, hannah, 'Night Ferry');
    const loneValues = reversedShare(orgId, hannah, other, {
      transferGroup: null,
      purchaseId: null,
    });
    const lone = await row(loneValues);
    const neverPaid = await repayOf(loneValues, {
      status: 'cancelled_by_refund',
    });
    await step(lone, other.disputeId, { repaidByPayoutId: neverPaid });

    const { items, pagination } = await service().listPayoutsByOrg(orgId, {
      page: 1,
      limit: 50,
    });
    const of = (id: string) => items.find((item) => item.id === id);

    expect(of(paidBack)?.paysBack).toEqual({
      causeType: 'dispute',
      title: 'Winter Light',
      wonOn: '2026-12-14',
    });
    expect(of(fee)).toMatchObject({
      paidBack: { on: '2026-12-14' },
      paysBack: null,
    });
    expect(of(lone)?.paidBack).toBeNull();
    expect(of(neverPaid)).toBeUndefined();
    // The sale's group (its share and pay-back) and the lone share.
    expect(pagination.total).toBe(2);
  });

  it('the lines never read another payee’s or organisation’s rows', async () => {
    const orgId = await organisation();
    const maya = await person();
    const hannah = await person();
    const sale = await wonLateSale(orgId, maya, 'Winter Light');
    const theirShareValues = reversedShare(orgId, hannah, sale, {
      amountCents: 720,
      payoutType: 'organization_fee',
    });
    const theirShare = await row(theirShareValues);
    const theirRepay = await repayOf(theirShareValues);
    await step(theirShare, sale.disputeId, {
      amountCents: 720,
      repaidByPayoutId: theirRepay,
    });
    const reader = service() as unknown as {
      disputeLinesFor(
        scope: { userId: string } | { organizationId: string },
        rows: Array<{ id: string; status: string }>
      ): Promise<{
        paysBack: Map<string, unknown>;
        paidBack: Map<string, unknown>;
      }>;
    };
    const theirs = [
      { id: theirShare, status: 'reversed' },
      { id: theirRepay, status: 'pending' },
    ];

    const mine = await reader.disputeLinesFor({ userId: maya }, theirs);
    expect(mine.paysBack.size).toBe(0);
    expect(mine.paidBack.size).toBe(0);
    const anotherOrg = await reader.disputeLinesFor(
      { organizationId: await organisation() },
      theirs
    );
    expect(anotherOrg.paysBack.size).toBe(0);
    expect(anotherOrg.paidBack.size).toBe(0);
    const own = await reader.disputeLinesFor({ userId: hannah }, theirs);
    expect(own.paysBack.size).toBe(1);
    expect(own.paidBack.size).toBe(1);
  });

  it('Org Payouts: a reversed row says when it was taken back and why, refund or chargeback, late win or not (P0, P1)', async () => {
    const orgId = await organisation();
    const hannah = await person();
    const sale = await wonLateSale(orgId, hannah, 'Winter Light');
    const feeValues = reversedShare(orgId, hannah, sale, {
      amountCents: 720,
      payoutType: 'organization_fee',
    });
    const chargedBack = await row(feeValues);
    const repay = await repayOf(feeValues);
    await step(chargedBack, sale.disputeId, {
      amountCents: 720,
      repaidByPayoutId: repay,
    });
    const refunded = await row(
      reversedShare(
        orgId,
        hannah,
        await wonLateSale(orgId, hannah, 'Night Ferry'),
        {
          amountCents: 600,
          payoutType: 'organization_fee',
        }
      )
    );
    await step(refunded, `re_late_${crypto.randomUUID().slice(0, 12)}`, {
      causeType: 'refund',
      amountCents: 600,
      resolvedAt: new Date('2026-10-14T10:00:00Z'),
    });

    const { items } = await service().listPayoutsByOrg(orgId, {
      page: 1,
      limit: 50,
    });
    const of = (id: string) => items.find((item) => item.id === id);

    expect(of(chargedBack)).toMatchObject({
      takenBack: { causeType: 'dispute', on: '2026-10-26' },
      paidBack: { on: '2026-12-14' },
    });
    expect(of(refunded)).toMatchObject({
      takenBack: { causeType: 'refund', on: '2026-10-14' },
      paidBack: null,
    });
    // Only a reversed row has one.
    expect(of(repay)?.takenBack).toBeNull();
  });

  it('the organisation’s take-backs never read another organisation’s rows', async () => {
    const orgId = await organisation();
    const hannah = await person();
    const sale = await wonLateSale(orgId, hannah, 'Winter Light');
    const theirs = await row(
      reversedShare(orgId, hannah, sale, {
        amountCents: 720,
        payoutType: 'organization_fee',
      })
    );
    await step(theirs, sale.disputeId, { amountCents: 720 });
    const reader = service() as unknown as {
      takenBackFor(
        scope: { organizationId: string },
        ids: string[]
      ): Promise<Map<string, unknown>>;
    };

    expect(
      (
        await reader.takenBackFor({ organizationId: await organisation() }, [
          theirs,
        ])
      ).size
    ).toBe(0);
    expect(
      (await reader.takenBackFor({ organizationId: orgId }, [theirs])).size
    ).toBe(1);
  });
});
