/**
 * The daily fee step (Codex-2hxff.33; batch C1 Part B data design §1.5).
 *
 * Runs on the existing `0 8 * * *` cron, after the agreement sweep and the
 * money sweep, isolated from both. A fee rise waits until everyone it pays
 * less has been told (F4); this step tells them:
 *
 *   1. LIST: each new waiting rise gets its list on its first morning
 *      (`affectedPayees`, F3), one `announce` notice per person, `on_list`.
 *   2. JOINERS (F8): on later mornings, anyone now affected with no notice is
 *      added (`on_list = false`, so they never hold the date); anyone on the
 *      list no longer affected and not yet told becomes `not_needed`.
 *   3. SEND: up to FEE_NOTICES_PER_RUN notices in `due`, `failed` or
 *      `unknown`, oldest first, claimed under FOR UPDATE SKIP LOCKED. Each
 *      send waits SEND_TIMEOUT_MS at most, and no batch starts after
 *      SENDS_TIME_BUDGET_MS: the rest are given back for the next
 *      morning, so the dates and the alert always run. A notice tried on
 *      an earlier run is first looked for in `email_audit_logs`: shown sent
 *      (`emailLogShowsSent`), it counts as told then and nothing is resent
 *      (M1's rule, on every reclaim). Each email names a date: the change's,
 *      or the earliest it can be (Q1). The words are worked out at send time, so a
 *      rise made smaller is announced with its smaller figure.
 *   4. DATE: a rise whose list has nobody left waiting is dated the first UK
 *      midnight at least 30 days after the last of them was told
 *      (`dateRiseIfAllTold`, shared with support's "told another way"). A
 *      rise whose date has come puts its values in its level's old
 *      `fee_config_*` row (`mirrorLegacyFeeRow`, as every admin write does),
 *      so code rolled back to before 0123 charges the fee sales pay.
 *   5. FOLLOW-UPS: `smaller` (Q2) and `cancelled` (F2) emails go the same
 *      way. They hold nothing, so after 3 failed mornings they are dropped
 *      (`not_needed`) with a log line, and never reach support.
 *   6. ONE ALERT per run names the people not yet told (50 at most, then a
 *      count) and points at Admin › Queue › Fee notices, the durable record.
 *
 * Why here: admin-api has no worker secret (by design), and the template
 * allowlist ships in this worker, so the sender and the allowlist deploy
 * together, as with the money sweep. The 30-day clock starting only once
 * every email is ACCEPTED is what makes a failed send safe: it only moves
 * the date later.
 *
 * Never throws: it runs inside `waitUntil` from `scheduled()`.
 */

import { isEnvName } from '@codex/agreements';
import {
  and,
  asc,
  createPerRequestDbClient,
  type DatabaseWs,
  emailLogShowsSent,
  eq,
  gte,
  inArray,
  isLockNotAvailable,
  isNull,
  lt,
  lte,
  messageForLog,
  or,
  type SQL,
  sql,
} from '@codex/database';
import {
  emailAuditLogs,
  type FeeChangeNoticeRow,
  type FeeChangeRow,
  type FeeNoticeReason,
  type FeeNoticeRole,
  type FeeNoticeRoleValues,
  feeChangeNotices,
  feeChanges,
  feeConfigOrg,
  feeConfigOrgCreator,
  feeConfigPlatform,
  feeConfigVersions,
  organizations,
  users,
} from '@codex/database/schema';
import { TemplateRepository } from '@codex/notifications';
import { ObservabilityClient } from '@codex/observability';
import {
  type AffectedPayee,
  affectedPayees,
  dateRiseIfAllTold,
  dbFeeVersionReader,
  FEE_NOTICE_OPEN_STATES,
  FEE_NOTICE_RECLAIM_AFTER_MS,
  type FeeLevel,
  type FeeVersionList,
  type FeeVersionReader,
  feeLevelKey,
  feeRiseStartAfter,
  lockFeeLevel,
  lockFeeNotices,
  londonDate,
  mirrorLegacyFeeRow,
  queueSmallerFeeNotices,
  readFeeVersions,
  readFeeVersionsByLevel,
  resolveFeesAt,
  WAITING_RISE,
} from '@codex/payments';
import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import {
  buildOrgUrlFromEnv,
  type EnvName,
  buildServiceUrl as getServiceUrl,
} from '@codex/urls';
import {
  feeChangeCancelledData,
  feeChangeNoticeData,
  type OrgNames,
} from './fee-notice-copy';
import { greetingName } from './money-notice-copy';
import { SEND_TIMEOUT_MS, SENDS_TIME_BUDGET_MS } from './send-limits';

/** Emails a run sends at most; the rest go the next morning (§1.5 budget). */
const FEE_NOTICES_PER_RUN = 2000;
/** A follow-up is dropped after this many failed mornings. */
const FOLLOW_UP_TRIES = 3;
/** People named in the run's one alert. */
const ALERT_NAMED = 50;
/** Notices inserted per statement when a list is made. */
const LIST_BATCH = 500;
/** Sends in flight at once. */
const SEND_CONCURRENCY = 8;
/**
 * How long the joiners step waits for an open edit of a rise (its level's
 * lock): an edit commits in milliseconds, so this is only ever reached by a
 * stuck one, whose change then gets its joiners the next morning. Short
 * beside the send budget the steps after it need.
 */
const JOINERS_LOCK_WAIT_MS = 5_000;
/**
 * The owner's rule is to alert only when a person is needed. An `unknown`
 * send (a 5xx or a timeout: it may have gone, and each morning checks the
 * email log, then tries again) is named in the alert only after this many
 * mornings, as a price move is held after PRICE_MOVE_TRIES, or once its rise
 * starts within this many days, too soon for the mornings left. A `failed`
 * one (refused, skipped, no address) can't mend itself: it is named at once.
 */
const UNKNOWN_TRIES_BEFORE_ALERT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const TEMPLATE_FOR = {
  announce: 'fee-change-notice',
  smaller: 'fee-change-notice',
  cancelled: 'fee-change-cancelled',
} as const;
type FeeTemplate = (typeof TEMPLATE_FOR)[keyof typeof TEMPLATE_FOR];
type NoticeKind = keyof typeof TEMPLATE_FOR;

/** What notifications-api answered (the shape of worker-utils' `EmailSendResult`). */
export type FeeNoticeDelivery =
  | { accepted: true }
  | { accepted: false; status: number }
  | { accepted: false; skipped: string }
  | { accepted: false; error: string };

export interface FeeMailerParams {
  to: string;
  toName?: string;
  templateName: FeeTemplate;
  category: 'transactional';
  userId: string;
  organizationId: null;
  data: Record<string, string>;
}

export type FeeMailer = (params: FeeMailerParams) => Promise<FeeNoticeDelivery>;

export interface RunFeeNoticesSweepDeps {
  /** A WebSocket client: making a list and dating a rise are transactions. */
  db: DatabaseWs;
  obs: ObservabilityClient;
  /** Builds the Studio links in every email. */
  environment: EnvName;
  workerSecret: string;
  notificationsUrl: string;
  /** Now override (testing only). */
  now?: Date;
  /** Default: worker-to-worker POST to this worker's /internal/send. */
  mailer?: FeeMailer;
  /** Default: a live global template of that name exists. */
  templateExists?: (name: FeeTemplate) => Promise<boolean>;
  /** Testing only. */
  perRun?: number;
  /**
   * Testing only: failed notices named one by one in a run before the rest
   * fold into one error. Default: ALERT_NAMED.
   */
  alertNamed?: number;
  /** Real time, for the send budget (testing only). */
  clock?: () => number;
  /**
   * When the 08:00 invocation started (ms since the epoch): the send budget
   * counts from it, because the sweeps before this step use the same wall.
   * Default: the step's own start.
   */
  wakeStartedAt?: number;
  /** Testing only. */
  sendTimeoutMs?: number;
  /**
   * Testing only: the step touches these changes alone. It otherwise reads
   * every change, and the test database is shared with other suites.
   */
  onlyChanges?: readonly string[];
}

export interface FeeNoticesSweepResult {
  listsMade: number;
  listed: number;
  joinersAdded: number;
  notNeeded: number;
  sent: number;
  failed: number;
  unknown: number;
  /** `unknown` notices the email log showed were sent: not resent. */
  foundInLog: number;
  /** Follow-ups dropped after their tries. */
  dropped: number;
  /** Claims given back unsent: the send budget ran out. */
  givenBack: number;
  /**
   * Outcomes not written: the notice changed under its send (a new round,
   * support told them another way, or a void closed it under a refusal).
   * Every one is also a warning.
   */
  notRecorded: number;
  dated: number;
  /** Levels whose old fee row took a rise that has started. */
  mirrored: number;
  skippedTemplates: FeeTemplate[];
  errors: number;
}

