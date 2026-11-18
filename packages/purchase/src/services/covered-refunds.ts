/**
 * A refund of everything a payment still owes COVERS the failed refunds it
 * included (owner D73; Codex-z1t3c review r8).
 *
 * Three refunds are asked for what was paid less the refunds that count
 * (`countedRefundOf`: standing, or failed and settled refunded elsewhere):
 * - the late win's (`issueLateWinRefund`, owner D69), made or adopted;
 * - its "none" outcome, when the counted refunds already pay it all, which
 *   names the newest of them;
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
 * **Locks.** `coverFailedRefunds` runs after `lockRefundsOfPayment`: the
 * payment's refunds FOR UPDATE, in id order, before any other row (the
 * dispute's late-win id, the purchase). Support's settle locks its refund,
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
import { refunds } from '@codex/database/schema';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { refundsOfPayment } from './counted-refunds';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** The resolution of a failed refund a later refund of everything owed paid. */
const COVERED_BY_REFUND = 'covered_by_refund';

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
}

/** A refund of the covered set that something else settled first. */
interface SettledMeanwhile {
  stripeRefundId: string;
  resolution: string | null;
  coveredByRefundId: string | null;
}

/**
 * Settle every refund of `coveredRefundIds` still open as covered by
 * `coveringRefundId`, inside the caller's transaction, after
 * `lockRefundsOfPayment`. Only open failed rows of this payment are written,
 * so a redelivery covers nothing twice. Returns what it covered, and each
 * row of the set already settled another way (`settledMeanwhile`: the
 * residual, see the header). A row this same refund covered earlier is
 * neither.
 */
async function coverFailedRefunds(
  tx: Tx,
  input: CoverInput,
  resolvedAt: Date
): Promise<{ covered: string[]; settledMeanwhile: SettledMeanwhile[] }> {
  const ids = [...new Set(input.coveredRefundIds)].filter(
    (id) => id !== input.coveringRefundId
  );
  if (ids.length === 0) return { covered: [], settledMeanwhile: [] };
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
        uncoveredFailedRefundOf(input.purchaseId, input.chargeId)
      )
    )
    // The whole row: `.returning({ … })` does not type-check on the
    // `Database | DatabaseWs` union's transaction (TS2554).
    .returning();
  const covered = written.map((row) => row.stripeRefundId);
  const missed = ids.filter((id) => !covered.includes(id));
  if (missed.length === 0) return { covered, settledMeanwhile: [] };
  const rows = await tx
    .select({
      stripeRefundId: refunds.stripeRefundId,
      resolution: refunds.resolution,
      coveredByRefundId: refunds.coveredByRefundId,
    })
    .from(refunds)
    .where(inArray(refunds.stripeRefundId, missed));
  return {
    covered,
    settledMeanwhile: rows.filter(
      (row) =>
        !(
          row.resolution === COVERED_BY_REFUND &&
          row.coveredByRefundId === input.coveringRefundId
        )
    ),
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

interface CoverLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
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
 * for support to recover by hand.
 */
export async function coverIncludedRefunds<T>(
  deps: { db: DatabaseClient; obs: CoverLogger },
  cover: CoverInput,
  alongside: (tx: Tx) => Promise<T>
): Promise<T> {
  // A bound instant, not now() (data-access contract, rule 6).
  const resolvedAt = new Date();
  const { result, covered, settledMeanwhile } = await deps.db.transaction(
    async (tx) => {
      await lockRefundsOfPayment(tx, cover.purchaseId, cover.chargeId);
      const written = await coverFailedRefunds(tx, cover, resolvedAt);
      return { ...written, result: await alongside(tx) };
    }
  );
  if (covered.length > 0) {
    deps.obs.info('Failed refunds covered by a refund of everything owed', {
      purchaseId: cover.purchaseId,
      chargeId: cover.chargeId,
      coveringRefundId: cover.coveringRefundId,
      coveredRefundIds: covered,
    });
  }
  if (settledMeanwhile.length > 0) {
    deps.obs.error(
      'A refund of everything owed included failed refunds that support settled before it was recorded, so the buyer was refunded twice for them, or their creators re-paid: recover it by hand',
      {
        errorId: crypto.randomUUID(),
        purchaseId: cover.purchaseId,
        chargeId: cover.chargeId,
        coveringRefundId: cover.coveringRefundId,
        settled: settledMeanwhile.map((row) => ({
          refundId: row.stripeRefundId,
          resolution: row.resolution,
          coveredByRefundId: row.coveredByRefundId,
        })),
      }
    );
  }
  return result;
}
