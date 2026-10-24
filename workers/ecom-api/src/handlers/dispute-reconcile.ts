/**
 * Dispute reconcile (Codex-2hxff.58; design in docs/payments/dispute-record.md
 * §9). Hourly, on the payouts cron.
 *
 * A dispute webhook that fails permanently is answered 200, and Stripe stops
 * redelivering after 3 days. Nothing else would then notice:
 * - a missed close leaves the charge's unpaid slices held for good;
 * - a missed win is never re-paid, and the buyer stays locked out;
 * - a missed loss never cuts the held slices, so the hold never lifts;
 * - a dispute whose events were ALL missed has no row at all: nothing holds its
 *   unpaid slices, and its paid ones are never reversed.
 *
 * Two sources, each run through the webhook's own `processDispute`:
 * 1. **Stripe's events** (`charge.dispute.*`) of the last 4 days: the 3-day
 *    retry span plus slack, well inside Stripe's 30-day event retention. Each
 *    dispute's newest snapshot is compared with our row. This catches missed
 *    creates, updates and closes, and a dispute we never recorded. The last
 *    15 minutes are left to the webhook, which Stripe is still delivering.
 * 2. **Our rows** with a final status whose outcome was never applied, last
 *    updated before that window: re-read from Stripe and applied. This catches
 *    an outcome step that keeps failing (owner decision 2026-10-23, "Retry
 *    hourly, alert": no new state; it is retried every run and alerted at
 *    error, with an errorId, each time).
 *
 * A dispute is acted on only when its record would move to a later stage
 * (inquiry, then chargeback, then closed), or when it is final and not yet
 * applied. A chargeback that is genuinely still open is never re-run, so its
 * buyer is not blocked again. Idempotent by construction: `recordDispute` is
 * forward only, the clawback runs per step, the re-pay keys on
 * `repaid_by_payout_id`, and `markDisputeOutcomeApplied` stops a rerun.
 * Another environment's dispute is ignored, as by the webhook (production and
 * development share one Stripe sandbox).
 *
 * Never throws: each source and each dispute fails on its own, and is logged.
 */

import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  DISPUTE_INQUIRY_STATUSES,
} from '@codex/constants';
import type { ObservabilityClient } from '@codex/observability';
import type Stripe from 'stripe';
import { type DisputeDeps, processDispute } from './payment-webhook';

/** Stripe's 3-day webhook retry span, plus a day of slack. */
export const DISPUTE_EVENT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

/** Events younger than this are the webhook's: Stripe is still delivering. */
export const DISPUTE_RECONCILE_GRACE_MS = 15 * 60 * 1000;

/** Final-but-unapplied rows retried per run; the rest wait an hour. */
export const DISPUTE_RECONCILE_LIMIT = 50;

/** Events read per page, and the pages read per run. */
const EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGES = 10;

const TRIGGER = 'dispute reconcile';

export interface DisputeReconcileDeps extends DisputeDeps {
  obs: ObservabilityClient;
  /** The run's clock (tests). */
  now?: Date;
}

export interface DisputeReconcileResult {
  /** Disputes found in Stripe's events, and final rows of ours retried. */
  fromEvents: number;
  fromRows: number;
  /** Disputes acted on, and ones whose handling failed. */
  acted: number;
  failed: number;
}

