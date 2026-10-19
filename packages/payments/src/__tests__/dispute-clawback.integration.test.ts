/**
 * Disputes in the clawback engine, the drain's hold, and the re-pay of a won
 * dispute (Codex-2hxff.9; design in docs/payments/dispute-record.md, agreed
 * 2026-10-19). Integration tests against the real schema: the guarantees are
 * unique indexes, CHECKs and a NOT EXISTS a mocked db would not enforce.
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
  retryFailedClawbacks,
  reverseCharge,
} from '../clawback';
import { isDrainablePayout } from '../payout-ledger';
import { repayDispute } from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);

describe('disputes in the clawback engine (Codex-2hxff.9)', () => {
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
        .values({ name: 'Dispute Org', slug: createUniqueSlug('dispute') })
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
  // re-pay row is referenced by its reversal (restrict), so reversals go first.
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
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, createdPayoutIds));
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, createdPayoutIds));
      const all = [
        ...createdPayoutIds,
        ...repays.flatMap((r) => (r.id ? [r.id] : [])),
      ];
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

  function newCharge(amountCents: number): ClawbackCharge {
    return { id: `ch_disp_${uid()}`, amountCents };
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

  /** platform 100 + org 135 + creator 765 on a 1000p charge, all paid. */
  async function paidSplit(charge: ClawbackCharge) {
    return {
      platform: await slice(charge, {
        payoutType: 'platform_fee',
        amountCents: 100,
      }),
      org: await slice(charge, {
        payoutType: 'organization_fee',
        amountCents: 135,
      }),
      creator: await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
      }),
    };
  }

  async function dispute(
    charge: ClawbackCharge,
    status: string,
    amountCents = charge.amountCents
  ): Promise<string> {
    const id = `dp_${uid()}`;
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

  async function setDisputeStatus(id: string, status: string) {
    await db
      .update(disputes)
      .set({ status })
      .where(eq(disputes.stripeDisputeId, id));
  }

  function run(charge: ClawbackCharge, refunds: ClawbackRefund[] = []) {
    return reverseCharge(deps, {
      charge,
      source: { sourceType: 'subscription' },
      refunds,
    });
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function records(payoutId: string) {
    return db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, payoutId));
  }

  async function drainable(payoutId: string): Promise<boolean> {
    const rows = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), isDrainablePayout()));
    return rows.length === 1;
  }

  function reversals() {
    const calls = vi.mocked(stripe.transfers.createReversal).mock
      .calls as unknown as Array<[string, unknown, unknown]>;
    return calls.map(([transferId, params, options]) => ({
      transferId,
      amount: (params as { amount?: number } | undefined)?.amount,
      metadata: (params as { metadata?: Record<string, string> } | undefined)
        ?.metadata,
      key: (options as { idempotencyKey?: string } | undefined)?.idempotencyKey,
    }));
  }

  // ── a chargeback ──────────────────────────────────────────────────────

  it('an open chargeback reverses each paid slice by its share, named for the dispute; the fee share is retained', async () => {
    const charge = newCharge(1000);
    const { platform, org, creator } = await paidSplit(charge);
    const disputeId = await dispute(charge, 'needs_response');

    await run(charge);

    const byAmount = [...reversals()].sort(
      (a, b) => (a.amount ?? 0) - (b.amount ?? 0)
    );
    expect(byAmount.map((r) => [r.transferId, r.amount, r.key])).toEqual([
      [
        org.stripeTransferId,
        135,
        `${org.stripeTransferId}_reversal_${disputeId}_0`,
      ],
      [
        creator.stripeTransferId,
        765,
        `${creator.stripeTransferId}_reversal_${disputeId}_0`,
      ],
    ]);
    for (const reversal of byAmount) {
      expect(reversal.metadata).toMatchObject({
        dispute_id: disputeId,
        type: 'dispute_reversal',
        charge_id: charge.id,
      });
      expect(reversal.metadata).not.toHaveProperty('refund_id');
    }
    const [fee] = await records(platform.id);
    expect(fee).toMatchObject({
      causeType: 'dispute',
      causeId: disputeId,
      kind: 'retained_fee',
      status: 'done',
    });
  });

  it('a chargeback on a partly refunded charge takes only what the refunds left', async () => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    await dispute(charge, 'under_review', 600);

    await run(charge, [{ id: `re_${uid()}`, amountCents: 400, createdAt: 1 }]);

    // floor(765 × 400/1000) = 306 for the refund; 765 − 306 for the dispute.
    expect(reversals().map((r) => r.amount)).toEqual([306, 459]);
    expect((await readRow(creator.id)).status).toBe('reversed');
  });

  it('an inquiry takes no money: nothing is reversed', async () => {
    const charge = newCharge(1000);
    await paidSplit(charge);
    await dispute(charge, 'warning_needs_response');

    await run(charge);

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  // ── the hold ──────────────────────────────────────────────────────────

  it('an open chargeback HOLDS an unpaid slice: no record, and no drain can take it until the dispute closes', async () => {
    const charge = newCharge(1000);
    const pending = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
      status: 'pending',
    });
    expect(await drainable(pending.id)).toBe(true);
    const disputeId = await dispute(charge, 'needs_response');

    await run(charge);

    expect(await records(pending.id)).toHaveLength(0);
    expect((await readRow(pending.id)).status).toBe('pending');
    expect(await drainable(pending.id)).toBe(false);

    await setDisputeStatus(disputeId, 'won');
    expect(await drainable(pending.id)).toBe(true);
  });

  it.each([
    'warning_needs_response',
    'warning_under_review',
  ])('an inquiry (%s) holds the sale too (owner decision Q1); one that closes releases it', async (status) => {
    const charge = newCharge(1000);
    const pending = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
      status: 'pending',
    });
    const disputeId = await dispute(charge, status);

    expect(await drainable(pending.id)).toBe(false);
    await setDisputeStatus(disputeId, 'warning_closed');
    expect(await drainable(pending.id)).toBe(true);
  });

  // ── lost ──────────────────────────────────────────────────────────────

  it('lost: a held slice is cancelled as cancelled_by_dispute, and the paid ones stay reversed', async () => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const held = await slice(charge, {
      payoutType: 'organization_fee',
      amountCents: 135,
      status: 'pending',
    });
    const disputeId = await dispute(charge, 'needs_response');
    await run(charge);

    await setDisputeStatus(disputeId, 'lost');
    await run(charge);

    expect((await readRow(held.id)).status).toBe('cancelled_by_dispute');
    expect((await readRow(creator.id)).status).toBe('reversed');
    expect(await drainable(held.id)).toBe(false);
    // The creator was reversed once, when the dispute opened.
    expect(reversals()).toHaveLength(1);
  });

  it('lost for part of the charge: a held slice is reduced by the share, not cancelled', async () => {
    const charge = newCharge(1000);
    const held = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 800,
      status: 'pending',
    });
    await dispute(charge, 'lost', 250);

    await run(charge);

    const [record] = await records(held.id);
    expect(record).toMatchObject({
      kind: 'pending_reduction',
      amountCents: 200,
      status: 'done',
    });
    expect((await readRow(held.id)).status).toBe('pending');
  });

  // ── won: the re-pay ───────────────────────────────────────────────────

  it('won: one pending re-pay row per reversed slice, for the reversed amount, with no charge id; a redelivery writes no second', async () => {
    const charge = newCharge(1000);
    const { org, creator } = await paidSplit(charge);
    const disputeId = await dispute(charge, 'needs_response');
    await run(charge);
    await setDisputeStatus(disputeId, 'won');

    const first = await repayDispute(deps, { disputeId });
    const again = await repayDispute(deps, { disputeId });

    expect(first.repaid).toBe(2);
    expect(again.repaid).toBe(0);
    const repays = await db
      .select({ repay: payouts, record: payoutReversals })
      .from(payoutReversals)
      .innerJoin(payouts, eq(payoutReversals.repaidByPayoutId, payouts.id))
      .where(eq(payoutReversals.causeId, disputeId));
    expect(
      repays
        .map(({ repay, record }) => [record.payoutId, repay.amountCents])
        .sort()
    ).toEqual(
      [
        [org.id, 135],
        [creator.id, 765],
      ].sort()
    );
    for (const { repay } of repays) {
      expect(repay).toMatchObject({
        status: 'pending',
        stripeChargeId: null,
        userId: creatorA,
        sourceType: 'subscription',
      });
      expect(await drainable(repay.id)).toBe(true);
    }
  });

  it('a re-pay row is never a slice of the charge; a later refund of a re-paid slice is recorded for a person', async () => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'needs_response', 500);
    await run(charge);
    await setDisputeStatus(disputeId, 'won');
    await repayDispute(deps, { disputeId });
    vi.mocked(stripe.transfers.createReversal).mockClear();

    await run(charge, [{ id: `re_${uid()}`, amountCents: 300, createdAt: 1 }]);

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    const refundRecord = (await records(creator.id)).find(
      (r) => r.causeType === 'refund'
    );
    expect(refundRecord).toMatchObject({
      status: 'debt',
      lastErrorCode: 'slice_repaid',
    });
    const [review] = await db
      .select()
      .from(refundReviews)
      .where(eq(refundReviews.payoutReversalId, refundRecord?.id ?? ''));
    expect(review).toMatchObject({
      errorCode: 'slice_repaid',
      creatorUserId: creatorA,
    });
  });

  it('won: a step that had not run is cancelled, a debt is closed as dispute_won, and a fee slice the dispute reversed is paid again', async () => {
    const charge = newCharge(1000);
    const { platform, org, creator } = await paidSplit(charge);
    const disputeId = await dispute(charge, 'needs_response');
    // The creator's reversal fails for good (refused, left for the cron); the
    // organisation's hits a balance too low (a debt).
    vi.mocked(stripe.transfers.createReversal).mockImplementation((async (
      id: string
    ) => {
      if (id === creator.stripeTransferId) {
        throw Object.assign(new Error('refused'), {
          code: 'parameter_invalid',
          statusCode: 400,
        });
      }
      throw Object.assign(new Error('low'), {
        code: 'insufficient_funds',
        statusCode: 402,
      });
    }) as never);
    await run(charge);
    expect((await readRow(platform.id)).status).toBe('reversed');
    await setDisputeStatus(disputeId, 'won');

    const result = await repayDispute(deps, { disputeId });

    expect(result).toEqual({ repaid: 0, cancelled: 1, debtsClosed: 1 });
    expect((await records(creator.id))[0]?.status).toBe('cancelled');
    const [orgRecord] = await records(org.id);
    expect(orgRecord?.status).toBe('cancelled');
    const [review] = await db
      .select()
      .from(refundReviews)
      .where(eq(refundReviews.payoutReversalId, orgRecord?.id ?? ''));
    expect(review).toMatchObject({ resolution: 'dispute_won' });
    expect(review?.resolvedAt).not.toBeNull();
    expect((await readRow(platform.id)).status).toBe('paid');
  });

  it('won while another delivery holds a step: asks for a retry, and pays nothing back yet', async () => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'won');
    await db.insert(payoutReversals).values({
      payoutId: creator.id,
      causeType: 'dispute',
      causeId: disputeId,
      amountCents: 765,
      kind: 'transfer_reversal',
      status: 'pending',
      attemptedAt: new Date(),
    });

    await expect(repayDispute(deps, { disputeId })).rejects.toBeInstanceOf(
      ServiceUnavailableError
    );
    expect((await records(creator.id))[0]?.status).toBe('pending');
  });

  // ── review fixes (2026-10-19) ─────────────────────────────────────────

  it('lost keeps holding until the loss is applied: a drain cannot pay a held slice the bank has taken back', async () => {
    const charge = newCharge(1000);
    const held = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
      status: 'pending',
    });
    const disputeId = await dispute(charge, 'lost');

    expect(await drainable(held.id)).toBe(false);
    await db
      .update(disputes)
      .set({ outcomeAppliedAt: new Date() })
      .where(eq(disputes.stripeDisputeId, disputeId));
    expect(await drainable(held.id)).toBe(true);
  });

  it('won: a step whose outcome was never recorded is checked with Stripe, and a reversal that landed is recorded and paid back', async () => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'won');
    const [record] = await db
      .insert(payoutReversals)
      .values({
        payoutId: creator.id,
        causeType: 'dispute',
        causeId: disputeId,
        amountCents: 765,
        kind: 'transfer_reversal',
        // A timeout after Stripe applied it: left failed, same attempt.
        status: 'failed',
        lastErrorCode: 'unknown',
      })
      .returning();
    const landed = await stripe.transfers.createReversal(
      creator.stripeTransferId ?? '',
      { amount: 765, metadata: { payout_reversal_id: record?.id ?? '' } }
    );

    const result = await repayDispute(deps, { disputeId });

    expect(result).toEqual({ repaid: 1, cancelled: 0, debtsClosed: 0 });
    const [step] = await records(creator.id);
    expect(step).toMatchObject({ status: 'done', stripeReversalId: landed.id });
    // Reversed whole, so the slice is `reversed`, as after any reversal.
    expect((await readRow(creator.id)).status).toBe('reversed');
    const repay = await readRow(step?.repaidByPayoutId ?? '');
    expect(repay).toMatchObject({ amountCents: 765, status: 'pending' });
  });

  it.each([
    ['manually_reversed', 1, 'debt'],
    ['creator_absorbed', 1, 'debt'],
    ['platform_absorbed', 0, 'cancelled'],
  ])('won: a debt the support desk settled as %s is paid back only if the payee paid it', async (resolution, repaid, stepStatus) => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'needs_response');
    vi.mocked(stripe.transfers.createReversal).mockRejectedValue(
      Object.assign(new Error('low'), {
        code: 'insufficient_funds',
        statusCode: 402,
      })
    );
    await run(charge);
    const [debt] = await records(creator.id);
    await db
      .update(refundReviews)
      .set({ resolution, resolvedAt: new Date() })
      .where(eq(refundReviews.payoutReversalId, debt?.id ?? ''));
    await setDisputeStatus(disputeId, 'won');

    const result = await repayDispute(deps, { disputeId });

    expect(result.repaid).toBe(repaid);
    expect(result.debtsClosed).toBe(0);
    const [step] = await records(creator.id);
    expect(step?.status).toBe(stepStatus);
    expect(step?.repaidByPayoutId !== null).toBe(repaid === 1);
  });

  it('a dispute won mid-run: a step not yet claimed is not sent to Stripe, and is cancelled', async () => {
    const charge = newCharge(1000);
    await slice(charge, { payoutType: 'organization_fee', amountCents: 135 });
    await slice(charge, { payoutType: 'creator_payout', amountCents: 765 });
    const disputeId = await dispute(charge, 'needs_response');
    // The first reversal "takes long enough" for the win to be recorded.
    const real = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation();
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      ...args: unknown[]
    ) => {
      await setDisputeStatus(disputeId, 'won');
      return (real as (...a: unknown[]) => unknown)(...args);
    }) as never);

    await run(charge);

    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    const steps = await db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.causeId, disputeId));
    expect(steps.map((step) => step.status).sort()).toEqual([
      'cancelled',
      'done',
    ]);
  });

  it('a dispute won mid-run: a step claimed before, whose reversal landed, is left for the re-pay, which records it and pays it back', async () => {
    const charge = newCharge(1000);
    const creator = await slice(charge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const disputeId = await dispute(charge, 'needs_response', 900);
    // The dispute's share after a 100p refund: 765 - floor(765 x 100/1000).
    const [record] = await db
      .insert(payoutReversals)
      .values({
        payoutId: creator.id,
        causeType: 'dispute',
        causeId: disputeId,
        amountCents: 689,
        kind: 'transfer_reversal',
        // Timed out after Stripe applied it: failed, its lease released.
        status: 'failed',
        lastErrorCode: 'unknown',
      })
      .returning();
    const landed = await stripe.transfers.createReversal(
      creator.stripeTransferId ?? '',
      { amount: 689, metadata: { payout_reversal_id: record?.id ?? '' } }
    );
    vi.mocked(stripe.transfers.createReversal).mockClear();
    // Refunds run first: the win is recorded while the refund's reversal is
    // at Stripe, so the dispute's step is reached after it.
    const real = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation();
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      ...args: unknown[]
    ) => {
      await setDisputeStatus(disputeId, 'won');
      return (real as (...a: unknown[]) => unknown)(...args);
    }) as never);

    await run(charge, [{ id: `re_${uid()}`, amountCents: 100, createdAt: 1 }]);

    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    const stepOf = async () =>
      takeFirst(
        await db
          .select()
          .from(payoutReversals)
          .where(eq(payoutReversals.id, record?.id ?? ''))
      );
    expect((await stepOf()).status).toBe('failed');

    const result = await repayDispute(deps, { disputeId });

    expect(result.repaid).toBe(1);
    const step = await stepOf();
    expect(step).toMatchObject({ status: 'done', stripeReversalId: landed.id });
    expect(await readRow(step.repaidByPayoutId ?? '')).toMatchObject({
      amountCents: 689,
    });
  });

  it('the retry cron lifts the hold of a lost dispute whose clawback has finished, and only that one', async () => {
    const finishedCharge = newCharge(1000);
    const finishedSlice = await slice(finishedCharge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const finished = await dispute(finishedCharge, 'lost');
    await db.insert(payoutReversals).values({
      payoutId: finishedSlice.id,
      causeType: 'dispute',
      causeId: finished,
      amountCents: 765,
      kind: 'transfer_reversal',
      status: 'done',
      stripeReversalId: `trr_${uid()}`,
      resolvedAt: new Date(),
    });
    const failingCharge = newCharge(1000);
    const failingSlice = await slice(failingCharge, {
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    const failing = await dispute(failingCharge, 'lost');
    await db.insert(payoutReversals).values({
      payoutId: failingSlice.id,
      causeType: 'dispute',
      causeId: failing,
      amountCents: 765,
      kind: 'transfer_reversal',
      status: 'failed',
      lastErrorCode: 'unknown',
    });
    // No steps: its clawback never ran, so nothing says it finished.
    const untouched = await dispute(newCharge(1000), 'lost');

    const result = await retryFailedClawbacks(deps, { olderThanMinutes: 15 });

    expect(result.lostDisputesApplied).toBeGreaterThanOrEqual(1);
    const applied = async (id: string) =>
      takeFirst(
        await db.select().from(disputes).where(eq(disputes.stripeDisputeId, id))
      ).outcomeAppliedAt !== null;
    expect(await applied(finished)).toBe(true);
    expect(await applied(failing)).toBe(false);
    expect(await applied(untouched)).toBe(false);
  });

  it('won: a fee step a clawback still holds is not cancelled under it; the re-pay asks for a retry', async () => {
    const charge = newCharge(1000);
    const fee = await slice(charge, {
      payoutType: 'platform_fee',
      amountCents: 100,
    });
    const disputeId = await dispute(charge, 'won');
    await db.insert(payoutReversals).values({
      payoutId: fee.id,
      causeType: 'dispute',
      causeId: disputeId,
      amountCents: 100,
      kind: 'retained_fee',
      status: 'pending',
      attemptedAt: new Date(),
    });

    await expect(repayDispute(deps, { disputeId })).rejects.toBeInstanceOf(
      ServiceUnavailableError
    );
    expect((await records(fee.id))[0]?.status).toBe('pending');
  });
});
