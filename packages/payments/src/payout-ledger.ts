/**
 * The payouts ledger's write path — every slice of every sale goes through
 * here (Codex-2hxff.11, .12, .37).
 *
 * The rules (docs/payments/connect-and-payouts.md#the-payouts-ledger):
 *
 * - **Exactly one row per slice per charge.** The row is RESERVED before any
 *   money moves: an INSERT … ON CONFLICT DO NOTHING against
 *   `uq_payouts_org_slice_per_charge` / `uq_payouts_creator_slice_per_charge`
 *   / `uq_payouts_platform_fee_per_charge`. A replayed webhook finds the row
 *   and transfers nothing, however long after the first delivery it arrives.
 *   (The writers used to transfer first and insert after, so a failed insert
 *   left money moved with no row, and a replay past Stripe's ~24h idempotency
 *   window paid again.)
 * - **A transfer and its row never disagree for long.** A reserved row is
 *   `pending` with no reason while its transfer is in flight. If the transfer
 *   succeeds but the row cannot be marked paid, it stays that way; before a
 *   drain re-sends any row it looks the transfer up in Stripe by the
 *   `payout_id` metadata (`findTransfersForPayouts`), on every Connect account
 *   the payee has had, so it settles the row instead of paying twice.
 * - **A refund freezes the row, then asks Stripe.** It cancels a pending or
 *   failed row first, so nothing can settle it afterwards, then looks for a
 *   transfer that went out anyway and reverses it
 *   (`cancelUnpaidPayout`). A transfer that lands after the cancel
 *   finds its row cancelled and is reversed by whoever sent it
 *   (`settleTransfer`).
 * - **A failed transfer stays payable.** It keeps its charge id and is retried
 *   by the drains — if this ledger made the attempt. A row the old write
 *   paths marked failed has no attempt on record (`last_retry_at` NULL) and
 *   its transfer may have landed under metadata no lookup can match, so it
 *   is left for a person to reconcile (release checklist R6).
 * - **A transfer Stripe keeps refusing waits for support** (Codex-2hxff.48).
 *   The row records Stripe's code and type. A refusal that cannot succeed on
 *   a retry, or the `MAX_PAYOUT_FAILURES`th refusal, flags it
 *   (`needs_review_at`) and the drains stop; an outage never uses an attempt.
 *   It stays `failed`, so it is still owed (`markPayoutFailed`).
 * - **Nothing is dropped.** A slice whose payee cannot be paid yet is a
 *   pending row in their name; the organisation's slices while it has no
 *   owner are pending `no_owner` rows with no payee, handed to the next owner
 *   (owner decision 2026-10-18). A slice recorded while a dispute holds its
 *   sale is pending too, and is paid by the drains once the dispute is won or
 *   closed (`isDrainablePayout`).
 *
 * Errors: a failed INSERT is thrown, not logged and swallowed — the webhook
 * answers by its cause (a database outage → 500, Stripe retries, and the
 * slices already reserved are skipped on the retry). A failed transfer is
 * recorded as a `failed` row and the call returns normally.
 */

import {
  CURRENCY,
  DISPUTE_CLOSED_STATUSES,
  stripeEnvMetadata,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  disputes,
  type Payout,
  payoutReversals,
  payouts,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  InternalServiceError,
  UnsupportedCurrencyError,
} from '@codex/service-errors';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type Stripe from 'stripe';

/** The subset of `ObservabilityClient` the ledger logs through. */
interface LedgerLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
}

export interface LedgerDeps {
  db: DatabaseClient;
  stripe: Stripe;
  obs: LedgerLogger;
  /** Tags every transfer with `codex_env` (Codex-2hxff.5). */
  environment: string;
}

export type SlicePayoutType =
  | 'creator_payout'
  | 'organization_fee'
  | 'creator_payout_to_owner';

/** Why a reserved row is left pending instead of transferred. */
export type PendingReason =
  | 'connect_not_ready'
  | 'connect_restricted'
  | 'min_transfer_floor'
  | 'no_owner';

export type SliceSource =
  | { sourceType: 'purchase'; purchaseId: string }
  | { sourceType: 'subscription'; subscriptionId: string }
  | { sourceType: 'subscription'; courseSubscriptionId: string };

export interface SlicePayee {
  userId: string;
  /** Their Connect account; absent until they start onboarding. */
  account:
    | { stripeAccountId: string; chargesEnabled: boolean }
    | null
    | undefined;
}

export interface RecordSliceInput {
  payoutType: SlicePayoutType;
  amountCents: number;
  organizationId: string | null;
  source: SliceSource;
  stripeChargeId: string;
  transferGroup: string;
  /**
   * Also pass `transfer_group` to Stripe. Subscription invoices do; a
   * purchase must not — its charge already has a group, and Stripe rejects a
   * second one alongside `source_transaction`.
   */
  sendTransferGroup: boolean;
  /**
   * Who is paid. `null` only for the organisation's slices while it has no
   * owner — they are held as `no_owner` (Codex-2hxff.37).
   */
  payee: SlicePayee | null;
  /** Hold as pending even when payable: below the payee's minimum transfer. */
  hold?: 'min_transfer_floor';
  /**
   * The transfer's idempotency key — the per-slice keys in
   * docs/payments/connect-and-payouts.md#transfers. Deterministic, never
   * random: a retry within Stripe's window must collapse to one transfer.
   */
  idempotencyKey: string;
  /** Extra transfer metadata (source ids for support). */
  metadata: Record<string, string>;
  /**
   * The creator agreement this slice was split by, recorded on the row
   * (Codex-2hxff.19: "the purchase or invoice records which agreement it
   * used"). Creator slices only; absent for every other slice.
   */
  creatorOrgAgreementId?: string | null;
}

export type RecordSliceOutcome =
  /** A replay: the slice is already in the ledger. Nothing was sent. */
  | { kind: 'exists' }
  | { kind: 'pending'; payoutId: string; reason: PendingReason }
  /**
   * Payable, but its sale is held by a dispute or inquiry (`isDrainablePayout`):
   * the row is pending and nothing was sent. The drains pay it once the
   * dispute is won or closed (owner decision Q1, Codex-2hxff.59).
   */
  | { kind: 'held'; payoutId: string }
  | { kind: 'paid'; payoutId: string; transferId: string }
  /** The transfer failed; the row is `failed` and the drains retry it. */
  | { kind: 'failed'; payoutId: string }
  /**
   * The transfer was made but the row could not be marked paid. It stays
   * pending and the next drain settles it from Stripe — never re-sends it.
   */
  | { kind: 'unsettled'; payoutId: string; transferId: string }
  /**
   * The transfer was made, but a refund cancelled the row while it was in
   * flight: it was reversed (`reversed`), or could not be and is logged for
   * a person to reverse.
   */
  | {
      kind: 'surplus';
      payoutId: string;
      transferId: string;
      reversed: boolean;
    };

/** The statuses a transfer may still settle. */
const DRAINABLE: Array<'pending' | 'failed'> = ['pending', 'failed'];

