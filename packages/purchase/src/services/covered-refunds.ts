/**
 * A refund of everything a payment still owes COVERS the failed refunds it
 * included (owner D73; Codex-z1t3c review r8).
 *
 * Three refunds are asked for what was paid less the refunds that count
 * (`countedRefundOf`: standing, or failed and settled refunded elsewhere):
 * - the late win's (`issueLateWinRefund`, owner D69), made or adopted;
 * - its "none" outcome, when nothing is owed, which covers as any payment
 *   that owes nothing does (`coverWhenNothingOwed`);
 * - the blocked payment's own (`refundBlockedPayment`);
 * - support's refund on the charge page of all that is left of a purchase's
 *   charge (`SupportService.issueRefund`; a part refund covers nothing).
 *
 * A failed refund that counted nothing when that amount was worked out is
 * paid by it. Left open, it would come back to Failed refunds as owed, and a
 * settle would pay the buyer twice. So each one is settled
 * `covered_by_refund`, naming the covering refund (`covered_by_refund_id`):
 * - it counts nothing, because the covering refund counts, and counting both
 *   would count the money twice;
 * - the platform settles it, so `resolved_by_user_id` stays null;
 * - its clawback stands. `recordedClawableRefunds` drops only
 *   `creators_repaid`, so the covering refund's share comes off what is left
 *   and its creators pay once.
 * The support charge page shows it as "Covered" (owner D74), and it appears
 * nowhere else (D75).
 *
 * **The set is fixed when the amount is worked out** (`uncoveredFailedRefundOf`),
 * never when the cover is written:
 * - a refund that fails during the Stripe call counted then, so the covering
 *   refund didn't include it, and it stays owed;
 * - so does one that fails after the covering refund;
 * - a covering refund that itself fails stays in Failed refunds at its own
 *   amount, which includes what it covered, and what it covered stays
 *   covered.
 *
 * **The set travels with the refund** (review r9): every writer of such a
 * refund records it in the refund's Stripe metadata (`coversMetadata`,
 * `codex_covers`), so any later pass covers exactly it (`coverFromMetadata`):
 * a replay of the same request, the late win's adoption, and the sync of the
 * charge's refunds (`charge.refunded`), which closes a request that died
 * after Stripe made the refund with nobody resubmitting. A row named that
 * was created after the covering refund can't have been in its set, and is
 * never covered by it.
 *
 * **A payment that owes nothing** (owner D81, D85): a failed refund still
 * open on a payment whose one count is £0 (`owedOnPayment`) is covered
 * (`coverWhenNothingOwed`) after every sync (after the metadata cover, so an
 * exact attribution wins), by the hourly backstop, and where the late win
 * and the blocked payment's own refund find nothing owed. It names the
 * newest STANDING refund on the charge, the one that took the last of the
 * money; with none standing, the newest refund that counts, a failed refund
 * settled refunded elsewhere, whose amount the buyer got back another way
 * (D85). Each hit is a missed cover or a refund made outside our code (a
 * full refund in Stripe's Dashboard), so each is alerted at error, once: a
 * covered row is never covered again, and the alert's errorId is made from
 * the payment, the covering refund and the ids (`stableErrorId`), so a pass
 * that meets the same rows logs the same id. While any chargeback on the
 * charge stands lost, or is owed again (`chargebackCarriesDebtOn`), the
 * BANK paid the buyer what that stage carries, so no refund can honestly be
 * named, and its failed refunds are left alone: a blocked payment's debt is
 * that stage's (owner D66), and an ordinary sale's is Codex-1j7fs's (D77).
 *
 * **Locks.** Every cover takes the payment's refunds FOR UPDATE, in id order,
 * before any other row (`lockRefundsOfPayment`: the dispute's late-win id,
 * the purchase). Support's settle locks the charge's refunds the same way,
 * then the dispute FOR SHARE (`refuseIfChargebackDecides`), so the reverse
 * order could deadlock with it. Every refund write elsewhere is one
 * statement, so nothing locks a dispute or a purchase and then a refund.
 *
 * **The residual** (owner D69, D73): support settling a refund of the set
 * between the moment the amount is worked out and the cover. The cover skips
 * a row already settled, but the covering refund included it, so the buyer
 * was paid twice: or, if settled `creators_repaid`, its creators were re-paid
 * for money the buyer got back. A settle waits while the late win is being
 * undone or a blocked payment is still owed its own refund
 * (`REFUND_AWAITS_PAYMENT_REFUND`, review r8), so only support's own refund
 * of all that is left can meet it: two people on one charge during one
 * Stripe call. `settledMeanwhile` returns each such row, and
 * `coverIncludedRefunds` logs it at error, for support to recover by hand
 * (docs/payments/operations.md), on EVERY pass that meets it: the first, and
 * each later one that reads the set back from the refund's metadata (every
 * sync of the charge), whenever it was settled. A row of the set was open
 * when the amount was worked out, by construction (each writer reads its set
 * no later than what its amount subtracts, review r11), so a row of it since
 * settled another way is always a double payment. Its errorId is made from
 * the covering refund and the row (`stableErrorId`), so the repeats are one
 * incident. Only a row covered by ANOTHER refund is logged at info: that
 * refund's amount was worked out with this one counted, so nothing was paid
 * twice.
 */

