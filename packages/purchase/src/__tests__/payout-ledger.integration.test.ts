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
  cancelUnpaidPayoutForRefund,
  claimPayoutAttempt,
  claimPayoutAttempts,
  findTransfersForPayouts,
  type LedgerDeps,
  type RecordSliceInput,
  recordPlatformFee,
  recordSlice,
  renewPayoutAttempt,
  settlePayoutPaid,
  settleTransfer,
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
    deps = { db, stripe, obs, environment: 'test' };
  });

  // The hourly sweep is global: a pending row left here would feed it.
  afterAll(async () => {
    if (createdPayoutIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.id, createdPayoutIds));
    }
    await db.delete(payouts).where(eq(payouts.organizationId, orgId));
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId));
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
      payable.stripeAccountId,
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
      payable.stripeAccountId,
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

      const outcome = await cancelUnpaidPayoutForRefund(deps, row);

      expect(outcome).toEqual({ kind: 'cancelled', transferId: landed.id });
      const [after] = await rowsFor(row.stripeChargeId ?? '');
      expect(after?.status).toBe('cancelled_by_refund');
      // Frozen: the transfer can no longer settle it.
      expect(await settlePayoutPaid(db, row.id, landed.id)).toBe(false);
    });

    it('cancels a row that never had a transfer, and reports none', async () => {
      const row = await pendingRow();

      expect(await cancelUnpaidPayoutForRefund(deps, row)).toEqual({
        kind: 'cancelled',
        transferId: undefined,
      });
    });

    it('a row paid since it was read comes back as it now stands', async () => {
      const row = await pendingRow();
      await settlePayoutPaid(db, row.id, `tr_${crypto.randomUUID()}`);

      const outcome = await cancelUnpaidPayoutForRefund(deps, row);

      expect(outcome.kind).toBe('changed');
      expect(outcome.kind === 'changed' && outcome.row?.status).toBe('paid');
    });

    it('a held no_owner slice can be cancelled — the CHECK admits it', async () => {
      const input = slice({ payoutType: 'organization_fee', payee: null });
      await recordSlice(deps, input);
      const [row] = await rowsFor(input.stripeChargeId);
      if (!row) throw new Error('row missing');

      expect(await cancelUnpaidPayoutForRefund(deps, row)).toEqual({
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
      await cancelUnpaidPayoutForRefund(deps, row);
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
});