/**
 * The rows a drain may send: pending, or failed by an attempt this ledger
 * made. Every attempt it makes stamps `last_retry_at` (the reserve before
 * the first transfer, each claim after); the write paths before
 * Codex-2hxff.11 never did. Their failed rows are excluded: the transfer
 * they recorded as failed may have landed — a timeout, a reset connection —
 * under metadata with no `payout_id`, so no lookup can find it, and sending
 * again could pay twice.
 *
 * A row is also HELD while its sale has an open dispute or inquiry, by charge
 * or, for a row recorded before charge ids, by purchase (owner decisions P-2
 * and Q1, Codex-2hxff.9). A won or closed dispute releases it. A lost one
 * keeps holding it until the loss is applied (`outcome_applied_at`), which
 * cancels it (`cancelled_by_dispute`) or reduces it: released any earlier, a
 * drain could pay a slice the buyer's bank has already taken back.
 *
 * A re-pay row (a won dispute paying a reversal back) has no charge id, so it
 * is held through the slice it re-pays: while THAT slice's charge has a
 * dispute holding it — a second dispute of the same charge, which Stripe
 * allows (Codex-2hxff.59). It is also held while the dispute that re-paid it
 * is `won` but its outcome is not applied yet (`outcome_applied_at`): the
 * win's follow-up, a refund's share taken off the re-pay row, may have failed
 * and be waiting for its retry, and a drain must not pay the row in full
 * first. `repaid_by_payout_id` is unique-indexed, so this costs one index
 * probe per row.
 *
 * A row flagged for support (`needs_review_at`, Codex-2hxff.48) is skipped
 * until support releases it. It is still `failed`, so a refund still cancels
 * it and earnings still count it as owed: they key on the status, not this.
 */
export function isDrainablePayout(): SQL {
  // In the second subquery the slice re-paid is aliased, so `payouts` there
  // still names the outer row.
  return sql`((${payouts.status} = 'pending' OR (${payouts.status} = 'failed' AND ${payouts.lastRetryAt} IS NOT NULL)) AND ${payouts.needsReviewAt} IS NULL AND NOT EXISTS (SELECT 1 FROM ${disputes} WHERE ${holdsItsSale()} AND (${disputes.stripeChargeId} = ${payouts.stripeChargeId} OR ${disputes.purchaseId} = ${payouts.purchaseId})) AND NOT EXISTS (SELECT 1 FROM ${payoutReversals} JOIN ${payouts} AS repaid_slice ON repaid_slice.id = ${payoutReversals.payoutId} JOIN ${disputes} ON (${disputes.stripeChargeId} = repaid_slice.stripe_charge_id OR ${disputes.stripeDisputeId} = ${payoutReversals.causeId}) WHERE ${payoutReversals.repaidByPayoutId} = ${payouts.id} AND (${holdsItsSale()} OR (${disputes.stripeDisputeId} = ${payoutReversals.causeId} AND ${disputes.status} = 'won' AND ${disputes.outcomeAppliedAt} IS NULL))))`;
}

/**
 * A dispute that holds its sale's unpaid slices: open, an inquiry included,
 * or lost with its loss not yet applied. See `isDrainablePayout`.
 */
function holdsItsSale(): SQL {
  return sql`(${notInArray(disputes.status, [...DISPUTE_CLOSED_STATUSES])} OR (${disputes.status} = 'lost' AND ${disputes.outcomeAppliedAt} IS NULL))`;
}

/**
 * Whether a dispute holds this sale now, by the drains' own rule: a slice
 * recorded while it does is left pending, not sent (owner decision Q1, "the
 * sale's pending slices held"; Codex-2hxff.59). Sent, an inquiry's slice
 * would be paid at once, and a chargeback's sent at gross only to be
 * reversed. Asked only when one of `inputs` could be sent at once; they are
 * one sale's slices.
 */
async function saleIsHeld(
  db: DatabaseClient | Tx,
  inputs: readonly RecordSliceInput[]
): Promise<boolean> {
  const sendable = inputs.find(
    (input) => input.amountCents > 0 && pendingReasonFor(input) === null
  );
  if (!sendable) return false;
  const { stripeChargeId, source } = sendable;
  const sameSale =
    'purchaseId' in source
      ? sql`(${disputes.stripeChargeId} = ${stripeChargeId} OR ${disputes.purchaseId} = ${source.purchaseId})`
      : eq(disputes.stripeChargeId, stripeChargeId);
  const [holding] = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(holdsItsSale(), sameSale))
    .limit(1);
  return holding !== undefined;
}

/**
 * The ON CONFLICT arbiter for a slice: exactly its own per-charge index. A
 * conflict there IS the replay. A violation of any other unique index still
 * throws, instead of reading as "already recorded".
 */
function sliceConflictTarget(payoutType: SlicePayoutType) {
  if (payoutType === 'creator_payout') {
    return {
      target: [payouts.stripeChargeId, payouts.userId],
      where: sql`${payouts.stripeChargeId} IS NOT NULL AND ${payouts.payoutType} = 'creator_payout'`,
    };
  }
  return {
    target: [payouts.stripeChargeId, payouts.payoutType],
    where: sql`${payouts.stripeChargeId} IS NOT NULL AND ${payouts.payoutType} IN ('organization_fee', 'creator_payout_to_owner')`,
  };
}

function sourceColumns(source: SliceSource) {
  if ('purchaseId' in source) return { purchaseId: source.purchaseId };
  if ('subscriptionId' in source) {
    return { subscriptionId: source.subscriptionId };
  }
  return { courseSubscriptionId: source.courseSubscriptionId };
}

function pendingReasonFor(input: RecordSliceInput): PendingReason | null {
  if (input.payee === null) return 'no_owner';
  if (input.hold) return input.hold;
  if (!input.payee.account) return 'connect_not_ready';
  if (!input.payee.account.chargesEnabled) return 'connect_restricted';
  return null;
}

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * Record one slice of a sale in the ledger and, when its payee can be paid,
 * transfer it. Returns `null` for a zero amount (nothing to record).
 */
export async function recordSlice(
  deps: LedgerDeps,
  input: RecordSliceInput
): Promise<RecordSliceOutcome | null> {
  const held = await saleIsHeld(deps.db, [input]);
  const reserved = await reserveSlice(deps.db, input, held);
  if (reserved === null) return null;
  if (reserved === 'exists') {
    await reportReplayMismatch(deps, input);
    return { kind: 'exists' };
  }
  return sendReservedSlice(deps, reserved, input, held);
}