import type { DatabaseClient } from '@codex/database';
import { purchases, refunds } from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  countedRefundOf,
  refundsOfPayment,
  STANDING_REFUND_STATUSES,
} from './counted-refunds';
import { chargebackCarriesDebtOn, owedOnPayment } from './short-loss';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** The resolution of a failed refund a later refund of everything owed paid. */
const COVERED_BY_REFUND = 'covered_by_refund';

/**
 * The metadata key on a refund of everything owed naming the failed refunds
 * it includes, comma-joined: the set fixed when its amount was worked out
 * (review r9). Written by every writer of such a refund, read back by
 * `coverFromMetadata`.
 */
const COVERS_METADATA_KEY = 'codex_covers';

/** Stripe's limit on one metadata value. */
const STRIPE_METADATA_VALUE_MAX = 500;

/**
 * A deterministic errorId for an alert about the same rows (review r10):
 * every pass that meets them again logs the same id, so the alert collapses
 * into one incident instead of a new one per sync or sweep. A SHA-256 of the
 * alert's `kind` and its `parts`, shaped as a UUID.
 */
export async function stableErrorId(
  kind: string,
  parts: readonly string[]
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode([kind, ...parts].join('\n'))
    )
  );
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * A failed refund of the payment (`refundsOfPayment`) that nothing has
 * settled yet, so it counts nothing: what a refund of everything owed,
 * worked out now, includes. As a predicate on `refunds` (unaliased).
 */
function uncoveredFailedRefundOf(
  purchaseId: string,
  chargeId: string | null
): SQL {
  return sql`(${refundsOfPayment(purchaseId, chargeId)} AND ${refunds.status} = 'failed' AND ${refunds.resolvedAt} IS NULL)`;
}

/**
 * Lock the payment's refunds FOR UPDATE, in id order: a cover's first lock,
 * before any other row (see the header).
 */
async function lockRefundsOfPayment(
  tx: Tx,
  purchaseId: string,
  chargeId: string | null
): Promise<void> {
  await lockRefunds(tx, refundsOfPayment(purchaseId, chargeId));
}

/**
 * Lock the charge's refunds FOR UPDATE, in id order: support's settle's first
 * lock (review r8), the same rows and order as a cover's, so two settles of
 * one charge, or a settle and a cover, queue here and never deadlock.
 */
export async function lockRefundsOfCharge(
  tx: Tx,
  chargeId: string
): Promise<void> {
  await lockRefunds(tx, eq(refunds.stripeChargeId, chargeId));
}

async function lockRefunds(tx: Tx, which: SQL): Promise<void> {
  await tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(which)
    .orderBy(asc(refunds.id))
    .for('update');
}

/** What `coverFailedRefunds` covers, and of which payment. */
export interface CoverInput {
  purchaseId: string;
  chargeId: string | null;
  /** The uncovered failed refunds read when the covering amount was worked out. */
  coveredRefundIds: readonly string[];
  /** The `re_` refund that included them. */
  coveringRefundId: string;
  /**
   * When the covering refund was made (Stripe's `created`, whole seconds),
   * for a set read back from its metadata (`coverFromMetadata`): a refund
   * made after that second can't be in its set.
   */
  includedBefore?: Date;
}