interface SweepContext {
  db: DatabaseWs;
  obs: ObservabilityClient;
  mailer: FeeMailer;
  now: Date;
  /** Real time; no send batch starts once it reaches `sendsUntil`. */
  clock: () => number;
  sendsUntil: number;
  environment: EnvName;
  perRun: number;
  enabled: ReadonlySet<FeeTemplate>;
  result: FeeNoticesSweepResult;
  /** Each change's affected people, worked out once per run. */
  payees: Map<string, Promise<Map<string, AffectedPayee>>>;
  /**
   * The live version of each change when its figures were read, so a send
   * can tell whether the rise was made smaller after (`figuresMovedSince`).
   */
  readVersions: Map<string, Promise<string | null>>;
  orgNames: Map<string, { name: string; slug: string }>;
  onlyChanges: readonly string[] | null;
  alertNamed: number;
  /** Notices whose send threw this run, and the changes of those not named. */
  noticeFailures: number;
  foldedChangeIds: Set<string>;
}

/** `onlyChanges` as a filter on `fee_changes`; none in production. */
function scope(ctx: SweepContext) {
  return ctx.onlyChanges
    ? inArray(feeChanges.id, [...ctx.onlyChanges])
    : undefined;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function makeDefaultMailer(deps: {
  notificationsUrl: string;
  workerSecret: string;
  timeoutMs: number;
}): FeeMailer {
  return async (params) => {
    let res: Response;
    try {
      res = await workerFetch(
        `${deps.notificationsUrl}/internal/send`,
        {
          method: 'POST',
          body: JSON.stringify(params),
          // A timeout aborts the request, or the body read below, and
          // either way the outcome is `unknown`.
          signal: AbortSignal.timeout(deps.timeoutMs),
        },
        deps.workerSecret
      );
    } catch (error) {
      return { accepted: false, error: messageForLog(error) };
    }
    if (!res.ok) return { accepted: false, status: res.status };
    const body = (await res.json().catch(() => null)) as {
      data?: { success?: unknown; skipped?: unknown };
    } | null;
    if (body?.data?.success === true) return { accepted: true };
    if (typeof body?.data?.skipped === 'string') {
      return { accepted: false, skipped: body.data.skipped };
    }
    return { accepted: false, error: 'a 2xx without a readable result' };
  };
}

/**
 * What a delivery means for the notice: sent, a definite failure (the email
 * certainly did not go: a 4xx, a skip, no address) or unknown (a 5xx, a
 * timeout: it MAY have gone, so the next run checks the email log first).
 */
function outcomeOf(
  delivery: FeeNoticeDelivery | 'no_address'
):
  | { state: 'sent' }
  | { state: 'failed' | 'unknown'; reason: FeeNoticeReason; error: string } {
  if (delivery === 'no_address') {
    return { state: 'failed', reason: 'no_address', error: 'no email address' };
  }
  if (delivery.accepted) return { state: 'sent' };
  if ('skipped' in delivery) {
    return {
      state: 'failed',
      reason: 'skipped',
      error: `skipped: ${delivery.skipped}`,
    };
  }
  if ('status' in delivery) {
    return delivery.status < 500
      ? { state: 'failed', reason: 'refused', error: `HTTP ${delivery.status}` }
      : {
          state: 'unknown',
          reason: 'unknown',
          error: `HTTP ${delivery.status}`,
        };
  }
  return { state: 'unknown', reason: 'unknown', error: delivery.error };
}

// ─── 1. Lists ────────────────────────────────────────────────────────────────

async function insertNotices(
  db: DatabaseWs | Parameters<Parameters<DatabaseWs['transaction']>[0]>[0],
  changeId: string,
  payees: AffectedPayee[],
  onList: boolean,
  now: Date
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < payees.length; i += LIST_BATCH) {
    const rows = await db
      .insert(feeChangeNotices)
      .values(
        payees.slice(i, i + LIST_BATCH).map((payee) => ({
          changeId,
          userId: payee.userId,
          kind: 'announce' as const,
          onList,
          roles: payee.roles,
          beforeValues: payee.before,
          afterValues: payee.after,
          // The run's clock, as attempted_at: foundSent searches the email
          // log from it.
          createdAt: now,
        }))
      )
      .onConflictDoNothing({
        target: [
          feeChangeNotices.changeId,
          feeChangeNotices.userId,
          feeChangeNotices.kind,
        ],
      })
      .returning({ id: feeChangeNotices.id });
    inserted += rows.length;
  }
  return inserted;
}

async function makeLists(ctx: SweepContext): Promise<Set<string>> {
  const made = new Set<string>();
  const waiting = await ctx.db
    .select({ id: feeChanges.id })
    .from(feeChanges)
    .where(and(WAITING_RISE, isNull(feeChanges.firstRunAt), scope(ctx)))
    .orderBy(asc(feeChanges.createdAt));
  for (const { id } of waiting) {
    try {
      const listed = await ctx.db.transaction(async (tx) => {
        const [change] = await tx
          .select()
          .from(feeChanges)
          .where(eq(feeChanges.id, id))
          .for('update');
        if (
          !change ||
          change.firstRunAt !== null ||
          change.voidedAt !== null ||
          change.effectiveFrom !== null
        ) {
          return null;
        }
        const payees = await affectedPayees(tx, change, ctx.now);
        await insertNotices(tx, id, payees, true, ctx.now);
        await tx
          .update(feeChanges)
          .set({ firstRunAt: ctx.now, listedCount: payees.length })
          .where(eq(feeChanges.id, id));
        return payees.length;
      });
      if (listed === null) continue;
      made.add(id);
      ctx.result.listsMade += 1;
      ctx.result.listed += listed;
      ctx.obs.info('fee step: list made', { changeId: id, listed });
    } catch (error) {
      ctx.result.errors += 1;
      ctx.obs.error('fee step: a list could not be made', {
        errorId: crypto.randomUUID(),
        changeId: id,
        error: messageForLog(error),
      });
    }
  }
  return made;
}

// ─── 2. Joiners ──────────────────────────────────────────────────────────────

/** Changes with a list that haven't started: the ones still being told about. */
function notStarted(now: Date) {
  return and(
    eq(feeChanges.kind, 'rise'),
    isNull(feeChanges.voidedAt),
    sql`${feeChanges.firstRunAt} IS NOT NULL`,
    sql`(${feeChanges.effectiveFrom} IS NULL OR ${feeChanges.effectiveFrom} > ${now})`
  );
}

/** The change's live version: a rise made smaller gets a new one. */
async function liveVersionOf(
  ctx: SweepContext,
  changeId: string
): Promise<string | null> {
  const [live] = await ctx.db
    .select({ id: feeConfigVersions.id })
    .from(feeConfigVersions)
    .where(
      and(
        eq(feeConfigVersions.changeId, changeId),
        isNull(feeConfigVersions.supersededAt)
      )
    )
    .limit(1);
  return live?.id ?? null;
}

/** Each change's affected people, read once per run (`currentPayeesOf`). */
function payeesOf(
  ctx: SweepContext,
  change: FeeChangeRow
): Promise<Map<string, AffectedPayee>> {
  let found = ctx.payees.get(change.id);
  if (!found) {
    // The version first, then the figures: a cut between the two reads as
    // a move, and the figures, read after it, then compare equal.
    const version = liveVersionOf(ctx, change.id);
    const reading = version
      .then(() => affectedPayees(ctx.db, change, ctx.now))
      .then((list) => new Map(list.map((p) => [p.userId, p])));
    // A failed read is never kept: the next part reads again, rather than
    // every notice of the change failing on the one rejection.
    reading.catch(() => {
      if (ctx.payees.get(change.id) === reading) {
        ctx.payees.delete(change.id);
        ctx.readVersions.delete(change.id);
      }
    });
    ctx.payees.set(change.id, reading);
    ctx.readVersions.set(change.id, version);
    found = reading;
  }
  return found;
}

/**
 * The change's affected people as they stand now: the run's read, unless
 * the rise was edited since (its live version moved), when it is read again
 * for the rest of the run (review final S2). Asked after the claim, so a
 * rise made smaller between the joiners step's read and the claim sends its
 * new figure, never the earlier one. A cut locks the change's notices before
 * it queues (`lockFeeNotices`): the claim passes them by while it is open,
 * and one it meets already claimed is tried, so the cut itself queues their
 * smaller emails (`feeNoticeMayHaveTold`).
 */