/**
 * Record a sale's whole split ONCE: every slice but the platform fee
 * (Codex-2hxff.62; owner decision 2026-10-21, "Keep its first split").
 *
 * The slices are reserved together, in one transaction that holds a lock on
 * the charge. If the charge already has any slice, an earlier delivery
 * decided its split: a slice it recorded stands, and nothing is added on top
 * of it. That covers a redelivery after an agreement is accepted and
 * backdated to its proposal, which would otherwise find a creator in force
 * who was not paid the first time, and pay them on top of the owner. A row
 * that was reserved but never sent (the delivery died) is left to the drains,
 * as for `recordSlice`. A replay that computed a different split is logged,
 * slice by slice (`reportReplayMismatch`).
 *
 * A slice the split defines that is MISSING entirely is recorded from what
 * the charge has left (`completingSlices`): `completed`. Only a delivery that
 * died between slices, under the per-slice writers before this, leaves one.
 * With nothing left, the charge is `already_split`.
 *
 * Returns each slice's outcome in `inputs` order (`null` for a slice not
 * recorded now), and the slice as recorded (`slices`: a completed one's
 * amount is what the charge had left, not the one computed).
 */
export async function recordSplitOnce(
  deps: LedgerDeps,
  charge: { id: string; grossCents: number },
  inputs: readonly RecordSliceInput[]
): Promise<
  | { kind: 'already_split' }
  | {
      kind: 'recorded' | 'completed';
      outcomes: Array<RecordSliceOutcome | null>;
      slices: Array<RecordSliceInput | null>;
    }
