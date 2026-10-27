/**
 * AdminAnalyticsService.getRevenueByCreator real-DB integration tests
 * (Codex-mtv05; reshaped by Codex-zsh2p, owner decisions Q3 and Q-E of
 * 2026-10-26).
 *
 * One row per creator who holds an active agreement, earned a slice in the
 * window, or is still owed money. Earned is their cut of the organisation's
 * charges in the window from the payouts ledger, every kind, sent or not,
 * after refunds. Each share is `none`, `unreadable` or a percentage, never a
 * 0% stand-in. Last payout and Pending are lifetime, in this organisation.
 *
 * Every test uses its own organisation; the fixtures delete their rows.
 */

import {
  agreementProposals,
  creatorOrganizationAgreements,
  organizations,
} from '@codex/database/schema';
import {
  createTestOrganizationInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminAnalyticsService } from '../services/analytics-service';
import { DAY_MS, ledgerFixtures } from './helpers/revenue-ledger-fixtures';

describe('AdminAnalyticsService.getRevenueByCreator (real DB)', () => {
  let db: Database;
  let service: AdminAnalyticsService;
  let fixtures: ReturnType<typeof ledgerFixtures>;
  let customerId: string;
  let ownerId: string;
  const agreementIds: string[] = [];
  const proposalIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminAnalyticsService({ db, environment: 'test' });
    fixtures = ledgerFixtures(db);
    [customerId, ownerId] = await seedTestUsers(db, 2);
  });

  afterAll(async () => {
    await fixtures.cleanup();
    // Left behind, active agreements are met by every later scan of the pool.
    if (agreementIds.length > 0) {
      await db
        .delete(creatorOrganizationAgreements)
        .where(inArray(creatorOrganizationAgreements.id, agreementIds));
    }
    if (proposalIds.length > 0) {
      await db
        .delete(agreementProposals)
        .where(inArray(agreementProposals.id, proposalIds));
    }
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

  /**
   * An active agreement of `revenueType`, its share from an accepted
   * proposal (`shareBps`), or no current proposal at all (`null`). The
   * legacy column is deliberately wrong: it is never read (AGR-08).
   */
  async function agreement(opts: {
    orgId: string;
    creatorId: string;
    revenueType: 'subscription' | 'content_purchase';
    shareBps: number | null;
    status?: 'active' | 'terminated';
  }): Promise<string> {
    let currentProposalId: string | null = null;
    if (opts.shareBps !== null) {
      const proposal = takeFirst(
        await db
          .insert(agreementProposals)
          .values({
            organizationId: opts.orgId,
            creatorId: opts.creatorId,
            revenueType: opts.revenueType,
            roundNumber: 1,
            proposedByUserId: opts.creatorId,
            proposedByRole: 'owner',
            proposedCreatorSharePercent: opts.shareBps,
            proposedEffectiveFrom: new Date(),
            status: 'accepted',
          })
          .returning()
      );
      proposalIds.push(proposal.id);
      currentProposalId = proposal.id;
    }
    const terminated = opts.status === 'terminated';
    const row = takeFirst(
      await db
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId: opts.creatorId,
          organizationId: opts.orgId,
          organizationFeePercentage: 1234,
          revenueType: opts.revenueType,
          currentProposalId,
          ...(terminated
            ? { status: 'terminated', terminatedAt: new Date() }
            : {}),
        })
        .returning()
    );
    agreementIds.push(row.id);
    return row.id;
  }

  /** A content sale whose creator slice is `creatorCents` of `grossCents`. */
  async function contentSale(opts: {
    orgId: string;
    creatorId: string;
    grossCents: number;
    creatorCents: number;
    createdAt?: Date;
    creatorStatus?: 'paid' | 'pending' | 'failed';
  }) {
    const contentId = await fixtures.content(opts.orgId, opts.creatorId);
    const purchaseId = await fixtures.purchase({
      orgId: opts.orgId,
      customerId,
      item: { contentId },
      amountCents: opts.grossCents,
      purchasedAt: opts.createdAt,
    });
    const fee = Math.round(opts.grossCents / 10);
    const org = opts.grossCents - fee - opts.creatorCents;
    const { chargeId, payoutIds } = await fixtures.charge({
      orgId: opts.orgId,
      source: { purchaseId },
      createdAt: opts.createdAt,
      slices: [
        { type: 'platform_fee', userId: null, cents: fee },
        {
          type: 'creator_payout',
          userId: opts.creatorId,
          cents: opts.creatorCents,
          status: opts.creatorStatus,
        },
        ...(org > 0
          ? [{ type: 'organization_fee' as const, userId: ownerId, cents: org }]
          : []),
      ],
    });
    // The creator slice is the second row written.
    return { purchaseId, chargeId, creatorPayoutId: payoutIds[1] };
  }

  it('returns empty for an org with no agreements, earnings or money owed', async () => {
    const orgId = await newOrg();

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('lists a creator with both kinds of agreement once, with both shares', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    await agreement({
      orgId,
      creatorId,
      revenueType: 'subscription',
      shareBps: 3000,
    });
    await agreement({
      orgId,
      creatorId,
      revenueType: 'content_purchase',
      shareBps: 2000,
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      creatorId,
      subscriptionShare: { kind: 'share', percent: 30 },
      salesShare: { kind: 'share', percent: 20 },
      earnedCents: 0,
    });
  });

  it('Earned is their cut of every kind: sales, courses, subscriptions and course plans', async () => {
    const orgId = await newOrg();
    const [creatorId, otherCreator] = await seedTestUsers(db, 2);

    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 600,
    });

    const courseId = await fixtures.course(orgId, creatorId);
    const coursePurchase = await fixtures.purchase({
      orgId,
      customerId,
      item: { courseId },
      amountCents: 5000,
    });
    await fixtures.charge({
      orgId,
      source: { purchaseId: coursePurchase },
      slices: [
        { type: 'platform_fee', userId: null, cents: 500 },
        { type: 'creator_payout', userId: creatorId, cents: 4500 },
      ],
    });

    const subscriptionId = await fixtures.subscription(orgId, customerId);
    await fixtures.charge({
      orgId,
      source: { subscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 200 },
        { type: 'creator_payout', userId: creatorId, cents: 600 },
        { type: 'creator_payout', userId: otherCreator, cents: 400 },
        { type: 'organization_fee', userId: ownerId, cents: 800 },
      ],
    });

    const courseSubscriptionId = await fixtures.courseSubscription(
      courseId,
      customerId
    );
    await fixtures.charge({
      orgId,
      source: { courseSubscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 50 },
        { type: 'creator_payout', userId: creatorId, cents: 450 },
      ],
    });

    const result = await service.getRevenueByCreator(orgId);
    const revenue = await service.getRevenueStats(orgId);

    expect(result.items.map((item) => item.creatorId)).toEqual([
      creatorId,
      otherCreator,
    ]);
    expect(result.items[0]?.earnedCents).toBe(600 + 4500 + 600 + 450);
    expect(result.items[1]?.earnedCents).toBe(400);
    // The same read as Billing's "owed to creators": they add up to it.
    expect(result.items.reduce((sum, item) => sum + item.earnedCents, 0)).toBe(
      revenue.creatorPayoutCents
    );
  });

  it('lists a creator who earned with no agreement, with "none" for both shares', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 900,
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      creatorId,
      earnedCents: 900,
      subscriptionShare: { kind: 'none' },
      salesShare: { kind: 'none' },
    });
  });

  it('an agreement with no current proposal is "unreadable", never 0%, and is logged', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    const orphan = await agreement({
      orgId,
      creatorId,
      revenueType: 'subscription',
      shareBps: null,
    });
    const obs = (
      service as unknown as {
        obs: { error: (message: string, meta?: unknown) => void };
      }
    ).obs;
    const logged = vi.spyOn(obs, 'error');

    try {
      const result = await service.getRevenueByCreator(orgId);

      expect(result.items[0]?.subscriptionShare).toEqual({
        kind: 'unreadable',
      });
      expect(result.items[0]?.salesShare).toEqual({ kind: 'none' });
      expect(logged).toHaveBeenCalledWith(
        'agreement has no current proposal; it pays nothing',
        expect.objectContaining({
          errorId: expect.any(String),
          agreementId: orphan,
        })
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('a refund lowers Earned by the creator slice’s share', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    const sale = await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 600,
    });
    await fixtures.refund({
      chargeId: sale.chargeId,
      cents: 250,
      status: 'succeeded',
      purchaseId: sale.purchaseId,
    });

    const result = await service.getRevenueByCreator(orgId);

    // 600 − floor(600 × 250 / 1000) = 450
    expect(result.items[0]?.earnedCents).toBe(450);
  });

  it("the owner pool is the organisation's money, not anyone's Earned", async () => {
    const orgId = await newOrg();
    const subscriptionId = await fixtures.subscription(orgId, customerId);
    await fixtures.charge({
      orgId,
      source: { subscriptionId },
      slices: [
        { type: 'platform_fee', userId: null, cents: 100 },
        { type: 'creator_payout_to_owner', userId: ownerId, cents: 900 },
      ],
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toEqual([]);
  });

  it('keeps an agreement past its review date and drops a terminated one', async () => {
    const orgId = await newOrg();
    const [reviewDue, terminated] = await seedTestUsers(db, 2);
    const reviewAgreement = await agreement({
      orgId,
      creatorId: reviewDue,
      revenueType: 'subscription',
      shareBps: 5000,
    });
    // A review date, not an expiry: the agreement keeps paying (AGR-01).
    await db
      .update(creatorOrganizationAgreements)
      .set({ effectiveUntil: new Date(Date.now() - DAY_MS) })
      .where(inArray(creatorOrganizationAgreements.id, [reviewAgreement]));
    await agreement({
      orgId,
      creatorId: terminated,
      revenueType: 'subscription',
      shareBps: 5000,
      status: 'terminated',
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items.map((item) => item.creatorId)).toEqual([reviewDue]);
  });

  it('Last payout is their latest paid creator slice in this organisation', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    const older = new Date(Date.now() - 50 * DAY_MS);
    const newer = new Date(Date.now() - 40 * DAY_MS);
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 500,
      createdAt: older,
    });
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 700,
      createdAt: newer,
    });
    // Paid to them later, but as the organisation's slice: not a creator
    // payout, so not their Last payout.
    const subscriptionId = await fixtures.subscription(orgId, customerId);
    await fixtures.charge({
      orgId,
      source: { subscriptionId },
      createdAt: new Date(Date.now() - 35 * DAY_MS),
      slices: [{ type: 'organization_fee', userId: creatorId, cents: 900 }],
    });
    // Both sales are older than the 30-day window, so the agreement is what
    // lists them.
    await agreement({
      orgId,
      creatorId,
      revenueType: 'content_purchase',
      shareBps: 5000,
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.earnedCents).toBe(0);
    expect(new Date(result.items[0]?.lastPayoutAt ?? '').toISOString()).toBe(
      newer.toISOString()
    );
  });

  it('Pending is what the drains will send: pending and failed rows, less partial refunds', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    const pending = await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 600,
      creatorStatus: 'pending',
    });
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 500,
      creatorStatus: 'failed',
    });
    // Sent already: not pending.
    await contentSale({
      orgId,
      creatorId,
      grossCents: 10000,
      creatorCents: 9000,
    });
    // A partial refund already took 150 off the unpaid 600.
    if (!pending.creatorPayoutId) throw new Error('no creator slice');
    await fixtures.pendingReduction(pending.creatorPayoutId, 150);

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items[0]?.pendingPayoutCents).toBe(450 + 500);
  });

  it('lists a creator still owed money from before the window', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 600,
      creatorStatus: 'pending',
      createdAt: new Date(Date.now() - 90 * DAY_MS),
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      creatorId,
      earnedCents: 0,
      pendingPayoutCents: 600,
    });
  });

  it("never counts another organisation's earnings or money owed", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    await agreement({
      orgId: orgA,
      creatorId,
      revenueType: 'subscription',
      shareBps: 3000,
    });
    await contentSale({
      orgId: orgB,
      creatorId,
      grossCents: 1000,
      creatorCents: 900,
    });
    await contentSale({
      orgId: orgB,
      creatorId,
      grossCents: 1000,
      creatorCents: 800,
      creatorStatus: 'pending',
    });

    const result = await service.getRevenueByCreator(orgA);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      creatorId,
      earnedCents: 0,
      pendingPayoutCents: 0,
      lastPayoutAt: null,
    });
  });

  it('respects the window: Earned counts only charges first recorded in it', async () => {
    const orgId = await newOrg();
    const [creatorId] = await seedTestUsers(db, 1);
    const now = new Date();
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 900,
      createdAt: now,
    });
    await contentSale({
      orgId,
      creatorId,
      grossCents: 1000,
      creatorCents: 800,
      createdAt: new Date(now.getTime() - 10 * DAY_MS),
    });

    const result = await service.getRevenueByCreator(orgId, {
      startDate: new Date(now.getTime() - DAY_MS),
      endDate: now,
    });

    expect(result.items[0]?.earnedCents).toBe(900);
  });

  it('sorts by Earned, highest first', async () => {
    const orgId = await newOrg();
    const [low, high] = await seedTestUsers(db, 2);
    await contentSale({
      orgId,
      creatorId: low,
      grossCents: 1000,
      creatorCents: 100,
    });
    await contentSale({
      orgId,
      creatorId: high,
      grossCents: 1000,
      creatorCents: 800,
    });

    const result = await service.getRevenueByCreator(orgId);

    expect(result.items.map((item) => item.creatorId)).toEqual([high, low]);
  });
});
