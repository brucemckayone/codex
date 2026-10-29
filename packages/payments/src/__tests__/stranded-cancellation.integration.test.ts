/**
 * The system decides a stranded clawback cancellation (Codex-2hxff.71; owner
 * decision Q6, 2026-10-27, "The system decides"; data design §6). A
 * `cancellation` step whose delivery died after it may have cancelled its
 * slice is settled by one rule on both paths, a failed refund's
 * `creators_repaid` settlement and a won dispute's re-pay:
 *
 * - `tookTheSlice` says whether this step cancelled the slice;
 * - Stripe then says whether money went out for it, and whether it is back.
 *
 * Plus §6.4: the cron retry of a cancellation that took its slice asks Stripe
 * for a late transfer, and reverses one it finds.
 */

import {
  disputes,
  organizations,
  type Payout,
  type PayoutReversal,
  payeeCredits,
  payoutReversals,
  payouts,
  refunds,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  type BusinessLogicError,
  ServiceUnavailableError,
} from '@codex/service-errors';
import {
  createMockStripe,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, or } from 'drizzle-orm';
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
  retryFailedClawbacks,
  sliceTakenBy,
  tookTheSlice,
} from '../clawback';
import {
  repayDispute,
  repayFailedRefund,
  reportPayeeKept,
  type StrandedStep,
  settleUnfinishedRefundSteps,
} from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);
const NOTE = 'Customer kept the course; payees paid back';
const HOUR_AGO = () => new Date(Date.now() - 60 * 60_000);

describe('tookTheSlice (the rule, §6.1)', () => {
  const at = new Date('2026-10-28T10:00:00.000Z');
  const step = {
    id: 'step',
    kind: 'cancellation',
    causeType: 'refund',
    attemptedAt: at,
  };
  const sibling = { id: 'other', kind: 'cancellation', causeType: 'refund' };
  const cancelled = { status: 'cancelled_by_refund', resolvedAt: at };

  it.each([
    [
      'the lease matches, though a sibling exists',
      step,
      cancelled,
      [sibling],
      true,
    ],
    [
      'the sole cancellation of its cause type, with no lease',
      { ...step, attemptedAt: null },
      cancelled,
      [],
      true,
    ],
    [
      'a sibling of another cause type does not count',
      { ...step, attemptedAt: null },
      cancelled,
      [{ ...sibling, causeType: 'dispute' }],
      true,
    ],
    [
      'a sibling of its cause type and no matching lease',
      { ...step, attemptedAt: new Date(at.getTime() + 1) },
      cancelled,
      [sibling],
      false,
    ],
    [
      'the slice was cancelled by the other cause type',
      step,
      { ...cancelled, status: 'cancelled_by_dispute' },
      [],
      false,
    ],
    [
      'the step is not a cancellation',
      { ...step, kind: 'transfer_reversal' },
      cancelled,
      [],
      false,
    ],
  ])('%s', (_name, s, slice, steps, expected) => {
    expect(tookTheSlice(s, slice, steps)).toBe(expected);
  });
});

describe('sliceTakenBy: a slice the drain marked reversed too (Codex-2hxff.88)', () => {
  const step = {
    id: 'step',
    kind: 'cancellation',
    causeType: 'refund',
    attemptedAt: null,
  };
  const reversed = {
    status: 'reversed',
    resolvedAt: new Date(),
    stripeTransferId: 'tr_drain',
  };

  it.each([
    [
      'cancelled by its cause type: the cancel took it',
      { ...reversed, status: 'cancelled_by_refund', stripeTransferId: null },
      [],
      { by: 'cancel' },
    ],
    [
      'reversed, its transfer recorded, the only cancellation on it',
      reversed,
      [],
      { by: 'reversed', transferId: 'tr_drain' },
    ],
    [
      'reversed, with a cancellation of another cause on it too',
      reversed,
      [{ id: 'other', kind: 'cancellation', causeType: 'dispute' }],
      null,
    ],
    [
      "reversed, with another cause's transfer reversal on it",
      reversed,
      [{ id: 'other', kind: 'transfer_reversal', causeType: 'dispute' }],
      null,
    ],
    [
      'reversed, a reduction only beside it',
      reversed,
      [{ id: 'other', kind: 'pending_reduction', causeType: 'dispute' }],
      { by: 'reversed', transferId: 'tr_drain' },
    ],
    [
      'reversed, but no transfer recorded',
      { ...reversed, stripeTransferId: null },
      [],
      null,
    ],
  ])('%s', (_name, slice, steps, expected) => {
    expect(sliceTakenBy(step, slice, steps)).toEqual(expected);
  });
});

