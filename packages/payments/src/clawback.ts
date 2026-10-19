/**
 * The clawback engine: claw back each refund's share of a charge's payout
 * slices (the `clawback` module in docs/payments/architecture.md §4.3;
 * design in docs/payments/refund-reversal-record.md; Codex-2hxff.56, .8).
 *
 * Stripe does NOT reverse a separate `transfers.create` when the charge it was
 * funded from is refunded, so without this the platform pays the whole refund
 * while creators and organisations keep their slices.
 *
 * What each refund did to each slice is recorded in `payout_reversals`, one
 * row per (slice, refund). That row, not `payouts.status`, says whether a
 * refund is handled, so a second partial refund of a charge is clawed back
 * too, and a failed step is retried rather than marked done. The `payouts`
 * row is never rewritten: its amount stays the slice's gross.
 *
 * Pinned by refund-reversal.characterisation.test.ts (@codex/purchase) and
 * subscription-refund-reversal.characterisation.test.ts (@codex/subscription).
 */

import { stripeEnvMetadata } from '@codex/constants';
import {
  type Payout,
  type PayoutReversal,
  type PayoutReversalKind,
  payoutReversals,
  payouts,
  refundReviews,
} from '@codex/database/schema';
import {
  InternalServiceError,
  ServiceUnavailableError,
} from '@codex/service-errors';
import { and, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  cancelUnpaidPayoutForRefund,
  type LedgerDeps,
  PAYOUT_ATTEMPT_LEASE_MINUTES,
} from './payout-ledger';

interface ClawbackLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
}

/** The ledger's deps, with a logger that can also warn and inform. */
export interface ClawbackDeps extends LedgerDeps {
  obs: ClawbackLogger;
}

/** The refunded charge. Its amount is every source's denominator (D1). */
export interface ClawbackCharge {
  id: string;
  amountCents: number;
}

/**
 * A refund that has SUCCEEDED at Stripe. One still pending is clawed back once
 * `refund.updated` reports it succeeded (owner decision Q1, 2026-10-19).
 */
export interface ClawbackRefund {
  id: string;
  amountCents: number;
  /** Stripe's `created`, which orders a charge's refunds. */
  createdAt: number;
}

/** Whose slices of the charge are clawed back. */
export type ClawbackSource =
  | { sourceType: 'purchase'; purchaseId: string }
  | { sourceType: 'subscription' };

/**
 * The charge's succeeded refunds, oldest first. Read from Stripe, not the
 * event: `charge.amount_refunded` is cumulative, and `charge.refunds` is no
 * longer sent (API 2022-11-15), so an event cannot say which refund is new.
 */