/** A refund of the covered set that something else settled first. */
interface SettledMeanwhile {
  stripeRefundId: string;
  amountCents: number;
  resolution: string | null;
  coveredByRefundId: string | null;
}

/**
 * A row of a covering refund's set settled another way first, as
 * `reportSettledMeanwhile` reported it: the residual's incident, which a
 * caller adds to rather than alerting the same double payment again (the
 * late win's overpaid check, review r11).
 */
interface ResidualReport {
  refundId: string;
  amountCents: number;
  resolution: string | null;
  /** One per covering refund and row (`stableErrorId`), whichever pass reported it. */
  errorId: string;
}

/** What `coverFailedRefunds` did with each id of its set. */
interface CoverWritten {
  covered: string[];
  /** Settled another way first: the residual (see the header). */
  settledMeanwhile: SettledMeanwhile[];
  /** Still open, but made after the covering refund: never in its set. */
  notIncluded: string[];
  /** No refund of this payment: a set naming another payment's refund. */
  unknown: string[];
}

/**
 * Settle every refund of `coveredRefundIds` still open as covered by
 * `coveringRefundId`, inside the caller's transaction, after
 * `lockRefundsOfPayment`. Only open failed rows of this payment are written
 * (made before the covering refund, when that is known), so a redelivery
 * covers nothing twice. Every id it didn't write is read back on this
 * payment alone, and sorted: settled another way first (`settledMeanwhile`,
 * the residual), still open but made after it (`notIncluded`), or no refund
 * of this payment (`unknown`). One this same refund covered earlier is none
 * of them.
 */
async function coverFailedRefunds(
  tx: Tx,
  input: CoverInput,
  resolvedAt: Date
): Promise<CoverWritten> {
  const none: CoverWritten = {
    covered: [],
    settledMeanwhile: [],
    notIncluded: [],
    unknown: [],
  };
  const ids = [...new Set(input.coveredRefundIds)].filter(
    (id) => id !== input.coveringRefundId
  );
  if (ids.length === 0) return none;
  // Within the covering refund's second: Stripe's times are whole seconds.
  const madeBefore =
    input.includedBefore === undefined
      ? sql`TRUE`
      : sql`${refunds.stripeCreatedAt} < ${new Date(input.includedBefore.getTime() + 1000).toISOString()}::timestamptz`;
  const written = await tx
    .update(refunds)
    .set({
      resolution: COVERED_BY_REFUND,
      coveredByRefundId: input.coveringRefundId,
      resolvedAt,
      resolvedByUserId: null,
    })
    .where(
      and(
        inArray(refunds.stripeRefundId, ids),
        uncoveredFailedRefundOf(input.purchaseId, input.chargeId),
        madeBefore
      )
    )
    // The whole row: `.returning({ … })` does not type-check on the
    // `Database | DatabaseWs` union's transaction (TS2554).
    .returning();
  const covered = written.map((row) => row.stripeRefundId);
  const missed = ids.filter((id) => !covered.includes(id));
  if (missed.length === 0) return { ...none, covered };
  const rows = await tx
    .select({
      stripeRefundId: refunds.stripeRefundId,
      amountCents: refunds.amountCents,
      resolvedAt: refunds.resolvedAt,
      resolution: refunds.resolution,
      coveredByRefundId: refunds.coveredByRefundId,
    })
    .from(refunds)
    .where(
      and(
        inArray(refunds.stripeRefundId, missed),
        refundsOfPayment(input.purchaseId, input.chargeId)
      )
    );
  const found = new Set(rows.map((row) => row.stripeRefundId));
  return {
    covered,
    settledMeanwhile: rows.filter(
      (row) =>
        row.resolvedAt !== null &&
        !(
          row.resolution === COVERED_BY_REFUND &&
          row.coveredByRefundId === input.coveringRefundId
        )
    ),
    notIncluded: rows
      .filter((row) => row.resolvedAt === null)
      .map((row) => row.stripeRefundId),
    unknown: missed.filter((id) => !found.has(id)),
  };
}

/**
 * The ids of a payment's uncovered failed refunds (`uncoveredFailedRefundOf`),
 * oldest first, as a column of the caller's own statement, so they come from
 * the same snapshot as whatever else it reads (review r11): a refund's
 * amount and the set it includes, read together, can't disagree. An empty
 * array when there are none (`COALESCE`, never null). The outer query must
 * not be on `refunds`.
 */
