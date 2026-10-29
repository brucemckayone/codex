/**
 * Owed to creators (Codex-2hxff.73; owner decisions Q8-Q11, OQ3, OQ4; data
 * design §7.4, §7.5): support's actions on a `payee_credits` row, and what the
 * engine does with a credit's re-pay afterwards.
 *
 * Each fixture is the ledger a late take-back leaves: a settled step (support
 * or a won dispute cancelled it, or it became a debt), and the credit
 * `claimLost` recorded for it (`recordPayeeCredit`).
 */

import {
  disputes,
  organizations,
  type Payout,
  type PayoutReversal,
  payeeCredits,
  payoutReversals,
  payouts,
  refundReviews,
  refunds,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
} from '@codex/database/schema';
import type { ServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, or } from 'drizzle-orm';
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
  type ClawbackDeps,
  MAX_CLAWBACK_ATTEMPTS,
  type PayeeCreditFinding,
  recordPayeeCredit,
  reverseCharge,
} from '../clawback';
import {
  payeeCreditsNeedingAPerson,
  recheckPayeeCredit,
  resolvePayeeCredit,
} from '../payee-credits';
import { isDrainablePayout } from '../payout-ledger';
import { repayDispute, repayFailedRefund } from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);

describe('payee credits: support settles a late take-back (Codex-2hxff.73)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let payeeId: string;
  let supportId: string;
  let orgId: string;
  let accountId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdDisputeIds: string[] = [];
  const createdRefundIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [payeeId, supportId] = await seedTestUsers(db, 2);
    accountId = `acct_credit_${uid()}`;
    await db.insert(stripeConnectAccounts).values({
      userId: payeeId,
      stripeAccountId: accountId,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Credit Org', slug: createUniqueSlug('credit') })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    obs.warn.mockClear();
    obs.info.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // Payout rows feed global drains and sweeps: never leave them behind.
  afterAll(async () => {
    const ours = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.organizationId, orgId));
    const ids = ours.map((row) => row.id);
    if (ids.length > 0) {
      await db.delete(payeeCredits).where(inArray(payeeCredits.payoutId, ids));
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, ids));
      await db
        .update(payoutReversals)
        .set({ repaidByPayoutId: null })
        .where(
          or(
            inArray(payoutReversals.payoutId, ids),
            inArray(payoutReversals.repaidByPayoutId, ids)
          )
        );
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, ids));
      await db.delete(payouts).where(inArray(payouts.id, ids));
    }
    if (createdDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, createdDisputeIds));
    }
    if (createdRefundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, createdRefundIds));
    }
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, payeeId));
    await db
      .delete(stripeConnectAccountHistory)
      .where(eq(stripeConnectAccountHistory.userId, payeeId));
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  async function slice(
    status: 'paid' | 'cancelled_by_refund' | 'cancelled_by_dispute',
    chargeId = `ch_credit_${uid()}`
  ): Promise<Payout> {
    const paid = status === 'paid';
    return takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: payeeId,
          payoutType: 'creator_payout',
          amountCents: 765,
          status,
          sourceType: 'subscription',
          stripeChargeId: chargeId,
          stripeTransferId: paid ? `tr_credit_${uid()}` : null,
          reason: paid ? null : 'connect_not_ready',
          resolvedAt: new Date(Date.now() - 60 * 60_000),
        })
        .returning()
    );
  }

  async function settledStep(
    on: Payout,
    status: 'cancelled' | 'debt' | 'done',
    overrides: Partial<PayoutReversal> = {}
  ): Promise<PayoutReversal> {
    return takeFirst(
      await db
        .insert(payoutReversals)
        .values({
          payoutId: on.id,
          causeType: 'refund',
          causeId: `re_credit_${uid()}`,
          amountCents: 765,
          kind: on.status === 'paid' ? 'transfer_reversal' : 'cancellation',
          status,
          resolvedAt: new Date(),
          ...overrides,
        })
        .returning()
    );
  }

  async function credit(
    step: PayoutReversal,
    on: Payout,
    finding: Partial<PayeeCreditFinding> = {}
  ) {
    await recordPayeeCredit(db, {
      payoutReversalId: step.id,
      payout: on,
      effect: 'reversal_landed',
      amountCents: 700,
      stripeReversalId: `trr_credit_${uid()}`,
      stripeTransferId: on.stripeTransferId,
      settledAs: step.status as PayeeCreditFinding['settledAs'],
      alertErrorId: crypto.randomUUID(),
      ...finding,
    });
    return takeFirst(
      await db
        .select()
        .from(payeeCredits)
        .where(eq(payeeCredits.payoutReversalId, step.id))
    );
  }

  async function debtReview(step: PayoutReversal, on: Payout, cents = 700) {
    return takeFirst(
      await db
        .insert(refundReviews)
        .values({
          payoutReversalId: step.id,
          payoutId: on.id,
          creatorUserId: payeeId,
          attemptedReversalCents: cents,
          errorCode: 'insufficient_funds',
        })
        .returning()
    );
  }

  function resolve(
    creditId: string,
    action: 'repay' | 'count_against_debt' | 'not_owed',
    note = ''
  ) {
    return resolvePayeeCredit(deps, {
      creditId,
      action,
      note,
      resolvedByUserId: supportId,
    });
  }

  async function failureOf(promise: Promise<unknown>): Promise<ServiceError> {
    return promise.then(
      () => {
        throw new Error('expected the call to fail');
      },
      (error: unknown) => error as ServiceError
    );
  }

  async function readStep(id: string): Promise<PayoutReversal> {
    return takeFirst(
      await db.select().from(payoutReversals).where(eq(payoutReversals.id, id))
    );
  }

  // ── Re-pay ──────────────────────────────────────────────────────────

  describe('Re-pay', () => {
    it("writes one pending re-pay for what Stripe took, not the step's amount, links it on the step, and a repeat writes nothing", async () => {
      const paid = await slice('paid');
      const step = await settledStep(paid, 'cancelled');
      const row = await credit(step, paid);

      const first = await resolve(row.id, 'repay', 'Checked in Stripe');
      const again = await resolve(row.id, 'repay');

      expect(first.repeated).toBe(false);
      expect(first.repayPayout).toMatchObject({
        amountCents: 700,
        status: 'pending',
        userId: payeeId,
        organizationId: orgId,
        payoutType: 'creator_payout',
        sourceType: 'subscription',
        stripeChargeId: null,
        reason: null,
      });
      expect(first.credit).toMatchObject({
        resolution: 'repaid',
        repayPayoutId: first.repayPayout?.id,
        resolvedByUserId: supportId,
        resolutionNote: 'Checked in Stripe',
      });
      expect((await readStep(step.id)).repaidByPayoutId).toBe(
        first.repayPayout?.id
      );
      expect(again).toMatchObject({
        repeated: true,
        repayPayout: { id: first.repayPayout?.id },
      });
      expect(
        await db
          .select({ id: payouts.id })
          .from(payouts)
          .where(eq(payouts.id, first.repayPayout?.id ?? ''))
      ).toHaveLength(1);
      expect(obs.info).toHaveBeenCalledWith('A payee credit was settled', {
        creditId: row.id,
        resolution: 'repaid',
        repayPayoutId: first.repayPayout?.id,
        amountCents: 700,
      });
    });

    it('a double click writes ONE re-pay row: the credit is locked', async () => {
      const paid = await slice('paid');
      const step = await settledStep(paid, 'cancelled');
      const row = await credit(step, paid);

      const [a, b] = await Promise.all([
        resolve(row.id, 'repay'),
        resolve(row.id, 'repay'),
      ]);

      expect(a.repayPayout?.id).toBeDefined();
      expect(b.repayPayout?.id).toBe(a.repayPayout?.id);
      expect([a.repeated, b.repeated].sort()).toEqual([false, true]);
      const linked = await db
        .select({ id: payoutReversals.id })
        .from(payoutReversals)
        .where(eq(payoutReversals.repaidByPayoutId, a.repayPayout?.id ?? ''));
      expect(linked).toEqual([{ id: step.id }]);
    });

    it('another action once settled is a 409; a credit that does not exist is a 404', async () => {
      const paid = await slice('paid');
      const row = await credit(await settledStep(paid, 'cancelled'), paid);
      await resolve(row.id, 'repay');

      const other = await failureOf(resolve(row.id, 'not_owed', 'oops'));
      expect(other.statusCode).toBe(409);
      expect(other.context).toEqual({
        code: 'ALREADY_SETTLED',
        resolution: 'repaid',
      });
      expect(
        (await failureOf(resolve(crypto.randomUUID(), 'repay'))).statusCode
      ).toBe(404);
    });

    it('on a step whose own debt is still open for the same amount: 409 CREDIT_DEBT_STILL_OPEN, and nothing is written', async () => {
      const paid = await slice('paid');
      const step = await settledStep(paid, 'debt');
      await debtReview(step, paid, 700);
      const row = await credit(step, paid);

      const refused = await failureOf(resolve(row.id, 'repay'));

      expect(refused.statusCode).toBe(409);
      expect(refused.context).toEqual({ code: 'CREDIT_DEBT_STILL_OPEN' });
      expect((await readStep(step.id)).repaidByPayoutId).toBeNull();
    });

    it('on a done step, or one already re-paid: 422 CREDIT_SETTLE_BY_HAND, with an alert', async () => {
      const paid = await slice('paid');
      const done = await settledStep(paid, 'done');
      const onDone = await credit(done, paid);
      const refused = await failureOf(resolve(onDone.id, 'repay'));
      expect(refused.statusCode).toBe(422);
      expect(refused.context).toEqual({ code: 'CREDIT_SETTLE_BY_HAND' });
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('settle it by hand'),
        expect.objectContaining({
          errorId: expect.any(String),
          creditId: onDone.id,
          payoutReversalId: done.id,
        })
      );

      // A won dispute's re-pay already paid this cancelled step back.
      const other = await slice('paid');
      const prior = takeFirst(
        await db
          .insert(payouts)
          .values({
            organizationId: orgId,
            userId: payeeId,
            payoutType: 'creator_payout',
            amountCents: 765,
            status: 'pending',
            sourceType: 'subscription',
          })
          .returning()
      );
      const linked = await settledStep(other, 'cancelled', {
        repaidByPayoutId: prior.id,
      });
      const onLinked = await credit(linked, other);
      expect((await failureOf(resolve(onLinked.id, 'repay'))).context).toEqual({
        code: 'CREDIT_SETTLE_BY_HAND',
      });
      expect((await readStep(linked.id)).repaidByPayoutId).toBe(prior.id);
    });

    it('an unverified credit cannot be re-paid: check Stripe first (422)', async () => {
      const paid = await slice('paid');
      const row = await credit(await settledStep(paid, 'cancelled'), paid, {
        effect: 'unverified',
        amountCents: null,
        stripeReversalId: null,
      });
      expect((await failureOf(resolve(row.id, 'repay'))).context).toEqual({
        code: 'CREDIT_NEEDS_CHECK',
      });
    });
  });

  // ── Count it against this debt (Q11, OQ4) ───────────────────────────

  describe('Count it against this debt', () => {
    it("closes the step's own open debt and the credit in one transaction, re-paying nothing; a later won dispute still re-pays the payee", async () => {
      const disputeId = `dp_credit_${uid()}`;
      createdDisputeIds.push(disputeId);
      const paid = await slice('paid');
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: paid.stripeChargeId ?? '',
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        stripeCreatedAt: new Date(),
      });
      const step = await settledStep(paid, 'debt', {
        causeType: 'dispute',
        causeId: disputeId,
        amountCents: 700,
      });
      const review = await debtReview(step, paid, 700);
      const row = await credit(step, paid);

      const settled = await resolve(row.id, 'count_against_debt');

      expect(settled.credit).toMatchObject({ resolution: 'debt_collected' });
      expect(settled.repayPayout).toBeNull();
      expect(
        takeFirst(
          await db
            .select()
            .from(refundReviews)
            .where(eq(refundReviews.id, review.id))
        )
      ).toMatchObject({
        resolution: 'creator_absorbed',
        resolvedByUserId: supportId,
        resolutionNote: `Collected by a late take-back ${row.stripeReversalId}`,
      });
      expect((await readStep(step.id)).repaidByPayoutId).toBeNull();

      // The payee paid that debt, so the win pays it back (PAYEE_PAID_RESOLUTIONS).
      const won = await repayDispute(deps, { disputeId });
      expect(won.repaid).toBe(1);
      expect((await readStep(step.id)).repaidByPayoutId).not.toBeNull();
    });

    it('a debt of another amount is not counted (422 CREDIT_NOT_COUNTABLE): Re-pay pays what Stripe took, and the debt stays open (OQ4)', async () => {
      const paid = await slice('paid');
      const step = await settledStep(paid, 'debt');
      const review = await debtReview(step, paid, 765);
      const row = await credit(step, paid);

      expect(
        (await failureOf(resolve(row.id, 'count_against_debt'))).context
      ).toEqual({ code: 'CREDIT_NOT_COUNTABLE' });
      const repaid = await resolve(row.id, 'repay');

      expect(repaid.repayPayout?.amountCents).toBe(700);
      expect(
        takeFirst(
          await db
            .select()
            .from(refundReviews)
            .where(eq(refundReviews.id, review.id))
        ).resolvedAt
      ).toBeNull();
    });

    it('a debt settled meanwhile: 409 CREDIT_DEBT_ALREADY_CLOSED, and Re-pay is the action', async () => {
      const paid = await slice('paid');
      const step = await settledStep(paid, 'debt');
      const review = await debtReview(step, paid, 700);
      const row = await credit(step, paid);
      await db
        .update(refundReviews)
        .set({ resolution: 'platform_absorbed', resolvedAt: new Date() })
        .where(eq(refundReviews.id, review.id));

      const refused = await failureOf(resolve(row.id, 'count_against_debt'));
      expect(refused.statusCode).toBe(409);
      expect(refused.context).toEqual({ code: 'CREDIT_DEBT_ALREADY_CLOSED' });
      expect((await resolve(row.id, 'repay')).credit.resolution).toBe('repaid');
    });
  });

  // ── Not owed ────────────────────────────────────────────────────────

  it("Not owed closes it with support's note; a born-resolved transfer_kept answers a repeat", async () => {
    const paid = await slice('paid');
    const row = await credit(await settledStep(paid, 'cancelled'), paid);
    const closed = await resolve(row.id, 'not_owed', 'Paid back by hand');
    expect(closed.credit).toMatchObject({
      resolution: 'not_owed',
      resolutionNote: 'Paid back by hand',
      resolvedByUserId: supportId,
      repayPayoutId: null,
    });

    const cancelled = await slice('cancelled_by_refund');
    const kept = await credit(
      await settledStep(cancelled, 'cancelled'),
      cancelled,
      {
        effect: 'transfer_kept',
        amountCents: null,
        stripeReversalId: null,
        stripeTransferId: `tr_kept_${uid()}`,
      }
    );
    expect(kept).toMatchObject({
      resolution: 'not_owed',
      resolvedByUserId: null,
    });
    expect((await resolve(kept.id, 'not_owed', 'x')).repeated).toBe(true);
    expect((await failureOf(resolve(kept.id, 'repay'))).statusCode).toBe(409);
  });

  // ── Check Stripe again (§7.4) ───────────────────────────────────────

  describe('Check Stripe again', () => {
    async function unverified(
      on: Payout,
      step: PayoutReversal,
      transferId: string | null
    ) {
      return credit(step, on, {
        effect: 'unverified',
        amountCents: null,
        stripeReversalId: null,
        stripeTransferId: transferId,
      });
    }

    /** A transfer to the payee, as Stripe lists it, for `on`. */
    async function transferFor(on: Payout) {
      return (
        await stripe.transfers.create({
          amount: on.amountCents,
          currency: 'gbp',
          destination: accountId,
          metadata: { payout_id: on.id },
        })
      ).id;
    }

    it('a reversal naming the step on its transfer: owed what Stripe took', async () => {
      const paid = await slice('paid');
      const step = await settledStep(paid, 'cancelled');
      const row = await unverified(paid, step, paid.stripeTransferId);
      const trr = await stripe.transfers.createReversal(
        paid.stripeTransferId ?? '',
        { amount: 640, metadata: { payout_reversal_id: step.id } }
      );

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('owed');
      expect(checked.credit).toMatchObject({
        effect: 'reversal_landed',
        amountCents: 640,
        stripeReversalId: trr.id,
        resolution: null,
        checkedAt: expect.any(Date),
      });
    });

    it('a transfer step with no reversal found: closed not owed by the system', async () => {
      const paid = await slice('paid');
      const row = await unverified(
        paid,
        await settledStep(paid, 'cancelled'),
        paid.stripeTransferId
      );

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('not_owed');
      expect(checked.credit).toMatchObject({
        resolution: 'not_owed',
        resolvedByUserId: null,
        resolutionNote: 'Stripe shows nothing was taken',
      });
    });

    it('a cancelled slice no transfer went out for: owed the share, less its reductions', async () => {
      const cancelled = await slice('cancelled_by_refund');
      const step = await settledStep(cancelled, 'cancelled');
      await db.insert(payoutReversals).values({
        payoutId: cancelled.id,
        causeType: 'refund',
        causeId: `re_credit_${uid()}`,
        amountCents: 65,
        kind: 'pending_reduction',
        status: 'done',
      });
      const row = await unverified(cancelled, step, null);

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('owed');
      expect(checked.credit).toMatchObject({
        effect: 'slice_cancelled',
        amountCents: 700,
      });
    });

    it("a cancelled slice's transfer reversed in full: owed the share; one never reversed: the payee kept it", async () => {
      const reversed = await slice('cancelled_by_refund');
      const transferId = await transferFor(reversed);
      await stripe.transfers.createReversal(transferId, { metadata: {} });
      const owed = await recheckPayeeCredit(deps, {
        creditId: (
          await unverified(
            reversed,
            await settledStep(reversed, 'cancelled'),
            null
          )
        ).id,
      });
      expect(owed).toMatchObject({
        outcome: 'owed',
        credit: {
          effect: 'slice_cancelled',
          amountCents: 765,
          stripeTransferId: transferId,
        },
      });

      const kept = await slice('cancelled_by_refund');
      const keptTransfer = await transferFor(kept);
      const notOwed = await recheckPayeeCredit(deps, {
        creditId: (
          await unverified(kept, await settledStep(kept, 'cancelled'), null)
        ).id,
      });
      expect(notOwed).toMatchObject({
        outcome: 'not_owed',
        credit: {
          effect: 'transfer_kept',
          stripeTransferId: keptTransfer,
          resolution: 'not_owed',
          resolutionNote: 'The payee kept the transfer',
        },
      });
    });

    it('Stripe still cannot say: nothing changes but when it was checked', async () => {
      const paid = await slice('paid');
      const row = await unverified(
        paid,
        await settledStep(paid, 'cancelled'),
        paid.stripeTransferId
      );
      vi.mocked(stripe.transfers.listReversals).mockRejectedValueOnce(
        new Error('Stripe is down')
      );

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('still_unknown');
      expect(checked.credit).toMatchObject({
        effect: 'unverified',
        resolution: null,
        amountCents: null,
        checkedAt: expect.any(Date),
      });
      // An outage may pass: a warning, not an alert (review LOW-7).
      expect(obs.warn).toHaveBeenCalledWith(
        'Check Stripe again: Stripe could not say',
        expect.objectContaining({ creditId: row.id })
      );
      expect(obs.error).not.toHaveBeenCalled();
    });

    it('Stripe refuses to say (a definitive 4xx): still unknown, with an error alert for a person, as asking again will not help (review LOW-7)', async () => {
      const paid = await slice('paid');
      const row = await unverified(
        paid,
        await settledStep(paid, 'cancelled'),
        paid.stripeTransferId
      );
      vi.mocked(stripe.transfers.listReversals).mockRejectedValueOnce(
        Object.assign(new Error('No such transfer'), {
          statusCode: 404,
          type: 'StripeInvalidRequestError',
        })
      );

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('still_unknown');
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('Check it by hand'),
        expect.objectContaining({
          errorId: expect.any(String),
          creditId: row.id,
        })
      );
      expect(obs.warn).not.toHaveBeenCalledWith(
        'Check Stripe again: Stripe could not say',
        expect.anything()
      );
    });

    it('a database error reading the cancelled share is not "Stripe could not say": the check fails as itself, and nothing is written (review LOW-7)', async () => {
      const cancelled = await slice('cancelled_by_refund');
      const row = await unverified(
        cancelled,
        await settledStep(cancelled, 'cancelled'),
        null
      );
      // Every database read after Stripe answered fails: the share's is the
      // first.
      let armed = false;
      const listTransfers = vi
        .mocked(stripe.transfers.list)
        .getMockImplementation();
      vi.mocked(stripe.transfers.list).mockImplementation((async (
        ...args: unknown[]
      ) => {
        const page = await (
          listTransfers as (...a: unknown[]) => Promise<unknown>
        )(...args);
        armed = true;
        return page;
      }) as never);
      const faulty = new Proxy(db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (armed && prop === 'select') {
            return () => {
              throw new Error('injected select failure');
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      await expect(
        recheckPayeeCredit({ ...deps, db: faulty }, { creditId: row.id })
      ).rejects.toThrow('injected select failure');

      expect(armed).toBe(true);
      expect(obs.warn).not.toHaveBeenCalledWith(
        'Check Stripe again: Stripe could not say',
        expect.anything()
      );
      const [after] = await db
        .select()
        .from(payeeCredits)
        .where(eq(payeeCredits.id, row.id));
      expect(after).toMatchObject({
        effect: 'unverified',
        checkedAt: null,
        resolution: null,
      });
    });

    it('a cancellation another one of its kind could have made is never confirmed owed by a check: needs_person, alerted, and Stripe is not asked (review MED-3)', async () => {
      const cancelled = await slice('cancelled_by_refund');
      const step = await settledStep(cancelled, 'cancelled');
      await settledStep(cancelled, 'cancelled');
      const row = await unverified(cancelled, step, null);

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('needs_person');
      expect(checked.credit).toMatchObject({
        effect: 'unverified',
        resolution: null,
        checkedAt: expect.any(Date),
      });
      expect(stripe.transfers.list).not.toHaveBeenCalled();
      expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Check in Stripe, then re-pay or mark it not owed'
        ),
        expect.objectContaining({
          errorId: expect.any(String),
          creditId: row.id,
          payoutReversalId: step.id,
        })
      );
    });

    it("a slice the drain marked reversed since (Codex-2hxff.88): owed the share, read from the transfer it records, with no 'cannot tell' alert", async () => {
      const drained = await slice('cancelled_by_refund');
      const step = await settledStep(drained, 'cancelled');
      const transferId = await transferFor(drained);
      await stripe.transfers.createReversal(transferId, { metadata: {} });
      const [reversed] = await db
        .update(payouts)
        .set({ status: 'reversed', stripeTransferId: transferId })
        .where(eq(payouts.id, drained.id))
        .returning();
      const row = await unverified(reversed ?? drained, step, null);

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked).toMatchObject({
        outcome: 'owed',
        credit: {
          effect: 'slice_cancelled',
          amountCents: 765,
          stripeTransferId: transferId,
        },
      });
      expect(stripe.transfers.retrieve).toHaveBeenCalledWith(transferId);
      expect(obs.error).not.toHaveBeenCalled();
    });

    it('a row already confirmed or settled is returned as it stands', async () => {
      const paid = await slice('paid');
      const row = await credit(await settledStep(paid, 'cancelled'), paid);
      const checked = await recheckPayeeCredit(deps, { creditId: row.id });
      expect(checked).toEqual({ credit: row, outcome: 'owed' });
      expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
    });
  });

  // ── Check in Stripe, then decide (owner decision 2026-10-28, MED-3) ─

  describe('Check in Stripe, then decide (review MED-3)', () => {
    /**
     * A cancellation the ledger cannot attribute: another refund's
     * cancellation is on the slice, with no lease to tell them apart. The
     * share is 765 less a done reduction of 65.
     */
    async function forPerson() {
      const cancelled = await slice('cancelled_by_refund');
      const step = await settledStep(cancelled, 'cancelled');
      await settledStep(cancelled, 'cancelled');
      await db.insert(payoutReversals).values({
        payoutId: cancelled.id,
        causeType: 'refund',
        causeId: `re_credit_${uid()}`,
        amountCents: 65,
        kind: 'pending_reduction',
        status: 'done',
      });
      const row = await credit(step, cancelled, {
        effect: 'unverified',
        amountCents: null,
        stripeReversalId: null,
        stripeTransferId: null,
      });
      return { step, row };
    }

    it('Re-pay needs a note saying what Stripe showed, then pays the cancelled share once, linked on the step; a repeat writes nothing', async () => {
      const { step, row } = await forPerson();

      expect((await failureOf(resolve(row.id, 'repay'))).context).toEqual({
        code: 'CREDIT_NOTE_REQUIRED',
      });
      expect(
        (await failureOf(resolve(row.id, 'count_against_debt'))).context
      ).toEqual({ code: 'CREDIT_NOT_COUNTABLE' });
      const note = 'Stripe: nothing went out for it; this refund cancelled it';
      const paid = await resolve(row.id, 'repay', note);

      expect(paid.repayPayout).toMatchObject({
        status: 'pending',
        amountCents: 700,
        userId: payeeId,
      });
      expect(paid.credit).toMatchObject({
        effect: 'slice_cancelled',
        amountCents: 700,
        resolution: 'repaid',
        resolutionNote: note,
        resolvedByUserId: supportId,
        repayPayoutId: paid.repayPayout?.id,
      });
      expect((await readStep(step.id)).repaidByPayoutId).toBe(
        paid.repayPayout?.id
      );
      const again = await resolve(row.id, 'repay', note);
      expect(again.repeated).toBe(true);
      expect(again.repayPayout?.id).toBe(paid.repayPayout?.id);
    });

    it('Not owed closes it with the note, paying nothing', async () => {
      const { step, row } = await forPerson();

      const closed = await resolve(
        row.id,
        'not_owed',
        'Stripe: the other refund took it'
      );

      expect(closed).toMatchObject({
        repayPayout: null,
        credit: { resolution: 'not_owed', effect: 'unverified' },
      });
      expect((await readStep(step.id)).repaidByPayoutId).toBeNull();
    });

    it('any other unverified credit keeps its guard: Re-pay is CREDIT_NEEDS_CHECK, note or not', async () => {
      const cancelled = await slice('cancelled_by_refund');
      const row = await credit(
        await settledStep(cancelled, 'cancelled'),
        cancelled,
        {
          effect: 'unverified',
          amountCents: null,
          stripeReversalId: null,
          stripeTransferId: null,
        }
      );

      expect(
        (await failureOf(resolve(row.id, 'repay', 'Stripe shows it'))).context
      ).toEqual({ code: 'CREDIT_NEEDS_CHECK' });
    });
  });

  // ── a debt the payee paid, after a credit's re-pay (MED-4) ──────────

  // ── only an ambiguous sibling needs a person (round 2 MED-1, LOW-4) ─

  describe('needs_person only on a cancelled or reversed slice with an ambiguous sibling (round 2 MED-1)', () => {
    async function unverifiedOn(on: Payout, step: PayoutReversal) {
      return credit(step, on, {
        effect: 'unverified',
        amountCents: null,
        stripeReversalId: null,
        stripeTransferId: null,
      });
    }

    it.each([
      ['still pending', 'pending' as const],
      ['paid by the drain since', 'paid' as const],
    ])("the reviewer's case: a refund's cancellation threw before its cancel, so its slice is %s: an ordinary check, never Decide, and Re-pay is refused", async (_why, status) => {
      const charge = `ch_credit_${uid()}`;
      const untouched = takeFirst(
        await db
          .insert(payouts)
          .values({
            organizationId: orgId,
            userId: payeeId,
            payoutType: 'creator_payout',
            amountCents: 765,
            status,
            sourceType: 'subscription',
            stripeChargeId: charge,
            stripeTransferId: status === 'paid' ? `tr_credit_${uid()}` : null,
            resolvedAt: status === 'paid' ? new Date() : null,
          })
          .returning()
      );
      const step = await settledStep(untouched, 'cancelled', {
        kind: 'cancellation',
      });
      const row = await unverifiedOn(untouched, step);

      expect(await payeeCreditsNeedingAPerson(db, [row])).toEqual(new Map());
      expect(
        (await failureOf(resolve(row.id, 'repay', 'Stripe shows it'))).context
      ).toEqual({ code: 'CREDIT_NEEDS_CHECK' });
      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      // Read as a transfer step: no reversal names it, so nothing was taken.
      expect(checked).toMatchObject({
        outcome: 'not_owed',
        credit: { resolution: 'not_owed', repayPayoutId: null },
      });
      expect(obs.error).not.toHaveBeenCalled();
    });

    it("the other cause's variant: a dispute cancelled the slice (and its win re-pays it); this refund's cancellation never took it, so a check reads it as a transfer step and Re-pay is refused", async () => {
      const cancelled = await slice('cancelled_by_dispute');
      await settledStep(cancelled, 'done', {
        causeType: 'dispute',
        causeId: `dp_credit_${uid()}`,
      });
      const step = await settledStep(cancelled, 'cancelled');
      const row = await unverifiedOn(cancelled, step);

      expect(await payeeCreditsNeedingAPerson(db, [row])).toEqual(new Map());
      expect(
        (await failureOf(resolve(row.id, 'repay', 'Stripe shows it'))).context
      ).toEqual({ code: 'CREDIT_NEEDS_CHECK' });
      const checked = await recheckPayeeCredit(deps, { creditId: row.id });
      expect(checked.outcome).toBe('not_owed');
      expect(stripe.transfers.list).not.toHaveBeenCalled();
    });

    it.each([
      ['done', { status: 'done' as const }],
      ['already re-paid', { repaid: true }],
    ])('an ambiguous sibling that is %s: listed for settling by hand, and Re-pay is refused even with a note', async (_why, sibling) => {
      const cancelled = await slice('cancelled_by_refund');
      const step = await settledStep(cancelled, 'cancelled');
      const repayRow =
        'repaid' in sibling
          ? takeFirst(
              await db
                .insert(payouts)
                .values({
                  organizationId: orgId,
                  userId: payeeId,
                  payoutType: 'creator_payout',
                  amountCents: 765,
                  status: 'pending',
                  sourceType: 'subscription',
                })
                .returning()
            )
          : undefined;
      await settledStep(cancelled, 'status' in sibling ? 'done' : 'cancelled', {
        repaidByPayoutId: repayRow?.id ?? null,
      });
      const row = await unverifiedOn(cancelled, step);

      expect(await payeeCreditsNeedingAPerson(db, [row])).toEqual(
        new Map([[row.id, { siblingTook: true, siblingRunning: false }]])
      );
      const refused = await failureOf(
        resolve(row.id, 'repay', 'Stripe: one of them took it')
      );
      expect(refused.context).toEqual({ code: 'CREDIT_SETTLE_BY_HAND' });
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('may be paid back twice'),
        expect.objectContaining({
          errorId: expect.any(String),
          creditId: row.id,
        })
      );
      expect((await readStep(step.id)).repaidByPayoutId).toBeNull();
    });

    it.each([
      ['pending', 'pending' as const, 0, false],
      ['failed with retries left', 'failed' as const, 1, false],
      [
        'failed out of attempts',
        'failed' as const,
        MAX_CLAWBACK_ATTEMPTS,
        true,
      ],
    ])('a sibling that is %s (round 3 LOW-1): Re-pay waits while it can still finish, then goes ahead once it cannot', async (_why, status, attempt, repays) => {
      const cancelled = await slice('cancelled_by_refund');
      const step = await settledStep(cancelled, 'cancelled');
      await settledStep(cancelled, 'cancelled', {
        status,
        attempt,
        resolvedAt: null,
      });
      const row = await unverifiedOn(cancelled, step);
      const note = 'Stripe: this refund took it';

      if (repays) {
        expect(
          (await resolve(row.id, 'repay', note)).repayPayout
        ).toMatchObject({
          amountCents: 765,
        });
        return;
      }
      const refused = await failureOf(resolve(row.id, 'repay', note));
      expect(refused.statusCode).toBe(422);
      expect(refused.context).toEqual({ code: 'CREDIT_SIBLING_UNFINISHED' });
      expect((await readStep(step.id)).repaidByPayoutId).toBeNull();
    });

    /**
     * A database whose transactions pause once, right after their first
     * locking read of `payout_reversals`, until two have got there or
     * `waitMs` passes: two Re-pays then hold their first step locks at once,
     * which is what a deadlock needs. Deterministic either way: locked in one
     * id-ordered read, the second cannot get there, and the first goes on.
     */
    function pausingAfterStepLock(waitMs: number): Database {
      let arrived = 0;
      let release: () => void = () => undefined;
      const both = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pause = async () => {
        arrived += 1;
        if (arrived >= 2) release();
        await Promise.race([
          both,
          new Promise((resolve) => setTimeout(resolve, waitMs)),
        ]);
      };
      type Query = { onSteps: boolean; locking: boolean };
      const wrap = (
        target: object,
        query: Query,
        tx: { paused: boolean }
      ): object =>
        new Proxy(target, {
          get(inner, prop) {
            const value = Reflect.get(inner, prop, inner);
            if (typeof value !== 'function') return value;
            if (prop === 'then') {
              return (
                onFulfilled: (rows: unknown) => unknown,
                onRejected: (error: unknown) => unknown
              ) =>
                (value as (f: (rows: unknown) => unknown) => Promise<unknown>)
                  .call(inner, async (rows: unknown) => {
                    if (query.onSteps && query.locking && !tx.paused) {
                      tx.paused = true;
                      await pause();
                    }
                    return rows;
                  })
                  .then(onFulfilled, onRejected);
            }
            return (...args: unknown[]) => {
              if (prop === 'from') query.onSteps = args[0] === payoutReversals;
              if (prop === 'for') query.locking = args[0] === 'update';
              const result = (value as (...a: unknown[]) => unknown).apply(
                inner,
                args
              );
              return result && typeof result === 'object'
                ? wrap(result, query, tx)
                : result;
            };
          },
        });
      return new Proxy(db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'transaction') {
            return (
              fn: (tx: unknown) => Promise<unknown>,
              ...rest: unknown[]
            ) =>
              (
                value as (
                  f: (tx: object) => Promise<unknown>,
                  ...r: unknown[]
                ) => Promise<unknown>
              ).call(
                target,
                (tx: object) => {
                  const state = { paused: false };
                  return fn(
                    new Proxy(tx, {
                      get(inner, key) {
                        const member = Reflect.get(inner, key, inner);
                        if (key === 'select' && typeof member === 'function') {
                          return (...args: unknown[]) =>
                            wrap(
                              (member as (...a: unknown[]) => object).apply(
                                inner,
                                args
                              ),
                              { onSteps: false, locking: false },
                              state
                            );
                        }
                        return typeof member === 'function'
                          ? member.bind(inner)
                          : member;
                      },
                    })
                  );
                },
                ...rest
              );
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as Database;
    }

    it('two Re-pays at once on sibling needs-person credits (round 3 LOW-2): one pays, the other is refused cleanly (never a deadlock), and the share is paid once', async () => {
      const cancelled = await slice('cancelled_by_refund');
      const first = await settledStep(cancelled, 'cancelled');
      const second = await settledStep(cancelled, 'cancelled');
      const [a, b] = [
        await unverifiedOn(cancelled, first),
        await unverifiedOn(cancelled, second),
      ];
      const racing = { ...deps, db: pausingAfterStepLock(1500) };
      const repay = (creditId: string) =>
        resolvePayeeCredit(racing, {
          creditId,
          action: 'repay',
          note: 'Stripe: this refund took it',
          resolvedByUserId: supportId,
        });

      const results = await Promise.allSettled([repay(a.id), repay(b.id)]);

      const paid = results.filter((r) => r.status === 'fulfilled');
      const refused = results.flatMap((r) =>
        r.status === 'rejected' ? [r.reason as ServiceError] : []
      );
      expect(paid).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.statusCode).toBe(422);
      expect(refused[0]?.context).toEqual({ code: 'CREDIT_SETTLE_BY_HAND' });
      const links = [
        (await readStep(first.id)).repaidByPayoutId,
        (await readStep(second.id)).repaidByPayoutId,
      ].filter((link) => link !== null);
      expect(links).toHaveLength(1);
    });

    it('a reversed slice whose recorded transfer Stripe says is NOT reversed in full: the check says still_unknown and alerts, as resolve answers CREDIT_NEEDS_CHECK (round 2 LOW-4)', async () => {
      const drained = await slice('cancelled_by_refund');
      const step = await settledStep(drained, 'cancelled');
      // A transfer Stripe never reversed, though the ledger says it was.
      const transferId = (
        await stripe.transfers.create({
          amount: 765,
          currency: 'gbp',
          destination: accountId,
          metadata: { payout_id: drained.id },
        })
      ).id;
      const [reversed] = await db
        .update(payouts)
        .set({ status: 'reversed', stripeTransferId: transferId })
        .where(eq(payouts.id, drained.id))
        .returning();
      const row = await unverifiedOn(reversed ?? drained, step);

      const checked = await recheckPayeeCredit(deps, { creditId: row.id });

      expect(checked.outcome).toBe('still_unknown');
      expect(obs.error).toHaveBeenCalledWith(
        expect.stringContaining('Stripe says it is not'),
        expect.objectContaining({
          errorId: expect.any(String),
          creditId: row.id,
        })
      );
      expect(await payeeCreditsNeedingAPerson(db, [row])).toEqual(new Map());
      expect(
        (await failureOf(resolve(row.id, 'repay', 'Stripe shows it'))).context
      ).toEqual({ code: 'CREDIT_NEEDS_CHECK' });
    });
  });

  describe("a debt's own re-pay after a credit's re-pay on its step (review MED-4)", () => {
    /**
     * A £10 take-back refused for the payee's balance (a debt), then £6 of
     * it taken late anyway: re-paid (OQ4), the debt left open; then the
     * payee pays the £10.
     */
    async function debtPaidAfterCredit(causeType: 'dispute' | 'refund') {
      const chargeId = `ch_credit_${uid()}`;
      const paid = takeFirst(
        await db
          .insert(payouts)
          .values({
            organizationId: orgId,
            userId: payeeId,
            payoutType: 'creator_payout',
            amountCents: 1000,
            status: 'paid',
            sourceType: 'subscription',
            stripeChargeId: chargeId,
            stripeTransferId: `tr_credit_${uid()}`,
            resolvedAt: new Date(Date.now() - 60 * 60_000),
          })
          .returning()
      );
      const causeId = `${causeType === 'dispute' ? 'dp' : 're'}_credit_${uid()}`;
      const step = await settledStep(paid, 'debt', {
        causeType,
        causeId,
        amountCents: 1000,
      });
      const review = await debtReview(step, paid, 1000);
      const row = await credit(step, paid, { amountCents: 600 });
      const creditRepay = await resolve(row.id, 'repay');
      expect(creditRepay.repayPayout?.amountCents).toBe(600);
      await db
        .update(refundReviews)
        .set({
          resolution: 'creator_absorbed',
          resolvedAt: new Date(),
          resolvedByUserId: supportId,
        })
        .where(eq(refundReviews.id, review.id));
      return { paid, chargeId, causeId, step, row, creditRepay };
    }

    async function payoutRow(id: string | null): Promise<Payout> {
      return takeFirst(
        await db
          .select()
          .from(payouts)
          .where(eq(payouts.id, id ?? ''))
      );
    }

    it('the dispute is won: the £10 the payee paid is still re-paid, once; the credit keeps its £6 re-pay', async () => {
      const { chargeId, causeId, step, row, creditRepay } =
        await debtPaidAfterCredit('dispute');
      createdDisputeIds.push(causeId);
      await db.insert(disputes).values({
        stripeDisputeId: causeId,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        stripeCreatedAt: new Date(),
      });

      const won = await repayDispute(deps, { disputeId: causeId });

      expect(won.repaid).toBe(1);
      const after = await readStep(step.id);
      expect(after.repaidByPayoutId).not.toBe(creditRepay.repayPayout?.id);
      expect(await payoutRow(after.repaidByPayoutId)).toMatchObject({
        status: 'pending',
        amountCents: 1000,
        userId: payeeId,
      });
      expect(
        takeFirst(
          await db
            .select()
            .from(payeeCredits)
            .where(eq(payeeCredits.id, row.id))
        )
      ).toMatchObject({
        resolution: 'repaid',
        repayPayoutId: creditRepay.repayPayout?.id,
      });
      // A redelivery writes nothing more.
      expect((await repayDispute(deps, { disputeId: causeId })).repaid).toBe(0);
      expect((await readStep(step.id)).repaidByPayoutId).toBe(
        after.repaidByPayoutId
      );
    });

    it.each([
      ['won', null, true],
      ['lost', null, false],
      ['lost', 'set', true],
    ] as const)("the credit's £6 re-pay, once the debt's re-pay took the step's link, is still held while a later dispute of the charge holds it; once that one is %s (outcome applied: %s), drainable: %s", async (status, outcomeAppliedAt, released) => {
      const { chargeId, causeId, creditRepay } =
        await debtPaidAfterCredit('dispute');
      createdDisputeIds.push(causeId);
      await db.insert(disputes).values({
        stripeDisputeId: causeId,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        outcomeAppliedAt: new Date(),
        stripeCreatedAt: new Date(),
      });
      expect((await repayDispute(deps, { disputeId: causeId })).repaid).toBe(1);
      const repayId = creditRepay.repayPayout?.id ?? '';
      const drainable = async () =>
        (
          await db
            .select({ id: payouts.id })
            .from(payouts)
            .where(and(eq(payouts.id, repayId), isDrainablePayout()))
        ).length === 1;
      expect(await drainable()).toBe(true);

      // A second dispute of the same charge, which Stripe allows.
      const later = `dp_credit_${uid()}`;
      createdDisputeIds.push(later);
      await db.insert(disputes).values({
        stripeDisputeId: later,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'needs_response',
        stripeCreatedAt: new Date(),
      });
      expect(await drainable()).toBe(false);

      await db
        .update(disputes)
        .set({
          status,
          outcomeAppliedAt: outcomeAppliedAt === 'set' ? new Date() : null,
        })
        .where(eq(disputes.stripeDisputeId, later));
      expect(await drainable()).toBe(released);
    });

    it("the other order (round 2 LOW-3): the won dispute re-pays the £10 first, then a £6 late take-back's Re-pay still goes ahead, unlinked, carried by its credit", async () => {
      const chargeId = `ch_credit_${uid()}`;
      const paid = takeFirst(
        await db
          .insert(payouts)
          .values({
            organizationId: orgId,
            userId: payeeId,
            payoutType: 'creator_payout',
            amountCents: 1000,
            status: 'paid',
            sourceType: 'subscription',
            stripeChargeId: chargeId,
            stripeTransferId: `tr_credit_${uid()}`,
            resolvedAt: new Date(Date.now() - 60 * 60_000),
          })
          .returning()
      );
      const disputeId = `dp_credit_${uid()}`;
      createdDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        outcomeAppliedAt: new Date(),
        stripeCreatedAt: new Date(),
      });
      const step = await settledStep(paid, 'debt', {
        causeType: 'dispute',
        causeId: disputeId,
        amountCents: 1000,
      });
      const review = await debtReview(step, paid, 1000);
      await db
        .update(refundReviews)
        .set({
          resolution: 'creator_absorbed',
          resolvedAt: new Date(),
          resolvedByUserId: supportId,
        })
        .where(eq(refundReviews.id, review.id));
      expect((await repayDispute(deps, { disputeId })).repaid).toBe(1);
      const debtRepay = (await readStep(step.id)).repaidByPayoutId;
      expect((await payoutRow(debtRepay)).amountCents).toBe(1000);
      const row = await credit(step, paid, { amountCents: 600 });

      const late = await resolve(row.id, 'repay');

      expect(late.repayPayout).toMatchObject({
        status: 'pending',
        amountCents: 600,
        userId: payeeId,
      });
      expect(late.credit).toMatchObject({
        resolution: 'repaid',
        repayPayoutId: late.repayPayout?.id,
      });
      // The step keeps the debt's link; the credit carries its own.
      expect((await readStep(step.id)).repaidByPayoutId).toBe(debtRepay);
      expect(
        await db
          .select({ id: payouts.id })
          .from(payouts)
          .where(
            and(eq(payouts.id, late.repayPayout?.id ?? ''), isDrainablePayout())
          )
      ).toEqual([{ id: late.repayPayout?.id }]);
      const again = await resolve(row.id, 'repay');
      expect(again).toMatchObject({
        repeated: true,
        repayPayout: { id: late.repayPayout?.id },
      });
    });

    it("the credit's Re-pay lands between repayDispute's read and its debt's write (round 2 LOW-2): the link is read under the lock, so the £10 is still re-paid", async () => {
      const chargeId = `ch_credit_${uid()}`;
      const paid = takeFirst(
        await db
          .insert(payouts)
          .values({
            organizationId: orgId,
            userId: payeeId,
            payoutType: 'creator_payout',
            amountCents: 1000,
            status: 'paid',
            sourceType: 'subscription',
            stripeChargeId: chargeId,
            stripeTransferId: `tr_credit_${uid()}`,
            resolvedAt: new Date(Date.now() - 60 * 60_000),
          })
          .returning()
      );
      const disputeId = `dp_credit_${uid()}`;
      createdDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        outcomeAppliedAt: new Date(),
        stripeCreatedAt: new Date(),
      });
      const step = await settledStep(paid, 'debt', {
        causeType: 'dispute',
        causeId: disputeId,
        amountCents: 1000,
      });
      const review = await debtReview(step, paid, 1000);
      await db
        .update(refundReviews)
        .set({
          resolution: 'creator_absorbed',
          resolvedAt: new Date(),
          resolvedByUserId: supportId,
        })
        .where(eq(refundReviews.id, review.id));
      const row = await credit(step, paid, { amountCents: 600 });
      // repayDispute reads the steps (no link yet), then the credit's
      // Re-pay links its £6 before the debt's own transaction starts.
      let creditRepay: string | undefined;
      const racing = new Proxy(db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'transaction' && creditRepay === undefined) {
            return async (...args: unknown[]) => {
              creditRepay =
                (await resolve(row.id, 'repay')).repayPayout?.id ?? '';
              return (value as (...a: unknown[]) => Promise<unknown>).apply(
                target,
                args
              );
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      const won = await repayDispute({ ...deps, db: racing }, { disputeId });

      expect(creditRepay).toEqual(expect.any(String));
      expect(won.repaid).toBe(1);
      const after = await readStep(step.id);
      expect(after.repaidByPayoutId).not.toBe(creditRepay);
      expect((await payoutRow(after.repaidByPayoutId)).amountCents).toBe(1000);
    });

    it('the refund fails and support settles it creators_repaid: the £10 the payee paid is still re-paid', async () => {
      const { chargeId, causeId, step, creditRepay } =
        await debtPaidAfterCredit('refund');
      createdRefundIds.push(causeId);
      await db.insert(refunds).values({
        stripeRefundId: causeId,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
        stripeCreatedAt: new Date(),
      });
      const settle = () =>
        db.transaction((tx) =>
          repayFailedRefund(tx, {
            stripeRefundId: causeId,
            resolvedByUserId: supportId,
            note: 'Re-pay',
            now: new Date(),
            chargeAmountCents: 1000,
          })
        );

      const { repaid } = await settle();

      expect(repaid).toEqual([
        expect.objectContaining({ payeeUserId: payeeId, amountCents: 1000 }),
      ]);
      const after = await readStep(step.id);
      expect(after.repaidByPayoutId).toBe(repaid[0]?.payoutId);
      expect(after.repaidByPayoutId).not.toBe(creditRepay.repayPayout?.id);
      expect((await settle()).repaid).toEqual([]);
    });
  });

  // ── the engine after a credit's re-pay (§7.5) ───────────────────────

  describe("the engine after a credit's re-pay", () => {
    it('a later cause on a slice_cancelled slice takes its share off the re-pay row, and the drain holds that row while the charge has an open dispute', async () => {
      const chargeId = `ch_credit_${uid()}`;
      const cancelled = await slice('cancelled_by_refund', chargeId);
      const step = await settledStep(cancelled, 'cancelled');
      const row = await credit(step, cancelled, {
        effect: 'slice_cancelled',
        amountCents: 765,
        stripeReversalId: null,
        stripeTransferId: null,
      });
      const { repayPayout } = await resolve(row.id, 'repay');
      if (!repayPayout) throw new Error('expected a re-pay row');

      const later = {
        id: `re_credit_${uid()}`,
        amountCents: 400,
        createdAt: 9,
      };
      await reverseCharge(deps, {
        charge: { id: chargeId, amountCents: 1000 },
        source: { sourceType: 'subscription' },
        refunds: [later],
      });

      const onRepay = await db
        .select()
        .from(payoutReversals)
        .where(eq(payoutReversals.payoutId, repayPayout.id));
      expect(onRepay).toEqual([
        expect.objectContaining({
          causeId: later.id,
          kind: 'pending_reduction',
          amountCents: 306,
          status: 'done',
        }),
      ]);
      // Not a slice of the charge: nothing was recorded on it as one.
      expect(
        await db
          .select({ id: payoutReversals.id })
          .from(payoutReversals)
          .where(
            and(
              eq(payoutReversals.payoutId, cancelled.id),
              eq(payoutReversals.causeId, later.id)
            )
          )
      ).toEqual([]);

      const drainable = () =>
        db
          .select({ id: payouts.id })
          .from(payouts)
          .where(and(eq(payouts.id, repayPayout.id), isDrainablePayout()));
      expect(await drainable()).toEqual([{ id: repayPayout.id }]);
      const disputeId = `dp_credit_${uid()}`;
      createdDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'needs_response',
        stripeCreatedAt: new Date(),
      });
      expect(await drainable()).toEqual([]);
    });
  });
});
