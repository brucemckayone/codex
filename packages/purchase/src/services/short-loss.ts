/**
 * A blocked payment is owed back in full, and twice it can be owed money
 * Stripe won't refund (owner D59-D64), each a `ShortLossStage`:
 * - `short`: its chargeback was lost for less than the payment. The bank
 *   returned part, and nobody refunds the rest (D59). Support pays it another
 *   way and marks it on the charge page (D60, D61), which writes the dispute's
 *   `refunded_outside_stripe_at` and what was paid, `paid_another_way_cents`.
 * - `owed_again`: that chargeback was then won late, so the bank took it back
 *   from the buyer, and the late win made no refund (D62). Support pays it
 *   another way and marks it a second time (D63), which writes
 *   `late_win_refunded_outside_stripe_at`.
 *
 * One count of what is owed for both (`owedOnPayment`, D64), read by the
 * hourly report, the late win's alert, support's charge page and its 412,
 * the blocked payment's own refund and the cover of a payment that owes
 * nothing, so none of them can disagree (review r3, r4, r9). It sums every
 * dispute on the charge (owner D82). It counts the refunds the repo's one
 * rule counts (`countedRefundOf`:
 * standing, or failed and settled refunded elsewhere, on the charge), so a
 * failed refund support settled is never owed here as well (owner D66,
 * review r6). A stage stands while anything is owed, whatever marks exist,
 * and each mark ADDS what it pays to `paid_another_way_cents`, which is so
 * everything paid another way (D66). A second mark at the same stage keeps
 * that stage's first date (D71). No date is compared: the first mark is
 * known by its stored amount.
 */

import { PURCHASE_STATUS, type ShortLossStage } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { disputes, purchases, refunds } from '@codex/database/schema';
import {
  and,
  desc,
  eq,
  inArray,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  type BlockedPaymentKind,
  blockedKind,
  blockedPayment,
} from './blocked-payment';
import {
  countedRefundOf,
  refundsOfPayment,
  STANDING_REFUND_STATUSES,
  settledElsewhere,
} from './counted-refunds';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** The columns a debt stage reads: `disputes`' own, or an alias's. */
type StageColumns = Record<
  'status' | 'lateWonAt' | 'paidAnotherWayCents' | 'lateWinRefundId',
  SQLWrapper
>;

/** The total of the refunds `which` picks, a predicate on `refunds` (unaliased). */
function refundTotal(which: SQL): SQL<number> {
  return sql<number>`COALESCE((SELECT SUM(${refunds.amountCents}) FROM ${refunds} WHERE ${which}), 0)::int`.mapWith(
    Number
  );
}

/**
 * The total of the outer query's purchase's refunds (`refundsOfPayment`, on
 * `chargeId`, the dispute's) that `which` picks: a part of the one count, for
 * the page to name.
 */
function refundPart(chargeId: SQLWrapper, which: SQL): SQL<number> {
  return refundTotal(
    sql`(${refundsOfPayment(purchases.id, chargeId)} AND ${which})`
  );
}

/**
 * The disputes of one payment's charge, aliased, so a subquery over them
 * never reads the outer query's `disputes` row as its own (`chargebacksBack`
 * is nested where the outer query joins `disputes`).
 */
const CHARGE_DISPUTES = 'charge_disputes';
const chargeDisputes = alias(disputes, CHARGE_DISPUTES);

/**
 * `FROM` an aliased table, in a raw fragment: drizzle writes an alias there
 * by its name alone, so the table is named before it.
 */
function fromAliased(name: string): SQL {
  return sql`${disputes} AS ${sql.identifier(name)}`;
}

/**
 * What one payment's chargebacks gave back (owner D82): everything support
 * paid another way (`paid_another_way_cents`) and each chargeback while it
 * stands lost, summed over EVERY dispute on its charge (a payment can be
 * disputed more than once, each dispute with its own id: Stripe's "Receiving
 * multiple disputes per payment"; `uq_disputes_stripe_dispute_id` is per
 * dispute). With no charge known, the purchase's own disputes.
 */
