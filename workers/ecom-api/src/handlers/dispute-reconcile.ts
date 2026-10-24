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
 *   unpaid slices, and its paid ones are never reversed;
 * - a chargeback whose opening failed after it was recorded leaves the buyer
 *   with access, the subscription billing, and the paid slices unreversed.
 *
 * Two sources. Each dispute is re-read from Stripe, then run through the
 * webhook's own `processDispute`:
 * 1. **Stripe's events** (`charge.dispute.*`) of the last 4 days: the 3-day
 *    retry span plus slack, well inside Stripe's 30-day event retention. Each
 *    dispute's furthest snapshot is compared with our row. This catches missed
 *    creates, updates and closes, a dispute we never recorded, and an open
 *    chargeback whose opening failed. The last 15 minutes are left to the
 *    webhook, which Stripe is still delivering.
 * 2. **Our rows** with a final status whose outcome was never applied, of any
 *    age, but not written in the last 15 minutes (the webhook's). This
 *    catches an outcome step that keeps failing (owner decision 2026-10-23,
 *    "Retry hourly, alert": no new state; it is retried every run and alerted
 *    at error, with an errorId, each time).
 *
 * A dispute is acted on when we have no row, when its record would move to a
 * later stage (inquiry, then chargeback, then closed), when it is final and
 * not yet applied, or when it is an open chargeback. Nothing records that a
 * chargeback's opening finished, so an open one is re-run while its events
 * are in the window. That re-run writes no second streaming block: the
 * database pause it re-applies is what refuses access, and the block is only a
 * short-lived stopgap. Idempotent by construction: `recordDispute` is forward
 * only, the access pauses and the clawback steps are, the re-pay keys on
 * `repaid_by_payout_id`, and `markDisputeOutcomeApplied` stops a rerun.
 * Another environment's dispute is ignored, as by the webhook (production and
 * development share one Stripe sandbox).
 *
 * Never throws: each source, each page of events and each dispute fails on its
 * own, and is logged at error with an errorId.
 */

import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  DISPUTE_INQUIRY_STATUSES,
} from '@codex/constants';
import type { ObservabilityClient } from '@codex/observability';
import type Stripe from 'stripe';
import {
  type AccessEffects,
  type DisputeDeps,
  processDispute,
} from './payment-webhook';

/** Stripe's 3-day webhook retry span, plus a day of slack. */
export const DISPUTE_EVENT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

/** Events younger than this are the webhook's: Stripe is still delivering. */
export const DISPUTE_RECONCILE_GRACE_MS = 15 * 60 * 1000;

/** Final-but-unapplied rows retried per run; the rest wait an hour. */
export const DISPUTE_RECONCILE_LIMIT = 50;