export async function listSucceededRefunds(
  stripe: Stripe,
  chargeId: string
): Promise<ClawbackRefund[]> {
  const refunds: ClawbackRefund[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.refunds.list({
      charge: chargeId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const refund of page.data) {
      if (refund.status === 'succeeded' && refund.amount > 0) {
        refunds.push({
          id: refund.id,
          amountCents: refund.amount,
          createdAt: refund.created,
        });
      }
    }
    const last = page.data.at(-1);
    if (!page.has_more || !last) break;
    startingAfter = last.id;
  }
  return refunds.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
}

/**
 * A refund's share of a slice: the slice's fraction of everything refunded so
 * far, floored, less what the earlier refunds took. The shares of a charge
 * refunded in full add up to the slice's gross exactly, so no rounding penny
 * is left with a payee; a partial refund's rounding stays with the platform.
 */
export function refundShare(
  grossCents: number,
  chargeCents: number,
  refundedBeforeCents: number,
  refundedAfterCents: number
): number {
  const cap = (cents: number) => Math.min(cents, chargeCents);
  const before = Math.floor(
    (grossCents * cap(refundedBeforeCents)) / chargeCents
  );
  const after = Math.floor(
    (grossCents * cap(refundedAfterCents)) / chargeCents
  );
  return after - before;
}

/**
 * Which rows are the source's. A purchase's rows by its id, which covers the
 * rows recorded before charge ids were (D8); a subscription's by charge id. A
 * one-time purchase's rows on the same charge carry sourceType='purchase', so
 * running both sources on every refund never claws a slice back twice.
 */
function sourceScope(source: ClawbackSource, chargeId: string): SQL {
  const where =
    source.sourceType === 'purchase'
      ? eq(payouts.purchaseId, source.purchaseId)
      : and(
          eq(payouts.stripeChargeId, chargeId),
          eq(payouts.sourceType, 'subscription')
        );
  // `and()` is typed `SQL | undefined`, and an undefined where-clause selects
  // every payout row.
  if (!where)
    throw new InternalServiceError('Clawback row scope did not build');
  return where;
}

/** What a refund does to a slice in its current state; null if nothing is left. */
function kindFor(row: Payout, isFinal: boolean): PayoutReversalKind | null {
  if (row.status === 'paid') {
    return row.payoutType === 'platform_fee'
      ? 'retained_fee'
      : 'transfer_reversal';
  }
  if (row.status === 'pending' || row.status === 'failed') {
    return isFinal ? 'cancellation' : 'pending_reduction';
  }
  // `reversed` or `cancelled_by_refund`: nothing left to claw back. That is
  // also what keeps a refund handled before payout_reversals existed from
  // being reversed again by a later refund of the charge.
  return null;
}

interface StepContext {
  deps: ClawbackDeps;
  charge: ClawbackCharge;
  refund: ClawbackRefund;
}

/** What a step left undone, for the caller's retry signal. */
type StepResult = { failure?: unknown };

/**
 * Claw back every succeeded refund's share of the source's slices of a charge.
 *
 * Idempotent: a step already `done` or `debt` is skipped, so a redelivery does
 * only what is left. A step another delivery is working on counts as not done.
 *
 * Rejects once every step has been tried if any is not done and a retry can
 * fix it: an `InternalServiceError` whose cause is the failure (an
 * `AggregateError` when several failed). The webhook judges it by that cause,
 * so an outage gets a 500 and Stripe redelivers; a step that could not run YET
 * is a `ServiceUnavailableError`, which is transient too. A step Stripe
 * refused is left `failed` without rejecting (see `reverseTransfer`); the
 * hourly retry takes it.
 */
export async function reverseCharge(
  deps: ClawbackDeps,
  input: {
    charge: ClawbackCharge;
    source: ClawbackSource;
    /**
     * The charge's succeeded refunds, or how to read them. A loader is only
     * called when the source has slices on the charge: every refund runs
     * both sources, and most charges belong to one.
     */
    refunds:
      | readonly ClawbackRefund[]
      | (() => Promise<readonly ClawbackRefund[]>);
  }
): Promise<void> {
  const { charge, source } = input;
  const listed = await deps.db
    .select({ id: payouts.id })
    .from(payouts)
    .where(sourceScope(source, charge.id));
  if (listed.length === 0) return;

  const refunds =
    typeof input.refunds === 'function' ? await input.refunds() : input.refunds;
  if (refunds.length === 0) return;
  if (!(charge.amountCents > 0)) {
    throw new InternalServiceError('Clawback needs the charge amount', {
      chargeId: charge.id,
    });
  }

  const failures: unknown[] = [];
  let refundedBefore = 0;
  for (const refund of refunds) {
    const refundedAfter = refundedBefore + refund.amountCents;
    const isFinal = refundedAfter >= charge.amountCents;
    for (const { id } of listed) {
      const result = await clawBackShare(
        { deps, charge, refund },
        id,
        refundedBefore,
        refundedAfter,
        isFinal
      );
      if (result.failure !== undefined) failures.push(result.failure);
    }
    refundedBefore = refundedAfter;
  }

  if (failures.length > 0) {
    throw new InternalServiceError(
      'Refund clawback incomplete: a step must be retried',
      { failedSteps: failures.length },
      {
        cause:
          failures.length === 1 ? failures[0] : new AggregateError(failures),
      }
    );
  }
}

async function clawBackShare(
  ctx: StepContext,
  payoutId: string,
  refundedBefore: number,
  refundedAfter: number,
  isFinal: boolean
): Promise<StepResult> {
  const { deps, charge, refund } = ctx;
  // Read fresh: an earlier refund of this charge may have changed the row.
  const row = await readPayout(deps, payoutId);
  if (!row) return {};

  const share = refundShare(
    row.amountCents,
    charge.amountCents,
    refundedBefore,
    refundedAfter
  );
  if (share <= 0) {
    deps.obs.info('Refund share floored to zero, platform absorbs', {
      chargeId: charge.id,
      refundId: refund.id,
      payoutId: row.id,
      rowAmountCents: row.amountCents,
    });
    return {};
  }

  const record = await ensureRecord(deps, row, refund, share, isFinal);
  if (!record || record.status === 'done' || record.status === 'debt') {
    return {};
  }

  const claimed = await claimRecord(deps, record.id);
  if (!claimed) {
    // Another delivery is working on it. Not done yet, so ask for a retry.
    return {
      failure: new ServiceUnavailableError(
        'Another delivery is clawing back this refund',
        { payoutReversalId: record.id }
      ),
    };
  }

  try {
    return await runStep(ctx, row, claimed);
  } catch (error) {
    // A database or unexpected error: the attempt did not happen at Stripe,
    // or its outcome is unknown, so the key is kept for the retry.
    await markFailed(deps, claimed, errorCodeOf(error), false);
    logStepFailure(ctx, row, claimed, error);
    return { failure: error };
  }
}

async function runStep(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal
): Promise<StepResult> {
  const { deps } = ctx;
  switch (record.kind) {
    case 'retained_fee':
      await markDone(deps, record);
      await settleIfFullyReversed(deps, row.id);
      return {};

    case 'pending_reduction':
      return reduceUnpaidSlice(ctx, row, record);

    case 'cancellation':
      return cancelUnpaidSlice(ctx, row, record);

    case 'transfer_reversal': {
      const transferId = row.stripeTransferId;
      if (!transferId) {
        throw new InternalServiceError(
          'A paid slice has no transfer to reverse',
          {
            payoutId: row.id,
          }
        );
      }
      return reverseTransfer(ctx, row, record, transferId, record.amountCents);
    }

    default:
      throw new InternalServiceError('Unknown payout reversal kind', {
        payoutReversalId: record.id,
      });
  }
}

/**
 * A partial refund of an unpaid slice reduces what the drain will pay. The
 * drain sums a row's reductions only after claiming it, so the reduction must
 * commit while no drain holds the row: the row lock taken here, under the
 * drain's own lease condition, orders the two.
 */
async function reduceUnpaidSlice(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal
): Promise<StepResult> {
  const { deps } = ctx;
  const now = new Date();
  const leaseStart = new Date(
    now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000
  );

  const reduced = await deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .update(payouts)
      .set({ updatedAt: now })
      .where(
        and(
          eq(payouts.id, row.id),
          inArray(payouts.status, ['pending', 'failed']),
          or(isNull(payouts.lastRetryAt), lt(payouts.lastRetryAt, leaseStart))
        )
      )
      .returning();
    if (!locked) return false;
    await tx
      .update(payoutReversals)
      .set(doneFields(now))
      .where(eq(payoutReversals.id, record.id));
    return true;
  });
  if (reduced) return {};

  // The row is paid, or a drain is paying it now.
  const current = await readPayout(deps, row.id);
  if (current?.status === 'paid' && current.stripeTransferId) {
    const asReversal = await setKind(deps, record, 'transfer_reversal');
    return reverseTransfer(
      ctx,
      current,
      asReversal,
      current.stripeTransferId,
      asReversal.amountCents
    );
  }
  if (current?.status === 'pending' || current?.status === 'failed') {
    await markFailed(deps, record, 'payout_in_flight', false);
    return {
      failure: new ServiceUnavailableError(
        'A payout for this refund is being paid; retry once it settles',
        { payoutId: row.id }
      ),
    };
  }
  // Reversed or cancelled meanwhile: nothing is left for this share.
  await markDone(deps, record);
  return {};
}

