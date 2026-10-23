/**
 * A payout Stripe keeps refusing stops and waits for support
 * (Codex-2hxff.48; owner decision D-P2, "Stop, flag for support").
 *
 * The rules under test (docs/payments/connect-and-payouts.md, "When Stripe
 * keeps refusing a payout"):
 *   - the row records Stripe's code and type;
 *   - only a REFUSAL uses an attempt: an outage, a 5xx, a rate limit or the
 *     platform's own balance never does;
 *   - a permanent refusal flags the row at once; the fifth refusal flags it;
 *   - exactly one error log, with an errorId, per flagged row;
 *   - a flagged row is skipped by every drain, but stays `failed`: a refund
 *     still cancels it.
 *
 * Real schema: the flag is one UPDATE whose WHERE decides who flagged the
 * row, which a mocked db would not exercise.
 */

import {
  organizations,
  payouts,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { UnsupportedCurrencyError } from '@codex/service-errors';
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
import {
  cancelUnpaidPayout,
  claimPayoutAttempts,
  classifyTransferFailure,
  isDrainablePayout,
  type LedgerDeps,
  MAX_PAYOUT_FAILURES,
  markPayoutFailed,
  recordSlice,
  recordTransferFailure,
  settlePayoutPaid,
} from '../payout-ledger';

/** A Stripe SDK error as `transfers.create` throws it. */
function stripeError(fields: {
  type: string;
  statusCode?: number;
  code?: string;
  param?: string;
}): Error {
  return Object.assign(
    new Error(`${fields.type} ${fields.code ?? ''}`),
    fields
  );
}

const refusal = () =>
  stripeError({
    type: 'StripeInvalidRequestError',
    statusCode: 400,
    code: 'amount_too_large',
  });
const permanentRefusal = () =>
  stripeError({
    type: 'StripeInvalidRequestError',
    statusCode: 400,
    code: 'transfers_not_allowed',
  });
const connectionError = () => stripeError({ type: 'StripeConnectionError' });
const balanceInsufficient = () =>
  stripeError({
    type: 'StripeInvalidRequestError',
    statusCode: 400,
    code: 'balance_insufficient',
  });

describe('classifyTransferFailure', () => {
  it.each([
    ['a refusal', refusal(), 'refusal'],
    ['transfers_not_allowed', permanentRefusal(), 'permanent'],
    [
      'no such destination',
      stripeError({
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'resource_missing',
        param: 'destination',
      }),
      'permanent',
    ],
    [
      'resource_missing on another parameter',
      stripeError({
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'resource_missing',
        param: 'source_transaction',
      }),
      'refusal',
    ],
    ['a connection error', connectionError(), 'outage'],
    [
      'a Stripe 5xx',
      stripeError({ type: 'StripeAPIError', statusCode: 500 }),
      'outage',
    ],
    [
      'a rate limit',
      stripeError({
        type: 'StripeRateLimitError',
        statusCode: 429,
        code: 'rate_limit',
      }),
      'outage',
    ],
    [
      'a concurrent request on the key',
      stripeError({
        type: 'StripeInvalidRequestError',
        statusCode: 409,
        code: 'idempotency_key_in_use',
      }),
      'outage',
    ],
    ['the platform balance', balanceInsufficient(), 'platform'],
    [
      'the platform keys',
      stripeError({ type: 'StripeAuthenticationError', statusCode: 401 }),
      'platform',
    ],
    [
      'a restricted platform key',
      stripeError({ type: 'StripePermissionError', statusCode: 403 }),
      'platform',
    ],
    ['an error that is not Stripe', new Error('boom'), 'platform'],
    [
      'our own GBP guard',
      new UnsupportedCurrencyError('usd', ['gbp']),
      'permanent',
    ],
  ])('%s → %s', (_label, error, kind) => {
    expect(classifyTransferFailure(error).kind).toBe(kind);
  });

  it('records the code and the error class, cut to the columns', () => {
    expect(classifyTransferFailure(balanceInsufficient())).toEqual({
      kind: 'platform',
      code: 'balance_insufficient',
      type: 'StripeInvalidRequestError',
    });
    expect(classifyTransferFailure(new Error('boom'))).toMatchObject({
      code: 'unknown',
      type: 'Error',
    });
  });
});

describe('payouts Stripe keeps refusing wait for support', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: LedgerDeps;
  let creatorId: string;
  let orgId: string;
  let tierId: string;
  let subscriptionId: string;
  const obs = { error: vi.fn(), warn: vi.fn() };
  const stripeAccountId = `acct_review_${crypto.randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creator, subscriber] = await seedTestUsers(db, 2);
    if (!creator || !subscriber) throw new Error('seed failed');
    creatorId = creator;
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Review Org', slug: createUniqueSlug('review') })
      .returning();
    if (!org) throw new Error('org not inserted');
    orgId = org.id;
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(org.id))
      .returning();
    if (!tier) throw new Error('tier not inserted');
    tierId = tier.id;
    const [sub] = await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(subscriber, org.id, tier.id))
      .returning();
    if (!sub) throw new Error('subscription not inserted');
    subscriptionId = sub.id;
    await db.insert(stripeConnectAccounts).values({
      userId: creatorId,
      stripeAccountId,
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

  // The hourly sweep is global: every row made here goes, then its owners.
  afterAll(async () => {
    await db.delete(payouts).where(eq(payouts.organizationId, orgId));
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, creatorId));
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId));
    await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tierId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await teardownTestDatabase();
  });

  const charge = () => `ch_review_${crypto.randomUUID().slice(0, 12)}`;

  /** A failed row a drain may retry: attempted by this ledger, lease over. */
  async function failedRow(): Promise<string> {
    const [row] = await db
      .insert(payouts)
      .values({
        userId: creatorId,
        organizationId: orgId,
        subscriptionId,
        sourceType: 'subscription',
        amountCents: 900,
        payoutType: 'creator_payout',
        status: 'failed',
        reason: 'transfer_failed',
        stripeChargeId: charge(),
        lastRetryAt: new Date(Date.now() - 60 * 60_000),
      })
      .returning();
    if (!row) throw new Error('row not inserted');
    return row.id;
  }

  async function rowOf(id: string) {
    const [row] = await db.select().from(payouts).where(eq(payouts.id, id));
    if (!row) throw new Error('row missing');
    return row;
  }

  async function isDrainable(id: string): Promise<boolean> {
    const rows = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.id, id), isDrainablePayout()));
    return rows.length === 1;
  }

  /** The error logs that flagged a row: one per flagged row, with an id. */
  function flagLogs() {
    return obs.error.mock.calls.filter(([message]) =>
      String(message).includes('waits for support')
    );
  }

  const context = { organizationId: 'org-under-test' };
  const attemptOn = (payoutId: string) => ({
    payoutId,
    destination: stripeAccountId,
    idempotencyKey: `payout_${payoutId}_1`,
  });

  it('a permanent refusal on the write path flags the row at once, logged once with an errorId', async () => {
    vi.mocked(stripe.transfers.create).mockRejectedValueOnce(
      permanentRefusal()
    );
    const stripeChargeId = charge();

    const outcome = await recordSlice(deps, {
      payoutType: 'creator_payout',
      amountCents: 765,
      organizationId: orgId,
      source: { sourceType: 'subscription', subscriptionId },
      stripeChargeId,
      transferGroup: `sub_${subscriptionId}`,
      sendTransferGroup: true,
      payee: {
        userId: creatorId,
        account: { stripeAccountId, chargesEnabled: true },
      },
      idempotencyKey: `${stripeChargeId}_creator_${creatorId}`,
      metadata: { subscription_id: subscriptionId },
    });

    if (outcome?.kind !== 'failed') throw new Error('expected failed');
    const row = await rowOf(outcome.payoutId);
    expect(row).toMatchObject({
      status: 'failed',
      reason: 'transfer_failed',
      lastErrorCode: 'transfers_not_allowed',
      lastErrorType: 'StripeInvalidRequestError',
      // A permanent refusal flags; it does not spend an attempt.
      failureCount: 0,
    });
    expect(row.needsReviewAt).toBeInstanceOf(Date);
    expect(flagLogs()).toHaveLength(1);
    expect(flagLogs()[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      payoutId: outcome.payoutId,
      code: 'transfers_not_allowed',
    });
    expect(obs.error).toHaveBeenCalledTimes(1);
    // The drains skip it from now on.
    expect(await isDrainable(outcome.payoutId)).toBe(false);
    const claimed = await claimPayoutAttempts(
      db,
      [outcome.payoutId],
      new Date(Date.now() + 60 * 60_000)
    );
    expect(claimed.size).toBe(0);
  });

  it(`four refusals leave the row failed and drainable; the ${MAX_PAYOUT_FAILURES}th flags it, logged once`, async () => {
    const id = await failedRow();

    for (let attempt = 1; attempt < MAX_PAYOUT_FAILURES; attempt++) {
      await recordTransferFailure(deps, attemptOn(id), refusal(), context);
      const row = await rowOf(id);
      expect(row.failureCount).toBe(attempt);
      expect(row.needsReviewAt).toBeNull();
      expect(row.status).toBe('failed');
      expect(await isDrainable(id)).toBe(true);
    }
    // Below the cap a refusal is a warning: the drains retry it.
    expect(obs.error).not.toHaveBeenCalled();
    expect(obs.warn).toHaveBeenCalledTimes(MAX_PAYOUT_FAILURES - 1);

    await recordTransferFailure(deps, attemptOn(id), refusal(), context);

    const flagged = await rowOf(id);
    expect(flagged).toMatchObject({
      status: 'failed',
      failureCount: MAX_PAYOUT_FAILURES,
      lastErrorCode: 'amount_too_large',
      lastErrorType: 'StripeInvalidRequestError',
    });
    expect(flagged.needsReviewAt).toBeInstanceOf(Date);
    expect(await isDrainable(id)).toBe(false);
    expect(flagLogs()).toHaveLength(1);
    expect(flagLogs()[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      payoutId: id,
      failureCount: MAX_PAYOUT_FAILURES,
    });

    // A failure reported after the flag changes nothing and is not an error.
    obs.error.mockClear();
    await recordTransferFailure(deps, attemptOn(id), refusal(), context);
    expect(obs.error).not.toHaveBeenCalled();
    expect((await rowOf(id)).failureCount).toBe(MAX_PAYOUT_FAILURES);
  });

  it('two failures racing on the last attempt flag the row exactly once', async () => {
    const id = await failedRow();
    await db
      .update(payouts)
      .set({ failureCount: MAX_PAYOUT_FAILURES - 1 })
      .where(eq(payouts.id, id));

    const [first, second] = await Promise.all([
      markPayoutFailed(db, id, refusal()),
      markPayoutFailed(db, id, refusal()),
    ]);

    const flaggedBy = [first, second].filter((r) => r?.flagged);
    expect(flaggedBy).toHaveLength(1);
    // The loser found the row already flagged and changed nothing.
    expect([first, second]).toContain(null);
    expect((await rowOf(id)).failureCount).toBe(MAX_PAYOUT_FAILURES);
  });

  it('six connection errors never flag the row, nor use an attempt', async () => {
    const id = await failedRow();

    for (let i = 0; i < 6; i++) {
      await recordTransferFailure(
        deps,
        attemptOn(id),
        connectionError(),
        context
      );
    }

    const row = await rowOf(id);
    expect(row).toMatchObject({
      status: 'failed',
      failureCount: 0,
      needsReviewAt: null,
      lastErrorType: 'StripeConnectionError',
    });
    expect(await isDrainable(id)).toBe(true);
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('the platform balance running short never uses an attempt, and is an error every time', async () => {
    const id = await failedRow();

    for (let i = 0; i < 6; i++) {
      await recordTransferFailure(
        deps,
        attemptOn(id),
        balanceInsufficient(),
        context
      );
    }

    const row = await rowOf(id);
    expect(row).toMatchObject({
      failureCount: 0,
      needsReviewAt: null,
      lastErrorCode: 'balance_insufficient',
    });
    expect(await isDrainable(id)).toBe(true);
    // A person may need to top the balance up.
    expect(obs.error).toHaveBeenCalledTimes(6);
    for (const [, fields] of obs.error.mock.calls) {
      expect(fields).toMatchObject({
        errorId: expect.any(String),
        code: 'balance_insufficient',
      });
    }
    expect(flagLogs()).toHaveLength(0);
  });

  it('a flagged row is still owed: a refund cancels it', async () => {
    const id = await failedRow();
    await recordTransferFailure(
      deps,
      attemptOn(id),
      permanentRefusal(),
      context
    );
    const flagged = await rowOf(id);
    expect(flagged.needsReviewAt).toBeInstanceOf(Date);

    // No transfer went out for it (the mock has made none).
    const outcome = await cancelUnpaidPayout(
      deps,
      flagged,
      'cancelled_by_refund'
    );

    expect(outcome).toEqual({ kind: 'cancelled', transferId: undefined });
    expect((await rowOf(id)).status).toBe('cancelled_by_refund');
  });

  it('support releases a flagged row with the documented step, and the drains take it again', async () => {
    const id = await failedRow();
    await recordTransferFailure(
      deps,
      attemptOn(id),
      permanentRefusal(),
      context
    );
    expect(await isDrainable(id)).toBe(false);

    // docs/payments/connect-and-payouts.md, "Releasing a flagged payout".
    const released = await db
      .update(payouts)
      .set({ needsReviewAt: null, failureCount: 0 })
      .where(and(eq(payouts.id, id), eq(payouts.status, 'failed')))
      .returning();

    expect(released).toHaveLength(1);
    expect(await isDrainable(id)).toBe(true);
    const claimed = await claimPayoutAttempts(
      db,
      [id],
      new Date(Date.now() + 60 * 60_000)
    );
    expect([...claimed.keys()]).toEqual([id]);
  });

  it('a row already paid is never marked failed', async () => {
    const id = await failedRow();
    expect(await settlePayoutPaid(db, id, `tr_${crypto.randomUUID()}`)).toBe(
      true
    );

    expect(await markPayoutFailed(db, id, permanentRefusal())).toBeNull();
    const row = await rowOf(id);
    expect(row.status).toBe('paid');
    expect(row.needsReviewAt).toBeNull();
  });

  describe('a refund cancels the row while its transfer is in flight, and Stripe never answers', () => {
    /** One slice whose transfer call is cut off: the refund lands mid-call. */
    async function sliceCutOffByRefund(transferLands: boolean) {
      const stripeChargeId = charge();
      const create = vi.mocked(stripe.transfers.create);
      const makeTransfer = create.getMockImplementation();
      create.mockImplementationOnce(async (params, options) => {
        if (transferLands) await makeTransfer?.(params, options);
        // charge.refunded's cancelUnpaidPayout, before the transfer is known.
        await db
          .update(payouts)
          .set({ status: 'cancelled_by_refund', resolvedAt: new Date() })
          .where(eq(payouts.stripeChargeId, stripeChargeId));
        throw connectionError();
      });
      const idempotencyKey = `${stripeChargeId}_creator_${creatorId}`;
      const outcome = await recordSlice(deps, {
        payoutType: 'creator_payout',
        amountCents: 640,
        organizationId: orgId,
        source: { sourceType: 'subscription', subscriptionId },
        stripeChargeId,
        transferGroup: `sub_${subscriptionId}`,
        sendTransferGroup: true,
        payee: {
          userId: creatorId,
          account: { stripeAccountId, chargesEnabled: true },
        },
        idempotencyKey,
        metadata: { subscription_id: subscriptionId },
      });
      return { outcome, idempotencyKey };
    }

    it('a transfer that landed is found by its payout_id and reversed in full', async () => {
      const { outcome } = await sliceCutOffByRefund(true);

      if (outcome?.kind !== 'surplus') throw new Error('expected surplus');
      expect(outcome.reversed).toBe(true);
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        outcome.transferId,
        expect.objectContaining({
          metadata: expect.objectContaining({ payout_id: outcome.payoutId }),
        }),
        { idempotencyKey: `${outcome.transferId}_reversal_surplus` }
      );
      const row = await rowOf(outcome.payoutId);
      expect(row.status).toBe('cancelled_by_refund');
      // Logged once, by the reversal: never a "the drains retry it" warning.
      expect(obs.warn).not.toHaveBeenCalled();
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('reversed it'),
        expect.objectContaining({
          errorId: expect.any(String),
          payoutId: outcome.payoutId,
        })
      );
    });

    it('a transfer that cannot be found is an error with its idempotency key, for a person to check', async () => {
      const { outcome, idempotencyKey } = await sliceCutOffByRefund(false);

      if (outcome?.kind !== 'failed') throw new Error('expected failed');
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect(obs.warn).not.toHaveBeenCalled();
      expect(obs.error).toHaveBeenCalledOnce();
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('may have landed'),
        expect.objectContaining({
          errorId: expect.any(String),
          payoutId: outcome.payoutId,
          idempotencyKey,
          rowStatus: 'cancelled_by_refund',
        })
      );
    });

    it('a refusal on a cancelled row sent nothing: no lookup, no error', async () => {
      const id = await failedRow();
      await db
        .update(payouts)
        .set({ status: 'cancelled_by_refund', resolvedAt: new Date() })
        .where(eq(payouts.id, id));

      expect(
        await recordTransferFailure(deps, attemptOn(id), refusal(), context)
      ).toBeNull();

      expect(stripe.transfers.list).not.toHaveBeenCalled();
      expect(obs.error).not.toHaveBeenCalled();
      expect(obs.warn).toHaveBeenCalledWith(
        expect.stringContaining('nothing was sent'),
        expect.objectContaining({ payoutId: id })
      );
    });
  });
});
