/**
 * The clawback engine: claw back each refund's and each chargeback's share of
 * a charge's payout slices (the `clawback` module in
 * docs/payments/architecture.md §4.3; designs in
 * docs/payments/refund-reversal-record.md and dispute-record.md;
 * Codex-2hxff.56, .8, .9).
 *
 * Stripe does NOT reverse a separate `transfers.create` when the charge it was
 * funded from is refunded or charged back, so without this the platform pays
 * the whole refund or chargeback while creators and organisations keep their
 * slices.
 *
 * What each cause did to each slice is recorded in `payout_reversals`, one
 * row per (slice, cause). That row, not `payouts.status`, says whether a
 * cause is handled, so a second partial refund of a charge is clawed back
 * too, and a failed step is retried rather than marked done. The `payouts`
 * row is never rewritten: its amount stays the slice's gross.
 *
 * The spec is __tests__/clawback.integration.test.ts.
 */

import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  stripeEnvMetadata,
} from '@codex/constants';
import {
  disputes,
  type Payout,
  type PayoutReversal,
  type PayoutReversalKind,
  payoutReversals,
  payouts,
  refundReviews,
  refunds,
} from '@codex/database/schema';
import {
  AfterCommitError,
  InternalServiceError,
  ServiceUnavailableError,
} from '@codex/service-errors';
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type Stripe from 'stripe';
import {
  cancelUnpaidPayout,
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

type Tx = Parameters<Parameters<ClawbackDeps['db']['transaction']>[0]>[0];
/** The database, or a transaction on it. */
type Client = ClawbackDeps['db'] | Tx;

/**
 * The code of a debt step for a person: a cause's share of a slice a won
 * dispute paid back, which no unpaid re-pay row could carry.
 */
const SLICE_REPAID = 'slice_repaid';

/**
 * The code of a `cancelled` step whose share moved off its slice to the
 * slice's re-pay rows (`belongsOnRepayRows`, `splitRepaidShare`).
 */
const MOVED_TO_REPAY = 'moved_to_repay';

/** The refunded charge. Its amount is every source's denominator (D1). */
export interface ClawbackCharge {
  id: string;
  amountCents: number;
}

/**
 * A refund the clawback acts on: one that has SUCCEEDED or FAILED at Stripe.
 *
 * - One still pending is clawed back once `refund.updated` reports it settled
 *   (owner decision Q1, 2026-10-19).
 * - A failed refund is clawed back too. Stripe returns its money to the
 *   platform, but the customer must still be refunded some other way, so the
 *   clawback stands and support settles the failure (`refunds`; owner
 *   decision 2026-10-19, "Hold it for support").
 * - A canceled refund paid nothing out and is never clawed back.
 */
export interface ClawbackRefund {
  id: string;
  amountCents: number;
  /** Stripe's `created`, which orders a charge's refunds. */
  createdAt: number;
}

/**
 * A chargeback the clawback acts on (`disputes`, Codex-2hxff.9): one that took
 * money, still open or lost. A won one is paid back instead (`repayDispute`);
 * an inquiry takes no money and only holds the drain.
 */
export interface ClawbackDispute {
  id: string;
  amountCents: number;
  /** Stripe's `created`, in seconds like a refund's. */
  createdAt: number;
  /**
   * While open, an unpaid slice is only held (the drain skips it). Lost, it
   * takes the dispute's share like a refund: reduced, or cancelled
   * (`cancelled_by_dispute`).
   */
  lost: boolean;
}

/** What a `payout_reversals` row is caused by. */
type ClawbackCause =
  | ({ type: 'refund' } & ClawbackRefund)
  | ({ type: 'dispute' } & ClawbackDispute);

/** A chargeback took money: open, or lost. A won one is paid back instead. */
const CHARGEBACK_CLAWED_STATUSES = [
  ...DISPUTE_CHARGEBACK_OPEN_STATUSES,
  'lost',
];

/**
 * The charge's chargebacks to claw back, oldest first: open or lost. Read from
 * `disputes`, which the dispute webhook keeps.
 */
async function chargebacksFor(
  db: LedgerDeps['db'],
  chargeId: string
): Promise<ClawbackDispute[]> {
  const rows = await db
    .select({
      id: disputes.stripeDisputeId,
      amountCents: disputes.amountCents,
      createdAt: disputes.stripeCreatedAt,
      status: disputes.status,
    })
    .from(disputes)
    .where(
      and(
        eq(disputes.stripeChargeId, chargeId),
        inArray(disputes.status, CHARGEBACK_CLAWED_STATUSES)
      )
    )
    .orderBy(asc(disputes.stripeCreatedAt), asc(disputes.stripeDisputeId));
  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amountCents,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    lost: row.status === 'lost',
  }));
}

