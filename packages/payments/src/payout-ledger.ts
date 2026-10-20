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
 *   `payout_id` metadata (`findTransfersForPayouts`), so it settles the row
 *   instead of paying twice.
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
 * - **Nothing is dropped.** A slice whose payee cannot be paid yet is a
 *   pending row in their name; the organisation's slices while it has no
 *   owner are pending `no_owner` rows with no payee, handed to the next owner
 *   (owner decision 2026-10-18).
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
  payouts,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import {
  and,
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
}

export type RecordSliceOutcome =
  /** A replay: the slice is already in the ledger. Nothing was sent. */
  | { kind: 'exists' }
  | { kind: 'pending'; payoutId: string; reason: PendingReason }
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
 */
export function isDrainablePayout(): SQL {
  return sql`((${payouts.status} = 'pending' OR (${payouts.status} = 'failed' AND ${payouts.lastRetryAt} IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM ${disputes} WHERE (${notInArray(disputes.status, [...DISPUTE_CLOSED_STATUSES])} OR (${disputes.status} = 'lost' AND ${disputes.outcomeAppliedAt} IS NULL)) AND (${disputes.stripeChargeId} = ${payouts.stripeChargeId} OR ${disputes.purchaseId} = ${payouts.purchaseId})))`;
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

/**
 * Record one slice of a sale in the ledger and, when its payee can be paid,
 * transfer it. Returns `null` for a zero amount (nothing to record).
 */
export async function recordSlice(
  deps: LedgerDeps,
  input: RecordSliceInput
): Promise<RecordSliceOutcome | null> {
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
  const [reserved] = await deps.db
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
      // About to transfer: this opens the attempt lease, so no drain sends
      // the row while its first transfer is still in flight.
      ...(reason === null ? { lastRetryAt: new Date() } : {}),
    })
    .onConflictDoNothing(sliceConflictTarget(input.payoutType))
    // Bare `.returning()`: the client union collapses the projected overload.
    .returning();
  if (!reserved) {
    await reportReplayMismatch(deps, input);
    return { kind: 'exists' };
  }

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
    deps.obs.error(`${input.payoutType} transfer failed; the drains retry it`, {
      payoutId: reserved.id,
      organizationId: input.organizationId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      destination: account.stripeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await markPayoutFailed(deps.db, reserved.id);
    } catch (updateError) {
      // Left pending with no reason: the sweep picks it up and, finding no
      // transfer in Stripe, sends it.
      deps.obs.error('Could not mark the payout failed; it stays pending', {
        payoutId: reserved.id,
        error:
          updateError instanceof Error
            ? updateError.message
            : String(updateError),
      });
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
 */
export async function recordPlatformFee(
  deps: Pick<LedgerDeps, 'db'>,
  input: {
    amountCents: number;
    organizationId: string | null;
    source: SliceSource;
    stripeChargeId: string;
    transferGroup: string;
  }
): Promise<void> {
  if (input.amountCents <= 0) return;
  await deps.db
    .insert(payouts)
    .values({
      userId: null,
      organizationId: input.organizationId,
      ...sourceColumns(input.source),
      sourceType: input.source.sourceType,
      amountCents: input.amountCents,
      payoutType: 'platform_fee',
      status: 'paid',
      stripeChargeId: input.stripeChargeId,
      transferGroup: input.transferGroup,
      resolvedAt: new Date(),
    })
    .onConflictDoNothing({
      target: payouts.stripeChargeId,
      where: sql`${payouts.payoutType} = 'platform_fee'`,
    });
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
 * Mark a row's transfer failed. Never overwrites a row already paid — a
 * concurrent drain that settled it wins.
 */
export async function markPayoutFailed(
  db: DatabaseClient,
  payoutId: string
): Promise<void> {
  await db
    .update(payouts)
    .set({ status: 'failed', reason: 'transfer_failed' })
    .where(and(eq(payouts.id, payoutId), inArray(payouts.status, DRAINABLE)));
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
    const [account] = await deps.db
      .select({ stripeAccountId: stripeConnectAccounts.stripeAccountId })
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, row.userId))
      .limit(1);
    if (!account) return { kind: 'cancelled', transferId: undefined };
    const found = await findTransfersForPayouts(
      deps.stripe,
      account.stripeAccountId,
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
 * The transfers Stripe has already made to `destination` for any of these
 * rows, by row id. A drain calls this BEFORE re-sending: a row whose transfer
 * went through but whose update failed must be settled, not paid twice —
 * Stripe forgets an idempotency key after ~24h, so the key alone cannot
 * prevent it.
 *
 * Matches the `payout_id` metadata every writer sets, and `pending_payout_id`
 * from drains before Codex-2hxff.11. A row that matches more than one
 * transfer was paid twice; that is logged (with `log`) for a person to
 * reverse, and the newest is returned.
 *
 * Only the payee's CURRENT account is searched: a transfer to an account
 * they have since replaced is not found (Codex-2hxff.47).
 */
export async function findTransfersForPayouts(
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
