/**
 * A refund the platform owes that waits for a chargeback (owner D56, widened
 * by D57 and D58): a blocked payment's (a duplicate purchase, or a blocked
 * sale of an item no longer available, Codex-z1t3c) and a duplicate plan's
 * (a second subscription to an org or a course plan, Codex-2hxff.15).
 *
 * Stripe refuses to refund a charge while a chargeback on it is open, so each
 * hourly owed-refund sweep leaves such a row to the dispute while it is open,
 * and only then. The disputes table decides, not the row's own `disputed_at`:
 * only a win clears that mark and a loss refunds the row, so a chargeback
 * that ends any other way (`prevented`, say) or whose close is never seen
 * would hold it forever, with the buyer charged and nobody told. Once the
 * chargeback is no longer open, the next sweep asks Stripe again.
 *
 * Each sweep also reports, at error, any row an open chargeback has held past
 * `CHARGEBACK_HOLD_ALERT_DAYS`, longer than Stripe's dispute lifecycle: a
 * close we never recorded. Once per run, with the row and dispute ids, after
 * the sweep's refunds: a report never stops them.
 */

import { DISPUTE_CHARGEBACK_OPEN_STATUSES } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { disputes } from '@codex/database/schema';
import {
  and,
  asc,
  inArray,
  lt,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** The row kind a dispute names, by its link column. */
export type ChargebackLink = 'purchase' | 'subscription' | 'courseSubscription';

/**
 * How a dispute names what it holds: `purchase_id`, written when it is
 * recorded (by the charge's PaymentIntent), or `subscription_id` /
 * `course_subscription_id`, written when its chargeback first pauses the
 * subscription (by the charge's payout rows, else the invoice Stripe says it
 * paid). An inquiry links too, but is never an open chargeback.
 */
const LINK_COLUMN = {
  purchase: disputes.purchaseId,
  subscription: disputes.subscriptionId,
  courseSubscription: disputes.courseSubscriptionId,
} as const;

/** Past Stripe's dispute lifecycle: an open chargeback this old has a close we missed. */
export const CHARGEBACK_HOLD_ALERT_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

const isOpenChargeback = () =>
  inArray(disputes.status, [...DISPUTE_CHARGEBACK_OPEN_STATUSES]);

/**
 * No open chargeback holds the outer query's row `rowId`. One raw fragment,
 * so no part of it can be dropped (`and()` drops an undefined argument).
 */
export function noOpenChargeback(
  link: ChargebackLink,
  rowId: AnyPgColumn
): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${disputes} WHERE ${LINK_COLUMN[link]} = ${rowId} AND ${isOpenChargeback()})`;
}

interface HoldAlertLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * Report, at error, the owed rows an open chargeback has held past
 * `CHARGEBACK_HOLD_ALERT_DAYS`: one line for the run, naming each row, its
 * dispute and when Stripe opened it. `owed` selects the ids of the sweep's
 * owed rows, held or not. Nothing is refunded here: the row stays held while
 * the chargeback reads open, so support checks the dispute first. Up to
 * `limit` rows, the oldest first. Never throws: a failed check is logged at
 * error on its own, so the sweep that runs it (after its refunds) still
 * returns what it settled.
 */
export async function alertChargebacksHeldTooLong(
  deps: { db: Pick<DatabaseClient, 'select'>; obs: HoldAlertLogger },
  params: {
    link: ChargebackLink;
    owed: SQLWrapper;
    asOf: Date;
    limit: number;
    message: string;
  }
): Promise<void> {
  const column = LINK_COLUMN[params.link];
  const openedBefore = new Date(
    params.asOf.getTime() - CHARGEBACK_HOLD_ALERT_DAYS * DAY_MS
  );
  try {
    const rows = await deps.db
      .select({
        id: column,
        stripeDisputeId: disputes.stripeDisputeId,
        openedAt: disputes.stripeCreatedAt,
      })
      .from(disputes)
      .where(
        and(
          isOpenChargeback(),
          lt(disputes.stripeCreatedAt, openedBefore),
          inArray(column, params.owed)
        )
      )
      .orderBy(asc(disputes.stripeCreatedAt))
      .limit(params.limit);
    if (rows.length === 0) return;
    deps.obs.error(params.message, {
      errorId: crypto.randomUUID(),
      link: params.link,
      held: rows.map((row) => ({
        id: row.id,
        stripeDisputeId: row.stripeDisputeId,
        openedAt: row.openedAt.toISOString(),
      })),
    });
  } catch (error) {
    deps.obs.error(
      `Could not check for chargebacks held past ${CHARGEBACK_HOLD_ALERT_DAYS} days; the sweep's refunds are not affected`,
      {
        errorId: crypto.randomUUID(),
        link: params.link,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
