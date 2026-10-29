/**
 * A clawback delivery that outlives its lease (Codex-2hxff.72; owner decision
 * 2026-10-27, "Never overwrite; hold for support"). Another path settles the
 * step while the delivery still waits on Stripe: support's `creators_repaid`
 * settlement, or a won dispute's re-pay. The delivery then never changes the
 * step. If its reversal LANDED anyway, the reversal is recorded on the step,
 * whose status stays as settled, ONE error alert names the payee, the amount
 * and the cause, and nothing is re-paid automatically.
 *
 * A late delivery is simulated by the clock alone: the delivery claims its
 * step 11 minutes "ago" (past its lease), and nothing writes the step, so
 * the claim's version is exactly what the delivery wrote.
 */

import { createPerRequestDbClient } from '@codex/database';
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
import {
  type BusinessLogicError,
  InternalServiceError,
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
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
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
  pendingReductionsFor,
  recordPayeeCredit,
  reverseCharge,
} from '../clawback';
import {
  repayDispute,
  repayFailedRefund,
  type StrandedStep,
  settleUnfinishedRefundSteps,
} from '../repay';

const uid = () => crypto.randomUUID().slice(0, 8);
const SOURCE = { sourceType: 'subscription' } as const;
const NOTE = 'Customer kept the course; payees paid back';
/** Past the 10-minute lease (`PAYOUT_ATTEMPT_LEASE_MINUTES`). */
const LATE_MS = 11 * 60_000;

