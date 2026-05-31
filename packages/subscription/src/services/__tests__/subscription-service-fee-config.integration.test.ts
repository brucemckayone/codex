/**
 * SubscriptionService × FeeConfigService integration tests (Codex-m644n PR #182).
 *
 * Covers the call-site contract for the subscription path:
 *
 *   1. resolvePendingPayouts() consults FeeConfigService.getFeesForCreator()
 *      with the per-creator override path, and SKIPS the Stripe transfer when
 *      the row's amountCents is below `minTransferCents`. The row stays
 *      unresolved (resolvedAt null) and no transfer fires.
 *   2. Raising the row's amountCents (or lowering the floor) on a subsequent
 *      call causes the transfer to fire.
 *   3. Without a feeConfig injected, the legacy FEES.* fallback path still
 *      works (regression guard).
 *
 * Real DB, mocked Stripe — same shape as the parent subscription-service
 * integration suite.
 */

import {
  organizations,
  payouts as payoutsTable,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
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
import type { FeeConfigService } from '../fee-config-service';
import { SubscriptionService } from '../subscription-service';

interface FeeConfigShape {
  platformFeePercent: number;
  orgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
}

function makeFeeConfigStub(
  feesByCreator: Record<string, FeeConfigShape>,
  orgFees: FeeConfigShape
) {
  return {
    getFeesForCreator: vi.fn(
      async (_orgId: string, creatorId: string, _ctx: string) =>
        feesByCreator[creatorId] ?? orgFees
    ),
    getFeesForOrg: vi.fn(async () => orgFees),
    getFeesPlatform: vi.fn(async () => orgFees),
  } as unknown as FeeConfigService;
}

// The partial unique index uq_payouts_stripe_transfer_id rejects rows
// sharing a stripeTransferId, so mocks that resolve many transfers in
// one test must hand out distinct IDs per call.
function makeUniqueTransferIdMock(prefix: string) {
  let idx = 0;
  return () =>
    Promise.resolve({ id: `${prefix}_${idx++}` }) as ReturnType<
      typeof stripe.transfers.create
    >;
}

describe('SubscriptionService × FeeConfigService — pending payouts', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let creatorId: string;
  let payoutUserId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const [a, b] = await seedTestUsers(db, 2);
    creatorId = a;
    payoutUserId = b;
  });

  beforeEach(async () => {
    // One Connect account per user (uq_stripe_connect_user, Codex-69t7c):
    // clear seed users' accounts between tests to avoid collisions.
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [creatorId, payoutUserId]));
    stripe = createMockStripe();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function seed(label: string) {
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({
          slug: createUniqueSlug(label),
          creatorId,
        })
      )
      .returning();

    const stripeAccountId = `acct_fc_${createUniqueSlug('a')}`;
    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(org.id, payoutUserId, {
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
        stripeAccountId,
      })
    );
    // Pin the org's canonical Connect account (Codex-69t7c): org→account
    // resolves via primaryConnectAccountUserId to the payout user's account.
    await db
      .update(organizations)
      .set({ primaryConnectAccountUserId: payoutUserId })
      .where(eq(organizations.id, org.id));

    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(org.id, { name: `T-${label}` }))
      .returning();

    const [sub] = await db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(payoutUserId, org.id, tier.id, {
          status: 'active',
          stripeSubscriptionId: `sub_fc_${createUniqueSlug('s')}`,
        })
      )
      .returning();

    return { org, sub, stripeAccountId };
  }

  it('skips transfer when row amountCents < minTransferCents (per-creator override)', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-floor-skip');

    // The connect account belongs to payoutUserId. We set THAT user's
    // min-transfer floor high so the small payout is held back.
    const feeConfig = makeFeeConfigStub(
      {
        [payoutUserId]: {
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 100,
        },
      },
      {
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      }
    );
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    // Seed one payout BELOW the floor.
    const [row] = await db
      .insert(payoutsTable)
      .values({
        userId: payoutUserId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 50,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      })
      .returning();

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);

    // No transfer fired; row remains unresolved.
    expect(transferSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ resolved: 0, failed: 0 });

    const [reread] = await db
      .select()
      .from(payoutsTable)
      .where(eq(payoutsTable.id, row.id))
      .limit(1);
    expect(reread.resolvedAt).toBeNull();
    expect(reread.stripeTransferId).toBeNull();
  });

  it('fires the transfer on a second pass after the row clears the floor', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-floor-clear');

    // First pass: floor=100, amount=50 → skip. Second pass: amount=150 → fire.
    let currentFloor = 100;
    const feeConfig = {
      getFeesForCreator: vi.fn(async () => ({
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: currentFloor,
      })),
      getFeesForOrg: vi.fn(async () => ({
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      })),
      getFeesPlatform: vi.fn(),
    } as unknown as FeeConfigService;

    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    const [row] = await db
      .insert(payoutsTable)
      .values({
        userId: payoutUserId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 50,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      })
      .returning();

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();
    transferSpy.mockResolvedValue({ id: 'tr_fc_clear' } as Stripe.Transfer);

    // First pass — skipped.
    let result = await service.resolvePendingPayouts(org.id, stripeAccountId);
    expect(result.resolved).toBe(0);
    expect(transferSpy).not.toHaveBeenCalled();

    // Drop the floor below the amount and retry — the same row now clears.
    currentFloor = 10;
    result = await service.resolvePendingPayouts(org.id, stripeAccountId);
    expect(result.resolved).toBe(1);
    expect(transferSpy).toHaveBeenCalledTimes(1);

    const [reread] = await db
      .select()
      .from(payoutsTable)
      .where(eq(payoutsTable.id, row.id))
      .limit(1);
    expect(reread.resolvedAt).not.toBeNull();
    expect(reread.stripeTransferId).toBe('tr_fc_clear');
  });

  // Codex-iivne: pre-fix this test pinned per-row floor gating: small=50
  // would skip while large=500 fires. Post-fix the floor evaluates against
  // the GROUP SUM, so 50+500=550 clears the floor=100 and BOTH rows fire.
  // The new behaviour is the desired one — small rows would otherwise pile
  // up indefinitely behind the per-row floor.
  it('two payouts, one below floor and one above — group SUM clears floor so BOTH fire (Codex-iivne)', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-floor-mixed');

    const feeConfig = makeFeeConfigStub(
      {
        [payoutUserId]: {
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 100,
        },
      },
      {
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      }
    );
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    const inserted = await db
      .insert(payoutsTable)
      .values([
        {
          userId: payoutUserId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 50, // below floor
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
        {
          userId: payoutUserId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 500, // above floor
          currency: 'gbp',
          reason: 'connect_not_ready',
          status: 'pending',
          payoutType: 'creator_payout',
        },
      ])
      .returning();

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();
    transferSpy.mockImplementation(makeUniqueTransferIdMock('tr_fc_mixed'));

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);
    expect(result.resolved).toBe(2);
    expect(transferSpy).toHaveBeenCalledTimes(2);

    const [smallRow] = inserted.filter((r) => r.amountCents === 50);
    const [largeRow] = inserted.filter((r) => r.amountCents === 500);

    const [smallAfter] = await db
      .select()
      .from(payoutsTable)
      .where(eq(payoutsTable.id, smallRow.id))
      .limit(1);
    const [largeAfter] = await db
      .select()
      .from(payoutsTable)
      .where(eq(payoutsTable.id, largeRow.id))
      .limit(1);

    // Both rows reach status='paid' once the GROUP SUM clears the floor.
    expect(smallAfter.resolvedAt).not.toBeNull();
    expect(largeAfter.resolvedAt).not.toBeNull();
  });

  // Codex-iivne: the original bug. Many invoices for one creator each
  // produce a row below the floor; pre-fix every retry walked the
  // per-row floor, every row stayed pending, the obligation piled up
  // indefinitely. Post-fix the SUM crosses the floor and all rows fire.
  it('aggregate SUM clears floor on a backlog of below-floor rows (Codex-iivne)', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-aggregate-floor');

    // Floor = £3 (300p). Four monthly rows at £1.25 each (125p) — each
    // individually below floor; SUM = 500p clears it.
    const feeConfig = makeFeeConfigStub(
      {
        [payoutUserId]: {
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 300,
        },
      },
      {
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      }
    );
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    const rows = await db
      .insert(payoutsTable)
      .values(
        Array.from({ length: 4 }, () => ({
          userId: payoutUserId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 125,
          currency: 'gbp' as const,
          reason: 'min_transfer_floor' as const,
          status: 'pending' as const,
          payoutType: 'creator_payout' as const,
        }))
      )
      .returning();

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();
    transferSpy.mockImplementation(makeUniqueTransferIdMock('tr_fc_agg'));

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);

    expect(result).toEqual({ resolved: 4, failed: 0 });
    expect(transferSpy).toHaveBeenCalledTimes(4);

    const after = await db
      .select()
      .from(payoutsTable)
      .where(
        inArray(
          payoutsTable.id,
          rows.map((r) => r.id)
        )
      );
    expect(after.every((r) => r.status === 'paid')).toBe(true);
    expect(after.every((r) => r.resolvedAt !== null)).toBe(true);
  });

  // Codex-iivne: complementary negative test — when the SUM is STILL
  // below floor, every row stays pending so the next sweep can pick
  // them up after another invoice lands.
  it('aggregate SUM below floor leaves all rows pending (Codex-iivne)', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-aggregate-below');

    // Floor = £3 (300p). Two rows at £1 each → SUM = 200p, still below.
    const feeConfig = makeFeeConfigStub(
      {
        [payoutUserId]: {
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 300,
        },
      },
      {
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      }
    );
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    const rows = await db
      .insert(payoutsTable)
      .values(
        Array.from({ length: 2 }, () => ({
          userId: payoutUserId,
          organizationId: org.id,
          subscriptionId: sub.id,
          amountCents: 100,
          currency: 'gbp' as const,
          reason: 'min_transfer_floor' as const,
          status: 'pending' as const,
          payoutType: 'creator_payout' as const,
        }))
      )
      .returning();

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);

    expect(result).toEqual({ resolved: 0, failed: 0 });
    expect(transferSpy).not.toHaveBeenCalled();

    const after = await db
      .select()
      .from(payoutsTable)
      .where(
        inArray(
          payoutsTable.id,
          rows.map((r) => r.id)
        )
      );
    expect(after.every((r) => r.status === 'pending')).toBe(true);
    expect(after.every((r) => r.resolvedAt === null)).toBe(true);
  });

  it('without feeConfig injected, all payouts transfer (legacy FEES.* fallback — no floor)', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-no-injection');
    // No feeConfig — service falls back to FEES.* constants with
    // minTransferCents=0, so even tiny payouts fire.
    const service = new SubscriptionService(
      { db, environment: 'test' },
      stripe
    );

    await db.insert(payoutsTable).values({
      userId: payoutUserId,
      organizationId: org.id,
      subscriptionId: sub.id,
      amountCents: 1, // pence
      currency: 'gbp',
      reason: 'connect_not_ready',
      status: 'pending',
      payoutType: 'creator_payout',
    });

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();
    transferSpy.mockResolvedValue({ id: 'tr_fc_nofee' } as Stripe.Transfer);

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);
    expect(result.resolved).toBe(1);
    expect(transferSpy).toHaveBeenCalledTimes(1);
  });

  // Codex-iivne: post-fix the fee policy is looked up ONCE per
  // (userId, sourceType) group rather than per-row, because the
  // floor evaluates against the group SUM. Rewritten from the
  // pre-fix "once per pending payout" assertion.
  it('queries FeeConfigService once per (userId, sourceType) group (Codex-iivne)', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-per-row');

    const feeConfig = makeFeeConfigStub(
      {
        [payoutUserId]: {
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
      },
      {
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      }
    );
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    await db.insert(payoutsTable).values([
      {
        userId: payoutUserId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 100,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      },
      {
        userId: payoutUserId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 200,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      },
      {
        userId: payoutUserId,
        organizationId: org.id,
        subscriptionId: sub.id,
        amountCents: 300,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      },
    ]);

    vi.mocked(stripe.transfers.create).mockImplementation(
      makeUniqueTransferIdMock('tr_fc_perrow')
    );

    await service.resolvePendingPayouts(org.id, stripeAccountId);

    // resolvePendingPayouts walks the per-creator override chain ONCE
    // per (userId, sourceType) group — the floor evaluates against the
    // SUM of pending rows for that group. All 3 rows share
    // userId=payoutUserId AND sourceType='subscription', so one lookup
    // covers them.
    expect(feeConfig.getFeesForCreator).toHaveBeenCalledTimes(1);
    const [orgArg, creatorArg, ctxArg] = (
      feeConfig.getFeesForCreator as ReturnType<typeof vi.fn>
    ).mock.calls[0]!;
    expect(orgArg).toBe(org.id);
    expect(creatorArg).toBe(payoutUserId);
    expect(ctxArg).toBe('subscription');
  });

  it('preserves unresolved rows scoped by (userId, orgId, resolvedAt IS NULL)', async () => {
    // Defensive: ensures the skip path doesn't accidentally bleed across orgs
    // or users via a stray query update. The DB-level WHERE clause is the
    // primary guard; this test surfaces a regression if anyone refactors it.
    const { org, sub, stripeAccountId } = await seed('fc-scope');

    const feeConfig = makeFeeConfigStub(
      {
        [payoutUserId]: {
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 100,
        },
      },
      {
        platformFeePercent: 1000,
        orgFeePercent: 0,
        minPlatformFeeCents: 0,
        minTransferCents: 0,
      }
    );
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    await db.insert(payoutsTable).values({
      userId: payoutUserId,
      organizationId: org.id,
      subscriptionId: sub.id,
      amountCents: 30,
      currency: 'gbp',
      reason: 'connect_not_ready',
      status: 'pending',
      payoutType: 'creator_payout',
    });

    await service.resolvePendingPayouts(org.id, stripeAccountId);

    // The row stays unresolved AND specifically for this (user, org) pair.
    const unresolved = await db
      .select()
      .from(payoutsTable)
      .where(
        and(
          eq(payoutsTable.userId, payoutUserId),
          eq(payoutsTable.organizationId, org.id),
          eq(payoutsTable.status, 'pending')
        )
      );
    expect(unresolved.length).toBeGreaterThanOrEqual(1);
  });

  // Codex-5794i: resolvePendingPayouts must consult the fee policy that
  // matches the row's sourceType. Before the fix the sweep hardcoded
  // 'subscription', so a small purchase-sourced row would be held back by
  // the SUBSCRIPTION floor even when the org's one_off floor would let it
  // clear — leaving funds stuck in pending state indefinitely.
  it('routes purchase-sourced rows through the one_off fee policy, not subscription', async () => {
    const { org, stripeAccountId } = await seed('fc-policy-route');

    // Distinct floors so the policy branch is observable: subscription
    // is high (£10), one_off is low (£1). A £5 row clears one_off only.
    const feeConfig = {
      getFeesForCreator: vi.fn(
        async (
          _orgId: string,
          _creatorId: string,
          ctx: 'subscription' | 'one_off'
        ) => ({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: ctx === 'subscription' ? 1000 : 100,
        })
      ),
      getFeesForOrg: vi.fn(),
      getFeesPlatform: vi.fn(),
    } as unknown as FeeConfigService;

    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    const [row] = await db
      .insert(payoutsTable)
      .values({
        userId: payoutUserId,
        organizationId: org.id,
        sourceType: 'purchase',
        stripeChargeId: `ch_${createUniqueSlug('p')}`,
        amountCents: 500,
        currency: 'gbp',
        reason: 'connect_not_ready',
        status: 'pending',
        payoutType: 'creator_payout',
      })
      .returning();

    const transferSpy = vi.mocked(stripe.transfers.create);
    transferSpy.mockClear();

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);

    expect(feeConfig.getFeesForCreator).toHaveBeenCalledWith(
      org.id,
      payoutUserId,
      'one_off'
    );
    expect(result).toEqual({ resolved: 1, failed: 0 });
    expect(transferSpy).toHaveBeenCalledTimes(1);

    const [reread] = await db
      .select()
      .from(payoutsTable)
      .where(eq(payoutsTable.id, row.id))
      .limit(1);
    expect(reread.status).toBe('paid');
    expect(reread.resolvedAt).not.toBeNull();
  });

  it('still routes subscription-sourced rows through the subscription policy', async () => {
    const { org, sub, stripeAccountId } = await seed('fc-policy-sub');

    const feeConfig = {
      getFeesForCreator: vi.fn(
        async (
          _orgId: string,
          _creatorId: string,
          ctx: 'subscription' | 'one_off'
        ) => ({
          platformFeePercent: 1000,
          orgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: ctx === 'subscription' ? 100 : 1000,
        })
      ),
      getFeesForOrg: vi.fn(),
      getFeesPlatform: vi.fn(),
    } as unknown as FeeConfigService;

    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      stripe
    );

    await db.insert(payoutsTable).values({
      userId: payoutUserId,
      organizationId: org.id,
      subscriptionId: sub.id,
      sourceType: 'subscription',
      amountCents: 500,
      currency: 'gbp',
      reason: 'connect_not_ready',
      status: 'pending',
      payoutType: 'creator_payout',
    });

    await service.resolvePendingPayouts(org.id, stripeAccountId);

    expect(feeConfig.getFeesForCreator).toHaveBeenCalledWith(
      org.id,
      payoutUserId,
      'subscription'
    );
  });
});
