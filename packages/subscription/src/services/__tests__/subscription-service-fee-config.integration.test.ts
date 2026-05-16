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
import { and, eq } from 'drizzle-orm';
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

  beforeEach(() => {
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

  it('two payouts, one below floor and one above — only the larger transfers', async () => {
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
    transferSpy.mockResolvedValue({ id: 'tr_fc_mixed' } as Stripe.Transfer);

    const result = await service.resolvePendingPayouts(org.id, stripeAccountId);
    expect(result.resolved).toBe(1);
    expect(transferSpy).toHaveBeenCalledTimes(1);

    // Verify which row resolved.
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

    expect(smallAfter.resolvedAt).toBeNull();
    expect(largeAfter.resolvedAt).not.toBeNull();
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

  it('queries FeeConfigService once per pending payout (per-row resolution)', async () => {
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

    vi.mocked(stripe.transfers.create).mockResolvedValue({
      id: 'tr_fc_perrow',
    } as Stripe.Transfer);

    await service.resolvePendingPayouts(org.id, stripeAccountId);

    // resolvePendingPayouts walks the per-creator override chain for EACH
    // pending row (per-creator floor can differ). Locking this contract in.
    expect(feeConfig.getFeesForCreator).toHaveBeenCalledTimes(3);
    for (const call of (feeConfig.getFeesForCreator as ReturnType<typeof vi.fn>)
      .mock.calls) {
      expect(call[0]).toBe(org.id);
      expect(call[1]).toBe(payoutUserId);
      expect(call[2]).toBe('subscription');
    }
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