describe('a clawback delivery that outlives its lease (Codex-2hxff.72)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let creatorId: string;
  let supportId: string;
  /** A payee with a Connect account, so a cancel asks Stripe for a late transfer. */
  let payeeId: string;
  let payeeAccountId: string;
  let orgId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdRefundIds: string[] = [];
  const createdDisputeIds: string[] = [];

  type CreateReversal = Stripe['transfers']['createReversal'];
  let makeReversal: CreateReversal;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, supportId, payeeId] = await seedTestUsers(db, 3);
    payeeAccountId = `acct_late_${uid()}`;
    await db.insert(stripeConnectAccounts).values({
      userId: payeeId,
      stripeAccountId: payeeAccountId,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Late Delivery Org', slug: createUniqueSlug('late') })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    obs.warn.mockClear();
    obs.info.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
    makeReversal = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation() as CreateReversal;
  });

  // Payout rows feed global drains and sweeps: never leave them behind. Every
  // row here is the suite's own organisation's, re-pay rows included.
  afterAll(async () => {
    vi.useRealTimers();
    const ours = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.organizationId, orgId));
    const ids = ours.map((row) => row.id);
    if (ids.length > 0) {
      // A late take-back's support item (Codex-2hxff.73) holds its step.
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
    // The delete writes the account's history row (a trigger): both go.
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, payeeId));
    await db
      .delete(stripeConnectAccountHistory)
      .where(eq(stripeConnectAccountHistory.userId, payeeId));
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function newCharge(): ClawbackCharge {
    return { id: `ch_late_${uid()}`, amountCents: 1000 };
  }

  async function slice(
    charge: ClawbackCharge,
    amountCents: number,
    status: 'paid' | 'pending' = 'paid',
    userId = creatorId
  ): Promise<Payout> {
    const paid = status === 'paid';
    return takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId,
          payoutType: 'creator_payout',
          amountCents,
          status,
          sourceType: 'subscription',
          stripeChargeId: charge.id,
          stripeTransferId: paid ? `tr_late_${uid()}` : null,
          reason: paid ? null : 'connect_not_ready',
          resolvedAt: paid ? new Date() : null,
        })
        .returning()
    );
  }

  /** A refund that failed at Stripe, recorded, its clawback not yet run. */
  async function failedRefund(
    charge: ClawbackCharge,
    amountCents: number
  ): Promise<ClawbackRefund> {
    const refund = { id: `re_late_${uid()}`, amountCents, createdAt: 1 };
    createdRefundIds.push(refund.id);
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

  async function openDispute(charge: ClawbackCharge): Promise<string> {
    const id = `dp_late_${uid()}`;
    createdDisputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: charge.id,
      amountCents: charge.amountCents,
      currency: 'gbp',
      status: 'needs_response',
      stripeCreatedAt: new Date(),
    });
    return id;
  }

  /** Support's settlement, as the route runs it: one transaction. */
  function settle(refundId: string, unlanded: readonly StrandedStep[]) {
    const now = new Date();
    return db.transaction(async (tx) => {
      const { repaid } = await repayFailedRefund(tx, {
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
      return repaid;
    });
  }

  async function stepsOf(causeId: string) {
    return db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.causeId, causeId));
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  /**
   * Stripe's next `createReversal` waits until `answer` is called, then
   * answers as `outcome` says: the reversal made (`lands`), a refusal
   * (`refuses`), a balance too low (`insufficient`), the reversal made and
   * its answer lost (`lost`), or no answer and no reversal (`timeout`).
   */
  function holdReversal(
    outcome: 'lands' | 'refuses' | 'insufficient' | 'lost' | 'timeout' = 'lands'
  ) {
    let answer: () => void = () => undefined;
    let reach: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    const made: Stripe.TransferReversal[] = [];
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      ...args: Parameters<CreateReversal>
    ) => {
      reach();
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      if (outcome === 'refuses') {
        throw Object.assign(new Error('refused'), {
          code: 'resource_missing',
          statusCode: 400,
        });
      }
      if (outcome === 'insufficient') {
        throw Object.assign(new Error('balance too low'), {
          code: 'insufficient_funds',
          statusCode: 402,
        });
      }
      if (outcome === 'timeout') {
        throw Object.assign(new Error('socket hang up'), {
          code: 'ECONNRESET',
        });
      }
      const reversal = (await makeReversal(
        ...args
      )) as unknown as Stripe.TransferReversal;
      made.push(reversal);
      if (outcome === 'lost') {
        throw Object.assign(new Error('socket hang up'), {
          code: 'ECONNRESET',
        });
      }
      return reversal;
    }) as never);
    return { reached, answer: () => answer(), made };
  }

  /**
   * Start a delivery that claims its step 11 minutes ago, and return once it
   * waits on Stripe. Only `Date` is faked, and only until then. The run is
   * returned in an object: an async function would wait for it.
   */
  async function lateDelivery(
    start: () => Promise<void>,
    reached: Promise<void>
  ): Promise<{ run: Promise<void> }> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - LATE_MS);
    try {
      const run = start();
      await Promise.race([
        reached,
        run.then(() => {
          throw new Error('the delivery finished before it reached Stripe');
        }),
      ]);
      return { run };
    } finally {
      vi.useRealTimers();
    }
  }

  /** A step's columns but the reversal id a late landing records, and the write stamp. */
  function apartFromRecord(step: PayoutReversal) {
    const { stripeReversalId: _id, updatedAt: _at, ...rest } = step;
    return rest;
  }

  function alerts() {
    return obs.error.mock.calls.map(
      ([, metadata]) => metadata as Record<string, unknown>
    );
  }

  /** The step's "Owed to creators" item (Codex-2hxff.73), if any. */
  async function creditsOf(stepId: string | undefined) {
    return db
      .select()
      .from(payeeCredits)
      .where(eq(payeeCredits.payoutReversalId, stepId ?? ''));
  }

  /** The errorId the one log line saying `text` carries. */
  function idOf(calls: unknown[][]): unknown {
    expect(calls).toHaveLength(1);
    return (calls[0]?.[1] as { errorId?: unknown }).errorId;
  }

  // ── after support's settlement ──────────────────────────────────────

  it('after support cancelled its step, a late reversal that LANDS leaves the step cancelled, records the reversal on it, raises one alert and re-pays nothing', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = await failedRefund(charge, 1000);
    const hold = holdReversal('lands');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] }),
      hold.reached
    );

    // Support settles while the delivery waits on Stripe: its lease ran out,
    // and Stripe has no reversal for the step yet.
    const checked = await settleUnfinishedRefundSteps(deps, {
      stripeRefundId: refund.id,
    });
    expect(checked).toMatchObject({ landed: 0, forPerson: 0 });
    expect(checked.unlanded).toHaveLength(1);
    expect(await settle(refund.id, checked.unlanded)).toEqual([]);
    const [settled] = await stepsOf(refund.id);
    expect(settled).toMatchObject({
      status: 'cancelled',
      stripeReversalId: null,
    });

    hold.answer();
    await run;

    const trr = hold.made[0]?.id;
    expect(trr).toMatch(/^trr_/);
    const [step] = await stepsOf(refund.id);
    expect(step).toMatchObject({
      payoutId: creator.id,
      status: 'cancelled',
      stripeReversalId: trr,
      repaidByPayoutId: null,
    });
    // Only the reversal's id is written: every other column is as the
    // settlement left it, but the row's own write stamp.
    expect(apartFromRecord(step!)).toEqual(apartFromRecord(settled!));
    // The case support finds until its view ships (Codex-2hxff.73).
    expect(
      await db
        .select({ id: payoutReversals.id })
        .from(payoutReversals)
        .where(
          and(
            eq(payoutReversals.causeId, refund.id),
            ne(payoutReversals.status, 'done'),
            isNotNull(payoutReversals.stripeReversalId)
          )
        )
    ).toEqual([{ id: step?.id }]);
    expect(alerts()).toEqual([
      expect.objectContaining({
        errorId: expect.any(String),
        creatorUserId: creatorId,
        amountCents: 765,
        refundId: refund.id,
        payoutReversalId: step?.id,
        stripeReversalId: trr,
        settledAs: 'cancelled',
      }),
    ]);
    // The slice is left as the settlement left it, for support.
    expect((await readRow(creator.id)).status).toBe('paid');
    // Queued for support under the alert's own errorId (§7.1 site 5).
    expect(await creditsOf(step?.id)).toEqual([
      expect.objectContaining({
        effect: 'reversal_landed',
        amountCents: 765,
        payoutId: creator.id,
        payeeUserId: creatorId,
        stripeReversalId: trr,
        stripeTransferId: creator.stripeTransferId,
        settledAs: 'cancelled',
        resolution: null,
        alertErrorId: alerts()[0]?.errorId,
      }),
    ]);

    // A redelivery changes nothing, and alerts no more.
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] });
    expect(obs.error).toHaveBeenCalledTimes(1);
    expect((await stepsOf(refund.id))[0]?.status).toBe('cancelled');
    expect(await creditsOf(step?.id)).toHaveLength(1);
  });

  // ── a confirmed take-back meets a closed credit (owner decision
  //    2026-10-28 on review MED-1, "Reopen if the system closed it") ──

  it("the reviewer's case: the settlement decided the payee kept the transfer, then the slow delivery's reversal of it landed: the system-closed credit reopens as owed what Stripe took", async () => {
    const charge = newCharge();
    const pending = await slice(charge, 765, 'pending', payeeId);
    const refund = await failedRefund(charge, 1000);
    // A drain's transfer for the slice, sent anyway.
    const transfer = await stripe.transfers.create({
      amount: 765,
      currency: 'gbp',
      destination: payeeAccountId,
      metadata: { payout_id: pending.id },
    });
    const hold = holdReversal('lands');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] }),
      hold.reached
    );
    // Support settles while the delivery waits on Stripe: no reversal yet,
    // and the transfer is not reversed, so the payee kept it (§6.2).
    const checked = await settleUnfinishedRefundSteps(deps, {
      stripeRefundId: refund.id,
    });
    expect(checked.unlanded).toEqual([
      expect.objectContaining({
        payeeKept: expect.objectContaining({ stripeTransferId: transfer.id }),
      }),
    ]);
    expect(await settle(refund.id, checked.unlanded)).toEqual([]);
    const [step] = await stepsOf(refund.id);
    expect(step).toMatchObject({
      status: 'cancelled',
      lastErrorCode: 'system_payee_kept',
    });
    expect(await creditsOf(step?.id)).toEqual([
      expect.objectContaining({
        effect: 'transfer_kept',
        resolution: 'not_owed',
        resolvedByUserId: null,
      }),
    ]);

    hold.answer();
    await run;

    const trr = hold.made[0];
    expect(trr?.amount).toBe(765);
    const took = errorsSaying('held for support to re-pay');
    expect(await creditsOf(step?.id)).toEqual([
      expect.objectContaining({
        effect: 'reversal_landed',
        amountCents: 765,
        stripeReversalId: trr?.id,
        stripeTransferId: transfer.id,
        settledAs: 'cancelled',
        resolution: null,
        resolvedAt: null,
        resolvedByUserId: null,
        resolutionNote: null,
        alertErrorId: idOf(took),
      }),
    ]);
    expect(warningsSaying('reopened a credit the system had closed')).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          wasEffect: 'transfer_kept',
          amountCents: 765,
          alertErrorId: idOf(took),
        }),
      ],
    ]);
    expect(errorsSaying('reopen by hand')).toEqual([]);
  });

  /**
   * Support's settlement cancels a paid slice's step while its delivery
   * waits on Stripe (as above), then `closed` is how its credit stands when
   * the late reversal lands.
   */
  async function landsOnClosedCredit(
    closed: Partial<typeof payeeCredits.$inferInsert>
  ) {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = await failedRefund(charge, 1000);
    const hold = holdReversal('lands');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] }),
      hold.reached
    );
    const checked = await settleUnfinishedRefundSteps(deps, {
      stripeRefundId: refund.id,
    });
    await settle(refund.id, checked.unlanded);
    const [step] = await stepsOf(refund.id);
    const credit = takeFirst(
      await db
        .insert(payeeCredits)
        .values({
          payoutReversalId: step?.id ?? '',
          payoutId: creator.id,
          payeeUserId: creatorId,
          effect: 'unverified',
          stripeTransferId: creator.stripeTransferId,
          settledAs: 'cancelled',
          alertErrorId: crypto.randomUUID(),
          resolution: 'not_owed',
          resolvedAt: new Date(),
          ...closed,
        })
        .returning()
    );
    hold.answer();
    await run;
    return {
      credit,
      trr: hold.made[0],
      took: errorsSaying('held for support to re-pay'),
    };
  }

  it("a check had closed it not owed (Stripe showed nothing yet), then the reversal landed: the system's close reopens as owed", async () => {
    const { credit, trr, took } = await landsOnClosedCredit({
      resolvedByUserId: null,
      resolutionNote: 'Stripe shows nothing was taken',
      checkedAt: new Date(),
    });

    expect(await creditsOf(credit.payoutReversalId)).toEqual([
      expect.objectContaining({
        id: credit.id,
        effect: 'reversal_landed',
        amountCents: 765,
        stripeReversalId: trr?.id,
        resolution: null,
        resolvedAt: null,
        resolutionNote: null,
        alertErrorId: idOf(took),
      }),
    ]);
    expect(warningsSaying('reopened a credit the system had closed')).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          creditId: credit.id,
          wasEffect: 'unverified',
          wasNote: 'Stripe shows nothing was taken',
        }),
      ],
    ]);
  });

  it('a person had closed it not owed, then the reversal landed: their decision stands, and an error under the alert names the credit to reopen by hand', async () => {
    const { credit, trr, took } = await landsOnClosedCredit({
      resolvedByUserId: supportId,
      resolutionNote: 'Checked Stripe: nothing taken',
    });

    expect(await creditsOf(credit.payoutReversalId)).toEqual([credit]);
    expect(
      errorsSaying('A confirmed take-back met a settled credit: reopen by hand')
    ).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          errorId: idOf(took),
          creditId: credit.id,
          creditResolution: 'not_owed',
          findingEffect: 'reversal_landed',
          findingAmountCents: 765,
          stripeReversalId: trr?.id,
        }),
      ],
    ]);
    expect(warningsSaying('reopened a credit')).toEqual([]);
  });

  it('after support cancelled its step, a late refusal leaves it cancelled, never failed for the retry cron; nothing landed, so no alert', async () => {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = await failedRefund(charge, 1000);
    const hold = holdReversal('refuses');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] }),
      hold.reached
    );
    const checked = await settleUnfinishedRefundSteps(deps, {
      stripeRefundId: refund.id,
    });
    await settle(refund.id, checked.unlanded);

    hold.answer();
    await run;

    const steps = await stepsOf(refund.id);
    expect(steps).toMatchObject([
      { status: 'cancelled', attempt: 0, stripeReversalId: null },
    ]);
    expect(obs.error).not.toHaveBeenCalled();
    expect(await creditsOf(steps[0]?.id)).toEqual([]);
  });

  it('after support cancelled its step, a late reversal whose answer was LOST is looked up at Stripe: it landed, so it is recorded and alerted once', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = await failedRefund(charge, 1000);
    const hold = holdReversal('lost');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] }),
      hold.reached
    );
    const checked = await settleUnfinishedRefundSteps(deps, {
      stripeRefundId: refund.id,
    });
    await settle(refund.id, checked.unlanded);

    hold.answer();
    await run.catch(() => undefined);

    const trr = hold.made[0]?.id;
    expect(trr).toMatch(/^trr_/);
    expect(stripe.transfers.listReversals).toHaveBeenCalledWith(
      creator.stripeTransferId,
      expect.anything()
    );
    const steps = await stepsOf(refund.id);
    expect(steps).toMatchObject([
      { status: 'cancelled', stripeReversalId: trr },
    ]);
    expect(alerts()).toEqual([
      expect.objectContaining({
        creatorUserId: creatorId,
        amountCents: 765,
        refundId: refund.id,
        stripeReversalId: trr,
        settledAs: 'cancelled',
      }),
    ]);
    expect(await creditsOf(steps[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'reversal_landed',
        amountCents: 765,
        stripeReversalId: trr,
        alertErrorId: alerts()[0]?.errorId,
      }),
    ]);
  });

  /**
   * The step settled while the delivery waits on Stripe, then `settledAs`
   * applied to it by hand, then the reversal lands.
   */
  async function landOnSettled(settledAs: Partial<PayoutReversal>) {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = await failedRefund(charge, 1000);
    const hold = holdReversal('lands');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] }),
      hold.reached
    );
    const checked = await settleUnfinishedRefundSteps(deps, {
      stripeRefundId: refund.id,
    });
    await settle(refund.id, checked.unlanded);
    const [cancelled] = await stepsOf(refund.id);
    await db
      .update(payoutReversals)
      .set(settledAs)
      .where(eq(payoutReversals.id, cancelled?.id ?? ''));
    const [settled] = await stepsOf(refund.id);
    hold.answer();
    await run;
    const [step] = await stepsOf(refund.id);
    return { settled: settled!, step: step!, trr: hold.made[0]?.id };
  }

  it('a settled step that already names a reversal keeps it: the landing is alerted, never written over it', async () => {
    const earlier = `trr_earlier_${uid()}`;
    const { settled, step, trr } = await landOnSettled({
      stripeReversalId: earlier,
    });

    expect(step).toEqual(settled);
    expect(step).toMatchObject({
      status: 'cancelled',
      stripeReversalId: earlier,
    });
    expect(alerts()).toEqual([
      expect.objectContaining({
        stripeReversalId: trr,
        recordedReversalId: earlier,
        settledAs: 'cancelled',
      }),
    ]);
  });

  it('a step another path marked done is not written: the reversal would read as its own, so only the alert names it', async () => {
    const { settled, step, trr } = await landOnSettled({ status: 'done' });

    expect(step).toEqual(settled);
    expect(step).toMatchObject({ status: 'done', stripeReversalId: null });
    expect(alerts()).toEqual([
      expect.objectContaining({
        stripeReversalId: trr,
        recordedReversalId: null,
        settledAs: 'done',
      }),
    ]);
    // Queued as found on a done step: support's Re-pay refuses it as one to
    // settle by hand (data design §7.4 step 3).
    expect(await creditsOf(step.id)).toEqual([
      expect.objectContaining({
        effect: 'reversal_landed',
        settledAs: 'done',
        stripeReversalId: trr,
      }),
    ]);
  });

  // ── after a won dispute's re-pay ────────────────────────────────────

  it("after a won dispute's re-pay cancelled its step, a late reversal that LANDS leaves it cancelled, records it, raises one alert and re-pays nothing", async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const disputeId = await openDispute(charge);
    const hold = holdReversal('lands');
    const { run } = await lateDelivery(
      () => reverseCharge(deps, { charge, source: SOURCE, refunds: [] }),
      hold.reached
    );

    // The dispute is won while the delivery waits on Stripe.
    await db
      .update(disputes)
      .set({ status: 'won' })
      .where(eq(disputes.stripeDisputeId, disputeId));
    expect(await repayDispute(deps, { disputeId })).toEqual({
      repaid: 0,
      cancelled: 1,
      debtsClosed: 0,
    });

    hold.answer();
    await run;

    const trr = hold.made[0]?.id;
    expect(trr).toMatch(/^trr_/);
    const [step] = await stepsOf(disputeId);
    expect(step).toMatchObject({
      payoutId: creator.id,
      status: 'cancelled',
      stripeReversalId: trr,
      repaidByPayoutId: null,
    });
    expect(alerts()).toEqual([
      expect.objectContaining({
        errorId: expect.any(String),
        creatorUserId: creatorId,
        amountCents: 765,
        disputeId,
        payoutReversalId: step?.id,
        stripeReversalId: trr,
        settledAs: 'cancelled',
      }),
    ]);

    // A redelivery of the win pays nothing back for it: no automatic re-pay.
    expect(await repayDispute(deps, { disputeId })).toEqual({
      repaid: 0,
      cancelled: 0,
      debtsClosed: 0,
    });
    expect((await stepsOf(disputeId))[0]?.repaidByPayoutId).toBeNull();
  });

  // ── a database-only step ────────────────────────────────────────────

  /**
   * A connection of the test's own, as repay-failed-refund's race tests open
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

  /** Resolve once backend `waiter` waits on a `payouts` lock `holder` holds. */
  async function untilWaitingOnPayouts(
    waiter: number,
    holder: number,
    work: { outcome: () => string | undefined }
  ): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const settled = work.outcome();
      if (settled) throw new Error(`settled before it waited: ${settled}`);
      const { rows } = await db.execute(
        sql`select 1 from pg_stat_activity
            where pid = ${waiter}::int
              and ${holder}::int = any(pg_blocking_pids(pid))
              and query ilike ${'%"payouts"%'}`
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const { rows } = await db.execute(
      sql`select state, wait_event_type, left(query, 120) as query from pg_stat_activity where pid = ${waiter}::int`
    );
    throw new Error(`never waited on payouts: ${JSON.stringify(rows)}`);
  }

  it('after support cancelled its step, a late reduction of an unpaid slice never commits: the drain will pay the slice whole', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765, 'pending');
    const refund = await failedRefund(charge, 500);
    const deliverer = await ownConnection();
    let run: Promise<void> = Promise.resolve();
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // A drain holds the slice, as its claim's UPDATE does, so the
        // delivery's reduction waits for it. NO KEY: the step's insert still
        // takes its foreign-key lock on the slice.
        await tx
          .select({ id: payouts.id })
          .from(payouts)
          .where(eq(payouts.id, creator.id))
          .for('no key update');
        const holder = await backendPid(tx);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() - LATE_MS);
        try {
          let outcome: string | undefined;
          run = reverseCharge(
            { ...deps, db: deliverer.db },
            { charge, source: SOURCE, refunds: [refund] }
          );
          run.then(
            () => {
              outcome = 'resolved';
            },
            (error: unknown) => {
              outcome = String(error);
            }
          );
          await untilWaitingOnPayouts(deliverer.pid, holder, {
            outcome: () => outcome,
          });
        } finally {
          vi.useRealTimers();
        }

        // Support settles meanwhile: the step's lease ran out.
        const checked = await settleUnfinishedRefundSteps(deps, {
          stripeRefundId: refund.id,
        });
        expect(checked.unlanded).toHaveLength(1);
        await settle(refund.id, checked.unlanded);
      });
      await run;
    } finally {
      await run.catch(() => undefined);
      await deliverer.cleanup();
    }

    expect(await stepsOf(refund.id)).toMatchObject([
      { kind: 'pending_reduction', status: 'cancelled' },
    ]);
    expect((await pendingReductionsFor(db, [creator.id])).get(creator.id)).toBe(
      undefined
    );
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('the lease is renewed before the slice is cancelled: a settlement while the cancel runs finds the step freshly leased and refuses', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765, 'pending');
    const refund = await failedRefund(charge, 1000);
    const deliverer = await ownConnection();
    // The claim is made 11 minutes ago. Once the claim's transaction has
    // committed the clock is real again, so the renewal is a fresh lease.
    const claimsLate = new Proxy(deliverer.db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === 'transaction') {
          const transaction = value as (...a: unknown[]) => Promise<unknown>;
          return (...a: unknown[]) =>
            transaction.apply(target, a).finally(() => vi.useRealTimers());
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let run: Promise<void> = Promise.resolve();
    let unlanded: StrandedStep[] = [];
    let settling: Promise<unknown> = Promise.resolve();
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // A drain holds the slice, so the delivery's cancel waits for it,
        // after its renewal has committed.
        await tx
          .select({ id: payouts.id })
          .from(payouts)
          .where(eq(payouts.id, creator.id))
          .for('no key update');
        const holder = await backendPid(tx);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() - LATE_MS);
        try {
          let outcome: string | undefined;
          run = reverseCharge(
            { ...deps, db: claimsLate },
            { charge, source: SOURCE, refunds: [refund] }
          );
          run.then(
            () => {
              outcome = 'resolved';
            },
            (error: unknown) => {
              outcome = String(error);
            }
          );
          await untilWaitingOnPayouts(deliverer.pid, holder, {
            outcome: () => outcome,
          });
        } finally {
          vi.useRealTimers();
        }

        // Support settles while the cancel waits on the slice.
        ({ unlanded } = await settleUnfinishedRefundSteps(deps, {
          stripeRefundId: refund.id,
        }));
        settling = settle(refund.id, unlanded).catch((error: unknown) => error);
        await settling;
      });
      await run;
    } finally {
      await run.catch(() => undefined);
      await deliverer.cleanup();
    }

    // The renewed lease is fresh: not a step no retry will run.
    expect(unlanded).toEqual([]);
    expect(((await settling) as BusinessLogicError).context).toMatchObject({
      code: 'REFUND_CLAWBACK_UNFINISHED',
    });
    expect(await stepsOf(refund.id)).toMatchObject([
      { kind: 'cancellation', status: 'done' },
    ]);
    expect((await readRow(creator.id)).status).toBe('cancelled_by_refund');
    expect(obs.error).not.toHaveBeenCalled();
  });

  /**
   * `db`, but the `n`th cancel of an unpaid slice (`payouts` set to
   * `cancelled_by_refund`) throws, inside a transaction or out, as
   * subscription-refund-clawback's Codex-2hxff.51 suite injects it.
   */
  function failingCancel(n: number): Database {
    let cancels = 0;
    const wrap = <T extends object>(client: T): T =>
      new Proxy(client, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === 'update') {
            return (table: typeof payouts) => {
              const builder = (
                value as (t: typeof payouts) => {
                  set: (values: Record<string, unknown>) => unknown;
                }
              ).call(target, table);
              const realSet = builder.set.bind(builder);
              builder.set = (values) => {
                if (
                  table === payouts &&
                  values.status === 'cancelled_by_refund' &&
                  ++cancels === n
                ) {
                  throw new Error('injected cancel failure');
                }
                return realSet(values);
              };
              return builder;
            };
          }
          if (prop === 'transaction') {
            const transaction = value as (
              fn: (tx: unknown) => Promise<unknown>,
              ...rest: unknown[]
            ) => Promise<unknown>;
            return (
              fn: (tx: unknown) => Promise<unknown>,
              ...rest: unknown[]
            ) =>
              transaction.call(
                target,
                (tx: unknown) => fn(wrap(tx as object)),
                ...rest
              );
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    return wrap(db);
  }

  it('a cancel that throws: every other slice is still cancelled, then the call rejects with that failure as its cause (Codex-2hxff.51)', async () => {
    const charge = newCharge();
    // One slice per payee per charge (`uq_payouts_creator_slice_per_charge`).
    const rows = [
      await slice(charge, 300, 'pending', creatorId),
      await slice(charge, 300, 'pending', payeeId),
      await slice(charge, 100, 'pending', supportId),
    ];
    const refund = fullRefund();

    const failure = await reverseCharge(
      { ...deps, db: failingCancel(2) },
      { charge, source: SOURCE, refunds: [refund] }
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(InternalServiceError);
    expect((failure as Error).cause).toMatchObject({
      message: 'injected cancel failure',
    });
    const statuses = await Promise.all(
      rows.map(async (row) => (await readRow(row.id)).status)
    );
    expect([...statuses].sort()).toEqual([
      'cancelled_by_refund',
      'cancelled_by_refund',
      'pending',
    ]);
    // The failed step is released for the retry, which cancels the last.
    await reverseCharge(deps, { charge, source: SOURCE, refunds: [refund] });
    const after = await Promise.all(rows.map((row) => readRow(row.id)));
    expect(after.every((row) => row.status === 'cancelled_by_refund')).toBe(
      true
    );
  });

  // ── what a late write reports, and only once ────────────────────────

  /**
   * `db`, but the numbered calls of `select` or `update` made after `arm()`
   * fail: `{ select: [1] }` fails the first select after it. Transactions are
   * passed through.
   */
  function faultyDb(plan: {
    select?: number[];
    update?: number[];
    insert?: number[];
  }) {
    const counts = { select: 0, update: 0, insert: 0 };
    let armed = false;
    const faulty = new Proxy(db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (
          armed &&
          (prop === 'select' || prop === 'update' || prop === 'insert')
        ) {
          counts[prop]++;
          const n = counts[prop];
          if (plan[prop]?.includes(n)) {
            return () => {
              throw new Error(`injected ${prop} failure #${n}`);
            };
          }
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return {
      db: faulty,
      arm: () => {
        armed = true;
      },
    };
  }

  /** Settle a step by hand as any settlement leaves it: its lease cleared. */
  async function settleByHand(
    causeId: string,
    set: Partial<PayoutReversal> = { status: 'cancelled' }
  ) {
    await db
      .update(payoutReversals)
      .set({ attemptedAt: null, resolvedAt: new Date(), ...set })
      .where(eq(payoutReversals.causeId, causeId));
  }

  /** A refund of the whole charge, with nothing recorded for it. */
  function fullRefund(): ClawbackRefund {
    return { id: `re_late_${uid()}`, amountCents: 1000, createdAt: 1 };
  }

  function errorsSaying(text: string) {
    return obs.error.mock.calls.filter(([message]) =>
      String(message).includes(text)
    );
  }

  function warningsSaying(text: string) {
    return obs.warn.mock.calls.filter(([message]) =>
      String(message).includes(text)
    );
  }

  it('a landed reversal whose step cannot then be read raises ONE check-by-hand alert naming it, and the failure is not reported twice', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = fullRefund();
    const fault = faultyDb({ select: [1] });
    const hold = holdReversal('lands');
    const run = reverseCharge(
      { ...deps, db: fault.db },
      { charge, source: SOURCE, refunds: [refund] }
    );
    await hold.reached;
    await settleByHand(refund.id);
    fault.arm();
    hold.answer();

    const failure = await run.then(
      () => undefined,
      (error: unknown) => error
    );

    const trr = hold.made[0]?.id;
    expect(failure).toBeInstanceOf(InternalServiceError);
    expect(errorsSaying('landed under a lost claim')).toEqual([
      [
        expect.stringContaining('the step could not be read; check by hand'),
        expect.objectContaining({
          errorId: expect.any(String),
          stripeReversalId: trr,
          amountCents: 765,
          creatorUserId: creatorId,
          payoutReversalId: (await stepsOf(refund.id))[0]?.id,
          payoutId: creator.id,
          chargeId: charge.id,
          refundId: refund.id,
        }),
      ],
    ]);
    expect(errorsSaying('took money')).toEqual([]);
    expect(errorsSaying('could not be read')).toHaveLength(1);
    // The original failure is still logged, once.
    expect(errorsSaying('clawback step failed')).toHaveLength(1);
    // Best effort, once the step reads again: for support to check (§7.1 site 1).
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'unverified',
        amountCents: null,
        stripeReversalId: trr,
        settledAs: 'cancelled',
        alertErrorId: idOf(errorsSaying('landed under a lost claim')),
      }),
    ]);
  });

  it('a landed reversal whose record cannot be written: the follow-up carries the alert’s own errorId, never a second alert', async () => {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = fullRefund();
    // 1: markDone, which misses. 2: the record of the landing.
    const fault = faultyDb({ update: [2] });
    const hold = holdReversal('lands');
    const run = reverseCharge(
      { ...deps, db: fault.db },
      { charge, source: SOURCE, refunds: [refund] }
    );
    await hold.reached;
    await settleByHand(refund.id);
    fault.arm();
    hold.answer();
    await run.catch(() => undefined);

    const landed = errorsSaying('took money');
    const unrecorded = errorsSaying('could not be recorded');
    expect(landed).toHaveLength(1);
    expect(unrecorded).toHaveLength(1);
    const errorId = (landed[0]?.[1] as { errorId?: string }).errorId;
    expect(errorId).toEqual(expect.any(String));
    expect(unrecorded[0]?.[1]).toMatchObject({
      errorId,
      stripeReversalId: hold.made[0]?.id,
    });
    expect((await stepsOf(refund.id))[0]).toMatchObject({
      status: 'cancelled',
      stripeReversalId: null,
    });
  });

  /** Stripe's reversal is made, then `fault` arms: the step is this run's. */
  function landThenArm(fault: { arm: () => void }) {
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      ...args: Parameters<CreateReversal>
    ) => {
      const reversal = await makeReversal(...args);
      fault.arm();
      return reversal;
    }) as never);
  }

  it("a run's own done whose slice settle fails: the error is logged first, the settle re-run, and no settled-meanwhile warning", async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = fullRefund();
    const fault = faultyDb({ select: [1] });
    landThenArm(fault);

    const failure = await reverseCharge(
      { ...deps, db: fault.db },
      { charge, source: SOURCE, refunds: [refund] }
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    expect((failure as Error).cause).toMatchObject({
      message: 'injected select failure #1',
    });
    expect(errorsSaying('clawback step failed')).toEqual([
      [
        expect.any(String),
        expect.objectContaining({ error: 'injected select failure #1' }),
      ],
    ]);
    expect((await stepsOf(refund.id))[0]?.status).toBe('done');
    expect((await readRow(creator.id)).status).toBe('reversed');
    expect(warningsSaying('settled while its delivery ran')).toEqual([]);
    expect(warningsSaying('another delivery')).toEqual([]);
  });

  it('a recovery that fails too is alerted with the payout, and the ORIGINAL failure is returned, not thrown past the other steps', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = fullRefund();
    const fault = faultyDb({ select: [1, 2] });
    landThenArm(fault);

    const failure = await reverseCharge(
      { ...deps, db: fault.db },
      { charge, source: SOURCE, refunds: [refund] }
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    // The step's own failure, wrapped as every incomplete clawback is.
    expect(failure).toBeInstanceOf(InternalServiceError);
    expect((failure as Error).cause).toMatchObject({
      message: 'injected select failure #1',
    });
    const logged = obs.error.mock.calls.map(([message]) => String(message));
    const first = logged.findIndex((m) => m.includes('clawback step failed'));
    const recovery = logged.findIndex((m) =>
      m.includes('slice settle not re-run')
    );
    expect(first).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeGreaterThan(first);
    expect(obs.error.mock.calls[recovery]?.[1]).toMatchObject({
      errorId: expect.any(String),
      payoutId: creator.id,
      error: 'injected select failure #2',
    });
  });

  // ── a cancelled slice's late transfer ───────────────────────────────

  /**
   * Stripe lists `transferId` (or none) as made for `slice`, once asked, or
   * cannot be asked at all (`'fails'`).
   */
  function lateTransfer(slice: Payout, transferId: string | null | 'fails') {
    let answer: () => void = () => undefined;
    let reach: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    vi.mocked(stripe.transfers.list).mockImplementationOnce((async () => {
      reach();
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      if (transferId === 'fails') {
        throw Object.assign(new Error('Stripe is down'), {
          code: 'api_connection_error',
        });
      }
      return {
        object: 'list',
        data: transferId
          ? [{ id: transferId, metadata: { payout_id: slice.id } }]
          : [],
        has_more: false,
      };
    }) as never);
    return { reached, answer: () => answer() };
  }

  it.each([
    ['a balance too low', 'insufficient' as const],
    ['a definitive refusal', 'refuses' as const],
  ])('a cancelled slice whose late transfer Stripe refused to reverse (%s) under a settled step: "do not re-pay", never "took money"', async (_why, refusal) => {
    const charge = newCharge();
    const pending = await slice(charge, 765, 'pending', payeeId);
    const refund = fullRefund();
    const transferId = `tr_late_${uid()}`;
    const list = lateTransfer(pending, transferId);
    const hold = holdReversal(refusal);
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await list.reached;
    list.answer();
    await hold.reached;
    await settleByHand(refund.id);
    hold.answer();
    await run.catch(() => undefined);

    expect(errorsSaying('took money')).toEqual([]);
    expect(errorsSaying('do not re-pay')).toEqual([
      [
        expect.stringContaining(
          'its transfer is still with the payee and was NOT reversed'
        ),
        expect.objectContaining({
          errorId: expect.any(String),
          stripeTransferId: transferId,
          creatorUserId: payeeId,
          amountCents: 765,
          settledAs: 'cancelled',
        }),
      ],
    ]);
    const [step] = await stepsOf(refund.id);
    expect(step).toMatchObject({ status: 'cancelled', stripeReversalId: null });
    // No debt was queued under the settled step.
    expect(
      await db
        .select({ id: refundReviews.id })
        .from(refundReviews)
        .where(eq(refundReviews.payoutReversalId, step?.id ?? ''))
    ).toEqual([]);
    // Recorded, but not owed: born resolved by the system (§7.1 site 3a).
    expect(await creditsOf(step?.id)).toEqual([
      expect.objectContaining({
        effect: 'transfer_kept',
        amountCents: null,
        stripeTransferId: transferId,
        settledAs: 'cancelled',
        resolution: 'not_owed',
        resolvedByUserId: null,
        resolvedAt: expect.any(Date),
        resolutionNote: 'The payee kept the transfer for this share',
        alertErrorId: idOf(errorsSaying('do not re-pay')),
      }),
    ]);
  });

  it('a definitive refusal whose confirming transfer lookup TIMED OUT, under a settled step: unverified for "Check Stripe again", never a born-resolved "was NOT reversed" (review MED-5)', async () => {
    const charge = newCharge();
    const pending = await slice(charge, 765, 'pending', payeeId);
    const refund = fullRefund();
    const transferId = `tr_late_${uid()}`;
    const list = lateTransfer(pending, transferId);
    const hold = holdReversal('refuses');
    // Stripe can't be asked whether the transfer is reversed: the drain's
    // surplus reversal may have taken it all first.
    vi.mocked(stripe.transfers.retrieve).mockRejectedValue(
      Object.assign(new Error('timed out'), { type: 'StripeConnectionError' })
    );
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await list.reached;
    list.answer();
    await hold.reached;
    await settleByHand(refund.id);
    hold.answer();
    await run.catch(() => undefined);

    expect(stripe.transfers.retrieve).toHaveBeenCalledWith(transferId);
    expect(errorsSaying('took money')).toEqual([]);
    expect(errorsSaying('was NOT reversed')).toEqual([]);
    const unconfirmed = errorsSaying('outcome unconfirmed: check Stripe');
    expect(unconfirmed).toEqual([
      [
        expect.stringContaining(
          'Stripe refused its transfer reversal and could not say whether the transfer is reversed'
        ),
        expect.objectContaining({
          errorId: expect.any(String),
          stripeTransferId: transferId,
          creatorUserId: payeeId,
          settledAs: 'cancelled',
          unconfirmed: true,
        }),
      ],
    ]);
    // In the queue, for support to check Stripe again.
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'unverified',
        stripeTransferId: transferId,
        resolution: null,
        resolvedAt: null,
        alertErrorId: idOf(unconfirmed),
      }),
    ]);
  });

  it('a cancelled slice whose transfer lookup FAILED, under a step settled meanwhile: the unconfirmed alert, never "took money"', async () => {
    const charge = newCharge();
    const pending = await slice(charge, 765, 'pending', payeeId);
    const refund = fullRefund();
    const list = lateTransfer(pending, 'fails');
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await list.reached;
    await settleByHand(refund.id);
    list.answer();
    await run;

    expect(errorsSaying('took money')).toEqual([]);
    // The lookup's own alert, as `cancelUnpaidPayout` always raised it.
    expect(
      errorsSaying('could not be asked whether its transfer went out')
    ).toHaveLength(1);
    const unconfirmed = errorsSaying('outcome unconfirmed: check Stripe');
    expect(unconfirmed).toEqual([
      [
        expect.stringContaining(
          'Stripe could not say whether a transfer went out for it'
        ),
        expect.objectContaining({
          errorId: expect.any(String),
          creatorUserId: payeeId,
          amountCents: 765,
          settledAs: 'cancelled',
          unconfirmed: true,
        }),
      ],
    ]);
    expect(String(unconfirmed[0]?.[0])).not.toContain('was NOT reversed');
    // For support to check Stripe again (§7.1 site 3c).
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'unverified',
        amountCents: null,
        stripeTransferId: null,
        resolution: null,
        alertErrorId: idOf(unconfirmed),
      }),
    ]);
  });

  it('a cancelled slice\'s late transfer whose reversal answer was LOST, with nothing at Stripe, under a settled step: check Stripe, never "was NOT reversed"', async () => {
    const charge = newCharge();
    const pending = await slice(charge, 765, 'pending', payeeId);
    const refund = fullRefund();
    const transferId = `tr_late_${uid()}`;
    const list = lateTransfer(pending, transferId);
    const hold = holdReversal('timeout');
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await list.reached;
    list.answer();
    await hold.reached;
    await settleByHand(refund.id);
    hold.answer();
    await run.catch(() => undefined);

    expect(errorsSaying('took money')).toEqual([]);
    expect(errorsSaying('was NOT reversed')).toEqual([]);
    expect(errorsSaying('outcome unconfirmed: check Stripe')).toEqual([
      [
        expect.stringContaining(
          'outcome unconfirmed: check Stripe. If a reversal of this transfer exists, the payee is owed it back; if not, reconcile the slice and do not re-pay'
        ),
        expect.objectContaining({
          stripeTransferId: transferId,
          creatorUserId: payeeId,
          unconfirmed: true,
          code: 'ECONNRESET',
        }),
      ],
    ]);
    // For support to check Stripe again (§7.1 site 3b).
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'unverified',
        stripeTransferId: transferId,
        alertErrorId: idOf(errorsSaying('outcome unconfirmed: check Stripe')),
      }),
    ]);
  });

  it('a cancelled slice with no transfer, under a step settled after the cancel: "took money", and the cancelled-slice query finds it', async () => {
    const charge = newCharge();
    const pending = await slice(charge, 765, 'pending', payeeId);
    const refund = fullRefund();
    const list = lateTransfer(pending, null);
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    // The slice is cancelled; the lookup waits on Stripe. Another path
    // settles the step meanwhile.
    await list.reached;
    await settleByHand(refund.id);
    list.answer();
    await run;

    expect(errorsSaying('do not re-pay')).toEqual([]);
    expect(errorsSaying('took money')).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          creatorUserId: payeeId,
          amountCents: 765,
          cancelledSlice: true,
          stripeReversalId: null,
        }),
      ],
    ]);
    // refund-reversal-record.md §4 step 7: the cancelled-slice case.
    const found = await db
      .select({ id: payoutReversals.id })
      .from(payoutReversals)
      .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
      .where(
        and(
          eq(payoutReversals.causeId, refund.id),
          eq(payoutReversals.kind, 'cancellation'),
          eq(payoutReversals.status, 'cancelled'),
          sql`${payouts.status} = CASE ${payoutReversals.causeType} WHEN 'refund' THEN 'cancelled_by_refund' ELSE 'cancelled_by_dispute' END`
        )
      );
    expect(found).toHaveLength(1);
    // Owed what the drain would have paid (§7.1 site 5, §7.3).
    expect(await creditsOf(found[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'slice_cancelled',
        amountCents: 765,
        stripeReversalId: null,
        settledAs: 'cancelled',
        alertErrorId: idOf(errorsSaying('took money')),
      }),
    ]);
  });

  // ── what the warnings carry ─────────────────────────────────────────

  it('a lost answer with nothing at Stripe, under a settled step: warned as UNCONFIRMED, with the Stripe error; no alert', async () => {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = fullRefund();
    const hold = holdReversal('timeout');
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await hold.reached;
    await settleByHand(refund.id);
    hold.answer();
    await run.catch(() => undefined);

    expect(obs.error).not.toHaveBeenCalled();
    expect(warningsSaying('unconfirmed')).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          errorId: expect.any(String),
          code: 'ECONNRESET',
          error: 'socket hang up',
          status: 'cancelled',
        }),
      ],
    ]);
    // Queued for "Check Stripe again" (owner decision OQ3; §7.1 site 4).
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'unverified',
        amountCents: null,
        settledAs: 'cancelled',
        alertErrorId: idOf(warningsSaying('unconfirmed')),
      }),
    ]);
  });

  it('a landed reversal on a step another delivery has claimed since: warned with the reversal id, left to that delivery', async () => {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = fullRefund();
    const hold = holdReversal('lands');
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await hold.reached;
    // Another delivery's claim replaces the lease.
    await db
      .update(payoutReversals)
      .set({ attemptedAt: new Date(Date.now() + 1000) })
      .where(eq(payoutReversals.causeId, refund.id));
    hold.answer();
    await run;

    expect(obs.error).not.toHaveBeenCalled();
    expect(warningsSaying('another delivery took this step over')).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          status: 'pending',
          stripeReversalId: hold.made[0]?.id,
        }),
      ],
    ]);
    // That delivery finishes it: nothing for support.
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([]);
  });

  // ── the queue for support (Codex-2hxff.73; data design §7.1) ────────

  it('a reversal whose answer was lost under a settled step, when Stripe cannot then be asked: alerted, and queued for support to check (§7.1 site 2)', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const refund = fullRefund();
    const hold = holdReversal('timeout');
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await hold.reached;
    await settleByHand(refund.id);
    vi.mocked(stripe.transfers.listReversals).mockRejectedValueOnce(
      new Error('Stripe is down')
    );
    hold.answer();
    await run.catch(() => undefined);

    const asked = errorsSaying('could not be asked whether it landed');
    expect(await creditsOf((await stepsOf(refund.id))[0]?.id)).toEqual([
      expect.objectContaining({
        effect: 'unverified',
        amountCents: null,
        stripeTransferId: creator.stripeTransferId,
        settledAs: 'cancelled',
        alertErrorId: idOf(asked),
      }),
    ]);
  });

  it("the credit is what Stripe took (the reversal's amount), never the step's amount (Q9)", async () => {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = fullRefund();
    let reach: () => void = () => undefined;
    let answer: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce((async (
      transferId: string,
      params: { metadata?: Record<string, string> }
    ) => {
      reach();
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return {
        id: `trr_partial_${uid()}`,
        object: 'transfer_reversal',
        transfer: transferId,
        amount: 700,
        metadata: params.metadata ?? {},
      };
    }) as never);
    const run = reverseCharge(deps, {
      charge,
      source: SOURCE,
      refunds: [refund],
    });
    await reached;
    await settleByHand(refund.id);
    answer();
    await run;

    const [step] = await stepsOf(refund.id);
    expect(step?.amountCents).toBe(765);
    expect(await creditsOf(step?.id)).toEqual([
      expect.objectContaining({ effect: 'reversal_landed', amountCents: 700 }),
    ]);
  });

  it('a credit that cannot be written never throws: the failure is logged under the alert’s own errorId', async () => {
    const charge = newCharge();
    await slice(charge, 765);
    const refund = fullRefund();
    const fault = faultyDb({ insert: [1] });
    const hold = holdReversal('lands');
    const run = reverseCharge(
      { ...deps, db: fault.db },
      { charge, source: SOURCE, refunds: [refund] }
    );
    await hold.reached;
    await settleByHand(refund.id);
    fault.arm();
    hold.answer();

    await expect(run).resolves.toBeUndefined();
    const errorId = idOf(errorsSaying('took money'));
    expect(errorsSaying('could not be queued for support')).toEqual([
      [expect.any(String), expect.objectContaining({ errorId })],
    ]);
    const [step] = await stepsOf(refund.id);
    expect(await creditsOf(step?.id)).toEqual([]);
    // The landing is still recorded on the step.
    expect(step?.stripeReversalId).toBe(hold.made[0]?.id);
  });

  it('a later confirmed finding upgrades an open unverified credit; nothing changes a confirmed or settled one', async () => {
    const charge = newCharge();
    const creator = await slice(charge, 765);
    const [step] = await db
      .insert(payoutReversals)
      .values({
        payoutId: creator.id,
        causeType: 'refund',
        causeId: `re_late_${uid()}`,
        amountCents: 765,
        kind: 'transfer_reversal',
        status: 'cancelled',
      })
      .returning();
    const finding = {
      payoutReversalId: step?.id ?? '',
      payout: creator,
      settledAs: 'cancelled' as const,
    };
    const [first, second, confirmed, later] = [1, 2, 3, 4].map(() =>
      crypto.randomUUID()
    );
    await recordPayeeCredit(db, {
      ...finding,
      effect: 'unverified',
      amountCents: null,
      stripeTransferId: creator.stripeTransferId,
      alertErrorId: first ?? '',
    });
    // A second unverified finding changes nothing.
    await recordPayeeCredit(db, {
      ...finding,
      effect: 'unverified',
      amountCents: null,
      alertErrorId: second ?? '',
    });
    expect(await creditsOf(step?.id)).toEqual([
      expect.objectContaining({ effect: 'unverified', alertErrorId: first }),
    ]);

    await recordPayeeCredit(db, {
      ...finding,
      effect: 'reversal_landed',
      amountCents: 700,
      stripeReversalId: 'trr_upgrade',
      alertErrorId: confirmed ?? '',
    });
    const [upgraded] = await creditsOf(step?.id);
    expect(upgraded).toMatchObject({
      effect: 'reversal_landed',
      amountCents: 700,
      stripeReversalId: 'trr_upgrade',
      // Kept from the first finding: the new one named no transfer.
      stripeTransferId: creator.stripeTransferId,
      alertErrorId: confirmed,
      resolution: null,
    });

    // Confirmed: a later finding never rewrites it.
    await recordPayeeCredit(db, {
      ...finding,
      effect: 'slice_cancelled',
      amountCents: 765,
      alertErrorId: later ?? '',
    });
    expect(await creditsOf(step?.id)).toEqual([upgraded]);
  });
});