/**
 * The refund that completes a charge's refund cancels an unpaid slice, FIRST,
 * so nothing can pay it afterwards; a transfer Stripe made for it anyway is
 * reversed in full (`cancelUnpaidPayoutForRefund`, Codex-2hxff.11).
 */
async function cancelUnpaidSlice(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal
): Promise<StepResult> {
  const { deps } = ctx;
  const outcome = await cancelUnpaidPayoutForRefund(deps, row);

  if (outcome.kind === 'cancelled') {
    if (outcome.transferId === undefined) {
      await markDone(deps, record);
      return {};
    }
    return reverseTransfer(ctx, row, record, outcome.transferId, undefined);
  }

  // Changed since it was read. Paid: claw back this share of the transfer.
  const current = outcome.row;
  if (current?.status === 'paid' && current.stripeTransferId) {
    const asReversal = await setKind(deps, record, 'transfer_reversal');
    return reverseTransfer(
      ctx,
      current,
      asReversal,
      current.stripeTransferId,
      asReversal.amountCents
    );
  }
  await markDone(deps, record);
  return {};
}

/**
 * Reverse a transfer for a refund. `amountCents` undefined reverses what is
 * left of it: a transfer that went out for a cancelled slice.
 *
 * The key carries the attempt: Stripe replays a stored error for a key for
 * 24h, so after a definitive error the next attempt needs a new key; after an
 * indeterminate one it keeps the key, which is what stops a double reversal.
 */