export function uncoveredFailedRefundIdsOf(
  purchaseId: string,
  chargeId: string | null
): SQL<string[]> {
  return sql<
    string[]
  >`COALESCE((SELECT json_agg(${refunds.stripeRefundId} ORDER BY ${refunds.stripeCreatedAt}, ${refunds.stripeRefundId}) FROM ${refunds} WHERE ${uncoveredFailedRefundOf(purchaseId, chargeId)}), '[]'::json)`.mapWith(
    refundIdsOf
  );
}

/**
 * The driver's value of `uncoveredFailedRefundIdsOf`'s JSON array: parsed,
 * or its text. Anything else is a defect, never an empty set: an empty set
 * read wrongly would include nothing, and a refund then asked would cover
 * nothing it paid.
 */
function refundIdsOf(value: unknown): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    Array.isArray(parsed) &&
    parsed.every((id): id is string => typeof id === 'string')
  ) {
    return parsed;
  }
  throw new InternalServiceError(
    "A payment's failed refunds were read as something other than a list of ids",
    { received: typeof parsed }
  );
}

/** One read: the uncovered failed refunds of a payment (`uncoveredFailedRefundOf`), their ids. */
export async function uncoveredFailedRefunds(
  db: Tx | DatabaseClient,
  purchaseId: string,
  chargeId: string | null
): Promise<string[]> {
  const rows = await db
    .select({ stripeRefundId: refunds.stripeRefundId })
    .from(refunds)
    .where(uncoveredFailedRefundOf(purchaseId, chargeId))
    .orderBy(asc(refunds.stripeCreatedAt), asc(refunds.stripeRefundId));
  return rows.map((row) => row.stripeRefundId);
}

/** The refund a cover of a payment that owes nothing names, and whether it stands. */
interface NothingOwedCoverer {
  stripeRefundId: string;
  standing: boolean;
}

/**
 * The refund the cover of a payment that owes nothing names, among the
 * refunds that count on one payment's charge (`countedRefundOf`), newest
 * first by Stripe's time, then id: the newest STANDING refund (pending,
 * waiting on the customer, or succeeded), the one that took the last of
 * what was paid (owner D81); with none standing, the newest failed refund
 * settled refunded elsewhere, whose amount the buyer got back another way
 * (owner D85). Null when no refund counts: what the buyer has back is all
 * paid another way or a chargeback's.
 */
async function newestCoveringRefund(
  db: Tx | DatabaseClient,
  purchaseId: string,
  chargeId: string | null
): Promise<NothingOwedCoverer | null> {
  const standing = sql<boolean>`(${inArray(refunds.status, [...STANDING_REFUND_STATUSES])})`;
  const [newest] = await db
    .select({ stripeRefundId: refunds.stripeRefundId, standing })
    .from(refunds)
    .where(countedRefundOf(purchaseId, chargeId))
    .orderBy(
      desc(standing),
      desc(refunds.stripeCreatedAt),
      desc(refunds.stripeRefundId)
    )
    .limit(1);
  return newest ?? null;
}

interface CoverLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * The metadata that records a refund's covered set (`codex_covers`), for
 * every writer of a refund of everything owed to send with it: nothing for
 * an empty set. A set too long for one Stripe value is not recorded, and is
 * alerted at error with the ids: the request still covers it once Stripe
 * makes the refund, but a later pass can't (the cover of a payment that owes
 * nothing then names the newest refund that counts instead).
 */
export function coversMetadata(
  coveredRefundIds: readonly string[],
  obs: CoverLogger,
  context: Record<string, unknown>
): Record<string, string> {
  if (coveredRefundIds.length === 0) return {};
  const value = coveredRefundIds.join(',');
  if (value.length <= STRIPE_METADATA_VALUE_MAX) {
    return { [COVERS_METADATA_KEY]: value };
  }
  obs.error(
    'A refund of everything owed includes more failed refunds than its Stripe metadata can name, so only this request can cover them: if it fails after Stripe makes the refund, they are covered later by the newest refund that counts instead',
    { errorId: crypto.randomUUID(), ...context, coveredRefundIds }
  );
  return {};
}

