/**
 * Pending money is released per PAYEE, not per organisation (Codex-2hxff.13),
 * and a payout waiting for support stays owed (Codex-2hxff.48).
 *
 * The rules under test (docs/payments/connect-and-payouts.md, "Releasing
 * pending money"):
 *   - one drain pays every row a payee is owed: each organisation's and the
 *     orgless ones, each group at its own organisation's fees, with ONE email;
 *   - the hourly sweep claims a bounded batch of payees in one UPDATE, so
 *     overlapping runs take different payees, and stamps `attempted_at`, so a
 *     payee not ready yet goes to the back;
 *   - a row flagged for support is skipped by the drain but still counted as
 *     owed by earnings;
 *   - an organisation subscription invoice records the creator agreement it
 *     split by on the creator's slice (Codex-2hxff.19).
 *
 * The sweep is GLOBAL. Its rows here are dated 1980, and each sweep is told to
 * take only rows older than 1990, so it can never claim another suite's or
 * another session's rows on the shared database.
 */

import {
  agreementProposals,
  creatorOrganizationAgreements,
  organizations,
  payouts,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import type { FeeConfig, FeeConfigService } from '@codex/purchase';
import {
  createMockStripe,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
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
import { SubscriptionService } from '../subscription-service';

/** Only rows dated before this are ever swept here. */
const SWEEP_HORIZON = new Date('1990-01-01T00:00:00Z');
const minutesSinceHorizon = () =>
  Math.ceil((Date.now() - SWEEP_HORIZON.getTime()) / 60_000);
const ancient = (day: number) => new Date(Date.UTC(1980, 0, day, 0, 0, 0));

function fees(minTransferCents: number): FeeConfig {
  return {
    platformFeePercent: 1000,
    orgFeePercent: 1500,
    minPlatformFeeCents: 0,
    minTransferCents,
  };
}

describe('payee-wide payout drain', () => {
  let db: Database;
  let stripe: Stripe;
  let payeeId: string;
  let subscriberId: string;
  const sweepPayees: string[] = [];
  const orgIds: string[] = [];
  const tierIds: string[] = [];
  const subscriptionIds: string[] = [];
  const agreementIds: string[] = [];
  const proposalIds: string[] = [];
  const userIds: string[] = [];
  const payeeAccount = `acct_payee_${crypto.randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    db = setupTestDatabase();
    const seeded = await seedTestUsers(db, 5);
    const [payee, subscriber, ...rest] = seeded;
    if (!payee || !subscriber || rest.length !== 3) {
      throw new Error('seed failed');
    }
    payeeId = payee;
    subscriberId = subscriber;
    sweepPayees.push(...rest);
    userIds.push(...seeded);
    await db.insert(stripeConnectAccounts).values({
      userId: payeeId,
      stripeAccountId: payeeAccount,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    for (const [index, userId] of sweepPayees.entries()) {
      await db.insert(stripeConnectAccounts).values({
        userId,
        stripeAccountId: `acct_sweep_${index}_${crypto.randomUUID().slice(0, 8)}`,
        status: 'restricted',
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    }
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  // Every row this file wrote goes; the sweep must never see them again.
  afterAll(async () => {
    await db.delete(payouts).where(inArray(payouts.userId, userIds));
    if (orgIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.organizationId, orgIds));
    }
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
    if (subscriptionIds.length > 0) {
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.id, subscriptionIds));
    }
    if (tierIds.length > 0) {
      await db
        .delete(subscriptionTiers)
        .where(inArray(subscriptionTiers.id, tierIds));
    }
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, userIds));
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await teardownTestDatabase();
  });

  async function newOrg(label: string): Promise<string> {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput({ slug: createUniqueSlug(label) }))
        .returning(),
      'organization'
    );
    orgIds.push(org.id);
    return org.id;
  }

  /** A pending creator slice owed to `userId`, waiting for their account. */
  async function owed(
    userId: string,
    organizationId: string | null,
    amountCents: number,
    overrides: Partial<typeof payouts.$inferInsert> = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          userId,
          organizationId,
          sourceType: 'subscription',
          amountCents,
          currency: 'gbp',
          payoutType: 'creator_payout',
          status: 'pending',
          reason: 'connect_not_ready',
          stripeChargeId: `ch_drain_${crypto.randomUUID().slice(0, 12)}`,
          ...overrides,
        })
        .returning(),
      'payout'
    );
    return row.id;
  }

  async function rowsOf(ids: string[]) {
    return db.select().from(payouts).where(inArray(payouts.id, ids));
  }

  /** A FeeConfigService whose minimum transfer is set per organisation. */
  function feeConfigByOrg(floors: Map<string | null, number>) {
    const getFeesForCreator = vi.fn(
      async (orgId: string, _creatorId: string, _ctx: string) =>
        fees(floors.get(orgId) ?? 0)
    );
    const getFeesPlatform = vi.fn(async (_ctx: string) =>
      fees(floors.get(null) ?? 0)
    );
    const feeConfig = {
      getFeesForCreator,
      getFeesPlatform,
      getFeesForOrg: vi.fn(async () => fees(0)),
    } as unknown as FeeConfigService;
    return { feeConfig, getFeesForCreator, getFeesPlatform };
  }

  function serviceWith(feeConfig?: FeeConfigService) {
    const payoutMailer = vi.fn();
    const service = new SubscriptionService(
      { db, environment: 'test', payoutMailer, feeConfig },
      stripe
    );
    return { service, payoutMailer };
  }

  it('pays every row the payee is owed, in every organisation and orgless, each group at its own fees, with one email', async () => {
    const orgA = await newOrg('drain-a');
    const orgB = await newOrg('drain-b');
    const ids = [
      await owed(payeeId, orgA, 500),
      await owed(payeeId, orgA, 300, { sourceType: 'purchase' }),
      await owed(payeeId, orgB, 400),
      await owed(payeeId, null, 200),
    ];
    const { feeConfig, getFeesForCreator, getFeesPlatform } = feeConfigByOrg(
      new Map()
    );
    const { service, payoutMailer } = serviceWith(feeConfig);

    const result = await service.resolvePendingPayoutsForAccount(payeeAccount);

    expect(result).toEqual({ resolved: 4, failed: 0 });
    const rows = await rowsOf(ids);
    expect(rows.map((r) => r.status)).toEqual(['paid', 'paid', 'paid', 'paid']);
    // One fee lookup per (organisation, source): never one org's for another.
    expect(
      getFeesForCreator.mock.calls.map(([o, , ctx]) => `${o}:${ctx}`)
    ).toEqual(
      expect.arrayContaining([
        `${orgA}:subscription`,
        `${orgA}:one_off`,
        `${orgB}:subscription`,
      ])
    );
    expect(getFeesForCreator).toHaveBeenCalledTimes(3);
    expect(getFeesPlatform).toHaveBeenCalledOnce();
    // ONE email for the whole payee, from what was paid.
    expect(payoutMailer).toHaveBeenCalledOnce();
    const [email] = payoutMailer.mock.calls[0] ?? [];
    expect(email).toMatchObject({
      templateName: 'payout-released',
      userId: payeeId,
      // The slices span organisations: the email names none.
      organizationId: null,
      data: { payoutCount: 4, amountFormatted: '£14.00' },
    });
  });

  it("a group waits on its own organisation's minimum transfer, not another's", async () => {
    const orgA = await newOrg('floor-a');
    const orgB = await newOrg('floor-b');
    const paidId = await owed(payeeId, orgA, 500);
    const heldId = await owed(payeeId, orgB, 400);
    const { feeConfig } = feeConfigByOrg(
      new Map([
        [orgA, 100],
        [orgB, 1000],
      ])
    );
    const { service, payoutMailer } = serviceWith(feeConfig);

    const result = await service.resolvePendingPayoutsForAccount(payeeAccount);

    expect(result).toEqual({ resolved: 1, failed: 0 });
    const rows = new Map(
      (await rowsOf([paidId, heldId])).map((r) => [r.id, r])
    );
    expect(rows.get(paidId)?.status).toBe('paid');
    expect(rows.get(heldId)?.status).toBe('pending');
    expect(payoutMailer).toHaveBeenCalledOnce();
    expect(payoutMailer.mock.calls[0]?.[0]).toMatchObject({
      organizationId: orgA,
      data: { payoutCount: 1, amountFormatted: '£5.00' },
    });
    // Leave nothing for the next test's drain.
    await db.delete(payouts).where(eq(payouts.id, heldId));
  });

  it('skips a row waiting for support, which earnings still count as owed', async () => {
    const orgA = await newOrg('flagged');
    const flaggedId = await owed(payeeId, orgA, 700, {
      status: 'failed',
      reason: 'transfer_failed',
      lastRetryAt: new Date(Date.now() - 60 * 60_000),
      failureCount: 5,
      lastErrorCode: 'amount_too_large',
      lastErrorType: 'StripeInvalidRequestError',
      needsReviewAt: new Date(),
    });
    const { service } = serviceWith();
    const transfers = vi.mocked(stripe.transfers.create);

    const result = await service.resolvePendingPayoutsForAccount(payeeAccount);

    expect(result).toEqual({ resolved: 0, failed: 0 });
    expect(transfers).not.toHaveBeenCalled();
    const [row] = await rowsOf([flaggedId]);
    expect(row?.status).toBe('failed');
    const earnings = await service.getEarningsSummaryForCreator(payeeId);
    expect(earnings.needsAttentionCount).toBe(1);
    await db.delete(payouts).where(eq(payouts.id, flaggedId));
  });

  it('an organisation subscription invoice records the agreement on the creator slice, and none on the owner pool', async () => {
    const withAgreement = await newOrg('q3-agreement');
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(withAgreement))
        .returning(),
      'tier'
    );
    tierIds.push(tier.id);
    const sub = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriberId, withAgreement, tier.id)
        )
        .returning(),
      'subscription'
    );
    subscriptionIds.push(sub.id);
    const since = new Date(Date.now() - 60 * 60_000);
    const proposal = takeFirst(
      await db
        .insert(agreementProposals)
        .values({
          organizationId: withAgreement,
          creatorId: payeeId,
          revenueType: 'subscription',
          roundNumber: 1,
          proposedByUserId: payeeId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: 5000,
          proposedTermMonths: null,
          proposedEffectiveFrom: since,
          status: 'accepted',
          respondedAt: since,
          respondedByUserId: payeeId,
        })
        .returning(),
      'proposal'
    );
    proposalIds.push(proposal.id);
    const agreement = takeFirst(
      await db
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId: payeeId,
          organizationId: withAgreement,
          organizationFeePercentage: 5000,
          revenueType: 'subscription',
          status: 'active',
          currentProposalId: proposal.id,
          effectiveFrom: since,
        })
        .returning(),
      'agreement'
    );
    agreementIds.push(agreement.id);
    const { service } = serviceWith();
    const executeTransfers = (
      service as unknown as {
        executeTransfers(
          subscriptionId: string,
          orgId: string,
          chargeId: string,
          platformFeeCents: number,
          orgFeeCents: number,
          creatorPayoutCents: number,
          invoiceCreatedAt: Date
        ): Promise<void>;
      }
    ).executeTransfers.bind(service);

    const agreedCharge = `ch_q3_${crypto.randomUUID().slice(0, 12)}`;
    await executeTransfers(
      sub.id,
      withAgreement,
      agreedCharge,
      100,
      300,
      600,
      new Date()
    );

    const agreed = await db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, agreedCharge));
    const creatorSlice = agreed.find((r) => r.payoutType === 'creator_payout');
    expect(creatorSlice?.creatorOrgAgreementId).toBe(agreement.id);
    expect(
      agreed
        .filter((r) => r.payoutType !== 'creator_payout')
        .map((r) => r.creatorOrgAgreementId)
    ).toEqual(
      agreed.filter((r) => r.payoutType !== 'creator_payout').map(() => null)
    );

    // No agreement in force: the owner pool is recorded with none.
    const noAgreement = await newOrg('q3-none');
    const bareCharge = `ch_q3_${crypto.randomUUID().slice(0, 12)}`;
    await executeTransfers(
      sub.id,
      noAgreement,
      bareCharge,
      100,
      300,
      600,
      new Date()
    );
    const bare = await db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, bareCharge));
    expect(bare.some((r) => r.payoutType === 'creator_payout_to_owner')).toBe(
      true
    );
    expect(bare.every((r) => r.creatorOrgAgreementId === null)).toBe(true);
  });

  describe('the hourly sweep', () => {
    function stubAccounts(ready: boolean) {
      const retrieve = vi.fn(async (id: string) => ({
        id,
        charges_enabled: ready,
        payouts_enabled: ready,
      }));
      (stripe as unknown as { accounts: Record<string, unknown> }).accounts = {
        ...(stripe as unknown as { accounts: Record<string, unknown> })
          .accounts,
        retrieve,
      };
      return retrieve;
    }

    /** One ancient pending row per sweep payee, oldest first. */
    async function seedQueue(): Promise<string[]> {
      const ids: string[] = [];
      for (const [index, userId] of sweepPayees.entries()) {
        ids.push(
          await owed(userId, null, 300, { attemptedAt: ancient(index + 1) })
        );
      }
      return ids;
    }

    async function clearQueue() {
      await db.delete(payouts).where(inArray(payouts.userId, sweepPayees));
    }

    it('claims no more payees than the limit, oldest first, and stamps attempted_at on them', async () => {
      const ids = await seedQueue();
      const retrieve = stubAccounts(false);
      const { service } = serviceWith();
      const before = new Date();

      const result = await service.sweepUnresolvedPayouts(
        minutesSinceHorizon(),
        2
      );

      expect(result).toEqual({
        groupsScanned: 2,
        groupsResolved: 0,
        groupsSkipped: 2,
        errors: 0,
      });
      expect(retrieve).toHaveBeenCalledTimes(2);
      const rows = new Map((await rowsOf(ids)).map((r) => [r.userId, r]));
      // The two oldest were checked: they move to the back of the queue.
      for (const userId of sweepPayees.slice(0, 2)) {
        expect(rows.get(userId)?.attemptedAt.getTime()).toBeGreaterThanOrEqual(
          before.getTime() - 1000
        );
        expect(rows.get(userId)?.status).toBe('pending');
      }
      // The third waits its turn, untouched.
      expect(rows.get(sweepPayees[2] ?? null)?.attemptedAt.toISOString()).toBe(
        ancient(3).toISOString()
      );
      await clearQueue();
    });

    it('a second run takes the payees the first did not: not-ready payees go to the back', async () => {
      await seedQueue();
      const retrieve = stubAccounts(false);
      const { service } = serviceWith();

      await service.sweepUnresolvedPayouts(minutesSinceHorizon(), 2);
      const second = await service.sweepUnresolvedPayouts(
        minutesSinceHorizon(),
        2
      );

      expect(second.groupsScanned).toBe(1);
      const checked = retrieve.mock.calls.map(([id]) => id);
      expect(new Set(checked).size).toBe(3);
      expect(checked).toHaveLength(3);
      await clearQueue();
    });

    it('two overlapping runs claim disjoint payees', async () => {
      await seedQueue();
      const retrieve = stubAccounts(false);
      const { service } = serviceWith();

      const [first, second] = await Promise.all([
        service.sweepUnresolvedPayouts(minutesSinceHorizon(), 3),
        service.sweepUnresolvedPayouts(minutesSinceHorizon(), 3),
      ]);

      // Every payee was checked by exactly one of them.
      expect(first.groupsScanned + second.groupsScanned).toBe(3);
      const checked = retrieve.mock.calls.map(([id]) => id);
      expect(checked).toHaveLength(3);
      expect(new Set(checked).size).toBe(3);
      await clearQueue();
    });

    it('a run skips the rows another run holds, without waiting for it', async () => {
      const [heldId] = await seedQueue();
      if (!heldId) throw new Error('queue not seeded');
      const retrieve = stubAccounts(false);
      const { service } = serviceWith();

      // Another run, mid-claim: it holds the oldest payee's row.
      await db.transaction(async (tx) => {
        await tx
          .select({ id: payouts.id })
          .from(payouts)
          .where(eq(payouts.id, heldId))
          .for('update');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const blocked = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('the sweep waited on a lock')),
            5000
          );
        });

        try {
          const result = await Promise.race([
            service.sweepUnresolvedPayouts(minutesSinceHorizon(), 3),
            blocked,
          ]);
          expect(result.groupsScanned).toBe(2);
        } finally {
          clearTimeout(timer);
        }
      });
      const checked = retrieve.mock.calls.map(([id]) => id);
      expect(checked).toHaveLength(2);
      await clearQueue();
    });

    it('drains a claimed payee who is payable now, across organisations', async () => {
      const orgA = await newOrg('sweep-a');
      const ids = [
        await owed(sweepPayees[0] ?? '', orgA, 400, {
          attemptedAt: ancient(1),
        }),
        await owed(sweepPayees[0] ?? '', null, 200, {
          attemptedAt: ancient(1),
        }),
      ];
      stubAccounts(true);
      const { service, payoutMailer } = serviceWith();

      const result = await service.sweepUnresolvedPayouts(
        minutesSinceHorizon(),
        5
      );

      expect(result).toMatchObject({ groupsScanned: 1, groupsResolved: 1 });
      expect((await rowsOf(ids)).map((r) => r.status)).toEqual([
        'paid',
        'paid',
      ]);
      expect(payoutMailer).toHaveBeenCalledOnce();
      await clearQueue();
    });
  });
});
