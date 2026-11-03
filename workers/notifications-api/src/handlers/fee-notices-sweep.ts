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
 *      send waits FEE_NOTICE_TIMEOUT_MS at most, and no batch starts after
 *      FEE_SENDS_TIME_BUDGET_MS: the rest are given back for the next
 *      morning, so the dates and the alert always run. A notice tried on
 *      an earlier run is first looked for in `email_audit_logs`: found sent
 *      or pending, it counts as told then and nothing is resent (M1's rule,
 *      with F4's: on every reclaim). Each email names a date: the change's,
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
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  messageForLog,
  or,
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
  type FeeLevel,
  type FeeVersionList,
  type FeeVersionReader,
  feeLevelKey,
  feeRiseStartAfter,
  lockFeeLevel,
  londonDate,
  mirrorLegacyFeeRow,
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

/** Emails a run sends at most; the rest go the next morning (§1.5 budget). */
export const FEE_NOTICES_PER_RUN = 2000;
/** A follow-up is dropped after this many failed mornings. */
const FOLLOW_UP_TRIES = 3;
/** People named in the run's one alert. */
const ALERT_NAMED = 50;
/** Notices inserted per statement when a list is made. */
const LIST_BATCH = 500;
/** Sends in flight at once. */
const SEND_CONCURRENCY = 8;
/** A notice attempted this recently is not claimed again (overlapping runs). */
const RECLAIM_AFTER_MS = 12 * 60 * 60 * 1000;
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
/**
 * How long one send may take, as the price-moves step's
 * PRICE_NOTICE_TIMEOUT_MS. A send still running then is `unknown` (it MAY
 * have gone), so the next run checks the email log first.
 */
const FEE_NOTICE_TIMEOUT_MS = 5_000;
/**
 * No send batch starts after this, counted from the 08:00 invocation's start
 * (the step's own start when it has none), as the price-moves step's
 * PRICE_MOVES_TIME_BUDGET_MS. The step runs last in the 08:00 chain, after
 * the agreement and money sweeps, inside the cron's 15-minute wall, and the
 * dates and the alert run after the sends.
 */
export const FEE_SENDS_TIME_BUDGET_MS = 8 * 60 * 1000;

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
  onList: boolean
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
        await insertNotices(tx, id, payees, true);
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

function payeesOf(
  ctx: SweepContext,
  change: FeeChangeRow
): Promise<Map<string, AffectedPayee>> {
  let found = ctx.payees.get(change.id);
  if (!found) {
    const reading = affectedPayees(ctx.db, change, ctx.now).then(
      (list) => new Map(list.map((p) => [p.userId, p]))
    );
    // A failed read is never kept: the next part reads again, rather than
    // every notice of the change failing on the one rejection.
    reading.catch(() => {
      if (ctx.payees.get(change.id) === reading) ctx.payees.delete(change.id);
    });
    ctx.payees.set(change.id, reading);
    found = reading;
  }
  return found;
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
      const affected = await payeesOf(ctx, change);
      const existing = await ctx.db
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
      const joiners = [...affected.values()].filter(
        (p) => !known.has(p.userId)
      );
      const added = await insertNotices(ctx.db, change.id, joiners, false);
      ctx.result.joinersAdded += added;

      const gone = existing
        .filter(
          (n) =>
            (FEE_NOTICE_OPEN_STATES as readonly string[]).includes(n.state) &&
            !affected.has(n.userId)
        )
        .map((n) => n.id);
      if (gone.length > 0) {
        await ctx.db
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
        await ctx.db
          .update(feeChangeNotices)
          .set({ state: 'due', attempts: 0, updatedAt: ctx.now })
          .where(
            and(
              inArray(feeChangeNotices.id, back),
              eq(feeChangeNotices.state, 'not_needed')
            )
          );
      }
    } catch (error) {
      ctx.result.errors += 1;
      ctx.obs.error('fee step: joiners could not be added for a change', {
        errorId: crypto.randomUUID(),
        changeId: change.id,
        error: messageForLog(error),
      });
    }
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
}

async function claim(ctx: SweepContext): Promise<Claimed[]> {
  const kinds = (Object.keys(TEMPLATE_FOR) as NoticeKind[]).filter((kind) =>
    ctx.enabled.has(TEMPLATE_FOR[kind])
  );
  if (kinds.length === 0) return [];
  const reclaimBefore = new Date(ctx.now.getTime() - RECLAIM_AFTER_MS);
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
      picked.prev_attempted_at
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
  }));
}

