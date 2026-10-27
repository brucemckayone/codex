/**
 * The Studio revenue block reads the payouts ledger (Codex-2hxff.20 WEB-02,
 * owner decisions Q1, Q-C, Q-D and S1 of 2026-10-26; data design §2.3).
 *
 * - Every kind counts: one-off and course sales, organisation subscription
 *   and course-plan invoices, each with its per-kind figure.
 * - Each payment counts what the buyer kept: standing refunds and lost
 *   chargebacks come off; Codex's fee and the creators' cut come off by their
 *   share, floor(slice × taken / gross), the clawback's own rounding.
 * - A charge counts once, on the UTC day of its first ledger row.
 * - The day list is one entry per UTC calendar day, oldest first,
 *   zero-filled (Codex-2hxff.75).
 *
 * Every test uses its own organisation; the fixtures delete their rows.
 */

import { organizations, payouts as payoutsTable } from '@codex/database/schema';
import {
  createTestOrganizationInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminAnalyticsService } from '../services/analytics-service';
import { trailingDaysStart } from '../services/analytics-window';
import {
  DAY_MS,
  ledgerFixtures,
  utcDayOf,
} from './helpers/revenue-ledger-fixtures';

describe('AdminAnalyticsService revenue block (payouts ledger)', () => {
  let db: Database;
  let service: AdminAnalyticsService;
  let fixtures: ReturnType<typeof ledgerFixtures>;
  let creatorA: string;
  let creatorB: string;
  let owner: string;
  let buyer: string;
  let secondBuyer: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminAnalyticsService({ db, environment: 'test' });
    fixtures = ledgerFixtures(db);
    [creatorA, creatorB, owner, buyer, secondBuyer] = await seedTestUsers(
      db,
      5
    );
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await teardownTestDatabase();
  });

  async function newOrg(): Promise<string> {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    return org.id;
  }

  /** A £10.00 content sale: fee £1.00, creator £6.00, organisation £3.00. */
  async function contentSale(
    orgId: string,
    opts: { createdAt?: Date; customerId?: string } = {}
  ) {
    const contentId = await fixtures.content(orgId, creatorA);
    const purchaseId = await fixtures.purchase({
      orgId,
      customerId: opts.customerId ?? buyer,
      item: { contentId },
      amountCents: 1000,
      purchasedAt: opts.createdAt,
    });
    const { chargeId } = await fixtures.charge({
      orgId,
      source: { purchaseId },
      createdAt: opts.createdAt,
      slices: [
        { type: 'platform_fee', userId: null, cents: 100 },
        { type: 'creator_payout', userId: creatorA, cents: 600 },
        { type: 'organization_fee', userId: owner, cents: 300 },
      ],
    });
    return { purchaseId, chargeId };
  }

  it('counts every kind, with the fee and the creators on every kind', async () => {
    const orgId = await newOrg();
    await contentSale(orgId);

    // A £50.00 course sale: fee £5.00, creator £45.00.
    const courseId = await fixtures.course(orgId, creatorB);
    const coursePurchase = await fixtures.purchase({
      orgId,
      customerId: buyer,
      item: { courseId },
      amountCents: 5000,
    });
    await fixtures.charge({
      orgId,
      source: { purchaseId: coursePurchase },
      slices: [
        { type: 'platform_fee', userId: null, cents: 500 },
        { type: 'creator_payout', userId: creatorB, cents: 4500 },
      ],
    });

    // A £20.00 subscription invoice: fee £2.00, two creators, organisation.
    const subscriptionId = await fixtures.subscription(orgId, buyer);
    await fixtures.charge({
      orgId,
      source: { subscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 200 },
        { type: 'creator_payout', userId: creatorA, cents: 600 },
        { type: 'creator_payout', userId: creatorB, cents: 400 },
        { type: 'organization_fee', userId: owner, cents: 800 },
      ],
    });

    // A £5.00 course-plan invoice: fee £0.50, creator £4.50.
    const courseSubscriptionId = await fixtures.courseSubscription(
      courseId,
      buyer
    );
    await fixtures.charge({
      orgId,
      source: { courseSubscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 50 },
        { type: 'creator_payout', userId: creatorB, cents: 450 },
      ],
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(8500);
    expect(stats.revenueByKind).toEqual({
      one_off: 1000,
      course: 5000,
      subscription: 2000,
      course_plan: 500,
    });
    expect(stats.platformFeeCents).toBe(850);
    expect(stats.creatorPayoutCents).toBe(6550);
    expect(stats.organizationFeeCents).toBe(1100);
    // Sales only (S1): the two invoices are not purchases.
    expect(stats.totalPurchases).toBe(2);
    expect(stats.averageOrderValueCents).toBe(3000);
  });

  it('counts what the buyer kept: a part refund comes off by its share, a full refund adds nothing', async () => {
    const orgId = await newOrg();

    // 30% refunded: £3.00 of £10.00.
    const part = await contentSale(orgId);
    await fixtures.refund({
      chargeId: part.chargeId,
      cents: 300,
      status: 'succeeded',
      purchaseId: part.purchaseId,
    });

    // A fully refunded invoice.
    const subscriptionId = await fixtures.subscription(orgId, secondBuyer);
    const invoice = await fixtures.charge({
      orgId,
      source: { subscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 200 },
        { type: 'creator_payout', userId: creatorA, cents: 1800 },
      ],
    });
    await fixtures.refund({
      chargeId: invoice.chargeId,
      cents: 2000,
      status: 'succeeded',
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(700);
    expect(stats.revenueByKind.subscription).toBe(0);
    // floor(100 × 300 / 1000) = 30 comes off the fee; 180 off the creator.
    expect(stats.platformFeeCents).toBe(70);
    expect(stats.creatorPayoutCents).toBe(420);
    expect(stats.organizationFeeCents).toBe(210);
    // A part refund is still a purchase; a full refund would not be.
    expect(stats.totalPurchases).toBe(1);
  });

  it('a fully refunded sale is not a purchase', async () => {
    const orgId = await newOrg();
    const sale = await contentSale(orgId);
    await fixtures.refund({
      chargeId: sale.chargeId,
      cents: 1000,
      status: 'succeeded',
      purchaseId: sale.purchaseId,
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.totalPurchases).toBe(0);
    expect(stats.averageOrderValueCents).toBe(0);
  });

  it('a refund still on its way comes off; a failed or cancelled one does not', async () => {
    const orgId = await newOrg();
    const pending = await contentSale(orgId);
    await fixtures.refund({
      chargeId: pending.chargeId,
      cents: 400,
      status: 'pending',
      purchaseId: pending.purchaseId,
    });
    const failed = await contentSale(orgId, { customerId: secondBuyer });
    await fixtures.refund({
      chargeId: failed.chargeId,
      cents: 1000,
      status: 'failed',
      purchaseId: failed.purchaseId,
    });
    await fixtures.refund({
      chargeId: failed.chargeId,
      cents: 500,
      status: 'canceled',
      purchaseId: failed.purchaseId,
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(600 + 1000);
  });

  it('a lost chargeback comes off; an open or won one does not', async () => {
    const orgId = await newOrg();
    const lost = await contentSale(orgId);
    await fixtures.dispute({
      chargeId: lost.chargeId,
      cents: 1000,
      status: 'lost',
    });
    const open = await contentSale(orgId, { customerId: secondBuyer });
    await fixtures.dispute({
      chargeId: open.chargeId,
      cents: 1000,
      status: 'needs_response',
    });
    const won = await contentSale(orgId, { customerId: owner });
    await fixtures.dispute({
      chargeId: won.chargeId,
      cents: 1000,
      status: 'won',
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(2000);
    expect(stats.totalPurchases).toBe(2);
  });

  it('never takes back more than the charge when a refund and a chargeback overlap', async () => {
    const orgId = await newOrg();
    const sale = await contentSale(orgId);
    await fixtures.refund({
      chargeId: sale.chargeId,
      cents: 600,
      status: 'succeeded',
      purchaseId: sale.purchaseId,
    });
    await fixtures.dispute({
      chargeId: sale.chargeId,
      cents: 1000,
      status: 'lost',
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.platformFeeCents).toBe(0);
    expect(stats.creatorPayoutCents).toBe(0);
    expect(stats.organizationFeeCents).toBe(0);
  });

  it("never counts another organisation's charges", async () => {
    const orgId = await newOrg();
    const otherOrg = await newOrg();
    await contentSale(otherOrg);

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.platformFeeCents).toBe(0);
  });

  it('a sale with no ledger rows (a duplicate, or one with no charge) never counts', async () => {
    const orgId = await newOrg();
    const contentId = await fixtures.content(orgId, creatorA);
    await fixtures.purchase({
      orgId,
      customerId: buyer,
      item: { contentId },
      amountCents: 1000,
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.totalPurchases).toBe(0);
  });

  it('a row with no charge id (a re-pay row) is never a sale', async () => {
    const orgId = await newOrg();
    const sale = await contentSale(orgId);
    // What support's re-pay writes: same payee and source, no charge id.
    const [repay] = await db
      .insert(payoutsTable)
      .values({
        organizationId: orgId,
        userId: creatorA,
        purchaseId: sale.purchaseId,
        sourceType: 'purchase',
        amountCents: 600,
        payoutType: 'creator_payout',
        status: 'pending',
        reason: 'connect_not_ready',
      })
      .returning({ id: payoutsTable.id });

    try {
      const stats = await service.getRevenueStats(orgId);
      expect(stats.totalRevenueCents).toBe(1000);
      expect(stats.creatorPayoutCents).toBe(600);
    } finally {
      if (repay) {
        await db.delete(payoutsTable).where(eq(payoutsTable.id, repay.id));
      }
    }
  });

  it('a charge first recorded before the window is left out whole, even with a later slice inside it', async () => {
    const orgId = await newOrg();
    const longAgo = new Date(Date.now() - 45 * DAY_MS);
    const sale = await contentSale(orgId, { createdAt: longAgo });
    // A replay completes a missing slice today on the same charge.
    await fixtures.charge({
      orgId,
      chargeId: sale.chargeId,
      source: { purchaseId: sale.purchaseId },
      slices: [{ type: 'creator_payout', userId: creatorB, cents: 50 }],
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.creatorPayoutCents).toBe(0);
  });

  it('dates a charge by its first row and takes the window as calendar days', async () => {
    const orgId = await newOrg();
    const now = new Date();
    await contentSale(orgId, { createdAt: now });
    await contentSale(orgId, {
      createdAt: new Date(now.getTime() - 3 * DAY_MS),
      customerId: secondBuyer,
    });
    // Outside the default 30 calendar days.
    await contentSale(orgId, {
      createdAt: new Date(trailingDaysStart(30, now).getTime() - 60_000),
      customerId: owner,
    });

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(2000);
    expect(stats.revenueByDay).toHaveLength(30);
    expect(stats.revenueByDay[0]?.date).toBe(
      utcDayOf(trailingDaysStart(30, now))
    );
    // Oldest first; the last entry is today, with today's payment.
    const today = stats.revenueByDay.at(-1);
    expect(today?.date).toBe(utcDayOf(now));
    expect(today?.revenueCents).toBe(1000);
    expect(today?.purchaseCount).toBe(1);
    const threeDaysAgo = stats.revenueByDay.at(-4);
    expect(threeDaysAgo?.date).toBe(
      utcDayOf(new Date(now.getTime() - 3 * DAY_MS))
    );
    expect(threeDaysAgo?.revenueCents).toBe(1000);
    const dates = stats.revenueByDay.map((day) => day.date);
    expect([...dates].sort()).toEqual(dates);
    expect(
      stats.revenueByDay.reduce((sum, day) => sum + day.revenueCents, 0)
    ).toBe(stats.totalRevenueCents);
  });

  it('counts subscription payments in the day list but not in its purchase count', async () => {
    const orgId = await newOrg();
    const subscriptionId = await fixtures.subscription(orgId, buyer);
    await fixtures.charge({
      orgId,
      source: { subscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 100 },
        { type: 'creator_payout_to_owner', userId: owner, cents: 900 },
      ],
    });

    const stats = await service.getRevenueStats(orgId);
    const today = stats.revenueByDay.at(-1);

    expect(today?.revenueCents).toBe(1000);
    expect(today?.purchaseCount).toBe(0);
    // The owner pool is the organisation's money, not a creator's cut.
    expect(stats.creatorPayoutCents).toBe(0);
    expect(stats.organizationFeeCents).toBe(900);
  });

  it('an end date at midnight is read through the end of that day', async () => {
    const orgId = await newOrg();
    const now = new Date();
    await contentSale(orgId, { createdAt: now });
    // What the Analytics page sends: `YYYY-MM-DD`, coerced to midnight UTC.
    const todayMidnight = new Date(`${utcDayOf(now)}T00:00:00.000Z`);
    const weekAgoMidnight = new Date(todayMidnight.getTime() - 6 * DAY_MS);

    const stats = await service.getRevenueStats(orgId, {
      startDate: weekAgoMidnight,
      endDate: todayMidnight,
    });

    expect(stats.totalRevenueCents).toBe(1000);
    expect(stats.revenueByDay).toHaveLength(7);
    expect(stats.revenueByDay.at(-1)?.revenueCents).toBe(1000);
  });

  it('gives an empty organisation one zero day per day of the window', async () => {
    const orgId = await newOrg();

    const stats = await service.getRevenueStats(orgId);

    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.revenueByKind).toEqual({
      one_off: 0,
      course: 0,
      subscription: 0,
      course_plan: 0,
    });
    expect(stats.revenueByDay).toHaveLength(30);
    expect(stats.revenueByDay.every((day) => day.revenueCents === 0)).toBe(
      true
    );
  });

  it('adds a previous block for a comparison window, and only then', async () => {
    const orgId = await newOrg();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);
    await contentSale(orgId, { createdAt: now });
    await contentSale(orgId, {
      createdAt: new Date(fourteenDaysAgo.getTime() + 60_000),
      customerId: secondBuyer,
    });

    const stats = await service.getRevenueStats(orgId, {
      startDate: sevenDaysAgo,
      endDate: now,
      compareFrom: fourteenDaysAgo,
      compareTo: sevenDaysAgo,
    });

    expect(stats.totalRevenueCents).toBe(1000);
    expect(stats.previous?.totalRevenueCents).toBe(1000);
    expect(stats.previous?.revenueByKind.one_off).toBe(1000);
    expect(
      (stats.previous as unknown as { previous?: unknown })?.previous
    ).toBeUndefined();

    const onlyFrom = await service.getRevenueStats(orgId, { compareFrom: now });
    const neither = await service.getRevenueStats(orgId);
    expect(onlyFrom.previous).toBeUndefined();
    expect(neither.previous).toBeUndefined();
  });

  it('a pre-ledger row with no source falls back to its source type, and is logged', async () => {
    const orgId = await newOrg();
    await fixtures.charge({
      orgId,
      source: { legacy: 'subscription' },
      slices: [{ type: 'organization_fee', userId: owner, cents: 700 }],
    });
    const obs = (
      service as unknown as {
        obs: { warn: (message: string, meta?: unknown) => void };
      }
    ).obs;
    const warned = vi.spyOn(obs, 'warn');

    try {
      const stats = await service.getRevenueStats(orgId);
      expect(stats.revenueByKind.subscription).toBe(700);
      expect(warned).toHaveBeenCalledTimes(1);
      expect(warned).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ organizationId: orgId, legacyCharges: 1 })
      );
    } finally {
      warned.mockRestore();
    }
  });
});
