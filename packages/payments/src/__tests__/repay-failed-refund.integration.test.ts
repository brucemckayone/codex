/**
 * repayFailedRefund (Codex-2hxff.28 §8, owner decisions Q5a-c): support
 * settles a failed refund as `creators_repaid`, so what its clawback took is
 * paid back, its debts close as `refund_failed`, and the clawback leaves it out
 * of the charge's running total.
 *
 * Each fixture builds the ledger through the engine itself: the refund's
 * clawback runs when it succeeds, then the refund fails at Stripe and support
 * settles it, in one transaction as the support route does (the `refunds` row
 * resolved beside the re-pay).
 */

import { createPerRequestDbClient } from '@codex/database';
import {
  disputes,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  refundReviews,
  refunds,
} from '@codex/database/schema';
import { BusinessLogicError } from '@codex/service-errors';
import {
  createMockStripe,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
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
  type ClawbackCharge,
  type ClawbackDeps,
  type ClawbackRefund,
  failedRefundRepayBlock,
  loadClawbackCauses,
  loadClawbackPlanInput,
  MAX_CLAWBACK_ATTEMPTS,
  planClawback,
  reverseCharge,
} from '../clawback';
import {
  repayDispute,
  repayFailedRefund,
  settleUnfinishedRefundSteps,
} from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);
const SOURCE = { sourceType: 'subscription' } as const;
const NOTE = 'Customer agreed to keep the course; payees paid back';

