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
 * - **A failed transfer stays payable.** It keeps its charge id and is retried
 *   by the drains.
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

import { CURRENCY, stripeEnvMetadata } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { payouts } from '@codex/database/schema';
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
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
  | { kind: 'unsettled'; payoutId: string; transferId: string };

const DRAINABLE: Array<'pending' | 'failed'> = ['pending', 'failed'];

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
    throw new Error('A creator_payout slice must name its creator');
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
    // No target: any of the per-charge slice indexes. A conflict IS the
    // replay — the first delivery already reserved this slice.
    .onConflictDoNothing()
    // Bare `.returning()`: the client union collapses the projected overload.
    .returning();
  if (!reserved) return { kind: 'exists' };

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

  try {
    await settlePayoutPaid(deps.db, reserved.id, transfer.id);
    return { kind: 'paid', payoutId: reserved.id, transferId: transfer.id };
  } catch (error) {
    deps.obs.error(
      'Transfer made but its payout row was not marked paid; the next drain settles it from Stripe',
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
  const leaseStart = new Date(
    now.getTime() - PAYOUT_ATTEMPT_LEASE_MINUTES * 60_000
  );
  const [claimed] = await db
    .update(payouts)
    .set({ retryCount: sql`${payouts.retryCount} + 1`, lastRetryAt: now })
    .where(
      and(
        eq(payouts.id, payoutId),
        inArray(payouts.status, DRAINABLE),
        isNotNull(payouts.userId),
        or(isNull(payouts.lastRetryAt), lt(payouts.lastRetryAt, leaseStart))
      )
    )
    .returning();
  return claimed ? claimed.retryCount : null;
}

/**
 * The transfers Stripe has already made to `destination` for any of these
 * rows, by row id. A drain calls this BEFORE re-sending: a row whose transfer
 * went through but whose update failed must be settled, not paid twice —
 * Stripe forgets an idempotency key after ~24h, so the key alone cannot
 * prevent it.
 *
 * Matches the `payout_id` metadata every writer sets, and `pending_payout_id`
 * from drains before Codex-2hxff.11.
 */
export async function findTransfersForPayouts(
  stripe: Stripe,
  destination: string,
  rows: ReadonlyArray<{ id: string; createdAt: Date }>
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
      if (id && wanted.has(id) && !found.has(id)) found.set(id, transfer.id);
    }
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter && found.size < wanted.size);

  return found;
}
