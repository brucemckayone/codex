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
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
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
  loadClawbackPlanInput,
  MAX_CLAWBACK_ATTEMPTS,
  planClawback,
  reverseCharge,
} from '../clawback';
import { repayDispute, repayFailedRefund } from '../repay';

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

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    obs.warn.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // Payout rows feed global drains and sweeps: never leave them behind. Re-pay
  // rows hang off their steps (restrict), a re-pay of a re-pay row's step off
  // that row, so the closure is followed down before anything is deleted.
  afterAll(async () => {
    const all = new Set(createdPayoutIds);
    for (let frontier = [...all]; frontier.length > 0; ) {
      const linked = await db
        .select({ id: payoutReversals.repaidByPayoutId })
        .from(payoutReversals)
        .where(
          and(
            inArray(payoutReversals.payoutId, frontier),
            isNotNull(payoutReversals.repaidByPayoutId)
          )
        );
      frontier = linked.flatMap((row) =>
        row.id && !all.has(row.id) ? [row.id] : []
      );
      for (const id of frontier) all.add(id);
    }
    if (all.size > 0) {
      const ids = [...all];
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, ids));
      await db
        .update(payoutReversals)
        .set({ repaidByPayoutId: null })
        .where(inArray(payoutReversals.payoutId, ids));
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
    payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout',
    amountCents: number
  ): Promise<Payout> {
    const isFee = payoutType === 'platform_fee';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: isFee ? null : creatorId,
          payoutType,
          amountCents,
          status: 'paid',
          sourceType: 'subscription',
          stripeChargeId: charge.id,
          stripeTransferId: isFee ? null : `tr_repay_${uid()}`,
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
    return { org, refund, step };
  }

  it('a step Stripe refused on every try is cancelled, and the rest is re-paid', async () => {
    const { org, refund, step } = await exhaustedStep();

    const repaid = await settle(refund.id);

    expect(
      (await stepsOf(refund.id)).find((s) => s.id === step.id)
    ).toMatchObject({ status: 'cancelled', repaidByPayoutId: null });
    expect(repaid).toEqual([
      expect.objectContaining({ amountCents: 135, payeeUserId: org.userId }),
    ]);
  });

  it('a step out of attempts that a delivery holds right now still refuses the settlement', async () => {
    const { refund, step } = await exhaustedStep();
    // A redelivered event is trying it once more, this minute.
    await db
      .update(payoutReversals)
      .set({ attemptedAt: new Date() })
      .where(eq(payoutReversals.id, step.id));

    const error = await settle(refund.id).catch((e: unknown) => e);

    expect((error as BusinessLogicError).context).toEqual({
      code: 'REFUND_CLAWBACK_UNFINISHED',
      unfinishedSteps: 1,
    });
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
});