describe('a stranded cancellation, decided by the system (Codex-2hxff.71)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let payeeId: string;
  let supportId: string;
  let orgId: string;
  let accountId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdRefundIds: string[] = [];
  const createdDisputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [payeeId, supportId] = await seedTestUsers(db, 2);
    accountId = `acct_strand_${uid()}`;
    // A Connect account, so the decision asks Stripe for a late transfer.
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
        .values({ name: 'Stranded Org', slug: createUniqueSlug('strand') })
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
    if (createdRefundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, createdRefundIds));
    }
    if (createdDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, createdDisputeIds));
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

  /** A slice a cause already cancelled, at `cancelledAt`. */
  async function cancelledSlice(
    status: 'cancelled_by_refund' | 'cancelled_by_dispute',
    cancelledAt: Date,
    chargeId = `ch_strand_${uid()}`
  ): Promise<Payout> {
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
          reason: 'connect_not_ready',
          resolvedAt: cancelledAt,
        })
        .returning()
    );
  }

  /**
   * A cancellation no retry will run: `failed` out of attempts (no lease),
   * or `pending` with the lease its cancel wrote (`attemptedAt`).
   */
  async function strandedStep(
    slice: Payout,
    causeType: 'refund' | 'dispute',
    causeId: string,
    leasedAt: Date | null = null
  ): Promise<PayoutReversal> {
    return takeFirst(
      await db
        .insert(payoutReversals)
        .values({
          payoutId: slice.id,
          causeType,
          causeId,
          amountCents: slice.amountCents,
          kind: 'cancellation',
          ...(leasedAt
            ? { status: 'pending', attemptedAt: leasedAt }
            : { status: 'failed', attempt: MAX_CLAWBACK_ATTEMPTS }),
        })
        .returning()
    );
  }

  async function failedRefund(chargeId: string): Promise<string> {
    const id = `re_strand_${uid()}`;
    createdRefundIds.push(id);
    await db.insert(refunds).values({
      stripeRefundId: id,
      stripeChargeId: chargeId,
      amountCents: 1000,
      currency: 'gbp',
      status: 'failed',
      failureReason: 'expired_or_canceled_card',
      stripeCreatedAt: new Date(),
    });
    return id;
  }

  async function wonDispute(chargeId: string): Promise<string> {
    const id = `dp_strand_${uid()}`;
    createdDisputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: chargeId,
      amountCents: 1000,
      currency: 'gbp',
      status: 'won',
      stripeCreatedAt: new Date(),
    });
    return id;
  }

  /** A transfer a drain made for the slice anyway, as Stripe lists it. */
  async function lateTransfer(slice: Payout): Promise<string> {
    const transfer = await stripe.transfers.create({
      amount: slice.amountCents,
      currency: 'gbp',
      destination: accountId,
      metadata: { payout_id: slice.id },
    });
    return transfer.id;
  }

  /**
   * As the drain's own settle leaves a cancelled slice it paid anyway
   * (`recordCancelledRowReversed`): the transfer reversed in full by a
   * reversal naming no step, and the slice `reversed` with it recorded.
   */
  async function drainReversed(slice: Payout): Promise<string> {
    const transferId = await lateTransfer(slice);
    await reverseWhole(transferId);
    await db
      .update(payouts)
      .set({ status: 'reversed', stripeTransferId: transferId })
      .where(eq(payouts.id, slice.id));
    return transferId;
  }

  /** A reversal of the whole transfer, naming `stepId` or nothing. */
  async function reverseWhole(transferId: string, stepId?: string) {
    return stripe.transfers.createReversal(transferId, {
      metadata: stepId ? { payout_reversal_id: stepId } : {},
    });
  }

  /**
   * Support's settlement, as the route runs it: one transaction, then the
   * payee-kept alerts once it has committed (`reportPayeeKept`).
   */
  async function settle(refundId: string, unlanded: readonly StrandedStep[]) {
    const now = new Date();
    const { repaid, payeeKept } = await db.transaction(async (tx) => {
      const result = await repayFailedRefund(tx, {
        stripeRefundId: refundId,
        resolvedByUserId: supportId,
        note: NOTE,
        now,
        chargeAmountCents: 1000,
        unlanded,
      });
      await tx
        .update(refunds)
        .set({
          resolution: 'creators_repaid',
          resolvedAt: now,
          resolvedByUserId: supportId,
          resolutionNote: NOTE,
        })
        .where(eq(refunds.stripeRefundId, refundId));
      return result;
    });
    reportPayeeKept(obs, { stripeRefundId: refundId }, payeeKept);
    return repaid;
  }

  async function readStep(id: string): Promise<PayoutReversal> {
    return takeFirst(
      await db.select().from(payoutReversals).where(eq(payoutReversals.id, id))
    );
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function creditOf(stepId: string) {
    const [credit] = await db
      .select()
      .from(payeeCredits)
      .where(eq(payeeCredits.payoutReversalId, stepId));
    return credit;
  }

  /** The errorId of the error alert naming `stepId`. */
  function alertIdFor(stepId: string, message: RegExp): unknown {
    const call = obs.error.mock.calls.find(
      ([text, metadata]) =>
        message.test(String(text)) &&
        (metadata as Record<string, unknown>).payoutReversalId === stepId
    );
    return (call?.[1] as Record<string, unknown> | undefined)?.errorId;
  }

  // ── the refund path ─────────────────────────────────────────────────

  describe("a failed refund's settlement", () => {
    it('no transfer went out: done as the system took the share, and re-paid (was NEEDS_PERSON)', async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toEqual({
        landed: 0,
        decided: [slice.id],
        unlanded: [],
        forPerson: 0,
      });
      const repaid = await settle(refundId, checked.unlanded);

      expect(await readStep(step.id)).toMatchObject({
        status: 'done',
        lastErrorCode: 'system_took_share',
      });
      expect(repaid).toEqual([
        expect.objectContaining({ payeeUserId: payeeId, amountCents: 765 }),
      ]);
      expect((await readRow(slice.id)).status).toBe('cancelled_by_refund');
    });

    it('a transfer went out and a reversal naming the step landed: done with it, the slice reversed, and re-paid', async () => {
      const cancelledAt = HOUR_AGO();
      const slice = await cancelledSlice('cancelled_by_refund', cancelledAt);
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      // The lease its cancel wrote: the step is the one that took the slice.
      const step = await strandedStep(slice, 'refund', refundId, cancelledAt);
      const transferId = await lateTransfer(slice);
      const reversal = await reverseWhole(transferId, step.id);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toMatchObject({ decided: [slice.id], unlanded: [] });
      const repaid = await settle(refundId, checked.unlanded);

      expect(await readStep(step.id)).toMatchObject({
        status: 'done',
        lastErrorCode: 'system_took_share',
        stripeReversalId: reversal.id,
      });
      expect(await readRow(slice.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: transferId,
      });
      expect(repaid).toEqual([expect.objectContaining({ amountCents: 765 })]);
    });

    it("the drain's own settle reversed the transfer in full and marked the slice reversed (Codex-2hxff.88): done from the transfer it records, re-paid", async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      const transferId = await drainReversed(slice);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toEqual({
        landed: 0,
        decided: [slice.id],
        unlanded: [],
        forPerson: 0,
      });
      const repaid = await settle(refundId, checked.unlanded);

      expect(await readStep(step.id)).toMatchObject({
        status: 'done',
        lastErrorCode: 'system_took_share',
        stripeReversalId: null,
      });
      expect(await readRow(slice.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: transferId,
      });
      expect(repaid).toEqual([expect.objectContaining({ amountCents: 765 })]);
      // The transfer the slice records, not a search for one.
      expect(stripe.transfers.retrieve).toHaveBeenCalledWith(transferId);
      expect(stripe.transfers.list).not.toHaveBeenCalled();
    });

    it("a reversed slice with another cause's step on it: the rule fails, so a person decides (NEEDS_PERSON), never a silent cancel", async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      await strandedStep(slice, 'dispute', `dp_strand_other_${uid()}`);
      await drainReversed(slice);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toMatchObject({
        decided: [],
        unlanded: [],
        forPerson: 1,
      });
      const error = await settle(refundId, checked.unlanded).catch(
        (e: unknown) => e
      );

      expect((error as BusinessLogicError).context).toMatchObject({
        code: 'REFUND_CLAWBACK_NEEDS_PERSON',
      });
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it('a reversed slice, and Stripe cannot be asked about its transfer: left as it is, and the settlement says try again later', async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      await drainReversed(slice);
      vi.mocked(stripe.transfers.retrieve).mockRejectedValue(
        Object.assign(new Error('timed out'), { type: 'StripeConnectionError' })
      );

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toMatchObject({
        decided: [],
        unlanded: [],
        forPerson: 0,
      });
      const error = await settle(refundId, checked.unlanded).catch(
        (e: unknown) => e
      );

      expect((error as BusinessLogicError).context).toMatchObject({
        code: 'REFUND_CLAWBACK_UNFINISHED',
      });
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it('a transfer went out and a reversal naming no step took it all back, the slice still cancelled: done, the slice reversed, and re-paid', async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      const transferId = await lateTransfer(slice);
      await reverseWhole(transferId);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toMatchObject({ decided: [slice.id], unlanded: [] });
      const repaid = await settle(refundId, checked.unlanded);

      expect(await readStep(step.id)).toMatchObject({
        status: 'done',
        lastErrorCode: 'system_took_share',
        stripeReversalId: null,
      });
      expect((await readRow(slice.id)).status).toBe('reversed');
      expect(repaid).toEqual([expect.objectContaining({ amountCents: 765 })]);
    });

    it('a transfer went out and was never reversed: the payee kept it, so the step is cancelled with a born-resolved credit and an alert, and nothing is re-paid', async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      const transferId = await lateTransfer(slice);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked.unlanded).toEqual([
        {
          id: step.id,
          version: expect.any(String),
          payeeKept: {
            stripeTransferId: transferId,
            alertErrorId: expect.any(String),
          },
        },
      ]);
      const errorId = checked.unlanded[0]?.payeeKept?.alertErrorId;
      // Listed, not cancelled: that is the settlement's decision, and the
      // alert waits for it (review LOW-8).
      expect((await readStep(step.id)).status).toBe('failed');
      expect(alertIdFor(step.id, /the payee kept it/)).toBeUndefined();
      const repaid = await settle(refundId, checked.unlanded);

      expect(alertIdFor(step.id, /the payee kept it/)).toBe(errorId);
      expect(repaid).toEqual([]);
      expect(await readStep(step.id)).toMatchObject({
        status: 'cancelled',
        lastErrorCode: 'system_payee_kept',
        repaidByPayoutId: null,
      });
      expect(await creditOf(step.id)).toMatchObject({
        effect: 'transfer_kept',
        payoutId: slice.id,
        payeeUserId: payeeId,
        settledAs: 'cancelled',
        stripeTransferId: transferId,
        resolution: 'not_owed',
        resolvedByUserId: null,
        alertErrorId: errorId,
      });
    });

    it('a settlement refused after the decision says nothing: no payee-kept alert, no credit, the step as it was (review LOW-8)', async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      await lateTransfer(slice);
      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      // A chargeback recorded after the check: the settlement refuses
      // (REPAY_BLOCKED_BY_LATER_CAUSE).
      const disputeId = `dp_strand_${uid()}`;
      createdDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: slice.stripeChargeId ?? '',
        amountCents: 1000,
        currency: 'gbp',
        status: 'needs_response',
        stripeCreatedAt: new Date(),
      });

      const error = await settle(refundId, checked.unlanded).catch(
        (e: unknown) => e
      );

      expect((error as BusinessLogicError).context).toMatchObject({
        code: 'REPAY_BLOCKED_BY_LATER_CAUSE',
      });
      expect(alertIdFor(step.id, /the payee kept it/)).toBeUndefined();
      expect(await creditOf(step.id)).toBeUndefined();
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it('Stripe cannot be asked: left as it is, and the settlement says try again later', async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      vi.mocked(stripe.transfers.list).mockRejectedValue(
        new Error('Stripe is down')
      );

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toEqual({
        landed: 0,
        decided: [],
        unlanded: [],
        forPerson: 0,
      });
      const error = await settle(refundId, checked.unlanded).catch(
        (e: unknown) => e
      );

      expect((error as BusinessLogicError).context).toEqual({
        code: 'REFUND_CLAWBACK_UNFINISHED',
        unfinishedSteps: 1,
      });
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it.each([
      [
        'a definitive 4xx: an error alert with an errorId, as no retry will answer',
        { statusCode: 404, type: 'StripeInvalidRequestError' },
        'error',
      ],
      [
        'a timeout: a warning, as a retry may answer',
        { type: 'StripeConnectionError' },
        'warn',
      ],
    ] as const)('Stripe will not say whether the late transfer is reversed (%s): left as it is (review LOW-7)', async (_why, failure, level) => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      const transferId = await lateTransfer(slice);
      vi.mocked(stripe.transfers.retrieve).mockRejectedValue(
        Object.assign(new Error('No answer about the transfer'), failure)
      );

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });

      expect(checked).toEqual({
        landed: 0,
        decided: [],
        unlanded: [],
        forPerson: 0,
      });
      const said = (level === 'error' ? obs.error : obs.warn).mock.calls.filter(
        ([text, metadata]) =>
          /cannot be decided|was not decided/.test(String(text)) &&
          (metadata as Record<string, unknown>).payoutReversalId === step.id
      );
      expect(said).toEqual([
        [
          expect.stringContaining(
            level === 'error' ? 'Check it by hand' : 'was not decided'
          ),
          expect.objectContaining({
            ...(level === 'error' ? { errorId: expect.any(String) } : {}),
            stripeTransferId: transferId,
          }),
        ],
      ]);
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it("the rule fails (another refund's cancellation on the slice, no matching lease): left for a person, alerted, and NEEDS_PERSON", async () => {
      const slice = await cancelledSlice('cancelled_by_refund', HOUR_AGO());
      const refundId = await failedRefund(slice.stripeChargeId ?? '');
      const step = await strandedStep(slice, 'refund', refundId);
      await strandedStep(slice, 'refund', `re_strand_other_${uid()}`);

      const checked = await settleUnfinishedRefundSteps(deps, {
        stripeRefundId: refundId,
      });
      expect(checked).toEqual({
        landed: 0,
        decided: [],
        unlanded: [],
        forPerson: 1,
      });
      expect(alertIdFor(step.id, /a person must decide/)).toEqual(
        expect.any(String)
      );
      const error = await settle(refundId, checked.unlanded).catch(
        (e: unknown) => e
      );

      expect((error as BusinessLogicError).context).toEqual({
        code: 'REFUND_CLAWBACK_NEEDS_PERSON',
        steps: 1,
      });
      expect(stripe.transfers.list).not.toHaveBeenCalled();
    });
  });

  // ── the dispute path ────────────────────────────────────────────────

  describe("a won dispute's re-pay", () => {
    async function wonCase(leased = false) {
      const cancelledAt = HOUR_AGO();
      const slice = await cancelledSlice('cancelled_by_dispute', cancelledAt);
      const disputeId = await wonDispute(slice.stripeChargeId ?? '');
      const step = await strandedStep(
        slice,
        'dispute',
        disputeId,
        leased ? cancelledAt : null
      );
      return { slice, disputeId, step };
    }

    it("the drain's own settle reversed the transfer and marked the slice reversed (Codex-2hxff.88): done, and re-paid, as on the refund path", async () => {
      const { slice, disputeId, step } = await wonCase();
      const transferId = await drainReversed(slice);

      const result = await repayDispute(deps, { disputeId });

      expect(result).toEqual({ repaid: 1, cancelled: 0, debtsClosed: 0 });
      const after = await readStep(step.id);
      expect(after).toMatchObject({
        status: 'done',
        lastErrorCode: 'system_took_share',
      });
      expect(await readRow(after.repaidByPayoutId ?? '')).toMatchObject({
        status: 'pending',
        amountCents: 765,
      });
      expect(await readRow(slice.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: transferId,
      });
    });

    it('a reversed slice, and Stripe cannot be asked: the re-pay asks for a retry, and the step is left', async () => {
      const { slice, disputeId, step } = await wonCase();
      await drainReversed(slice);
      vi.mocked(stripe.transfers.retrieve).mockRejectedValue(
        Object.assign(new Error('timed out'), { type: 'StripeConnectionError' })
      );

      await expect(repayDispute(deps, { disputeId })).rejects.toBeInstanceOf(
        ServiceUnavailableError
      );
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it('no transfer went out: done as the system took the share, and re-paid', async () => {
      const { slice, disputeId, step } = await wonCase();

      const result = await repayDispute(deps, { disputeId });

      expect(result).toEqual({ repaid: 1, cancelled: 0, debtsClosed: 0 });
      const after = await readStep(step.id);
      expect(after).toMatchObject({
        status: 'done',
        lastErrorCode: 'system_took_share',
      });
      expect(await readRow(after.repaidByPayoutId ?? '')).toMatchObject({
        status: 'pending',
        amountCents: 765,
        userId: payeeId,
        stripeChargeId: null,
      });
      expect((await readRow(slice.id)).status).toBe('cancelled_by_dispute');
    });

    it('a reversal naming the step landed: done with it, the slice reversed, and re-paid', async () => {
      const { slice, disputeId, step } = await wonCase(true);
      const transferId = await lateTransfer(slice);
      const reversal = await reverseWhole(transferId, step.id);

      const result = await repayDispute(deps, { disputeId });

      expect(result).toMatchObject({ repaid: 1, cancelled: 0 });
      expect(await readStep(step.id)).toMatchObject({
        status: 'done',
        stripeReversalId: reversal.id,
        lastErrorCode: 'system_took_share',
      });
      expect(await readRow(slice.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: transferId,
      });
    });

    it('the transfer is reversed in full by another path: done, the slice reversed, and re-paid', async () => {
      const { slice, disputeId, step } = await wonCase();
      await reverseWhole(await lateTransfer(slice));

      const result = await repayDispute(deps, { disputeId });

      expect(result).toMatchObject({ repaid: 1, cancelled: 0 });
      expect((await readStep(step.id)).status).toBe('done');
      expect((await readRow(slice.id)).status).toBe('reversed');
    });

    it('the payee kept the transfer: cancelled with a born-resolved credit and an alert; nothing re-paid', async () => {
      const { slice, disputeId, step } = await wonCase();
      const transferId = await lateTransfer(slice);

      const result = await repayDispute(deps, { disputeId });

      expect(result).toEqual({ repaid: 0, cancelled: 1, debtsClosed: 0 });
      expect(await readStep(step.id)).toMatchObject({
        status: 'cancelled',
        lastErrorCode: 'system_payee_kept',
        repaidByPayoutId: null,
      });
      expect(await creditOf(step.id)).toMatchObject({
        effect: 'transfer_kept',
        settledAs: 'cancelled',
        stripeTransferId: transferId,
        resolution: 'not_owed',
        alertErrorId: alertIdFor(step.id, /the payee kept it/),
      });
    });

    it('Stripe cannot be asked: the re-pay asks for a retry, and the step is left', async () => {
      const { disputeId, step } = await wonCase();
      vi.mocked(stripe.transfers.list).mockRejectedValue(
        new Error('Stripe is down')
      );

      await expect(repayDispute(deps, { disputeId })).rejects.toBeInstanceOf(
        ServiceUnavailableError
      );
      expect((await readStep(step.id)).status).toBe('failed');
    });

    it('the rule fails (the residual): cancelled, but never silently: an error alert and a "Check Stripe again" credit', async () => {
      const { slice, disputeId, step } = await wonCase();
      await strandedStep(slice, 'dispute', `dp_strand_other_${uid()}`);

      const result = await repayDispute(deps, { disputeId });

      expect(result).toMatchObject({ repaid: 0, cancelled: 1 });
      expect((await readStep(step.id)).status).toBe('cancelled');
      const errorId = alertIdFor(step.id, /queued for support/);
      expect(errorId).toEqual(expect.any(String));
      expect(await creditOf(step.id)).toMatchObject({
        effect: 'unverified',
        amountCents: null,
        settledAs: 'cancelled',
        resolution: null,
        alertErrorId: errorId,
      });
      expect(stripe.transfers.list).not.toHaveBeenCalled();
    });
  });

  // ── §6.4: the cron retry ────────────────────────────────────────────

  it('the cron retry of a failed cancellation on its own cancelled slice reverses the late transfer, instead of marking it done unasked (§6.4)', async () => {
    // The first attempt cancelled the slice, then failed before its done.
    const chargeId = `ch_strand_${uid()}`;
    const slice = await cancelledSlice(
      'cancelled_by_refund',
      HOUR_AGO(),
      chargeId
    );
    const refundId = `re_strand_${uid()}`;
    const step = takeFirst(
      await db
        .insert(payoutReversals)
        .values({
          payoutId: slice.id,
          causeType: 'refund',
          causeId: refundId,
          amountCents: 765,
          kind: 'cancellation',
          status: 'failed',
          attempt: 1,
          lastErrorCode: 'ECONNRESET',
          updatedAt: HOUR_AGO(),
        })
        .returning()
    );
    // A drain transferred for the slice and died before settling it.
    const transferId = await lateTransfer(slice);
    vi.mocked(stripe.charges.retrieve).mockResolvedValue({
      id: chargeId,
      amount: 1000,
    } as never);
    vi.mocked(stripe.refunds.list).mockResolvedValue({
      object: 'list',
      data: [{ id: refundId, amount: 1000, status: 'succeeded', created: 1 }],
      has_more: false,
    } as never);

    await retryFailedClawbacks(deps, { olderThanMinutes: 15, limit: 500 });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      transferId,
      expect.not.objectContaining({ amount: expect.anything() }),
      { idempotencyKey: `${transferId}_reversal_${refundId}_1` }
    );
    expect(await readStep(step.id)).toMatchObject({
      status: 'done',
      stripeReversalId: expect.stringMatching(/^trr_/),
    });
    expect(await readRow(slice.id)).toMatchObject({
      status: 'reversed',
      stripeTransferId: transferId,
    });
  });
});