async function reverseTransfer(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal,
  transferId: string,
  amountCents: number | undefined
): Promise<StepResult> {
  const { deps, charge, refund } = ctx;
  let reversal: Stripe.TransferReversal;
  try {
    reversal = await deps.stripe.transfers.createReversal(
      transferId,
      {
        ...(amountCents === undefined ? {} : { amount: amountCents }),
        metadata: {
          ...sourceMetadata(row),
          charge_id: charge.id,
          refund_id: refund.id,
          payout_id: row.id,
          payout_reversal_id: record.id,
          type: 'refund_reversal',
          ...stripeEnvMetadata(deps.environment),
        },
      },
      {
        idempotencyKey: `${transferId}_reversal_${refund.id}_${record.attempt}`,
      }
    );
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === 'insufficient_funds' || code === 'balance_insufficient') {
      await recordDebt(ctx, row, record, error);
      return {};
    }
    const definitive = isDefinitiveStripeError(error);
    await markFailed(deps, record, code, definitive);
    logStepFailure(ctx, row, record, error);
    // Stripe refused. A redelivery would get the same answer, and rejecting
    // would end the webhook before the customer's refund email, so the step is
    // left `failed` for the hourly retry, which uses the next attempt's key.
    return definitive ? {} : { failure: error };
  }

  await markDone(deps, record, reversal.id);
  if (record.kind === 'cancellation') {
    // A cancelled slice whose transfer went out anyway: the money moved and
    // is now back, so the row is reversed, with its transfer recorded.
    await deps.db
      .update(payouts)
      .set({
        status: 'reversed',
        stripeTransferId: transferId,
        resolvedAt: row.resolvedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payouts.id, row.id));
  } else {
    await settleIfFullyReversed(deps, row.id);
  }
  return {};
}

/**
 * The payee's balance could not cover the reversal. The slice stays paid (its
 * transfer did succeed) and the debt is recorded once per reversal, for every
 * source (D5). It is recovered from future earnings (Codex-2hxff.30).
 */
async function recordDebt(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal,
  error: unknown
): Promise<void> {
  const { deps, charge, refund } = ctx;
  const code = errorCodeOf(error);
  const message = error instanceof Error ? error.message : null;
  if (row.userId) {
    // First, so that a crash before the status write retries into the same
    // debt: Stripe replays the stored error for this key, and the insert
    // collapses on the reversal's unique index.
    await deps.db
      .insert(refundReviews)
      .values({
        payoutReversalId: record.id,
        payoutId: row.id,
        purchaseId: row.purchaseId,
        creatorUserId: row.userId,
        attemptedReversalCents: record.amountCents,
        errorCode: code,
        errorMessage: message,
      })
      .onConflictDoNothing({
        target: refundReviews.payoutReversalId,
        where: sql`${refundReviews.payoutReversalId} IS NOT NULL`,
      });
  } else {
    deps.obs.error('A clawback debt has no payee to record it against', {
      errorId: crypto.randomUUID(),
      chargeId: charge.id,
      refundId: refund.id,
      payoutId: row.id,
      payoutReversalId: record.id,
      amountCents: record.amountCents,
    });
  }
  await deps.db
    .update(payoutReversals)
    .set({
      status: 'debt',
      lastErrorCode: code,
      attemptedAt: null,
      resolvedAt: new Date(),
    })
    .where(eq(payoutReversals.id, record.id));
  deps.obs.warn(
    'Refund clawback debt recorded: the payee balance could not cover it',
    {
      chargeId: charge.id,
      refundId: refund.id,
      payoutId: row.id,
      payoutReversalId: record.id,
      creatorUserId: row.userId,
      amountCents: record.amountCents,
      code,
    }
  );
}

/** Attempts after which a failed step is left for a person, not retried. */
export const MAX_CLAWBACK_ATTEMPTS = 5;

/**
 * Retry the clawback of every charge with a step left `failed` (the hourly
 * cron, after Stripe's redeliveries). A step Stripe refused does not make the
 * webhook retry, so this is its only retry; it runs with the next attempt's
 * key. The charge and its succeeded refunds are read fresh from Stripe.
 *
 * Each charge is isolated: one that fails again is logged and the rest run.
 * An outage keeps a step's attempt (its key), so it is retried every run until
 * it succeeds; only Stripe refusing it uses up attempts.
 */
