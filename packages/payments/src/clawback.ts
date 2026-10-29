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
  type PayeeCredit,
  type PayeeCreditEffect,
  type PayeeCreditSettledAs,
  type Payout,
  type PayoutReversal,
  type PayoutReversalKind,
  payeeCredits,
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
  isNotNull,
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
  cancelUnpaidRow,
  type LedgerDeps,
  lateTransferOf,
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
 * `disputes`, which the dispute webhook keeps. A failed refund's re-pay reads
 * it too, inside its transaction (`repayFailedRefund`).
 */
export async function chargebacksFor(
  db: Client,
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
 * The one failed refund that leaves it is one support settled as
 * `creators_repaid`: `reverseCharge` drops it (`withoutRepaidRefunds`), so
 * every caller's list is filtered, however it was read.
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
    .sort(inRefundOrder);
}

/** Stripe's order of a charge's refunds: by `created`, then by id. */
function inRefundOrder(a: ClawbackRefund, b: ClawbackRefund): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Settled at Stripe, whichever way: see `ClawbackRefund`. */
const CLAWABLE_REFUND_STATUSES = ['succeeded', 'failed'];

function isClawable(status: string | null): boolean {
  return status !== null && CLAWABLE_REFUND_STATUSES.includes(status);
}

/**
 * The charge's refunds the clawback counts, as the refund webhooks have
 * recorded them in `refunds`: settled (`listClawableRefunds`' rule), less
 * those support re-paid, in Stripe's order. No Stripe call, so a failed
 * refund's re-pay re-checks its block with it INSIDE its transaction
 * (`repayFailedRefund`). Every refund is recorded here before its clawback
 * runs.
 */
