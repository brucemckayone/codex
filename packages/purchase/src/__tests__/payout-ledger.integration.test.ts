/**
 * The payouts ledger's write path (Codex-2hxff.11, .12, .37).
 *
 * The rules under test (docs/payments/connect-and-payouts.md#the-payouts-ledger):
 *   - one row per slice per charge — a replay transfers nothing, at any age;
 *   - the row is reserved BEFORE the transfer, so money never moves unrecorded;
 *   - a failed transfer keeps its charge id and stays payable;
 *   - nothing is dropped: an unpayable payee gets a pending row, and the
 *     organisation's slice with no owner is held as `no_owner`;
 *   - a drain can find a transfer Stripe already made for a row.
 *
 * Real schema: the guarantees are unique indexes and CHECKs, which a mocked db
 * would not enforce.
 */

import {
  organizations,
  payouts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
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
import {
  claimPayoutAttempt,
  findTransfersForPayouts,
  type LedgerDeps,
  type RecordSliceInput,
  recordPlatformFee,
  recordSlice,
  settlePayoutPaid,
} from '../utils/payout-ledger';

describe('payouts ledger', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: LedgerDeps;
  let creatorId: string;
  let ownerId: string;
  let orgId: string;
  let subscriptionId: string;
  const obs = { error: vi.fn() };
  const createdPayoutIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creator, owner, subscriber] = await seedTestUsers(db, 3);
    if (!creator || !owner || !subscriber) throw new Error('seed failed');
    creatorId = creator;
    ownerId = owner;
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Ledger Org', slug: createUniqueSlug('ledger') })
      .returning();
    if (!org) throw new Error('org not inserted');
    orgId = org.id;
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(org.id))
      .returning();
    if (!tier) throw new Error('tier not inserted');
    const [sub] = await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(subscriber, org.id, tier.id))
      .returning();
    if (!sub) throw new Error('subscription not inserted');
    subscriptionId = sub.id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // The hourly sweep is global: a pending row left here would feed it.
  afterAll(async () => {
    if (createdPayoutIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.id, createdPayoutIds));
    }
    await db.delete(payouts).where(eq(payouts.organizationId, orgId));
    await teardownTestDatabase();
  });

  const charge = () => `ch_ledger_${crypto.randomUUID().slice(0, 12)}`;
  const payable = {
    stripeAccountId: 'acct_ledger_ready',
    chargesEnabled: true,
  };

  function slice(overrides: Partial<RecordSliceInput> = {}): RecordSliceInput {
    const stripeChargeId = overrides.stripeChargeId ?? charge();
    return {
      payoutType: 'creator_payout',
      amountCents: 765,
      organizationId: orgId,
      source: { sourceType: 'subscription', subscriptionId },
      stripeChargeId,
      transferGroup: `sub_${subscriptionId}`,
      sendTransferGroup: true,
      payee: { userId: creatorId, account: payable },
      idempotencyKey: `${stripeChargeId}_creator_${creatorId}`,
      metadata: { subscription_id: subscriptionId },
      ...overrides,
    };
  }

  async function rowsFor(stripeChargeId: string) {
    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, stripeChargeId));
    createdPayoutIds.push(...rows.map((r) => r.id));
    return rows;
  }

  it('a payable slice: one paid row, one transfer, tagged with the row id', async () => {
    const input = slice();

    const outcome = await recordSlice(deps, input);

    expect(outcome?.kind).toBe('paid');
    const [row, ...rest] = await rowsFor(input.stripeChargeId);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      status: 'paid',
      reason: null,
      userId: creatorId,
      stripeChargeId: input.stripeChargeId,
    });
    expect(row?.stripeTransferId).toBeTruthy();
    const create = vi.mocked(stripe.transfers.create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      source_transaction: input.stripeChargeId,
      transfer_group: input.transferGroup,
      metadata: { payout_id: row?.id, type: 'creator_payout' },
    });
    expect(create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: input.idempotencyKey,
    });
  });

  it('a replay — at ANY age — finds the slice and sends no second transfer', async () => {
    const input = slice();
    await recordSlice(deps, input);

    // A fresh Stripe client: past the ~24h idempotency window, Stripe would
    // happily make a second transfer for the same key. Only the ledger can
    // stop it.
    const later = { ...deps, stripe: createMockStripe() };
    const outcome = await recordSlice(later, input);

    expect(outcome).toEqual({ kind: 'exists' });
    expect(later.stripe.transfers.create).not.toHaveBeenCalled();
    expect(await rowsFor(input.stripeChargeId)).toHaveLength(1);
  });

  it('the organisation slice is one per charge whoever the payee is', async () => {
    const input = slice({
      payoutType: 'organization_fee',
      payee: { userId: ownerId, account: payable },
      idempotencyKey: 'org_fee_key',
    });
    await recordSlice(deps, input);

    // A replay that resolves a different payee (the owner changed, or the
    // no_owner row was handed on) must still not add the slice again.
    const outcome = await recordSlice(deps, {
      ...input,
      payee: { userId: creatorId, account: payable },
    });

    expect(outcome).toEqual({ kind: 'exists' });
    expect(await rowsFor(input.stripeChargeId)).toHaveLength(1);
  });

  it.each([
    ['no Connect account', undefined, 'connect_not_ready'],
    [
      'a restricted account',
      { stripeAccountId: 'acct_ledger_restricted', chargesEnabled: false },
      'connect_restricted',
    ],
  ] as const)('a payee with %s: a pending row in their name, no transfer', async (_label, account, reason) => {
    const input = slice({ payee: { userId: creatorId, account } });

    const outcome = await recordSlice(deps, input);

    expect(outcome).toMatchObject({ kind: 'pending', reason });
    const [row] = await rowsFor(input.stripeChargeId);
    expect(row).toMatchObject({ status: 'pending', reason, userId: creatorId });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it('below the minimum transfer: held pending even though payable', async () => {
    const input = slice({ hold: 'min_transfer_floor' });

    const outcome = await recordSlice(deps, input);

    expect(outcome).toMatchObject({
      kind: 'pending',
      reason: 'min_transfer_floor',
    });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it.each([
    'organization_fee',
    'creator_payout_to_owner',
  ] as const)('%s with no owner: held as no_owner with no payee (Codex-2hxff.37)', async (payoutType) => {
    const input = slice({ payoutType, payee: null });

    const outcome = await recordSlice(deps, input);

    expect(outcome).toMatchObject({ kind: 'pending', reason: 'no_owner' });
    const [row] = await rowsFor(input.stripeChargeId);
    expect(row).toMatchObject({
      status: 'pending',
      reason: 'no_owner',
      userId: null,
      payoutType,
    });
  });

  it('a creator slice can never be ownerless', async () => {
    await expect(recordSlice(deps, slice({ payee: null }))).rejects.toThrow(
      'must name its creator'
    );
  });

  it('the database refuses a payee-less row that is not a held org slice', async () => {
    await expect(
      db.insert(payouts).values({
        userId: null,
        organizationId: orgId,
        subscriptionId,
        amountCents: 100,
        payoutType: 'organization_fee',
        status: 'paid',
        reason: null,
        stripeChargeId: charge(),
        stripeTransferId: `tr_${crypto.randomUUID()}`,
        resolvedAt: new Date(),
      })
    ).rejects.toThrow();
  });

  it('a failed transfer: the row is failed, keeps its charge id, and is retried later', async () => {
    vi.mocked(stripe.transfers.create).mockRejectedValueOnce(
      Object.assign(new Error('Insufficient funds'), {
        type: 'StripeInvalidRequestError',
      })
    );
    const input = slice();

    const outcome = await recordSlice(deps, input);

    expect(outcome?.kind).toBe('failed');
    const [row] = await rowsFor(input.stripeChargeId);
    expect(row).toMatchObject({
      status: 'failed',
      reason: 'transfer_failed',
      stripeChargeId: input.stripeChargeId,
      // Only drain attempts count; the write-time attempt opened the lease.
      retryCount: 0,
    });
    expect(row?.lastRetryAt).toBeInstanceOf(Date);
  });

  describe('claimPayoutAttempt — one drain attempt at a time', () => {
    async function pendingRow(overrides: Partial<RecordSliceInput> = {}) {
      const input = slice({
        payee: { userId: creatorId, account: undefined },
        ...overrides,
      });
      const outcome = await recordSlice(deps, input);
      if (outcome?.kind !== 'pending') throw new Error('expected pending');
      createdPayoutIds.push(outcome.payoutId);
      return outcome.payoutId;
    }

    it('numbers each attempt, and admits no second one within the lease', async () => {
      const id = await pendingRow();
      const now = new Date();

      expect(await claimPayoutAttempt(db, id, now)).toBe(1);
      expect(
        await claimPayoutAttempt(db, id, new Date(now.getTime() + 60_000))
      ).toBeNull();
      // Past the 10-minute lease the next attempt gets a new number — a new
      // idempotency key, so Stripe does not replay the last attempt's error.
      expect(
        await claimPayoutAttempt(db, id, new Date(now.getTime() + 11 * 60_000))
      ).toBe(2);
    });

    it('a row whose write-time transfer is in flight is not claimable', async () => {
      // A payable slice reserves with the lease open; make the transfer hang
      // so the row stays pending + in flight.
      vi.mocked(stripe.transfers.create).mockImplementationOnce(
        () => new Promise(() => {}) as never
      );
      const input = slice();
      void recordSlice(deps, input);
      await vi.waitFor(async () => {
        expect(await rowsFor(input.stripeChargeId)).toHaveLength(1);
      });
      const [row] = await rowsFor(input.stripeChargeId);
      if (!row) throw new Error('row missing');

      expect(await claimPayoutAttempt(db, row.id)).toBeNull();
    });

    it('a no_owner row is never claimable — there is nobody to pay', async () => {
      const id = await pendingRow({
        payoutType: 'organization_fee',
        payee: null,
      });
      expect(await claimPayoutAttempt(db, id)).toBeNull();
    });

    it('a paid or cancelled row is never claimable', async () => {
      const id = await pendingRow();
      await db
        .update(payouts)
        .set({ status: 'cancelled_by_refund' })
        .where(eq(payouts.id, id));
      expect(await claimPayoutAttempt(db, id)).toBeNull();
    });
  });

  it('a failed reservation is thrown, so the webhook answers by its cause and retries', async () => {
    const outage = new Error('Connection terminated unexpectedly');
    const failingDb = {
      insert: () => {
        throw outage;
      },
    } as unknown as Database;

    await expect(recordSlice({ ...deps, db: failingDb }, slice())).rejects.toBe(
      outage
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it('a zero slice records nothing', async () => {
    expect(await recordSlice(deps, slice({ amountCents: 0 }))).toBeNull();
  });

  it('settling never resurrects a row a refund already cancelled', async () => {
    const input = slice({ payee: { userId: creatorId, account: undefined } });
    const outcome = await recordSlice(deps, input);
    if (outcome?.kind !== 'pending') throw new Error('expected pending');
    await db
      .update(payouts)
      .set({ status: 'cancelled_by_refund' })
      .where(eq(payouts.id, outcome.payoutId));

    expect(await settlePayoutPaid(db, outcome.payoutId, 'tr_late')).toBe(false);
    const [row] = await rowsFor(input.stripeChargeId);
    expect(row?.status).toBe('cancelled_by_refund');
  });

  it('the platform fee: one paid row per charge, however often it is recorded', async () => {
    const stripeChargeId = charge();
    const fee = {
      amountCents: 100,
      organizationId: orgId,
      source: { sourceType: 'subscription', subscriptionId } as const,
      stripeChargeId,
      transferGroup: `sub_${subscriptionId}`,
    };

    await recordPlatformFee(deps, fee);
    await recordPlatformFee(deps, fee);

    const rows = await rowsFor(stripeChargeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      payoutType: 'platform_fee',
      status: 'paid',
    });
  });

  it('a drain finds the transfer already made for a row, by its payout_id', async () => {
    const input = slice();
    const outcome = await recordSlice(deps, input);
    if (outcome?.kind !== 'paid') throw new Error('expected paid');
    const [row] = await rowsFor(input.stripeChargeId);
    if (!row) throw new Error('row missing');
    // A pre-Codex-2hxff.11 drain tagged its transfers `pending_payout_id`.
    await stripe.transfers.create({
      amount: 1,
      currency: 'gbp',
      destination: payable.stripeAccountId,
      metadata: { pending_payout_id: 'legacy-row' },
    });

    const found = await findTransfersForPayouts(
      stripe,
      payable.stripeAccountId,
      [row, { id: 'legacy-row', createdAt: row.createdAt }]
    );

    expect(found.get(row.id)).toBe(outcome.transferId);
    expect(found.get('legacy-row')).toMatch(/^tr_/);
    expect(
      await findTransfersForPayouts(stripe, 'acct_someone_else', [row])
    ).toEqual(new Map());
  });
});