/** Events read per page, and the pages read per run. */
export const DISPUTE_EVENT_PAGE_SIZE = 100;
export const DISPUTE_EVENT_MAX_PAGES = 10;

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
  const result: DisputeReconcileResult = {
    fromEvents: 0,
    fromRows: 0,
    acted: 0,
    failed: 0,
  };
  const handled = new Set<string>();

  /**
   * Re-read the dispute from Stripe and handle it as it is now, not as an
   * event's snapshot had it. `recordedStatus` is our row's, if any.
   */
  const settle = async (
    disputeId: string,
    recordedStatus: string | undefined
  ): Promise<void> => {
    handled.add(disputeId);
    let live: Stripe.Dispute;
    try {
      live = await stripe.disputes.retrieve(disputeId);
    } catch (error) {
      result.failed++;
      obs.error(
        'A dispute could not be read from Stripe by the hourly reconcile; the next run retries it',
        {
          errorId: crypto.randomUUID(),
          disputeId,
          recordedStatus: recordedStatus ?? null,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return;
    }
    // Re-running a chargeback that was already open writes no second block.
    const reopening =
      recordedStatus !== undefined &&
      stageOf(recordedStatus) === CHARGEBACK_STAGE &&
      stageOf(live.status) === CHARGEBACK_STAGE;
    const effects = reopening ? withoutNewBlock(deps.effects) : deps.effects;
    try {
      if (
        (await processDispute(live, { ...deps, effects }, TRIGGER)) === 'acted'
      ) {
        result.acted++;
      }
    } catch (error) {
      result.failed++;
      obs.error(
        'A dispute could not be settled by the hourly reconcile; the next run retries it',
        {
          errorId: crypto.randomUUID(),
          disputeId,
          status: live.status,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  };

  // ── 1. Stripe's events ──────────────────────────────────────────────────
  const snapshots = await furthestDisputeSnapshots(
    stripe,
    new Date(now.getTime() - DISPUTE_EVENT_WINDOW_MS),
    new Date(now.getTime() - DISPUTE_RECONCILE_GRACE_MS),
    obs
  );
  result.fromEvents = snapshots.size;
  if (snapshots.size > 0) {
    try {
      const recorded = new Map(
        (await purchase.findDisputeRecords([...snapshots.keys()])).map(
          (row) => [row.stripeDisputeId, row]
        )
      );
      for (const snapshot of snapshots.values()) {
        const record = recorded.get(snapshot.id);
        if (needsSettling(snapshot.status, record)) {
          await settle(snapshot.id, record?.status);
        }
      }
    } catch (error) {
      obs.error(
        "The hourly dispute reconcile could not read our records of the disputes in Stripe's events; the next run retries",
        {
          errorId: crypto.randomUUID(),
          disputes: snapshots.size,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  // ── 2. Our final rows whose outcome was never applied ───────────────────
  try {
    // One more than the limit, to tell a full batch from a cut-off one.
    // Not one written in the grace window: the webhook is still on it.
    const rows = await purchase.findDisputesToReconcile(
      DISPUTE_RECONCILE_LIMIT + 1,
      new Date(now.getTime() - DISPUTE_RECONCILE_GRACE_MS)
    );
    if (rows.length > DISPUTE_RECONCILE_LIMIT) {
      obs.error(
        'The hourly dispute reconcile found more unapplied final disputes than it retries in one run; the oldest are retried first, and any that keep failing hold the rest back',
        { errorId: crypto.randomUUID(), limit: DISPUTE_RECONCILE_LIMIT }
      );
    }
    for (const row of rows.slice(0, DISPUTE_RECONCILE_LIMIT)) {
      if (handled.has(row.stripeDisputeId)) continue;
      result.fromRows++;
      await settle(row.stripeDisputeId, row.status);
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
 * Each dispute's furthest snapshot among the `charge.dispute.*` events
 * created in [from, to]: the one at the latest stage, the newest within a
 * stage (Stripe lists newest first, and orders events created in the same
 * second arbitrarily). A page that cannot be read is alerted; the disputes on
 * the pages before it are still returned.
 */
async function furthestDisputeSnapshots(
  stripe: Stripe,
  from: Date,
  to: Date,
  obs: ObservabilityClient
): Promise<Map<string, Stripe.Dispute>> {
  const furthest = new Map<string, Stripe.Dispute>();
  let startingAfter: string | undefined;
  for (let page = 0; page < DISPUTE_EVENT_MAX_PAGES; page++) {
    let events: Stripe.ApiList<Stripe.Event>;
    try {
      events = await stripe.events.list({
        type: 'charge.dispute.*',
        created: {
          gte: Math.floor(from.getTime() / 1000),
          lte: Math.floor(to.getTime() / 1000),
        },
        limit: DISPUTE_EVENT_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      obs.error(
        "The hourly dispute reconcile could not read a page of Stripe's dispute events; the disputes on the pages before it are still settled, the rest next run",
        {
          errorId: crypto.randomUUID(),
          page,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return furthest;
    }
    for (const event of events.data) {
      const dispute = event.data.object as Stripe.Dispute;
      if (dispute.object !== 'dispute') continue;
      const seen = furthest.get(dispute.id);
      if (!seen || stageOf(dispute.status) > stageOf(seen.status)) {
        furthest.set(dispute.id, dispute);
      }
    }
    const last = events.data[events.data.length - 1];
    if (!events.has_more || !last) return furthest;
    startingAfter = last.id;
  }
  // Volume is near zero; this many in four days means something is wrong.
  obs.error(
    'The hourly dispute reconcile read its page limit of dispute events; older ones in the window were skipped this run',
    {
      errorId: crypto.randomUUID(),
      pages: DISPUTE_EVENT_MAX_PAGES,
      pageSize: DISPUTE_EVENT_PAGE_SIZE,
    }
  );
  return furthest;
}

const CHARGEBACK_STAGE = 1;
const CLOSED_STAGE = 2;

/** Inquiry, then chargeback, then closed: what a dispute's handling acts on. */
function stageOf(status: string): number {
  if ((DISPUTE_INQUIRY_STATUSES as readonly string[]).includes(status)) {
    return 0;
  }
  if (
    (DISPUTE_CHARGEBACK_OPEN_STATUSES as readonly string[]).includes(status)
  ) {
    return CHARGEBACK_STAGE;
  }
  if ((DISPUTE_CLOSED_STATUSES as readonly string[]).includes(status)) {
    return CLOSED_STAGE;
  }
  // A status Stripe added since: `recordDispute` logs and skips it.
  return -1;
}

/**
 * Whether a dispute in Stripe's events needs handling: one we never recorded;
 * or one not yet applied that is final, is an open chargeback (its opening may
 * have failed, and nothing records that it finished), or would move to a
 * later stage. An open inquiry at the same stage has nothing to retry.
 */
function needsSettling(
  stripeStatus: string,
  record: { status: string; outcomeAppliedAt: Date | null } | undefined
): boolean {
  if (!record) return true;
  if (record.outcomeAppliedAt) return false;
  const recordedStage = stageOf(record.status);
  return (
    recordedStage === CLOSED_STAGE ||
    recordedStage === CHARGEBACK_STAGE ||
    stageOf(stripeStatus) > recordedStage
  );
}

/** The same effects, writing no streaming block. */
function withoutNewBlock(effects: AccessEffects): AccessEffects {
  return { ...effects, revokeAccess: () => undefined };
}