export async function retryFailedClawbacks(
  deps: ClawbackDeps,
  options: { olderThanMinutes?: number; limit?: number } = {}
): Promise<{ charges: number; retried: number; stillFailing: number }> {
  const { olderThanMinutes = 15, limit = 50 } = options;
  const before = new Date(Date.now() - olderThanMinutes * 60_000);
  const targets = await deps.db
    .select({
      chargeId: payouts.stripeChargeId,
      sourceType: payouts.sourceType,
      purchaseId: payouts.purchaseId,
    })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payoutReversals.payoutId, payouts.id))
    .where(
      and(
        eq(payoutReversals.status, 'failed'),
        eq(payoutReversals.causeType, 'refund'),
        lt(payoutReversals.attempt, MAX_CLAWBACK_ATTEMPTS),
        lt(payoutReversals.updatedAt, before)
      )
    )
    .groupBy(payouts.stripeChargeId, payouts.sourceType, payouts.purchaseId)
    // Oldest failure first. A step that fails again is touched, so it goes to
    // the back and steps past the limit get their turn.
    .orderBy(sql`min(${payoutReversals.updatedAt}) asc`)
    .limit(limit);

  let retried = 0;
  let stillFailing = 0;
  for (const target of targets) {
    if (!target.chargeId) {
      stillFailing++;
      deps.obs.error('A failed clawback step has no charge id to retry by', {
        errorId: crypto.randomUUID(),
        purchaseId: target.purchaseId,
      });
      continue;
    }
    try {
      const charge = await deps.stripe.charges.retrieve(target.chargeId);
      const source: ClawbackSource =
        target.sourceType === 'purchase' && target.purchaseId
          ? { sourceType: 'purchase', purchaseId: target.purchaseId }
          : { sourceType: 'subscription' };
      await reverseCharge(deps, {
        charge: { id: charge.id, amountCents: charge.amount },
        source,
        refunds: () => listSucceededRefunds(deps.stripe, charge.id),
      });
      retried++;
    } catch (error) {
      stillFailing++;
      deps.obs.error(
        'Retrying a failed clawback failed; the next run tries again',
        {
          errorId: crypto.randomUUID(),
          chargeId: target.chargeId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
  return { charges: targets.length, retried, stillFailing };
}

/**
 * What partial refunds took off each unpaid slice, by payout id. The drain pays
 * `amountCents` less this. It must read it AFTER claiming the rows: a
 * reduction commits only while no drain holds the row (`reduceUnpaidSlice`),
 * so once claimed, the total cannot change under the transfer.
 */
export async function pendingReductionsFor(
  db: LedgerDeps['db'],
  payoutIds: readonly string[]
): Promise<Map<string, number>> {
  if (payoutIds.length === 0) return new Map();
  const sums = await db
    .select({
      payoutId: payoutReversals.payoutId,
      cents: sql<number>`COALESCE(SUM(${payoutReversals.amountCents}), 0)::int`,
    })
    .from(payoutReversals)
    .where(
      and(
        inArray(payoutReversals.payoutId, [...payoutIds]),
        eq(payoutReversals.kind, 'pending_reduction'),
        eq(payoutReversals.status, 'done')
      )
    )
    .groupBy(payoutReversals.payoutId);
  return new Map(sums.map((row) => [row.payoutId, row.cents]));
}

/** Mark a paid slice `reversed` once its reversals add up to its gross. */
async function settleIfFullyReversed(
  deps: ClawbackDeps,
  payoutId: string
): Promise<void> {
  const [done] = await deps.db
    .select({
      cents: sql<number>`COALESCE(SUM(${payoutReversals.amountCents}), 0)::int`,
    })
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, payoutId),
        eq(payoutReversals.status, 'done')
      )
    );
  // A parameter, not NOW(): Hyperdrive caches by the query's text.
  const now = new Date();
  await deps.db
    .update(payouts)
    .set({
      status: 'reversed',
      resolvedAt: sql`COALESCE(${payouts.resolvedAt}, ${now})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(payouts.id, payoutId),
        eq(payouts.status, 'paid'),
        sql`${payouts.amountCents} <= ${done?.cents ?? 0}`
      )
    );
}

async function readPayout(
  deps: ClawbackDeps,
  payoutId: string
): Promise<Payout | undefined> {
  const [row] = await deps.db
    .select()
    .from(payouts)
    .where(eq(payouts.id, payoutId))
    .limit(1);
  return row;
}

/** The step's record: inserted once, then read back (a redelivery finds it). */
async function ensureRecord(
  deps: ClawbackDeps,
  row: Payout,
  refund: ClawbackRefund,
  share: number,
  isFinal: boolean
): Promise<PayoutReversal | undefined> {
  const kind = kindFor(row, isFinal);
  if (kind) {
    await deps.db
      .insert(payoutReversals)
      .values({
        payoutId: row.id,
        causeType: 'refund',
        causeId: refund.id,
        amountCents: share,
        kind,
        status: 'pending',
      })
      .onConflictDoNothing({
        target: [
          payoutReversals.payoutId,
          payoutReversals.causeType,
          payoutReversals.causeId,
        ],
      });
  }
  const [record] = await deps.db
    .select()
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, row.id),
        eq(payoutReversals.causeType, 'refund'),
        eq(payoutReversals.causeId, refund.id)
      )
    )
    .limit(1);
  return record;
}

/** Take the step's lease, so one delivery works on it at a time. */
async function claimRecord(
  deps: ClawbackDeps,
  recordId: string
): Promise<PayoutReversal | undefined> {
  const now = new Date();
  const leaseStart = new Date(
    now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000
  );
  const [claimed] = await deps.db
    .update(payoutReversals)
    .set({ attemptedAt: now })
    .where(
      and(
        eq(payoutReversals.id, recordId),
        inArray(payoutReversals.status, ['pending', 'failed']),
        or(
          isNull(payoutReversals.attemptedAt),
          lt(payoutReversals.attemptedAt, leaseStart)
        )
      )
    )
    .returning();
  return claimed;
}

function doneFields(now: Date) {
  return {
    status: 'done' as const,
    lastErrorCode: null,
    attemptedAt: null,
    resolvedAt: now,
  };
}

async function markDone(
  deps: ClawbackDeps,
  record: PayoutReversal,
  stripeReversalId?: string
): Promise<void> {
  await deps.db
    .update(payoutReversals)
    .set({
      ...doneFields(new Date()),
      ...(stripeReversalId ? { stripeReversalId } : {}),
    })
    .where(eq(payoutReversals.id, record.id));
}

/** Failed, and the lease released. `advance` moves the key to a new attempt. */
async function markFailed(
  deps: ClawbackDeps,
  record: PayoutReversal,
  code: string,
  advance: boolean
): Promise<void> {
  await deps.db
    .update(payoutReversals)
    .set({
      status: 'failed',
      lastErrorCode: code,
      attemptedAt: null,
      ...(advance ? { attempt: sql`${payoutReversals.attempt} + 1` } : {}),
    })
    .where(eq(payoutReversals.id, record.id));
}

async function setKind(
  deps: ClawbackDeps,
  record: PayoutReversal,
  kind: PayoutReversalKind
): Promise<PayoutReversal> {
  await deps.db
    .update(payoutReversals)
    .set({ kind })
    .where(eq(payoutReversals.id, record.id));
  return { ...record, kind };
}

/**
 * Stripe answered and refused: a 4xx other than a conflict (409, a concurrent
 * request with the same key) or a rate limit (429). Stripe stores that answer
 * for the key, so only a new key can succeed.
 */
function isDefinitiveStripeError(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 409 &&
    status !== 429
  );
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.length > 0
    ? code.slice(0, 64)
    : 'unknown';
}

function sourceMetadata(row: Payout): Record<string, string> {
  return {
    source_type: row.sourceType,
    ...(row.purchaseId ? { purchase_id: row.purchaseId } : {}),
    ...(row.subscriptionId ? { subscription_id: row.subscriptionId } : {}),
    ...(row.courseSubscriptionId
      ? { course_subscription_id: row.courseSubscriptionId }
      : {}),
  };
}

function logStepFailure(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal,
  error: unknown
): void {
  ctx.deps.obs.error('Refund clawback step failed', {
    errorId: crypto.randomUUID(),
    chargeId: ctx.charge.id,
    refundId: ctx.refund.id,
    payoutId: row.id,
    payoutReversalId: record.id,
    kind: record.kind,
    attempt: record.attempt,
    // After this many, the hourly retry leaves the step for a person.
    maxAttempts: MAX_CLAWBACK_ATTEMPTS,
    code: errorCodeOf(error),
    error: error instanceof Error ? error.message : String(error),
  });
}
