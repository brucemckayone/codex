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
  disputes,
  organizations,
  payoutReversals,
  payouts,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
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
import {
  cancelUnpaidPayout,
  claimPayoutAttempt,
  claimPayoutAttempts,
  findTransfersForPayouts,
  isDrainablePayout,
  type LedgerDeps,
  type PayeeAccounts,
  payeeAccountIds,
  type RecordSliceInput,
  recordPlatformFee,
  recordSlice,
  recordSplitOnce,
  renewPayoutAttempt,
  settlePayoutPaid,
  settleTransfer,
} from '../payout-ledger';

/** Only this account: the lookup of one destination. */
const only = (current: string): PayeeAccounts => ({ current, replaced: [] });

describe('payouts ledger', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: LedgerDeps;
  let creatorId: string;
  let ownerId: string;
  /** A payee who replaced their Connect account (Codex-2hxff.47). */
  let movedId: string;
  let orgId: string;
  let subscriptionId: string;
  const obs = { error: vi.fn(), warn: vi.fn() };
  const createdPayoutIds: string[] = [];
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creator, owner, subscriber, moved] = await seedTestUsers(db, 4);
    if (!creator || !owner || !subscriber || !moved) {
      throw new Error('seed failed');
    }
    creatorId = creator;
    ownerId = owner;
    movedId = moved;
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
    // The refund path finds the payee's account in the database.
    await db.insert(stripeConnectAccounts).values({
      userId: creatorId,
      stripeAccountId: payable.stripeAccountId,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
  });

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    obs.warn.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // The hourly sweep is global: a pending row left here would feed it.
  afterAll(async () => {
    const orgRows = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.organizationId, orgId));
    const rowIds = [...createdPayoutIds, ...orgRows.map((row) => row.id)];
    if (rowIds.length > 0) {
      // payout_reversals RESTRICT the rows they name.
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, rowIds));
      await db.delete(payouts).where(inArray(payouts.id, rowIds));
    }
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    const userIds = [creatorId, movedId];
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, userIds));
    // Written by the trigger, from the deletes above too; no FK.
    await db
      .delete(stripeConnectAccountHistory)
      .where(inArray(stripeConnectAccountHistory.userId, userIds));
    await teardownTestDatabase();
  });

  const charge = () => `ch_ledger_${crypto.randomUUID().slice(0, 12)}`;
  const payable = {
    // Run-unique: stripe_account_id is unique across the whole table.
    stripeAccountId: `acct_ledger_${crypto.randomUUID().slice(0, 12)}`,
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
      // The write reads the dispute hold, reserves, then sends: wait for the
      // send, not a fixed second, so a slow shared database cannot flake it.
      await vi.waitFor(
        () => expect(stripe.transfers.create).toHaveBeenCalled(),
        { timeout: 10_000 }
      );
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
    // Reads still work (the dispute-hold check); the reserve's INSERT fails.
    const failingDb = new Proxy(db, {
      get(target, property) {
        if (property === 'insert') {
          return () => {
            throw outage;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

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

  it('the platform fee on record is returned: a replay at another fee gets the first (Codex-2hxff.49)', async () => {
    const stripeChargeId = charge();
    const fee = {
      amountCents: 100,
      organizationId: orgId,
      source: { sourceType: 'subscription', subscriptionId } as const,
      stripeChargeId,
      transferGroup: `sub_${subscriptionId}`,
    };

    expect(await recordPlatformFee(deps, fee)).toBe(100);
    // The fees changed before the redelivery.
    expect(await recordPlatformFee(deps, { ...fee, amountCents: 200 })).toBe(
      100
    );
    // A fee now computed as nothing still finds the one recorded.
    expect(await recordPlatformFee(deps, { ...fee, amountCents: 0 })).toBe(100);
    expect(
      await recordPlatformFee(deps, {
        ...fee,
        stripeChargeId: charge(),
        amountCents: 0,
      })
    ).toBe(0);
    const rows = await rowsFor(stripeChargeId);
    expect(rows.map((r) => r.amountCents)).toEqual([100]);
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
      only(payable.stripeAccountId),
      [row, { id: 'legacy-row', createdAt: row.createdAt }]
    );

    expect(found.get(row.id)).toBe(outcome.transferId);
    expect(found.get('legacy-row')).toMatch(/^tr_/);
    expect(
      await findTransfersForPayouts(stripe, only('acct_someone_else'), [row])
    ).toEqual(new Map());
  });

  it('the lookup pages through Stripe to find an older transfer', async () => {
    const input = slice();
    const outcome = await recordSlice(deps, input);
    if (outcome?.kind !== 'paid') throw new Error('expected paid');
    const [row] = await rowsFor(input.stripeChargeId);
    if (!row) throw new Error('row missing');
    // Bury the row's transfer under more than one page (100) of others.
    for (let i = 0; i < 105; i++) {
      await stripe.transfers.create({
        amount: 1,
        currency: 'gbp',
        destination: payable.stripeAccountId,
        metadata: { payout_id: `other-${i}` },
      });
    }

    const found = await findTransfersForPayouts(
      stripe,
      only(payable.stripeAccountId),
      [row]
    );

    expect(found.get(row.id)).toBe(outcome.transferId);
    expect(vi.mocked(stripe.transfers.list).mock.calls).toHaveLength(2);
  });

  it('a row with two transfers was paid twice: reported, not silently ignored', async () => {
    const input = slice();
    const outcome = await recordSlice(deps, input);
    if (outcome?.kind !== 'paid') throw new Error('expected paid');
    const [row] = await rowsFor(input.stripeChargeId);
    if (!row) throw new Error('row missing');
    const second = await stripe.transfers.create({
      amount: 1,
      currency: 'gbp',
      destination: payable.stripeAccountId,
      metadata: { payout_id: row.id },
    });

    const found = await findTransfersForPayouts(
      stripe,
      only(payable.stripeAccountId),
      [row],
      obs
    );

    // Newest first: the second is returned; the first is reported.
    expect(found.get(row.id)).toBe(second.id);
    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('paid twice'),
      expect.objectContaining({
        payoutId: row.id,
        stripeTransferIds: [second.id, outcome.transferId],
      })
    );
  });

  it('a replay that computes a different slice is logged; the recorded slice stands', async () => {
    const input = slice();
    await recordSlice(deps, input);

    const outcome = await recordSlice(deps, { ...input, amountCents: 700 });

    expect(outcome).toEqual({ kind: 'exists' });
    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('different slice'),
      expect.objectContaining({
        recordedAmountCents: 765,
        replayAmountCents: 700,
      })
    );
    const [row] = await rowsFor(input.stripeChargeId);
    expect(row?.amountCents).toBe(765);
  });

  it('a held slice handed to a new owner is not a mismatch on replay', async () => {
    const input = slice({ payoutType: 'organization_fee', payee: null });
    const held = await recordSlice(deps, input);
    if (held?.kind !== 'pending') throw new Error('expected pending');
    await db
      .update(payouts)
      .set({ userId: ownerId, reason: 'connect_not_ready' })
      .where(eq(payouts.id, held.payoutId));
    createdPayoutIds.push(held.payoutId);
    obs.error.mockClear();

    expect(await recordSlice(deps, input)).toEqual({ kind: 'exists' });
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('an ownerless slice is reported, so support knows to assign an owner', async () => {
    const input = slice({ payoutType: 'organization_fee', payee: null });

    await recordSlice(deps, input);

    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('no owner'),
      expect.objectContaining({ organizationId: orgId, amountCents: 765 })
    );
    await rowsFor(input.stripeChargeId);
  });

  it('the database refuses a payee-less org slice with NO reason (a NULL CHECK would pass)', async () => {
    await expect(
      db.insert(payouts).values({
        userId: null,
        organizationId: orgId,
        subscriptionId,
        amountCents: 100,
        payoutType: 'organization_fee',
        status: 'pending',
        reason: null,
        stripeChargeId: charge(),
      })
    ).rejects.toThrow();
  });

  describe('a refund and a transfer in flight (Codex-2hxff.11)', () => {
    async function pendingRow() {
      const input = slice({
        payee: { userId: creatorId, account: undefined },
      });
      const outcome = await recordSlice(deps, input);
      if (outcome?.kind !== 'pending') throw new Error('expected pending');
      const [row] = await rowsFor(input.stripeChargeId);
      if (!row) throw new Error('row missing');
      return row;
    }

    it('cancels the row, then finds the transfer that went out anyway', async () => {
      const row = await pendingRow();
      // A drain sent it, then failed to mark it paid.
      const landed = await stripe.transfers.create({
        amount: row.amountCents,
        currency: 'gbp',
        destination: payable.stripeAccountId,
        metadata: { payout_id: row.id },
      });

      const outcome = await cancelUnpaidPayout(
        deps,
        row,
        'cancelled_by_refund'
      );

      expect(outcome).toEqual({ kind: 'cancelled', transferId: landed.id });
      const [after] = await rowsFor(row.stripeChargeId ?? '');
      expect(after?.status).toBe('cancelled_by_refund');
      // Frozen: the transfer can no longer settle it.
      expect(await settlePayoutPaid(db, row.id, landed.id)).toBe(false);
    });

    it('cancels a row that never had a transfer, and reports none', async () => {
      const row = await pendingRow();

      expect(
        await cancelUnpaidPayout(deps, row, 'cancelled_by_refund')
      ).toEqual({
        kind: 'cancelled',
        transferId: undefined,
      });
    });

    it('a row paid since it was read comes back as it now stands', async () => {
      const row = await pendingRow();
      await settlePayoutPaid(db, row.id, `tr_${crypto.randomUUID()}`);

      const outcome = await cancelUnpaidPayout(
        deps,
        row,
        'cancelled_by_refund'
      );

      expect(outcome.kind).toBe('changed');
      expect(outcome.kind === 'changed' && outcome.row?.status).toBe('paid');
    });

    it('a held no_owner slice can be cancelled — the CHECK admits it', async () => {
      const input = slice({ payoutType: 'organization_fee', payee: null });
      await recordSlice(deps, input);
      const [row] = await rowsFor(input.stripeChargeId);
      if (!row) throw new Error('row missing');

      expect(
        await cancelUnpaidPayout(deps, row, 'cancelled_by_refund')
      ).toEqual({
        kind: 'cancelled',
        transferId: undefined,
      });
      const [after] = await rowsFor(input.stripeChargeId);
      expect(after).toMatchObject({
        status: 'cancelled_by_refund',
        userId: null,
        reason: 'no_owner',
      });
    });

    it('a transfer that lands after the refund cancelled its row is reversed by its sender', async () => {
      const input = slice();
      // The refund arrives while the write-time transfer is in flight.
      vi.mocked(stripe.transfers.create).mockImplementationOnce(
        async (params) => {
          const payoutId = (params.metadata as { payout_id: string }).payout_id;
          await db
            .update(payouts)
            .set({ status: 'cancelled_by_refund', resolvedAt: new Date() })
            .where(eq(payouts.id, payoutId));
          return { id: 'tr_late_landing', amount: input.amountCents } as never;
        }
      );

      const outcome = await recordSlice(deps, input);

      expect(outcome).toMatchObject({
        kind: 'surplus',
        transferId: 'tr_late_landing',
        reversed: true,
      });
      expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        'tr_late_landing',
        expect.anything(),
        { idempotencyKey: 'tr_late_landing_reversal_surplus' }
      );
      const [row] = await rowsFor(input.stripeChargeId);
      expect(row?.status).toBe('cancelled_by_refund');
    });

    it('a transfer its row already records is never reversed', async () => {
      const row = await pendingRow();
      await settlePayoutPaid(db, row.id, 'tr_recorded_already');

      expect(await settleTransfer(deps, row.id, 'tr_recorded_already')).toBe(
        'already_settled'
      );
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    });

    it('a surplus reversal that fails is logged for a person to reverse', async () => {
      const row = await pendingRow();
      await cancelUnpaidPayout(deps, row, 'cancelled_by_refund');
      vi.mocked(stripe.transfers.createReversal).mockRejectedValueOnce(
        new Error('Stripe is down')
      );

      expect(await settleTransfer(deps, row.id, 'tr_unreversed')).toBe(
        'surplus_unreversed'
      );
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('could NOT be reversed'),
        expect.objectContaining({ stripeTransferId: 'tr_unreversed' })
      );
    });
  });

  describe('drain leases', () => {
    async function pendingRow() {
      const input = slice({
        payee: { userId: creatorId, account: undefined },
      });
      const outcome = await recordSlice(deps, input);
      if (outcome?.kind !== 'pending') throw new Error('expected pending');
      createdPayoutIds.push(outcome.payoutId);
      return outcome.payoutId;
    }

    it('claims a whole group in one go', async () => {
      const ids = [await pendingRow(), await pendingRow()];

      const attempts = await claimPayoutAttempts(db, ids);

      expect(attempts).toEqual(
        new Map([
          [ids[0], 1],
          [ids[1], 1],
        ])
      );
    });

    it('a drain whose lease ran out, and was claimed by another, must not send', async () => {
      const id = await pendingRow();
      const now = new Date();
      const first = await claimPayoutAttempt(db, id, now);
      const later = new Date(now.getTime() + 11 * 60_000);
      const second = await claimPayoutAttempt(db, id, later);

      expect([first, second]).toEqual([1, 2]);
      expect(await renewPayoutAttempt(db, id, 1, later)).toBe(false);
      expect(await renewPayoutAttempt(db, id, 2, later)).toBe(true);
    });

    it('a failed row from the old write paths is never re-sent — its transfer may have landed', async () => {
      // Pre-Codex-2hxff.11 writers recorded `failed` without an attempt.
      const [legacy] = await db
        .insert(payouts)
        .values({
          userId: creatorId,
          organizationId: orgId,
          subscriptionId,
          amountCents: 100,
          payoutType: 'creator_payout',
          status: 'failed',
          reason: 'transfer_failed',
          stripeChargeId: charge(),
        })
        .returning();
      if (!legacy) throw new Error('row not inserted');
      createdPayoutIds.push(legacy.id);

      expect(await claimPayoutAttempt(db, legacy.id)).toBeNull();
    });

    it('a failed row this ledger attempted is retried once its lease is over', async () => {
      vi.mocked(stripe.transfers.create).mockRejectedValueOnce(
        new Error('Stripe is down')
      );
      const input = slice();
      const outcome = await recordSlice(deps, input);
      if (outcome?.kind !== 'failed') throw new Error('expected failed');
      createdPayoutIds.push(outcome.payoutId);

      const afterLease = new Date(Date.now() + 11 * 60_000);
      expect(await claimPayoutAttempt(db, outcome.payoutId, afterLease)).toBe(
        1
      );
    });
  });

  // Owner decision 2026-10-23, "Keep account history": a transfer to an
  // account the payee has since replaced is still found, so it is never sent
  // twice and a refund can still reverse it.
  describe('a payee who replaced their Connect account (Codex-2hxff.47)', () => {
    const oldAccount = `acct_ledger_old_${crypto.randomUUID().slice(0, 8)}`;
    const newAccount = `acct_ledger_new_${crypto.randomUUID().slice(0, 8)}`;

    beforeAll(async () => {
      await db.insert(stripeConnectAccounts).values({
        userId: movedId,
        stripeAccountId: oldAccount,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });
      // Support re-keys the row; the trigger keeps the old account.
      await db
        .update(stripeConnectAccounts)
        .set({ stripeAccountId: newAccount })
        .where(eq(stripeConnectAccounts.userId, movedId));
    });

    /** A pending row of `userId`'s; `attempted`: a drain sent it an hour ago. */
    async function rowOf(userId: string, attempted: boolean) {
      const outcome = await recordSlice(
        deps,
        slice({ payee: { userId, account: undefined } })
      );
      if (outcome?.kind !== 'pending') throw new Error('expected pending');
      createdPayoutIds.push(outcome.payoutId);
      const [row] = attempted
        ? await db
            .update(payouts)
            .set({
              lastRetryAt: new Date(Date.now() - 60 * 60_000),
              retryCount: 1,
            })
            .where(eq(payouts.id, outcome.payoutId))
            .returning()
        : await db
            .select()
            .from(payouts)
            .where(eq(payouts.id, outcome.payoutId));
      if (!row) throw new Error('row missing');
      return row;
    }

    /** The transfer that attempt made, to `destination`; its row update failed. */
    const landedOn = (destination: string, row: { id: string }) =>
      stripe.transfers.create({
        amount: 765,
        currency: 'gbp',
        destination,
        metadata: { payout_id: row.id },
      });

    it('lists the current account, then the one it replaced', async () => {
      expect(await payeeAccountIds(db, movedId)).toEqual({
        current: newAccount,
        replaced: [oldAccount],
      });
    });

    it('a transfer to the replaced account is found, so the row is settled, not sent again', async () => {
      const row = await rowOf(movedId, true);
      const landed = await landedOn(oldAccount, row);

      const found = await findTransfersForPayouts(
        stripe,
        await payeeAccountIds(db, movedId),
        [row]
      );

      expect(found.get(row.id)).toBe(landed.id);
      const searched = vi
        .mocked(stripe.transfers.list)
        .mock.calls.map(
          ([params]) => (params as Stripe.TransferListParams).destination
        );
      expect(searched).toEqual([newAccount, oldAccount]);
    });

    it('a refund cancelling the row finds that transfer, for the refund to reverse', async () => {
      const row = await rowOf(movedId, true);
      const landed = await landedOn(oldAccount, row);

      expect(
        await cancelUnpaidPayout(deps, row, 'cancelled_by_refund')
      ).toEqual({ kind: 'cancelled', transferId: landed.id });
    });

    it('a row with no attempt on record is not looked for on a replaced account', async () => {
      const row = await rowOf(movedId, false);

      await findTransfersForPayouts(
        stripe,
        await payeeAccountIds(db, movedId),
        [row]
      );

      expect(stripe.transfers.list).toHaveBeenCalledTimes(1);
    });

    it("a row paid on two of the payee's accounts is reported, and settled by the current account's transfer", async () => {
      const row = await rowOf(movedId, true);
      const onNew = await landedOn(newAccount, row);
      const onOld = await landedOn(oldAccount, row);

      const found = await findTransfersForPayouts(
        stripe,
        await payeeAccountIds(db, movedId),
        [row],
        obs
      );

      expect(found.get(row.id)).toBe(onNew.id);
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('paid twice'),
        expect.objectContaining({
          errorId: expect.any(String),
          payoutId: row.id,
          destinations: [newAccount, oldAccount],
          stripeTransferIds: [onNew.id, onOld.id],
        })
      );
    });

    it('a payee with no history asks Stripe once', async () => {
      const row = await rowOf(creatorId, true);
      expect(await payeeAccountIds(db, creatorId)).toEqual({
        current: payable.stripeAccountId,
        replaced: [],
      });

      await cancelUnpaidPayout(deps, row, 'cancelled_by_refund');

      expect(stripe.transfers.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('the dispute hold (Codex-2hxff.59)', () => {
    async function dispute(stripeChargeId: string, status: string) {
      const id = `dp_ledger_${crypto.randomUUID().slice(0, 12)}`;
      disputeIds.push(id);
      await db.insert(disputes).values({
        stripeDisputeId: id,
        stripeChargeId,
        amountCents: 1000,
        currency: 'gbp',
        status,
        stripeCreatedAt: new Date(),
      });
      return id;
    }

    const setDispute = (
      id: string,
      values: Partial<typeof disputes.$inferInsert>
    ) =>
      db.update(disputes).set(values).where(eq(disputes.stripeDisputeId, id));

    async function drainable(payoutId: string): Promise<boolean> {
      const rows = await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(and(eq(payouts.id, payoutId), isDrainablePayout()));
      return rows.length === 1;
    }

    /**
     * A paid slice a won dispute reversed and paid back: the re-pay row, which
     * has no charge id of its own (repay.ts writeRepay). The win's outcome is
     * not applied yet.
     */
    async function repaidByWin(stripeChargeId: string) {
      const paid = await recordSlice(deps, slice({ stripeChargeId }));
      if (paid?.kind !== 'paid') throw new Error('expected paid');
      const won = await dispute(stripeChargeId, 'won');
      const [repay] = await db
        .insert(payouts)
        .values({
          userId: creatorId,
          organizationId: orgId,
          subscriptionId,
          sourceType: 'subscription',
          amountCents: 765,
          payoutType: 'creator_payout',
          status: 'pending',
          transferGroup: `sub_${subscriptionId}`,
        })
        .returning();
      if (!repay) throw new Error('re-pay row not inserted');
      createdPayoutIds.push(repay.id);
      await db.insert(payoutReversals).values({
        payoutId: paid.payoutId,
        causeType: 'dispute',
        causeId: won,
        amountCents: 765,
        kind: 'transfer_reversal',
        status: 'done',
        stripeReversalId: `trr_${crypto.randomUUID().slice(0, 12)}`,
        repaidByPayoutId: repay.id,
        resolvedAt: new Date(),
      });
      return { repay, won };
    }

    it("a won dispute's re-pay row waits until the win's outcome is applied", async () => {
      const { repay, won } = await repaidByWin(charge());

      // The win's follow-up (a refund's share off the row) may have failed:
      // the row is not paid in full meanwhile.
      expect(await drainable(repay.id)).toBe(false);
      expect(await claimPayoutAttempt(db, repay.id)).toBeNull();

      await setDispute(won, { outcomeAppliedAt: new Date() });

      expect(await drainable(repay.id)).toBe(true);
    });

    it("a second dispute of the charge holds a subscription's re-pay row until its loss is applied", async () => {
      const stripeChargeId = charge();
      const { repay, won } = await repaidByWin(stripeChargeId);
      await setDispute(won, { outcomeAppliedAt: new Date() });
      expect(await drainable(repay.id)).toBe(true);

      const second = await dispute(stripeChargeId, 'needs_response');

      expect(await drainable(repay.id)).toBe(false);
      expect(await claimPayoutAttempt(db, repay.id)).toBeNull();
      await setDispute(second, { status: 'lost' });
      expect(await drainable(repay.id)).toBe(false);
      await setDispute(second, { outcomeAppliedAt: new Date() });
      expect(await drainable(repay.id)).toBe(true);
    });

    it('a slice recorded during an open inquiry is held, not sent, and drains once the inquiry closes', async () => {
      const input = slice();
      const inquiry = await dispute(
        input.stripeChargeId,
        'warning_needs_response'
      );

      const outcome = await recordSlice(deps, input);

      expect(outcome).toMatchObject({ kind: 'held' });
      expect(stripe.transfers.create).not.toHaveBeenCalled();
      const [row] = await rowsFor(input.stripeChargeId);
      if (!row) throw new Error('row missing');
      // No attempt on record: nothing was sent.
      expect(row).toMatchObject({
        status: 'pending',
        reason: null,
        lastRetryAt: null,
      });
      expect(await claimPayoutAttempt(db, row.id)).toBeNull();

      await setDispute(inquiry, { status: 'warning_closed' });

      expect(await claimPayoutAttempt(db, row.id)).toBe(1);
    });

    it('a split recorded during an open chargeback is held whole, never sent at gross', async () => {
      const stripeChargeId = charge();
      await dispute(stripeChargeId, 'needs_response');

      const result = await recordSplitOnce(
        deps,
        { id: stripeChargeId, grossCents: 1000 },
        [
          slice({
            stripeChargeId,
            payoutType: 'organization_fee',
            payee: { userId: ownerId, account: payable },
            amountCents: 135,
            idempotencyKey: `${stripeChargeId}_org_fee`,
          }),
          slice({ stripeChargeId }),
        ]
      );

      expect(result).toMatchObject({
        kind: 'recorded',
        outcomes: [{ kind: 'held' }, { kind: 'held' }],
      });
      expect(stripe.transfers.create).not.toHaveBeenCalled();
      expect(await rowsFor(stripeChargeId)).toHaveLength(2);
    });

    it('a won dispute holds nothing: the slice is sent at once', async () => {
      const input = slice();
      await dispute(input.stripeChargeId, 'won');

      expect(await recordSlice(deps, input)).toMatchObject({ kind: 'paid' });
      await rowsFor(input.stripeChargeId);
    });
  });

  // Owner decision 2026-10-23, "Keep recorded fee" (Codex-2hxff.49): on a
  // charge split before, what is recorded stands, and a slice the split
  // defines that is missing entirely gets what the charge has left, so
  // nothing owed is left without a row.
  describe('a replay of a charge split before (Codex-2hxff.49)', () => {
    const GROSS = 1000;

    /** What an earlier delivery recorded on the charge, and paid. */
    async function recorded(
      stripeChargeId: string,
      rows: Array<{
        payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
        amountCents: number;
      }>
    ) {
      for (const { payoutType, amountCents } of rows) {
        await db.insert(payouts).values({
          userId:
            payoutType === 'platform_fee'
              ? null
              : payoutType === 'creator_payout'
                ? creatorId
                : ownerId,
          organizationId: orgId,
          subscriptionId,
          sourceType: 'subscription',
          amountCents,
          payoutType,
          status: 'paid',
          stripeChargeId,
          ...(payoutType === 'platform_fee'
            ? {}
            : { stripeTransferId: `tr_first_${crypto.randomUUID()}` }),
          transferGroup: `sub_${subscriptionId}`,
          resolvedAt: new Date(),
        });
      }
    }

    /** The split as a replay computes it, at fees that have changed. */
    const replayed = (stripeChargeId: string) => [
      slice({ stripeChargeId, amountCents: 680 }),
      slice({
        stripeChargeId,
        payoutType: 'organization_fee',
        payee: { userId: ownerId, account: payable },
        amountCents: 120,
        idempotencyKey: `${stripeChargeId}_org_fee`,
      }),
    ];

    it('the creator slice recorded, the organisation slice missing: the replay records it from what is left, to the gross', async () => {
      const stripeChargeId = charge();
      await recorded(stripeChargeId, [
        { payoutType: 'platform_fee', amountCents: 100 },
        { payoutType: 'creator_payout', amountCents: 765 },
      ]);

      const result = await recordSplitOnce(
        deps,
        { id: stripeChargeId, grossCents: GROSS },
        replayed(stripeChargeId)
      );

      expect(result).toMatchObject({
        kind: 'completed',
        outcomes: [null, { kind: 'paid' }],
      });
      const rows = await rowsFor(stripeChargeId);
      expect(
        Object.fromEntries(rows.map((r) => [r.payoutType, r.amountCents]))
      ).toEqual({
        platform_fee: 100,
        creator_payout: 765,
        organization_fee: 135,
      });
      expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(GROSS);
      expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
      expect(stripe.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 135 }),
        expect.anything()
      );
      // The creator slice present at another amount stands, and is reported.
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('different slice'),
        expect.objectContaining({
          recordedAmountCents: 765,
          replayAmountCents: 680,
        })
      );
    });

    it('a slice missing with nothing left of the charge is not added: the first split stands', async () => {
      const stripeChargeId = charge();
      await recorded(stripeChargeId, [
        { payoutType: 'platform_fee', amountCents: 100 },
        { payoutType: 'organization_fee', amountCents: 900 },
      ]);

      const result = await recordSplitOnce(
        deps,
        { id: stripeChargeId, grossCents: GROSS },
        replayed(stripeChargeId)
      );

      expect(result).toEqual({ kind: 'already_split' });
      expect(await rowsFor(stripeChargeId)).toHaveLength(2);
      expect(stripe.transfers.create).not.toHaveBeenCalled();
    });

    it("the rest goes to the organisation's missing slice, not the last creator's", async () => {
      const stripeChargeId = charge();
      // The first split's agreements, as the per-slice writers left them: the
      // platform fee and one creator, then the delivery died.
      await recorded(stripeChargeId, [
        { payoutType: 'platform_fee', amountCents: 100 },
        { payoutType: 'creator_payout', amountCents: 300 },
      ]);

      const result = await recordSplitOnce(
        deps,
        { id: stripeChargeId, grossCents: GROSS },
        [
          slice({
            stripeChargeId,
            payoutType: 'organization_fee',
            payee: { userId: ownerId, account: payable },
            amountCents: 120,
            idempotencyKey: `${stripeChargeId}_org_fee`,
          }),
          slice({ stripeChargeId, amountCents: 300 }),
          slice({
            stripeChargeId,
            payee: { userId: movedId, account: payable },
            amountCents: 380,
            idempotencyKey: `${stripeChargeId}_creator_${movedId}`,
          }),
        ]
      );

      expect(result.kind).toBe('completed');
      const rows = await rowsFor(stripeChargeId);
      const amountOf = (type: string, userId?: string) =>
        rows.find(
          (r) =>
            r.payoutType === type &&
            (userId === undefined || r.userId === userId)
        )?.amountCents;
      // 600 left: the second creator's computed 380, and the 220 rest to the
      // organisation.
      expect(amountOf('creator_payout', movedId)).toBe(380);
      expect(amountOf('organization_fee')).toBe(220);
      expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(GROSS);
    });

    it('a platform fee computed on a replay of a charge split without one is not added on top', async () => {
      const whole = charge();
      // The first delivery computed no fee, so wrote no fee row, and split
      // the whole charge.
      await recorded(whole, [
        { payoutType: 'organization_fee', amountCents: GROSS },
      ]);
      const fee = {
        amountCents: 100,
        organizationId: orgId,
        source: { sourceType: 'subscription', subscriptionId } as const,
        transferGroup: `sub_${subscriptionId}`,
        unlessSplit: true,
      };

      expect(
        await recordPlatformFee(deps, { ...fee, stripeChargeId: whole })
      ).toBe(0);
      expect((await rowsFor(whole)).map((r) => r.payoutType)).toEqual([
        'organization_fee',
      ]);

      // Split only in part, still with no fee row: the fee was 0, and stays
      // 0, even with room left in the gross; the sum is unchanged.
      const part = charge();
      await recorded(part, [
        { payoutType: 'creator_payout', amountCents: 950 },
      ]);
      expect(
        await recordPlatformFee(deps, { ...fee, stripeChargeId: part })
      ).toBe(0);
      const partRows = await rowsFor(part);
      expect(partRows.map((r) => r.payoutType)).toEqual(['creator_payout']);
      expect(partRows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(950);

      // Not split yet: the fee is recorded as computed.
      const fresh = charge();
      expect(
        await recordPlatformFee(deps, { ...fee, stripeChargeId: fresh })
      ).toBe(100);
      await rowsFor(fresh);
    });
  });
});