export async function runDisputeReconcile(
  deps: DisputeReconcileDeps
): Promise<DisputeReconcileResult> {
  const { stripe, purchase, obs } = deps;
  const now = deps.now ?? new Date();
  const windowStart = new Date(now.getTime() - DISPUTE_EVENT_WINDOW_MS);
  const result: DisputeReconcileResult = {
    fromEvents: 0,
    fromRows: 0,
    acted: 0,
    failed: 0,
  };
  const handled = new Set<string>();

  const settle = async (dispute: Stripe.Dispute): Promise<void> => {
    handled.add(dispute.id);
    try {
      if ((await processDispute(dispute, deps, TRIGGER)) === 'acted') {
        result.acted++;
      }
    } catch (error) {
      result.failed++;
      obs.error(
        'A dispute could not be settled by the hourly reconcile; the next run retries it',
        {
          errorId: crypto.randomUUID(),
          disputeId: dispute.id,
          status: dispute.status,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  };

  // ── 1. Stripe's events ──────────────────────────────────────────────────
  try {
    const latest = await latestDisputeSnapshots(
      stripe,
      windowStart,
      new Date(now.getTime() - DISPUTE_RECONCILE_GRACE_MS),
      obs
    );
    result.fromEvents = latest.size;
    const recorded = new Map(
      (await purchase.findDisputeRecords([...latest.keys()])).map((row) => [
        row.stripeDisputeId,
        row,
      ])
    );
    for (const dispute of latest.values()) {
      if (needsSettling(dispute.status, recorded.get(dispute.id))) {
        await settle(dispute);
      }
    }
  } catch (error) {
    obs.error(
      "The hourly dispute reconcile could not read Stripe's dispute events; the next run retries",
      {
        errorId: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  // ── 2. Our final rows whose outcome was never applied ───────────────────
  try {
    const rows = await purchase.findDisputesToReconcile(
      DISPUTE_RECONCILE_LIMIT,
      windowStart
    );
    for (const row of rows) {
      if (handled.has(row.stripeDisputeId)) continue;
      result.fromRows++;
      let dispute: Stripe.Dispute;
      try {
        dispute = await stripe.disputes.retrieve(row.stripeDisputeId);
      } catch (error) {
        result.failed++;
        handled.add(row.stripeDisputeId);
        obs.error(
          'A dispute could not be read from Stripe by the hourly reconcile; the next run retries it',
          {
            errorId: crypto.randomUUID(),
            disputeId: row.stripeDisputeId,
            status: row.status,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        continue;
      }
      await settle(dispute);
    }
  } catch (error) {
    obs.error(
      'The hourly dispute reconcile could not list unapplied disputes; the next run retries',
      {
        errorId: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  obs.info('dispute reconcile completed', { ...result });
  return result;
}

/**
 * Each dispute's newest snapshot among the `charge.dispute.*` events created
 * in [from, to]. Stripe lists events newest first, and a dispute's status only
 * moves forward, so the first one seen is its furthest.
 */
async function latestDisputeSnapshots(
  stripe: Stripe,
  from: Date,
  to: Date,
  obs: ObservabilityClient
): Promise<Map<string, Stripe.Dispute>> {
  const latest = new Map<string, Stripe.Dispute>();
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const events = await stripe.events.list({
      type: 'charge.dispute.*',
      created: {
        gte: Math.floor(from.getTime() / 1000),
        lte: Math.floor(to.getTime() / 1000),
      },
      limit: EVENT_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const event of events.data) {
      const dispute = event.data.object as Stripe.Dispute;
      if (dispute.object === 'dispute' && !latest.has(dispute.id)) {
        latest.set(dispute.id, dispute);
      }
    }
    const last = events.data[events.data.length - 1];
    if (!events.has_more || !last) return latest;
    startingAfter = last.id;
  }
  // Volume is near zero; this many in four days means something is wrong.
  obs.error(
    'The hourly dispute reconcile read its page limit of dispute events; older ones in the window were skipped this run',
    {
      errorId: crypto.randomUUID(),
      pages: MAX_EVENT_PAGES,
      pageSize: EVENT_PAGE_SIZE,
    }
  );
  return latest;
}

/** Inquiry, then chargeback, then closed: what a dispute's handling acts on. */
function stageOf(status: string): number {
  if ((DISPUTE_INQUIRY_STATUSES as readonly string[]).includes(status)) {
    return 0;
  }
  if (
    (DISPUTE_CHARGEBACK_OPEN_STATUSES as readonly string[]).includes(status)
  ) {
    return 1;
  }
  if ((DISPUTE_CLOSED_STATUSES as readonly string[]).includes(status)) {
    return 2;
  }
  // A status Stripe added since: `recordDispute` logs and skips it.
  return -1;
}

const CLOSED_STAGE = 2;

/**
 * Whether Stripe's snapshot needs handling: a dispute we never recorded; or
 * one not yet applied whose record is final, or would move to a later stage.
 * A move within a stage (`needs_response` to `under_review`) changes nothing
 * the handling does, so it is left alone: re-running an open chargeback would
 * block its buyer again.
 */
function needsSettling(
  stripeStatus: string,
  record: { status: string; outcomeAppliedAt: Date | null } | undefined
): boolean {
  if (!record) return true;
  if (record.outcomeAppliedAt) return false;
  const recordedStage = stageOf(record.status);
  return (
    recordedStage === CLOSED_STAGE || stageOf(stripeStatus) > recordedStage
  );
}