describe('repayFailedRefund (creators_repaid)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let creatorId: string;
  let supportId: string;
  let orgId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdPayoutIds: string[] = [];
  const createdRefundIds: string[] = [];
  const createdDisputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, supportId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Repay Org', slug: createUniqueSlug('repay') })
        .returning()
    ).id;
  });

  /** The mock's own reversal: it records the reversal, as Stripe would. */
  type CreateReversal = Stripe['transfers']['createReversal'];
  let makeReversal: CreateReversal;

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    obs.warn.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
    makeReversal = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation() as CreateReversal;
  });

  // Payout rows feed global drains and sweeps: never leave them behind. Re-pay
  // rows hang off their steps (restrict), so every link into them is cleared
  // before any row is deleted.
  afterAll(async () => {
    // By the suite's own organisation, not only by following
    // `repaid_by_payout_id`: every slice here is the org's, and a re-pay row
    // copies its slice's org. A row whose link was overwritten (a calibration
    // mutation of the writer re-links steps to new rows) has no link left to
    // follow, and was left behind on the shared DB once.
    const ours = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.organizationId, orgId));
    const ids = [
      ...new Set([...createdPayoutIds, ...ours.map((row) => row.id)]),
    ];
    if (ids.length > 0) {
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
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function newCharge(): ClawbackCharge {
    return { id: `ch_repay_${uid()}`, amountCents: 1000 };
  }

  async function slice(
    charge: ClawbackCharge,
    payoutType:
      | 'platform_fee'
      | 'organization_fee'
      | 'creator_payout'
      | 'creator_payout_to_owner',
    amountCents: number,
    status: 'paid' | 'cancelled_by_refund' = 'paid'
  ): Promise<Payout> {
    const isFee = payoutType === 'platform_fee';
    const paid = status === 'paid';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: isFee ? null : creatorId,
          payoutType,
          amountCents,
          status,
          sourceType: 'subscription',
          stripeChargeId: charge.id,
          stripeTransferId: isFee || !paid ? null : `tr_repay_${uid()}`,
          reason: paid ? null : 'connect_not_ready',
          resolvedAt: new Date(),
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /** platform 100 + org 135 + creator 765 on a 1000p charge, all paid. */
  async function paidSplit(charge: ClawbackCharge) {
    return {
      platform: await slice(charge, 'platform_fee', 100),
      org: await slice(charge, 'organization_fee', 135),
      creator: await slice(charge, 'creator_payout', 765),
    };
  }

  /**
   * A refund the engine clawed back when it succeeded, and that has since
   * failed at Stripe, as the refund webhook records it.
   */
  async function failedRefund(
    charge: ClawbackCharge,
    amountCents: number
  ): Promise<ClawbackRefund> {
    const refund = { id: `re_repay_${uid()}`, amountCents, createdAt: 1 };
    createdRefundIds.push(refund.id);
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] });
    await db.insert(refunds).values({
      stripeRefundId: refund.id,
      stripeChargeId: charge.id,
      amountCents,
      currency: 'gbp',
      status: 'failed',
      failureReason: 'expired_or_canceled_card',
      stripeCreatedAt: new Date(),
    });
    return refund;
  }

  /** Support's settlement, as the route runs it: one transaction. */
  function settle(refundId: string) {
    const now = new Date();
    return db.transaction(async (tx) => {
      const repaid = await repayFailedRefund(tx, {
        stripeRefundId: refundId,
        resolvedByUserId: supportId,
        note: NOTE,
        now,
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
      return repaid;
    });
  }

  async function stepsOf(refundId: string) {
    return db
      .select()
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.causeType, 'refund'),
          eq(payoutReversals.causeId, refundId)
        )
      );
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function reviewOf(payoutReversalId: string) {
    return takeFirst(
      await db
        .select()
        .from(refundReviews)
        .where(eq(refundReviews.payoutReversalId, payoutReversalId))
    );
  }

  /** Reject the reversal of one transfer with `code`; the rest succeed. */
  function refuseReversalOf(transferId: string | null, code: string) {
    const succeed = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation();
    vi.mocked(stripe.transfers.createReversal).mockImplementation((async (
      ...args: Parameters<Stripe['transfers']['createReversal']>
    ) => {
      if (args[0] === transferId) {
        throw Object.assign(new Error('refused'), { code, statusCode: 402 });
      }
      return succeed?.(...args);
    }) as never);
  }

  // ── tests ─────────────────────────────────────────────────────────────

  it('one pending re-pay row per step that took money from a payee, for its amount, with no charge id; none for the platform fee', async () => {
    const charge = newCharge();
    const { platform, org, creator } = await paidSplit(charge);
    const refund = await failedRefund(charge, 1000);
    expect((await readRow(creator.id)).status).toBe('reversed');

    const repaid = await settle(refund.id);

    expect(repaid.map((r) => [r.payeeUserId, r.amountCents]).sort()).toEqual(
      [
        [creatorId, 135],
        [creatorId, 765],
      ].sort()
    );
    const steps = await stepsOf(refund.id);
    for (const step of steps.filter((s) => s.payoutId !== platform.id)) {
      const repay = await readRow(step.repaidByPayoutId ?? '');
      const original = step.payoutId === org.id ? org : creator;
      expect(repay).toMatchObject({
        status: 'pending',
        stripeChargeId: null,
        amountCents: step.amountCents,
        userId: original.userId,
        organizationId: original.organizationId,
        payoutType: original.payoutType,
        sourceType: 'subscription',
      });
      expect(repaid.map((r) => r.payoutId)).toContain(repay.id);
    }
    // The fee: no re-pay row. Its share is cancelled and the fee slice is
    // the platform's again, as when a dispute is won.
    const [feeStep] = steps.filter((s) => s.payoutId === platform.id);
    expect(feeStep).toMatchObject({
      kind: 'retained_fee',
      status: 'cancelled',
      repaidByPayoutId: null,
    });
    expect((await readRow(platform.id)).status).toBe('paid');
  });

  it('a second run writes nothing', async () => {
    const charge = newCharge();
    await paidSplit(charge);
    const refund = await failedRefund(charge, 1000);
    const first = await settle(refund.id);
    const links = async () =>
      (await stepsOf(refund.id)).map((s) => `${s.id}:${s.repaidByPayoutId}`);
    const linked = (await links()).sort();

    const again = await db.transaction((tx) =>
      repayFailedRefund(tx, {
        stripeRefundId: refund.id,
        resolvedByUserId: supportId,
        note: NOTE,
        now: new Date(),
      })
    );

    expect(first).toHaveLength(2);
    expect(again).toEqual([]);
    expect((await links()).sort()).toEqual(linked);
  });

  it('its open debts close as refund_failed, with who settled them and the note; a debt the payee never paid is not re-paid', async () => {
    const charge = newCharge();
    const { org, creator } = await paidSplit(charge);
    refuseReversalOf(creator.stripeTransferId, 'insufficient_funds');
    const refund = await failedRefund(charge, 1000);
    const debt = (await stepsOf(refund.id)).find(
      (s) => s.payoutId === creator.id
    );
    expect(debt?.status).toBe('debt');

    const repaid = await settle(refund.id);

    expect(await reviewOf(debt?.id ?? '')).toMatchObject({
      resolution: 'refund_failed',
      resolvedByUserId: supportId,
      resolutionNote: NOTE,
    });
    expect((await reviewOf(debt?.id ?? '')).resolvedAt).not.toBeNull();
    // Only the organisation's reversal took money.
    expect(repaid).toEqual([
      expect.objectContaining({ amountCents: 135, payeeUserId: org.userId }),
    ]);
  });

  it('a debt the payee already paid (creator_absorbed) is paid back, and keeps its resolution', async () => {
    const charge = newCharge();
    const { creator } = await paidSplit(charge);
    refuseReversalOf(creator.stripeTransferId, 'insufficient_funds');
    const refund = await failedRefund(charge, 1000);
    const debt = (await stepsOf(refund.id)).find(
      (s) => s.payoutId === creator.id
    );
    await db
      .update(refundReviews)
      .set({ resolution: 'creator_absorbed', resolvedAt: new Date() })
      .where(eq(refundReviews.payoutReversalId, debt?.id ?? ''));

    const repaid = await settle(refund.id);

    expect(repaid).toContainEqual(
      expect.objectContaining({ amountCents: 765, payeeUserId: creatorId })
    );
    expect((await reviewOf(debt?.id ?? '')).resolution).toBe(
      'creator_absorbed'
    );
  });

  it("a re-pay row's own done steps of the refund are re-paid too", async () => {
    // A won dispute re-paid 382 of the creator's 765; the refund then took
    // its 229 off that unpaid re-pay row.
    const charge = newCharge();
    await slice(charge, 'creator_payout', 765);
    const disputeId = `dp_repay_${uid()}`;
    createdDisputeIds.push(disputeId);
    await db.insert(disputes).values({
      stripeDisputeId: disputeId,
      stripeChargeId: charge.id,
      amountCents: 500,
      currency: 'gbp',
      status: 'needs_response',
      stripeCreatedAt: new Date('2026-10-19T12:00:00Z'),
    });
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [] });
    await db
      .update(disputes)
      .set({ status: 'won' })
      .where(eq(disputes.stripeDisputeId, disputeId));
    await repayDispute(deps, { disputeId });
    const refund = await failedRefund(charge, 300);
    const [onRepay] = await stepsOf(refund.id);
    const disputeRepay = await readRow(onRepay?.payoutId ?? '');
    expect(disputeRepay.stripeChargeId).toBeNull();
    expect(onRepay).toMatchObject({
      kind: 'pending_reduction',
      status: 'done',
      amountCents: 229,
    });

    const repaid = await settle(refund.id);

    expect(repaid).toEqual([
      {
        payoutId: expect.any(String),
        payeeUserId: creatorId,
        amountCents: 229,
      },
    ]);
    expect((await stepsOf(refund.id))[0]?.repaidByPayoutId).toBe(
      repaid[0]?.payoutId
    );
  });

  it('a step the clawback is still retrying refuses the settlement, and nothing is written', async () => {
    const charge = newCharge();
    const { creator } = await paidSplit(charge);
    refuseReversalOf(creator.stripeTransferId, 'parameter_invalid');
    const refund = await failedRefund(charge, 1000);
    const stuck = (await stepsOf(refund.id)).find(
      (s) => s.payoutId === creator.id
    );
    expect(stuck?.status).toBe('failed');

    // The cron retries it within the hour: the pre-step leaves it alone.
    expect(
      await settleUnfinishedRefundSteps(deps, { stripeRefundId: refund.id })
    ).toEqual({ landed: 0, cancelled: 0, forPerson: 0 });
    const error = await settle(refund.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BusinessLogicError);
    expect((error as BusinessLogicError).message).toMatch(
      /still running\. Try again later/
    );
    expect((error as BusinessLogicError).context).toEqual({
      code: 'REFUND_CLAWBACK_UNFINISHED',
      unfinishedSteps: 1,
    });
    const after = await stepsOf(refund.id);
    expect(after.every((s) => s.repaidByPayoutId === null)).toBe(true);
    expect(after.find((s) => s.id === stuck?.id)?.status).toBe('failed');
    const [row] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.stripeRefundId, refund.id));
    expect(row?.resolution).toBeNull();
  });

  /**
   * The creator's reversal refused by Stripe on every try: the refund's own
   * run, then the hourly retry's, until the step is out of attempts.
   */
  async function exhaustedStep() {
    const charge = newCharge();
    const { org, creator } = await paidSplit(charge);
    refuseReversalOf(creator.stripeTransferId, 'parameter_invalid');
    const refund = await failedRefund(charge, 1000);
    for (let run = 1; run < MAX_CLAWBACK_ATTEMPTS; run++) {
      await reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] });
    }
    const step = (await stepsOf(refund.id)).find(
      (s) => s.payoutId === creator.id
    );
    expect(step).toMatchObject({
      status: 'failed',
      attempt: MAX_CLAWBACK_ATTEMPTS,
    });
    if (!step) throw new Error("The creator's step was not recorded");
    return { charge, org, refund, step };
  }

  it('a step Stripe refused on every try, with no reversal at Stripe, is cancelled by the pre-step, and the rest is re-paid', async () => {
    const { org, refund, step } = await exhaustedStep();

    expect(
      await settleUnfinishedRefundSteps(deps, { stripeRefundId: refund.id })
    ).toEqual({ landed: 0, cancelled: 1, forPerson: 0 });
    const repaid = await settle(refund.id);

    expect(stripe.transfers.listReversals).toHaveBeenCalled();
    expect(
      (await stepsOf(refund.id)).find((s) => s.id === step.id)
    ).toMatchObject({ status: 'cancelled', repaidByPayoutId: null });
    expect(repaid).toEqual([
      expect.objectContaining({ amountCents: 135, payeeUserId: org.userId }),
    ]);
  });

  it('a step out of attempts whose last, unconfirmed try landed at Stripe is recorded done by the pre-step, and re-paid', async () => {
    const { charge, refund, step } = await exhaustedStep();
    // A redelivered event tries it once more: Stripe makes the reversal, but
    // the answer is lost (a 500), so the attempt stays at the maximum.
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      ...args: Parameters<CreateReversal>
    ) => {
      await makeReversal(...args);
      throw Object.assign(new Error('connection reset'), { statusCode: 500 });
    }) as never);
    await expect(
      reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] })
    ).rejects.toThrow();
    expect(
      (await stepsOf(refund.id)).find((s) => s.id === step.id)
    ).toMatchObject({ status: 'failed', attempt: MAX_CLAWBACK_ATTEMPTS });

    expect(
      await settleUnfinishedRefundSteps(deps, { stripeRefundId: refund.id })
    ).toEqual({ landed: 1, cancelled: 0, forPerson: 0 });
    const repaid = await settle(refund.id);

    expect(
      (await stepsOf(refund.id)).find((s) => s.id === step.id)
    ).toMatchObject({ status: 'done' });
    expect(repaid).toContainEqual(
      expect.objectContaining({ amountCents: 765, payeeUserId: creatorId })
    );
  });

  it('without the pre-step, a step out of attempts refuses the settlement: it is never cancelled unchecked', async () => {
    const { refund } = await exhaustedStep();

    const error = await settle(refund.id).catch((e: unknown) => e);

    expect((error as BusinessLogicError).context).toEqual({
      code: 'REFUND_CLAWBACK_UNFINISHED',
      unfinishedSteps: 1,
    });
  });

  it('a step out of attempts that a delivery holds right now is left by the pre-step, and still refuses the settlement', async () => {
    const { refund, step } = await exhaustedStep();
    // A redelivered event is trying it once more, this minute.
    await db
      .update(payoutReversals)
      .set({ attemptedAt: new Date() })
      .where(eq(payoutReversals.id, step.id));

    expect(
      await settleUnfinishedRefundSteps(deps, { stripeRefundId: refund.id })
    ).toEqual({ landed: 0, cancelled: 0, forPerson: 0 });
    const error = await settle(refund.id).catch((e: unknown) => e);

    expect((error as BusinessLogicError).context).toEqual({
      code: 'REFUND_CLAWBACK_UNFINISHED',
      unfinishedSteps: 1,
    });
  });

  /** A step on a slice added after the refund's run, claimed an hour ago. */
  async function claimedLongAgo(
    refund: ClawbackRefund,
    slice: Payout,
    kind: 'transfer_reversal' | 'cancellation'
  ) {
    return takeFirst(
      await db
        .insert(payoutReversals)
        .values({
          payoutId: slice.id,
          causeType: 'refund',
          causeId: refund.id,
          amountCents: slice.amountCents,
          kind,
          status: 'pending',
          attemptedAt: new Date(Date.now() - 60 * 60_000),
        })
        .returning()
    );
  }

  it('a step whose lease ran out (its delivery died): done if Stripe made its reversal, cancelled if not, and then re-paid', async () => {
    const charge = newCharge();
    await slice(charge, 'organization_fee', 135);
    const refund = await failedRefund(charge, 1000);
    const landedSlice = await slice(charge, 'creator_payout', 765);
    const lostSlice = await slice(charge, 'creator_payout_to_owner', 100);
    const landed = await claimedLongAgo(
      refund,
      landedSlice,
      'transfer_reversal'
    );
    const lost = await claimedLongAgo(refund, lostSlice, 'transfer_reversal');
    // The dead delivery's reversal, as Stripe holds it.
    await stripe.transfers.createReversal(landedSlice.stripeTransferId ?? '', {
      amount: 765,
      metadata: { payout_reversal_id: landed.id },
    });

    expect(
      await settleUnfinishedRefundSteps(deps, { stripeRefundId: refund.id })
    ).toEqual({ landed: 1, cancelled: 1, forPerson: 0 });
    const repaid = await settle(refund.id);

    const steps = await stepsOf(refund.id);
    expect(steps.find((s) => s.id === landed.id)?.status).toBe('done');
    expect(steps.find((s) => s.id === lost.id)?.status).toBe('cancelled');
    expect(repaid.map((r) => r.amountCents).sort()).toEqual([135, 765]);
  });

  it('an unfinished cancellation on a slice already cancelled is left for a person, logged, and the settlement still refuses', async () => {
    const charge = newCharge();
    await slice(charge, 'organization_fee', 135);
    const refund = await failedRefund(charge, 1000);
    const cancelled = await slice(
      charge,
      'creator_payout',
      765,
      'cancelled_by_refund'
    );
    const step = await claimedLongAgo(refund, cancelled, 'cancellation');

    expect(
      await settleUnfinishedRefundSteps(deps, { stripeRefundId: refund.id })
    ).toEqual({ landed: 0, cancelled: 0, forPerson: 1 });
    const error = await settle(refund.id).catch((e: unknown) => e);

    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('a person must decide'),
      expect.objectContaining({ payoutReversalId: step.id })
    );
    expect((error as BusinessLogicError).context).toMatchObject({
      code: 'REFUND_CLAWBACK_UNFINISHED',
    });
  });

  it('a debt with no review (a slice with no payee) is cancelled, so it never reads "owed"', async () => {
    const charge = newCharge();
    await slice(charge, 'organization_fee', 135);
    const refund = await failedRefund(charge, 1000);
    const late = await slice(charge, 'creator_payout', 765);
    const debt = takeFirst(
      await db
        .insert(payoutReversals)
        .values({
          payoutId: late.id,
          causeType: 'refund',
          causeId: refund.id,
          amountCents: 765,
          kind: 'transfer_reversal',
          status: 'debt',
          lastErrorCode: 'insufficient_funds',
        })
        .returning()
    );

    await settle(refund.id);

    expect(
      (await stepsOf(refund.id)).find((s) => s.id === debt.id)
    ).toMatchObject({ status: 'cancelled', repaidByPayoutId: null });
  });

  it('a step never claimed (it never reached Stripe) is cancelled, and the rest is re-paid', async () => {
    const charge = newCharge();
    await slice(charge, 'organization_fee', 135);
    const refund = await failedRefund(charge, 1000);
    // A slice whose step was recorded by a delivery that crashed before
    // claiming it: pending, never attempted, its transfer untouched.
    const late = await slice(charge, 'creator_payout', 765);
    const unclaimed = takeFirst(
      await db
        .insert(payoutReversals)
        .values({
          payoutId: late.id,
          causeType: 'refund',
          causeId: refund.id,
          amountCents: 765,
          kind: 'transfer_reversal',
          status: 'pending',
        })
        .returning()
    );

    const repaid = await settle(refund.id);

    const step = (await stepsOf(refund.id)).find((s) => s.id === unclaimed.id);
    expect(step).toMatchObject({ status: 'cancelled', repaidByPayoutId: null });
    expect(repaid).toEqual([expect.objectContaining({ amountCents: 135 })]);
  });

  // ── the running total (Q5c) ───────────────────────────────────────────

  it('after creators_repaid, a later refund of the charge takes its share off the re-pay row, not a share of zero; the preview agrees', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 'creator_payout', 765);
    const failed = await failedRefund(charge, 1000);
    await settle(failed.id);
    const [repaidStep] = await stepsOf(failed.id);
    const repayId = repaidStep?.repaidByPayoutId ?? '';
    expect((await readRow(repayId)).amountCents).toBe(765);

    // Stripe lists the failed refund too: the running total must skip it.
    const later = { id: `re_repay_${uid()}`, amountCents: 500, createdAt: 2 };
    const plan = planClawback({
      ...(await loadClawbackPlanInput(db, {
        charge,
        source: SOURCE,
        refunds: [failed],
      })),
      newRefundCents: 500,
    });
    await reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [failed, later],
    });

    // floor(765 × 500/1000) = 382, off the 765 re-pay row.
    const [onRepay] = await stepsOf(later.id);
    expect(onRepay).toMatchObject({
      payoutId: repayId,
      kind: 'pending_reduction',
      amountCents: 382,
      status: 'done',
    });
    expect(plan.lines).toContainEqual({
      payoutId: creator.id,
      repayPayoutId: repayId,
      amountCents: 382,
      method: 'from_repay_payout',
    });
  });

  // ── a later cause shared against the failed refund (money HIGH-1) ─────

  it('a chargeback after the failed refund blocks the re-pay: the rule says so, and the settlement re-checks it inside its transaction', async () => {
    // Scenario A: the buyer, never refunded, charges back the whole charge.
    // It is shared after the failed refund, so it took nothing.
    const charge = newCharge();
    const creator = await slice(charge, 'creator_payout', 900);
    const refund = await failedRefund(charge, 1000);
    const disputeId = `dp_repay_${uid()}`;
    createdDisputeIds.push(disputeId);
    await db.insert(disputes).values({
      stripeDisputeId: disputeId,
      stripeChargeId: charge.id,
      amountCents: 1000,
      currency: 'gbp',
      status: 'lost',
      stripeCreatedAt: new Date(),
    });
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] });
    expect(
      (
        await db
          .select()
          .from(payoutReversals)
          .where(eq(payoutReversals.causeId, disputeId))
      ).length
    ).toBe(0);

    const causes = await loadClawbackCauses(db, {
      chargeId: charge.id,
      refunds: [refund],
    });
    expect(
      failedRefundRepayBlock({
        chargeAmountCents: charge.amountCents,
        ...causes,
        stripeRefundId: refund.id,
      })
    ).toBe('chargeback');
    // The caller's check passed before the chargeback opened: the
    // transaction's own read refuses.
    const error = await settle(refund.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BusinessLogicError);
    expect((error as BusinessLogicError).context).toEqual({
      code: 'REPAY_BLOCKED_BY_LATER_CAUSE',
      reason: 'chargeback',
    });
    const [step] = await stepsOf(refund.id);
    expect(step).toMatchObject({
      payoutId: creator.id,
      repaidByPayoutId: null,
    });
  });

  it('a later refund shared against the failed one, over the charge, blocks the re-pay', async () => {
    // Scenario B: R1 = 1000 failed, then support refunds R2 = 1000. R2 is
    // shared with R1 counted, so it took nothing.
    const charge = newCharge();
    await slice(charge, 'creator_payout', 900);
    const failed = await failedRefund(charge, 1000);
    const later = { id: `re_repay_${uid()}`, amountCents: 1000, createdAt: 2 };
    await reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [failed, later],
    });
    expect(await stepsOf(later.id)).toHaveLength(0);

    const causes = await loadClawbackCauses(db, {
      chargeId: charge.id,
      refunds: [failed, later],
    });

    expect(
      failedRefundRepayBlock({
        chargeAmountCents: charge.amountCents,
        ...causes,
        stripeRefundId: failed.id,
      })
    ).toBe('later_refunds');
  });

  // ── a claim racing the settlement (money MED-1) ───────────────────────

  /**
   * A connection of the test's own, as the dispute-pause-race suite opens
   * one: a lock wait on it gives up after 10s, so a regression cannot hang.
   */
  async function ownConnection() {
    const { db: conn, cleanup } = createPerRequestDbClient({
      DB_METHOD: process.env.DB_METHOD,
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_URL_LOCAL_PROXY: process.env.DATABASE_URL_LOCAL_PROXY,
      NODE_ENV: process.env.NODE_ENV,
    });
    await conn.execute(sql`set lock_timeout = '10s'`);
    return { db: conn, pid: await backendPid(conn), cleanup };
  }

  async function backendPid(conn: Pick<Database, 'execute'>): Promise<number> {
    const { rows } = await conn.execute(sql`select pg_backend_pid() as pid`);
    return Number((rows[0] as { pid: unknown } | undefined)?.pid);
  }

  /** Resolve once backend `waiter` waits on a lock backend `holder` holds. */
  async function untilWaiting(
    waiter: number,
    holder: number,
    work: { settled: () => boolean }
  ): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (work.settled()) throw new Error('settled before it waited');
      const { rows } = await db.execute(
        sql`select 1 from pg_stat_activity
            where pid = ${waiter}::int
              and ${holder}::int = any(pg_blocking_pids(pid))
              and query ilike ${'%"refunds"%'}`
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('never waited on refunds');
  }

  it('a claim made while the settlement holds the refund waits for it, then sees creators_repaid: the step never reaches Stripe', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 'creator_payout', 765);
    // The refund failed; its clawback has recorded no step yet.
    const refund = { id: `re_repay_${uid()}`, amountCents: 1000, createdAt: 1 };
    createdRefundIds.push(refund.id);
    await db.insert(refunds).values({
      stripeRefundId: refund.id,
      stripeChargeId: charge.id,
      amountCents: 1000,
      currency: 'gbp',
      status: 'failed',
      stripeCreatedAt: new Date(),
    });
    const claimer = await ownConnection();
    let done = false;
    let run: Promise<unknown> = Promise.resolve();
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx
          .select({ id: refunds.id })
          .from(refunds)
          .where(eq(refunds.stripeRefundId, refund.id))
          .for('update');
        const holder = await backendPid(tx);
        await repayFailedRefund(tx, {
          stripeRefundId: refund.id,
          resolvedByUserId: supportId,
          note: NOTE,
          now: new Date(),
        });
        await tx
          .update(refunds)
          .set({
            resolution: 'creators_repaid',
            resolvedAt: new Date(),
            resolvedByUserId: supportId,
            resolutionNote: NOTE,
          })
          .where(eq(refunds.stripeRefundId, refund.id));
        // A delivery that read the refund unsettled reaches the claim.
        run = reverseCharge(
          { ...deps, db: claimer.db },
          { charge, source: SOURCE, refunds: [refund] }
        ).finally(() => {
          done = true;
        });
        await untilWaiting(claimer.pid, holder, { settled: () => done });
      });
      await run;
    } finally {
      await run.catch(() => undefined);
      await claimer.cleanup();
    }

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(await stepsOf(refund.id)).toMatchObject([
      { payoutId: creator.id, status: 'cancelled', attemptedAt: null },
    ]);
  });

  it('a claim made first leaves the step leased, and the settlement refuses until it finishes', async () => {
    const charge = newCharge();
    await slice(charge, 'creator_payout', 765);
    const refund = { id: `re_repay_${uid()}`, amountCents: 1000, createdAt: 1 };
    createdRefundIds.push(refund.id);
    await db.insert(refunds).values({
      stripeRefundId: refund.id,
      stripeChargeId: charge.id,
      amountCents: 1000,
      currency: 'gbp',
      status: 'failed',
      stripeCreatedAt: new Date(),
    });
    // Stripe answers only when the test says so.
    let answer: () => void = () => undefined;
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      ...args: Parameters<CreateReversal>
    ) => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return makeReversal(...args);
    }) as never);
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    while (vi.mocked(stripe.transfers.createReversal).mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const error = await settle(refund.id).catch((e: unknown) => e);
    answer();
    await run;

    expect((error as BusinessLogicError).context).toEqual({
      code: 'REFUND_CLAWBACK_UNFINISHED',
      unfinishedSteps: 1,
    });
    expect(await settle(refund.id)).toEqual([
      expect.objectContaining({ amountCents: 765 }),
    ]);
  });
});
