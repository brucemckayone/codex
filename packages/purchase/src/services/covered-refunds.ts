/**
 * A refund of everything a payment still owes COVERS the failed refunds it
 * included (owner D73; Codex-z1t3c review r8).
 *
 * Three refunds are asked for what was paid less the refunds that count
 * (`countedRefundOf`: standing, or failed and settled refunded elsewhere):
 * - the late win's (`issueLateWinRefund`, owner D69), made or adopted;
 * - its "none" outcome, when the counted refunds already pay it all, which
 *   names the newest standing refund;
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
 * **A payment that owes nothing** (owner D81): after every sync, and in the
 * hourly sweep, a failed refund still open on a payment whose one count is
 * £0 (`owedOnPayment`) is covered by the newest STANDING refund on the
 * charge (`coverWhenNothingOwed`), after the metadata cover, so an exact
 * attribution wins. Each one is a missed cover or a refund made outside our
 * code (a full refund in Stripe's Dashboard), so each is alerted at error. A
 * stage carrying a blocked payment's debt (`chargebackCarriesDebtOn`) is its
 * one surface (owner D66), so its failed refunds are left alone.
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
 * `coverIncludedRefunds` logs it at error, with an errorId, for support to
 * recover by hand (docs/payments/operations.md).
 */

import type { DatabaseClient } from '@codex/database';
import { purchases, refunds } from '@codex/database/schema';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { refundsOfPayment, STANDING_REFUND_STATUSES } from './counted-refunds';
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
  resolution: string | null;
  coveredByRefundId: string | null;
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

/**
 * The newest refund standing on one payment's charge (pending, waiting on
 * the customer, or succeeded): the one that took the last of what was paid,
 * so what a cover names when nothing is owed (owner D81). Null when none
 * stands, as when every refund that counts was paid another way.
 */
export async function newestStandingRefund(
  db: Tx | DatabaseClient,
  purchaseId: string,
  chargeId: string | null
): Promise<string | null> {
  const [newest] = await db
    .select({ stripeRefundId: refunds.stripeRefundId })
    .from(refunds)
    .where(
      and(
        refundsOfPayment(purchaseId, chargeId),
        inArray(refunds.status, [...STANDING_REFUND_STATUSES])
      )
    )
    .orderBy(desc(refunds.stripeCreatedAt), desc(refunds.stripeRefundId))
    .limit(1);
  return newest?.stripeRefundId ?? null;
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
 * nothing then names the newest standing refund instead).
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
    'A refund of everything owed includes more failed refunds than its Stripe metadata can name, so only this request can cover them: if it fails after Stripe makes the refund, they are covered later by the newest standing refund instead',
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
  if (written.settledMeanwhile.length > 0) {
    deps.obs.error(
      'A refund of everything owed included failed refunds that support settled before it was recorded, so the buyer was refunded twice for them, or their creators re-paid: recover it by hand',
      {
        errorId: crypto.randomUUID(),
        ...ids,
        settled: written.settledMeanwhile.map((row) => ({
          refundId: row.stripeRefundId,
          resolution: row.resolution,
          coveredByRefundId: row.coveredByRefundId,
        })),
      }
    );
  }
  if (written.unknown.length > 0 || written.notIncluded.length > 0) {
    deps.obs.error(
      "A refund of everything owed names failed refunds it can't have included (another payment's, or made after it), so they were not covered: check its metadata in Stripe",
      {
        errorId: crypto.randomUUID(),
        ...ids,
        unknownRefundIds: written.unknown,
        notIncludedRefundIds: written.notIncluded,
      }
    );
  }
  return result;
}

/**
 * Cover the set a refund's metadata records (`codex_covers`) with that
 * refund, and make `alongside`'s writes, in one transaction
 * (`coverIncludedRefunds`): the one way any pass after the first covers it
 * (review r9). Rows already covered by it, or settled since, are never
 * written again, so it can run any number of times.
 */
export async function coverFromMetadata<T>(
  deps: { db: DatabaseClient; obs: CoverLogger },
  payment: { purchaseId: string; chargeId: string },
  refund: Pick<Stripe.Refund, 'id' | 'created' | 'metadata'>,
  alongside: (tx: Tx) => Promise<T>
): Promise<T> {
  return coverIncludedRefunds(
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

/** What `coverWhenNothingOwed` found under its lock. */
type NothingOwedCover =
  | { open: string[]; coveringRefundId: string; covered: string[] }
  | { open: string[]; coveringRefundId: null; covered: [] };

/**
 * Cover every failed refund still open on a payment that owes nothing (owner
 * D81): under the payment's refunds lock, when its one count is £0
 * (`owedOnPayment`) and no stage carries its debt (`chargebackCarriesDebtOn`),
 * each is settled `covered_by_refund` by the newest standing refund
 * (`newestStandingRefund`). Each hit is alerted at error, with an errorId
 * and the ids: it is a missed cover or a refund made outside our code. With
 * no standing refund to name, nothing is covered, and that is alerted too.
 * Anything owed covers nothing. Returns what it covered; `source` names the
 * caller in the alert.
 */
export async function coverWhenNothingOwed(
  deps: { db: DatabaseClient; obs: CoverLogger },
  payment: { purchaseId: string; chargeId: string },
  source: string
): Promise<string[]> {
  const resolvedAt = new Date();
  const found = await deps.db.transaction(
    async (tx): Promise<NothingOwedCover | null> => {
      await lockRefundsOfPayment(tx, payment.purchaseId, payment.chargeId);
      const [state] = await tx
        .select({
          owedCents: owedOnPayment(purchases.id, payment.chargeId),
          carried: sql<boolean>`${chargebackCarriesDebtOn(payment.chargeId)}`,
        })
        .from(purchases)
        .where(eq(purchases.id, payment.purchaseId))
        .limit(1);
      if (!state || state.owedCents > 0 || state.carried) return null;
      const open = await uncoveredFailedRefunds(
        tx,
        payment.purchaseId,
        payment.chargeId
      );
      if (open.length === 0) return null;
      const coveringRefundId = await newestStandingRefund(
        tx,
        payment.purchaseId,
        payment.chargeId
      );
      if (coveringRefundId === null) {
        return { open, coveringRefundId: null, covered: [] };
      }
      const written = await coverFailedRefunds(
        tx,
        { ...payment, coveredRefundIds: open, coveringRefundId },
        resolvedAt
      );
      return { open, coveringRefundId, covered: written.covered };
    }
  );
  if (found === null) return [];
  const ids = {
    errorId: crypto.randomUUID(),
    purchaseId: payment.purchaseId,
    chargeId: payment.chargeId,
    source,
  };
  if (found.coveringRefundId === null) {
    deps.obs.error(
      'Failed refunds are open on a payment that owes nothing, and no standing refund on its charge can cover them, so they stay in Failed refunds: check the charge on the support page',
      { ...ids, failedRefundIds: found.open }
    );
    return [];
  }
  deps.obs.error(
    "Failed refunds were open on a payment that owes nothing, so the newest standing refund covered them: a cover was missed, or a refund was made outside our code (such as a full refund in Stripe's Dashboard)",
    {
      ...ids,
      coveringRefundId: found.coveringRefundId,
      coveredRefundIds: found.covered,
    }
  );
  return found.covered;
}