async function currentPayeesOf(
  ctx: SweepContext,
  change: FeeChangeRow
): Promise<Map<string, AffectedPayee>> {
  const read = ctx.readVersions.get(change.id);
  if (read) {
    const [readId, liveId] = await Promise.all([
      read,
      liveVersionOf(ctx, change.id),
    ]);
    // One send's check clears it once; the others share the fresh read.
    if (readId !== liveId && ctx.readVersions.get(change.id) === read) {
      ctx.payees.delete(change.id);
      ctx.readVersions.delete(change.id);
    }
  }
  return payeesOf(ctx, change);
}

/**
 * S2: an email that carried figures read before the rise was made smaller
 * names a bigger figure than the rise now holds, so its person is owed the
 * smaller email (Q2 (A)). A backstop only. Every cut locks the change's
 * notices before it queues (`lockFeeNotices`), so the claim passes them by
 * while it is open, and one claimed before it is read as tried and queued
 * by the cut itself. No notice is made while a cut is open, so none escapes
 * that lock: a list waits on the change row the cut holds, and a joiner on
 * the level's lock (`addChangeJoiners`). This check finds nothing then, and
 * queues nothing; it stays for an insert path that one day skips those
 * locks.
 */
async function figuresMovedSince(
  ctx: SweepContext,
  change: FeeChangeRow,
  userId: string,
  toldAfter: FeeNoticeRoleValues[]
): Promise<boolean> {
  const now = (await currentPayeesOf(ctx, change)).get(userId);
  return now !== undefined && figuresOf(now.after) !== figuresOf(toldAfter);
}

/**
 * A person's figures as one comparable string, by role: the members read
 * has no order, so two roles can come back either way round (review final
 * silent L3), and each role's values are read field by field, never by an
 * object's key order.
 */
function figuresOf(values: FeeNoticeRoleValues[]): string {
  const fields = (v: FeeNoticeRoleValues['oneOff']) => [
    v.platformFeePercent,
    v.orgFeePercent,
    v.minPlatformFeeCents,
    v.minTransferCents,
  ];
  return values
    .map((v) =>
      [
        v.organizationId ?? '',
        v.as,
        ...fields(v.oneOff),
        ...fields(v.subscription),
      ].join(':')
    )
    .sort()
    .join('|');
}

async function addJoiners(
  ctx: SweepContext,
  listedThisRun: ReadonlySet<string>
): Promise<void> {
  const changes = await ctx.db
    .select()
    .from(feeChanges)
    .where(and(notStarted(ctx.now), scope(ctx)))
    .orderBy(asc(feeChanges.createdAt));
  for (const change of changes) {
    if (listedThisRun.has(change.id)) continue;
    try {
      await ctx.db.transaction((tx) => addChangeJoiners(ctx, tx, change));
    } catch (error) {
      if (isLockNotAvailable(error)) {
        ctx.obs.warn(
          'fee step: a fee rise was being edited past the wait; its joiners are added the next morning',
          { changeId: change.id, waitedMs: JOINERS_LOCK_WAIT_MS }
        );
        continue;
      }
      ctx.result.errors += 1;
      ctx.obs.error('fee step: joiners could not be added for a change', {
        errorId: crypto.randomUUID(),
        changeId: change.id,
        error: messageForLog(error),
      });
    }
  }
}

/**
 * One change's joiners, set aside and back, under its level's lock
 * (`lockFeeLevel`), which every edit of the rise (a cut, a void) holds for
 * its whole transaction (review final, commerce confirm NIT). So a joiner
 * waits for an open edit, then its figures are read as that edit left them,
 * and it is inserted before the next edit's `lockFeeNotices` can pass it
 * by: an edit open while a joiner was added can't leave them the earlier
 * figure. The wait is bounded (JOINERS_LOCK_WAIT_MS, `lock_timeout`, which
 * covers every lock this transaction takes): a stuck edit puts this
 * change's joiners off to the next morning, and never the send budget the
 * steps after this one need. The level lock comes first, before any
 * notice row, as an edit takes it before `lockFeeNotices`.
 */
async function addChangeJoiners(
  ctx: SweepContext,
  tx: SweepTx,
  change: FeeChangeRow
): Promise<void> {
  await tx.execute(
    sql.raw(`SET LOCAL lock_timeout = '${JOINERS_LOCK_WAIT_MS}ms'`)
  );
  await lockFeeLevel(tx, levelOfChange(change));
  // Read after the lock: an edit that held it has committed.
  const affected = await currentPayeesOf(ctx, change);
  const existing = await tx
    .select({
      id: feeChangeNotices.id,
      userId: feeChangeNotices.userId,
      state: feeChangeNotices.state,
    })
    .from(feeChangeNotices)
    .where(
      and(
        eq(feeChangeNotices.changeId, change.id),
        eq(feeChangeNotices.kind, 'announce')
      )
    );
  const known = new Map(existing.map((n) => [n.userId, n]));
  const joiners = [...affected.values()].filter((p) => !known.has(p.userId));
  const added = await insertNotices(tx, change.id, joiners, false, ctx.now);
  ctx.result.joinersAdded += added;

  const gone = existing
    .filter(
      (n) =>
        (FEE_NOTICE_OPEN_STATES as readonly string[]).includes(n.state) &&
        !affected.has(n.userId)
    )
    .map((n) => n.id);
  if (gone.length > 0) {
    await tx
      .update(feeChangeNotices)
      .set({ state: 'not_needed', updatedAt: ctx.now })
      .where(
        and(
          inArray(feeChangeNotices.id, gone),
          inArray(feeChangeNotices.state, [...FEE_NOTICE_OPEN_STATES])
        )
      );
    ctx.result.notNeeded += gone.length;
  }
  // Affected again after being set aside: back to due.
  const back = existing
    .filter((n) => n.state === 'not_needed' && affected.has(n.userId))
    .map((n) => n.id);
  if (back.length > 0) {
    await tx
      .update(feeChangeNotices)
      .set({ state: 'due', attempts: 0, updatedAt: ctx.now })
      .where(
        and(
          inArray(feeChangeNotices.id, back),
          eq(feeChangeNotices.state, 'not_needed')
        )
      );
  }
}

// ─── 3 + 5. Sends ────────────────────────────────────────────────────────────

interface Claimed {
  id: string;
  changeId: string;
  userId: string;
  kind: NoticeKind;
  onList: boolean;
  state: string;
  attempts: number;
  roles: FeeNoticeRole[];
  beforeValues: FeeNoticeRoleValues[];
  afterValues: FeeNoticeRoleValues[];
  quotedFrom: string | null;
  prevAttemptedAt: Date | null;
  createdAt: Date;
}