export async function recordedClawableRefunds(
  db: Client,
  chargeId: string
): Promise<ClawbackRefund[]> {
  const rows = await db
    .select({
      id: refunds.stripeRefundId,
      amountCents: refunds.amountCents,
      createdAt: refunds.stripeCreatedAt,
    })
    .from(refunds)
    .where(
      and(
        eq(refunds.stripeChargeId, chargeId),
        inArray(refunds.status, CLAWABLE_REFUND_STATUSES),
        sql`${refunds.amountCents} > 0`,
        sql`${refunds.resolution} IS DISTINCT FROM 'creators_repaid'`
      )
    );
  return rows
    .map((row) => ({
      id: row.id,
      amountCents: row.amountCents,
      createdAt: Math.floor(row.createdAt.getTime() / 1000),
    }))
    .sort(inRefundOrder);
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

/** The charge amount is every share's denominator (D1): it must be known. */
function assertChargeAmount(charge: ClawbackCharge): void {
  if (!(charge.amountCents > 0)) {
    throw new InternalServiceError('Clawback needs the charge amount', {
      chargeId: charge.id,
    });
  }
}

/** A cause, with the running total it is shared on. */
interface CauseInOrder {
  cause: ClawbackCause;
  /** What the causes before it took of the charge. */
  before: number;
  /** `before` plus this cause. */
  after: number;
  /** It completes the charge's refund: an unpaid slice is cancelled, not reduced. */
  isFinal: boolean;
}

/**
 * The causes in the order the engine claws them back: the refunds as given
 * (oldest first), then the chargebacks, on one cumulative share. So a
 * chargeback on a partly refunded charge takes only what the refunds left,
 * and a new refund, last among the refunds, is shared before every
 * chargeback. `reverseCharge`, `planClawback` and `failedRefundRepayBlock`
 * all walk this.
 */
function inClawbackOrder(
  chargeAmountCents: number,
  refunds: readonly ClawbackRefund[],
  chargebacks: readonly ClawbackDispute[]
): CauseInOrder[] {
  const causes: ClawbackCause[] = [
    ...refunds.map((refund) => ({ type: 'refund' as const, ...refund })),
    ...chargebacks.map((dispute) => ({ type: 'dispute' as const, ...dispute })),
  ];
  let before = 0;
  return causes.map((cause) => {
    const after = before + cause.amountCents;
    const inOrder = {
      cause,
      before,
      after,
      isFinal: after >= chargeAmountCents,
    };
    before = after;
    return inOrder;
  });
}

/**
 * The refunds, less any support settled as `creators_repaid` (Codex-2hxff.28,
 * Q5c). Such a refund failed, and what it took was paid back to its payees
 * (`repayFailedRefund`), so it leaves the running total. A cause clawed back
 * AFTER the settlement is shared as if the refund had never been made, and on
 * a re-paid slice it takes its share off the new re-pay rows. Left in, the
 * refund would keep counting as refunded, and that cause's share would floor
 * to zero.
 *
 * It is not retroactive. A cause recorded while the refund still counted keeps
 * the share it got then, and nothing re-shares it. That is why the settlement
 * refuses when such a cause was shared against the refund
 * (`failedRefundRepayBlock`; owner decision 2026-10-25).
 */
async function withoutRepaidRefunds(
  db: Client,
  listed: readonly ClawbackRefund[]
): Promise<readonly ClawbackRefund[]> {
  if (listed.length === 0) return listed;
  const repaid = await db
    .select({ id: refunds.stripeRefundId })
    .from(refunds)
    .where(
      and(
        inArray(
          refunds.stripeRefundId,
          listed.map((refund) => refund.id)
        ),
        eq(refunds.resolution, 'creators_repaid')
      )
    );
  if (repaid.length === 0) return listed;
  const skip = new Set(repaid.map((row) => row.id));
  return listed.filter((refund) => !skip.has(refund.id));
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
    sql`NOT EXISTS (SELECT 1 FROM ${payoutReversals} WHERE ${payoutReversals.repaidByPayoutId} = ${payouts.id})`,
    // Nor is a payee credit's, which a debt's own re-pay can take the step's
    // link from (`repayDebtStep`, review MED-4).
    sql`NOT EXISTS (SELECT 1 FROM ${payeeCredits} WHERE ${payeeCredits.repayPayoutId} = ${payouts.id})`
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

/**
 * The step a cause new to a slice records there; null if it records none.
 * `kindFor`, except that an unpaid slice is cancelled, not reduced, once the
 * steps already recorded against it (`takenCents`) and this share take all of
 * it (Codex-2hxff.59). A lost partial dispute processed before a refund for
 * the rest is the case: neither charge is final on its own, and a pending row
 * reduced to nothing would stay pending, logged by every drain and never sent.
 */
function newStepKind(
  row: Payout,
  isFinal: boolean,
  cause: ClawbackCause,
  share: number,
  takenCents: number
): PayoutReversalKind | null {
  const kind = kindFor(row, isFinal, cause);
  return kind === 'pending_reduction' && takenCents + share >= row.amountCents
    ? 'cancellation'
    : kind;
}

/** What steps take from their row: all of them but the cancelled ones. */
function uncancelledCents(
  steps: readonly Pick<PayoutReversal, 'amountCents' | 'status'>[]
): number {
  return steps
    .filter((step) => step.status !== 'cancelled')
    .reduce((sum, step) => sum + step.amountCents, 0);
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

  const refunds = await withoutRepaidRefunds(
    deps.db,
    typeof input.refunds === 'function' ? await input.refunds() : input.refunds
  );
  const chargebacks = await chargebacksFor(deps.db, charge.id);
  if (refunds.length === 0 && chargebacks.length === 0) return;
  assertChargeAmount(charge);

  const failures: unknown[] = [];
  for (const { cause, before, after, isFinal } of inClawbackOrder(
    charge.amountCents,
    refunds,
    chargebacks
  )) {
    for (const { id } of listed) {
      const result = await clawBackShare(
        { deps, charge, cause },
        id,
        before,
        after,
        isFinal
      );
      if (result.failure !== undefined) failures.push(result.failure);
    }
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

/** How a line of a refund's clawback is taken, as support's preview names it. */
export type ClawbackPlanMethod =
  // Reversed from the payee's paid transfer; a low balance makes it a debt.
  | 'transfer_reversal'
  // Taken off an unpaid slice before the drain pays it.
  | 'reduce_unpaid'
  // An unpaid slice cancelled: the refund takes the rest of it.
  | 'cancel_unpaid'
  // The platform fee's share (`retained_fee`).
  | 'platform_bears'
  // Taken off an unpaid re-pay row of a slice that was paid back.
  | 'from_repay_payout'
  // What no unpaid re-pay row can carry: a `slice_repaid` debt for a person.
  | 'needs_person'
  // What no slice gives back, which the platform bears.
  | 'rounding';

export interface ClawbackPlanLine {
  /** The slice; null on the rounding line. */
  payoutId: string | null;
  /** On a `from_repay_payout` line, the re-pay row the share comes off. */
  repayPayoutId: string | null;
  amountCents: number;
  method: ClawbackPlanMethod;
}

export interface ClawbackPlan {
  /** The refund completes the charge's refund: unpaid slices are cancelled. */
  isFinal: boolean;
  /** One line per step the engine will record, then the rounding line. */
  lines: ClawbackPlanLine[];
}

/** What a refund's clawback is planned from: the charge as the engine sees it. */
export interface ClawbackPlanInput {
  charge: ClawbackCharge;
  /** The source's slices of the charge (`sourceScope`): no re-pay row. */
  slices: readonly Payout[];
  /** Every step on the slices and on their re-pay rows. */
  steps: readonly PayoutReversal[];
  /** The slices' re-pay rows, each slice's oldest first (`repayRowsOf`). */
  repayRows: readonly Payout[];
  /**
   * The charge's causes as `reverseCharge` reads them: the refunds
   * (`listClawableRefunds`, less `withoutRepaidRefunds`), and the chargebacks
   * open or lost (`disputes`).
   */
  causes: {
    refunds: readonly ClawbackRefund[];
    chargebacks: readonly ClawbackDispute[];
  };
  /** The refund to plan, in pence. */
  newRefundCents: number;
}

/** The planned refund's id: never a Stripe id, so no recorded step is its. */
const PLANNED_REFUND_ID = 'planned_refund';

const PLAN_METHOD: Record<PayoutReversalKind, ClawbackPlanMethod> = {
  transfer_reversal: 'transfer_reversal',
  pending_reduction: 'reduce_unpaid',
  cancellation: 'cancel_unpaid',
  retained_fee: 'platform_bears',
};

/**
 * What a new refund of `newRefundCents` would take from each slice of the
 * charge, before it is made: support's refund preview (Codex-2hxff.28 §3). The
 * engine's own rules decide it, so the preview cannot drift from what
 * `charge.refunded` then records: the running total (`inClawbackOrder`, with
 * the refund last among the refunds), each share (`refundShare`), the re-paid
 * path first (`splitRepaid`, as `clawBackShare` takes it), then the step
 * (`newStepKind`).
 *
 * It plans from the recorded state. What it cannot know is Stripe's answer: a
 * `transfer_reversal` line becomes a creator debt if the payee's balance cannot
 * cover it, and an unpaid slice a drain pays meanwhile is reversed instead.
 * The rounding line is the refund less every other line: a share's floored
 * pennies, and the share of a slice with nothing left to take.
 */
export function planClawback(input: ClawbackPlanInput): ClawbackPlan {
  const { charge, slices, steps, repayRows, causes, newRefundCents } = input;
  assertChargeAmount(charge);
  const planned = inClawbackOrder(
    charge.amountCents,
    [
      ...causes.refunds,
      // After every refund listed: Stripe orders a charge's refunds by it.
      {
        id: PLANNED_REFUND_ID,
        amountCents: newRefundCents,
        createdAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    causes.chargebacks
  ).find(
    ({ cause }) => cause.type === 'refund' && cause.id === PLANNED_REFUND_ID
  );
  if (!planned) {
    throw new InternalServiceError('The planned refund is not in the order');
  }
  const { cause, before, after, isFinal } = planned;

  const lines: ClawbackPlanLine[] = [];
  for (const slice of slices) {
    const share = refundShare(
      slice.amountCents,
      charge.amountCents,
      before,
      after
    );
    if (share <= 0) continue;
    const onSlice = steps.filter((step) => step.payoutId === slice.id);
    const repayIds = new Set(
      onSlice.flatMap((step) =>
        step.repaidByPayoutId ? [step.repaidByPayoutId] : []
      )
    );
    if (repayIds.size > 0) {
      // Paid back (`wasRepaid`): the share comes off the re-pay rows. A cause
      // new to the slice has left nothing with a person on it yet.
      const split = splitRepaid(
        cause,
        share,
        0,
        repayRows.filter((row) => repayIds.has(row.id)),
        steps
      );
      for (const take of split.takes) {
        lines.push({
          payoutId: slice.id,
          repayPayoutId: take.repayPayoutId,
          amountCents: take.amountCents,
          method: 'from_repay_payout',
        });
      }
      if (split.leftCents > 0) {
        lines.push({
          payoutId: slice.id,
          repayPayoutId: null,
          amountCents: split.leftCents,
          method: 'needs_person',
        });
      }
      continue;
    }
    const kind = newStepKind(
      slice,
      isFinal,
      cause,
      share,
      uncancelledCents(onSlice)
    );
    if (!kind) continue;
    lines.push({
      payoutId: slice.id,
      repayPayoutId: null,
      amountCents: share,
      method: PLAN_METHOD[kind],
    });
  }
  const taken = lines.reduce((sum, line) => sum + line.amountCents, 0);
  lines.push({
    payoutId: null,
    repayPayoutId: null,
    amountCents: newRefundCents - taken,
    method: 'rounding',
  });
  return { isFinal, lines };
}

/**
 * Read what `planClawback` needs for one source of a charge, as
 * `reverseCharge` reads it: the same slices (`sourceScope`), their steps and
 * re-pay rows (`repayRowsOf`), the refunds less those support re-paid, and the
 * chargebacks open or lost. It writes nothing. `refunds` is what
 * `reverseCharge` takes, usually `() => listClawableRefunds(stripe, id)`.
 */
export async function loadClawbackPlanInput(
  db: LedgerDeps['db'],
  input: {
    charge: ClawbackCharge;
    source: ClawbackSource;
    refunds:
      | readonly ClawbackRefund[]
      | (() => Promise<readonly ClawbackRefund[]>);
  }
): Promise<Omit<ClawbackPlanInput, 'newRefundCents'>> {
  const { charge, source } = input;
  const slices = await db
    .select()
    .from(payouts)
    .where(sourceScope(source, charge.id));
  const repayRows: Payout[] = [];
  for (const slice of slices) {
    repayRows.push(...(await repayRowsOf(db, slice.id)));
  }
  const payoutIds = [...slices, ...repayRows].map((row) => row.id);
  const steps =
    payoutIds.length === 0
      ? []
      : await db
          .select()
          .from(payoutReversals)
          .where(inArray(payoutReversals.payoutId, payoutIds));
  return {
    charge,
    slices,
    steps,
    repayRows,
    causes: await loadClawbackCauses(db, {
      chargeId: charge.id,
      refunds: input.refunds,
    }),
  };
}

/**
 * The charge's causes as `reverseCharge` reads them: the refunds less those
 * support re-paid (`withoutRepaidRefunds`), oldest first, and the chargebacks
 * open or lost. `failedRefundRepayBlock` and the preview read them here.
 */
export async function loadClawbackCauses(
  db: LedgerDeps['db'],
  input: {
    chargeId: string;
    refunds:
      | readonly ClawbackRefund[]
      | (() => Promise<readonly ClawbackRefund[]>);
  }
): Promise<ClawbackPlanInput['causes']> {
  return {
    refunds: await withoutRepaidRefunds(
      db,
      typeof input.refunds === 'function'
        ? await input.refunds()
        : input.refunds
    ),
    chargebacks: await chargebacksFor(db, input.chargeId),
  };
}

/** Why a failed refund cannot be settled `creators_repaid`. */
export type RepayBlockReason = 'chargeback' | 'later_refunds';

/**
 * Why a failed refund cannot be settled `creators_repaid`, or null (owner
 * decision 2026-10-25). The re-pay drops the refund from the running total,
 * but a cause shared while it still counted keeps the share it got then
 * (`withoutRepaidRefunds` is not retroactive). Re-paying the refund would then
 * pay the payees for money a later cause should have taken:
 *
 * - `'chargeback'`: the charge has a chargeback open or lost. Every chargeback
 *   is shared after the refunds (`inClawbackOrder`), so with this one counted.
 * - `'later_refunds'`: a refund after this one in the engine's order brings
 *   the running total over the charge. Its share was capped (`refundShare`)
 *   because this refund still counted.
 *
 * `refunds` and `chargebacks` are the engine's own causes
 * (`loadClawbackCauses`). A refund it no longer counts (already re-paid)
 * blocks nothing: there is nothing left to re-pay.
 */
export function failedRefundRepayBlock(input: {
  chargeAmountCents: number;
  refunds: readonly ClawbackRefund[];
  chargebacks: readonly ClawbackDispute[];
  stripeRefundId: string;
}): RepayBlockReason | null {
  const order = inClawbackOrder(input.chargeAmountCents, input.refunds, []);
  const at = order.findIndex(({ cause }) => cause.id === input.stripeRefundId);
  if (at === -1) return null;
  if (input.chargebacks.length > 0) return 'chargeback';
  return order
    .slice(at + 1)
    .some(({ after }) => after > input.chargeAmountCents)
    ? 'later_refunds'
    : null;
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
function isSettled(
  record: PayoutReversal
): record is PayoutReversal & { status: PayeeCreditSettledAs } {
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
  // this delivery read before the win must not reach Stripe after it. A
  // refund's, likewise, only until support settles it `creators_repaid`.
  let claimed: ClaimedStep | undefined;
  if (cause.type === 'refund') {
    const outcome = await claimRefundStep(deps, record.id, cause.id);
    if (outcome === 'repaid') {
      // Settled since this delivery read the refund. A step never claimed is
      // cancelled. The settlement refused while any other was unfinished.
      await cancelUnclaimedStep(deps.db, record.id);
      return {};
    }
    claimed = outcome;
  } else {
    claimed = await claimRecord(
      deps.db,
      record.id,
      disputeStillClawed(cause.id)
    );
  }
  if (!claimed) {
    if (cause.type === 'dispute' && !(await isStillClawed(deps, cause.id))) {
      // A step never claimed is cancelled. One claimed before may have
      // reached Stripe: the won dispute's re-pay asks Stripe and settles it.
      await cancelUnclaimedStep(deps.db, record.id);
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
    // Logged first, so a failure of the recovery below never hides it.
    logStepFailure(ctx, row, claimed, error);
    try {
      // A database or unexpected error: the attempt did not happen at
      // Stripe, or its outcome is unknown, so the key is kept for the retry.
      if (!(await markFailed(deps, claimed, errorCodeOf(error), false))) {
        // The claim is gone. If this run marked the step done and a later
        // write failed, that write was the slice's settle: it is re-run
        // here, since a done step is never run again. Otherwise, unless
        // `claimLost` already reported it, it is any lost claim, and Stripe
        // is asked whether the reversal landed.
        if (!claimed.run.done && !claimed.run.reported) {
          const slice = await readPayout(deps, row.id);
          await claimLost(ctx, row, claimed, {
            transferId: slice?.stripeTransferId ?? undefined,
            ask: true,
            error,
          });
        }
        await settleIfFullyReversed(deps, row.id);
      }
    } catch (recoveryError) {
      // Returned as the step's failure, as before the recovery existed: the
      // webhook retries, and the other steps still run.
      deps.obs.error(
        `${causeLabel(cause)} clawback: recovering a failed step failed too; the step may still be leased, and the slice settle not re-run`,
        {
          errorId: crypto.randomUUID(),
          chargeId: ctx.charge.id,
          ...causeFields(cause),
          payoutId: row.id,
          payoutReversalId: claimed.id,
          error:
            recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError),
        }
      );
    }
    return { failure: error };
  }
}

async function runStep(
  ctx: StepContext,
  row: Payout,
  record: ClaimedStep
): Promise<StepResult> {
  const { deps } = ctx;
  switch (record.kind) {
    case 'retained_fee':
      if (!(await markDone(deps, record))) return claimLost(ctx, row, record);
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
 * drain's own lease condition, orders the two. The reduction is the step's
 * `done` itself, written on the claim's version (`claimHolds`), so one that
 * comes after another path settled the step never commits.
 */
async function reduceUnpaidSlice(
  ctx: StepContext,
  row: Payout,
  record: ClaimedStep
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
    if (!locked) return 'held' as const;
    const [done] = await tx
      .update(payoutReversals)
      .set(doneFields(now))
      .where(claimHolds(record))
      .returning();
    return done ? ('reduced' as const) : ('lost' as const);
  });
  if (reduced === 'reduced') return {};
  if (reduced === 'lost') return claimLost(ctx, row, record);

  // The row is paid, or a drain is paying it now.
  const current = await readPayout(deps, row.id);
  if (current?.status === 'paid' && current.stripeTransferId) {
    const asReversal = await setKind(deps, record, 'transfer_reversal');
    if (!asReversal) return claimLost(ctx, row, record);
    return reverseTransfer(
      ctx,
      current,
      asReversal,
      current.stripeTransferId,
      asReversal.amountCents
    );
  }
  if (current?.status === 'pending' || current?.status === 'failed') {
    if (!(await markFailed(deps, record, 'payout_in_flight', false))) {
      return claimLost(ctx, row, record);
    }
    return {
      failure: new ServiceUnavailableError(
        `A payout for this ${ctx.cause.type} is being paid; retry once it settles`,
        { payoutId: row.id }
      ),
    };
  }
  // Reversed or cancelled meanwhile: nothing is left for this share.
  if (!(await markDone(deps, record))) return claimLost(ctx, row, record);
  return {};
}

/**
 * The refund (or lost chargeback) that completes a charge's refund cancels an
 * unpaid slice, FIRST, so nothing can pay it afterwards; a transfer Stripe made
 * for it anyway is reversed in full (`cancelUnpaidPayout`'s halves,
 * Codex-2hxff.11).
 *
 * The claim's lease is renewed FIRST, a compare-and-set on the claim, and the
 * slice is cancelled only once that has committed (Codex-2hxff.72). Every
 * settlement's write to a step needs it unleased, so from the renewal on, none
 * can cancel the step before its done. One that came first makes the renewal
 * miss, and nothing is cancelled. Only a delivery that outlives the renewed
 * lease too can meet a settled step after the cancel, and `claimLost` alerts
 * that. No transaction is needed, so a failed cancel is the step's failure
 * like any write's (Codex-2hxff.51).
 */
async function cancelUnpaidSlice(
  ctx: StepContext,
  row: Payout,
  record: ClaimedStep
): Promise<StepResult> {
  const { deps, cause } = ctx;
  const renewedAt = new Date();
  const [renewed] = await deps.db
    .update(payoutReversals)
    .set({ attemptedAt: renewedAt })
    .where(claimHolds(record))
    .returning();
  if (!renewed) return claimLost(ctx, row, record);
  record.run.lease = renewedAt;
  const cancelled = await cancelUnpaidRow(
    deps.db,
    row,
    cause.type === 'dispute' ? 'cancelled_by_dispute' : 'cancelled_by_refund',
    renewedAt
  );
  if (cancelled) return finishCancelledSlice(ctx, row, record);

  // Changed since it was read. Paid: claw back this share of the transfer.
  const current = await readPayout(deps, row.id);
  if (current?.status === 'paid' && current.stripeTransferId) {
    const asReversal = await setKind(deps, record, 'transfer_reversal');
    if (!asReversal) return claimLost(ctx, row, record);
    return reverseTransfer(
      ctx,
      current,
      asReversal,
      current.stripeTransferId,
      asReversal.amountCents
    );
  }
  // A retry of a step whose own cancel committed before it failed (data
  // design §6.4): the cancel matches nothing now, but this step took the
  // slice, so a transfer a drain made for it is still to be reversed. Marked
  // done without asking, the payee would keep it.
  if (current && (await tookTheSliceOf(deps.db, record, current))) {
    return finishCancelledSlice(ctx, current, record);
  }
  if (!(await markDone(deps, record))) return claimLost(ctx, row, record);
  return {};
}

/**
 * After this step cancelled the unpaid slice: a transfer Stripe made for it
 * anyway is reversed in full; otherwise the step is done.
 */
async function finishCancelledSlice(
  ctx: StepContext,
  row: Payout,
  record: ClaimedStep
): Promise<StepResult> {
  const { deps } = ctx;
  const late = await lateTransferOf(deps, row);
  if (late.kind === 'found') {
    return reverseTransfer(ctx, row, record, late.transferId, undefined);
  }
  // None, or Stripe could not say: the step is done as the ledger knows
  // it, as `cancelUnpaidPayout` leaves it. Under a step settled meanwhile,
  // a failed lookup is never read as "no transfer went out".
  if (!(await markDone(deps, record))) {
    return claimLost(ctx, row, record, {
      cancelledSlice: true,
      lateTransferUnknown: late.kind === 'unknown',
    });
  }
  return {};
}

/** The fields `tookTheSlice` reads from a step. */
type CancellationStep = Pick<
  PayoutReversal,
  'id' | 'kind' | 'causeType' | 'attemptedAt'
>;

/**
 * Whether this `cancellation` step is the one that cancelled its slice (owner
 * decision Q6, 2026-10-27; data design §6.1). Only a cancellation step's
 * cancel writes `cancelled_by_<cause type>` (`cancelUnpaidSlice`), a slice
 * already cancelled gets no new step (`kindFor`), and the cancel writes the
 * step's renewed lease as the slice's `resolved_at`. So it did when the slice
 * is cancelled by its cause type and either that lease is still on the step,
 * or no other cancellation of that cause type exists on the slice. `steps`
 * may hold any of the slice's steps; only the other cancellations count.
 */
export function tookTheSlice(
  step: CancellationStep,
  slice: Pick<Payout, 'status' | 'resolvedAt'>,
  steps: readonly Pick<PayoutReversal, 'id' | 'kind' | 'causeType'>[]
): boolean {
  if (step.kind !== 'cancellation') return false;
  if (slice.status !== `cancelled_by_${step.causeType}`) return false;
  if (
    step.attemptedAt !== null &&
    slice.resolvedAt !== null &&
    step.attemptedAt.getTime() === slice.resolvedAt.getTime()
  ) {
    return true;
  }
  return !steps.some(
    (other) =>
      other.id !== step.id &&
      other.kind === 'cancellation' &&
      other.causeType === step.causeType
  );
}

/** `tookTheSlice`, reading the slice's other cancellations. */
export async function tookTheSliceOf(
  db: Client,
  step: CancellationStep,
  slice: Payout
): Promise<boolean> {
  if (step.kind !== 'cancellation') return false;
  if (slice.status !== `cancelled_by_${step.causeType}`) return false;
  const others = await db
    .select({
      id: payoutReversals.id,
      kind: payoutReversals.kind,
      causeType: payoutReversals.causeType,
    })
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, slice.id),
        eq(payoutReversals.kind, 'cancellation'),
        eq(payoutReversals.causeType, step.causeType),
        ne(payoutReversals.id, step.id)
      )
    );
  return tookTheSlice(step, slice, others);
}

/**
 * How the ledger says a `cancellation` step took its slice
 * (`sliceTakenBy`).
 */
export type SliceTaken =
  /** `tookTheSlice`: its cancel is the one that cancelled the slice. */
  | { by: 'cancel' }
  /**
   * The drain then sent the slice's transfer anyway, reversed it in full and
   * recorded it, marking the slice `reversed` (Codex-2hxff.88). The step
   * took the share only if Stripe shows `transferId` reversed in full,
   * which the caller asks.
   */
  | { by: 'reversed'; transferId: string };

/**
 * `tookTheSlice`, and also for a slice the drain marked `reversed` after the
 * cancel (owner decision 2026-10-28 on Codex-2hxff.88, "Re-pay them, same
 * rule"): that state no longer says which cause cancelled it, so the step
 * took it only when it is the slice's ONLY cancellation or transfer
 * reversal, of any cause, and the slice records its transfer. Null when
 * neither holds: a person decides.
 */
export function sliceTakenBy(
  step: CancellationStep,
  slice: Pick<Payout, 'status' | 'resolvedAt' | 'stripeTransferId'>,
  steps: readonly Pick<PayoutReversal, 'id' | 'kind' | 'causeType'>[]
): SliceTaken | null {
  if (tookTheSlice(step, slice, steps)) return { by: 'cancel' };
  if (
    step.kind !== 'cancellation' ||
    slice.status !== 'reversed' ||
    !slice.stripeTransferId
  ) {
    return null;
  }
  const another = steps.some(
    (other) =>
      other.id !== step.id &&
      (other.kind === 'cancellation' || other.kind === 'transfer_reversal')
  );
  return another
    ? null
    : { by: 'reversed', transferId: slice.stripeTransferId };
}

/**
 * What the ledger says of a `cancellation` step and its slice (review
 * round 2 MED-1): it took the slice (`SliceTaken`); the slice IS cancelled by
 * its cause type, or `reversed`, but a sibling makes it unclear which step
 * took it (`ambiguous`: only then does a person decide); or the slice is in
 * any other state, pending, paid, or cancelled by the other cause type, so
 * this step's cancel never took it (`not_cancelled`: read it as a transfer
 * step would be). Any other step is `not_cancelled` too.
 */
export type CancellationAttribution =
  | SliceTaken
  | 'ambiguous'
  | 'not_cancelled';

export function cancellationAttribution(
  step: CancellationStep,
  slice: Pick<Payout, 'status' | 'resolvedAt' | 'stripeTransferId'>,
  steps: readonly Pick<PayoutReversal, 'id' | 'kind' | 'causeType'>[]
): CancellationAttribution {
  if (
    step.kind !== 'cancellation' ||
    (slice.status !== `cancelled_by_${step.causeType}` &&
      slice.status !== 'reversed')
  ) {
    return 'not_cancelled';
  }
  return sliceTakenBy(step, slice, steps) ?? 'ambiguous';
}

/** `sliceTakenBy`, reading the slice's other cancellations and transfer reversals. */
export async function sliceTakenByOf(
  db: Client,
  step: CancellationStep,
  slice: Payout
): Promise<SliceTaken | null> {
  const attribution = await cancellationAttributionOf(db, step, slice);
  return typeof attribution === 'object' ? attribution : null;
}

/** `cancellationAttribution`, reading the slice's other cancellations and transfer reversals. */
export async function cancellationAttributionOf(
  db: Client,
  step: CancellationStep,
  slice: Payout
): Promise<CancellationAttribution> {
  if (cancellationAttribution(step, slice, []) === 'not_cancelled') {
    return 'not_cancelled';
  }
  const others = await db
    .select({
      id: payoutReversals.id,
      kind: payoutReversals.kind,
      causeType: payoutReversals.causeType,
    })
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, slice.id),
        inArray(payoutReversals.kind, ['cancellation', 'transfer_reversal']),
        ne(payoutReversals.id, step.id)
      )
    );
  return cancellationAttribution(step, slice, others);
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
  record: ClaimedStep,
  transferId: string,
  amountCents: number | undefined
): Promise<StepResult> {
  const { deps, charge, cause } = ctx;
  // The late transfer of a slice this delivery cancelled (`cancelUnpaidSlice`).
  const cancelledSlice =
    record.kind === 'cancellation' && amountCents === undefined;
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
    // Read once: "reversed" settles the step below, and "not reversed" is
    // what lets a refusal under a settled step say the payee kept it.
    const transferState = cancelledSlice
      ? await transferReversedState(deps, transferId)
      : undefined;
    if (transferState === 'reversed') {
      // The late transfer's own settle found it too and reversed it first
      // (Codex-pqsfg). Stripe refuses a second full reversal, but the money is
      // back, so the step is done, whoever reversed it. Logged as
      // settleTransfer's twin branch is: the step records no reversal id, so
      // without this line it reads like a slice no transfer ever reached.
      if (!(await markDone(deps, record))) {
        return claimLost(ctx, row, record, { transferId, cancelledSlice });
      }
      await recordCancelledSliceReversed(deps, row, transferId);
      deps.obs.warn(
        `${causeLabel(cause)} clawback: the late transfer was already reversed in full, so the step is done`,
        {
          chargeId: charge.id,
          ...causeFields(cause),
          payoutId: row.id,
          payoutReversalId: record.id,
          stripeTransferId: transferId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return {};
    }
    const code = errorCodeOf(error);
    if (code === 'insufficient_funds' || code === 'balance_insufficient') {
      if (!(await recordDebt(ctx, row, record, error))) {
        // Refused for the balance: a cancelled slice's late transfer is still
        // the payee's, for certain.
        return claimLost(ctx, row, record, {
          transferId,
          cancelledSlice,
          refused: true,
          keptConfirmed: true,
          error,
        });
      }
      return {};
    }
    const definitive = isDefinitiveStripeError(error);
    if (definitive && (await belongsOnRepayRows(deps, row, record))) {
      const slice = await readPayout(deps, row.id);
      return slice
        ? clawBackRepaidShare(ctx, slice, record.amountCents, record)
        : {};
    }
    if (!(await markFailed(deps, record, code, definitive))) {
      // Refused, nothing landed. Unconfirmed, it may have: Stripe is asked.
      return claimLost(ctx, row, record, {
        transferId,
        ask: !definitive,
        cancelledSlice,
        refused: definitive,
        keptConfirmed: transferState === 'not_reversed',
        error,
      });
    }
    logStepFailure(ctx, row, record, error);
    // Stripe refused. A redelivery would get the same answer, and rejecting
    // would end the webhook before the customer's refund email, so the step is
    // left `failed` for the hourly retry, which uses the next attempt's key.
    return definitive ? {} : { failure: error };
  }

  if (!(await markDone(deps, record, reversal.id))) {
    // The reversal LANDED, and the claim is gone.
    return claimLost(ctx, row, record, {
      transferId,
      reversal: { id: reversal.id, amount: reversal.amount },
      cancelledSlice,
    });
  }
  if (record.kind === 'cancellation') {
    await recordCancelledSliceReversed(deps, row, transferId);
  } else {
    await settleIfFullyReversed(deps, row.id);
  }
  return {};
}

/**
 * Whether Stripe has reversed this transfer in full, under any key, or
 * `unknown` when it cannot be asked. Never read as "not reversed": a cancelled
 * slice's transfer read as kept closes its payee's credit as not owed.
 */
export async function transferReversedState(
  deps: Pick<ClawbackDeps, 'stripe' | 'obs'>,
  transferId: string
): Promise<'reversed' | 'not_reversed' | 'unknown'> {
  try {
    const transfer = await deps.stripe.transfers.retrieve(transferId);
    return transfer.reversed === true ? 'reversed' : 'not_reversed';
  } catch (error) {
    deps.obs.warn('Stripe could not say whether a transfer is reversed', {
      stripeTransferId: transferId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unknown';
  }
}

/**
 * A cancelled slice whose transfer went out anyway: the money moved and is
 * now back, so the row is reversed, with its transfer recorded.
 */
async function recordCancelledSliceReversed(
  deps: ClawbackDeps,
  row: Payout,
  transferId: string
): Promise<void> {
  await deps.db
    .update(payouts)
    .set({
      status: 'reversed',
      stripeTransferId: transferId,
      resolvedAt: row.resolvedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payouts.id, row.id));
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
 *
 * The step and its review are one transaction, on the claim's version: a
 * delivery whose claim is gone queues no debt for a step another path
 * settled. False if the claim no longer holds.
 */
async function recordDebt(
  ctx: StepContext,
  row: Payout,
  record: ClaimedStep,
  error: unknown
): Promise<boolean> {
  const { deps, charge, cause } = ctx;
  const code = errorCodeOf(error);
  const message = error instanceof Error ? error.message : null;
  // A crash before the commit retries into the same debt: Stripe replays the
  // stored error for this key.
  const recorded = await deps.db.transaction(async (tx) => {
    const [debt] = await tx
      .update(payoutReversals)
      .set({
        status: 'debt',
        lastErrorCode: code,
        attemptedAt: null,
        resolvedAt: new Date(),
      })
      .where(claimHolds(record))
      .returning();
    if (!debt) return false;
    if (row.userId) {
      await tx
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
    }
    return true;
  });
  if (!recorded) return false;
  if (!row.userId) {
    deps.obs.error('A clawback debt has no payee to record it against', {
      errorId: crypto.randomUUID(),
      chargeId: charge.id,
      ...causeFields(cause),
      payoutId: row.id,
      payoutReversalId: record.id,
      amountCents: record.amountCents,
    });
  }
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
  return true;
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
  db: Client,
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
 * The step's record, for a slice that has none yet (`newStepKind`): inserted
 * once, then read back (a concurrent delivery's insert wins, and is what comes
 * back).
 */
async function ensureRecord(
  ctx: StepContext,
  row: Payout,
  share: number,
  isFinal: boolean
): Promise<PayoutReversal | undefined> {
  const { deps, cause } = ctx;
  const kind = newStepKind(
    row,
    isFinal,
    cause,
    share,
    await takenCents(deps.db, row.id)
  );
  if (!kind) return undefined;
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

/** What the steps recorded against a row take from it (`uncancelledCents`). */
async function takenCents(db: Client, payoutId: string): Promise<number> {
  return uncancelledCents(
    await db
      .select({
        amountCents: payoutReversals.amountCents,
        status: payoutReversals.status,
      })
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, payoutId))
  );
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
  moving?: ClaimedStep
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
 * the share. A failure rolls both back, so the step stays to be retried. It
 * moves only while its delivery's claim holds (`claimHolds`).
 */
async function splitRepaidShare(
  ctx: StepContext,
  slice: Payout,
  share: number,
  moving?: ClaimedStep
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
        .where(claimHolds(moving))
        .returning();
      // Settled, or claimed by another delivery, meanwhile: nothing to move.
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
    const split = splitRepaid(
      cause,
      share,
      debt?.amountCents ?? 0,
      repays,
      steps
    );
    for (const take of split.takes) {
      await tx
        .insert(payoutReversals)
        .values({
          payoutId: take.repayPayoutId,
          causeType: cause.type,
          causeId: cause.id,
          amountCents: take.amountCents,
          kind: take.kind,
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
        split.leftCents > 0
          ? await recordRepaidDebt(tx, slice, cause, split.leftCents)
          : undefined,
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

/** How a cause's share of a re-paid slice splits over its re-pay rows. */
interface RepaidSplit {
  /** The cause's steps to write on the re-pay rows. */
  takes: Array<{
    repayPayoutId: string;
    amountCents: number;
    kind: 'cancellation' | 'pending_reduction';
  }>;
  /** What no unpaid re-pay row can carry: a `slice_repaid` debt if positive. */
  leftCents: number;
}

/**
 * The arithmetic of `splitRepaidShare`, which `planClawback` runs too. Over
 * the slice's re-pay rows, oldest first: a row that already has a step of
 * this cause counts it; an unpaid row carries what its steps have not taken,
 * cancelled when the share takes the rest of it; a paid one carries nothing.
 * `debtCents` is what the cause already left with a person on the slice.
 */
function splitRepaid(
  cause: ClawbackCause,
  share: number,
  debtCents: number,
  repays: readonly Payout[],
  steps: readonly PayoutReversal[]
): RepaidSplit {
  const takes: RepaidSplit['takes'] = [];
  let left = share - debtCents;
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
    const rest = repay.amountCents - uncancelledCents(onRow);
    const take = Math.min(left, rest);
    if (take <= 0) continue;
    left -= take;
    // Held, not cut, while the chargeback is open (owner decision P-2).
    if (cause.type === 'dispute' && !cause.lost) continue;
    takes.push({
      repayPayoutId: repay.id,
      amountCents: take,
      kind: take >= rest ? 'cancellation' : 'pending_reduction',
    });
  }
  return { takes, leftCents: left };
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
 * landed; the re-pay checks it with Stripe instead. A failed refund's re-pay
 * (`repayFailedRefund`) cancels such a step too. True if it cancelled it.
 */
export async function cancelUnclaimedStep(
  db: Client,
  recordId: string
): Promise<boolean> {
  const [cancelled] = await db
    .update(payoutReversals)
    .set({ status: 'cancelled', resolvedAt: new Date() })
    .where(
      and(
        eq(payoutReversals.id, recordId),
        eq(payoutReversals.status, 'pending'),
        isNull(payoutReversals.attemptedAt)
      )
    )
    .returning();
  return cancelled !== undefined;
}

/**
 * Claim a refund's step, unless support has settled the refund
 * `creators_repaid` (Codex-2hxff.28, money MED-1). Its re-pay read the steps
 * once, so a step claimed after it would reach Stripe with nothing to re-pay
 * it, and the clawback then skips the refund for good.
 *
 * The refund's row is read FOR SHARE in the claim's transaction, and the
 * settlement holds it FOR UPDATE, so the two are ordered. A claim that waits
 * sees the resolution once the settlement commits. A claim made first leaves
 * the step leased, and the settlement then refuses
 * (`REFUND_CLAWBACK_UNFINISHED`).
 */
async function claimRefundStep(
  deps: ClawbackDeps,
  recordId: string,
  stripeRefundId: string
): Promise<ClaimedStep | 'repaid' | undefined> {
  return deps.db.transaction(async (tx) => {
    const [refund] = await tx
      .select({ resolution: refunds.resolution })
      .from(refunds)
      .where(eq(refunds.stripeRefundId, stripeRefundId))
      .limit(1)
      .for('share');
    if (refund?.resolution === 'creators_repaid') return 'repaid' as const;
    return claimRecord(tx, recordId);
  });
}

/**
 * One delivery's claim on a step, shared by every copy of the step the run
 * makes (`setKind` copies the row, not this).
 */
interface ClaimRun {
  /**
   * The lease the claim wrote to `attempted_at`, renewed with the cancel of
   * an unpaid slice (`cancelUnpaidSlice`). It is the claim's version. Only
   * this claim wrote it, and every other writer clears or replaces it: a
   * settlement (support's re-pay, a won dispute's), a release (`markFailed`),
   * or another delivery's claim once the lease ran out. The run's own
   * `setKind` keeps it, so the step stays this run's across a change of kind,
   * which `updated_at` would not.
   */
  lease: Date;
  /** This run marked the step done (`markDone`). */
  done: boolean;
  /** `claimLost` ran for this run: runRecord's catch never runs it again. */
  reported: boolean;
}

/** A step a delivery's claim holds: its row, and the claim. */
type ClaimedStep = PayoutReversal & { run: ClaimRun };

/**
 * Take the step's lease, so one delivery works on it at a time. `guard`, when
 * given, must also hold at the moment of the claim.
 */
async function claimRecord(
  db: Client,
  recordId: string,
  guard?: SQL
): Promise<ClaimedStep | undefined> {
  const now = new Date();
  const leaseStart = new Date(
    now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000
  );
  const [claimed] = await db
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
  return claimed
    ? { ...claimed, run: { lease: now, done: false, reported: false } }
    : undefined;
}

/**
 * The step is still as the delivery's claim left it: the compare-and-set
 * every write the delivery makes to its step carries (Codex-2hxff.72; owner
 * decision 2026-10-27, "Never overwrite; hold for support"). A delivery that
 * outlived its lease therefore never changes a step another path has settled,
 * nor one another delivery has claimed since.
 */
function claimHolds(step: ClaimedStep): SQL {
  return sql`${payoutReversals.id} = ${step.id} AND ${payoutReversals.attemptedAt} = ${step.run.lease} AND ${payoutReversals.status} IN ('pending', 'failed')`;
}

function doneFields(now: Date) {
  return {
    status: 'done' as const,
    lastErrorCode: null,
    attemptedAt: null,
    resolvedAt: now,
  };
}

/** Done, and the lease released. False if the claim no longer holds. */
async function markDone(
  deps: ClawbackDeps,
  record: ClaimedStep,
  stripeReversalId?: string
): Promise<boolean> {
  const [done] = await deps.db
    .update(payoutReversals)
    .set({
      ...doneFields(new Date()),
      ...(stripeReversalId ? { stripeReversalId } : {}),
    })
    .where(claimHolds(record))
    .returning();
  if (done) record.run.done = true;
  return done !== undefined;
}

/**
 * Failed, and the lease released. `advance` moves the key to a new attempt.
 * False if the claim no longer holds.
 */
async function markFailed(
  deps: ClawbackDeps,
  record: ClaimedStep,
  code: string,
  advance: boolean
): Promise<boolean> {
  const [failed] = await deps.db
    .update(payoutReversals)
    .set({
      status: 'failed',
      lastErrorCode: code,
      attemptedAt: null,
      ...(advance ? { attempt: sql`${payoutReversals.attempt} + 1` } : {}),
    })
    .where(claimHolds(record))
    .returning();
  return failed !== undefined;
}

/** The step, now of `kind`, still claimed; undefined if the claim no longer holds. */
async function setKind(
  deps: ClawbackDeps,
  record: ClaimedStep,
  kind: PayoutReversalKind
): Promise<ClaimedStep | undefined> {
  const [changed] = await deps.db
    .update(payoutReversals)
    .set({ kind })
    .where(claimHolds(record))
    .returning();
  return changed ? { ...record, kind } : undefined;
}

/** The note on a `transfer_kept` credit, which is born resolved. */
const TRANSFER_KEPT_NOTE = 'The payee kept the transfer for this share';

/**
 * A late effect of one step, for support's "Owed to creators"
 * (Codex-2hxff.73, owner decision Q10; data design §7.1).
 */
export interface PayeeCreditFinding {
  payoutReversalId: string;
  /** The step's own payout: its payee is who is owed. */
  payout: Pick<Payout, 'id' | 'userId'>;
  effect: PayeeCreditEffect;
  /** What Stripe took, or the cancelled share; null while unverified. */
  amountCents: number | null;
  stripeReversalId?: string | null;
  stripeTransferId?: string | null;
  /** The step's status when the effect was found. */
  settledAs: PayeeCreditSettledAs;
  /** The errorId of the alert that found it. */
  alertErrorId: string;
}

/** What `recordPayeeCredit` did with a finding (review MED-1). */
export type PayeeCreditWrite =
  /** Written: a new row, or an open `unverified` row upgraded. */
  | { kind: 'recorded'; credit: PayeeCredit }
  /**
   * A confirmed take-back met a row the SYSTEM had closed as not owed (a
   * born-resolved `transfer_kept`, or a check's not owed): reopened as owed,
   * for what Stripe took (owner decision 2026-10-28, "Reopen if the system
   * closed it"). `was` is the row as it stood.
   */
  | { kind: 'reopened'; credit: PayeeCredit; was: PayeeCredit }
  /**
   * A confirmed take-back met a row a PERSON settled: their decision stands,
   * and a person reopens it by hand if it must change.
   */
  | { kind: 'person_settled'; credit: PayeeCredit }
  /**
   * Left as it was, because the row already says as much: an unverified
   * finding on any row, a confirmed one on an open confirmed row, or a kept
   * transfer on any row but an open unverified one.
   */
  | { kind: 'unchanged'; credit: PayeeCredit };

/**
 * Record a late effect as a `payee_credits` row: one per step. A confirmed
 * finding upgrades an open `unverified` row; an unverified one never changes
 * any. A `transfer_kept` row is born resolved `not_owed` by the system: the
 * payee kept the money.
 *
 * A confirmed take-back (`reversal_landed`, `slice_cancelled`) that meets a
 * row the system closed reopens it as owed, compare-and-set on that closed
 * state; one a person closed is left as their decision (review MED-1). It
 * never matches nothing silently: the caller reports what this returns
 * (`reportPayeeCreditWrite`).
 */
export async function recordPayeeCredit(
  db: Client,
  finding: PayeeCreditFinding
): Promise<PayeeCreditWrite> {
  const now = new Date();
  const kept = finding.effect === 'transfer_kept';
  const values = {
    payoutReversalId: finding.payoutReversalId,
    payoutId: finding.payout.id,
    payeeUserId: finding.payout.userId,
    effect: finding.effect,
    amountCents: finding.amountCents,
    stripeReversalId: finding.stripeReversalId ?? null,
    stripeTransferId: finding.stripeTransferId ?? null,
    settledAs: finding.settledAs,
    alertErrorId: finding.alertErrorId,
    resolution: kept ? ('not_owed' as const) : null,
    resolvedAt: kept ? now : null,
    resolutionNote: kept ? TRANSFER_KEPT_NOTE : null,
  };
  const insert = db.insert(payeeCredits).values(values);
  const found = {
    effect: values.effect,
    amountCents: values.amountCents,
    stripeReversalId:
      values.stripeReversalId ?? sql`${payeeCredits.stripeReversalId}`,
    stripeTransferId:
      values.stripeTransferId ?? sql`${payeeCredits.stripeTransferId}`,
    settledAs: values.settledAs,
    alertErrorId: values.alertErrorId,
    resolution: values.resolution,
    resolvedAt: values.resolvedAt,
    resolutionNote: values.resolutionNote,
    updatedAt: now,
  };
  const [written] =
    finding.effect === 'unverified'
      ? await insert
          .onConflictDoNothing({ target: payeeCredits.payoutReversalId })
          .returning()
      : await insert
          .onConflictDoUpdate({
            target: payeeCredits.payoutReversalId,
            set: found,
            where: sql`${payeeCredits.effect} = 'unverified' AND ${payeeCredits.resolvedAt} IS NULL`,
          })
          .returning();
  if (written) return { kind: 'recorded', credit: written };

  // The step's row already says something: read it, never assume.
  const current = await payeeCreditOfStep(db, finding.payoutReversalId);
  const owed =
    finding.effect === 'reversal_landed' ||
    finding.effect === 'slice_cancelled';
  if (!owed || current.resolvedAt === null) {
    return { kind: 'unchanged', credit: current };
  }
  if (current.resolution !== 'not_owed' || current.resolvedByUserId !== null) {
    return { kind: 'person_settled', credit: current };
  }
  const [reopened] = await db
    .update(payeeCredits)
    .set({ ...found, resolvedByUserId: null })
    .where(
      and(
        eq(payeeCredits.id, current.id),
        eq(payeeCredits.resolution, 'not_owed'),
        isNotNull(payeeCredits.resolvedAt),
        isNull(payeeCredits.resolvedByUserId)
      )
    )
    .returning();
  if (reopened) return { kind: 'reopened', credit: reopened, was: current };
  // Another delivery reopened it first: as it stands now.
  return {
    kind: 'unchanged',
    credit: await payeeCreditOfStep(db, finding.payoutReversalId),
  };
}

async function payeeCreditOfStep(
  db: Client,
  payoutReversalId: string
): Promise<PayeeCredit> {
  const [credit] = await db
    .select()
    .from(payeeCredits)
    .where(eq(payeeCredits.payoutReversalId, payoutReversalId))
    .limit(1);
  // The write matched a row on this step, or it would have inserted one.
  if (!credit) {
    throw new InternalServiceError(
      'A payee credit was neither written nor found',
      { payoutReversalId }
    );
  }
  return credit;
}

/**
 * Log what `recordPayeeCredit` did when it did not simply write (review
 * MED-1): a reopen, a person's decision left standing (an error under the
 * finding's alert, for a person to reopen by hand), or a finding that changed
 * nothing.
 */
export function reportPayeeCreditWrite(
  obs: ClawbackDeps['obs'],
  finding: Pick<
    PayeeCreditFinding,
    'effect' | 'amountCents' | 'alertErrorId' | 'stripeReversalId'
  >,
  write: PayeeCreditWrite,
  ids: Record<string, string>
): void {
  if (write.kind === 'recorded') return;
  const facts = {
    ...ids,
    creditId: write.credit.id,
    alertErrorId: finding.alertErrorId,
    findingEffect: finding.effect,
    findingAmountCents: finding.amountCents,
    stripeReversalId: finding.stripeReversalId ?? null,
    creditEffect: write.credit.effect,
    creditResolution: write.credit.resolution,
  };
  if (write.kind === 'person_settled') {
    obs.error(
      'A confirmed take-back met a settled credit: reopen by hand. Support settled it before Stripe confirmed what was taken, so their decision stands',
      { ...facts, errorId: finding.alertErrorId }
    );
  } else if (write.kind === 'reopened') {
    obs.warn(
      'A confirmed take-back reopened a credit the system had closed as not owed: owed again, in Owed to creators',
      {
        ...facts,
        wasEffect: write.was.effect,
        wasNote: write.was.resolutionNote,
        amountCents: write.credit.amountCents,
      }
    );
  } else if (finding.effect === 'unverified') {
    obs.info('An unconfirmed late take-back left its credit as it was', facts);
  } else {
    obs.warn(
      'A late take-back left its credit as it was: the row already says as much',
      facts
    );
  }
}

/**
 * What a cancelled slice's payee is owed (data design §7.3): what the drain
 * would have paid, the slice less its done reductions.
 */
export async function cancelledShareOf(
  db: Client,
  slice: Pick<Payout, 'id' | 'amountCents'>
): Promise<number> {
  const reduced = (await pendingReductionsFor(db, [slice.id])).get(slice.id);
  return slice.amountCents - (reduced ?? 0);
}

/**
 * `claimLost`'s queue write: after its alert, and never throwing. A failure,
 * of the write or of the reads that build it, is logged under the alert's own
 * errorId, since a redelivery never reaches `claimLost` again for a settled
 * step (`clawBackShare`).
 */
async function queueForSupport(
  ctx: StepContext,
  ids: Record<string, string>,
  alertErrorId: string,
  finding: () =>
    | Promise<PayeeCreditFinding | undefined>
    | PayeeCreditFinding
    | undefined
): Promise<void> {
  try {
    const found = await finding();
    if (found) {
      reportPayeeCreditWrite(
        ctx.deps.obs,
        found,
        await recordPayeeCredit(ctx.deps.db, found),
        ids
      );
    }
  } catch (error) {
    ctx.deps.obs.error(
      `${causeLabel(ctx.cause)} clawback: this late take-back could not be queued for support; it is in this alert only`,
      {
        errorId: alertErrorId,
        ...ids,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

/**
 * What a delivery had already done to the payee when a write found its claim
 * gone (`claimLost`).
 */
interface Taken {
  /** The transfer the step reversed, or tried to. */
  transferId?: string;
  /** The reversal Stripe made for the step. */
  reversal?: { id: string; amount: number };
  /** Stripe's answer was lost: ask it whether the step's reversal landed. */
  ask?: boolean;
  /** The delivery cancelled the unpaid slice (`cancelUnpaidSlice`). */
  cancelledSlice?: boolean;
  /** Stripe refused the reversal. */
  refused?: boolean;
  /**
   * A refused reversal of a cancelled slice's late transfer, with the transfer
   * known to be still with the payee: refused for the balance, or Stripe read
   * it as not reversed. Only then is the payee's credit born closed as not
   * owed (`transfer_kept`); a refusal Stripe could not confirm is queued for a
   * check instead.
   */
  keptConfirmed?: boolean;
  /**
   * Stripe could not be asked whether a transfer went out for the cancelled
   * slice (`lateTransferOf`, `unknown`).
   */
  lateTransferUnknown?: boolean;
  /** The error the step's last attempt got, for the logs. */
  error?: unknown;
}

/**
 * A write the delivery made under its claim found the claim gone, because the
 * delivery outlived its lease. The step is never overwritten (owner decision
 * 2026-10-27, "Never overwrite; hold for support"):
 *
 * - another delivery holds it now, or a retry is due: that one runs on with
 *   the same key, so Stripe gives it the answer it gave this one;
 * - it is `done` with what this delivery took, or with nothing this delivery
 *   knows of: `done` records the step's outcome. One attempt at most lands,
 *   since the attempt advances only after Stripe refused one;
 * - it is settled, and this delivery took nothing: left as it is. When
 *   Stripe's answer was lost and Stripe lists no reversal yet, that outcome
 *   is unconfirmed, and the warning says so;
 * - it is settled, and this delivery took money from the payee anyway (a
 *   reversal that LANDED, or the unpaid slice it cancelled, with no transfer
 *   or one reversed in full): ONE error alert names the payee, the amount and
 *   the cause, for support to re-pay, and the reversal's id is recorded on a
 *   step that is not `done` and names none. Nothing else on the step changes,
 *   and nothing is re-paid automatically;
 * - it is settled, the delivery cancelled the unpaid slice, and Stripe refused
 *   to reverse the transfer that went out for it: the payee still holds that
 *   transfer. A different error alert says so, and NOT to re-pay: the slice is
 *   reconciled instead;
 * - it is settled, the delivery cancelled the unpaid slice, and what went out
 *   for it is unconfirmed (the reversal's answer was lost and Stripe lists
 *   none, or Stripe could not be asked about a transfer): that alert says to
 *   check Stripe, and what each finding means. It never says outright not to
 *   re-pay, since a late landing would then leave the payee short.
 *
 * When Stripe's answer was lost (`ask`), Stripe is asked whether the reversal
 * landed. If Stripe cannot be asked, or the step cannot be read when this
 * delivery may have taken money, that is an error alert too. It runs once per
 * run (`ClaimRun.reported`), so its alert is never raised twice.
 */
async function claimLost(
  ctx: StepContext,
  row: Payout,
  step: ClaimedStep,
  taken: Taken = {}
): Promise<StepResult> {
  const { deps, charge, cause } = ctx;
  step.run.reported = true;
  const ids = {
    chargeId: charge.id,
    ...causeFields(cause),
    payoutId: row.id,
    payoutReversalId: step.id,
  };
  const transferId = taken.transferId ?? row.stripeTransferId;
  const attemptError =
    taken.error === undefined
      ? {}
      : {
          code: errorCodeOf(taken.error),
          error:
            taken.error instanceof Error
              ? taken.error.message
              : String(taken.error),
        };

  let current: PayoutReversal | undefined;
  try {
    [current] = await deps.db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.id, step.id))
      .limit(1);
  } catch (readError) {
    // The alert is raised here or not at all: runRecord's catch, which gets
    // this error next, does not run this again.
    if (taken.reversal || taken.ask || taken.cancelledSlice) {
      const errorId = crypto.randomUUID();
      deps.obs.error(
        taken.reversal
          ? `${causeLabel(cause)} clawback: a reversal landed under a lost claim; the step could not be read; check by hand`
          : `${causeLabel(cause)} clawback: a step's claim was lost after it may have taken money; the step could not be read; check by hand`,
        {
          errorId,
          ...ids,
          creatorUserId: row.userId,
          amountCents: taken.reversal?.amount ?? step.amountCents,
          stripeReversalId: taken.reversal?.id ?? null,
          stripeTransferId: transferId,
          cancelledSlice: taken.cancelledSlice === true,
          error:
            readError instanceof Error ? readError.message : String(readError),
        }
      );
      // Best effort: the database is probably down, and the alert is the
      // fallback. Only a step settled by now is queued; one another
      // delivery holds is that delivery's to finish.
      await queueForSupport(ctx, ids, errorId, async () => {
        const [now] = await deps.db
          .select()
          .from(payoutReversals)
          .where(eq(payoutReversals.id, step.id))
          .limit(1);
        if (!now || !isSettled(now)) return undefined;
        // Its own reversal, or nothing taken: as the read below decides.
        if (
          now.status === 'done' &&
          (!taken.reversal || now.stripeReversalId === taken.reversal.id)
        ) {
          return undefined;
        }
        return {
          payoutReversalId: step.id,
          payout: row,
          effect: 'unverified',
          amountCents: null,
          stripeReversalId: taken.reversal?.id,
          stripeTransferId: transferId,
          settledAs: now.status,
          alertErrorId: errorId,
        };
      });
    }
    throw readError;
  }
  if (!current || !isSettled(current)) {
    deps.obs.warn(
      `${causeLabel(cause)} clawback: another delivery took this step over after the lease ran out; left to it`,
      {
        ...ids,
        status: current?.status ?? null,
        stripeReversalId: taken.reversal?.id ?? null,
        ...attemptError,
      }
    );
    return {};
  }
  const settled = current;
  const settledAs = settled.status;
  /** An unverified credit, for "Check Stripe again". */
  const unverified = (errorId: string, stripeTransferId?: string | null) =>
    queueForSupport(ctx, ids, errorId, () => ({
      payoutReversalId: step.id,
      payout: row,
      effect: 'unverified',
      amountCents: null,
      stripeTransferId,
      settledAs,
      alertErrorId: errorId,
    }));
  const leftAsSettled = async (unconfirmed = false) => {
    // With an errorId when unconfirmed: it is queued for support to check
    // Stripe again (owner decision OQ3), and the row joins its log line.
    const errorId = unconfirmed ? crypto.randomUUID() : undefined;
    deps.obs.warn(
      unconfirmed
        ? `${causeLabel(cause)} clawback: this step was settled while its delivery ran, and its reversal's outcome is unconfirmed: Stripe lists none for it yet, and one still in flight could land`
        : `${causeLabel(cause)} clawback: this step was settled while its delivery ran; left as it is`,
      {
        ...(errorId ? { errorId } : {}),
        ...ids,
        status: settled.status,
        stripeReversalId: taken.reversal?.id ?? null,
        stripeTransferId: transferId,
        ...attemptError,
      }
    );
    if (errorId) await unverified(errorId, transferId);
    return {};
  };
  if (
    settled.status === 'done' &&
    (!taken.reversal || settled.stripeReversalId === taken.reversal.id)
  ) {
    return leftAsSettled();
  }

  let reversal = taken.reversal;
  if (!reversal && taken.ask && transferId) {
    try {
      reversal = await findLandedReversal(deps, transferId, step.id);
    } catch (error) {
      const errorId = crypto.randomUUID();
      deps.obs.error(
        `${causeLabel(cause)} clawback: a step was settled by another path while its reversal was at Stripe, and Stripe could not be asked whether it landed. Check it by hand`,
        {
          errorId,
          ...ids,
          creatorUserId: row.userId,
          amountCents: step.amountCents,
          settledAs: settled.status,
          stripeTransferId: transferId,
          ...attemptError,
          lookupError: error instanceof Error ? error.message : String(error),
        }
      );
      await unverified(errorId, transferId);
      return {};
    }
  }
  const unconfirmed = !reversal && taken.ask === true;

  // A cancelled slice under a settled step, with no reversal of ours known:
  // what the payee is owed turns on a transfer, so the alert says what is
  // known, and never more. A late landing must not leave them short on our
  // word, nor a re-pay pay them twice.
  const kept =
    taken.refused === true &&
    taken.keptConfirmed === true &&
    transferId !== null;
  const heldMessage =
    !reversal && taken.cancelledSlice
      ? kept
        ? 'slice cancelled under a settled step; its transfer is still with the payee and was NOT reversed; do not re-pay; reconcile the slice'
        : taken.refused && transferId
          ? 'slice cancelled under a settled step; Stripe refused its transfer reversal and could not say whether the transfer is reversed, outcome unconfirmed: check Stripe. If it was reversed, the payee is owed the slice back; if not, reconcile the slice and do not re-pay'
          : unconfirmed && transferId
            ? 'slice cancelled under a settled step; its transfer reversal outcome unconfirmed: check Stripe. If a reversal of this transfer exists, the payee is owed it back; if not, reconcile the slice and do not re-pay'
            : taken.lateTransferUnknown
              ? 'slice cancelled under a settled step; Stripe could not say whether a transfer went out for it, outcome unconfirmed: check Stripe. If none went out, or one went out and was reversed, the payee is owed the slice back; if one went out and was not reversed, reconcile the slice and do not re-pay'
              : undefined
      : undefined;
  if (heldMessage) {
    const errorId = crypto.randomUUID();
    deps.obs.error(`${causeLabel(cause)} clawback: ${heldMessage}`, {
      errorId,
      ...ids,
      creatorUserId: row.userId,
      amountCents: step.amountCents,
      settledAs: settled.status,
      stripeTransferId: transferId,
      unconfirmed: !kept,
      ...attemptError,
    });
    // Kept: not owed, so born resolved. Otherwise support checks Stripe.
    if (kept) {
      await queueForSupport(ctx, ids, errorId, () => ({
        payoutReversalId: step.id,
        payout: row,
        effect: 'transfer_kept',
        amountCents: null,
        stripeTransferId: transferId,
        settledAs,
        alertErrorId: errorId,
      }));
    } else {
      await unverified(errorId, transferId);
    }
    return {};
  }
  if (!reversal && !taken.cancelledSlice) return leftAsSettled(unconfirmed);

  const errorId = crypto.randomUUID();
  deps.obs.error(
    `${causeLabel(cause)} clawback took money from a payee under a step another path had already settled; held for support to re-pay`,
    {
      errorId,
      ...ids,
      creatorUserId: row.userId,
      amountCents: reversal?.amount ?? step.amountCents,
      settledAs: settled.status,
      stripeReversalId: reversal?.id ?? null,
      // What the step already names, if anything: never overwritten.
      recordedReversalId: settled.stripeReversalId,
      stripeTransferId: transferId,
      cancelledSlice: taken.cancelledSlice === true,
    }
  );
  // Owed what Stripe took (Q9), never the step's amount; or, for the
  // cancelled slice, what the drain would have paid.
  await queueForSupport(ctx, ids, errorId, async () => ({
    payoutReversalId: step.id,
    payout: row,
    ...(reversal
      ? {
          effect: 'reversal_landed' as const,
          amountCents: reversal.amount,
          stripeReversalId: reversal.id,
        }
      : {
          effect: 'slice_cancelled' as const,
          amountCents: await cancelledShareOf(deps.db, row),
        }),
    stripeTransferId: transferId,
    settledAs,
    alertErrorId: errorId,
  }));
  if (reversal && settled.status !== 'done' && !settled.stripeReversalId) {
    // The record that it landed: the case support finds by
    // `status <> 'done' AND stripe_reversal_id IS NOT NULL`. Only that column
    // is written; status, amount and the re-pay link stay as the other path
    // left them. A `done` step is left alone, since the reversal would read
    // as its own: the alert alone names it.
    try {
      await deps.db
        .update(payoutReversals)
        .set({ stripeReversalId: reversal.id })
        .where(
          and(
            eq(payoutReversals.id, step.id),
            ne(payoutReversals.status, 'done'),
            isNull(payoutReversals.stripeReversalId)
          )
        );
    } catch (recordError) {
      // Under the alert's own errorId: one alert for one landing.
      deps.obs.error(
        `${causeLabel(cause)} clawback: the landed reversal could not be recorded on its step, so support's query will not find it; record it by hand`,
        {
          errorId,
          ...ids,
          stripeReversalId: reversal.id,
          error:
            recordError instanceof Error
              ? recordError.message
              : String(recordError),
        }
      );
      throw recordError;
    }
  }
  return {};
}

/**
 * The reversal Stripe made for this step, if any: every reversal the engine
 * makes names its step in `payout_reversal_id`, whatever its attempt.
 */
export async function findLandedReversal(
  deps: ClawbackDeps,
  transferId: string,
  payoutReversalId: string
): Promise<{ id: string; amount: number } | undefined> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await deps.stripe.transfers.listReversals(transferId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = page.data.find(
      (reversal) => reversal.metadata?.payout_reversal_id === payoutReversalId
    );
    if (found) return { id: found.id, amount: found.amount };
    const last = page.data.at(-1);
    if (!page.has_more || !last) return undefined;
    startingAfter = last.id;
  }
}

/**
 * Stripe answered and refused: a 4xx other than a conflict (409, a concurrent
 * request with the same key) or a rate limit (429). Stripe stores that answer
 * for the key, so only a new key can succeed.
 */
export function isDefinitiveStripeError(error: unknown): boolean {
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
