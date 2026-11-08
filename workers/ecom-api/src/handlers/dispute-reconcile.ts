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
 * Three sources. Each dispute is re-read from Stripe, then run through the
 * webhook's own `processDispute`:
 * 1. **Stripe's events** (`charge.dispute.*`) of the last 4 days: the 3-day
 *    retry span plus slack, well inside Stripe's 30-day event retention. Each
 *    dispute's furthest snapshot is compared with our row. This catches missed
 *    creates, updates and closes, a dispute we never recorded, and an open
 *    chargeback whose opening failed. The last 15 minutes are left to the
 *    webhook, which Stripe is still delivering. A loss already applied whose
 *    snapshot says won is a late win, and is settled too (Codex-2hxff.70).
 * 2. **Our rows** with a final status whose outcome was never applied, of any
 *    age, but not written in the last 15 minutes (the webhook's). This
 *    catches an outcome step that keeps failing (owner decision 2026-10-23,
 *    "Retry hourly, alert": no new state; it is retried every run and alerted
 *    at error, with an errorId, each time). A late win being undone is won
 *    and unapplied, so a failed undo is retried here.
 * 3. **Our lost rows**, opened in the last 12 months (Q3) and not written in
 *    the last 15 minutes, re-checked for a late win whose events were missed
 *    (Codex-2hxff.70; late-win data design §5). None: no Stripe read. Else
 *    Stripe's disputes since the oldest of them, newest first, at most 3
 *    pages; each of ours Stripe has as won is settled, at most 10 a run.
 *    Production and development share one Stripe sandbox, so the list holds
 *    the other's disputes too: only our rows are acted on.
 *
 * The 08:00 London run, which pays the banks and has no subrequests to spare,
 * finds no new late wins (`lateWins: false`): no source 3, and source 1 leaves
 * applied losses alone. The next hour's run picks them up. Source 2 still
 * retries a late win already being undone, as it retries any unapplied row.
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
 * own, and is logged at error with an errorId. A late win's refund that Stripe
 * did not make is the one exception: its own step alerts it at error, and the
 * reconcile adds a warn, so each attempt alerts once.
 */

import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  DISPUTE_INQUIRY_STATUSES,
} from '@codex/constants';
import type { ObservabilityClient } from '@codex/observability';
import { LateWinRefundRefusedError, WinSettlingError } from '@codex/purchase';
import type Stripe from 'stripe';
import { describeRootCause } from '../utils/error-classification';
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

/** Source 3 re-checks lost disputes opened this many months ago at most (Q3). */
const LATE_WIN_LOOKBACK_MONTHS = 12;
/** Late wins source 3 settles per run; the rest wait an hour (§10). */
export const LATE_WIN_LIMIT = 10;
/** Stripe's disputes read per page, and the pages read per run. */
export const LATE_WIN_PAGE_SIZE = 100;
export const LATE_WIN_MAX_PAGES = 3;

const TRIGGER = 'dispute reconcile';

/**
 * A dispute the reconcile could not settle, logged once. Two are a warn with
 * ids only, no errorId (Codex-2hxff.70):
 *
 * - a late win's refund that Stripe did not make: its own step alerted it at
 *   error (payment-webhook.ts `refundFirstPayment`), with what Stripe
 *   answered, so a second alert would only repeat it;
 * - a clawback waiting for a won chargeback on the charge to settle
 *   (`WinSettlingError`, which names it as `settlingDisputeId`): another
 *   dispute's, or this one's own, when the reconcile re-runs an unfinished
 *   loss a late win overtook (S1's race). Waiting is not a fault (late-win
 *   data design §11), and the next run retries it.
 *
 * Any other failure is alerted at error with an errorId and the innermost
 * error (`describeRootCause`), since a service's wrap names only itself.
 */
function logUnsettled(
  obs: ObservabilityClient,
  disputeId: string,
  live: Stripe.Dispute,
  error: unknown
): void {
  const warning = settleWarning(disputeId, live, error);
  if (warning) {
    obs.warn(warning.message, warning.fields);
    return;
  }
  obs.error(
    'A dispute could not be settled by the hourly reconcile; the next run retries it',
    {
      errorId: crypto.randomUUID(),
      disputeId,
      status: live.status,
      error: error instanceof Error ? error.message : String(error),
      cause: describeRootCause(error),
    }
  );
}

/** `logUnsettled`'s two warns, ids only; undefined for a failure to alert. */
function settleWarning(
  disputeId: string,
  live: Stripe.Dispute,
  error: unknown
): { message: string; fields: Record<string, unknown> } | undefined {
  if (error instanceof LateWinRefundRefusedError) {
    return {
      message:
        "A late win's settle stopped at its refund, which the refund step has already alerted; the next run retries it",
      fields: {
        disputeId,
        purchaseId: error.context?.purchaseId ?? null,
        chargeId: chargeIdOf(live),
      },
    };
  }
  if (error instanceof WinSettlingError) {
    return {
      message:
        "A dispute's settle waits for a won chargeback on its charge to settle; the next run retries it",
      fields: {
        disputeId,
        chargeId: error.context?.chargeId ?? null,
        settlingDisputeId: error.context?.disputeId ?? null,
      },
    };
  }
  return undefined;
}

