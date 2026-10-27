/**
 * Two ledger edges of an organisation subscription invoice.
 *
 * - Codex-2hxff.47 (owner decision 2026-10-23, "Keep account history"): a
 *   drain finds a transfer an earlier attempt made to the payee's REPLACED
 *   Connect account, and settles the row instead of paying it again.
 * - Codex-2hxff.49 (owner decision 2026-10-23, "Keep recorded fee"): a replay
 *   keeps the platform fee an earlier delivery recorded and splits the rest of
 *   the charge from it, so the slices sum exactly to the gross even when the
 *   fees changed in between. A plain redelivery moves no money.
 *
 * Real DB, mocked Stripe. Every row hangs off this file's own organisation
 * and users and is deleted in afterAll (the local database is shared).
 */

import {
  organizationOwnershipPeriods,
  organizations,
  payouts,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import type { FeeConfig, FeeConfigService } from '@codex/purchase';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTestOrganisationPayee,
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
import { calculateRevenueSplit } from '../revenue-split';
import { SubscriptionService } from '../subscription-service';

const GROSS = 1000;

function fees(platformFeePercent: number, orgFeePercent: number): FeeConfig {
  return {
    platformFeePercent,
    orgFeePercent,
    minPlatformFeeCents: 0,
    minTransferCents: 0,
  };
}

function feeConfigOf(config: FeeConfig): FeeConfigService {
  return {
    getFeesForOrg: vi.fn(async () => config),
    getFeesForCreator: vi.fn(async () => config),
    getFeesPlatform: vi.fn(async () => config),
  } as unknown as FeeConfigService;
}

type ExecuteTransfers = (
  subscriptionId: string,
  orgId: string,
  chargeId: string,
  platformFeeCents: number,
  orgFeeCents: number,
  creatorPayoutCents: number,
  invoiceCreatedAt: Date
) => Promise<void>;

describe('ledger replay and account history', () => {
  let db: Database;
  let stripe: Stripe;
  let ownerId: string;
  let payeeId: string;
  let orgId: string;
  let subscriptionId: string;
  const userIds: string[] = [];
  const oldAccount = `acct_moved_old_${crypto.randomUUID().slice(0, 8)}`;
  const newAccount = `acct_moved_new_${crypto.randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [owner, payee, subscriber] = await seedTestUsers(db, 3);
    if (!owner || !payee || !subscriber) throw new Error('seed failed');
    ownerId = owner;
    payeeId = payee;
    userIds.push(owner, payee, subscriber);
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('ledger-edge') })
        )
        .returning(),
      'organization'
    );
    orgId = org.id;
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning(),
      'tier'
    );
    const sub = takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(subscriber, orgId, tier.id))
        .returning(),
      'subscription'
    );
    subscriptionId = sub.id;
    // The owner is paid the organisation slice and the creator pool.
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, ownerId));
    await setTestOrganisationPayee(db, orgId, ownerId);
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  afterAll(async () => {
    await db.delete(payouts).where(eq(payouts.organizationId, orgId));
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId));
    await db
      .delete(subscriptionTiers)
      .where(eq(subscriptionTiers.organizationId, orgId));
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, userIds));
    // Written by the trigger, from the deletes above too; no FK.
    await db
      .delete(stripeConnectAccountHistory)
      .where(inArray(stripeConnectAccountHistory.userId, userIds));
    await db
      .delete(organizationOwnershipPeriods)
      .where(eq(organizationOwnershipPeriods.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await teardownTestDatabase();
  });

  const charge = () => `ch_edge_${crypto.randomUUID().slice(0, 12)}`;

  function serviceWith(config: FeeConfig, database: Database = db) {
    const service = new SubscriptionService(
      { db: database, environment: 'test', feeConfig: feeConfigOf(config) },
      stripe
    );
    const executeTransfers = (
      service as unknown as { executeTransfers: ExecuteTransfers }
    ).executeTransfers.bind(service);
    const obs = (
      service as unknown as {
        obs: {
          warn: (message: string, meta?: unknown) => void;
          error: (message: string, meta?: unknown) => void;
        };
      }
    ).obs;
    return { service, executeTransfers, obs };
  }

  /** The split a delivery computes at `config` (no agreements here). */
  function splitAt(config: FeeConfig) {
    const split = calculateRevenueSplit(
      GROSS,
      config.platformFeePercent,
      config.orgFeePercent
    );
    return [
      split.platformFeeCents,
      split.organizationFeeCents,
      split.creatorPayoutCents,
    ] as const;
  }

  const slicesOf = (chargeId: string) =>
    db.select().from(payouts).where(eq(payouts.stripeChargeId, chargeId));

  const transferred = () =>
    vi
      .mocked(stripe.transfers.create)
      .mock.calls.reduce(
        (sum, [params]) => sum + Number(params.amount ?? 0),
        0
      );

  it("a drain settles a row whose transfer went to the payee's replaced account, and sends nothing (Codex-2hxff.47)", async () => {
    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(null, payeeId, {
        stripeAccountId: oldAccount,
      })
    );
    // Support replaces the account; the trigger keeps the old one.
    await db
      .update(stripeConnectAccounts)
      .set({ stripeAccountId: newAccount })
      .where(eq(stripeConnectAccounts.userId, payeeId));
    // A drain sent it an hour ago, to the old account, and died before
    // marking it paid.
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          userId: payeeId,
          organizationId: orgId,
          subscriptionId,
          sourceType: 'subscription',
          amountCents: 765,
          currency: 'gbp',
          payoutType: 'creator_payout',
          status: 'pending',
          stripeChargeId: charge(),
          transferGroup: `sub_${subscriptionId}`,
          lastRetryAt: new Date(Date.now() - 60 * 60_000),
          retryCount: 1,
        })
        .returning(),
      'payout'
    );
    const landed = await stripe.transfers.create({
      amount: 765,
      currency: 'gbp',
      destination: oldAccount,
      metadata: { payout_id: row.id },
    });
    vi.mocked(stripe.transfers.create).mockClear();
    const { service } = serviceWith(fees(1000, 1500));

    const result = await service.resolvePendingPayoutsForAccount(newAccount);

    expect(result).toEqual({ resolved: 1, failed: 0 });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    const [after] = await db
      .select()
      .from(payouts)
      .where(eq(payouts.id, row.id));
    expect(after).toMatchObject({
      status: 'paid',
      stripeTransferId: landed.id,
    });
  });

  it('a replay after the fees changed keeps the recorded platform fee: the slices sum to the gross (Codex-2hxff.49)', async () => {
    const chargeId = charge();
    const before = fees(1000, 1500);
    const after = fees(2000, 1500);
    // The first delivery records the platform fee, then the database drops
    // the connection before the split is written.
    const dropsSplit = new Proxy(db, {
      get(target, property) {
        if (property === 'transaction') {
          return () => Promise.reject(new Error('Connection terminated'));
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const first = serviceWith(before, dropsSplit);
    await expect(
      first.executeTransfers(
        subscriptionId,
        orgId,
        chargeId,
        ...splitAt(before),
        new Date()
      )
    ).rejects.toThrow('Connection terminated');
    expect((await slicesOf(chargeId)).map((r) => r.payoutType)).toEqual([
      'platform_fee',
    ]);

    const replay = serviceWith(after);
    const warned = vi.spyOn(replay.obs, 'warn');
    await replay.executeTransfers(
      subscriptionId,
      orgId,
      chargeId,
      ...splitAt(after),
      new Date()
    );

    const rows = await slicesOf(chargeId);
    const byType = new Map(rows.map((r) => [r.payoutType, r.amountCents]));
    // 100 recorded at 10%; the 900 left split at 15% to the organisation.
    expect(Object.fromEntries(byType)).toEqual({
      platform_fee: 100,
      organization_fee: 135,
      creator_payout_to_owner: 765,
    });
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(GROSS);
    expect(transferred()).toBe(GROSS - 100);
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining('different platform fee on record'),
      expect.objectContaining({ recordedFeeCents: 100, computedFeeCents: 200 })
    );
  });

  it('a plain redelivery moves no money', async () => {
    const chargeId = charge();
    const config = fees(1000, 1500);
    const { executeTransfers, obs } = serviceWith(config);
    await executeTransfers(
      subscriptionId,
      orgId,
      chargeId,
      ...splitAt(config),
      new Date()
    );
    const first = await slicesOf(chargeId);
    const sentFirst = vi.mocked(stripe.transfers.create).mock.calls.length;
    const warned = vi.spyOn(obs, 'warn');
    const alerted = vi.spyOn(obs, 'error');

    await executeTransfers(
      subscriptionId,
      orgId,
      chargeId,
      ...splitAt(config),
      new Date()
    );

    expect(sentFirst).toBe(2);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(sentFirst);
    const again = await slicesOf(chargeId);
    expect(again.map((r) => r.id).sort()).toEqual(
      first.map((r) => r.id).sort()
    );
    expect(again.reduce((sum, r) => sum + r.amountCents, 0)).toBe(GROSS);
    expect(warned).not.toHaveBeenCalled();
    expect(alerted).not.toHaveBeenCalled();
  });
});
