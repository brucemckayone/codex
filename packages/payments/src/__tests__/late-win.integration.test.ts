/**
 * The late win in the clawback engine (Codex-2hxff.70; late-win data design
 * §4.4, §4.5, §4.7, §13): a lost dispute, its loss applied, later won.
 *
 * - The re-pay already settles every step the loss left: a reversed paid
 *   slice, a cancelled unpaid one (it stays `cancelled_by_dispute`, the one
 *   writer `tookTheSlice` relies on) and a reduced one. Bead point (3) no
 *   longer holds; this proves it.
 * - The re-pay rows are held while the win is not yet applied.
 * - A refund's clawback waits while the win is unapplied, except the win's
 *   own settlement (`settlingDisputeId`).
 * - Re-pay first, then the refund: a re-bought buyer's refund takes each
 *   share off the held re-pay rows, and a partial loss's refund ends on the
 *   documented `slice_repaid` limit, never a second take from the slice.
 *
 * The record's transition and the purchase are @codex/purchase's
 * (late-win.integration.test.ts); here the transition is written as it
 * leaves the row. Real DB; Stripe is faked at the client.
 */

import {
  disputes,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  refundReviews,
} from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
import {
  createMockStripe,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
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
  reverseCharge,
} from '../clawback';
import { isDrainablePayout } from '../payout-ledger';
import { repayDispute } from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);