/** The dispute's charge id, whether Stripe expanded the charge or not. */
function chargeIdOf(live: Stripe.Dispute): string | null {
  return typeof live.charge === 'string'
    ? live.charge
    : (live.charge?.id ?? null);
}

export interface DisputeReconcileDeps extends DisputeDeps {
  obs: ObservabilityClient;
  /**
   * Look for late wins (Codex-2hxff.70): source 3, and source 1's applied
   * losses. Off on the 08:00 London run, the bank payout's.
   */
  lateWins: boolean;
  /** The run's clock (tests). */
  now?: Date;
}

export interface DisputeReconcileResult {
  /** Disputes found in Stripe's events, and final rows of ours retried. */
  fromEvents: number;
  fromRows: number;
  /** Lost rows of ours Stripe has as won, settled by source 3. */
  fromLostRows: number;
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
    fromLostRows: 0,
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
      logUnsettled(obs, disputeId, live, error);
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
        if (needsSettling(snapshot.status, record, deps.lateWins)) {
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

  // ── 3. Our lost rows, re-checked for a late win (Codex-2hxff.70) ──────
  if (deps.lateWins) {
    try {
      const lost = await purchase.findLostDisputesToRecheck({
        since: monthsBefore(now, LATE_WIN_LOOKBACK_MONTHS),
        updatedBefore: new Date(now.getTime() - DISPUTE_RECONCILE_GRACE_MS),
        // As many as the pages below can list.
        limit: LATE_WIN_PAGE_SIZE * LATE_WIN_MAX_PAGES,
      });
      if (lost.length > 0) {
        const oldest = Math.min(
          ...lost.map((row) => new Date(row.stripeCreatedAt).getTime())
        );
        const won = await wonAmong(
          stripe,
          new Set(lost.map((row) => row.stripeDisputeId)),
          Math.floor(oldest / 1000),
          obs
        );
        for (const disputeId of won) {
          if (handled.has(disputeId)) continue;
          if (result.fromLostRows === LATE_WIN_LIMIT) break;
          result.fromLostRows++;
          await settle(disputeId, 'lost');
        }
      }
    } catch (error) {
      obs.error(
        'The hourly dispute reconcile could not re-check lost disputes for a late win; the next run retries',
        {
          errorId: crypto.randomUUID(),
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  obs.info('dispute reconcile completed', { ...result });
  return result;
}

/** `at` less whole calendar months (UTC). */
function monthsBefore(at: Date, months: number): Date {
  const before = new Date(at);
  before.setUTCMonth(before.getUTCMonth() - months);
  return before;
}

/**
 * The ids in `ours` that Stripe has as won, newest first, among its disputes
 * created since `createdFrom` (seconds). Past the page limit is alerted:
 * the older ones wait. A page that cannot be read is alerted; the ones found
 * on the pages before it are still returned.
 */
async function wonAmong(
  stripe: Stripe,
  ours: ReadonlySet<string>,
  createdFrom: number,
  obs: ObservabilityClient
): Promise<string[]> {
  const won: string[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < LATE_WIN_MAX_PAGES; page++) {
    const disputes = await disputesPage(
      stripe,
      { createdFrom, startingAfter, page },
      obs
    );
    if (!disputes) return won;
    for (const dispute of disputes.data) {
      if (dispute.status === 'won' && ours.has(dispute.id)) {
        won.push(dispute.id);
      }
    }
    const last = disputes.data[disputes.data.length - 1];
    if (!disputes.has_more || !last) return won;
    startingAfter = last.id;
  }
  obs.error(
    "The hourly late-win check read its page limit of Stripe's disputes; older lost disputes were not re-checked this run",
    {
      errorId: crypto.randomUUID(),
      pages: LATE_WIN_MAX_PAGES,
      pageSize: LATE_WIN_PAGE_SIZE,
    }
  );
  return won;
}

/** One page of Stripe's disputes, newest first; null, alerted, if it fails. */
async function disputesPage(
  stripe: Stripe,
  at: { createdFrom: number; startingAfter: string | undefined; page: number },
  obs: ObservabilityClient
): Promise<Stripe.ApiList<Stripe.Dispute> | null> {
  try {
    return await stripe.disputes.list({
      created: { gte: at.createdFrom },
      limit: LATE_WIN_PAGE_SIZE,
      ...(at.startingAfter ? { starting_after: at.startingAfter } : {}),
    });
  } catch (error) {
    obs.error(
      "The hourly late-win check could not read a page of Stripe's disputes; the late wins on the pages before it are still settled, the rest next run",
      {
        errorId: crypto.randomUUID(),
        page: at.page,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return null;
  }
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
 *
 * An applied outcome is done, but for a loss whose snapshot says won: a late
 * win (Codex-2hxff.70), unless `lateWins` is off. A late win already undone,
 * or settled by hand (release step R18), is won and applied: left alone.
 */
function needsSettling(
  stripeStatus: string,
  record: { status: string; outcomeAppliedAt: Date | null } | undefined,
  lateWins: boolean
): boolean {
  if (!record) return true;
  if (record.outcomeAppliedAt) {
    return lateWins && record.status === 'lost' && stripeStatus === 'won';
  }
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