/**
 * The failed refunds a refund's metadata says it includes (`codex_covers`).
 * Metadata can be edited in the Dashboard, so each is only a candidate: a
 * cover writes only an open failed refund of the same payment made before
 * the covering refund.
 */
function coveredRefundIdsOf(refund: Pick<Stripe.Refund, 'metadata'>): string[] {
  const value = refund.metadata?.[COVERS_METADATA_KEY];
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 255 && !id.includes('\0'));
}

/**
 * Cover the failed refunds a refund of everything owed included, and make
 * `alongside`'s writes, in one transaction that locks the payment's refunds
 * before anything else (`lockRefundsOfPayment`, `coverFailedRefunds`). Each
 * writer of such a refund calls it: the late win's, the blocked payment's
 * own, and support's refund of all that is left on the charge page. A row of
 * the set settled meanwhile is the accepted residual (see the header): the
 * covering refund included it, so the buyer was paid twice for it (or its
 * creators re-paid). That is alerted at error, with an errorId and the ids,
 * for support to recover by hand, as is a set naming refunds it can't hold.
 */
export async function coverIncludedRefunds<T>(
  deps: { db: DatabaseClient; obs: CoverLogger },
  cover: CoverInput,
  alongside: (tx: Tx) => Promise<T>
): Promise<T> {
  return (await coverAndReport(deps, cover, alongside)).result;
}

/**
 * `coverIncludedRefunds`, also returning the residual it reported
 * (`reportSettledMeanwhile`), for a caller that would otherwise alert the
 * same double payment a second time.
 */
async function coverAndReport<T>(
  deps: { db: DatabaseClient; obs: CoverLogger },
  cover: CoverInput,
  alongside: (tx: Tx) => Promise<T>
): Promise<{ result: T; residual: ResidualReport[] }> {
  // A bound instant, not now() (data-access contract, rule 6).
  const resolvedAt = new Date();
  const { result, ...written } = await deps.db.transaction(async (tx) => {
    await lockRefundsOfPayment(tx, cover.purchaseId, cover.chargeId);
    const covered = await coverFailedRefunds(tx, cover, resolvedAt);
    return { ...covered, result: await alongside(tx) };
  });
  const ids = {
    purchaseId: cover.purchaseId,
    chargeId: cover.chargeId,
    coveringRefundId: cover.coveringRefundId,
  };
  if (written.covered.length > 0) {
    deps.obs.info('Failed refunds covered by a refund of everything owed', {
      ...ids,
      coveredRefundIds: written.covered,
    });
  }
  const residual: ResidualReport[] = [];
  for (const row of written.settledMeanwhile) {
    residual.push(await reportSettledMeanwhile(deps.obs, cover, row));
  }
  if (written.unknown.length > 0 || written.notIncluded.length > 0) {
    deps.obs.error(
      "A refund of everything owed names failed refunds it can't have included (another payment's, or made after it), so they were not covered: check its metadata in Stripe",
      {
        errorId: await stableErrorId('not_included', [
          cover.coveringRefundId,
          ...[...written.unknown, ...written.notIncluded].sort(),
        ]),
        ...ids,
        unknownRefundIds: written.unknown,
        notIncludedRefundIds: written.notIncluded,
      }
    );
  }
  return { result, residual };
}

/**
 * A row of the covered set settled another way first: the residual (see the
 * header). Settled refunded elsewhere or "Re-pay payees", it is a double
 * payment, at error on every pass that meets it, under one errorId per
 * covering refund and row (`stableErrorId`), so the repeats are one
 * incident. Covered by another refund, it is not, and is logged at info
 * under the same id. Returns what it reported.
 */
async function reportSettledMeanwhile(
  obs: CoverLogger,
  cover: CoverInput,
  row: SettledMeanwhile
): Promise<ResidualReport> {
  const errorId = await stableErrorId('refunded_twice', [
    cover.coveringRefundId,
    row.stripeRefundId,
  ]);
  const facts = {
    errorId,
    purchaseId: cover.purchaseId,
    chargeId: cover.chargeId,
    coveringRefundId: cover.coveringRefundId,
    refundId: row.stripeRefundId,
    resolution: row.resolution,
    coveredByRefundId: row.coveredByRefundId,
  };
  if (row.resolution === COVERED_BY_REFUND) {
    obs.info(
      'A refund of everything owed included a failed refund another refund covered first, so nothing was paid twice',
      facts
    );
  } else {
    obs.error(
      'A refund of everything owed included a failed refund that support settled before it was recorded, so the buyer was refunded twice for it, or its creators re-paid: recover it by hand',
      facts
    );
  }
  return {
    refundId: row.stripeRefundId,
    amountCents: row.amountCents,
    resolution: row.resolution,
    errorId,
  };
}