describe('a late win in the clawback engine (Codex-2hxff.70)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let creatorA: string;
  let orgId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdPayoutIds: string[] = [];
  const createdDisputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorA] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Late Win Engine Org', slug: createUniqueSlug('lw') })
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

  // Payout rows feed global drains and sweeps: never leave them behind. A
  // re-pay row is referenced by its reversal, and carries steps of its own.
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
        .where(
          or(
            inArray(payoutReversals.payoutId, all),
            inArray(payoutReversals.repaidByPayoutId, all)
          )
        );
      await db.delete(payouts).where(inArray(payouts.id, all));
    }
    if (createdDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, createdDisputeIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function newCharge(amountCents = 1000): ClawbackCharge {
    return { id: `ch_lw_${uid()}`, amountCents };
  }

  async function slice(
    charge: ClawbackCharge,
    spec: {
      payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
      amountCents: number;
      status?: 'paid' | 'pending';
    }
  ): Promise<Payout> {
    const status = spec.status ?? 'paid';
    const isFee = spec.payoutType === 'platform_fee';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: isFee ? null : creatorA,
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status,
          sourceType: 'subscription',
          stripeChargeId: charge.id,
          stripeTransferId:
            status === 'paid' && !isFee
              ? `tr_${spec.payoutType}_${uid()}`
              : null,
          reason: status === 'paid' ? null : 'connect_not_ready',
          resolvedAt: status === 'paid' ? new Date() : null,
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /** Paid platform 100 and creator 765, and the org's 135 not yet paid. */
  async function mixedSplit(charge: ClawbackCharge) {
    return {
      platform: await slice(charge, {
        payoutType: 'platform_fee',
        amountCents: 100,
      }),
      org: await slice(charge, {
        payoutType: 'organization_fee',
        amountCents: 135,
        status: 'pending',
      }),
      creator: await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
      }),
    };
  }

  async function openDispute(
    charge: ClawbackCharge,
    amountCents = charge.amountCents
  ): Promise<string> {
    const id = `dp_lw_${uid()}`;
    createdDisputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: charge.id,
      amountCents,
      currency: 'gbp',
      status: 'needs_response',
      stripeCreatedAt: new Date('2026-10-19T12:00:00Z'),
    });
    return id;
  }

  function run(
    charge: ClawbackCharge,
    refunds: ClawbackRefund[] = [],
    settlingDisputeId?: string
  ) {
    return reverseCharge(deps, {
      charge,
      source: { sourceType: 'subscription' },
      refunds,
      settlingDisputeId,
    });
  }

  /** The chargeback opened, then lost, and the loss applied, as the webhook runs it. */
  async function loseApplied(
    charge: ClawbackCharge,
    amountCents = charge.amountCents
  ): Promise<string> {
    const id = await openDispute(charge, amountCents);
    await run(charge);
    await db
      .update(disputes)
      .set({ status: 'lost' })
      .where(eq(disputes.stripeDisputeId, id));
    await run(charge);
    await db
      .update(disputes)
      .set({ outcomeAppliedAt: new Date() })
      .where(eq(disputes.stripeDisputeId, id));
    return id;
  }

  /** The row as @codex/purchase's `recordLateWin` leaves it. */
  async function winLate(id: string) {
    const now = new Date();
    await db
      .update(disputes)
      .set({
        status: 'won',
        lateWonAt: now,
        lostAppliedAt: sql`${disputes.outcomeAppliedAt}`,
        outcomeAppliedAt: null,
        updatedAt: now,
      })
      .where(eq(disputes.stripeDisputeId, id));
  }

  async function applyWin(id: string) {
    await db
      .update(disputes)
      .set({ outcomeAppliedAt: new Date() })
      .where(eq(disputes.stripeDisputeId, id));
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function stepsOf(payoutId: string) {
    return db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, payoutId));
  }

  /** The dispute's step on a slice, and the re-pay row it links to. */
  async function repayOf(disputeId: string, sliceId: string) {
    const step = takeFirst(
      await db
        .select()
        .from(payoutReversals)
        .where(
          and(
            eq(payoutReversals.causeId, disputeId),
            eq(payoutReversals.payoutId, sliceId)
          )
        )
    );
    return {
      step,
      repay: step.repaidByPayoutId
        ? await readRow(step.repaidByPayoutId)
        : undefined,
    };
  }

  /** The re-pay row the dispute's step on a slice links to; it must exist. */
  async function repayRow(disputeId: string, sliceId: string): Promise<Payout> {
    const { repay } = await repayOf(disputeId, sliceId);
    if (!repay) throw new Error(`no re-pay row for slice ${sliceId}`);
    return repay;
  }

  async function drainable(payoutId: string): Promise<boolean> {
    const rows = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), isDrainablePayout()));
    return rows.length === 1;
  }

  function reversedFrom(transferId: string | null): number[] {
    const calls = vi.mocked(stripe.transfers.createReversal).mock
      .calls as unknown as Array<[string, { amount?: number } | undefined]>;
    return calls
      .filter(([id]) => id === transferId)
      .map(([, params]) => params?.amount ?? 0);
  }

  function refund(amountCents: number): ClawbackRefund {
    return {
      id: `re_lw_${uid()}`,
      amountCents,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  // ── the re-pay after an applied loss (§4.4, §13) ──────────────────────

  it('after an applied loss, the late win re-pays each done step the loss left: a reversed paid slice, a cancelled unpaid one (still cancelled_by_dispute) and a reduced one; the hold keeps them until the win is applied', async () => {
    const whole = newCharge();
    const split = await mixedSplit(whole);
    const wholeId = await loseApplied(whole);
    expect((await readRow(split.org.id)).status).toBe('cancelled_by_dispute');
    expect(reversedFrom(split.creator.stripeTransferId)).toEqual([765]);
    const part = newCharge();
    const unpaid = await slice(part, {
      payoutType: 'creator_payout',
      amountCents: 765,
      status: 'pending',
    });
    const partId = await loseApplied(part, 500);
    expect(await stepsOf(unpaid.id)).toMatchObject([
      { kind: 'pending_reduction', status: 'done', amountCents: 382 },
    ]);
    await winLate(wholeId);
    await winLate(partId);

    expect(await repayDispute(deps, { disputeId: wholeId })).toEqual({
      repaid: 2,
      cancelled: 0,
      debtsClosed: 0,
    });
    expect(await repayDispute(deps, { disputeId: partId })).toEqual({
      repaid: 1,
      cancelled: 0,
      debtsClosed: 0,
    });

    const reversal = await repayOf(wholeId, split.creator.id);
    const cancellation = await repayOf(wholeId, split.org.id);
    const reduction = await repayOf(partId, unpaid.id);
    expect(reversal.step.kind).toBe('transfer_reversal');
    expect(cancellation.step.kind).toBe('cancellation');
    expect(reduction.step.kind).toBe('pending_reduction');
    for (const [{ repay }, cents] of [
      [reversal, 765],
      [cancellation, 135],
      [reduction, 382],
    ] as const) {
      expect(repay).toMatchObject({
        amountCents: cents,
        status: 'pending',
        stripeChargeId: null,
      });
    }
    // The cancelled slice keeps its status: a new row carries the money.
    expect((await readRow(split.org.id)).status).toBe('cancelled_by_dispute');
    // The fee's share is cancelled, not re-paid.
    expect(await repayOf(wholeId, split.platform.id)).toMatchObject({
      step: { kind: 'retained_fee', status: 'cancelled' },
      repay: undefined,
    });

    // Held while the win is not yet applied, paid by the drain after.
    const repayIds = [
      await repayRow(wholeId, split.creator.id),
      await repayRow(wholeId, split.org.id),
      await repayRow(partId, unpaid.id),
    ].map((repay) => repay.id);
    for (const id of repayIds) expect(await drainable(id)).toBe(false);
    await applyWin(wholeId);
    await applyWin(partId);
    for (const id of repayIds) expect(await drainable(id)).toBe(true);
  });

  // ── the refund's wait (§4.7) ──────────────────────────────────────────

  it('a refund’s clawback waits while a won chargeback on its charge is unapplied; the win’s own settlement passes; once applied, nothing waits', async () => {
    const charge = newCharge();
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await openDispute(charge);
    await run(charge);
    await db
      .update(disputes)
      .set({ status: 'won' })
      .where(eq(disputes.stripeDisputeId, disputeId));
    const outside = refund(300);

    const waited = await run(charge, [outside]).catch((error) => error);

    expect(waited).toBeInstanceOf(ServiceUnavailableError);
    expect((waited as ServiceUnavailableError).context).toEqual({
      chargeId: charge.id,
      disputeId,
    });
    expect(
      (await stepsOf(creator.id)).filter((step) => step.causeId === outside.id)
    ).toEqual([]);
    // Nothing to claw back for a refund: no wait for a chargeback alone.
    await expect(run(charge)).resolves.toBeUndefined();
    // The win's own settlement: the re-pay, then the late win's refund.
    await expect(repayDispute(deps, { disputeId })).resolves.toMatchObject({
      repaid: 1,
    });
    await expect(run(charge, [outside], disputeId)).resolves.toBeUndefined();

    await applyWin(disputeId);
    await expect(run(charge, [outside, refund(200)])).resolves.toBeUndefined();
  });

  // ── re-pay first, then the refund (§4.5) ──────────────────────────────

  it('a re-bought buyer’s refund, after the re-pay, takes each share off the held re-pay rows: the payees net nothing for the first payment', async () => {
    const charge = newCharge();
    const split = await mixedSplit(charge);
    const disputeId = await loseApplied(charge);
    await winLate(disputeId);
    await repayDispute(deps, { disputeId });
    const repays = [
      await repayRow(disputeId, split.creator.id),
      await repayRow(disputeId, split.org.id),
    ];
    vi.mocked(stripe.transfers.createReversal).mockClear();
    const first = refund(1000);

    await run(charge, [first], disputeId);

    // The whole share of each re-paid slice comes off its unpaid re-pay row.
    for (const repay of repays) {
      expect(await stepsOf(repay.id)).toMatchObject([
        {
          causeType: 'refund',
          causeId: first.id,
          kind: 'cancellation',
          status: 'done',
        },
      ]);
      expect((await readRow(repay.id)).status).toBe('cancelled_by_refund');
    }
    // Nothing is taken from the slices a second time, and no one is needed.
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    const touched = [
      split.creator.id,
      split.org.id,
      ...repays.map((r) => r.id),
    ];
    expect(
      await db
        .select()
        .from(refundReviews)
        .where(inArray(refundReviews.payoutId, touched))
    ).toEqual([]);
    // A redelivery changes nothing.
    await run(charge, [first], disputeId);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it('a partial loss, then a full refund after the late win: the share the re-pay row cannot carry is left to a person (slice_repaid), never taken from the slice a second time', async () => {
    const charge = newCharge();
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await loseApplied(charge, 500);
    expect(reversedFrom(creator.stripeTransferId)).toEqual([382]);
    await winLate(disputeId);
    const full = refund(1000);

    await repayDispute(deps, { disputeId });
    await run(charge, [full], disputeId);

    // The dispute's 382 was the only take from the slice's own transfer.
    expect(reversedFrom(creator.stripeTransferId)).toEqual([382]);
    const repay = await repayRow(disputeId, creator.id);
    expect(await stepsOf(repay.id)).toMatchObject([
      {
        causeId: full.id,
        kind: 'cancellation',
        status: 'done',
        amountCents: 382,
      },
    ]);
    // The rest of the refund's 765 share: a debt on the slice, for a person.
    expect(
      (await stepsOf(creator.id)).filter((step) => step.causeId === full.id)
    ).toMatchObject([
      { status: 'debt', lastErrorCode: 'slice_repaid', amountCents: 383 },
    ]);
  });
});
