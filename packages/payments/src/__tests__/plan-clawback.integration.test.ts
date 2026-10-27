/**
 * planClawback (Codex-2hxff.28 §3): support's refund preview. Its spec is the
 * engine itself: for each fixture, what `planClawback` says a new refund will
 * take equals what `reverseCharge` then records for that refund in
 * `payout_reversals`. Each fixture also names the lines it expects, so two
 * empty answers can never agree by accident.
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
  type ClawbackPlanLine,
  type ClawbackRefund,
  loadClawbackPlanInput,
  planClawback,
  reverseCharge,
} from '../clawback';
import { repayDispute } from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);
const SOURCE = { sourceType: 'subscription' } as const;

describe('planClawback equals what reverseCharge records', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let users: string[];
  let orgId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdPayoutIds: string[] = [];
  const createdDisputeIds: string[] = [];
  const createdRefundIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    users = await seedTestUsers(db, 3);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Plan Org', slug: createUniqueSlug('plan') })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // Payout rows feed global drains and sweeps: never leave them behind. A
  // re-pay row is referenced by its reversal (restrict) and can carry steps
  // of its own, so every review and reversal goes first.
  afterAll(async () => {
    if (createdPayoutIds.length > 0) {
      const repays = await db
        .select({ id: payoutReversals.repaidByPayoutId })
        .from(payoutReversals)
        .where(
          and(
            inArray(payoutReversals.payoutId, createdPayoutIds),
            isNotNull(payoutReversals.repaidByPayoutId)
          )
        );
      const all = [
        ...createdPayoutIds,
        ...repays.flatMap((r) => (r.id ? [r.id] : [])),
      ];
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, all));
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, all));
      await db.delete(payouts).where(inArray(payouts.id, all));
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
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function newCharge(amountCents = 1000): ClawbackCharge {
    return { id: `ch_plan_${uid()}`, amountCents };
  }

  async function slice(
    charge: ClawbackCharge,
    spec: {
      payoutType:
        | 'platform_fee'
        | 'organization_fee'
        | 'creator_payout'
        | 'creator_payout_to_owner';
      amountCents: number;
      status?: 'paid' | 'pending' | 'failed' | 'reversed';
      userId?: string;
    }
  ): Promise<Payout> {
    const status = spec.status ?? 'paid';
    const isFee = spec.payoutType === 'platform_fee';
    const transferred = status === 'paid' || status === 'reversed';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: isFee ? null : (spec.userId ?? users[0]),
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status,
          sourceType: 'subscription',
          stripeChargeId: charge.id,
          stripeTransferId: transferred && !isFee ? `tr_plan_${uid()}` : null,
          reason: transferred ? null : 'connect_not_ready',
          resolvedAt: transferred ? new Date() : null,
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /**
   * platform 100 paid, org 135 paid, creator 400 pending, a second creator
   * 200 failed, the owner's 165 reversed: 1000p, every status the engine
   * meets on a slice.
   */
  async function everyStatus(charge: ClawbackCharge) {
    return {
      platform: await slice(charge, {
        payoutType: 'platform_fee',
        amountCents: 100,
      }),
      org: await slice(charge, {
        payoutType: 'organization_fee',
        amountCents: 135,
      }),
      pending: await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 400,
        status: 'pending',
        userId: users[0],
      }),
      failed: await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 200,
        status: 'failed',
        userId: users[1],
      }),
      reversed: await slice(charge, {
        payoutType: 'creator_payout_to_owner',
        amountCents: 165,
        status: 'reversed',
        userId: users[2],
      }),
    };
  }

  async function dispute(
    charge: ClawbackCharge,
    status: string,
    amountCents = charge.amountCents
  ): Promise<string> {
    const id = `dp_plan_${uid()}`;
    createdDisputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: charge.id,
      amountCents,
      currency: 'gbp',
      status,
      stripeCreatedAt: new Date('2026-10-19T12:00:00Z'),
    });
    return id;
  }

  /** A paid 765p creator slice, disputed for `disputeCents`, won, re-paid. */
  async function repaidSlice(disputeCents: number) {
    const charge = newCharge();
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'needs_response', disputeCents);
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [] });
    await db
      .update(disputes)
      .set({ status: 'won' })
      .where(eq(disputes.stripeDisputeId, disputeId));
    await repayDispute(deps, { disputeId });
    return { charge, creator, repay: await repayOf(creator.id) };
  }

  async function repayOf(sliceId: string): Promise<Payout> {
    const [linked] = await db
      .select({ repay: payouts })
      .from(payoutReversals)
      .innerJoin(payouts, eq(payouts.id, payoutReversals.repaidByPayoutId))
      .where(eq(payoutReversals.payoutId, sliceId));
    if (!linked) throw new Error('The slice has no re-pay row');
    return linked.repay;
  }

  function refund(amountCents: number, createdAt: number): ClawbackRefund {
    return { id: `re_plan_${uid()}`, amountCents, createdAt };
  }

  /**
   * What the engine recorded for one refund, as plan lines: a step on a
   * slice by its kind (a `slice_repaid` debt is `needs_person`); a step on a
   * re-pay row is `from_repay_payout`, under the slice the row pays back.
   */
  async function recordedFor(
    refundId: string,
    sliceIds: readonly string[]
  ): Promise<ClawbackPlanLine[]> {
    const steps = await db
      .select()
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.causeType, 'refund'),
          eq(payoutReversals.causeId, refundId)
        )
      );
    const links = await db
      .select({
        sliceId: payoutReversals.payoutId,
        repayId: payoutReversals.repaidByPayoutId,
      })
      .from(payoutReversals)
      .where(
        and(
          inArray(payoutReversals.payoutId, [...sliceIds]),
          isNotNull(payoutReversals.repaidByPayoutId)
        )
      );
    const sliceOfRepay = new Map(links.map((l) => [l.repayId, l.sliceId]));
    const methods: Record<string, ClawbackPlanLine['method'] | undefined> = {
      transfer_reversal: 'transfer_reversal',
      pending_reduction: 'reduce_unpaid',
      cancellation: 'cancel_unpaid',
      retained_fee: 'platform_bears',
    };
    return steps.map((step) => {
      const ofSlice = sliceOfRepay.get(step.payoutId);
      if (ofSlice) return fromRepay(ofSlice, step.payoutId, step.amountCents);
      const method =
        step.lastErrorCode === 'slice_repaid'
          ? 'needs_person'
          : methods[step.kind];
      if (!method) throw new Error(`A step of unknown kind: ${step.kind}`);
      return line(step.payoutId, step.amountCents, method);
    });
  }

  /**
   * Plan a refund of `cents` on the charge after `earlier`, then make it, and
   * return the plan with what the engine recorded for it.
   */
  async function planThenRefund(
    charge: ClawbackCharge,
    earlier: ClawbackRefund[],
    cents: number
  ) {
    const input = await loadClawbackPlanInput(db, {
      charge,
      source: SOURCE,
      refunds: earlier,
    });
    const plan = planClawback({ ...input, newRefundCents: cents });
    const made = refund(cents, 1_000);
    vi.mocked(stripe.transfers.createReversal).mockClear();
    await reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [...earlier, made],
    });
    return {
      plan,
      steps: plan.lines.filter((line) => line.method !== 'rounding'),
      rounding: plan.lines.find((line) => line.method === 'rounding'),
      recorded: await recordedFor(
        made.id,
        input.slices.map((s) => s.id)
      ),
    };
  }

  const byPayout = (a: ClawbackPlanLine, b: ClawbackPlanLine) =>
    `${a.payoutId}${a.repayPayoutId}`.localeCompare(
      `${b.payoutId}${b.repayPayoutId}`
    );

  function expectSame(
    planned: ClawbackPlanLine[],
    recorded: ClawbackPlanLine[]
  ) {
    expect([...planned].sort(byPayout)).toEqual([...recorded].sort(byPayout));
  }

  // ── paid, pending, failed and reversed slices ─────────────────────────

  it('a partial refund: the fee share is the platform’s, a paid slice is reversed, unpaid ones reduced, a reversed one gives nothing', async () => {
    const charge = newCharge();
    const s = await everyStatus(charge);

    const { plan, steps, rounding, recorded } = await planThenRefund(
      charge,
      [],
      300
    );

    expect(plan.isFinal).toBe(false);
    expectSame(steps, recorded);
    expect([...steps].sort(byPayout)).toEqual(
      [
        line(s.platform.id, 30, 'platform_bears'),
        line(s.org.id, 40, 'transfer_reversal'),
        line(s.pending.id, 120, 'reduce_unpaid'),
        line(s.failed.id, 60, 'reduce_unpaid'),
      ].sort(byPayout)
    );
    // The reversed slice's 49, and the floors' pennies, stay with the platform.
    expect(rounding?.amountCents).toBe(50);
  });

  it('a final refund in one: unpaid slices are cancelled', async () => {
    const charge = newCharge();
    const s = await everyStatus(charge);

    const { plan, steps, rounding, recorded } = await planThenRefund(
      charge,
      [],
      1000
    );

    expect(plan.isFinal).toBe(true);
    expectSame(steps, recorded);
    expect([...steps].sort(byPayout)).toEqual(
      [
        line(s.platform.id, 100, 'platform_bears'),
        line(s.org.id, 135, 'transfer_reversal'),
        line(s.pending.id, 400, 'cancel_unpaid'),
        line(s.failed.id, 200, 'cancel_unpaid'),
      ].sort(byPayout)
    );
    expect(rounding?.amountCents).toBe(165);
  });

  it('the refund that completes a partly refunded charge: each share is what the earlier refund left, and unpaid slices are cancelled', async () => {
    const charge = newCharge();
    const s = await everyStatus(charge);
    const first = refund(300, 1);
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [first] });

    const { plan, steps, rounding, recorded } = await planThenRefund(
      charge,
      [first],
      700
    );

    expect(plan.isFinal).toBe(true);
    expectSame(steps, recorded);
    expect([...steps].sort(byPayout)).toEqual(
      [
        line(s.platform.id, 70, 'platform_bears'),
        line(s.org.id, 95, 'transfer_reversal'),
        line(s.pending.id, 280, 'cancel_unpaid'),
        line(s.failed.id, 140, 'cancel_unpaid'),
      ].sort(byPayout)
    );
    expect(rounding?.amountCents).toBe(700 - 585);
  });

  // ── a re-paid slice (a won dispute paid it back) ──────────────────────

  it('a re-paid slice with an unpaid re-pay row: the share comes off the re-pay row', async () => {
    const { charge, creator, repay } = await repaidSlice(500);
    expect(repay.amountCents).toBe(382);

    const { steps, recorded } = await planThenRefund(charge, [], 300);

    expectSame(steps, recorded);
    // floor(765 × 300/1000) = 229, off the 382 re-pay.
    expect(steps).toEqual([fromRepay(creator.id, repay.id, 229)]);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it('a share larger than the unpaid re-pay row: the row is cancelled and the rest needs a person', async () => {
    const { charge, creator, repay } = await repaidSlice(500);

    const { steps, recorded } = await planThenRefund(charge, [], 600);

    expectSame(steps, recorded);
    // floor(765 × 600/1000) = 459: 382 off the re-pay row, 77 for a person.
    expect([...steps].sort(byPayout)).toEqual(
      [
        fromRepay(creator.id, repay.id, 382),
        line(creator.id, 77, 'needs_person'),
      ].sort(byPayout)
    );
  });

  it('a re-paid slice whose re-pay row has been paid: the whole share needs a person', async () => {
    const { charge, creator, repay } = await repaidSlice(500);
    await db
      .update(payouts)
      .set({
        status: 'paid',
        stripeTransferId: `tr_repay_${uid()}`,
        resolvedAt: new Date(),
      })
      .where(eq(payouts.id, repay.id));

    const { steps, recorded } = await planThenRefund(charge, [], 300);

    expectSame(steps, recorded);
    expect(steps).toEqual([line(creator.id, 229, 'needs_person')]);
  });

  // ── a step moved to the re-pay row (`moved_to_repay`) ─────────────────

  it('after a step moved to the re-pay row, what it took there counts: the next refund takes only the rest, and cancels the row', async () => {
    // A full chargeback reversed the slice whole; a refund's step recorded
    // while it was paid was refused, and moved to the re-pay row.
    const charge = newCharge();
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'needs_response');
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [] });
    const first = refund(300, 1);
    await db.insert(payoutReversals).values({
      payoutId: creator.id,
      causeType: 'refund',
      causeId: first.id,
      amountCents: 229,
      kind: 'transfer_reversal',
      status: 'failed',
      lastErrorCode: 'unknown',
    });
    await db
      .update(disputes)
      .set({ status: 'won' })
      .where(eq(disputes.stripeDisputeId, disputeId));
    await repayDispute(deps, { disputeId });
    vi.mocked(stripe.transfers.createReversal).mockRejectedValueOnce(
      Object.assign(new Error('fully reversed'), {
        code: 'parameter_invalid',
        statusCode: 400,
      })
    );
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [first] });
    const repay = await repayOf(creator.id);
    const moved = await db
      .select()
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.payoutId, creator.id),
          eq(payoutReversals.causeId, first.id)
        )
      );
    expect(moved).toMatchObject([
      { status: 'cancelled', lastErrorCode: 'moved_to_repay' },
    ]);

    const { plan, steps, recorded } = await planThenRefund(
      charge,
      [first],
      700
    );

    expect(plan.isFinal).toBe(true);
    expectSame(steps, recorded);
    // 765 - 229 = 536 is left of the 765 re-pay row once the moved step's
    // 229 is counted: this refund's whole share, so the row is cancelled.
    expect(steps).toEqual([fromRepay(creator.id, repay.id, 536)]);
    expect((await readRow(repay.id)).status).toBe('cancelled_by_refund');
  });

  // ── a lost chargeback before the refund ───────────────────────────────

  it('a lost chargeback before the refund: the refund is shared first, and a reduction that takes the rest of an unpaid slice cancels it', async () => {
    const charge = newCharge();
    const platform = await slice(charge, {
      payoutType: 'platform_fee',
      amountCents: 100,
    });
    const org = await slice(charge, {
      payoutType: 'organization_fee',
      amountCents: 135,
    });
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
      status: 'pending',
    });
    await dispute(charge, 'lost', 400);
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [] });

    const { plan, steps, rounding, recorded } = await planThenRefund(
      charge,
      [],
      600
    );

    // Refunds come before chargebacks in the running total: 600 of 1000.
    expect(plan.isFinal).toBe(false);
    expectSame(steps, recorded);
    expect([...steps].sort(byPayout)).toEqual(
      [
        line(platform.id, 60, 'platform_bears'),
        line(org.id, 81, 'transfer_reversal'),
        // The loss took 306 of 765; this share's 459 is the rest.
        line(creator.id, 459, 'cancel_unpaid'),
      ].sort(byPayout)
    );
    expect(rounding?.amountCents).toBe(0);
  });

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }
});

function line(
  payoutId: string,
  amountCents: number,
  method: ClawbackPlanLine['method']
): ClawbackPlanLine {
  return { payoutId, repayPayoutId: null, amountCents, method };
}

/** A share taken off a re-pay row of `payoutId`. */
function fromRepay(
  payoutId: string,
  repayPayoutId: string,
  amountCents: number
): ClawbackPlanLine {
  return {
    payoutId,
    repayPayoutId,
    amountCents,
    method: 'from_repay_payout',
  };
}
