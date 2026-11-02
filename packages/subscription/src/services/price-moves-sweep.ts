/**
 * The hourly price-moves step (Codex-2hxff.86; batch C1 Part B data design
 * §2.4; docs/payments/subscriptions.md → Price changes).
 *
 * A Studio save that changes a price records who is due
 * (`recordTierPriceChange`, `recordPlanPriceChange`). This step tells them and
 * moves them, on ecom-api's existing hourly wake (`0 * * * *`), isolated from
 * the other sweeps. It does nothing on the 08:00 London run, which the bank
 * payout has to itself.
 *
 *   1. RESTART a stopped change support asked to restart, and re-open a
 *      finished one that has rows support queued again (Retry, Retry the
 *      move).
 *   2. CLAIM up to PRICE_MOVES_PER_RUN rows, `due` or `notified`, on running
 *      changes, oldest first, in one UPDATE under FOR UPDATE SKIP LOCKED
 *      (`attempts + 1`, `attempted_at = now`), as the payout drain claims:
 *      overlapping runs skip each other.
 *   3. WORK them in batches of PRICE_MOVES_BATCH_SIZE, one change per batch,
 *      and start no batch after PRICE_MOVES_TIME_BUDGET_MS. Per person: our
 *      row is read again (still on the tier and interval: Part A rule 1); a
 *      row whose last try's outcome is unknown is looked for in the email log
 *      and at Stripe first; then `schedulePriceChange`, notice first, with
 *      their own notice time (M2) and a mover's floor (Part A rule 2). A
 *      `notified` row retries the write only, from its own email (M1, Q5).
 *   4. RECORD each outcome. A failure is tried again the next hour; after
 *      PRICE_MOVE_TRIES it is `held` for support (Admin › Queue › Price moves).
 *   5. STOP a change when every notice of its first batch was refused with a
 *      4xx that will not go away by itself (a missing template, a bad worker
 *      secret) and none of its notices was ever accepted: nobody is moved,
 *      the claims go back, and one alert says so.
 *   6. FINISH: unworked claims go back, a change with nothing `due` or
 *      `notified` is `done` (held rows don't keep it running), and one end
 *      alert counts what is held.
 *
 * Budget: about 4 subrequests per person (the Stripe read, the
 * notifications-api call, the Stripe read again after it (F1), the Stripe
 * write), so a full run of PRICE_MOVES_PER_RUN is about 4,500.
 *
 * Never throws: it runs inside `waitUntil` from `scheduled()`. The record, not
 * the log, is the source of truth; alerts carry ids only.
 */

import { BILLING_INTERVAL, SUBSCRIPTION_STATUS } from '@codex/constants';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  emailAuditLogs,
  type PriceChangeState,
  type PriceMoveHeldReason,
  type PriceMoveSkipReason,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { isBankPayoutRun, nextPriceMovesRunAfter } from '@codex/payments';
import { type SQL, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { PriceChangeStageError } from '../errors';
import {
  isDefinitiveStripeRefusal,
  moveFailureAlert,
  type NoticeFailure,
  noticeFailureAlert,
  type PriceChangeNotice,
  type PriceChangeNoticeMailer,
  type PriceChangeTx,
  schedulePriceChange,
  sendPriceChangeNotice,
} from './pending-price-change';
import { MOVE_TIER_ID_KEY } from './tier-move';

/**
 * People a run claims at most; the rest wait an hour. Sized to the
 * subrequest budget (§2.4): about 4 per person (the Stripe read, the
 * notice, the read again after it (F1), the write) × 1,125 = 4,500, and
 * the same wake's other sweeps take about 4,000 more, so 8,500: the design's
 * envelope, under the paid plan's default 10,000 per invocation (ecom-api
 * sets no `limits`).
 */
export const PRICE_MOVES_PER_RUN = 1125;
/** People worked at once: one batch, all on one change. */
export const PRICE_MOVES_BATCH_SIZE = 8;
/** No batch starts after this; the cron's wall is 15 minutes. */
export const PRICE_MOVES_TIME_BUDGET_MS = 8 * 60 * 1000;
/** Tries before a row is `held` for support. */
export const PRICE_MOVE_TRIES = 3;
/** Per-person alert lines a run writes; the rest fold into the end alert. */
export const PRICE_MOVE_ALERT_LINES = 50;
/** A row attempted this recently is not claimed again (overlapping runs). */
const RECLAIM_AFTER_MS = 20 * 60 * 1000;
/** A failed try is tried again on the next hourly run. */
const RETRY_AFTER_MS = 60 * 60 * 1000;
/** Pause between batches, to stay under Stripe's per-account rate limit. */
const INTER_BATCH_DELAY_MS = 50;
/** The email log is searched from a minute before the last try. */
const EMAIL_LOG_SLACK_MS = 60 * 1000;
const NOTICE_TEMPLATE = 'subscription-tier-price-change';
const ALERT_PREFIX = 'Price moves: ';

export interface PriceMovesLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * Raw SQL, plus a transaction for the writes that lock a change row before
 * they read its rows. The lock order everywhere is the `price_changes` row,
 * then its `subscription_price_moves` rows.
 */
export interface PriceMovesDb extends PriceChangeTx {
  transaction<T>(work: (tx: PriceChangeTx) => Promise<T>): Promise<T>;
}

export interface PriceMoveStepDeps {
  db: PriceMovesDb;
  stripe: Stripe;
  /** Sends the 30-day notice and reports notifications-api's answer. */
  mailer: PriceChangeNoticeMailer;
  obs: PriceMovesLogger;
  /** Base of the notice's manage link. */
  webAppUrl?: string;
  /**
   * A member waiting to move to the repriced tier now has a later price to
   * show on their account (`pendingTierChange.laterPrice`).
   */
  onMoverScheduled?: (who: { userId: string; organizationId: string }) => void;
}

export interface PriceMoveStepOptions {
  /** The cron's scheduled time: claims, retries and the 08:00 skip count from it. */
  now: Date;
  perRun?: number;
  batchSize?: number;
  timeBudgetMs?: number;
  interBatchDelayMs?: number;
  alertLines?: number;
  /** Real time, for each person's notice time and the budget. */
  clock?: () => number;
  /** Work only these changes (the test suites share one database). */
  onlyChangeIds?: readonly string[];
}

export interface PriceMoveStepResult {
  /** False on the 08:00 London run. */
  ran: boolean;
  restarted: number;
  reopened: number;
  claimed: number;
  scheduled: number;
  unchanged: number;
  skipped: number;
  /** Failed this run, tried again next hour. */
  retrying: number;
  held: number;
  stopped: number;
  /** Claims given back unworked: the budget ran out, or their change stopped. */
  givenBack: number;
  done: number;
}

interface Claim {
  id: string;
  priceChangeId: string;
  prevAttemptedAt: Date | null;
}

/** A claimed row with what working it needs, read just before its batch. */
interface MoveRow {
  id: string;
  priceChangeId: string;
  state: 'due' | 'notified';
  subscriptionId: string | null;
  courseSubscriptionId: string | null;
  stripeSubscriptionId: string;
  userId: string;
  organizationId: string;
  /** After this run's claim. */
  attempts: number;
  noticeAt: Date | null;
  effectiveAt: Date | null;
  lastError: string | null;
  /** Kept on a row support retried. */
  heldReason: string | null;
  kind: 'tier' | 'course_plan';
  tierId: string | null;
  interval: 'month' | 'year';
  fromAmountCents: number;
  newAmountCents: number;
  newPriceId: string;
  email: string | null;
  name: string | null;
  planName: string | null;
  subStatus: string | null;
  subEndedAt: Date | null;
  subInterval: string | null;
  subTierId: string | null;
  pendingTierId: string | null;
  pendingTierFrom: Date | null;
}

/** When a person was told, and the date their notice named. */
interface Told {
  noticeAt: Date;
  effectiveAt: Date;
}

type RowResult =
  | {
      kind: 'scheduled';
      scheduledKind: 'now' | 'pending';
      told: Told;
      mover: boolean;
      noticeSent: boolean;
    }
  /** `told`: emailed this try, before the move was decided again (F1). */
  | { kind: 'unchanged'; told?: Told | null }
  | { kind: 'skipped'; reason: PriceMoveSkipReason; told?: Told | null }
  | {
      kind: 'failed';
      heldReason: PriceMoveHeldReason;
      /** `last_error`: a short code, never a message. */
      code: string;
      /** Set once their notice was accepted: the row stays `notified`. */
      told: Told | null;
      /** notifications-api refused the notice with this status. */
      refusedStatus: number | null;
      noticeSent: boolean;
      alert: { message: string; data: Record<string, unknown> };
    };

interface Run {
  deps: PriceMoveStepDeps;
  now: Date;
  clock: () => number;
  only: readonly string[] | null;
  /** The end alert's id, written on every held row whose own line was folded. */
  endAlertId: string;
  alertCap: number;
  alertLines: number;
  /** Rows whose outcome this run wrote. */
  recorded: Set<string>;
  result: PriceMoveStepResult;
}

const HELD_REASONS: Record<string, PriceMoveHeldReason> = {
  no_address: 'no_address',
  refused: 'notice_refused',
  skipped: 'notice_skipped',
  unknown: 'notice_unknown',
};

/**
 * A notifications-api refusal that every other notice of the change will get
 * too: a 4xx other than a timeout (408), a conflict (409), too early (425) or
 * a rate limit (429).
 */
function isDeterministicRefusal(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 425 &&
    status !== 429
  );
}

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : null;
}

const toDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);

const uuidList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );

/** `AND <column> IN (...)` for a run limited to some changes, else nothing. */
function onlyChanges(run: Run, column: SQL): SQL {
  return run.only ? sql`AND ${column} IN (${uuidList(run.only)})` : sql``;
}

/**
 * Work the due price moves. See the module docblock. Never throws.
 */
export async function runPriceMoveStep(
  deps: PriceMoveStepDeps,
  options: PriceMoveStepOptions
): Promise<PriceMoveStepResult> {
  const result: PriceMoveStepResult = {
    ran: false,
    restarted: 0,
    reopened: 0,
    claimed: 0,
    scheduled: 0,
    unchanged: 0,
    skipped: 0,
    retrying: 0,
    held: 0,
    stopped: 0,
    givenBack: 0,
    done: 0,
  };
  if (isBankPayoutRun(options.now)) return result;
  if (options.onlyChangeIds && options.onlyChangeIds.length === 0) {
    return result;
  }
  result.ran = true;

  const run: Run = {
    deps,
    now: options.now,
    clock: options.clock ?? Date.now,
    only: options.onlyChangeIds ?? null,
    endAlertId: crypto.randomUUID(),
    alertCap: options.alertLines ?? PRICE_MOVE_ALERT_LINES,
    alertLines: 0,
    recorded: new Set(),
    result,
  };
  const startedAt = run.clock();
  const batchSize = Math.max(1, options.batchSize ?? PRICE_MOVES_BATCH_SIZE);
  const budgetMs = options.timeBudgetMs ?? PRICE_MOVES_TIME_BUDGET_MS;
  const delayMs = Math.max(
    0,
    options.interBatchDelayMs ?? INTER_BATCH_DELAY_MS
  );

  await isolated(run, 'restart', () => restartChanges(run));

  let claims: Claim[] = [];
  try {
    claims = await claimRows(run, options.perRun ?? PRICE_MOVES_PER_RUN);
  } catch (error) {
    alertStepFailed(run, 'claim', error);
  }
  result.claimed = claims.length;
  if (claims.length > 0) {
    deps.obs.info('Price moves: run started', {
      claimed: claims.length,
      changes: new Set(claims.map((c) => c.priceChangeId)).size,
      scheduledTime: run.now.toISOString(),
    });
  }

  // One change per batch, in the order the claim found them.
  const byChange = new Map<string, Claim[]>();
  for (const claim of claims) {
    const list = byChange.get(claim.priceChangeId) ?? [];
    list.push(claim);
    byChange.set(claim.priceChangeId, list);
  }
  const batches: Claim[][] = [];
  for (const list of byChange.values()) {
    for (let i = 0; i < list.length; i += batchSize) {
      batches.push(list.slice(i, i + batchSize));
    }
  }

  const unworked: Claim[] = [];
  const stopped = new Set<string>();
  const started = new Set<string>();
  try {
    for (const [index, batch] of batches.entries()) {
      const changeId = batch[0]?.priceChangeId;
      if (!changeId) continue;
      if (stopped.has(changeId)) {
        unworked.push(...batch);
        continue;
      }
      if (run.clock() - startedAt >= budgetMs) {
        unworked.push(...batches.slice(index).flat());
        break;
      }
      const firstBatch = !started.has(changeId);
      started.add(changeId);
      const stop = await workBatch(run, batch, firstBatch);
      if (stop) {
        stopped.add(changeId);
        unworked.push(...stop.giveBack);
      }
      if (index < batches.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } catch (error) {
    // A batch that threw past its own guards: everything not yet recorded
    // goes back, so nobody waits out the reclaim window.
    alertStepFailed(run, 'work', error);
    const queued = new Set(unworked.map((c) => c.id));
    unworked.push(
      ...claims.filter((c) => !queued.has(c.id) && !run.recorded.has(c.id))
    );
  }

  await isolated(run, 'give_back', () => giveBack(run, unworked));
  await isolated(run, 'finish', () => finishChanges(run, [...byChange.keys()]));
  endAlert(run);
  return result;
}

async function isolated(
  run: Run,
  stage: string,
  step: () => Promise<void>
): Promise<void> {
  try {
    await step();
  } catch (error) {
    alertStepFailed(run, stage, error);
  }
}

function alertStepFailed(run: Run, stage: string, error: unknown): void {
  run.deps.obs.error('Price moves: a step of the run failed', {
    errorId: crypto.randomUUID(),
    stage,
    scheduledTime: run.now.toISOString(),
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Support's Restart sets a stopped change back to running (one UPDATE of the
 * change row, nothing else). A finished change with a `due` or `notified`
 * row (support's Retry flips only the row) is re-opened, each under its own
 * lock (`reopenIfOpen`).
 */
async function restartChanges(run: Run): Promise<void> {
  const restarted = await run.deps.db.execute(sql`
    UPDATE ${priceChanges}
       SET "state" = 'running'
     WHERE "state" = 'stopped'
       AND "restart_requested_at" > "stopped_at"
       ${onlyChanges(run, sql`"id"`)}
    RETURNING "id"
  `);
  run.result.restarted = restarted.rows.length;

  // Candidates first, unlocked; each is then decided under its own lock.
  const candidates = await run.deps.db.execute(sql`
    SELECT DISTINCT c."id"
      FROM ${priceChanges} c
      JOIN ${subscriptionPriceMoves} m ON m."price_change_id" = c."id"
     WHERE c."state" = 'done'
       AND m."state" IN ('due', 'notified')
       ${onlyChanges(run, sql`c."id"`)}
  `);
  for (const { id } of candidates.rows as Array<{ id: string }>) {
    if (await reopenIfOpen(run, id)) run.result.reopened += 1;
  }
}

/**
 * Re-open one finished change (`running`, `done_at` NULL), deciding with its
 * row locked: it is still `done`, still has a `due` or `notified` row, and is
 * its tier's (or plan's) newest change with nothing else live, so the
 * one-live-change index holds. A save that superseded its rows in the
 * meantime held the lock first, and leaves nothing to re-open.
 */
async function reopenIfOpen(run: Run, changeId: string): Promise<boolean> {
  return run.deps.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT "state" FROM ${priceChanges}
       WHERE "id" = ${changeId}::uuid
       FOR UPDATE
    `);
    if ((locked.rows[0] as { state?: string } | undefined)?.state !== 'done') {
      return false;
    }
    const reopened = await tx.execute(sql`
      UPDATE ${priceChanges} c
         SET "state" = 'running', "done_at" = NULL
       WHERE c."id" = ${changeId}::uuid
         AND EXISTS (SELECT 1 FROM ${subscriptionPriceMoves} m
                      WHERE m."price_change_id" = c."id"
                        AND m."state" IN ('due', 'notified'))
         AND NOT EXISTS (
           SELECT 1 FROM ${priceChanges} o
            WHERE o."id" <> c."id"
              AND o."kind" = c."kind"
              AND o."tier_id" IS NOT DISTINCT FROM c."tier_id"
              AND o."course_subscription_plan_id" IS NOT DISTINCT FROM c."course_subscription_plan_id"
              AND o."interval" = c."interval"
              AND (o."state" IN ('running', 'stopped')
                   OR (o."created_at", o."id") > (c."created_at", c."id")))
      RETURNING c."id"
    `);
    return reopened.rows.length > 0;
  });
}

/**
 * One UPDATE claims the rows: `attempts + 1` and `attempted_at = now`, under
 * FOR UPDATE SKIP LOCKED. Each row's previous `attempted_at` comes back, for
 * the email-log search and to give an unworked claim back as it was.
 */
async function claimRows(run: Run, perRun: number): Promise<Claim[]> {
  const reclaimBefore = new Date(run.now.getTime() - RECLAIM_AFTER_MS);
  const claimed = await run.deps.db.execute(sql`
    WITH picked AS (
      SELECT m."id", m."attempted_at" AS prev_attempted_at
        FROM ${subscriptionPriceMoves} m
        JOIN ${priceChanges} c ON c."id" = m."price_change_id"
       WHERE m."state" IN ('due', 'notified')
         AND (m."next_attempt_at" IS NULL
              OR m."next_attempt_at" <= ${run.now}::timestamptz)
         AND (m."attempted_at" IS NULL
              OR m."attempted_at" < ${reclaimBefore}::timestamptz)
         AND c."state" = 'running'
         ${onlyChanges(run, sql`c."id"`)}
       ORDER BY m."created_at", m."id"
       LIMIT ${perRun}::int
       FOR UPDATE OF m SKIP LOCKED
    )
    UPDATE ${subscriptionPriceMoves} m
       SET "attempts" = m."attempts" + 1,
           "attempted_at" = ${run.now}::timestamptz,
           "updated_at" = ${run.now}::timestamptz
      FROM picked p
     WHERE m."id" = p."id"
    RETURNING m."id", m."price_change_id", p."prev_attempted_at",
              m."created_at"
  `);
  // UPDATE … RETURNING keeps no order: oldest first again.
  const rows = claimed.rows as Array<{
    id: string;
    price_change_id: string;
    prev_attempted_at: unknown;
    created_at: unknown;
  }>;
  const age = (row: (typeof rows)[number]) =>
    toDate(row.created_at)?.getTime() ?? 0;
  return [...rows]
    .sort((a, b) => age(a) - age(b) || a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      priceChangeId: row.price_change_id,
      prevAttemptedAt: toDate(row.prev_attempted_at),
    }));
}

/**
 * Read the batch's rows fresh: only rows this run still holds, still `due` or
 * `notified`, on a change still running. A newer save may have superseded
 * the change since the claim.
 */
async function loadRows(run: Run, batch: Claim[]): Promise<MoveRow[]> {
  const loaded = await run.deps.db.execute(sql`
    SELECT m."id", m."price_change_id", m."state", m."subscription_id",
           m."course_subscription_id", m."stripe_subscription_id",
           m."user_id", m."organization_id", m."attempts", m."notice_at",
           m."effective_at", m."last_error", m."held_reason",
           c."kind", c."tier_id", c."interval", c."from_amount_cents",
           c."new_amount_cents", c."new_stripe_price_id",
           u."email", u."name",
           COALESCE(t."name", co."title") AS plan_name,
           COALESCE(s."status", cs."status") AS sub_status,
           COALESCE(s."ended_at", cs."ended_at") AS sub_ended_at,
           COALESCE(s."billing_interval", cs."billing_interval") AS sub_interval,
           s."tier_id" AS sub_tier_id, s."pending_tier_id", s."pending_tier_from"
      FROM ${subscriptionPriceMoves} m
      JOIN ${priceChanges} c ON c."id" = m."price_change_id"
      LEFT JOIN ${users} u ON u."id" = m."user_id"
      LEFT JOIN ${subscriptions} s ON s."id" = m."subscription_id"
      LEFT JOIN ${courseSubscriptions} cs ON cs."id" = m."course_subscription_id"
      LEFT JOIN ${subscriptionTiers} t ON t."id" = c."tier_id"
      LEFT JOIN ${courses} co ON co."id" = cs."course_id"
     WHERE m."id" IN (${uuidList(batch.map((c) => c.id))})
       AND m."attempted_at" = ${run.now}::timestamptz
       AND m."state" IN ('due', 'notified')
       AND c."state" = 'running'
  `);
  return (loaded.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    priceChangeId: String(r.price_change_id),
    state: r.state === 'notified' ? 'notified' : 'due',
    subscriptionId: (r.subscription_id as string | null) ?? null,
    courseSubscriptionId: (r.course_subscription_id as string | null) ?? null,
    stripeSubscriptionId: String(r.stripe_subscription_id),
    userId: String(r.user_id),
    organizationId: String(r.organization_id),
    attempts: Number(r.attempts),
    noticeAt: toDate(r.notice_at),
    effectiveAt: toDate(r.effective_at),
    lastError: (r.last_error as string | null) ?? null,
    heldReason: (r.held_reason as string | null) ?? null,
    kind: r.kind === 'course_plan' ? 'course_plan' : 'tier',
    tierId: (r.tier_id as string | null) ?? null,
    interval:
      r.interval === BILLING_INTERVAL.YEAR
        ? BILLING_INTERVAL.YEAR
        : BILLING_INTERVAL.MONTH,
    fromAmountCents: Number(r.from_amount_cents),
    newAmountCents: Number(r.new_amount_cents),
    newPriceId: String(r.new_stripe_price_id),
    email: (r.email as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    planName: (r.plan_name as string | null) ?? null,
    subStatus: (r.sub_status as string | null) ?? null,
    subEndedAt: toDate(r.sub_ended_at),
    subInterval: (r.sub_interval as string | null) ?? null,
    subTierId: (r.sub_tier_id as string | null) ?? null,
    pendingTierId: (r.pending_tier_id as string | null) ?? null,
    pendingTierFrom: toDate(r.pending_tier_from),
  }));
}

/**
 * Work one batch and record each outcome. Resolves the claims to give back
 * when the batch stops its change (step 5), else null.
 */
async function workBatch(
  run: Run,
  batch: Claim[],
  firstBatch: boolean
): Promise<{ giveBack: Claim[] } | null> {
  const rows = await loadRows(run, batch);
  const claimOf = new Map(batch.map((c) => [c.id, c]));
  const settled = await Promise.allSettled(
    rows.map((row) =>
      workRow(run, row, claimOf.get(row.id)?.prevAttemptedAt ?? null)
    )
  );
  const results = rows.map((row, i) => {
    const outcome = settled[i];
    return {
      row,
      result:
        outcome?.status === 'fulfilled'
          ? outcome.value
          : unexpectedFailure(outcome?.reason),
    };
  });

  const changeId = batch[0]?.priceChangeId;
  const stopStatus = changeId
    ? await firstBatchRefusal(run, changeId, firstBatch, results)
    : null;
  if (changeId && stopStatus !== null) {
    const giveBack: Claim[] = [];
    for (const { row, result } of results) {
      const claim = claimOf.get(row.id);
      if (result.kind === 'failed') {
        if (claim) giveBack.push(claim);
      } else {
        await record(run, row, result);
      }
    }
    // The rest of the change's claims in later batches go back too: the
    // caller skips them once it knows the change stopped.
    await stopChange(run, changeId, stopStatus, giveBack.length);
    return { giveBack };
  }

  for (const { row, result } of results) {
    await record(run, row, result);
  }
  return null;
}

/**
 * Step 5: the change's first batch this run, none of its notices ever
 * accepted, and every notice this batch sent refused with a deterministic
 * 4xx. Resolves that status, or null.
 */
async function firstBatchRefusal(
  run: Run,
  changeId: string,
  firstBatch: boolean,
  results: Array<{ result: RowResult }>
): Promise<number | null> {
  if (!firstBatch) return null;
  const sent = results.filter(
    ({ result }) =>
      result.kind !== 'unchanged' &&
      result.kind !== 'skipped' &&
      result.noticeSent
  );
  if (sent.length === 0) return null;
  let status: number | null = null;
  for (const { result } of sent) {
    if (
      result.kind !== 'failed' ||
      result.refusedStatus === null ||
      !isDeterministicRefusal(result.refusedStatus)
    ) {
      return null;
    }
    status = result.refusedStatus;
  }
  const told = await run.deps.db.execute(sql`
    SELECT 1 FROM ${subscriptionPriceMoves}
     WHERE "price_change_id" = ${changeId}::uuid AND "notice_at" IS NOT NULL
     LIMIT 1
  `);
  return told.rows.length === 0 ? status : null;
}

/**
 * The stop's reason code, which support's Queue shows raw and Studio maps: a
 * missing template (404, 422), a bad worker secret (401), or any other
 * deterministic 4xx.
 */
function stoppedReason(
  status: number
): 'template_missing' | 'worker_auth' | 'notice_refused' {
  if (status === 404 || status === 422) return 'template_missing';
  if (status === 401) return 'worker_auth';
  return 'notice_refused';
}

async function stopChange(
  run: Run,
  changeId: string,
  status: number,
  refused: number
): Promise<void> {
  const errorId = crypto.randomUUID();
  const reason = stoppedReason(status);
  const updated = await run.deps.db.execute(sql`
    UPDATE ${priceChanges}
       SET "state" = 'stopped', "stopped_reason" = ${reason},
           "stopped_error_id" = ${errorId}, "stopped_at" = ${run.now}::timestamptz
     WHERE "id" = ${changeId}::uuid AND "state" = 'running'
    RETURNING "id"
  `);
  if (updated.rows.length === 0) return;
  run.result.stopped += 1;
  run.deps.obs.error(
    'Price moves: notices refused for everyone in the first batch; nobody moved. Fix the cause, then restart the change (Admin › Queue › Price moves)',
    {
      errorId,
      priceChangeId: changeId,
      status,
      refused,
      stoppedReason: reason,
    }
  );
}

/**
 * One person (step 3). Never throws: every failure is a `failed` result,
 * classified for the record and the alert.
 */
async function workRow(
  run: Run,
  row: MoveRow,
  prevAttemptedAt: Date | null
): Promise<RowResult> {
  const eligible = eligibility(row);
  if ('skip' in eligible) return { kind: 'skipped', reason: eligible.skip };

  // Told already: a `notified` row retries the write only, from its email.
  let toldAt = row.state === 'notified' && row.noticeAt ? row.noticeAt : null;
  // The last try's outcome may be unknown: the notice may have gone (a 5xx
  // or a timeout), or a run may have stopped after its email or its Stripe
  // write without recording either, leaving an older try's `last_error` on
  // the row (review C1, F4). So every reclaim after an earlier try is
  // checked: the email log here, Stripe in `schedulePriceChange`. A row
  // support retried keeps its held reason, whatever else Retry resets.
  const mayBeTold =
    toldAt !== null ||
    prevAttemptedAt !== null ||
    (row.lastError?.startsWith('notice_unknown') ?? false) ||
    row.heldReason === 'notice_unknown';
  // What the notice step saw: the closure's writes, read after the await.
  const seen: {
    notice?: PriceChangeNotice;
    failure?: NoticeFailure;
    accepted?: boolean;
    /** notifications-api accepted this run's email. */
    sentNow?: boolean;
  } = {};
  let noticeSent = false;
  let noticeAt = new Date(run.clock());

  try {
    if (!toldAt && mayBeTold && row.email) {
      toldAt = await foundInEmailLog(run, row, row.email, prevAttemptedAt);
    }
    if (toldAt) noticeAt = toldAt;
    const outcome = await schedulePriceChange(
      run.deps.stripe,
      {
        stripeSubscriptionId: row.stripeSubscriptionId,
        newPriceId: row.newPriceId,
        newAmountCents: row.newAmountCents,
        interval: row.interval,
        noticeAt,
        floorFrom: eligible.floorFrom,
        skipLive: row.kind === 'tier' ? movingAwayAtStripe(row) : undefined,
        mayBeTold,
      },
      async (notice) => {
        seen.notice = notice;
        if (toldAt) {
          seen.accepted = true;
          return true;
        }
        noticeSent = row.email !== null;
        const failure = await sendPriceChangeNotice(run.deps.mailer, {
          to: row.email,
          toName: row.name || undefined,
          templateName: NOTICE_TEMPLATE,
          category: 'transactional',
          userId: row.userId,
          organizationId: row.organizationId,
          // priceMoveId is not a token: the data schema strips it before
          // rendering, and the email log keeps it, for the unknown check.
          data: { ...noticeData(run, row, notice), priceMoveId: row.id },
        });
        if (failure) {
          seen.failure = failure;
          return false;
        }
        seen.accepted = true;
        seen.sentNow = true;
        return true;
      }
    );
    // Emailed now, then found changed and decided again as unchanged or
    // skipped (F1): the row still records that they were told.
    const toldNow: Told | null =
      seen.sentNow && seen.notice
        ? { noticeAt, effectiveAt: seen.notice.effectiveAt }
        : null;

    switch (outcome.kind) {
      case 'applied':
      case 'pending': {
        const told: Told = outcome.landed
          ? {
              noticeAt: toldAt ?? prevAttemptedAt ?? noticeAt,
              effectiveAt: row.effectiveAt ?? outcome.effectiveAt,
            }
          : { noticeAt, effectiveAt: outcome.effectiveAt };
        return {
          kind: 'scheduled',
          scheduledKind: outcome.kind === 'applied' ? 'now' : 'pending',
          told,
          mover: eligible.floorFrom !== null,
          noticeSent,
        };
      }
      case 'unchanged':
        return { kind: 'unchanged', told: toldNow };
      case 'skipped':
        return { kind: 'skipped', reason: outcome.reason, told: toldNow };
      case 'unnotified': {
        const failure = seen.failure ?? { reason: 'unknown' as const };
        const notice = seen.notice ?? fallbackNotice(row, noticeAt);
        return {
          kind: 'failed',
          heldReason: HELD_REASONS[failure.reason] ?? 'notice_unknown',
          code: noticeCode(failure),
          told: null,
          refusedStatus: failure.reason === 'refused' ? failure.status : null,
          noticeSent,
          alert: noticeFailureAlert(ALERT_PREFIX, failure, notice),
        };
      }
    }
  } catch (error) {
    return thrownFailure(row, error, {
      accepted: seen.accepted === true || toldAt !== null,
      noticeAt,
      notice: seen.notice,
      noticeSent,
    });
  }
}

/**
 * Our row, read just now: still live, on the interval, and for a tier still
 * on it or waiting to move to it (Part A rules 1 and 2). A mover's floor is
 * worked out from their move as it stands now.
 */
function eligibility(
  row: MoveRow
): { skip: PriceMoveSkipReason } | { floorFrom: Date | null } {
  if (
    row.subStatus === null ||
    row.subStatus === SUBSCRIPTION_STATUS.CANCELLED ||
    row.subEndedAt !== null
  ) {
    return { skip: 'ended' };
  }
  if (row.subInterval !== row.interval) return { skip: 'other_interval' };
  if (row.kind === 'tier') {
    if (row.pendingTierId !== null && row.pendingTierId === row.tierId) {
      return {
        floorFrom: row.pendingTierFrom
          ? new Date(row.pendingTierFrom.getTime() + 1000)
          : null,
      };
    }
    if (row.pendingTierId !== null || row.subTierId !== row.tierId) {
      return { skip: 'moving_away' };
    }
  }
  return { floorFrom: null };
}

/**
 * Part A rule 1 at Stripe: a change of plan can land after our row was read
 * (or during the notice, F1). A live `codex_move_tier_id` naming another tier
 * means they are leaving; with no move waiting, a `codex_tier_id` naming
 * another tier means they have left (an upgrade, or Keep from a move onto
 * this tier).
 */
function movingAwayAtStripe(
  row: MoveRow
): (live: Stripe.Subscription) => PriceMoveSkipReason | null {
  return (live) => {
    const movingTo = live.metadata?.[MOVE_TIER_ID_KEY];
    if (movingTo) return movingTo === row.tierId ? null : 'moving_away';
    const on = live.metadata?.codex_tier_id;
    return on && on !== row.tierId ? 'moving_away' : null;
  };
}

/**
 * M1's rule for an unknown outcome: did the email go after all? A log row
 * for this row's notice, since a minute before its last try, counts as told
 * then, and nothing is sent again. notifications-api writes the log row
 * `pending` before the provider call and `success` once the provider has
 * taken the email, so a row left `pending` (the success write failed, or the
 * invocation stopped) may have been delivered, and counts too (F4). `failed`
 * (every attempt failed) and `skipped` (an opt-out, before any send) do not.
 */
async function foundInEmailLog(
  run: Run,
  row: MoveRow,
  email: string,
  prevAttemptedAt: Date | null | undefined
): Promise<Date | null> {
  const since = prevAttemptedAt
    ? new Date(prevAttemptedAt.getTime() - EMAIL_LOG_SLACK_MS)
    : new Date(0);
  const found = await run.deps.db.execute(sql`
    SELECT "updated_at" FROM ${emailAuditLogs}
     WHERE "template_name" = ${NOTICE_TEMPLATE}
       AND "recipient_email" = ${email}
       AND "status" IN ('success', 'pending')
       AND "created_at" >= ${since}::timestamptz
       AND strpos("metadata", ${`"priceMoveId":"${row.id}"`}) > 0
     ORDER BY "created_at"
     LIMIT 1
  `);
  const [hit] = found.rows as Array<{ updated_at: unknown }>;
  return hit ? toDate(hit.updated_at) : null;
}

const gbp = (cents: number) => `£${(cents / 100).toFixed(2)}`;

/**
 * The notice's words. The "from" figure is what they are billed today, read
 * off their live item: someone grandfathered pays something other than the
 * previous list price (Codex-2hxff.40).
 */
function noticeData(
  run: Run,
  row: MoveRow,
  notice: PriceChangeNotice
): Record<string, string> {
  let fromCents = notice.currentAmountCents;
  if (fromCents === null) {
    // PriceChangeNotice says this never happens: the email may then quote a
    // figure this person is not billed.
    run.deps.obs.error(
      'Price moves: live price has no unit amount; quoting the previous list price',
      {
        errorId: crypto.randomUUID(),
        priceChangeId: row.priceChangeId,
        priceMoveId: row.id,
      }
    );
    fromCents = row.fromAmountCents;
  }
  return {
    userName: row.name || 'there',
    planName: row.planName || 'your subscription',
    oldPriceFormatted: gbp(fromCents),
    newPriceFormatted: gbp(row.newAmountCents),
    billingInterval: row.interval,
    effectiveDate: notice.effectiveAt.toLocaleDateString('en-GB', {
      timeZone: 'UTC',
    }),
    manageUrl: `${run.deps.webAppUrl ?? ''}/account/subscriptions`,
  };
}

function noticeCode(failure: NoticeFailure): string {
  switch (failure.reason) {
    case 'no_address':
      return 'no_address';
    case 'refused':
      return `notice_refused_${failure.status}`;
    case 'skipped':
      return 'notice_skipped';
    case 'unknown':
      return failure.status
        ? `notice_unknown_${failure.status}`
        : 'notice_unknown';
  }
}

/** For an alert about a notice that never got as far as its words. */
function fallbackNotice(row: MoveRow, noticeAt: Date): PriceChangeNotice {
  return {
    kind: 'pending',
    effectiveAt: row.effectiveAt ?? noticeAt,
    currentAmountCents: null,
    currentPending: null,
  };
}

/**
 * A Stripe call threw. Once they were told, it is the move that failed and the
 * row stays `notified` (its held reason is `move_*`); before, it is the read
 * or a same-amount write, and nothing was sent.
 */
function thrownFailure(
  row: MoveRow,
  error: unknown,
  at: {
    /** Their notice was accepted (now, or on an earlier try). */
    accepted: boolean;
    noticeAt: Date;
    notice: PriceChangeNotice | undefined;
    noticeSent: boolean;
  }
): RowResult {
  const stripeError =
    error instanceof PriceChangeStageError ? error.cause : error;
  const status = statusOf(stripeError);
  const suffix = status === null ? '' : `_${status}`;
  const { notice, noticeAt, noticeSent } = at;
  if (at.accepted) {
    const told: Told = {
      noticeAt,
      effectiveAt: notice?.effectiveAt ?? row.effectiveAt ?? noticeAt,
    };
    const definitive = isDefinitiveStripeRefusal(stripeError);
    const readFailed =
      error instanceof PriceChangeStageError && error.stage === 'read';
    return {
      kind: 'failed',
      heldReason: definitive ? 'move_refused' : 'move_unknown',
      code: readFailed
        ? `read_failed${suffix}`
        : definitive
          ? `move_refused${suffix}`
          : `move_unknown${suffix}`,
      told,
      refusedStatus: null,
      noticeSent,
      alert: moveFailureAlert(
        ALERT_PREFIX,
        stripeError,
        notice ?? fallbackNotice(row, noticeAt),
        noticeAt
      ),
    };
  }
  const sameAmount =
    error instanceof PriceChangeStageError && error.stage !== 'read';
  return {
    kind: 'failed',
    heldReason: sameAmount ? 'same_amount_write_failed' : 'read_failed',
    code: sameAmount ? 'same_amount_write_failed' : `read_failed${suffix}`,
    told: null,
    refusedStatus: null,
    noticeSent,
    alert: moveFailureAlert(ALERT_PREFIX, error, undefined, new Date()),
  };
}

function unexpectedFailure(reason: unknown): RowResult {
  return {
    kind: 'failed',
    heldReason: 'read_failed',
    code: 'read_failed',
    told: null,
    refusedStatus: null,
    noticeSent: false,
    alert: {
      message: `${ALERT_PREFIX}failed before the notice was accepted; not moved (support: retry)`,
      data: {
        outcome: 'not_moved',
        notified: false,
        error: reason instanceof Error ? reason.message : String(reason),
      },
    },
  };
}

/**
 * Write one outcome, only while this run still holds the row. A newer save
 * that superseded it since wins; the step's own work for it is then dropped.
 */
async function record(
  run: Run,
  row: MoveRow,
  result: RowResult
): Promise<void> {
  const db = run.deps.db;
  run.recorded.add(row.id);
  const mine = sql`"id" = ${row.id}::uuid
       AND "attempted_at" = ${run.now}::timestamptz
       AND "state" IN ('due', 'notified')`;
  // A row support retried that now ends scheduled, unchanged or skipped
  // closes as `retried_ok`.
  const retriedOk = sql`"resolution" = CASE WHEN "retry_requested_at" IS NOT NULL AND "resolution" IS NULL THEN 'retried_ok' ELSE "resolution" END,
           "resolved_at" = CASE WHEN "retry_requested_at" IS NOT NULL AND "resolution" IS NULL THEN ${run.now}::timestamptz ELSE "resolved_at" END`;
  const now = sql`${run.now}::timestamptz`;
  // Told this try, then decided again as unchanged or skipped (F1).
  const toldThisTry =
    (result.kind === 'unchanged' || result.kind === 'skipped') && result.told
      ? sql`"notice_at" = ${result.told.noticeAt}::timestamptz, "effective_at" = ${result.told.effectiveAt}::timestamptz,`
      : sql``;

  let written: { rows: unknown[] };
  switch (result.kind) {
    case 'scheduled':
      written = await db.execute(sql`
        UPDATE ${subscriptionPriceMoves}
           SET "state" = 'scheduled', "scheduled_kind" = ${result.scheduledKind},
               "notice_at" = ${result.told.noticeAt}::timestamptz,
               "effective_at" = ${result.told.effectiveAt}::timestamptz,
               "next_attempt_at" = NULL, ${retriedOk}, "updated_at" = ${now}
         WHERE ${mine}
        RETURNING "id"
      `);
      if (written.rows.length > 0) {
        run.result.scheduled += 1;
        if (result.mover) {
          run.deps.onMoverScheduled?.({
            userId: row.userId,
            organizationId: row.organizationId,
          });
        }
      }
      break;
    case 'unchanged':
      written = await db.execute(sql`
        UPDATE ${subscriptionPriceMoves}
           SET "state" = 'unchanged', ${toldThisTry} "next_attempt_at" = NULL,
               ${retriedOk}, "updated_at" = ${now}
         WHERE ${mine}
        RETURNING "id"
      `);
      if (written.rows.length > 0) run.result.unchanged += 1;
      break;
    case 'skipped':
      written = await db.execute(sql`
        UPDATE ${subscriptionPriceMoves}
           SET "state" = 'skipped', "skip_reason" = ${result.reason},
               ${toldThisTry} "next_attempt_at" = NULL, ${retriedOk},
               "updated_at" = ${now}
         WHERE ${mine}
        RETURNING "id"
      `);
      if (written.rows.length > 0) run.result.skipped += 1;
      break;
    case 'failed': {
      const told = result.told;
      const toldSet = told
        ? sql`"notice_at" = ${told.noticeAt}::timestamptz, "effective_at" = ${told.effectiveAt}::timestamptz,`
        : sql``;
      if (row.attempts < PRICE_MOVE_TRIES) {
        const retryAt = new Date(run.now.getTime() + RETRY_AFTER_MS);
        written = await db.execute(sql`
          UPDATE ${subscriptionPriceMoves}
             SET "state" = ${told ? 'notified' : 'due'}, ${toldSet}
                 "last_error" = ${result.code},
                 "next_attempt_at" = ${retryAt}::timestamptz,
                 "updated_at" = ${now}
           WHERE ${mine}
          RETURNING "id"
        `);
        if (written.rows.length > 0) run.result.retrying += 1;
        break;
      }
      const errorId =
        run.alertLines < run.alertCap ? crypto.randomUUID() : run.endAlertId;
      written = await db.execute(sql`
        UPDATE ${subscriptionPriceMoves}
           SET "state" = 'held', ${toldSet}
               "held_reason" = ${result.heldReason},
               "last_error" = ${result.code}, "next_attempt_at" = NULL,
               "alert_error_id" = ${errorId}, "updated_at" = ${now}
         WHERE ${mine}
        RETURNING "id"
      `);
      if (written.rows.length > 0) {
        run.result.held += 1;
        if (errorId !== run.endAlertId) {
          run.alertLines += 1;
          run.deps.obs.error(
            `${result.alert.message} [held after ${row.attempts} tries: Admin › Queue › Price moves]`,
            {
              errorId,
              ...result.alert.data,
              heldReason: result.heldReason,
              lastError: result.code,
              priceChangeId: row.priceChangeId,
              priceMoveId: row.id,
              subscriptionId: row.subscriptionId,
              courseSubscriptionId: row.courseSubscriptionId,
              stripeSubscriptionId: row.stripeSubscriptionId,
              userId: row.userId,
              organizationId: row.organizationId,
            }
          );
        }
      }
      break;
    }
  }
}

/** Claims not worked go back as they were: one fewer try, the old `attempted_at`. */
async function giveBack(run: Run, claims: Claim[]): Promise<void> {
  if (claims.length === 0) return;
  const back = await run.deps.db.execute(sql`
    UPDATE ${subscriptionPriceMoves} m
       SET "attempts" = m."attempts" - 1, "attempted_at" = g."prev",
           "updated_at" = ${run.now}::timestamptz
      FROM unnest(
             ARRAY[${uuidList(claims.map((c) => c.id))}]::uuid[],
             ARRAY[${sql.join(
               claims.map((c) => sql`${c.prevAttemptedAt}::timestamptz`),
               sql`, `
             )}]::timestamptz[]
           ) AS g("id", "prev")
     WHERE m."id" = g."id"
       AND m."attempted_at" = ${run.now}::timestamptz
       AND m."state" IN ('due', 'notified')
    RETURNING m."id"
  `);
  run.result.givenBack = back.rows.length;
}

/**
 * Stamp `last_run_at` on the changes this run worked, and finish every
 * running change with nothing `due` or `notified` (held rows don't keep it
 * running).
 */
async function finishChanges(run: Run, worked: string[]): Promise<void> {
  if (worked.length > 0) {
    await run.deps.db.execute(sql`
      UPDATE ${priceChanges} SET "last_run_at" = ${run.now}::timestamptz
       WHERE "id" IN (${uuidList(worked)})
    `);
  }
  // Candidates first, unlocked; each is then decided under its own lock.
  const candidates = await run.deps.db.execute(sql`
    SELECT c."id" FROM ${priceChanges} c
     WHERE c."state" = 'running'
       AND NOT EXISTS (SELECT 1 FROM ${subscriptionPriceMoves} m
                        WHERE m."price_change_id" = c."id"
                          AND m."state" IN ('due', 'notified'))
       ${onlyChanges(run, sql`c."id"`)}
  `);
  for (const { id } of candidates.rows as Array<{ id: string }>) {
    if (await finishIfDone(run, id)) run.result.done += 1;
  }
}

/**
 * Close one change, deciding with its row locked: lock it, then count its
 * `due` and `notified` rows, then set `done`. A Keep row added under the
 * lock (Keep takes the change row first) is counted, so the change stays
 * running for it; counting before the lock would miss it.
 */
async function finishIfDone(run: Run, changeId: string): Promise<boolean> {
  return run.deps.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT "state" FROM ${priceChanges}
       WHERE "id" = ${changeId}::uuid
       FOR UPDATE
    `);
    if (
      (locked.rows[0] as { state?: string } | undefined)?.state !== 'running'
    ) {
      return false;
    }
    const open = await tx.execute(sql`
      SELECT 1 FROM ${subscriptionPriceMoves}
       WHERE "price_change_id" = ${changeId}::uuid
         AND "state" IN ('due', 'notified')
       LIMIT 1
    `);
    if (open.rows.length > 0) return false;
    await tx.execute(sql`
      UPDATE ${priceChanges}
         SET "state" = 'done', "done_at" = ${run.now}::timestamptz
       WHERE "id" = ${changeId}::uuid
    `);
    return true;
  });
}

/** One line per run: an alert when anyone was held or a change stopped. */
function endAlert(run: Run): void {
  const { result } = run;
  if (result.claimed === 0 && result.restarted === 0 && result.reopened === 0) {
    return;
  }
  const folded = result.held - run.alertLines;
  if (result.held > 0 || result.stopped > 0) {
    run.deps.obs.error(
      'Price moves: run finished with people held for support (Admin › Queue › Price moves)',
      {
        errorId: run.endAlertId,
        ...result,
        // Held rows past the per-run line cap carry this alert's errorId.
        heldNotAlertedSeparately: folded,
        scheduledTime: run.now.toISOString(),
      }
    );
    return;
  }
  run.deps.obs.info('Price moves: run finished', {
    ...result,
    scheduledTime: run.now.toISOString(),
  });
}

// ─── The Studio progress read (data design §2.6) ───────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** A finished or replaced change still shows for this long. */
const PROGRESS_SHOWN_FOR_MS = 14 * DAY_MS;
/** Changes a progress read returns at most, newest first. */
const PROGRESS_LIMIT = 50;

/**
 * The run that should finish `remaining` rows at PRICE_MOVES_PER_RUN a run,
 * counting runs from the next one after `now` (`nextPriceMovesRunAfter`,
 * which skips the 08:00 London run), or null with nothing left.
 */
export function priceMovesDoneBy(now: Date, remaining: number): Date | null {
  if (remaining <= 0) return null;
  let run = nextPriceMovesRunAfter(now);
  for (let n = 1; n < Math.ceil(remaining / PRICE_MOVES_PER_RUN); n++) {
    run = nextPriceMovesRunAfter(run);
  }
  return run;
}

/** How far one price change has got, for the Studio note (data design §2.6). */
export interface PriceChangeProgress {
  id: string;
  tierId: string | null;
  courseSubscriptionPlanId: string | null;
  interval: 'month' | 'year';
  fromAmountCents: number;
  newAmountCents: number;
  state: PriceChangeState;
  createdAt: string;
  counts: {
    /** Everyone the change has to tell. */
    total: number;
    /** Every accepted notice, a held move failure included: they were told. */
    emailed: number;
    /** Told, and moved now or marked to move at a renewal. */
    scheduled: number;
    /** Held for support and not yet resolved: "couldn't be moved yet". */
    held: number;
    /** Not told yet. */
    due: number;
    /** Of `due`, those already tried: "1 to try again at 16:00". */
    retrying: number;
  };
  lastRunAt: string | null;
  /** The next run that works it; null unless it is running. */
  nextRunAt: string | null;
  /**
   * The run that should finish it, at PRICE_MOVES_PER_RUN a run and skipping
   * 08:00 London; null unless it is running with rows due or notified.
   */
  estimatedDoneAt: string | null;
  doneAt: string | null;
  supersededById: string | null;
  /** Every first email was refused, so nobody moved; support restarts it. */
  stoppedAt: string | null;
}

export type PriceChangeProgressScope =
  | { kind: 'tier'; organizationId: string }
  | { kind: 'course_plan'; organizationId: string; courseId: string };

/**
 * The progress of an organisation's price changes: its live tiers', or one of
 * its courses' plan. Running or stopped changes, and those finished or
 * replaced in the last 14 days, newest first. One read: the counts are one
 * GROUP BY over (`price_change_id`, `state`).
 */
export async function readPriceChangeProgress(
  db: PriceChangeTx,
  scope: PriceChangeProgressScope,
  now: Date = new Date()
): Promise<PriceChangeProgress[]> {
  const since = new Date(now.getTime() - PROGRESS_SHOWN_FOR_MS);
  const subject =
    scope.kind === 'tier'
      ? sql`JOIN ${subscriptionTiers} t ON t."id" = c."tier_id"
              AND t."organization_id" = c."organization_id"
              AND t."deleted_at" IS NULL`
      : sql`JOIN ${courseSubscriptionPlans} p
              ON p."id" = c."course_subscription_plan_id"
              AND p."deleted_at" IS NULL
            JOIN ${courses} co ON co."id" = p."course_id"
              AND co."organization_id" = c."organization_id"
              AND co."id" = ${scope.courseId}::uuid`;
  const result = await db.execute(sql`
    SELECT c."id", c."tier_id", c."course_subscription_plan_id", c."interval",
           c."from_amount_cents", c."new_amount_cents", c."state",
           c."created_at", c."last_run_at", c."done_at", c."superseded_by_id",
           c."stopped_at",
           count(m."id")::int AS total,
           count(m."id") FILTER (WHERE m."notice_at" IS NOT NULL)::int AS emailed,
           count(m."id") FILTER (WHERE m."state" = 'scheduled')::int AS scheduled,
           count(m."id") FILTER (WHERE m."state" = 'held'
                                   AND m."resolved_at" IS NULL)::int AS held,
           count(m."id") FILTER (WHERE m."state" = 'due')::int AS due,
           count(m."id") FILTER (WHERE m."state" = 'due'
                                   AND m."attempts" > 0)::int AS retrying,
           count(m."id") FILTER (WHERE m."state" IN ('due', 'notified'))::int
             AS remaining
      FROM ${priceChanges} c
      ${subject}
      LEFT JOIN ${subscriptionPriceMoves} m ON m."price_change_id" = c."id"
     WHERE c."organization_id" = ${scope.organizationId}::uuid
       AND c."kind" = ${scope.kind}
       AND (c."state" IN ('running', 'stopped')
            OR c."done_at" >= ${since}::timestamptz
            OR c."superseded_at" >= ${since}::timestamptz)
     GROUP BY c."id"
     ORDER BY c."created_at" DESC, c."id" DESC
     LIMIT ${PROGRESS_LIMIT}::int
  `);
  const iso = (value: unknown) => toDate(value)?.toISOString() ?? null;
  return (result.rows as Array<Record<string, unknown>>).map((r) => {
    const running = r.state === 'running';
    const remaining = Number(r.remaining);
    return {
      id: String(r.id),
      tierId: (r.tier_id as string | null) ?? null,
      courseSubscriptionPlanId:
        (r.course_subscription_plan_id as string | null) ?? null,
      interval:
        r.interval === BILLING_INTERVAL.YEAR
          ? BILLING_INTERVAL.YEAR
          : BILLING_INTERVAL.MONTH,
      fromAmountCents: Number(r.from_amount_cents),
      newAmountCents: Number(r.new_amount_cents),
      state: r.state as PriceChangeState,
      createdAt: iso(r.created_at) ?? now.toISOString(),
      counts: {
        total: Number(r.total),
        emailed: Number(r.emailed),
        scheduled: Number(r.scheduled),
        held: Number(r.held),
        due: Number(r.due),
        retrying: Number(r.retrying),
      },
      lastRunAt: iso(r.last_run_at),
      nextRunAt: running ? nextPriceMovesRunAfter(now).toISOString() : null,
      estimatedDoneAt: running
        ? (priceMovesDoneBy(now, remaining)?.toISOString() ?? null)
        : null,
      doneAt: iso(r.done_at),
      supersededById: (r.superseded_by_id as string | null) ?? null,
      stoppedAt: iso(r.stopped_at),
    };
  });
}