> {
  const split = await deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`payout_split:${charge.id}`}))`
    );
    const onCharge = await tx
      .select({
        payoutType: payouts.payoutType,
        userId: payouts.userId,
        amountCents: payouts.amountCents,
      })
      .from(payouts)
      .where(eq(payouts.stripeChargeId, charge.id));
    const decided = onCharge.some((row) =>
      SPLIT_SLICE_TYPES.some((type) => type === row.payoutType)
    );
    const toRecord = decided
      ? completingSlices(inputs, onCharge, charge.grossCents)
      : [...inputs];
    if (decided && toRecord.every((input) => input === null)) return null;
    const held = await saleIsHeld(
      tx,
      toRecord.filter((input): input is RecordSliceInput => input !== null)
    );
    const rows: Array<Payout | 'exists' | null> = [];
    for (const input of toRecord) {
      rows.push(input ? await reserveSlice(tx, input, held) : null);
    }
    return {
      kind: decided ? ('completed' as const) : ('recorded' as const),
      toRecord,
      rows,
      held,
    };
  });
  if (split === null) {
    for (const input of inputs) await reportReplayMismatch(deps, input);
    return { kind: 'already_split' };
  }
  if (split.kind === 'completed') {
    for (const [index, input] of inputs.entries()) {
      const added = split.toRecord[index];
      if (!added) {
        await reportReplayMismatch(deps, input);
        continue;
      }
      deps.obs.warn(
        'A replay found a slice its first split never recorded; recorded it from what is left of the charge',
        {
          stripeChargeId: charge.id,
          payoutType: added.payoutType,
          amountCents: added.amountCents,
          computedAmountCents: input.amountCents,
        }
      );
    }
  }

  const outcomes: Array<RecordSliceOutcome | null> = [];
  for (const [index, row] of split.rows.entries()) {
    const input = split.toRecord[index];
    if (row === null || !input) {
      outcomes.push(null);
    } else if (row === 'exists') {
      // Unreachable under the lock: the slice was missing when it was taken.
      outcomes.push({ kind: 'exists' });
    } else {
      outcomes.push(await sendReservedSlice(deps, row, input, split.held));
    }
  }
  return { kind: split.kind, outcomes, slices: split.toRecord };
}

/** The slices a split decides; the platform fee is recorded on its own. */
const SPLIT_SLICE_TYPES: readonly SlicePayoutType[] = [
  'organization_fee',
  'creator_payout_to_owner',
  'creator_payout',
];

/**
 * What a replay records on a charge already split, in `inputs` order: `null`
 * for a slice already recorded (it stands, whatever its amount) and for one
 * there is nothing left for; a missing slice from what the charge has left,
 * the gross less every row recorded on it, platform fee included (owner
 * decision 2026-10-23, "Keep recorded fee"; Codex-2hxff.49). So the slices
 * sum to the gross.
 *
 * The rest goes to the organisation's slice (`organization_fee` or
 * `creator_payout_to_owner`) when it is among the missing: what a creator's
 * share leaves is the organisation's, as with rounding (Codex-2hxff.12), and
 * a creator in force only since the first split must not take the owner's
 * part of it (Codex-2hxff.62). The other missing slices take their computed
 * amounts first, as far as it goes. With no organisation slice missing, the
 * last missing slice takes the rest.
 */
function completingSlices(
  inputs: readonly RecordSliceInput[],
  recorded: ReadonlyArray<{
    payoutType: string;
    userId: string | null;
    amountCents: number;
  }>,
  grossCents: number
): Array<RecordSliceInput | null> {
  const missing = inputs.map((input) =>
    recorded.some(
      (row) =>
        row.payoutType === input.payoutType &&
        (input.payoutType !== 'creator_payout' ||
          row.userId === input.payee?.userId)
    )
      ? null
      : input
  );
  let takesRest = -1;
  for (const [index, input] of missing.entries()) {
    if (!input) continue;
    const isOrg = input.payoutType !== 'creator_payout';
    const restIsOrg =
      takesRest >= 0 && missing[takesRest]?.payoutType !== 'creator_payout';
    if (isOrg || !restIsOrg) takesRest = index;
  }
  let left =
    grossCents - recorded.reduce((sum, row) => sum + row.amountCents, 0);
  const completed = missing.map((input, index) => {
    if (!input || index === takesRest || left <= 0) return null;
    const amountCents = Math.min(input.amountCents, left);
    left -= amountCents;
    return amountCents > 0 ? { ...input, amountCents } : null;
  });
  const rest = missing[takesRest];
  if (rest && left > 0) completed[takesRest] = { ...rest, amountCents: left };
  return completed;
}

/**
 * Reserve one slice's row, pending, before any money moves. `null` for a
 * zero amount; `exists` when the charge already holds this slice (a replay).
 * `held`: a dispute holds the sale (`saleIsHeld`), so it will not be sent.
 */
async function reserveSlice(
  db: DatabaseClient | Tx,
  input: RecordSliceInput,
  held: boolean
): Promise<Payout | 'exists' | null> {
  if (input.amountCents <= 0) return null;
  if (input.payee === null && input.payoutType === 'creator_payout') {
    // A creator slice always has its creator; only the owner can be missing.
    throw new InternalServiceError(
      'A creator_payout slice must name its creator',
      {
        organizationId: input.organizationId,
        stripeChargeId: input.stripeChargeId,
      }
    );
  }

  const reason = pendingReasonFor(input);
  const [reserved] = await db
    .insert(payouts)
    .values({
      userId: input.payee?.userId ?? null,
      organizationId: input.organizationId,
      ...sourceColumns(input.source),
      sourceType: input.source.sourceType,
      amountCents: input.amountCents,
      payoutType: input.payoutType,
      status: 'pending',
      reason,
      stripeChargeId: input.stripeChargeId,
      transferGroup: input.transferGroup,
      creatorOrgAgreementId: input.creatorOrgAgreementId ?? null,
      // About to transfer: this opens the attempt lease, so no drain sends
      // the row while its first transfer is still in flight. A held row is
      // not about to transfer, so it records no attempt.
      ...(reason === null && !held ? { lastRetryAt: new Date() } : {}),
    })
    .onConflictDoNothing(sliceConflictTarget(input.payoutType))
    // Bare `.returning()`: the client union collapses the projected overload.
    .returning();
  return reserved ?? 'exists';
}

/**
 * Transfer a reserved slice when its payee can be paid and no dispute holds
 * its sale (`held`); otherwise it stays pending in their name for the drains.
 */
async function sendReservedSlice(
  deps: LedgerDeps,
  reserved: Payout,
  input: RecordSliceInput,
  held: boolean
): Promise<RecordSliceOutcome> {
  const reason = pendingReasonFor(input);
  if (reason === 'no_owner') {
    deps.obs.error(
      'Organisation has no owner: its slice is held for the next one. Support must assign an owner to release it',
      {
        errorId: crypto.randomUUID(),
        payoutId: reserved.id,
        organizationId: input.organizationId,
        payoutType: input.payoutType,
        amountCents: input.amountCents,
        stripeChargeId: input.stripeChargeId,
      }
    );
  }

  const account = input.payee?.account;
  if (reason !== null || !account) {
    return {
      kind: 'pending',
      payoutId: reserved.id,
      reason: reason ?? 'connect_not_ready',
    };
  }
  if (held) {
    deps.obs.warn(
      'A slice was recorded while a dispute holds its sale; it waits until the dispute is won or closed',
      {
        payoutId: reserved.id,
        payoutType: input.payoutType,
        amountCents: input.amountCents,
        stripeChargeId: input.stripeChargeId,
      }
    );
    return { kind: 'held', payoutId: reserved.id };
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await deps.stripe.transfers.create(
      {
        amount: input.amountCents,
        currency: CURRENCY.GBP,
        destination: account.stripeAccountId,
        source_transaction: input.stripeChargeId,
        ...(input.sendTransferGroup
          ? { transfer_group: input.transferGroup }
          : {}),
        metadata: {
          ...input.metadata,
          payout_id: reserved.id,
          type: input.payoutType,
          stripe_charge_id: input.stripeChargeId,
          ...stripeEnvMetadata(deps.environment),
        },
      },
      { idempotencyKey: input.idempotencyKey }
    );
  } catch (error) {
    // If the row cannot be marked failed it is left pending with no reason:
    // the sweep picks it up and, finding no transfer in Stripe, sends it.
    const landed = await recordTransferFailure(
      deps,
      {
        payoutId: reserved.id,
        destination: account.stripeAccountId,
        idempotencyKey: input.idempotencyKey,
      },
      error,
      {
        payoutType: input.payoutType,
        organizationId: input.organizationId,
        amountCents: input.amountCents,
      }
    );
    if (
      landed?.outcome === 'surplus_reversed' ||
      landed?.outcome === 'surplus_unreversed'
    ) {
      // A refund cancelled the row while the transfer was in flight, and the
      // transfer landed after all.
      return {
        kind: 'surplus',
        payoutId: reserved.id,
        transferId: landed.transferId,
        reversed: landed.outcome === 'surplus_reversed',
      };
    }
    return { kind: 'failed', payoutId: reserved.id };
  }

  let settled: SettleOutcome;
  try {
    settled = await settleTransfer(deps, reserved.id, transfer.id);
  } catch (error) {
    deps.obs.error(
      'Transfer made but its payout row was not settled; the next drain settles it from Stripe',
      {
        errorId: crypto.randomUUID(),
        payoutId: reserved.id,
        stripeTransferId: transfer.id,
        amountCents: input.amountCents,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return {
      kind: 'unsettled',
      payoutId: reserved.id,
      transferId: transfer.id,
    };
  }
  if (settled === 'settled' || settled === 'already_settled') {
    return { kind: 'paid', payoutId: reserved.id, transferId: transfer.id };
  }
  return {
    kind: 'surplus',
    payoutId: reserved.id,
    transferId: transfer.id,
    reversed: settled === 'surplus_reversed',
  };
}

/**
 * A replay found its slice already recorded. If the replay computed a
 * different slice — another amount, or another payee — the recorded one
 * stands and nothing is sent, but that is a split that changed between
 * deliveries, not a plain replay, so it is logged for a person to check.
 */
async function reportReplayMismatch(
  deps: LedgerDeps,
  input: RecordSliceInput
): Promise<void> {
  const [recorded] = await deps.db
    .select({
      id: payouts.id,
      amountCents: payouts.amountCents,
      userId: payouts.userId,
    })
    .from(payouts)
    .where(
      and(
        eq(payouts.stripeChargeId, input.stripeChargeId),
        eq(payouts.payoutType, input.payoutType),
        input.payoutType === 'creator_payout' && input.payee
          ? eq(payouts.userId, input.payee.userId)
          : undefined
      )
    )
    .limit(1);
  if (!recorded) return;
  const payeeNow = input.payee?.userId ?? null;
  // A no_owner row handed to a new owner names them now; that is the
  // hand-over, not a mismatch.
  const payeeDiffers =
    recorded.userId !== payeeNow && !(payeeNow === null && recorded.userId);
  if (recorded.amountCents === input.amountCents && !payeeDiffers) return;
  deps.obs.error(
    'A replay computed a different slice than the one recorded; the recorded slice stands',
    {
      errorId: crypto.randomUUID(),
      payoutId: recorded.id,
      payoutType: input.payoutType,
      stripeChargeId: input.stripeChargeId,
      recordedAmountCents: recorded.amountCents,
      replayAmountCents: input.amountCents,
      recordedUserId: recorded.userId,
      replayUserId: payeeNow,
    }
  );
}

/** What became of a transfer once its row was told about it. */
export type SettleOutcome =
  /** The row is now paid by this transfer. */
  | 'settled'
  /** The row was already paid by this same transfer (a lookup found it). */
  | 'already_settled'
  /**
   * The row no longer wanted it — a refund cancelled it, or another transfer
   * paid it — so the transfer was reversed in full.
   */
  | 'surplus_reversed'
  /** As above, but the reversal failed. Logged for a person to reverse. */
  | 'surplus_unreversed';

/**
 * Record a transfer that has just been made against its row. If the row has
 * moved on while the transfer was in flight — a refund cancelled it, or a
 * concurrent attempt paid it — nothing will ever account for this money, so
 * it is taken back with a full reversal. Its key is deterministic, so a
 * retry never reverses twice.
 *
 * Throws only if the database does: the caller treats that as unsettled.
 */
export async function settleTransfer(
  deps: LedgerDeps,
  payoutId: string,
  transferId: string,
  now: Date = new Date()
): Promise<SettleOutcome> {
  if (await settlePayoutPaid(deps.db, payoutId, transferId, now)) {
    return 'settled';
  }
  const [row] = await deps.db
    .select({
      status: payouts.status,
      stripeTransferId: payouts.stripeTransferId,
    })
    .from(payouts)
    .where(eq(payouts.id, payoutId))
    .limit(1);
  if (row?.stripeTransferId === transferId) return 'already_settled';

  const context = {
    errorId: crypto.randomUUID(),
    payoutId,
    stripeTransferId: transferId,
    rowStatus: row?.status ?? null,
    rowTransferId: row?.stripeTransferId ?? null,
  };
  try {
    await deps.stripe.transfers.createReversal(
      transferId,
      {
        metadata: {
          payout_id: payoutId,
          type: 'surplus_reversal',
          ...stripeEnvMetadata(deps.environment),
        },
      },
      { idempotencyKey: `${transferId}_reversal_surplus` }
    );
  } catch (error) {
    deps.obs.error(
      'A transfer landed on a payout that no longer wanted it, and could NOT be reversed. Reverse it by hand',
      {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return 'surplus_unreversed';
  }
  deps.obs.error(
    'A transfer landed on a payout that no longer wanted it; reversed it',
    context
  );
  return 'surplus_reversed';
}

/**
 * Record the platform's slice: retained on the platform balance, so no
 * transfer — the charge id proves the money. One row per charge.
 *
 * Returns the platform fee ON RECORD for the charge: this amount when it is
 * the first, or the amount an earlier delivery recorded (0 if none). Fees can
 * change between deliveries, and a replay must split the rest of the charge
 * from the fee recorded, so the slices sum to the gross (owner decision
 * 2026-10-23, "Keep recorded fee"; Codex-2hxff.49).
 *
 * `unlessSplit`: record no fee on a charge already split with no fee row.
 * The fee is written before the split and a 0 fee writes no row, so that
 * charge's first fee was 0, and a replay must not add one on top of its
 * split (`feeStillOpen`).
 */
export async function recordPlatformFee(
  deps: Pick<LedgerDeps, 'db'>,
  input: {
    amountCents: number;
    organizationId: string | null;
    source: SliceSource;
    stripeChargeId: string;
    transferGroup: string;
    unlessSplit?: boolean;
  }
): Promise<number> {
  const amountCents =
    input.unlessSplit && input.amountCents > 0
      ? (await feeStillOpen(deps.db, input.stripeChargeId))
        ? input.amountCents
        : 0
      : input.amountCents;
  if (amountCents > 0) {
    const [inserted] = await deps.db
      .insert(payouts)
      .values({
        userId: null,
        organizationId: input.organizationId,
        ...sourceColumns(input.source),
        sourceType: input.source.sourceType,
        amountCents,
        payoutType: 'platform_fee',
        status: 'paid',
        stripeChargeId: input.stripeChargeId,
        transferGroup: input.transferGroup,
        resolvedAt: new Date(),
      })
      .onConflictDoNothing({
        target: payouts.stripeChargeId,
        where: sql`${payouts.payoutType} = 'platform_fee'`,
      })
      // Bare `.returning()`: the client union collapses the projected overload.
      .returning();
    if (inserted) return inserted.amountCents;
  }
  const [recorded] = await deps.db
    .select({ amountCents: payouts.amountCents })
    .from(payouts)
    .where(
      and(
        eq(payouts.stripeChargeId, input.stripeChargeId),
        eq(payouts.payoutType, 'platform_fee')
      )
    )
    .limit(1);
  return recorded?.amountCents ?? 0;
}

/**
 * Whether a charge's platform fee can still be recorded: it is not split yet,
 * or it has a fee row (which then wins through the insert's conflict). A
 * charge split with no fee row had a fee of 0 (money review LOW-1 and r2 L2,
 * Codex-2hxff.49).
 */
async function feeStillOpen(
  db: DatabaseClient,
  stripeChargeId: string
): Promise<boolean> {
  const onCharge = await db
    .select({ payoutType: payouts.payoutType })
    .from(payouts)
    .where(eq(payouts.stripeChargeId, stripeChargeId));
  return (
    onCharge.some((row) => row.payoutType === 'platform_fee') ||
    !onCharge.some((row) =>
      SPLIT_SLICE_TYPES.some((type) => type === row.payoutType)
    )
  );
}

/**
 * Mark a row paid by its transfer. Only a pending or failed row moves: a row
 * a refund cancelled, or another drain already settled, is left alone.
 * Returns whether this call settled it.
 */
export async function settlePayoutPaid(
  db: DatabaseClient,
  payoutId: string,
  stripeTransferId: string,
  now: Date = new Date()
): Promise<boolean> {
  const settled = await db
    .update(payouts)
    .set({
      status: 'paid',
      reason: null,
      stripeTransferId,
      resolvedAt: now,
    })
    .where(and(eq(payouts.id, payoutId), inArray(payouts.status, DRAINABLE)))
    .returning();
  return settled.length > 0;
}

/**
 * Stripe refusals after which a payout waits for support instead of being
 * retried: the refund-clawback cap (`MAX_CLAWBACK_ATTEMPTS`), owner decision
 * D-P2 (Codex-2hxff.48). Only refusals count; see `classifyTransferFailure`.
 */
export const MAX_PAYOUT_FAILURES = 5;

/**
 * Stripe refusals of a transfer that no retry can fix, so the row is flagged
 * at the first one. Kept deliberately short: a code missing here still flags
 * the row, after `MAX_PAYOUT_FAILURES` refusals. Each is from Stripe's error
 * codes reference (docs.stripe.com/error-codes, checked 2026-10-23):
 *
 * - `transfers_not_allowed`: "The requested transfer can't be created.
 *   Contact us if you're receiving this error." Only Stripe can lift it.
 * - `resource_missing` on the `destination` parameter: "The ID provided isn't
 *   valid. Either the resource doesn't exist, or an ID for a different
 *   resource has been provided." The payee's Connect account is gone or
 *   belongs to the other mode. On any other parameter it is an ordinary
 *   refusal.
 *
 * A destination without the `transfers` capability is NOT listed: Stripe's
 * reference documents no code for it, and the account can still gain it.
 */
const PERMANENT_REFUSALS: ReadonlyArray<{ code: string; param?: string }> = [
  { code: 'transfers_not_allowed' },
  { code: 'resource_missing', param: 'destination' },
];

/**
 * Refusals that are about the platform's own Stripe account, not the row: its
 * balance (a person may need to top it up), its keys, or its Connect setup.
 * They are retried without using an attempt, and logged at error every time.
 */
const PLATFORM_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'balance_insufficient',
  'api_key_expired',
  'platform_account_required',
  'platform_api_key_expired',
  'secret_key_required',
]);

/** How a failed transfer is treated (Codex-2hxff.48). */
export type TransferFailureKind =
  /** Stripe refused it and no retry can fix that: flagged at once. */
  | 'permanent'
  /** Stripe refused it: counts toward `MAX_PAYOUT_FAILURES`. */
  | 'refusal'
  /** Stripe could not answer (connection, 5xx, rate limit, lock): retried, no attempt used. */
  | 'outage'
  /**
   * The platform's side: its balance, keys or Connect setup, or a fault
   * that is not Stripe's at all. Retried, no attempt used, and a person is
   * told every time.
   */
  | 'platform';

export interface TransferFailure {
  kind: TransferFailureKind;
  /** Stripe's `code` (`balance_insufficient`, …), or `unknown`. */
  code: string;
  /** Stripe's error class (`StripeInvalidRequestError`, …), or the error's name. */
  type: string;
}

function stringField(error: unknown, field: string): string | undefined {
  const value = (error as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Sort a failed `transfers.create` the way the refund clawbacks do: only
 * Stripe answering "no" uses an attempt, so an outage can never flag a
 * payout (owner decision, Codex-2hxff.48).
 */
export function classifyTransferFailure(error: unknown): TransferFailure {
  const type = (
    stringField(error, 'type') ??
    (error instanceof Error ? error.name : 'unknown')
  ).slice(0, 64);
  const code = (stringField(error, 'code') ?? 'unknown').slice(0, 64);

  // Our own GBP guard (assertGbpOnly): the row's currency never changes.
  if (error instanceof UnsupportedCurrencyError) {
    return { kind: 'permanent', code, type };
  }
  if (!type.startsWith('Stripe')) return { kind: 'platform', code, type };

  const rawStatus = (error as { statusCode?: unknown }).statusCode;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  if (
    type === 'StripeConnectionError' ||
    type === 'StripeAPIError' ||
    type === 'StripeRateLimitError' ||
    code === 'rate_limit' ||
    code === 'lock_timeout' ||
    status === undefined ||
    status === 409 ||
    status === 429 ||
    status >= 500
  ) {
    return { kind: 'outage', code, type };
  }
  if (
    type === 'StripeAuthenticationError' ||
    type === 'StripePermissionError' ||
    PLATFORM_REFUSAL_CODES.has(code)
  ) {
    return { kind: 'platform', code, type };
  }
  const param = stringField(error, 'param');
  const permanent = PERMANENT_REFUSALS.some(
    (refusal) =>
      refusal.code === code &&
      (refusal.param === undefined || refusal.param === param)
  );
  return { kind: permanent ? 'permanent' : 'refusal', code, type };
}

/** What `markPayoutFailed` recorded. */
export interface PayoutFailureRecord {
  failure: TransferFailure;
  /** Refusals on record now, this one included if it counted. */
  failureCount: number;
  /** THIS call flagged the row for support. */
  flagged: boolean;
}

/**
 * Mark a row's transfer failed and record why (Codex-2hxff.48). Never
 * overwrites a row already paid — a concurrent drain that settled it wins.
 *
 * Records Stripe's code and type. A refusal adds one to `failure_count`; an
 * outage or a platform fault does not. A permanent refusal, or the refusal
 * that brings the count to `MAX_PAYOUT_FAILURES`, sets `needs_review_at`, and
 * the drains skip the row from then on. The status stays `failed`.
 *
 * One UPDATE, and it never touches a row already flagged, so the row it
 * returns flagged was flagged by THIS call: exactly one caller reports it.
 * Returns `null` when no row was updated (paid, cancelled or flagged since).
 */
export async function markPayoutFailed(
  db: DatabaseClient,
  payoutId: string,
  error: unknown,
  now: Date = new Date()
): Promise<PayoutFailureRecord | null> {
  const failure = classifyTransferFailure(error);
  const counts = failure.kind === 'refusal';
  const [row] = await db
    .update(payouts)
    .set({
      status: 'failed',
      reason: 'transfer_failed',
      lastErrorCode: failure.code,
      lastErrorType: failure.type,
      ...(counts ? { failureCount: sql`${payouts.failureCount} + 1` } : {}),
      ...(failure.kind === 'permanent'
        ? { needsReviewAt: now }
        : counts
          ? {
              // SET reads the row as it was: this is the count before +1.
              needsReviewAt: sql`CASE WHEN ${payouts.failureCount} + 1 >= ${MAX_PAYOUT_FAILURES} THEN ${now.toISOString()}::timestamptz END`,
            }
          : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(payouts.id, payoutId),
        inArray(payouts.status, DRAINABLE),
        isNull(payouts.needsReviewAt)
      )
    )
    // Bare `.returning()`: the client union collapses the projected overload.
    .returning();
  if (!row) return null;
  return {
    failure,
    failureCount: row.failureCount,
    flagged: row.needsReviewAt !== null,
  };
}

/** The transfer attempt that failed: its row, where it went, and its key. */
export interface TransferAttempt {
  payoutId: string;
  destination: string;
  idempotencyKey: string;
}

/** A transfer that landed for a row a refund cancelled while it was in flight. */
export interface LandedAfterCancel {
  transferId: string;
  outcome: SettleOutcome;
}

/**
 * Stripe may have made the transfer: it never answered (an outage), or the
 * call failed outside Stripe's own error types. A refusal means it did not,
 * and so does our own GBP guard, which refuses before Stripe is called.
 */
function mayHaveLanded(failure: TransferFailure): boolean {
  if (failure.code === 'UNSUPPORTED_CURRENCY') return false;
  return failure.kind === 'outage' || !failure.type.startsWith('Stripe');
}

/**
 * Record a failed transfer on its row and log it at the level it deserves:
 * - flagged for support by this failure: ONE error, with an errorId;
 * - the platform's side (`balance_insufficient`, keys, setup, or a fault of
 *   ours): an error with an errorId every time, as a person must act;
 * - anything else (an outage, a refusal below the cap): a warning, as the
 *   drains retry it.
 *
 * If the row was no longer failable — a refund or a lost dispute cancelled it
 * while the transfer was in flight — and Stripe may have made the transfer
 * after all, it is looked up by its `payout_id` and reversed, as any transfer
 * that lands after the cancel is (`settleTransfer`). The refund's own lookup
 * ran before it landed, so nothing else would ever take that money back.
 * Returns what became of such a transfer, or `null`.
 *
 * Never throws. A row that cannot be updated keeps its state for the drains,
 * and that is logged at error.
 */
export async function recordTransferFailure(
  deps: LedgerDeps,
  attempt: TransferAttempt,
  error: unknown,
  context: Record<string, unknown>
): Promise<LandedAfterCancel | null> {
  const { payoutId } = attempt;
  const message = error instanceof Error ? error.message : String(error);
  let recorded: PayoutFailureRecord | null;
  try {
    recorded = await markPayoutFailed(deps.db, payoutId, error);
  } catch (updateError) {
    deps.obs.error(
      'A payout transfer failed and its row could not be marked failed; the drains retry it',
      {
        errorId: crypto.randomUUID(),
        ...attempt,
        ...context,
        error: message,
        updateError:
          updateError instanceof Error
            ? updateError.message
            : String(updateError),
      }
    );
    return null;
  }

  const failure = recorded?.failure ?? classifyTransferFailure(error);
  const fields = {
    ...attempt,
    ...context,
    kind: failure.kind,
    code: failure.code,
    type: failure.type,
    failureCount: recorded?.failureCount,
    maxFailures: MAX_PAYOUT_FAILURES,
    error: message,
  };
  if (!recorded) {
    return handleFailureOnMovedRow(deps, attempt, failure, fields);
  }
  if (recorded.flagged) {
    deps.obs.error(
      failure.kind === 'permanent'
        ? 'Stripe refused a payout transfer for good; it waits for support'
        : `Stripe refused a payout transfer ${MAX_PAYOUT_FAILURES} times; it waits for support`,
      { errorId: crypto.randomUUID(), ...fields }
    );
    return null;
  }
  if (failure.kind === 'platform') {
    deps.obs.error(
      'A payout transfer failed on the platform side; it is retried, but a person must act',
      { errorId: crypto.randomUUID(), ...fields }
    );
    return null;
  }
  deps.obs.warn('A payout transfer failed; the drains retry it', fields);
  return null;
}

/**
 * A transfer failed on a row `markPayoutFailed` could not touch: it was paid,
 * cancelled or flagged meanwhile. Only a cancelled row can be owed a
 * reversal, and only if Stripe may have made the transfer.
 */
async function handleFailureOnMovedRow(
  deps: LedgerDeps,
  attempt: TransferAttempt,
  failure: TransferFailure,
  fields: Record<string, unknown>
): Promise<LandedAfterCancel | null> {
  let row: Payout | undefined;
  try {
    [row] = await deps.db
      .select()
      .from(payouts)
      .where(eq(payouts.id, attempt.payoutId))
      .limit(1);
  } catch (readError) {
    deps.obs.error(
      'A payout transfer failed and its row could not be read; check Stripe for the idempotency key',
      {
        errorId: crypto.randomUUID(),
        ...fields,
        readError:
          readError instanceof Error ? readError.message : String(readError),
      }
    );
    return null;
  }

  const cancelled =
    row?.status === 'cancelled_by_refund' ||
    row?.status === 'cancelled_by_dispute';
  if (!row || !cancelled) {
    // Paid by another drain, or already waiting for support: nothing to do.
    deps.obs.warn(
      'A payout transfer failed, but its row had already moved on',
      {
        ...fields,
        rowStatus: row?.status ?? null,
        waitsForSupport: row ? row.needsReviewAt !== null : null,
      }
    );
    return null;
  }
  if (!mayHaveLanded(failure)) {
    deps.obs.warn(
      'A payout was cancelled while Stripe refused its transfer; nothing was sent',
      { ...fields, rowStatus: row.status }
    );
    return null;
  }

  let transferId: string | undefined;
  let lookupError: string | undefined;
  try {
    // The attempt's own destination: the one account it could have reached.
    const found = await findTransfersForPayouts(
      deps.stripe,
      { current: attempt.destination, replaced: [] },
      [row],
      deps.obs
    );
    transferId = found.get(row.id);
    if (transferId) {
      // Reversed in full, and logged, by the path every late transfer takes.
      const outcome = await settleTransfer(deps, row.id, transferId);
      return { transferId, outcome };
    }
  } catch (cause) {
    lookupError = cause instanceof Error ? cause.message : String(cause);
  }
  deps.obs.error(
    'A payout was cancelled while its transfer was in flight, and Stripe did not answer: the transfer may have landed. Find it by its idempotency key and reverse it by hand',
    {
      errorId: crypto.randomUUID(),
      ...fields,
      rowStatus: row.status,
      ...(transferId ? { stripeTransferId: transferId } : {}),
      ...(lookupError ? { lookupError } : {}),
    }
  );
  return null;
}

/** How long an attempt holds a row against every other drain. */
export const PAYOUT_ATTEMPT_LEASE_MINUTES = 10;

/**
 * Claim a row for one drain attempt. Returns the attempt number, or `null`
 * if the row is not drainable now: paid or cancelled since it was read, held
 * for an owner (`no_owner`, no payee), or attempted by someone else within
 * the lease.
 *
 * The attempt number makes the transfer's idempotency key
 * (`payout_${id}_${attempt}`). One stable key is not enough: Stripe replays
 * the FIRST result for a key for ~24h, errors included ("API v1 always
 * returns the previously-saved response of the first API request, even if it
 * was an error"), so a transient failure would block the row for a day. A
 * new key per attempt is safe because the lease admits one attempt at a time
 * and the drain looks for an earlier attempt's transfer before sending.
 */
export async function claimPayoutAttempt(
  db: DatabaseClient,
  payoutId: string,
  now: Date = new Date()
): Promise<number | null> {
  return (await claimPayoutAttempts(db, [payoutId], now)).get(payoutId) ?? null;
}

/**
 * `claimPayoutAttempt` for a drain's whole group in one statement: the
 * attempt number of every row it claimed, by row id. A row missing from the
 * map was not claimable.
 */
export async function claimPayoutAttempts(
  db: DatabaseClient,
  payoutIds: ReadonlyArray<string>,
  now: Date = new Date()
): Promise<Map<string, number>> {
  if (payoutIds.length === 0) return new Map();
  const leaseStart = new Date(
    now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000
  );
  const claimed = await db
    .update(payouts)
    .set({ retryCount: sql`${payouts.retryCount} + 1`, lastRetryAt: now })
    .where(
      and(
        inArray(payouts.id, [...payoutIds]),
        isDrainablePayout(),
        isNotNull(payouts.userId),
        or(isNull(payouts.lastRetryAt), lt(payouts.lastRetryAt, leaseStart))
      )
    )
    .returning();
  return new Map(claimed.map((row) => [row.id, row.retryCount]));
}

/**
 * Renew a claimed row's lease just before its transfer is sent. A drain
 * claims a whole group, looks it up in Stripe, then sends row by row; a long
 * group can outlive the lease, and another drain may then have claimed the
 * row and sent it under the next attempt's key. Returns false in that case
 * (the attempt number has moved on): this drain must not send.
 */
export async function renewPayoutAttempt(
  db: DatabaseClient,
  payoutId: string,
  attempt: number,
  now: Date = new Date()
): Promise<boolean> {
  const renewed = await db
    .update(payouts)
    .set({ lastRetryAt: now })
    .where(
      and(
        eq(payouts.id, payoutId),
        eq(payouts.retryCount, attempt),
        inArray(payouts.status, DRAINABLE)
      )
    )
    .returning();
  return renewed.length > 0;
}

/** What a refund did to a row that had not been marked paid. */
export type UnpaidCancelOutcome =
  /**
   * Cancelled. `transferId` is a transfer Stripe made for it anyway — the
   * caller reverses it like a paid row's.
   */
  | { kind: 'cancelled'; transferId: string | undefined }
  /**
   * The row changed since it was read: paid by a transfer that landed in
   * the meantime, or already handled by a concurrent delivery. The current
   * row is returned for the caller to handle as it now stands.
   */
  | { kind: 'changed'; row: Payout | undefined };

/**
 * Cancel a pending or failed row for a refund, or for a lost dispute — FIRST,
 * so nothing can settle it afterwards — then ask Stripe whether its transfer
 * went out anyway. A row is pending with a transfer in flight between reserve
 * and settle, and stays so if its settle fails; a failed row's transfer may
 * have landed despite the error. Without the lookup the cancel would leave
 * that money with the payee (Stripe does not reverse transfers when a charge
 * is refunded or charged back).
 *
 * A transfer that lands after the cancel is the sender's to reverse: its
 * settle finds the row cancelled (`settleTransfer`).
 *
 * If the Stripe lookup itself fails the row stays cancelled — most cancelled
 * rows never had a transfer — and the miss is logged for a person to check.
 */
export async function cancelUnpaidPayout(
  deps: LedgerDeps,
  row: Payout,
  status: 'cancelled_by_refund' | 'cancelled_by_dispute',
  now: Date = new Date()
): Promise<UnpaidCancelOutcome> {
  const [cancelled] = await deps.db
    .update(payouts)
    .set({
      status,
      resolvedAt: row.resolvedAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(payouts.id, row.id), inArray(payouts.status, DRAINABLE)))
    .returning();
  if (!cancelled) {
    const [current] = await deps.db
      .select()
      .from(payouts)
      .where(eq(payouts.id, row.id))
      .limit(1);
    return { kind: 'changed', row: current };
  }

  // No payee: a no_owner row, never sent.
  if (!row.userId) return { kind: 'cancelled', transferId: undefined };

  try {
    // Every account the payee has had: the transfer may have gone to one
    // they have since replaced (Codex-2hxff.47).
    const found = await findTransfersForPayouts(
      deps.stripe,
      await payeeAccountIds(deps.db, row.userId),
      [row],
      deps.obs
    );
    return { kind: 'cancelled', transferId: found.get(row.id) };
  } catch (error) {
    deps.obs.error(
      'A payout was cancelled but Stripe could not be asked whether its transfer went out. Check it by hand',
      {
        errorId: crypto.randomUUID(),
        payoutId: row.id,
        userId: row.userId,
        stripeChargeId: row.stripeChargeId,
        amountCents: row.amountCents,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return { kind: 'cancelled', transferId: undefined };
  }
}

/**
 * Where a payee's transfers can have gone: their Connect account now, if they
 * have one, and every account they have had and replaced, newest first.
 */
export interface PayeeAccounts {
  current: string | null;
  replaced: string[];
}

/**
 * A payee's Connect accounts, current and replaced (Codex-2hxff.47; owner
 * decision 2026-10-23, "Keep account history"). The history is written by a
 * database trigger whenever a `stripe_connect_accounts` row is deleted or
 * re-keyed, so a manual support edit is in it too. An account re-attached
 * after its row was deleted is listed once, as current.
 */
export async function payeeAccountIds(
  db: DatabaseClient,
  userId: string
): Promise<PayeeAccounts> {
  const [[account], history] = await Promise.all([
    db
      .select({ stripeAccountId: stripeConnectAccounts.stripeAccountId })
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, userId))
      .limit(1),
    db
      .select({ stripeAccountId: stripeConnectAccountHistory.stripeAccountId })
      .from(stripeConnectAccountHistory)
      .where(eq(stripeConnectAccountHistory.userId, userId))
      .orderBy(desc(stripeConnectAccountHistory.replacedAt)),
  ]);
  const current = account?.stripeAccountId ?? null;
  return {
    current,
    replaced: history
      .map((row) => row.stripeAccountId)
      .filter((id) => id !== current),
  };
}

/**
 * The transfers Stripe has already made to the payee for any of these rows,
 * by row id. A drain calls this BEFORE re-sending: a row whose transfer went
 * through but whose update failed must be settled, not paid twice — Stripe
 * forgets an idempotency key after ~24h, so the key alone cannot prevent it.
 *
 * The current account is searched for every row. An account the payee has
 * replaced is searched only for the rows that have an attempt on record
 * (`lastRetryAt`, as it stood BEFORE any claim the caller made): a row never
 * attempted has no transfer anywhere. So a payee with no history, or no
 * attempted row, costs the one Stripe search it always did (Codex-2hxff.47).
 *
 * Matches the `payout_id` metadata every writer sets, and `pending_payout_id`
 * from drains before Codex-2hxff.11. A row that matches more than one
 * transfer was paid twice, on one account or on two; that is logged (with
 * `log`) for a person to reverse. On one account the newest is returned; on
 * two, the one found first (the current account's).
 */
export async function findTransfersForPayouts(
  stripe: Stripe,
  accounts: PayeeAccounts,
  rows: ReadonlyArray<{
    id: string;
    createdAt: Date;
    lastRetryAt?: Date | null;
  }>,
  log?: LedgerLogger
): Promise<Map<string, string>> {
  const found = new Map<string, { transferId: string; destination: string }>();
  const attempted = rows.filter((row) => row.lastRetryAt != null);
  const searches = [
    ...(accounts.current ? [{ destination: accounts.current, rows }] : []),
    ...(attempted.length > 0
      ? accounts.replaced.map((destination) => ({
          destination,
          rows: attempted,
        }))
      : []),
  ];
  for (const search of searches) {
    const on = await findTransfersTo(
      stripe,
      search.destination,
      search.rows,
      log
    );
    for (const [id, transferId] of on) {
      const first = found.get(id);
      if (!first) {
        found.set(id, { transferId, destination: search.destination });
        continue;
      }
      log?.error(
        "A payout matches Stripe transfers on two of the payee's accounts: it was paid twice",
        {
          errorId: crypto.randomUUID(),
          payoutId: id,
          destinations: [first.destination, search.destination],
          stripeTransferIds: [first.transferId, transferId],
        }
      );
    }
  }
  return new Map([...found].map(([id, { transferId }]) => [id, transferId]));
}

/** `findTransfersForPayouts` for one destination. */
async function findTransfersTo(
  stripe: Stripe,
  destination: string,
  rows: ReadonlyArray<{ id: string; createdAt: Date }>,
  log?: LedgerLogger
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (rows.length === 0) return found;

  const wanted = new Set(rows.map((row) => row.id));
  const oldest = Math.min(...rows.map((row) => row.createdAt.getTime()));
  // A transfer is never older than the row it pays; a minute of slack covers
  // clock skew between the database and Stripe.
  const since = Math.floor(oldest / 1000) - 60;

  let startingAfter: string | undefined;
  do {
    const page = await stripe.transfers.list({
      destination,
      created: { gte: since },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const transfer of page.data) {
      const id =
        transfer.metadata?.payout_id ?? transfer.metadata?.pending_payout_id;
      if (!id || !wanted.has(id)) continue;
      const first = found.get(id);
      if (first === undefined) {
        found.set(id, transfer.id);
      } else {
        log?.error(
          'A payout matches more than one Stripe transfer: it was paid twice',
          {
            errorId: crypto.randomUUID(),
            payoutId: id,
            destination,
            stripeTransferIds: [first, transfer.id],
          }
        );
      }
    }
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    // Stops once every row is found, so a second transfer is seen only on a
    // page already read — enough to surface it, not a full audit.
  } while (startingAfter && found.size < wanted.size);

  return found;
}