function chargebacksBack(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL {
  const ofPayment =
    chargeId === null
      ? sql`${chargeDisputes.purchaseId} = ${purchaseId}`
      : sql`${chargeDisputes.stripeChargeId} = ${chargeId}`;
  return sql`COALESCE((SELECT SUM(COALESCE(${chargeDisputes.paidAnotherWayCents}, 0) + CASE WHEN ${chargeDisputes.status} = ${'lost'} THEN ${chargeDisputes.amountCents} ELSE 0 END) FROM ${fromAliased(CHARGE_DISPUTES)} WHERE ${ofPayment}), 0)`;
}

/**
 * Everything one payment's buyer has back (owner D64, D66, D82): the refunds
 * that count on the charge (`countedRefundOf`: standing, or failed and
 * settled refunded elsewhere), what was paid another way, and the
 * chargebacks while lost (`chargebacksBack`). Read from the refunds, never
 * the row's `refund_amount_cents`: a pending blocked payment records no part
 * refund of its own (owner D59, review r3). A refund that counted and later
 * fails stops counting, so what is owed rises by it.
 */
function paidBackOnPayment(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL {
  return sql`(${refundTotal(countedRefundOf(purchaseId, chargeId))} + ${chargebacksBack(purchaseId, chargeId)})`;
}

/**
 * THE one count of what a payment's buyer is still owed (owner D64, D66,
 * D82): what the outer query's purchase (`purchases`, unaliased) paid, less
 * everything they have back (`paidBackOnPayment`), never below 0. The short
 * losses, the late win's alert, support's 412 (what can still be paid back),
 * the blocked payment's own refund and the cover of a payment that owes
 * nothing all read it, so none of them can disagree (review r9). The outer
 * query must not be on `refunds`: its subquery would read that row as its
 * own.
 */
export function owedOnPayment(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL<number> {
  return sql<number>`GREATEST(0, ${purchases.amountPaidCents} - ${paidBackOnPayment(purchaseId, chargeId)})::int`.mapWith(
    Number
  );
}

/**
 * What the outer query's purchase's buyer has back beyond what they paid
 * (`paidBackOnPayment` less what was paid, never below 0): a refund twice,
 * by the same count as `owedOnPayment` (review r10), which the late win's
 * adoption of its own refund alerts on. The outer query must not be on
 * `refunds`.
 */
export function overpaidOnPayment(
  purchaseId: SQLWrapper | string,
  chargeId: SQLWrapper | string | null
): SQL<number> {
  return sql<number>`GREATEST(0, ${paidBackOnPayment(purchaseId, chargeId)} - ${purchases.amountPaidCents})::int`.mapWith(
    Number
  );
}

/**
 * What a chargeback lost for `lostCents` leaves the outer query's purchase
 * owed before anything is paid another way: what was paid less the refunds
 * that count and the loss being written. Not `owedOnPayment`: the loss runs
 * before its dispute row reads lost, and with no row at all (a dispute we
 * never recorded, `disputeStillLost`), and no mark exists before a loss. The
 * loss writes what the buyer has back from it, and for a blocked payment
 * what it leaves is still owed, which the alert at the loss reads. Any other
 * sale lost for less keeps the bank's decision.
 */
export function unrecoveredAfterLoss(
  chargeId: SQLWrapper | string | null,
  lostCents: SQLWrapper | number
): SQL<number> {
  return sql<number>`GREATEST(0, ${purchases.amountPaidCents} - ${refundTotal(countedRefundOf(purchases.id, chargeId))} - ${lostCents})::int`.mapWith(
    Number
  );
}

/**
 * What the outer query's purchase is owed, on its dispute row (joined as
 * `disputes`): the one count (`owedOnPayment`) on that dispute's charge,
 * every dispute of the charge summed (owner D82).
 */
function owedAfterLoss(): SQL<number> {
  return owedOnPayment(purchases.id, disputes.stripeChargeId);
}

/**
 * What the chargebacks of the outer query's dispute row's charge gave back
 * while lost (`chargebacksBack` without what was paid another way): the
 * "lost" part support's charge page names, so the parts add up to what is
 * owed with any number of disputes (owner D82).
 */
function lostOnCharge(): SQL<number> {
  return sql<number>`COALESCE((SELECT SUM(${chargeDisputes.amountCents}) FROM ${fromAliased(CHARGE_DISPUTES)} WHERE ${chargeDisputes.stripeChargeId} = ${disputes.stripeChargeId} AND ${chargeDisputes.status} = ${'lost'}), 0)::int`.mapWith(
    Number
  );
}

/** A blocked payment owed what Stripe won't refund, at one of its two stages. */
export interface ShortLoss {
  stage: ShortLossStage;
  purchaseId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  stripeDisputeId: string;
  kind: BlockedPaymentKind;
  amountPaidCents: number;
  /** The chargeback's amount: what the bank returned, while it stood lost. */
  lostCents: number;
  /** The refunds standing on the charge: what the buyer has back through Stripe. */
  refundedThroughStripeCents: number;
  /** Its failed refunds support settled refunded elsewhere (owner D55, D66). */
  refundedElsewhereCents: number;
  /** What the buyer is owed now (`owedAfterLoss`): 0 once marks have paid it. */
  owedCents: number;
  currency: string;
  /** When Stripe opened the dispute. */
  openedAt: Date;
  /**
   * `paid_another_way_cents`: everything support paid another way, at either
   * stage, each mark adding to it (owner D66). Null before the first mark.
   */
  paidAnotherWayCents: number | null;
  /** The first mark's date (`refunded_outside_stripe_at`), only with an amount. */
  paidAnotherWayAt: Date | null;
  /** When the chargeback was won late; set at `owed_again`. */
  lateWonAt: Date | null;
  /** The first mark at `owed_again` (`late_win_refunded_outside_stripe_at`). */
  paidAgainAt: Date | null;
}

/**
 * The dispute (`disputes`, unaliased) is at `stage`, the stage that carries a
 * blocked payment's debt while it is in it (owner D66), owed or not:
 * - `short`: it stands lost;
 * - `owed_again`: it was won late after a first mark, and the late win made
 *   no refund of its own (D62 made none). A late win with no mark, or one
 *   whose own refund was made, carries nothing: the chargeback no longer
 *   overlaps any refund, so a refund that fails after it is owed exactly its
 *   own amount, in support's queue (review r7).
 */
function stageCarriesDebt(
  stage: ShortLossStage,
  d: StageColumns = disputes
): SQL {
  return stage === 'short'
    ? sql`(${d.status} = ${'lost'})`
    : sql`(${d.status} = ${'won'} AND ${d.lateWonAt} IS NOT NULL AND ${d.paidAnotherWayCents} IS NOT NULL AND ${d.lateWinRefundId} IS NULL)`;
}

/**
 * The dispute (`disputes`, unaliased) is at a stage that carries a blocked
 * payment's debt (`stageCarriesDebt`, either stage). The ONE rule
 * `findShortLosses`' stages and support's queue read (review r7): a blocked
 * payment's failed refund leaves the queue exactly where a stage counts it,
 * so a debt is in one place, never none.
 */
function chargebackCarriesDebt(d: StageColumns = disputes): SQL {
  return sql`(${stageCarriesDebt('short', d)} OR ${stageCarriesDebt('owed_again', d)})`;
}

/**
 * ANY dispute on charge `chargeId` (a value, or the outer query's column),
 * of a blocked payment or an ordinary sale, stands lost or is owed again
 * (`chargebackCarriesDebt`'s two stages). While one does, the BANK paid the
 * buyer what that stage carries, so no refund can honestly be named as what
 * paid the charge's failed refunds, and the cover of a payment that owes
 * nothing leaves them alone (owner D81; the lead, review r10). A blocked
 * payment's debt is that stage's, its one surface (owner D66). An ordinary
 * sale's failed refund while its chargeback stands lost is Codex-1j7fs's
 * (D77); for it only the lost arm can hold, since the owed-again arm needs
 * `paid_another_way_cents`, which only a blocked payment's mark writes
 * (support's `writePaidAnotherWay`, reached through `findShortLosses`, which
 * selects `blockedPayment()` alone). The outer query must not be on
 * `disputes`.
 */
export function chargebackCarriesDebtOn(chargeId: SQLWrapper | string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${disputes} WHERE ${disputes.stripeChargeId} = ${chargeId} AND ${chargebackCarriesDebt()})`;
}

/**
 * Another dispute of the outer query's purchase, aliased, newer than its
 * joined `disputes` row and also at a debt stage: `findShortLosses` lists a
 * payment once, on its newest such dispute (owner D82).
 */
const NEWER_DISPUTES = 'newer_disputes';
const newerDisputes = alias(disputes, NEWER_DISPUTES);

function newestDebtDispute(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${fromAliased(NEWER_DISPUTES)} WHERE ${newerDisputes.purchaseId} = ${purchases.id} AND ${chargebackCarriesDebt(newerDisputes)} AND (${newerDisputes.stripeCreatedAt}, ${newerDisputes.stripeDisputeId}) > (${disputes.stripeCreatedAt}, ${disputes.stripeDisputeId}))`;
}

/**
 * The dispute (`disputes`, unaliased) carries the debt of refund
 * `stripeRefundId` (a value, or the outer query's `refunds` column): at a
 * stage that carries debt (`chargebackCarriesDebt`), and not the late win's
 * own refund, which is support's queue's (2026-11-09 decisions; one whose id
 * write was lost is adopted by the late win's next run, owner D69). The
 * refund is the dispute's by its charge (`refundOfDispute`), which the caller
 * joins.
 */
export function chargebackCarriesRefund(
  stripeRefundId: SQLWrapper | string
): SQL {
  return sql`(${chargebackCarriesDebt()} AND ${disputes.lateWinRefundId} IS DISTINCT FROM ${stripeRefundId})`;
}

/**
 * The dispute (`disputes`, unaliased) is a late win whose undo has not
 * finished: won after a loss, its outcome not yet applied. The SQL form of
 * `isLateWinBeingUndone` (purchase-service), which every step of the undo
 * keys on. The outcome is applied only once the late win's refund step
 * returns done or none, so while it holds, the late win's refund of what is
 * owed (owner D69) is still being asked for or retried, and support's settle
 * of a refund on its charge waits for it (review r8).
 */
export function lateWinBeingUndone(): SQL {
  return sql`(${disputes.status} = ${'won'} AND ${disputes.lateWonAt} IS NOT NULL AND ${disputes.outcomeAppliedAt} IS NULL)`;
}

/**
 * The blocked payments owed what Stripe won't refund, at `stage` (both when
 * absent): newest first by when it became owed (the late win, else the
 * dispute), up to `limit`, with how many there are in all (`total`, so a
 * long tail beyond the limit is visible). Linked by `disputes.purchase_id`,
 * as the loss is; only a refunded blocked payment. Each while something is
 * owed, whatever marks exist (owner D66): a mark adds what it pays, so one
 * made when less was owed leaves the rest still owed. A stage is
 * `stageCarriesDebt`'s, the rule support's queue defers by:
 * - `short`: the dispute lost;
 * - `owed_again`: the dispute won late after a first mark, no late-win
 *   refund (D62 made none).
 * `includeMarked` adds the ones marked at their stage with nothing owed
 * (support's charge page shows the after-state); `chargeId` narrows it to
 * one charge.
 *
 * ONE row per payment (owner D82), on its newest dispute at a debt stage
 * (`newestDebtDispute`), so `total` counts payments: what is owed sums every
 * dispute on the charge (`owedOnPayment`), and so does the lost part a short
 * one names. A mark goes on that row's dispute, as it always has.
 */
export async function findShortLosses(
  db: DatabaseClient | Tx,
  params: {
    stage?: ShortLossStage;
    chargeId?: string;
    includeMarked: boolean;
    limit: number;
  }
): Promise<{ rows: ShortLoss[]; total: number }> {
  const owedCents = owedAfterLoss();
  const owing = (mark: SQLWrapper): SQL =>
    params.includeMarked
      ? sql`(${mark} IS NOT NULL OR ${owedCents} > 0)`
      : sql`(${owedCents} > 0)`;
  const stages: Record<ShortLossStage, SQL> = {
    short: sql`(${stageCarriesDebt('short')} AND ${owing(disputes.paidAnotherWayCents)})`,
    owed_again: sql`(${stageCarriesDebt('owed_again')} AND ${owing(disputes.lateWinRefundedOutsideStripeAt)})`,
  };
  const inStage =
    params.stage === undefined
      ? sql`(${stages.short} OR ${stages.owed_again})`
      : stages[params.stage];
  const ofCharge =
    params.chargeId === undefined
      ? sql`TRUE`
      : sql`${disputes.stripeChargeId} = ${params.chargeId}`;
  const found = await db
    .select({
      purchaseId: purchases.id,
      stripePaymentIntentId: purchases.stripePaymentIntentId,
      duplicateOfPurchaseId: purchases.duplicateOfPurchaseId,
      refundReason: purchases.refundReason,
      amountPaidCents: purchases.amountPaidCents,
      currency: purchases.currency,
      disputeStatus: disputes.status,
      stripeChargeId: disputes.stripeChargeId,
      stripeDisputeId: disputes.stripeDisputeId,
      // Lost: what every chargeback on the charge returned (the parts add
      // up to what is owed, owner D82). Won late: what this one took back.
      lostCents:
        sql<number>`(CASE WHEN ${disputes.status} = ${'lost'} THEN ${lostOnCharge()} ELSE ${disputes.amountCents} END)::int`.mapWith(
          Number
        ),
      openedAt: disputes.stripeCreatedAt,
      refundedOutsideStripeAt: disputes.refundedOutsideStripeAt,
      paidAnotherWayCents: disputes.paidAnotherWayCents,
      lateWonAt: disputes.lateWonAt,
      paidAgainAt: disputes.lateWinRefundedOutsideStripeAt,
      refundedThroughStripeCents: refundPart(
        disputes.stripeChargeId,
        inArray(refunds.status, [...STANDING_REFUND_STATUSES])
      ),
      refundedElsewhereCents: refundPart(
        disputes.stripeChargeId,
        settledElsewhere()
      ),
      owedCents,
      total: sql<number>`(count(*) OVER ())::int`.mapWith(Number),
    })
    .from(purchases)
    .innerJoin(disputes, eq(disputes.purchaseId, purchases.id))
    .where(
      sql`(${blockedPayment()} AND ${purchases.status} = ${PURCHASE_STATUS.REFUNDED} AND ${inStage} AND ${ofCharge} AND ${newestDebtDispute()})`
    )
    .orderBy(
      desc(sql`COALESCE(${disputes.lateWonAt}, ${disputes.stripeCreatedAt})`),
      desc(disputes.stripeDisputeId)
    )
    .limit(params.limit);
  const rows = found.flatMap((row): ShortLoss[] => {
    const kind = blockedKind(row);
    if (kind === null) return [];
    return [
      {
        stage: row.disputeStatus === 'lost' ? 'short' : 'owed_again',
        purchaseId: row.purchaseId,
        stripePaymentIntentId: row.stripePaymentIntentId,
        stripeChargeId: row.stripeChargeId,
        stripeDisputeId: row.stripeDisputeId,
        kind,
        amountPaidCents: row.amountPaidCents,
        lostCents: row.lostCents,
        refundedThroughStripeCents: row.refundedThroughStripeCents,
        refundedElsewhereCents: row.refundedElsewhereCents,
        owedCents: row.owedCents,
        currency: row.currency,
        openedAt: row.openedAt,
        paidAnotherWayCents: row.paidAnotherWayCents,
        // The first mark is known by its amount: another writer of the date
        // (a late win settled by hand) is not this mark.
        paidAnotherWayAt:
          row.paidAnotherWayCents === null ? null : row.refundedOutsideStripeAt,
        lateWonAt: row.lateWonAt,
        paidAgainAt: row.paidAgainAt,
      },
    ];
  });
  return { rows, total: found[0]?.total ?? 0 };
}

/**
 * What one dispute leaves a purchase's buyer owed now (`owedAfterLoss`), and
 * what was paid them another way: the late win's alert on a charge marked
 * paid another way (owner D62, D64). The purchase is the dispute's own
 * (`disputes.purchase_id`), as the loss links it. Undefined when the dispute
 * isn't recorded, or isn't that purchase's.
 */
export async function owedOnDispute(
  db: DatabaseClient | Tx,
  params: { purchaseId: string; stripeDisputeId: string }
): Promise<
  { owedCents: number; paidAnotherWayCents: number | null } | undefined
> {
  const [row] = await db
    .select({
      owedCents: owedAfterLoss(),
      paidAnotherWayCents: disputes.paidAnotherWayCents,
    })
    .from(disputes)
    .innerJoin(purchases, eq(purchases.id, disputes.purchaseId))
    .where(
      and(
        eq(disputes.stripeDisputeId, params.stripeDisputeId),
        eq(disputes.purchaseId, params.purchaseId)
      )
    )
    .limit(1);
  return row;
}