/**
 * Cover the set a refund's metadata records (`codex_covers`) with that
 * refund, and make `alongside`'s writes, in one transaction
 * (`coverIncludedRefunds`): the one way any pass after the first covers it
 * (review r9). Rows already covered by it, or settled since, are never
 * written again, so it can run any number of times. Returns `alongside`'s
 * result and the residual it reported (`reportSettledMeanwhile`).
 */
export async function coverFromMetadata<T>(
  deps: { db: DatabaseClient; obs: CoverLogger },
  payment: { purchaseId: string; chargeId: string },
  refund: Pick<Stripe.Refund, 'id' | 'created' | 'metadata'>,
  alongside: (tx: Tx) => Promise<T>
): Promise<{ result: T; residual: ResidualReport[] }> {
  return coverAndReport(
    deps,
    {
      purchaseId: payment.purchaseId,
      chargeId: payment.chargeId,
      coveredRefundIds: coveredRefundIdsOf(refund),
      coveringRefundId: refund.id,
      includedBefore: new Date(refund.created * 1000),
    },
    alongside
  );
}

/**
 * Cover the set each of a charge's listed refunds records (`coverFromMetadata`),
 * oldest first, so a failed refund two of them name is the first one's: the
 * sync's exact covers (review r9), before the cover of a payment that owes
 * nothing (`coverWhenNothingOwed`).
 */
export async function coverRecordedSets(
  deps: { db: DatabaseClient; obs: CoverLogger },
  payment: { purchaseId: string; chargeId: string },
  listed: ReadonlyArray<Pick<Stripe.Refund, 'id' | 'created' | 'metadata'>>
): Promise<void> {
  const recording = listed
    .filter((refund) => coveredRefundIdsOf(refund).length > 0)
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  for (const refund of recording) {
    await coverFromMetadata(deps, payment, refund, async () => undefined);
  }
}

/**
 * What `coverWhenNothingOwed` found under its lock, when the payment owes
 * nothing and no stage carries its debt: the refund it names (null when no
 * refund counts), the failed refunds open then, and those it covered.
 */
interface NothingOwed {
  coverer: NothingOwedCoverer | null;
  open: string[];
  covered: string[];
}

/** What `coverWhenNothingOwed` did, and its `alongside`'s result. */
interface NothingOwedCovered<T> {
  /** The refund named (owner D81, D85); null when something is owed, a stage carries the debt, or no refund counts. */
  coveringRefundId: string | null;
  covered: string[];
  result: T | undefined;
}

/**
 * Cover every failed refund still open on a payment that owes nothing (owner
 * D81, D85), and make `alongside`'s writes, in one transaction that locks
 * the payment's refunds first (`lockRefundsOfPayment`). Under that lock it
 * reads everything it acts on: the one count (`owedOnPayment`), the carry
 * (`chargebackCarriesDebtOn`: while any chargeback on the charge stands
 * lost or is owed again, the bank paid the buyer what that stage carries,
 * so no refund can honestly be named), the open failed refunds, and the
 * refund it names (`newestCoveringRefund`: the newest standing refund, else
 * the newest one settled refunded elsewhere). So a refund that fails before
 * the lock is never named, and anything owed covers nothing.
 *
 * Every "nothing owed" goes through here: the sync (after its metadata
 * cover), the hourly backstop, the late win's "none" and the blocked
 * payment's own refund with nothing to ask. Each hit is a missed cover or a
 * refund made outside our code, so each is alerted at error, once
 * (`stableErrorId`; a covered row is never covered again). With no refund
 * that counts, nothing is covered, and that is alerted the same way.
 * `alongside` gets the refund named, or null, and runs whatever was found.
 * `boundedLock` gives up a lock held elsewhere after 5 s (`lock_timeout`),
 * so one held charge never stalls a batch. `source` names the caller.
 */