async function claim(ctx: SweepContext): Promise<Claimed[]> {
  const kinds = (Object.keys(TEMPLATE_FOR) as NoticeKind[]).filter((kind) =>
    ctx.enabled.has(TEMPLATE_FOR[kind])
  );
  if (kinds.length === 0) return [];
  // A notice tried this recently may still be held by a run.
  const reclaimBefore = new Date(
    ctx.now.getTime() - FEE_NOTICE_RECLAIM_AFTER_MS
  );
  const result = await ctx.db.execute(sql`
    WITH picked AS (
      SELECT n.id, n.attempted_at AS prev_attempted_at
      FROM ${feeChangeNotices} n
      JOIN ${feeChanges} c ON c.id = n.change_id
      WHERE n.state IN ('due', 'failed', 'unknown')
        AND n.kind IN (${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `
        )})
        AND (n.attempted_at IS NULL OR n.attempted_at < ${reclaimBefore})
        ${
          ctx.onlyChanges
            ? sql`AND c.id IN (${sql.join(
                ctx.onlyChanges.map((id) => sql`${id}`),
                sql`, `
              )})`
            : sql``
        }
        AND (
          n.kind = 'cancelled'
          OR (c.voided_at IS NULL AND (c.effective_from IS NULL OR c.effective_from > ${ctx.now}))
        )
      ORDER BY n.created_at, n.id
      LIMIT ${ctx.perRun}
      FOR UPDATE OF n SKIP LOCKED
    )
    UPDATE ${feeChangeNotices} AS n
    SET attempted_at = ${ctx.now}, attempts = n.attempts + 1, updated_at = ${ctx.now}
    FROM picked
    WHERE n.id = picked.id
    RETURNING n.id, n.change_id, n.user_id, n.kind, n.on_list, n.state,
      n.attempts, n.roles, n.before_values, n.after_values, n.quoted_from,
      picked.prev_attempted_at, n.created_at
  `);
  type Row = {
    id: string;
    change_id: string;
    user_id: string;
    kind: NoticeKind;
    on_list: boolean;
    state: string;
    attempts: number;
    roles: FeeNoticeRole[];
    before_values: FeeNoticeRoleValues[];
    after_values: FeeNoticeRoleValues[];
    quoted_from: string | Date | null;
    prev_attempted_at: string | Date | null;
    created_at: string | Date;
  };
  return (result.rows as Row[]).map((row) => ({
    id: row.id,
    changeId: row.change_id,
    userId: row.user_id,
    kind: row.kind,
    onList: row.on_list,
    state: row.state,
    attempts: row.attempts,
    roles: row.roles,
    beforeValues: row.before_values,
    afterValues: row.after_values,
    quotedFrom:
      row.quoted_from instanceof Date
        ? row.quoted_from.toISOString().slice(0, 10)
        : row.quoted_from,
    prevAttemptedAt: row.prev_attempted_at
      ? new Date(row.prev_attempted_at)
      : null,
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Did the email go after all? Asked on every claim after an earlier try,
 * whatever that try recorded (as the price-moves step): a run cut off after
 * sending leaves the notice `due`. A row in the email log for this notice
 * that `@codex/database`'s `emailLogShowsSent` accepts at the run's clock
 * counts as told then: `success`, or `pending` while its send may still be
 * in flight, never a test send. A `pending` row an earlier run left is not
 * told: its outcome never came, so the email goes again (owner, 2026-11-09;
 * it replaces review C1's F4, "a `pending` row counts"). The search starts
 * at the notice's making, not its last try, so a morning that failed before
 * recording can't hide an earlier morning's send (review cycle 2, L6); its
 * feeNoticeId pins the row either way.
 * A row told again keeps its id, so the log line must also be this ROUND's:
 * each email carries the round's created_at (`feeNoticeRound`), and a line
 * from an earlier round never counts, however close in time (review final
 * M2). A line with no round at all was sent before rounds were carried, and
 * is matched by id alone, as it always was.
 */
/** The notice's round, as its emails carry it: created_at to the millisecond. */
const roundOf = (notice: Claimed): string => notice.createdAt.toISOString();

async function foundSent(
  ctx: SweepContext,
  notice: Claimed,
  email: string
): Promise<Date | null> {
  const since = new Date(notice.createdAt.getTime() - 60 * 1000);
  const [row] = await ctx.db
    .select({ at: emailAuditLogs.updatedAt })
    .from(emailAuditLogs)
    .where(
      and(
        eq(emailAuditLogs.templateName, TEMPLATE_FOR[notice.kind]),
        eq(emailAuditLogs.recipientEmail, email),
        emailLogShowsSent(ctx.now),
        gte(emailAuditLogs.createdAt, since),
        sql`strpos(${emailAuditLogs.metadata}, ${`"feeNoticeId":"${notice.id}"`}) > 0`,
        sql`(strpos(${emailAuditLogs.metadata}, ${`"feeNoticeRound":"${roundOf(notice)}"`}) > 0
          OR strpos(${emailAuditLogs.metadata}, '"feeNoticeRound":') = 0)`
      )
    )
    .limit(1);
  return row?.at ?? null;
}

async function namesOf(
  ctx: SweepContext,
  roles: FeeNoticeRole[]
): Promise<OrgNames> {
  const ids = [
    ...new Set(
      roles.flatMap((r) => (r.organizationId ? [r.organizationId] : []))
    ),
  ].filter((id) => !ctx.orgNames.has(id));
  if (ids.length > 0) {
    const rows = await ctx.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(inArray(organizations.id, ids));
    for (const row of rows) {
      ctx.orgNames.set(row.id, { name: row.name, slug: row.slug });
    }
  }
  return ctx.orgNames;
}

/** Earnings for anyone told as a creator (Q3); Billing for an owner. */
function studioUrlFor(
  ctx: SweepContext,
  roles: FeeNoticeRole[],
  names: OrgNames
): string {
  const owned = roles.find((r) => r.as === 'owner' && r.organizationId);
  if (!roles.some((r) => r.as === 'creator') && owned?.organizationId) {
    const slug = names.get(owned.organizationId)?.slug;
    if (slug)
      return buildOrgUrlFromEnv(ctx.environment, slug, '/studio/billing');
  }
  return buildOrgUrlFromEnv(ctx.environment, 'creators', '/studio/earnings');
}

/**
 * Where a role's fees resolve, for the cancelled email's "stays at": a
 * creator's own override layers over their organisation's; an owner's share
 * moved with a creator's override only under a creator-scope change.
 */
function feeScopeOf(
  userId: string,
  role: FeeNoticeRole,
  change: FeeChangeRow
): { organizationId: string | null; creatorId: string | null } {
  const creatorId =
    role.as === 'creator'
      ? userId
      : change.scope === 'creator'
        ? change.creatorId
        : null;
  return {
    organizationId: role.organizationId,
    creatorId: role.organizationId ? creatorId : null,
  };
}

/** The levels `resolveFeesAt` reads for a scope. */
function levelsOf(scope: {
  organizationId: string | null;
  creatorId: string | null;
}): FeeLevel[] {
  const levels: FeeLevel[] = [{ scope: 'platform' }];
  if (scope.organizationId) {
    levels.push({ scope: 'org', organizationId: scope.organizationId });
    if (scope.creatorId) {
      levels.push({
        scope: 'creator',
        organizationId: scope.organizationId,
        creatorId: scope.creatorId,
      });
    }
  }
  return levels;
}

/**
 * The level a change was saved on: the last of its scope's levels (its
 * scope CHECK guarantees the keys).
 */
function levelOfChange(change: FeeChangeRow): FeeLevel {
  const levels = levelsOf({
    organizationId: change.scope === 'platform' ? null : change.organizationId,
    creatorId: change.scope === 'creator' ? change.creatorId : null,
  });
  return levels[levels.length - 1] ?? { scope: 'platform' };
}

/** A role's fees in force now. */
async function feesNow(
  ctx: SweepContext,
  read: FeeVersionReader,
  userId: string,
  role: FeeNoticeRole,
  change: FeeChangeRow
): Promise<FeeNoticeRoleValues> {
  const params = { ...feeScopeOf(userId, role, change), at: ctx.now };
  const [oneOff, subscription] = await Promise.all([
    resolveFeesAt(read, { ...params, ctx: 'one_off' }),
    resolveFeesAt(read, { ...params, ctx: 'subscription' }),
  ]);
  return { ...role, oneOff, subscription };
}

/** What the follow-up emails need, read once for the batch. */
interface FollowUpReads {
  /** Each person's announcement of each change, by `changeId:userId`. */
  announces: Map<string, { acceptedAt: Date | null; toldAt: Date | null }>;
  /** Fee versions for a cancelled email's "stays at". */
  read: FeeVersionReader;
}

const isFollowUp = (notice: Claimed) =>
  notice.kind === 'cancelled' || notice.kind === 'smaller';

const distinct = (values: Array<string | null>): string[] => [
  ...new Set(values.filter((v): v is string => v !== null)),
];

/**
 * The follow-ups' reads, once for the batch rather than once a notice
 * (review cycle 2, L5): each one's announcement in one query, and the fee
 * levels the cancelled ones resolve through, one query per scope (as
 * support's fee cards read them). A level not read here is read when
 * asked, so the up-front set only saves reads, never decides an answer.
 */
async function readFollowUps(
  ctx: SweepContext,
  notices: Claimed[],
  changes: Map<string, FeeChangeRow>
): Promise<FollowUpReads> {
  const live = dbFeeVersionReader(ctx.db);
  const followUps = notices.filter(isFollowUp);
  if (followUps.length === 0) return { announces: new Map(), read: live };
  const levels = followUps.flatMap((notice) => {
    const change = changes.get(notice.changeId);
    if (notice.kind !== 'cancelled' || !change) return [];
    return notice.roles.flatMap((role) =>
      levelsOf(feeScopeOf(notice.userId, role, change))
    );
  });
  const orgIds = distinct(
    levels.map((l) => (l.scope === 'platform' ? null : l.organizationId))
  );
  const creatorIds = distinct(
    levels.map((l) => (l.scope === 'creator' ? l.creatorId : null))
  );
  const none = Promise.resolve(new Map<string, FeeVersionList>());
  const [announced, platform, orgLevels, creatorLevels] = await Promise.all([
    ctx.db
      .select({
        changeId: feeChangeNotices.changeId,
        userId: feeChangeNotices.userId,
        acceptedAt: feeChangeNotices.acceptedAt,
        toldAt: feeChangeNotices.toldAt,
      })
      .from(feeChangeNotices)
      .where(
        and(
          eq(feeChangeNotices.kind, 'announce'),
          inArray(
            feeChangeNotices.changeId,
            distinct(followUps.map((n) => n.changeId))
          ),
          inArray(
            feeChangeNotices.userId,
            distinct(followUps.map((n) => n.userId))
          )
        )
      ),
    levels.length > 0 ? readFeeVersions(ctx.db, { scope: 'platform' }) : null,
    orgIds.length > 0
      ? readFeeVersionsByLevel(
          ctx.db,
          'org',
          inArray(feeChanges.organizationId, orgIds)
        )
      : none,
    creatorIds.length > 0
      ? readFeeVersionsByLevel(
          ctx.db,
          'creator',
          and(
            inArray(feeChanges.organizationId, orgIds),
            inArray(feeChanges.creatorId, creatorIds)
          )
        )
      : none,
  ]);
  const lists = new Map([...orgLevels, ...creatorLevels]);
  if (platform) lists.set(feeLevelKey({ scope: 'platform' }), platform);
  const readUpFront = new Set(levels.map(feeLevelKey));
  return {
    announces: new Map(
      announced.map(({ changeId, userId, ...at }) => [
        `${changeId}:${userId}`,
        at,
      ])
    ),
    read: async (level) => {
      const key = feeLevelKey(level);
      if (!readUpFront.has(key)) return live(level);
      return lists.get(key) ?? { versions: [], waiting: false };
    },
  };
}

/**
 * A failed batch read gives the follow-ups back, untried, with one alert,
 * so a blip spends none of their tries; the announcements go on (SF-8's
 * rule for a failed payee read).
 */
async function withFollowUpReads(
  ctx: SweepContext,
  claimed: Claimed[],
  changes: Map<string, FeeChangeRow>
): Promise<{ sendable: Claimed[]; reads: FollowUpReads }> {
  try {
    return {
      sendable: claimed,
      reads: await readFollowUps(ctx, claimed, changes),
    };
  } catch (error) {
    const followUps = claimed.filter(isFollowUp);
    const givenBack = await giveBack(ctx, followUps);
    ctx.result.errors += 1;
    ctx.obs.error(
      'fee step: could not read what the follow-up emails need; they go tomorrow',
      {
        errorId: crypto.randomUUID(),
        givenBack,
        changeIds: distinct(followUps.map((n) => n.changeId)).slice(
          0,
          ALERT_NAMED
        ),
        error: messageForLog(error),
      }
    );
    return {
      sendable: claimed.filter((n) => !isFollowUp(n)),
      reads: { announces: new Map(), read: dbFeeVersionReader(ctx.db) },
    };
  }
}

type SweepTx = Parameters<Parameters<DatabaseWs['transaction']>[0]>[0];

/**
 * What `record` did with an outcome: written on the open round it claimed,
 * written on a row a void closed while the email was in flight, or not
 * written (the row moved on: a new round, or support told them).
 */
type Recorded = 'written' | 'voided' | 'not_recorded';

/**
 * What a send did, written on the round it claimed while that row is still
 * open (`due`, `failed` or `unknown`). Two writes can move it while the
 * email is in flight:
 *   - a rise made smaller starts it a new round (`queueSmallerFeeNotices`: a
 *     new created_at, untried). This email carried the figure read before
 *     that, so nothing is recorded on the new round (Codex-2hxff.104);
 *   - a rise voided sets it `not_needed` (`voidPending`). The row ends as
 *     voidPending leaves one that already had this outcome: an email that
 *     went is recorded `sent`, one with no answer stays `not_needed` with
 *     what it may have told, and both are owed the "it's off" email
 *     (`tellOfVoid`). One refused is not written: nobody was told.
 * Each check is in an UPDATE's WHERE, not a read before it: an UPDATE that
 * meets the other write's lock waits, then tests the committed row.
 * created_at holds microseconds (the column's now() default) and the claim
 * read it to the millisecond, so both sides are compared at that.
 * `toldAgain` (`figuresMovedSince`) queues this person's smaller email with
 * the write. One transaction holds the write and what it queues (review
 * final S3): if either fails, neither lands, and the row stays as it was.
 * Its row lock keeps a void out until both commit, so a smaller email is
 * never queued for a rise already off.
 */
async function record(
  ctx: SweepContext,
  notice: Claimed,
  set: Partial<FeeChangeNoticeRow>,
  toldAgain = false
): Promise<Recorded> {
  const ours = [
    eq(feeChangeNotices.id, notice.id),
    sql`date_trunc('milliseconds', ${feeChangeNotices.createdAt}) = ${notice.createdAt}::timestamptz`,
  ];
  const done = await ctx.db.transaction(async (tx) => {
    // A re-tell writes this row, then the person's smaller row: both taken
    // first, in the one order a cut and a void take a change's notices
    // (`lockFeeNotices`), so none of them holds a row the other waits for.
    if (toldAgain) {
      await lockFeeNotices(tx, {
        changeId: notice.changeId,
        userId: notice.userId,
      });
    }
    const writeIf = async (
      state: SQL,
      values: Partial<FeeChangeNoticeRow> = set
    ): Promise<boolean> => {
      const written = await tx
        .update(feeChangeNotices)
        .set({ ...values, updatedAt: ctx.now })
        .where(and(...ours, state))
        .returning({ id: feeChangeNotices.id });
      return written.length > 0;
    };
    if (
      await writeIf(
        inArray(feeChangeNotices.state, [...FEE_NOTICE_OPEN_STATES])
      )
    ) {
      if (toldAgain) {
        await queueSmallerFeeNotices(tx, {
          changeId: notice.changeId,
          now: ctx.now,
          userId: notice.userId,
        });
      }
      return { recorded: 'written' as const };
    }
    const thisSendMayHaveTold = set.state === 'sent' || set.state === 'unknown';
    if (
      thisSendMayHaveTold &&
      (await writeIf(
        eq(feeChangeNotices.state, 'not_needed'),
        set.state === 'sent' ? set : { ...set, state: 'not_needed' }
      ))
    ) {
      return {
        recorded: 'voided' as const,
        cancelledNoticeQueued: await tellOfVoid(tx, ctx.now, notice),
      };
    }
    return { recorded: 'not_recorded' as const };
  });
  const ids = { feeNoticeId: notice.id, changeId: notice.changeId };
  if (done.recorded === 'written') {
    if (toldAgain) {
      ctx.obs.info(
        'fee step: a fee email named a figure the rise was cut from since; the smaller email is owed',
        ids
      );
    }
  } else if (done.recorded === 'voided') {
    ctx.obs.info(
      'fee step: a fee rise was voided while its email was in flight; the cancellation email is owed',
      {
        ...ids,
        outcome: set.state,
        cancelledNoticeQueued: done.cancelledNoticeQueued,
      }
    );
  } else {
    // Expected only in a race with an edit; a run of them means the write
    // itself no longer finds its rows (S5).
    ctx.result.notRecorded += 1;
    ctx.obs.warn(
      'fee step: a notice changed while this run held it; this outcome is not recorded on it',
      { errorId: crypto.randomUUID(), ...ids, outcome: set.state }
    );
  }
  return done.recorded;
}

/**
 * voidPending's rule for the "it's off" email (F2), for one person whose
 * email went, or may have (`unknown`), while the rise was being voided:
 * everyone a called-off rise may have told is emailed, with what they were
 * told, unless a bigger rise replaced it (whose own email says so). The same
 * statement as voidPending's, narrowed to this person; the send's outcome,
 * not the row's state, is what says they may have been told. voidPending
 * itself queues one for a notice in flight (`feeNoticeMayHaveTold`), but
 * with what the row held before this send; so one still untried takes what
 * this email told, and one already tried is kept. Either way there is one
 * per person. It runs in `record`'s transaction, after its write, which
 * waited for the void to commit, so it reads the void as committed.
 */
async function tellOfVoid(
  tx: SweepTx,
  now: Date,
  notice: Claimed
): Promise<boolean> {
  const added = await tx.execute(sql`
    INSERT INTO ${feeChangeNotices}
      (change_id, user_id, kind, on_list, roles, before_values, after_values, quoted_from, state)
    SELECT n.change_id, n.user_id, 'cancelled', false, n.roles, n.before_values, n.after_values, n.quoted_from, 'due'
    FROM ${feeChangeNotices} n
    JOIN ${feeChanges} c ON c.id = n.change_id
    WHERE n.change_id = ${notice.changeId}
      AND n.user_id = ${notice.userId}
      AND n.kind = 'announce'
      AND c.voided_at IS NOT NULL
      AND c.void_reason <> 'replaced_by_bigger'
    ON CONFLICT (change_id, user_id, kind) DO UPDATE
      SET roles = EXCLUDED.roles, before_values = EXCLUDED.before_values,
          after_values = EXCLUDED.after_values, quoted_from = EXCLUDED.quoted_from,
          updated_at = ${now}::timestamptz
      WHERE ${feeChangeNotices}.state = 'due' AND ${feeChangeNotices}.attempts = 0
    RETURNING id
  `);
  return added.rows.length > 0;
}

interface Recipient {
  name: string;
  email: string;
  deletedAt: Date | null;
}

/** Every claimed notice's person, in one read. */
async function recipientsOf(
  ctx: SweepContext,
  claimed: Claimed[]
): Promise<Map<string, Recipient>> {
  const ids = [...new Set(claimed.map((n) => n.userId))];
  const rows = await ctx.db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map(({ id, ...person }) => [id, person]));
}

async function sendOne(
  ctx: SweepContext,
  notice: Claimed,
  changes: Map<string, FeeChangeRow>,
  people: Map<string, Recipient>,
  reads: FollowUpReads
): Promise<void> {
  const change = changes.get(notice.changeId);
  if (!change) return;
  // 5. A follow-up holds nothing: after its tries it is dropped.
  if (notice.kind !== 'announce' && notice.attempts > FOLLOW_UP_TRIES) {
    if ((await record(ctx, notice, { state: 'not_needed' })) === 'not_recorded')
      return;
    ctx.result.dropped += 1;
    ctx.obs.warn('fee step: a follow-up email was dropped after its tries', {
      errorId: crypto.randomUUID(),
      feeNoticeId: notice.id,
      changeId: notice.changeId,
      kind: notice.kind,
    });
    return;
  }
  const person = people.get(notice.userId);
  const email = person && person.deletedAt === null ? person.email : null;

  if (notice.prevAttemptedAt !== null && email) {
    const at = await foundSent(ctx, notice, email);
    if (at) {
      // Its figures need no check here: every cut since it went found it
      // `unknown` or tried, and queued its smaller email itself. A cut locks
      // the change's notices before it queues (`lockFeeNotices`), so the
      // claim passes them by while it is open, and no notice is made while
      // a cut is open (a list waits on the change row, a joiner on the
      // level's lock), so none escapes that lock.
      const found = await record(ctx, notice, {
        state: 'sent',
        acceptedAt: at,
        lastReason: null,
        lastError: null,
      });
      if (found !== 'not_recorded') ctx.result.foundInLog += 1;
      return;
    }
  }

  let data: Record<string, string>;
  let told: Partial<FeeChangeNoticeRow> = {};
  const announce =
    reads.announces.get(`${notice.changeId}:${notice.userId}`) ?? null;
  if (notice.kind === 'cancelled') {
    const names = await namesOf(ctx, notice.roles);
    const now = await Promise.all(
      notice.roles.map((role) =>
        feesNow(ctx, reads.read, notice.userId, role, change)
      )
    );
    data = feeChangeCancelledData({
      userName: greetingName(person?.name),
      roles: notice.roles,
      toldBefore: notice.beforeValues,
      toldAfter: notice.afterValues,
      now,
      names,
      announcedAt: announce?.acceptedAt ?? announce?.toldAt ?? null,
      toldStartsOn: notice.quotedFrom
        ? new Date(`${notice.quotedFrom}T12:00:00Z`)
        : null,
    });
  } else {
    const payee = (await payeesOf(ctx, change)).get(notice.userId);
    if (!payee) {
      // Their own setting, or a role they left, shields them now.
      if (
        (await record(ctx, notice, { state: 'not_needed' })) !== 'not_recorded'
      ) {
        ctx.result.notNeeded += 1;
      }
      return;
    }
    const names = await namesOf(ctx, payee.roles);
    const startsOn = change.effectiveFrom ?? feeRiseStartAfter(ctx.now);
    data = feeChangeNoticeData({
      userName: greetingName(person?.name),
      kind: notice.kind,
      roles: payee.roles,
      before: payee.before,
      after: payee.after,
      names,
      startsOn,
      dated: change.effectiveFrom !== null,
      joiner: !notice.onList,
      replaces: change.replacesChangeId !== null,
      announcedAt:
        notice.kind === 'smaller'
          ? (announce?.acceptedAt ?? announce?.toldAt ?? null)
          : null,
      studioUrl: studioUrlFor(ctx, payee.roles, names),
    });
    // What they are told, kept as told (Studio's "not 12%" reads it).
    told = {
      roles: payee.roles,
      beforeValues: payee.before,
      afterValues: payee.after,
      quotedFrom: londonDate(startsOn),
    };
  }

  const delivery = email
    ? await ctx
        .mailer({
          to: email,
          toName: person?.name ?? undefined,
          templateName: TEMPLATE_FOR[notice.kind],
          category: 'transactional',
          userId: notice.userId,
          organizationId: null,
          // Neither is a token: the data schema strips them before
          // rendering, and the email log keeps them, for M1's check.
          data: {
            ...data,
            feeNoticeId: notice.id,
            feeNoticeRound: roundOf(notice),
          },
        })
        .catch(
          (error: unknown): FeeNoticeDelivery => ({
            accepted: false,
            error: messageForLog(error),
          })
        )
    : 'no_address';
  const outcome = outcomeOf(delivery);
  // A refusal told nothing: its record failing is any notice's failure.
  if (outcome.state === 'failed') {
    await recordOutcome(ctx, notice, outcome, told, false);
    return;
  }
  // It went, or may have: a failure from here on must say so, or support
  // reads "one notice failed" for an email that needs nothing (silent L2).
  const went = { outcome: outcome.state };
  // One that went with a figure the rise was cut from since is owed the
  // smaller email (S2). When that can't be read, the outcome is still
  // recorded, and the change is named for a person to check.
  let toldAgain = false;
  if (told.afterValues !== undefined) {
    try {
      toldAgain = await figuresMovedSince(
        ctx,
        change,
        notice.userId,
        told.afterValues
      );
    } catch (error) {
      noticeFailed(
        ctx,
        notice,
        'fee step: a fee email went, or may have, but whether its rise was cut since could not be read; check this change by hand for a smaller email owed',
        error,
        went
      );
    }
  }
  try {
    await recordOutcome(ctx, notice, outcome, told, toldAgain);
  } catch (error) {
    noticeFailed(
      ctx,
      notice,
      'fee step: a fee email went, or may have, but its record failed; the next run looks for it in the email log before sending again',
      error,
      went
    );
  }
}

/** What a send did, written by `record` and counted. */
async function recordOutcome(
  ctx: SweepContext,
  notice: Claimed,
  outcome: ReturnType<typeof outcomeOf>,
  told: Partial<FeeChangeNoticeRow>,
  toldAgain: boolean
): Promise<void> {
  if (outcome.state === 'sent') {
    const sent = await record(
      ctx,
      notice,
      {
        ...told,
        state: 'sent',
        // The run's clock, as attempted_at: a run is minutes long, and the
        // 30 days are counted to the next UK midnight anyway.
        acceptedAt: ctx.now,
        lastReason: null,
        lastError: null,
      },
      toldAgain
    );
    if (sent !== 'not_recorded') ctx.result.sent += 1;
    return;
  }
  const errorId = crypto.randomUUID();
  const recorded = await record(
    ctx,
    notice,
    {
      // One with no answer may have told them, so it keeps what: a void's
      // "it's off" email quotes it (owner, 2026-11-09).
      ...(outcome.state === 'unknown' ? told : {}),
      state: outcome.state,
      lastReason: outcome.reason,
      lastError: outcome.error,
      alertErrorId: errorId,
    },
    toldAgain
  );
  if (recorded === 'not_recorded') return;
  if (outcome.state === 'failed') ctx.result.failed += 1;
  else ctx.result.unknown += 1;
  ctx.obs.warn(
    // A void closed the row while it was in flight: never tried again (S6).
    recorded === 'voided'
      ? 'fee step: a fee email was not accepted, and its rise was voided meanwhile; it is not tried again'
      : 'fee step: a fee email was not accepted; it is tried again tomorrow',
    {
      errorId,
      feeNoticeId: notice.id,
      changeId: notice.changeId,
      kind: notice.kind,
      reason: outcome.reason,
    }
  );
}

/**
 * One notice failed: named one by one up to ALERT_NAMED, the rest folded
 * into one end alert with their count (`alertFoldedFailures`), so one cause
 * reaching every notice is never thousands of lines (review cycle 2, L4).
 */
function noticeFailed(
  ctx: SweepContext,
  notice: Claimed,
  message: string,
  error: unknown,
  context: Record<string, string> = {}
): void {
  ctx.result.errors += 1;
  ctx.noticeFailures += 1;
  if (ctx.noticeFailures > ctx.alertNamed) {
    ctx.foldedChangeIds.add(notice.changeId);
    return;
  }
  ctx.obs.error(message, {
    errorId: crypto.randomUUID(),
    feeNoticeId: notice.id,
    changeId: notice.changeId,
    ...context,
    error: messageForLog(error),
  });
}

/**
 * Claims the budget left unsent go back as they were: their try and its time
 * undone, as the price-moves step does. A follow-up keeps its tries, and an
 * `unknown` is still checked against the email log from its real last try.
 * The next morning claims them.
 */
async function giveBack(ctx: SweepContext, unsent: Claimed[]): Promise<number> {
  if (unsent.length === 0) return 0;
  const back = await ctx.db.execute(sql`
    UPDATE ${feeChangeNotices} AS n
       SET attempts = n.attempts - 1, attempted_at = g.prev,
           updated_at = ${ctx.now}::timestamptz
      FROM unnest(
             ARRAY[${sql.join(
               unsent.map((c) => sql`${c.id}::uuid`),
               sql`, `
             )}]::uuid[],
             ARRAY[${sql.join(
               unsent.map((c) => sql`${c.prevAttemptedAt}::timestamptz`),
               sql`, `
             )}]::timestamptz[]
           ) AS g(id, prev)
     WHERE n.id = g.id
       AND n.attempted_at = ${ctx.now}::timestamptz
       AND n.state IN ('due', 'failed', 'unknown')
    RETURNING n.id
  `);
  ctx.result.givenBack += back.rows.length;
  return back.rows.length;
}

/**
 * Who each change affects, read once before any of its emails: an
 * announcement or a smaller-rise email needs it. A change whose read fails
 * has its claims given back, untried, with one alert naming it, not one per
 * notice: they go the next morning.
 */
async function withoutUnreadChanges(
  ctx: SweepContext,
  claimed: Claimed[],
  changes: Map<string, FeeChangeRow>
): Promise<Claimed[]> {
  const unread = new Set<string>();
  for (const changeId of new Set(
    claimed.filter((n) => n.kind !== 'cancelled').map((n) => n.changeId)
  )) {
    const change = changes.get(changeId);
    if (!change) continue;
    try {
      await currentPayeesOf(ctx, change);
    } catch (error) {
      unread.add(changeId);
      const ofChange = claimed.filter((n) => n.changeId === changeId);
      const givenBack = await giveBack(ctx, ofChange);
      ctx.result.errors += 1;
      ctx.obs.error(
        'fee step: could not read who a fee rise affects; its emails go tomorrow',
        {
          errorId: crypto.randomUUID(),
          changeId,
          givenBack,
          error: messageForLog(error),
        }
      );
    }
  }
  return claimed.filter((n) => !unread.has(n.changeId));
}

async function sendDue(ctx: SweepContext): Promise<void> {
  const claimed = await claim(ctx);
  if (claimed.length === 0) return;
  const changeIds = [...new Set(claimed.map((n) => n.changeId))];
  const rows = await ctx.db
    .select()
    .from(feeChanges)
    .where(inArray(feeChanges.id, changeIds));
  const changes = new Map(rows.map((c) => [c.id, c]));
  const { sendable, reads } = await withFollowUpReads(
    ctx,
    await withoutUnreadChanges(ctx, claimed, changes),
    changes
  );
  if (sendable.length === 0) return;
  const people = await recipientsOf(ctx, sendable);
  for (let i = 0; i < sendable.length; i += SEND_CONCURRENCY) {
    if (ctx.clock() >= ctx.sendsUntil) {
      const givenBack = await giveBack(ctx, sendable.slice(i));
      ctx.obs.warn('fee step: the send budget ran out; the rest go tomorrow', {
        givenBack,
        sent: ctx.result.sent,
      });
      return;
    }
    await Promise.all(
      sendable.slice(i, i + SEND_CONCURRENCY).map(async (notice) => {
        try {
          await sendOne(ctx, notice, changes, people, reads);
        } catch (error) {
          noticeFailed(ctx, notice, 'fee step: one notice failed', error);
        }
      })
    );
  }
}

/**
 * One cause (a database blip, say) fails every notice it reaches: the first
 * ALERT_NAMED are named one by one and the rest fold into this one error
 * with their count, as the price-moves step does (review cycle 2, L4).
 */
async function alertFoldedFailures(ctx: SweepContext): Promise<void> {
  const notNamed = ctx.noticeFailures - ctx.alertNamed;
  if (notNamed <= 0) return;
  ctx.obs.error('fee step: more notices failed than are named one by one', {
    errorId: crypto.randomUUID(),
    failed: ctx.noticeFailures,
    notNamed,
    changeIds: [...ctx.foldedChangeIds].slice(0, ALERT_NAMED),
  });
}

// ─── 4. Dates ────────────────────────────────────────────────────────────────

async function dateRises(ctx: SweepContext): Promise<void> {
  const waiting = await ctx.db
    .select({ id: feeChanges.id })
    .from(feeChanges)
    .where(
      and(WAITING_RISE, sql`${feeChanges.firstRunAt} IS NOT NULL`, scope(ctx))
    );
  for (const { id } of waiting) {
    try {
      const outcome = await ctx.db.transaction((tx) =>
        dateRiseIfAllTold(tx, id)
      );
      if (outcome.dated) {
        ctx.result.dated += 1;
        ctx.obs.info('fee step: a rise is dated', {
          changeId: id,
          effectiveFrom: outcome.effectiveFrom.toISOString(),
        });
      }
    } catch (error) {
      ctx.result.errors += 1;
      ctx.obs.error('fee step: a rise could not be dated', {
        errorId: crypto.randomUUID(),
        changeId: id,
        error: messageForLog(error),
      });
    }
  }
}

/**
 * A dated rise that has started puts its values in its level's old current
 * row (`fee_config_*`), so code rolled back to before 0123 charges the fee
 * sales pay. A level is due when a rise there started after its row was last
 * written, or it has no row: a missed morning is caught the next one, and a
 * level once mirrored is not again.
 */
async function mirrorStartedRises(ctx: SweepContext): Promise<void> {
  const started = and(
    eq(feeChanges.kind, 'rise'),
    isNull(feeChanges.voidedAt),
    lte(feeChanges.effectiveFrom, ctx.now),
    scope(ctx)
  );
  const [platform, orgs, creators] = await Promise.all([
    ctx.db
      .select({ id: feeChanges.id })
      .from(feeChanges)
      .leftJoin(feeConfigPlatform, eq(feeConfigPlatform.id, 'singleton'))
      .where(
        and(
          eq(feeChanges.scope, 'platform'),
          started,
          or(
            isNull(feeConfigPlatform.updatedAt),
            lt(feeConfigPlatform.updatedAt, feeChanges.effectiveFrom)
          )
        )
      )
      .limit(1),
    ctx.db
      .selectDistinct({ organizationId: feeChanges.organizationId })
      .from(feeChanges)
      .leftJoin(
        feeConfigOrg,
        eq(feeConfigOrg.organizationId, feeChanges.organizationId)
      )
      .where(
        and(
          eq(feeChanges.scope, 'org'),
          started,
          or(
            isNull(feeConfigOrg.updatedAt),
            lt(feeConfigOrg.updatedAt, feeChanges.effectiveFrom)
          )
        )
      ),
    ctx.db
      .selectDistinct({
        organizationId: feeChanges.organizationId,
        creatorId: feeChanges.creatorId,
      })
      .from(feeChanges)
      .leftJoin(
        feeConfigOrgCreator,
        and(
          eq(feeConfigOrgCreator.organizationId, feeChanges.organizationId),
          eq(feeConfigOrgCreator.creatorId, feeChanges.creatorId)
        )
      )
      .where(
        and(
          eq(feeChanges.scope, 'creator'),
          started,
          or(
            isNull(feeConfigOrgCreator.updatedAt),
            lt(feeConfigOrgCreator.updatedAt, feeChanges.effectiveFrom)
          )
        )
      ),
  ]);
  const levels: FeeLevel[] = [];
  if (platform.length > 0) levels.push({ scope: 'platform' });
  for (const { organizationId } of orgs) {
    if (organizationId) levels.push({ scope: 'org', organizationId });
  }
  for (const { organizationId, creatorId } of creators) {
    if (organizationId && creatorId) {
      levels.push({ scope: 'creator', organizationId, creatorId });
    }
  }
  for (const level of levels) {
    try {
      // The level's lock, as an admin write takes it: a save mirrors in its
      // own transaction, and the two take turns.
      const wrote = await ctx.db.transaction(async (tx) => {
        await lockFeeLevel(tx, level);
        return mirrorLegacyFeeRow(tx, level, null, ctx.now);
      });
      if (wrote) {
        ctx.result.mirrored += 1;
        ctx.obs.info('fee step: a started rise is in the old fee row', {
          ...level,
        });
      }
    } catch (error) {
      ctx.result.errors += 1;
      ctx.obs.error(
        'fee step: a started rise could not reach the old fee row',
        {
          errorId: crypto.randomUUID(),
          ...level,
          error: messageForLog(error),
        }
      );
    }
  }
}

// ─── 6. The alerts ───────────────────────────────────────────────────────────

/**
 * A missing template holds its emails untried, and a rise waits for them, so
 * a person is needed: one alert per missing template a run meets, naming the
 * changes waiting on it (50 at most). One nothing waits on yet is a warning.
 */
async function alertMissingTemplates(ctx: SweepContext): Promise<void> {
  for (const templateName of ctx.result.skippedTemplates) {
    const kinds = (Object.keys(TEMPLATE_FOR) as NoticeKind[]).filter(
      (kind) => TEMPLATE_FOR[kind] === templateName
    );
    const waiting = await ctx.db
      .selectDistinct({ changeId: feeChangeNotices.changeId })
      .from(feeChangeNotices)
      .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
      .where(
        and(
          inArray(feeChangeNotices.kind, kinds),
          inArray(feeChangeNotices.state, [...FEE_NOTICE_OPEN_STATES]),
          or(eq(feeChangeNotices.kind, 'cancelled'), notStarted(ctx.now)),
          scope(ctx)
        )
      )
      .limit(ALERT_NAMED);
    if (waiting.length === 0) {
      ctx.obs.warn('fee step: template missing; nothing waits on it yet', {
        templateName,
      });
      continue;
    }
    ctx.obs.error(
      'fee step: template missing, so its emails wait and every rise waiting on them with them. Restore it in Admin › Templates',
      {
        errorId: crypto.randomUUID(),
        templateName,
        changeIds: waiting.map((w) => w.changeId),
      }
    );
  }
}

async function alertNotTold(ctx: SweepContext): Promise<void> {
  const soon = new Date(
    ctx.now.getTime() + UNKNOWN_TRIES_BEFORE_ALERT * DAY_MS
  );
  const where = and(
    eq(feeChangeNotices.kind, 'announce'),
    or(
      eq(feeChangeNotices.state, 'failed'),
      and(
        eq(feeChangeNotices.state, 'unknown'),
        or(
          gte(feeChangeNotices.attempts, UNKNOWN_TRIES_BEFORE_ALERT),
          lte(feeChanges.effectiveFrom, soon)
        )
      )
    ),
    notStarted(ctx.now),
    scope(ctx)
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        feeNoticeId: feeChangeNotices.id,
        userId: feeChangeNotices.userId,
        changeId: feeChangeNotices.changeId,
        reason: feeChangeNotices.lastReason,
        onList: feeChangeNotices.onList,
      })
      .from(feeChangeNotices)
      .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
      .where(where)
      .orderBy(asc(feeChangeNotices.createdAt))
      .limit(ALERT_NAMED),
    ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(feeChangeNotices)
      .innerJoin(feeChanges, eq(feeChanges.id, feeChangeNotices.changeId))
      .where(where),
  ]);
  const count = total?.n ?? 0;
  if (count === 0) return;
  ctx.obs.error(
    'fee step: people not yet told about a fee rise; the rise waits for them. See Admin › Queue › Fee notices',
    {
      errorId: crypto.randomUUID(),
      notTold: count,
      named: rows,
      unnamed: Math.max(0, count - rows.length),
    }
  );
}

// ─── The run ─────────────────────────────────────────────────────────────────

async function enabledTemplates(
  deps: RunFeeNoticesSweepDeps,
  result: FeeNoticesSweepResult
): Promise<Set<FeeTemplate>> {
  const repository = new TemplateRepository(deps.db);
  const exists =
    deps.templateExists ??
    (async (name: FeeTemplate) =>
      (await repository.findTemplate(name, null, null)) !== null);
  const enabled = new Set<FeeTemplate>();
  for (const name of new Set(Object.values(TEMPLATE_FOR))) {
    if (await exists(name)) {
      enabled.add(name);
    } else {
      // Reported by the `templates` part, which knows what waits on it.
      result.skippedTemplates.push(name);
    }
  }
  return enabled;
}

export async function runFeeNoticesSweep(
  deps: RunFeeNoticesSweepDeps
): Promise<FeeNoticesSweepResult> {
  const result: FeeNoticesSweepResult = {
    listsMade: 0,
    listed: 0,
    joinersAdded: 0,
    notNeeded: 0,
    sent: 0,
    failed: 0,
    unknown: 0,
    foundInLog: 0,
    dropped: 0,
    givenBack: 0,
    notRecorded: 0,
    dated: 0,
    mirrored: 0,
    skippedTemplates: [],
    errors: 0,
  };
  const clock = deps.clock ?? Date.now;
  const sendsUntil = (deps.wakeStartedAt ?? clock()) + SENDS_TIME_BUDGET_MS;
  try {
    const ctx: SweepContext = {
      db: deps.db,
      obs: deps.obs,
      mailer:
        deps.mailer ??
        makeDefaultMailer({
          notificationsUrl: deps.notificationsUrl,
          workerSecret: deps.workerSecret,
          timeoutMs: deps.sendTimeoutMs ?? SEND_TIMEOUT_MS,
        }),
      now: deps.now ?? new Date(),
      clock,
      sendsUntil,
      environment: deps.environment,
      perRun: deps.perRun ?? FEE_NOTICES_PER_RUN,
      enabled: await enabledTemplates(deps, result),
      result,
      payees: new Map(),
      readVersions: new Map(),
      orgNames: new Map(),
      onlyChanges: deps.onlyChanges ?? null,
      alertNamed: deps.alertNamed ?? ALERT_NAMED,
      noticeFailures: 0,
      foldedChangeIds: new Set(),
    };
    let listedThisRun: Set<string> = new Set();
    // Each part is isolated: one failing never stops the others.
    const parts: Array<[string, () => Promise<void>]> = [
      [
        'lists',
        async () => {
          listedThisRun = await makeLists(ctx);
        },
      ],
      ['joiners', () => addJoiners(ctx, listedThisRun)],
      ['templates', () => alertMissingTemplates(ctx)],
      ['sends', () => sendDue(ctx)],
      // Its own part: it runs however the sends ended.
      ['send failures', () => alertFoldedFailures(ctx)],
      ['dates', () => dateRises(ctx)],
      ['old rows', () => mirrorStartedRises(ctx)],
      ['alert', () => alertNotTold(ctx)],
    ];
    for (const [part, run] of parts) {
      try {
        await run();
      } catch (error) {
        result.errors += 1;
        deps.obs.error('fee step part failed', {
          errorId: crypto.randomUUID(),
          part,
          error: messageForLog(error),
        });
      }
    }
    deps.obs.info('fee step completed', { ...result });
  } catch (error) {
    result.errors += 1;
    deps.obs.error('fee step failed at top level', {
      errorId: crypto.randomUUID(),
      error: messageForLog(error),
    });
  }
  return result;
}

/**
 * Scheduled entry point: builds a per-run WebSocket client (its lists and
 * dates are transactions), skips cleanly on missing config, and runs the
 * step. Dev and e2e call `runFeeNoticesSweep` directly: no environment but
 * production has the cron.
 */
export async function runScheduledFeeNoticesSweep(
  env: Bindings,
  wake: { startedAt?: number } = {}
): Promise<FeeNoticesSweepResult | null> {
  const obs = new ObservabilityClient(
    'notifications-api',
    env.ENVIRONMENT ?? 'development'
  );
  const environment = env.ENVIRONMENT ?? 'development';
  if (
    !env.DATABASE_URL ||
    !env.WORKER_SHARED_SECRET ||
    !isEnvName(environment)
  ) {
    obs.error('fee step: missing required env vars, skipping', {
      errorId: crypto.randomUUID(),
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      hasWorkerSecret: Boolean(env.WORKER_SHARED_SECRET),
      hasKnownEnvironment: isEnvName(environment),
    });
    return null;
  }
  const { db, cleanup } = createPerRequestDbClient(env);
  try {
    return await runFeeNoticesSweep({
      db,
      obs,
      environment,
      workerSecret: env.WORKER_SHARED_SECRET,
      notificationsUrl: getServiceUrl('notifications', env),
      wakeStartedAt: wake.startedAt,
    });
  } finally {
    await cleanup().catch((error: unknown) => {
      obs.warn('fee step: database cleanup failed', {
        error: messageForLog(error),
      });
    });
  }
}
