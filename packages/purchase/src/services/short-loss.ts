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
 * One count of what is owed for both (`owedAfterLoss`, D64), read by the loss
 * that writes the refunded amount, the hourly report, the late win's alert
 * and support's charge page, so none of them can disagree (review r3, r4).
 * It counts the refunds the repo's one rule counts (`countedRefundOf`:
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
 * The one count of what a blocked payment's buyer is owed (owner D64, D66):
 * what they paid, less the refunds that count on the charge
 * (`countedRefundOf`, the rule the late win's refund and the restore read;
 * `chargeId` is the dispute's), everything support
 * paid them another way (`paidAnotherWayCents`, null for none) and the
 * chargeback while it stands lost (`lostCents`), never below 0. Read from
 * the refunds, never the row's `refund_amount_cents`: a pending blocked
 * payment records no part refund of its own (owner D59, review r3). A refund
 * that counted at a mark and later fails stops counting, so what is owed
 * rises by it.
 */
function owedCount(
  chargeId: SQLWrapper | string | null,
  paidAnotherWayCents: SQLWrapper | null,
  lostCents: SQLWrapper | number
): SQL<number> {
  const paidAnotherWay =
    paidAnotherWayCents === null
      ? sql`0`
      : sql`COALESCE(${paidAnotherWayCents}, 0)`;
  return sql<number>`GREATEST(0, ${purchases.amountPaidCents} - ${refundTotal(countedRefundOf(purchases.id, chargeId))} - ${paidAnotherWay} - ${lostCents})::int`.mapWith(
    Number
  );
}

/**
 * What a chargeback lost for `lostCents` leaves the outer query's purchase
 * owed before anything is paid another way: the one count (`owedCount`) for
 * a lost dispute with no mark. The loss writes what the buyer has back from
 * it, and for a blocked payment what it leaves is still owed, which the
 * alert at the loss reads. Any other sale lost for less keeps the bank's
 * decision.
 */
export function unrecoveredAfterLoss(
  chargeId: SQLWrapper | string | null,
  lostCents: SQLWrapper | number
): SQL<number> {
  return owedCount(chargeId, null, lostCents);
}

/**
 * What the outer query's purchase is owed on its dispute row (joined as
 * `disputes`): the one count (`owedCount`), less everything paid another
 * way, and less the chargeback only while it stands lost. Once it is won,
 * the bank has taken it back from the buyer.
 */
function owedAfterLoss(): SQL<number> {
  return owedCount(
    disputes.stripeChargeId,
    disputes.paidAnotherWayCents,
    sql`(CASE WHEN ${disputes.status} = ${'lost'} THEN ${disputes.amountCents} ELSE 0 END)`
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
function stageCarriesDebt(stage: ShortLossStage): SQL {
  return stage === 'short'
    ? sql`(${disputes.status} = ${'lost'})`
    : sql`(${disputes.status} = ${'won'} AND ${disputes.lateWonAt} IS NOT NULL AND ${disputes.paidAnotherWayCents} IS NOT NULL AND ${disputes.lateWinRefundId} IS NULL)`;
}

/**
 * The dispute (`disputes`, unaliased) is at a stage that carries a blocked
 * payment's debt (`stageCarriesDebt`, either stage). The ONE rule
 * `findShortLosses`' stages and support's queue read (review r7): a blocked
 * payment's failed refund leaves the queue exactly where a stage counts it,
 * so a debt is in one place, never none.
 */
function chargebackCarriesDebt(): SQL {
  return sql`(${stageCarriesDebt('short')} OR ${stageCarriesDebt('owed_again')})`;
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
      lostCents: disputes.amountCents,
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
      sql`(${blockedPayment()} AND ${purchases.status} = ${PURCHASE_STATUS.REFUNDED} AND ${inStage} AND ${ofCharge})`
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