export async function coverWhenNothingOwed<T = undefined>(
  deps: { db: DatabaseClient; obs: CoverLogger },
  payment: { purchaseId: string; chargeId: string | null },
  source: string,
  options: {
    alongside?: (tx: Tx, coveringRefundId: string | null) => Promise<T>;
    boundedLock?: boolean;
  } = {}
): Promise<NothingOwedCovered<T>> {
  const resolvedAt = new Date();
  const { found, result } = await deps.db.transaction(async (tx) => {
    if (options.boundedLock) {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    }
    await lockRefundsOfPayment(tx, payment.purchaseId, payment.chargeId);
    const owing = await nothingOwedUnderLock(tx, payment, resolvedAt);
    return {
      found: owing,
      result: await options.alongside?.(
        tx,
        owing?.coverer?.stripeRefundId ?? null
      ),
    };
  });
  if (found !== null) await alertNothingOwed(deps.obs, payment, source, found);
  return {
    coveringRefundId: found?.coverer?.stripeRefundId ?? null,
    covered: found?.covered ?? [],
    result,
  };
}

/**
 * `coverWhenNothingOwed`'s reads and cover, under its lock: null when the
 * payment owes something or a stage carries its debt.
 */
async function nothingOwedUnderLock(
  tx: Tx,
  payment: { purchaseId: string; chargeId: string | null },
  resolvedAt: Date
): Promise<NothingOwed | null> {
  const { purchaseId, chargeId } = payment;
  const [state] = await tx
    .select({
      owedCents: owedOnPayment(purchases.id, chargeId),
      // No charge, no chargeback: a dispute is always on a charge.
      carried:
        chargeId === null
          ? sql<boolean>`FALSE`
          : sql<boolean>`${chargebackCarriesDebtOn(chargeId)}`,
    })
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .limit(1);
  if (!state || state.owedCents > 0 || state.carried) return null;
  const coverer = await newestCoveringRefund(tx, purchaseId, chargeId);
  const open = await uncoveredFailedRefunds(tx, purchaseId, chargeId);
  if (coverer === null || open.length === 0) {
    return { coverer, open, covered: [] };
  }
  const written = await coverFailedRefunds(
    tx,
    {
      purchaseId,
      chargeId,
      coveredRefundIds: open,
      coveringRefundId: coverer.stripeRefundId,
    },
    resolvedAt
  );
  return { coverer, open, covered: written.covered };
}

/**
 * `coverWhenNothingOwed`'s alerts, at error, each with a deterministic
 * errorId (`stableErrorId`) so a pass that meets the same rows logs the same
 * one: what was covered and by which refund, standing or settled elsewhere
 * (owner D85); or, with no refund that counts, what stays open.
 */
async function alertNothingOwed(
  obs: CoverLogger,
  payment: { purchaseId: string; chargeId: string | null },
  source: string,
  found: NothingOwed
): Promise<void> {
  if (found.open.length === 0) return;
  const ids = {
    purchaseId: payment.purchaseId,
    chargeId: payment.chargeId,
    source,
  };
  const { coverer } = found;
  if (coverer === null) {
    obs.error(
      'Failed refunds are open on a payment that owes nothing, and no refund on its charge counts to cover them (all it has back was paid another way or by a chargeback), so they stay in Failed refunds: check the charge on the support page',
      {
        errorId: await stableErrorId('owes_nothing_no_coverer', [
          payment.purchaseId,
          payment.chargeId ?? '',
          ...[...found.open].sort(),
        ]),
        ...ids,
        failedRefundIds: found.open,
      }
    );
    return;
  }
  if (found.covered.length === 0) return;
  obs.error(
    coverer.standing
      ? "Failed refunds were open on a payment that owes nothing, so the newest standing refund covered them: a cover was missed, or a refund was made outside our code (such as a full refund in Stripe's Dashboard)"
      : 'Failed refunds were open on a payment that owes nothing and no refund stands on its charge, so the newest failed refund settled refunded elsewhere covered them: a cover was missed, or a refund was made outside our code',
    {
      errorId: await stableErrorId('owes_nothing_covered', [
        payment.purchaseId,
        payment.chargeId ?? '',
        coverer.stripeRefundId,
        ...[...found.covered].sort(),
      ]),
      ...ids,
      coveringRefundId: coverer.stripeRefundId,
      coveredRefundIds: found.covered,
    }
  );
}