/** Whose slices of the charge are clawed back. */
export type ClawbackSource =
  | { sourceType: 'purchase'; purchaseId: string }
  | { sourceType: 'subscription' };

/**
 * Every refund of a charge, whatever its status, as Stripe lists it (every
 * page). Read from Stripe, not the event: `charge.amount_refunded` is
 * cumulative, and `charge.refunds` is no longer sent (API 2022-11-15), so an
 * event cannot say which refund is new.
 */
export async function listChargeRefunds(
  stripe: Stripe,
  chargeId: string
): Promise<Stripe.Refund[]> {
  const refunds: Stripe.Refund[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.refunds.list({
      charge: chargeId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    refunds.push(...page.data);
    const last = page.data.at(-1);
    if (!page.has_more || !last) break;
    startingAfter = last.id;
  }
  return refunds;
}

/**
 * The charge's refunds to claw back (succeeded or failed), oldest first.
 *
 * A failed refund stays in the list, so a refund that fails after its
 * clawback began keeps its place in the order: the shares of the refunds after
 * it do not move, and a step of its clawback still to be retried is retried.
 */
export async function listClawableRefunds(
  stripe: Stripe,
  chargeId: string
): Promise<ClawbackRefund[]> {
  return (await listChargeRefunds(stripe, chargeId))
    .filter((refund) => isClawable(refund.status) && refund.amount > 0)
    .map((refund) => ({
      id: refund.id,
      amountCents: refund.amount,
      createdAt: refund.created,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Settled at Stripe, whichever way: see `ClawbackRefund`. */
function isClawable(status: string | null): boolean {
  return status === 'succeeded' || status === 'failed';
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
 * running both sources on every refund never claws a slice back twice. A
 * re-pay row is never one of them.
 */
function sourceScope(source: ClawbackSource, chargeId: string): SQL {
  const where = and(
    source.sourceType === 'purchase'
      ? eq(payouts.purchaseId, source.purchaseId)
      : and(
          eq(payouts.stripeChargeId, chargeId),
          eq(payouts.sourceType, 'subscription')
        ),
    // A re-pay row (a won dispute, paid back) is not a slice of the charge.
    sql`NOT EXISTS (SELECT 1 FROM ${payoutReversals} WHERE ${payoutReversals.repaidByPayoutId} = ${payouts.id})`
  );
  // `and()` is typed `SQL | undefined`, and an undefined where-clause selects
  // every payout row.
  if (!where)
    throw new InternalServiceError('Clawback row scope did not build');
  return where;
}

/**
 * What a cause does to a slice in its current state; null if nothing is left,
 * or nothing is to be done yet.
 */
function kindFor(
  row: Payout,
  isFinal: boolean,
  cause: ClawbackCause
): PayoutReversalKind | null {
  if (row.status === 'paid') {
    return row.payoutType === 'platform_fee'
      ? 'retained_fee'
      : 'transfer_reversal';
  }
  if (row.status === 'pending' || row.status === 'failed') {
    // An open chargeback holds an unpaid slice rather than reducing it: the
    // drain skips it until the dispute closes (owner decision P-2).
    if (cause.type === 'dispute' && !cause.lost) return null;
    return isFinal ? 'cancellation' : 'pending_reduction';
  }
  // `reversed`, `cancelled_by_refund` or `cancelled_by_dispute`: nothing left
  // to claw back. That is also what keeps a refund handled before
  // payout_reversals existed from being reversed again by a later refund.
  return null;
}

interface StepContext {
  deps: ClawbackDeps;
  charge: ClawbackCharge;
  cause: ClawbackCause;
}

/** The cause's id under its own name, for logs. */
function causeFields(cause: ClawbackCause): Record<string, string> {
  return cause.type === 'refund'
    ? { refundId: cause.id }
    : { disputeId: cause.id };
}

/** "Refund" or "Dispute", for messages. */
function causeLabel(cause: ClawbackCause): string {
  return cause.type === 'refund' ? 'Refund' : 'Dispute';
}

/** What a step left undone, for the caller's retry signal. */
type StepResult = { failure?: unknown };

/**
 * Claw back every refund's and every chargeback's share of the source's slices
 * of a charge. Refunds come first, then chargebacks (read from `disputes`), on
 * one cumulative share: a dispute on a partly refunded charge takes only what
 * the refunds left.
 *
 * Idempotent: a step already `done`, `debt` or `cancelled` is skipped, so a
 * redelivery does only what is left. A step another delivery is working on
 * counts as not done.
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
     * The charge's refunds to claw back, or how to read them. A loader is only
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
  const chargebacks = await chargebacksFor(deps.db, charge.id);
  if (refunds.length === 0 && chargebacks.length === 0) return;
  if (!(charge.amountCents > 0)) {
    throw new InternalServiceError('Clawback needs the charge amount', {
      chargeId: charge.id,
    });
  }

  const causes: ClawbackCause[] = [
    ...refunds.map((refund) => ({ type: 'refund' as const, ...refund })),
    ...chargebacks.map((dispute) => ({ type: 'dispute' as const, ...dispute })),
  ];
  const failures: unknown[] = [];
  let takenBefore = 0;
  for (const cause of causes) {
    const takenAfter = takenBefore + cause.amountCents;
    const isFinal = takenAfter >= charge.amountCents;
    for (const { id } of listed) {
      const result = await clawBackShare(
        { deps, charge, cause },
        id,
        takenBefore,
        takenAfter,
        isFinal
      );
      if (result.failure !== undefined) failures.push(result.failure);
    }
    takenBefore = takenAfter;
  }

  if (failures.length > 0) {
    throw new InternalServiceError(
      'Clawback incomplete: a step must be retried',
      { failedSteps: failures.length },
      {
        cause:
          failures.length === 1 ? failures[0] : new AggregateError(failures),
      }
    );
  }
}

/**
 * Claw back the refunds and chargebacks a charge already had when the
 * source's slices of it were recorded (Codex-2hxff.67). The flow that records
 * them calls this right after, so a payment's payouts reflect every refund and
 * chargeback of it, whatever order Stripe's events arrive in.
 *
 * Stripe does not order them: `charge.refunded` (or a dispute) can be handled
 * before the event that records the slices (`invoice.payment_succeeded`, or a
 * purchase's completion), and its clawback then finds no slices and does
 * nothing. This runs that same clawback once they exist, so they end as they
 * would had the refund come second: a full refund nets the payees nothing, a
 * partial one the reduced amounts, an open chargeback holds an unpaid slice.
 * Each step is recorded per slice and cause, so a cause both runs handle is
 * clawed back once.
 *
 * One of the two always sees the other: the refund and dispute handlers record
 * their cause (`refunds`, `disputes`) before they read the slices, and this
 * reads both after the slices are committed. A charge with neither recorded
 * asks Stripe nothing.
 *
 * A failure is logged here, then rethrown: nothing else would retry it, as
 * the hourly retry revisits only steps already recorded and this can fail
 * before any is. A step that could not run YET (another delivery holds it, a
 * drain is paying the slice) is a warning: the retry finishes it. Anything
 * else is an error with an errorId, for a person if the event is not retried.
 */
export async function reverseEarlierRefunds(
  deps: ClawbackDeps,
  input: { chargeId: string; source: ClawbackSource }
): Promise<void> {
  try {
    if (!(await hasClawbackCause(deps.db, input.chargeId))) return;
    // As the refund webhook calls it: the charge's own amount is the
    // denominator (D1), and its refunds are read from Stripe.
    const charge = await deps.stripe.charges.retrieve(input.chargeId);
    await reverseCharge(deps, {
      charge: { id: charge.id, amountCents: charge.amount },
      source: input.source,
      refunds: () => listClawableRefunds(deps.stripe, charge.id),
    });
  } catch (error) {
    const fields = {
      chargeId: input.chargeId,
      sourceType: input.source.sourceType,
      ...(input.source.sourceType === 'purchase'
        ? { purchaseId: input.source.purchaseId }
        : {}),
      ...rootCauseOf(error),
    };
    if (isNotYet(error)) {
      deps.obs.warn(
        'A refund or chargeback preceded this payout and is not clawed back yet: another delivery or a drain holds a step, and the retry finishes it',
        fields
      );
    } else {
      deps.obs.error(
        'A refund or chargeback preceded this payout and its transfers were not reversed: a retried event runs this again; if the event is not retried, a person must reverse them',
        { errorId: crypto.randomUUID(), ...fields }
      );
    }
    throw error;
  }
}

/** How far down a cause chain to look (and the guard against a cycle). */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether every failure under `error` is a step that could not run YET
 * (`ServiceUnavailableError`, as `reverseCharge` reports one), so a retry
 * finishes it.
 */
function isNotYet(error: unknown, depth = 0): boolean {
  if (depth > MAX_CAUSE_DEPTH) return false;
  if (error instanceof ServiceUnavailableError) return true;
  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 &&
      error.errors.every((inner) => isNotYet(inner, depth + 1))
    );
  }
  return error instanceof Error && error.cause !== undefined
    ? isNotYet(error.cause, depth + 1)
    : false;
}

/**
 * The innermost error under `error`, for a log line: its name, its message
 * and the deepest string `code` on the way. Never a failed query's own
 * message, which holds the SQL and its bound values.
 */
function rootCauseOf(error: unknown): {
  errorName: string;
  errorMessage: string;
  code: string | undefined;
} {
  let current: unknown = error;
  let code: string | undefined;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) break;
    const own = (current as { code?: unknown }).code;
    if (typeof own === 'string') code = own;
    const inner =
      current instanceof AggregateError ? current.errors[0] : current.cause;
    if (!(inner instanceof Error)) break;
    current = inner;
  }
  if (!(current instanceof Error)) {
    return { errorName: typeof current, errorMessage: String(current), code };
  }
  return {
    errorName: current.name,
    errorMessage: current.message.startsWith('Failed query:')
      ? '(query omitted)'
      : current.message,
    code,
  };
}

/**
 * `reverseEarlierRefunds` for a flow whose payout has committed: its failure
 * must not cancel what follows from the commit. It is held, and the returned
 * `finish` raises it at the flow's end, with the flow's result
 * (`AfterCommitError`); without a failure, `finish` returns the result.
 */
export async function reverseEarlierRefundsAfterCommit(
  deps: ClawbackDeps,
  input: { chargeId: string; source: ClawbackSource }
): Promise<<T>(result: T) => T> {
  try {
    await reverseEarlierRefunds(deps, input);
    return (result) => result;
  } catch (failure) {
    return (result) => {
      throw new AfterCommitError(
        'The payout was recorded, but a refund or chargeback before it was not clawed back',
        result,
        failure
      );
    };
  }
}

/**
 * Whether the charge has a cause the clawback acts on, as the webhooks have
 * recorded them: a refund that is not canceled (final, never clawed back), or
 * a chargeback still open or lost.
 */
async function hasClawbackCause(
  db: LedgerDeps['db'],
  chargeId: string
): Promise<boolean> {
  const [refund] = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(eq(refunds.stripeChargeId, chargeId), ne(refunds.status, 'canceled'))
    )
    .limit(1);
  if (refund) return true;
  const [chargeback] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(
      and(
        eq(disputes.stripeChargeId, chargeId),
        inArray(disputes.status, CHARGEBACK_CLAWED_STATUSES)
      )
    )
    .limit(1);
  return chargeback !== undefined;
}

async function clawBackShare(
  ctx: StepContext,
  payoutId: string,
  refundedBefore: number,
  refundedAfter: number,
  isFinal: boolean
): Promise<StepResult> {
  const { deps, charge, cause } = ctx;
  // Read fresh: an earlier cause on this charge may have changed the row.
  const row = await readPayout(deps, payoutId);
  if (!row) return {};

  const share = refundShare(
    row.amountCents,
    charge.amountCents,
    refundedBefore,
    refundedAfter
  );
  if (share <= 0) {
    deps.obs.info(
      `${causeLabel(cause)} share floored to zero, platform absorbs`,
      {
        chargeId: charge.id,
        ...causeFields(cause),
        payoutId: row.id,
        rowAmountCents: row.amountCents,
      }
    );
    return {};
  }

  const existing = await findRecord(deps, row.id, cause);
  // A slice a won dispute paid back: the cause takes its share off the re-pay
  // row instead. A cause that reached the slice before its re-pay keeps its
  // own step. A `slice_repaid` debt, or a step moved off the slice
  // (`moved_to_repay`), is the re-paid path's too: a redelivery goes back that
  // way, to finish its steps on the re-pay rows.
  if (
    (!existing ||
      existing.lastErrorCode === SLICE_REPAID ||
      existing.lastErrorCode === MOVED_TO_REPAY) &&
    (await wasRepaid(deps, row.id))
  ) {
    return clawBackRepaidShare(ctx, row, share);
  }

  const record = existing ?? (await ensureRecord(ctx, row, share, isFinal));
  if (!record || isSettled(record)) return {};
  return runRecord(ctx, row, record);
}

/** A step with nothing left to do. */
function isSettled(record: PayoutReversal): boolean {
  return (
    record.status === 'done' ||
    record.status === 'debt' ||
    record.status === 'cancelled'
  );
}

/** Claim a step and run it: the tail every step shares. */
async function runRecord(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal
): Promise<StepResult> {
  const { deps, cause } = ctx;
  // A dispute's step is claimed only while the dispute is still clawed back
  // (open or lost): once it is won, its re-pay owns every step, and a step
  // this delivery read before the win must not reach Stripe after it.
  const guard =
    cause.type === 'dispute' ? disputeStillClawed(cause.id) : undefined;
  const claimed = await claimRecord(deps, record.id, guard);
  if (!claimed) {
    if (cause.type === 'dispute' && !(await isStillClawed(deps, cause.id))) {
      // A step never claimed is cancelled. One claimed before may have
      // reached Stripe: the won dispute's re-pay asks Stripe and settles it.
      await cancelUnclaimedStep(deps, record.id);
      return {};
    }
    // Another delivery is working on it. Not done yet, so ask for a retry.
    return {
      failure: new ServiceUnavailableError(
        `Another delivery is clawing back this ${cause.type}`,
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
          or(
            isNull(payouts.lastRetryAt),
            lt(payouts.lastRetryAt, leaseStart),
            // The lease of the reserve's own transfer, which failed: nothing
            // is in flight. A drain's claim counts its attempt, so a failed
            // row a drain is retrying still waits (Codex-2hxff.67).
            and(eq(payouts.status, 'failed'), eq(payouts.retryCount, 0))
          )
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
        `A payout for this ${ctx.cause.type} is being paid; retry once it settles`,
        { payoutId: row.id }
      ),
    };
  }
  // Reversed or cancelled meanwhile: nothing is left for this share.
  await markDone(deps, record);
  return {};
}

/**
 * The refund (or lost chargeback) that completes a charge's refund cancels an
 * unpaid slice, FIRST, so nothing can pay it afterwards; a transfer Stripe made
 * for it anyway is reversed in full (`cancelUnpaidPayout`, Codex-2hxff.11).
 */
async function cancelUnpaidSlice(
  ctx: StepContext,
  row: Payout,
  record: PayoutReversal
): Promise<StepResult> {
  const { deps, cause } = ctx;
  const outcome = await cancelUnpaidPayout(
    deps,
    row,
    cause.type === 'dispute' ? 'cancelled_by_dispute' : 'cancelled_by_refund'
  );

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
 * Reverse a transfer for a refund or a chargeback. `amountCents` undefined
 * reverses what is left of it: a transfer that went out for a cancelled slice.
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
  const { deps, charge, cause } = ctx;
  let reversal: Stripe.TransferReversal;
  try {
    reversal = await deps.stripe.transfers.createReversal(
      transferId,
      {
        ...(amountCents === undefined ? {} : { amount: amountCents }),
        metadata: {
          ...sourceMetadata(row),
          charge_id: charge.id,
          ...(cause.type === 'refund'
            ? { refund_id: cause.id, type: 'refund_reversal' }
            : { dispute_id: cause.id, type: 'dispute_reversal' }),
          payout_id: row.id,
          payout_reversal_id: record.id,
          ...stripeEnvMetadata(deps.environment),
        },
      },
      {
        idempotencyKey: `${transferId}_reversal_${cause.id}_${record.attempt}`,
      }
    );
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === 'insufficient_funds' || code === 'balance_insufficient') {
      await recordDebt(ctx, row, record, error);
      return {};
    }
    const definitive = isDefinitiveStripeError(error);
    if (definitive && (await belongsOnRepayRows(deps, row, record))) {
      const slice = await readPayout(deps, row.id);
      return slice
        ? clawBackRepaidShare(ctx, slice, record.amountCents, record)
        : {};
    }
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
 * Stripe refused a reversal of a slice that has since been reversed whole and
 * paid back by a won dispute (Codex-2hxff.59): the step was recorded while the
 * slice was still paid, and a chargeback's reversal took the rest of the
 * transfer first. It can never run on that transfer, and the share belongs on
 * the re-pay row, which would otherwise pay it out.
 *
 * Nothing of this step reached the payee's balance: the slice's own recorded
 * reversals cover its whole transfer, so Stripe holds none of this one. The
 * caller moves the share down the re-paid path, in the same transaction that
 * splits it (`splitRepaidShare`).
 */
async function belongsOnRepayRows(
  deps: ClawbackDeps,
  row: Payout,
  record: PayoutReversal
): Promise<boolean> {
  if (record.kind !== 'transfer_reversal') return false;
  const current = await readPayout(deps, row.id);
  return current?.status === 'reversed' && (await wasRepaid(deps, row.id));
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
  const { deps, charge, cause } = ctx;
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
      ...causeFields(cause),
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
    `${causeLabel(cause)} clawback debt recorded: the payee balance could not cover it`,
    {
      chargeId: charge.id,
      ...causeFields(cause),
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
 * key. The charge and its refunds are read fresh from Stripe, and its
 * chargebacks from `disputes`.
 *
 * Each charge is isolated: one that fails again is logged and the rest run.
 * An outage keeps a step's attempt (its key), so it is retried every run until
 * it succeeds; only Stripe refusing it uses up attempts.
 *
 * It never marks a lost dispute applied: steps that finished say nothing
 * about whether the LOST handling ran, since the ones a chargeback wrote when
 * it opened finish too. The dispute reconcile (Codex-2hxff.58) re-runs the
 * whole lost path and marks it only once that succeeds.
 */
export async function retryFailedClawbacks(
  deps: ClawbackDeps,
  options: { olderThanMinutes?: number; limit?: number } = {}
): Promise<{
  charges: number;
  retried: number;
  stillFailing: number;
}> {
  const { olderThanMinutes = 15, limit = 50 } = options;
  const before = new Date(Date.now() - olderThanMinutes * 60_000);
  // A step on a re-pay row (Codex-2hxff.59) is retried by its slice's
  // charge: the re-pay row has none of its own.
  const repaid = alias(payoutReversals, 'repaid_reversal');
  const repaidSlice = alias(payouts, 'repaid_slice');
  const chargeId = sql<
    string | null
  >`COALESCE(${payouts.stripeChargeId}, ${repaidSlice.stripeChargeId})`;
  const targets = await deps.db
    .select({
      chargeId,
      sourceType: payouts.sourceType,
      purchaseId: payouts.purchaseId,
    })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payoutReversals.payoutId, payouts.id))
    .leftJoin(repaid, eq(repaid.repaidByPayoutId, payouts.id))
    .leftJoin(repaidSlice, eq(repaidSlice.id, repaid.payoutId))
    .where(
      and(
        eq(payoutReversals.status, 'failed'),
        lt(payoutReversals.attempt, MAX_CLAWBACK_ATTEMPTS),
        lt(payoutReversals.updatedAt, before)
      )
    )
    .groupBy(chargeId, payouts.sourceType, payouts.purchaseId)
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
        refunds: () => listClawableRefunds(deps.stripe, charge.id),
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
export async function settleIfFullyReversed(
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

/**
 * The step's record, for a slice that has none yet: inserted once, then read
 * back (a concurrent delivery's insert wins, and is what comes back).
 *
 * An unpaid slice is cancelled, not reduced, once the steps already recorded
 * against it and this share take all of it (Codex-2hxff.59). A lost partial
 * dispute processed before a refund for the rest is the case: neither charge
 * is final on its own, and a pending row reduced to nothing would stay
 * pending, logged by every drain and never sent.
 */
async function ensureRecord(
  ctx: StepContext,
  row: Payout,
  share: number,
  isFinal: boolean
): Promise<PayoutReversal | undefined> {
  const { deps, cause } = ctx;
  let kind = kindFor(row, isFinal, cause);
  if (!kind) return undefined;
  if (
    kind === 'pending_reduction' &&
    (await takenCents(deps.db, row.id)) + share >= row.amountCents
  ) {
    kind = 'cancellation';
  }
  await deps.db
    .insert(payoutReversals)
    .values({
      payoutId: row.id,
      causeType: cause.type,
      causeId: cause.id,
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
  return findRecord(deps, row.id, cause);
}

async function findRecord(
  deps: ClawbackDeps,
  payoutId: string,
  cause: ClawbackCause
): Promise<PayoutReversal | undefined> {
  const [record] = await deps.db
    .select()
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, payoutId),
        eq(payoutReversals.causeType, cause.type),
        eq(payoutReversals.causeId, cause.id)
      )
    )
    .limit(1);
  return record;
}

async function wasRepaid(
  deps: ClawbackDeps,
  payoutId: string
): Promise<boolean> {
  const [repaid] = await deps.db
    .select({ id: payoutReversals.id })
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, payoutId),
        sql`${payoutReversals.repaidByPayoutId} IS NOT NULL`
      )
    )
    .limit(1);
  return repaid !== undefined;
}

/** What the steps recorded against a row take from it, cancelled ones aside. */
async function takenCents(db: Client, payoutId: string): Promise<number> {
  const [taken] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${payoutReversals.amountCents}), 0)::int`,
    })
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, payoutId),
        ne(payoutReversals.status, 'cancelled')
      )
    );
  return taken?.cents ?? 0;
}

/**
 * A cause new to a slice a won dispute paid back (Codex-2hxff.59). The
 * cumulative share no longer describes the slice, since its re-pay rows carry
 * part of it, but the share is still the payee's to give back, and a re-pay
 * row not yet paid is where it can come from:
 *
 * - a pending or failed re-pay row is reduced by the share, or cancelled when
 *   the share takes the rest of it, by a step of the cause ON the re-pay row,
 *   run like any unpaid slice's;
 * - an open chargeback only holds such a row, as it holds any unpaid slice:
 *   the drain skips it (`isDrainablePayout`), and a loss cuts it here;
 * - what no unpaid re-pay row can carry (one already paid, or a share larger
 *   than the rows) is a `slice_repaid` debt on the slice, for a person.
 *
 * The share is split once. A redelivery finds the cause's steps and only
 * finishes them. `moving` is a step of the cause still on the slice, which
 * Stripe refused there (`belongsOnRepayRows`): it moves in the split's own
 * transaction.
 */
async function clawBackRepaidShare(
  ctx: StepContext,
  slice: Payout,
  share: number,
  moving?: PayoutReversal
): Promise<StepResult> {
  const { deps, cause } = ctx;
  await splitRepaidShare(ctx, slice, share, moving);

  const repayIds = (await repayRowsOf(deps.db, slice.id)).map((row) => row.id);
  if (repayIds.length === 0) return {};
  const steps = await deps.db
    .select()
    .from(payoutReversals)
    .where(
      and(
        inArray(payoutReversals.payoutId, repayIds),
        eq(payoutReversals.causeType, cause.type),
        eq(payoutReversals.causeId, cause.id)
      )
    );
  const failures: unknown[] = [];
  for (const step of steps) {
    if (isSettled(step)) continue;
    // Read fresh: the drain may have claimed or paid it since.
    const repay = await readPayout(deps, step.payoutId);
    if (!repay) continue;
    const result = await runRecord(ctx, repay, step);
    if (result.failure !== undefined) failures.push(result.failure);
  }
  if (failures.length === 0) return {};
  return {
    failure: failures.length === 1 ? failures[0] : new AggregateError(failures),
  };
}

/**
 * Record how a cause's share of a re-paid slice splits over its re-pay rows,
 * oldest first, and the debt for what they cannot carry. One transaction,
 * under a lock on the slice, so two deliveries of the same cause never split
 * it twice: the second finds the first's steps, and counts them.
 *
 * A `moving` step leaves the slice in the same transaction: `cancelled`, code
 * `moved_to_repay`, and it becomes the debt if the re-pay rows cannot carry
 * the share. A failure rolls both back, so the step stays to be retried.
 */
async function splitRepaidShare(
  ctx: StepContext,
  slice: Payout,
  share: number,
  moving?: PayoutReversal
): Promise<void> {
  const { deps, charge, cause } = ctx;
  const { debt, moved } = await deps.db.transaction(async (tx) => {
    await tx
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.id, slice.id))
      .for('update');
    if (moving) {
      const [movedRow] = await tx
        .update(payoutReversals)
        .set({
          status: 'cancelled',
          lastErrorCode: MOVED_TO_REPAY,
          attemptedAt: null,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(payoutReversals.id, moving.id),
            inArray(payoutReversals.status, ['pending', 'failed'])
          )
        )
        .returning();
      // Settled by someone else meanwhile: nothing to move.
      if (!movedRow) return { debt: undefined, moved: false };
    }
    const repays = await repayRowsOf(tx, slice.id);
    const steps =
      repays.length === 0
        ? []
        : await tx
            .select()
            .from(payoutReversals)
            .where(
              inArray(
                payoutReversals.payoutId,
                repays.map((row) => row.id)
              )
            );

    // What the cause already left with a person on the slice is split
    // already: a `slice_repaid` debt, this code's or one the earlier
    // all-to-a-person rule wrote for the whole share. Taking it again off a
    // re-pay row would claw it twice while its review stays open.
    const [debt] = await tx
      .select({ amountCents: payoutReversals.amountCents })
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.payoutId, slice.id),
          eq(payoutReversals.causeType, cause.type),
          eq(payoutReversals.causeId, cause.id),
          eq(payoutReversals.lastErrorCode, SLICE_REPAID),
          ne(payoutReversals.status, 'cancelled')
        )
      )
      .limit(1);
    let left = share - (debt?.amountCents ?? 0);
    for (const repay of repays) {
      if (left <= 0) break;
      const onRow = steps.filter((step) => step.payoutId === repay.id);
      const own = onRow.find(
        (step) => step.causeType === cause.type && step.causeId === cause.id
      );
      if (own) {
        left -= own.amountCents;
        continue;
      }
      if (repay.status !== 'pending' && repay.status !== 'failed') continue;
      const rest =
        repay.amountCents -
        onRow
          .filter((step) => step.status !== 'cancelled')
          .reduce((sum, step) => sum + step.amountCents, 0);
      const take = Math.min(left, rest);
      if (take <= 0) continue;
      left -= take;
      // Held, not cut, while the chargeback is open (owner decision P-2).
      if (cause.type === 'dispute' && !cause.lost) continue;
      await tx
        .insert(payoutReversals)
        .values({
          payoutId: repay.id,
          causeType: cause.type,
          causeId: cause.id,
          amountCents: take,
          kind: take >= rest ? 'cancellation' : 'pending_reduction',
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
    return {
      debt:
        left > 0 ? await recordRepaidDebt(tx, slice, cause, left) : undefined,
      moved: moving !== undefined,
    };
  });

  if (moved && moving) {
    deps.obs.warn(
      `${causeLabel(cause)} step moved off a slice reversed whole and paid back: its share goes to the re-pay row`,
      {
        chargeId: charge.id,
        ...causeFields(cause),
        payoutId: slice.id,
        payoutReversalId: moving.id,
        amountCents: moving.amountCents,
      }
    );
  }
  if (debt) {
    deps.obs.error(
      'A cause reached a slice a won dispute paid back, and its re-pay has been paid; recorded for a person',
      {
        errorId: crypto.randomUUID(),
        chargeId: charge.id,
        ...causeFields(cause),
        payoutId: slice.id,
        payoutReversalId: debt.id,
        amountCents: debt.amountCents,
      }
    );
  }
}

/** The re-pay rows of a slice, oldest first. */
async function repayRowsOf(db: Client, sliceId: string): Promise<Payout[]> {
  const rows = await db
    .select({ repay: payouts })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payouts.id, payoutReversals.repaidByPayoutId))
    .where(eq(payoutReversals.payoutId, sliceId))
    .orderBy(asc(payouts.createdAt), asc(payouts.id));
  return rows.map((row) => row.repay);
}

/**
 * A debt for a person: what of a cause's share no unpaid re-pay row of the
 * slice could carry. Returns the step if this call wrote it.
 *
 * The cause's one slot on the slice may hold its step moved off it
 * (`moved_to_repay`): that row becomes the debt. Any other row there is left
 * alone, as before.
 */
async function recordRepaidDebt(
  tx: Tx,
  slice: Payout,
  cause: ClawbackCause,
  cents: number
): Promise<PayoutReversal | undefined> {
  const now = new Date();
  const debt = {
    amountCents: cents,
    kind: 'transfer_reversal' as const,
    status: 'debt' as const,
    lastErrorCode: SLICE_REPAID,
    attemptedAt: null,
    resolvedAt: now,
  };
  const [record] = await tx
    .insert(payoutReversals)
    .values({
      payoutId: slice.id,
      causeType: cause.type,
      causeId: cause.id,
      ...debt,
    })
    .onConflictDoUpdate({
      target: [
        payoutReversals.payoutId,
        payoutReversals.causeType,
        payoutReversals.causeId,
      ],
      set: debt,
      setWhere: sql`${payoutReversals.lastErrorCode} = ${MOVED_TO_REPAY}`,
    })
    .returning();
  if (!record) return undefined;
  if (slice.userId) {
    await tx
      .insert(refundReviews)
      .values({
        payoutReversalId: record.id,
        payoutId: slice.id,
        purchaseId: slice.purchaseId,
        creatorUserId: slice.userId,
        attemptedReversalCents: cents,
        errorCode: SLICE_REPAID,
        errorMessage:
          'A won dispute paid this slice back and the re-pay has been paid; its share of a later refund or dispute needs a person',
      })
      .onConflictDoNothing({
        target: refundReviews.payoutReversalId,
        where: sql`${refundReviews.payoutReversalId} IS NOT NULL`,
      });
  }
  return record;
}

/** The dispute is still a clawback cause: open, or lost. */
function disputeStillClawed(disputeId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.stripeDisputeId} = ${disputeId} AND ${inArray(disputes.status, CHARGEBACK_CLAWED_STATUSES)})`;
}