/**
 * Did the email go after all? Asked on every claim after an earlier try,
 * whatever that try recorded (F4's rule, as the price-moves step): a run cut
 * off after sending leaves the notice `due`. A `success` or `pending` row in
 * the email log for this notice since its last try counts as told then: a
 * `pending` one may have gone.
 */
async function foundSent(
  ctx: SweepContext,
  notice: Claimed,
  email: string
): Promise<Date | null> {
  const since = notice.prevAttemptedAt
    ? new Date(notice.prevAttemptedAt.getTime() - 60 * 1000)
    : new Date(0);
  const [row] = await ctx.db
    .select({ at: emailAuditLogs.updatedAt })
    .from(emailAuditLogs)
    .where(
      and(
        eq(emailAuditLogs.templateName, TEMPLATE_FOR[notice.kind]),
        eq(emailAuditLogs.recipientEmail, email),
        inArray(emailAuditLogs.status, ['success', 'pending']),
        gte(emailAuditLogs.createdAt, since),
        sql`strpos(${emailAuditLogs.metadata}, ${`"feeNoticeId":"${notice.id}"`}) > 0`
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

async function record(
  ctx: SweepContext,
  notice: Claimed,
  set: Partial<FeeChangeNoticeRow>
): Promise<void> {
  await ctx.db
    .update(feeChangeNotices)
    .set({ ...set, updatedAt: ctx.now })
    .where(eq(feeChangeNotices.id, notice.id));
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
    await record(ctx, notice, { state: 'not_needed' });
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
      await record(ctx, notice, {
        state: 'sent',
        acceptedAt: at,
        lastReason: null,
        lastError: null,
      });
      ctx.result.foundInLog += 1;
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
      await record(ctx, notice, { state: 'not_needed' });
      ctx.result.notNeeded += 1;
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
          // feeNoticeId is not a token: the data schema strips it before
          // rendering, and the email log keeps it, for M1's check.
          data: { ...data, feeNoticeId: notice.id },
        })
        .catch(
          (error: unknown): FeeNoticeDelivery => ({
            accepted: false,
            error: messageForLog(error),
          })
        )
    : 'no_address';
  const outcome = outcomeOf(delivery);
  if (outcome.state === 'sent') {
    await record(ctx, notice, {
      ...told,
      state: 'sent',
      // The run's clock, as attempted_at: a run is minutes long, and the
      // 30 days are counted to the next UK midnight anyway.
      acceptedAt: ctx.now,
      lastReason: null,
      lastError: null,
    });
    ctx.result.sent += 1;
    return;
  }
  const errorId = crypto.randomUUID();
  await record(ctx, notice, {
    state: outcome.state,
    lastReason: outcome.reason,
    lastError: outcome.error,
    alertErrorId: errorId,
  });
  if (outcome.state === 'failed') ctx.result.failed += 1;
  else ctx.result.unknown += 1;
  ctx.obs.warn(
    'fee step: a fee email was not accepted; it is tried again tomorrow',
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
      await payeesOf(ctx, change);
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
          ctx.result.errors += 1;
          ctx.noticeFailures += 1;
          if (ctx.noticeFailures > ctx.alertNamed) {
            ctx.foldedChangeIds.add(notice.changeId);
            return;
          }
          ctx.obs.error('fee step: one notice failed', {
            errorId: crypto.randomUUID(),
            feeNoticeId: notice.id,
            changeId: notice.changeId,
            error: messageForLog(error),
          });
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
    dated: 0,
    mirrored: 0,
    skippedTemplates: [],
    errors: 0,
  };
  const clock = deps.clock ?? Date.now;
  const sendsUntil = (deps.wakeStartedAt ?? clock()) + FEE_SENDS_TIME_BUDGET_MS;
  try {
    const ctx: SweepContext = {
      db: deps.db,
      obs: deps.obs,
      mailer:
        deps.mailer ??
        makeDefaultMailer({
          notificationsUrl: deps.notificationsUrl,
          workerSecret: deps.workerSecret,
          timeoutMs: deps.sendTimeoutMs ?? FEE_NOTICE_TIMEOUT_MS,
        }),
      now: deps.now ?? new Date(),
      clock,
      sendsUntil,
      environment: deps.environment,
      perRun: deps.perRun ?? FEE_NOTICES_PER_RUN,
      enabled: await enabledTemplates(deps, result),
      result,
      payees: new Map(),
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