async function isStillClawed(
  deps: ClawbackDeps,
  disputeId: string
): Promise<boolean> {
  const [row] = await deps.db
    .select({ id: disputes.id })
    .from(disputes)
    .where(
      and(
        eq(disputes.stripeDisputeId, disputeId),
        inArray(disputes.status, CHARGEBACK_CLAWED_STATUSES)
      )
    )
    .limit(1);
  return row !== undefined;
}

/**
 * A step of a dispute won since this delivery read it, cancelled here only if
 * it was never claimed: `pending` with no `attempted_at`, so it never reached
 * Stripe. The won dispute's re-pay may already have looked, and would not see
 * it. A step claimed before (`failed`, or a lease that ran out) may have
 * landed; the re-pay checks it with Stripe instead.
 */
async function cancelUnclaimedStep(
  deps: ClawbackDeps,
  recordId: string
): Promise<void> {
  await deps.db
    .update(payoutReversals)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(
      and(
        eq(payoutReversals.id, recordId),
        eq(payoutReversals.status, 'pending'),
        isNull(payoutReversals.attemptedAt)
      )
    );
}

/**
 * Take the step's lease, so one delivery works on it at a time. `guard`, when
 * given, must also hold at the moment of the claim.
 */
async function claimRecord(
  deps: ClawbackDeps,
  recordId: string,
  guard?: SQL
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
        ),
        guard
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
  ctx.deps.obs.error(`${causeLabel(ctx.cause)} clawback step failed`, {
    errorId: crypto.randomUUID(),
    chargeId: ctx.charge.id,
    ...causeFields(ctx.cause),
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
