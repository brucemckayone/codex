/**
 * The leaving notice's sweep (Codex-a6ofh.6.4, design §5): content-api's
 * `POST /internal/content/leaving-sweep`, which media-api's hourly
 * maintenance run calls. Each tick sends the notices due and adds the day-27
 * reminders (here), then finishes the deletes whose day has come
 * (`ContentService.completeLeaving`, called by the route). The rules for the
 * notice rows are in `@codex/database`'s `schema/content-leaving.ts`.
 *
 * Sending, the fee notices' pattern (`fee-notices-sweep.ts`):
 * 1. A notice whose email is no longer true is cancelled, with a warn: its
 *    person may never have been told. Per kind: `leaving` and `reminder`
 *    while the piece leaves on that round and is not deleted; `staying` while
 *    it is kept (no date) and not deleted; `removed` always.
 * 2. A notice still open with its tries used up, its last one cut off before
 *    an answer, is abandoned as `unknown`: a cut-off send may have gone.
 * 3. The claim takes the rest, oldest first, under FOR UPDATE SKIP LOCKED,
 *    and counts the try (`attempts + 1`, `attempted_at`) BEFORE sending, so
 *    a send in flight already reads as tried. A notice claimed in the last
 *    LEAVING_NOTICE_LEASE_MS is left alone, so two ticks never both send it.
 *    Each `leaving` notice claimed bumps its owner's library (owner: no
 *    cursor), at most LEAVING_SWEEP_LIBRARY_BUMPS_PER_TICK a tick.
 * 4. The sends go LEAVING_SWEEP_SEND_BATCH at a time, awaited, each batch's
 *    people read again just before it goes (an account erased meanwhile is
 *    no address), and none starts after LEAVING_SWEEP_SEND_BUDGET_MS.
 * 5. Each answer is written only while the notice is still open; one that
 *    closed meanwhile (a Keep, a takedown) is logged as not recorded.
 *
 * A claim whose send never started goes back as it was, its try undone
 * (the budget ran out, or the tick broke after its claim); one whose send
 * started never does, since it may have gone (WP-1: `attempts > 0` reads
 * "may have been told").
 *
 * Global by design: the sweep is the platform's, over every creator's
 * notices, and only an `auth: 'worker'` route reaches it. Tests scope it to
 * their own pieces (`onlyContentIds`). Never throws once it has claimed: a
 * notice that fails is logged, and one whose send started is left for its
 * lease.
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import {
  CONTENT_LEAVING_NOTICE_OPEN_STATES,
  CONTENT_LEAVING_NOTICE_TEMPLATES,
  CONTENT_TYPES,
  type ContentLeavingActionLabel,
  type ContentLeavingNoticeKind,
  type ContentLeavingNoticeReason,
  type ContentLeavingNoticeTemplate,
  LEAVING_NOTICE_LEASE_MS,
  LEAVING_NOTICE_MAX_TRIES,
  LEAVING_REMINDER_DAYS,
  LEAVING_SWEEP_BUMP_CHUNK,
  LEAVING_SWEEP_COMPLETION_BUMPS_PER_TICK,
  LEAVING_SWEEP_HOLDERS_PAGE,
  LEAVING_SWEEP_LIBRARY_BUMPS_PER_TICK,
  LEAVING_SWEEP_NOTICES_PER_TICK,
  LEAVING_SWEEP_PIECES_PER_TICK,
  LEAVING_SWEEP_SEND_BATCH,
  LEAVING_SWEEP_SEND_BUDGET_MS,
} from '@codex/constants';
import { messageForLog, stackForLog } from '@codex/database';
import {
  content,
  contentLeavingNotices,
  organizations,
  users,
} from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import type { ContentLeavingSweepReport } from '@codex/validation';
import {
  and,
  asc,
  countDistinct,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { DatabaseTransaction } from '../types';
import { holdersOf } from './content-buyers';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Notices named one by one in a tick's cancel or abandon logs; then a count. */
const NAMED_PER_TICK = 50;

/** What notifications-api answered (the shape of worker-utils' `EmailSendResult`). */
export type LeavingNoticeDelivery =
  | { accepted: true }
  | { accepted: false; status: number }
  | { accepted: false; skipped: string }
  | { accepted: false; error: string };

/** One owner's email, as `sendEmailToWorkerAwaited` takes it. */
export interface LeavingNoticeEmail {
  to: string;
  toName?: string;
  templateName: ContentLeavingNoticeTemplate;
  category: 'transactional';
  userId: string;
  /**
   * The piece's org, while it is live: its brand (logo, colour, support
   * address) and its own wording of the template dress the email. Null for
   * a personal piece and for a deleted org, which is never represented in
   * these emails (owner 2026-11-21): the platform's brand and template.
   */
  organizationId: string | null;
  /**
   * The takedown email alone: the platform's own template, never one the
   * org being moderated wrote under its name (owner 2026-11-21).
   */
  platformTemplate?: true;
  data: Record<string, string>;
}

/** A notice's email before its person is read: all but the address and greeting. */
type LeavingNoticeMessage = Omit<
  LeavingNoticeEmail,
  'to' | 'toName' | 'userId' | 'category'
>;

/**
 * Sends one email and reports notifications-api's answer. The registry wires
 * `sendEmailToWorkerAwaited`, which never throws; one that does counts as
 * no answer.
 */
export type LeavingNoticeMailer = (
  email: LeavingNoticeEmail
) => Promise<LeavingNoticeDelivery>;

/** What a piece's page link is built from. */
export interface LeavingNoticePage {
  slug: string;
  organizationSlug: string | null;
  creatorUsername: string | null;
}

/**
 * A piece's page, absolute, for its emails' button. Null when none can be
 * built (an environment links are not built for): the claim is given back.
 */
export type LeavingNoticeLinker = (page: LeavingNoticePage) => string | null;

/** A tick's limits (`@codex/constants`); tests shrink them. */
interface SweepLimits {
  perTick: number;
  batch: number;
  libraryBumps: number;
  sendBudgetMs: number;
  piecesPerTick: number;
  completionBumps: number;
  holdersPage: number;
  bumpChunk: number;
}

export interface ContentLeavingNoticeServiceConfig extends ServiceConfig {
  mailer: LeavingNoticeMailer;
  contentUrlFor: LeavingNoticeLinker;
  /** The owners' library keys. Absent: no library is bumped. */
  cache?: VersionedCache;
  /**
   * Testing only: the sweep touches these pieces' notices alone. It
   * otherwise reads every piece, and the test database is shared.
   */
  onlyContentIds?: readonly string[];
  /** Real time, for the send budget (testing only). */
  clock?: () => number;
  /** Testing only. */
  limits?: Partial<SweepLimits>;
}

/** What `sendDue` did: the route adds the reminders and the completions. */
export type LeavingNoticeTally = Omit<
  ContentLeavingSweepReport,
  'remindersAdded' | 'completed'
>;

/** A claimed notice: its try already counted. */
interface Claimed {
  id: string;
  contentId: string;
  userId: string;
  kind: ContentLeavingNoticeKind;
  round: Date;
  /** Tries including this one. */
  attempts: number;
  /** The try before this one, for a give-back. */
  prevAttemptedAt: Date | null;
}

/** A notice's person, read just before their email goes. */
interface Person {
  name: string;
  email: string;
  deletedAt: Date | null;
}

/** A piece's creator, who names a personal piece and links its page. */
interface Creator {
  name: string;
  username: string | null;
}

interface Piece {
  title: string;
  slug: string;
  contentType: string;
  ownersCanDownload: boolean;
  /** The piece's own: set for an org's piece, its org live or not. */
  organizationId: string | null;
  /** The org's, while it is live: null for a deleted org (its slug can be retaken). */
  liveOrgId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  creatorId: string;
}

/** A notice row as a cancel or an abandon returns it. */
type NoticeRow = {
  id: string;
  content_id: string;
  kind: string;
  attempts: number;
  last_reason: string | null;
};

/** The notices past a tick's first NAMED_PER_TICK, folded into one log line. */
type FoldedNotices = {
  notices: number;
  noticeIds: string[];
  contentIds: string[];
  /** By `kind/tried|untried/last reason`. */
  counts: Record<string, number>;
};

/** One tick's reads and counts. */
interface Tick {
  now: Date;
  sendsUntil: number;
  creators: Map<string, Creator>;
  pieces: Map<string, Piece>;
  tally: LeavingNoticeTally;
  /** Claims whose send started: never given back. */
  started: Set<string>;
}

/** Where an answer leaves a notice. The CHECKs pin each state's reasons. */
export type LeavingNoticeOutcome =
  | { state: 'sent' }
  | { state: 'failed'; reason: 'refused' | 'skipped' }
  | { state: 'unknown'; reason: 'unknown' }
  | { state: 'abandoned'; reason: ContentLeavingNoticeReason };

/**
 * What an answer means for its notice (WP-1 review r3, r4):
 * - accepted: `sent`;
 * - a 4xx: `failed`/`refused`; a skip: `failed`/`skipped` (it certainly did
 *   not go, and is tried again);
 * - a 5xx, or no usable answer: `unknown`/`unknown` (it may have gone; tried
 *   again, as a second email beats none);
 * - no address (an erased account): `abandoned`/`no_address` at once, since
 *   an erased address never comes back. The fee sweep retries it; this
 *   differs on purpose.
 * The try that uses up LEAVING_NOTICE_MAX_TRIES ends the notice with its own
 * answer's reason, never an older one's.
 */
export function leavingNoticeOutcome(
  delivery: LeavingNoticeDelivery | 'no_address',
  attempts: number
): LeavingNoticeOutcome {
  if (delivery === 'no_address') {
    return { state: 'abandoned', reason: 'no_address' };
  }
  if (delivery.accepted) return { state: 'sent' };
  const answer: Exclude<
    LeavingNoticeOutcome,
    { state: 'sent' } | { state: 'abandoned' }
  > =
    'skipped' in delivery
      ? { state: 'failed', reason: 'skipped' }
      : 'status' in delivery && delivery.status < 500
        ? { state: 'failed', reason: 'refused' }
        : { state: 'unknown', reason: 'unknown' };
  return attempts >= LEAVING_NOTICE_MAX_TRIES
    ? { state: 'abandoned', reason: answer.reason }
    : answer;
}

// Built on first use: a module-scope Intl object stays in every bundle that
// imports the package barrel.
let londonDay: Intl.DateTimeFormat | undefined;

/** The day a notice names, as owners read it: "19 December 2026", London. */
export function leaveDateOf(round: Date): string {
  londonDay ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return londonDay.format(round);
}

/**
 * The button, and what the email says to do before the date (owner, D8):
 * keep a copy when the creator allows it, else watch, listen or read.
 */
export function actionLabelOf(piece: {
  contentType: string;
  ownersCanDownload: boolean;
}): ContentLeavingActionLabel {
  if (piece.contentType === CONTENT_TYPES.WRITTEN) {
    return piece.ownersCanDownload ? 'Save it as a PDF' : 'Read it';
  }
  if (piece.ownersCanDownload) return 'Download it';
  return piece.contentType === CONTENT_TYPES.AUDIO
    ? 'Listen to it'
    : 'Watch it';
}

const greetingName = (name: string) => name.trim() || 'there';

const asDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

/**
 * Whether a notice's email is still true (design §5), per kind, over a
 * notice `n` joined to its piece `c`. IS NOT DISTINCT FROM keeps a piece with
 * no date from reading NULL, which NOT would leave NULL and miss.
 */
const STILL_TRUE = sql`(
  n.kind = 'removed'
  OR (n.kind IN ('leaving', 'reminder')
      AND c.leaves_at IS NOT DISTINCT FROM n.round AND c.deleted_at IS NULL)
  OR (n.kind = 'staying' AND c.leaves_at IS NULL AND c.deleted_at IS NULL)
)`;

const OPEN_STATES = sql.join(
  CONTENT_LEAVING_NOTICE_OPEN_STATES.map((state) => sql`${state}`),
  sql`, `
);

export class ContentLeavingNoticeService extends BaseService {
  private readonly mailer: LeavingNoticeMailer;
  private readonly contentUrlFor: LeavingNoticeLinker;
  private readonly cache?: VersionedCache;
  private readonly onlyContentIds: readonly string[] | null;
  private readonly clock: () => number;
  private readonly limits: SweepLimits;

  constructor(config: ContentLeavingNoticeServiceConfig) {
    super(config);
    this.mailer = config.mailer;
    this.contentUrlFor = config.contentUrlFor;
    this.cache = config.cache;
    this.onlyContentIds = config.onlyContentIds ?? null;
    this.clock = config.clock ?? Date.now;
    this.limits = {
      perTick: LEAVING_SWEEP_NOTICES_PER_TICK,
      batch: LEAVING_SWEEP_SEND_BATCH,
      libraryBumps: LEAVING_SWEEP_LIBRARY_BUMPS_PER_TICK,
      sendBudgetMs: LEAVING_SWEEP_SEND_BUDGET_MS,
      piecesPerTick: LEAVING_SWEEP_PIECES_PER_TICK,
      completionBumps: LEAVING_SWEEP_COMPLETION_BUMPS_PER_TICK,
      holdersPage: LEAVING_SWEEP_HOLDERS_PAGE,
      bumpChunk: LEAVING_SWEEP_BUMP_CHUNK,
      ...config.limits,
    };
  }

  /**
   * One tick's emails: cancel what is no longer true, abandon what used up
   * its tries, then claim, bump and send the rest (the header has the
   * order). Throws only before its first claim. After it, a break gives
   * back every claim whose send never started, and leaves the rest to their
   * lease.
   */
  async sendDue(): Promise<LeavingNoticeTally> {
    const startedAt = this.clock();
    const now = new Date(startedAt);
    const tally: LeavingNoticeTally = {
      claimed: 0,
      sent: 0,
      failed: 0,
      unknown: 0,
      abandoned: 0,
      cancelled: 0,
      givenBack: 0,
      notRecorded: 0,
      errors: 0,
      librariesBumped: 0,
      more: false,
    };
    const claimed: Claimed[] = [];
    const started = new Set<string>();

    try {
      tally.cancelled = await this.cancelUntrue(now);
      tally.abandoned = await this.abandonSpent(now);

      // Each `leaving` notice claimed bumps one library, so they are claimed
      // up to the bumps a tick may make, and the other kinds fill the rest.
      const leavingLimit = Math.min(
        this.limits.libraryBumps,
        this.limits.perTick
      );
      const leaving = await this.claim(now, 'leaving', leavingLimit);
      claimed.push(...leaving);
      const othersLimit = this.limits.perTick - leaving.length;
      const others = await this.claim(now, 'others', othersLimit);
      claimed.push(...others);
      // A claim that filled its limit may have left more behind.
      tally.more =
        leaving.length >= leavingLimit || others.length >= othersLimit;
      tally.claimed = claimed.length;
      if (claimed.length === 0) return tally;

      tally.librariesBumped = await this.bumpLibraries(leaving);
      const tick: Tick = {
        now,
        sendsUntil: startedAt + this.limits.sendBudgetMs,
        tally,
        started,
        ...(await this.factsOf(claimed)),
      };
      await this.sendAll(tick, claimed);
    } catch (error) {
      // Before the first claim nothing changed: the tick fails, and the
      // next one starts over.
      if (claimed.length === 0) this.handleError(error, 'sendDue');
      tally.claimed = claimed.length;
      tally.errors += 1;
      const unstarted = claimed.filter((notice) => !started.has(notice.id));
      let givenBack = 0;
      let giveBackError: string | undefined;
      try {
        givenBack = await this.giveBack(now, unstarted);
      } catch (thrown) {
        giveBackError = messageForLog(thrown);
      }
      tally.givenBack += givenBack;
      this.obs.error(
        'Leaving sweep: the tick broke after its claim; the notices not yet sent are given back, the ones sending wait for their lease',
        {
          claimed: claimed.length,
          sendsStarted: started.size,
          givenBack,
          error: messageForLog(error),
          stack: stackForLog(error),
          ...(giveBackError && { giveBackError }),
        }
      );
    }
    return tally;
  }

  /**
   * The day-27 reminder (D9): a `reminder` row for each person who holds a
   * piece leaving within LEAVING_REMINDER_DAYS, read NOW, so someone who came
   * to own it after the delete is told too (owner). Once per piece and round:
   * a piece with any reminder row for its round is passed over, and ON
   * CONFLICT DO NOTHING lets two overlapping ticks both write without
   * refusing each other. Erased accounts are left out (`holdersOf`).
   *
   * The pieces are read FOR SHARE, so a Keep or a takedown waits for the
   * rows and then cancels them, or commits first and the piece is passed
   * over; SKIP LOCKED leaves one being changed to the next tick.
   */
  async addReminders(): Promise<number> {
    const now = new Date(this.clock());
    const horizon = new Date(now.getTime() + LEAVING_REMINDER_DAYS * DAY_MS);
    const reminded = this.db
      .select({ one: sql`1` })
      .from(contentLeavingNotices)
      .where(
        and(
          eq(contentLeavingNotices.contentId, content.id),
          eq(contentLeavingNotices.kind, 'reminder'),
          eq(contentLeavingNotices.round, content.leavesAt)
        )
      );
    const due: SQL[] = [
      isNotNull(content.leavesAt),
      isNull(content.deletedAt),
      gt(content.leavesAt, now),
      lte(content.leavesAt, horizon),
      notExists(reminded),
    ];
    if (this.onlyContentIds) {
      due.push(inArray(content.id, [...this.onlyContentIds]));
    }
    try {
      return await this.db.transaction(async (transaction) => {
        const tx = transaction as DatabaseTransaction;
        const pieces = await tx
          .select({ id: content.id })
          .from(content)
          .where(and(...due))
          .orderBy(asc(content.leavesAt), asc(content.id))
          .limit(this.limits.piecesPerTick)
          .for('share', { skipLocked: true });
        if (pieces.length === 0) return 0;
        const holders = holdersOf(
          tx,
          pieces.map((piece) => piece.id)
        );
        const people = tx
          .select({
            contentId: sql`${holders.contentId}`.as('content_id'),
            userId: sql`${holders.userId}`.as('user_id'),
          })
          .from(holders);
        const { rows } = await tx.execute(sql`
          WITH people AS (${people})
          INSERT INTO ${contentLeavingNotices} (content_id, user_id, kind, round)
          SELECT people.content_id, people.user_id, 'reminder', c.leaves_at
          FROM people
          JOIN ${content} c ON c.id = people.content_id
          WHERE c.leaves_at IS NOT NULL AND c.deleted_at IS NULL
          ON CONFLICT (content_id, kind, round, user_id) DO NOTHING
          RETURNING 1
        `);
        return rows.length;
      });
    } catch (error) {
      this.handleError(error, 'addReminders');
    }
  }

  // ── The claim ──────────────────────────────────────────────────────────

  /** `onlyContentIds` as a filter on `n`; none in production. */
  private scope(): SQL {
    if (!this.onlyContentIds) return sql``;
    if (this.onlyContentIds.length === 0) return sql`AND false`;
    return sql`AND n.content_id IN (${sql.join(
      this.onlyContentIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )})`;
  }

  /** Not claimed in the last LEAVING_NOTICE_LEASE_MS. */
  private unleased(now: Date): SQL {
    const before = new Date(now.getTime() - LEAVING_NOTICE_LEASE_MS);
    return sql`(n.attempted_at IS NULL OR n.attempted_at < ${before.toISOString()}::timestamptz)`;
  }

  /**
   * Open notices whose email is no longer true become `cancelled`, each
   * warned of: its person may never have been told (a day-30 completion or
   * a race; every delete and Keep cancels what it makes untrue itself).
   * `removed` is always true, and its CHECK refuses a cancel.
   */
  private async cancelUntrue(now: Date): Promise<number> {
    const { rows } = await this.db.execute(sql`
      WITH untrue AS (
        SELECT n.id
        FROM ${contentLeavingNotices} n
        JOIN ${content} c ON c.id = n.content_id
        WHERE n.state IN (${OPEN_STATES})
          AND n.kind <> 'removed'
          AND ${this.unleased(now)}
          ${this.scope()}
          AND ${STILL_TRUE} IS NOT TRUE
        ORDER BY n.created_at, n.id
        LIMIT ${this.limits.perTick}
        FOR UPDATE OF n SKIP LOCKED
      )
      UPDATE ${contentLeavingNotices} AS n
      SET state = 'cancelled', updated_at = ${now.toISOString()}::timestamptz
      FROM untrue
      WHERE n.id = untrue.id
      RETURNING n.id, n.content_id, n.kind, n.attempts, n.last_reason
    `);
    const cancelled = rows as NoticeRow[];
    this.logEach(
      cancelled,
      (row) =>
        this.obs.warn(
          'Leaving sweep: a notice was cancelled, its email no longer true; its person may never have been told',
          {
            noticeId: row.id,
            contentId: row.content_id,
            kind: row.kind,
            attempts: row.attempts,
            lastReason: row.last_reason,
          }
        ),
      (more) =>
        this.obs.warn(
          'Leaving sweep: more notices were cancelled, their emails no longer true; those tried may have been told',
          more
        )
    );
    return cancelled.length;
  }

  /**
   * Open notices with their tries used up, the last one cut off before an
   * answer, are abandoned as `unknown`, never with an older answer's reason:
   * the cut-off send may have gone (WP-1 review r4). Each is an error.
   */
  private async abandonSpent(now: Date): Promise<number> {
    const { rows } = await this.db.execute(sql`
      WITH spent AS (
        SELECT n.id
        FROM ${contentLeavingNotices} n
        WHERE n.state IN (${OPEN_STATES})
          AND n.attempts >= ${LEAVING_NOTICE_MAX_TRIES}
          AND ${this.unleased(now)}
          ${this.scope()}
        ORDER BY n.created_at, n.id
        LIMIT ${this.limits.perTick}
        FOR UPDATE OF n SKIP LOCKED
      )
      UPDATE ${contentLeavingNotices} AS n
      SET state = 'abandoned', last_reason = 'unknown',
          updated_at = ${now.toISOString()}::timestamptz
      FROM spent
      WHERE n.id = spent.id
      RETURNING n.id, n.content_id, n.kind, n.attempts, n.last_reason
    `);
    const spent = rows as NoticeRow[];
    this.logEach(
      spent,
      (row) =>
        this.obs.error(
          'Leaving sweep: a notice was abandoned after its tries, the last one cut off; it may have gone',
          {
            noticeId: row.id,
            contentId: row.content_id,
            kind: row.kind,
            attempts: row.attempts,
            reason: 'unknown',
          }
        ),
      (more) =>
        this.obs.error(
          'Leaving sweep: more notices were abandoned after their tries',
          more
        )
    );
    return spent.length;
  }

  /**
   * Claims up to `limit` true, open notices with tries left and no lease,
   * oldest first: `leaving` ones, or every other kind. The try is counted
   * here, before any send.
   */
  private async claim(
    now: Date,
    kinds: 'leaving' | 'others',
    limit: number
  ): Promise<Claimed[]> {
    if (limit <= 0) return [];
    const stamp = now.toISOString();
    const { rows } = await this.db.execute(sql`
      WITH picked AS (
        SELECT n.id, n.attempted_at AS prev_attempted_at
        FROM ${contentLeavingNotices} n
        JOIN ${content} c ON c.id = n.content_id
        WHERE n.state IN (${OPEN_STATES})
          AND ${kinds === 'leaving' ? sql`n.kind = 'leaving'` : sql`n.kind <> 'leaving'`}
          AND n.attempts < ${LEAVING_NOTICE_MAX_TRIES}
          AND ${this.unleased(now)}
          ${this.scope()}
          AND ${STILL_TRUE}
        ORDER BY n.created_at, n.id
        LIMIT ${limit}
        FOR UPDATE OF n SKIP LOCKED
      )
      UPDATE ${contentLeavingNotices} AS n
      SET attempts = n.attempts + 1, attempted_at = ${stamp}::timestamptz,
          updated_at = ${stamp}::timestamptz
      FROM picked
      WHERE n.id = picked.id
      RETURNING n.id, n.content_id, n.user_id, n.kind, n.round, n.attempts,
        n.created_at, picked.prev_attempted_at
    `);
    return (
      rows as Array<{
        id: string;
        content_id: string;
        user_id: string;
        kind: ContentLeavingNoticeKind;
        round: Date | string;
        attempts: number;
        created_at: Date | string;
        prev_attempted_at: Date | string | null;
      }>
    )
      .sort(
        (a, b) =>
          asDate(a.created_at).getTime() - asDate(b.created_at).getTime() ||
          a.id.localeCompare(b.id)
      )
      .map((row) => ({
        id: row.id,
        contentId: row.content_id,
        userId: row.user_id,
        kind: row.kind,
        round: asDate(row.round),
        attempts: row.attempts,
        prevAttemptedAt: row.prev_attempted_at
          ? asDate(row.prev_attempted_at)
          : null,
      }));
  }

  /**
   * The libraries of the owners whose `leaving` notice was just claimed
   * (design §8): the delete bumped up to 500 of them inline, and this
   * reaches the rest. Each person once; the claim kept them within the
   * tick's subrequest budget. Returns the bumps that landed.
   */
  private async bumpLibraries(leaving: Claimed[]): Promise<number> {
    if (!this.cache || leaving.length === 0) return 0;
    return this.bumpEach(
      this.cache,
      new Set(leaving.map((notice) => notice.userId))
    );
  }

  /**
   * Day 30's libraries (design §5 step 3, §8): every owner of the pieces
   * just deleted, each once, read LEAVING_SWEEP_HOLDERS_PAGE at a time and
   * bumped a page at once, with no 500 cap, up to the tick's
   * LEAVING_SWEEP_COMPLETION_BUMPS_PER_TICK, LEAVING_SWEEP_BUMP_CHUNK at a
   * time, and no chunk started at or after `until` (the route's time, so it
   * answers before media-api gives up).
   * Past either, one warn names the pieces and how many were not bumped: a
   * library page refetches on mount, so a missed bump only keeps a card in
   * a tab already open. The rest of the pieces' people (subscribers, team)
   * are the route's (`afterBulkChange`, holders left out).
   *
   * Never throws: the deletes have committed, so a read that fails is
   * logged with the pieces. Returns the bumps that landed.
   */
  async bumpOwnersOf(
    pieceIds: readonly string[],
    { until }: { until?: number } = {}
  ): Promise<number> {
    const cache = this.cache;
    if (!cache || pieceIds.length === 0) return 0;
    const ids = [...pieceIds];
    let landed = 0;
    let read = 0;
    let after: string | null = null;
    let timeUp = false;
    const outOfTime = () => {
      timeUp ||= until !== undefined && this.clock() >= until;
      return timeUp;
    };
    try {
      while (read < this.limits.completionBumps && !outOfTime()) {
        const limit = Math.min(
          this.limits.holdersPage,
          this.limits.completionBumps - read
        );
        const page = await this.ownersAfter(ids, after, limit);
        // Chunk by chunk, the deadline checked between them: a page started
        // in time must not run past it.
        for (let i = 0; i < page.length; i += this.limits.bumpChunk) {
          if (i > 0 && outOfTime()) break;
          const chunk = page.slice(i, i + this.limits.bumpChunk);
          landed += await this.bumpEach(cache, chunk);
          read += chunk.length;
          after = chunk.at(-1) ?? after;
        }
        if (timeUp) break;
        if (page.length < limit) return landed;
      }
      const holders = holdersOf(this.db, ids);
      const [rest] = await this.db
        .select({ people: countDistinct(holders.userId) })
        .from(holders)
        .where(after === null ? undefined : gt(holders.userId, after));
      if (rest && rest.people > 0) {
        this.obs.warn(
          "Leaving sweep: day 30's owners were not all bumped, the tick's bumps or its time used up; their library pages refetch on mount",
          {
            contentIds: ids,
            bumped: landed,
            notBumped: rest.people,
            ranOut: timeUp ? 'time' : 'bumps',
          }
        );
      }
    } catch (error) {
      this.obs.error(
        "Leaving sweep: day 30's owners could not all be read; the rest were not bumped",
        { contentIds: ids, bumped: landed, error: messageForLog(error) }
      );
    }
    return landed;
  }

  /** The pieces' owners after `after`, by id, each once. */
  private async ownersAfter(
    contentIds: string[],
    after: string | null,
    limit: number
  ): Promise<string[]> {
    const holders = holdersOf(this.db, contentIds);
    const rows = await this.db
      .selectDistinct({ userId: holders.userId })
      .from(holders)
      .where(after === null ? undefined : gt(holders.userId, after))
      .orderBy(asc(holders.userId))
      .limit(limit);
    return rows.map((row) => row.userId);
  }

  /** Bumps each user's library key once; returns how many landed. */
  private async bumpEach(
    cache: VersionedCache,
    userIds: Iterable<string>
  ): Promise<number> {
    let tried = 0;
    let failed = 0;
    const bumps: Promise<void>[] = [];
    for (const userId of userIds) {
      tried += 1;
      bumps.push(
        cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId), {
          // Logged by the cache; counted here.
          onError: () => {
            failed += 1;
          },
        })
      );
    }
    await Promise.all(bumps);
    return tried - failed;
  }

  /**
   * The pieces the claimed notices are about, and their creators, read
   * once. An org is read only while it is live: a deleted org's slug can be
   * taken by another tenant, so its piece links no org page, is named by its
   * creator and is sent in the platform's brand and wording.
   */
  private async factsOf(
    claimed: Claimed[]
  ): Promise<Pick<Tick, 'creators' | 'pieces'>> {
    const contentIds = [...new Set(claimed.map((notice) => notice.contentId))];
    const pieceRows = await this.db
      .select({
        id: content.id,
        title: content.title,
        slug: content.slug,
        contentType: content.contentType,
        ownersCanDownload: content.ownersCanDownload,
        organizationId: content.organizationId,
        liveOrgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        creatorId: content.creatorId,
      })
      .from(content)
      .leftJoin(
        organizations,
        and(
          eq(organizations.id, content.organizationId),
          isNull(organizations.deletedAt)
        )
      )
      .where(inArray(content.id, contentIds));
    const creatorIds = [...new Set(pieceRows.map((piece) => piece.creatorId))];
    const creatorRows =
      creatorIds.length === 0
        ? []
        : await this.db
            .select({
              id: users.id,
              name: users.name,
              username: users.username,
            })
            .from(users)
            .where(inArray(users.id, creatorIds));
    return {
      creators: new Map(creatorRows.map(({ id, ...creator }) => [id, creator])),
      pieces: new Map(pieceRows.map(({ id, ...piece }) => [id, piece])),
    };
  }

  /**
   * The people a batch is about to mail, read just before it goes: an
   * account erased since the claim is no address (design §2), never mailed
   * from an older read.
   */
  private async recipientsOf(userIds: string[]): Promise<Map<string, Person>> {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(inArray(users.id, [...new Set(userIds)]));
    return new Map(rows.map(({ id, ...person }) => [id, person]));
  }

  // ── Sending ────────────────────────────────────────────────────────────

  /**
   * Sends the claimed notices in batches, none started after the budget.
   * A notice with no email to write (no link) is given back untried, with
   * one error for the tick.
   */
  private async sendAll(tick: Tick, claimed: Claimed[]): Promise<void> {
    const writable: Claimed[] = [];
    const unwritable: Claimed[] = [];
    for (const notice of claimed) {
      if (this.messageFor(tick, notice)) writable.push(notice);
      else unwritable.push(notice);
    }
    await this.giveBackUnwritable(tick, unwritable);

    const { batch } = this.limits;
    for (let i = 0; i < writable.length; i += batch) {
      if (this.clock() >= tick.sendsUntil) {
        const givenBack = await this.giveBack(tick.now, writable.slice(i));
        tick.tally.givenBack += givenBack;
        this.obs.warn(
          'Leaving sweep: the send budget ran out; the rest are given back for the next tick',
          { givenBack, sent: tick.tally.sent }
        );
        return;
      }
      const items = writable.slice(i, i + batch);
      // Read again just before the batch goes, as the tick's first read can
      // be minutes old: an account erased since is no address (design §2),
      // and an org deleted since is never named, linked or branded (owner).
      const [people] = await Promise.all([
        this.recipientsOf(items.map((notice) => notice.userId)),
        this.refreshOrgs(
          tick,
          items.map((notice) => notice.contentId)
        ),
      ]);
      const ready: Array<{ notice: Claimed; message: LeavingNoticeMessage }> =
        [];
      const unwritableNow: Claimed[] = [];
      for (const notice of items) {
        const message = this.messageFor(tick, notice);
        if (message) ready.push({ notice, message });
        else unwritableNow.push(notice);
      }
      await this.giveBackUnwritable(tick, unwritableNow);
      for (const { notice } of ready) tick.started.add(notice.id);
      await Promise.all(
        ready.map(({ notice, message }) => {
          const person = people.get(notice.userId);
          return this.sendOne(
            tick,
            notice,
            person && person.deletedAt === null
              ? {
                  ...message,
                  to: person.email,
                  toName: person.name,
                  category: 'transactional',
                  userId: notice.userId,
                  data: {
                    userName: greetingName(person.name),
                    ...message.data,
                  },
                }
              : null
          );
        })
      );
    }
  }

  /** Notices with no email to write (no link) go back untried, with one error. */
  private async giveBackUnwritable(
    tick: Tick,
    unwritable: Claimed[]
  ): Promise<void> {
    if (unwritable.length === 0) return;
    const givenBack = await this.giveBack(tick.now, unwritable);
    tick.tally.givenBack += givenBack;
    tick.tally.errors += 1;
    this.obs.error(
      'Leaving sweep: notices could not be written (no link to the piece); given back',
      {
        notices: unwritable.length,
        givenBack,
        contentIds: [...new Set(unwritable.map((n) => n.contentId))].slice(
          0,
          NAMED_PER_TICK
        ),
      }
    );
  }

  /**
   * The batch's org pieces' orgs, read again: one deleted since the tick's
   * first read loses its id, slug and name, so the email takes the
   * dead-org path (no brand, the owner's library, the creator's name); one
   * renamed links its new slug.
   */
  private async refreshOrgs(tick: Tick, contentIds: string[]): Promise<void> {
    const ids = [...new Set(contentIds)].filter(
      (id) => tick.pieces.get(id)?.organizationId
    );
    if (ids.length === 0) return;
    const rows = await this.db
      .select({
        id: content.id,
        liveOrgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(content)
      .leftJoin(
        organizations,
        and(
          eq(organizations.id, content.organizationId),
          isNull(organizations.deletedAt)
        )
      )
      .where(inArray(content.id, ids));
    for (const { id, ...org } of rows) {
      const piece = tick.pieces.get(id);
      if (piece) Object.assign(piece, org);
    }
  }

  /**
   * The email a notice sends, but for its person, or null when it can't be
   * written: every kind but `removed` links the piece's page.
   */
  private messageFor(tick: Tick, notice: Claimed): LeavingNoticeMessage | null {
    const piece = tick.pieces.get(notice.contentId);
    if (!piece) return null;
    const templateName = CONTENT_LEAVING_NOTICE_TEMPLATES[notice.kind];
    if (notice.kind === 'removed') {
      return {
        templateName,
        organizationId: piece.liveOrgId,
        platformTemplate: true,
        data: { contentTitle: piece.title },
      };
    }
    const creator = tick.creators.get(piece.creatorId);
    const contentUrl = this.contentUrlFor({
      slug: piece.slug,
      organizationSlug: piece.orgSlug,
      // The creators path serves personal pieces alone: an org piece whose
      // org is gone links the owner's library instead.
      creatorUsername:
        piece.organizationId === null ? (creator?.username ?? null) : null,
    });
    if (!contentUrl) return null;
    // An org's piece is the org's to remove or keep; a personal one, or one
    // whose org is gone, its creator's.
    const creatorName =
      piece.orgName?.trim() || creator?.name.trim() || 'Its creator';
    const common = { contentTitle: piece.title, creatorName, contentUrl };
    return {
      templateName,
      organizationId: piece.liveOrgId,
      data:
        notice.kind === 'staying'
          ? common
          : {
              ...common,
              leaveDate: leaveDateOf(notice.round),
              actionLabel: actionLabelOf(piece),
            },
    };
  }

  /** Sends one notice (none for no address) and writes its answer. Never throws. */
  private async sendOne(
    tick: Tick,
    notice: Claimed,
    email: LeavingNoticeEmail | null
  ): Promise<void> {
    const ids = {
      noticeId: notice.id,
      contentId: notice.contentId,
      kind: notice.kind,
    };
    let delivery: LeavingNoticeDelivery | 'no_address' = 'no_address';
    if (email) {
      try {
        delivery = await this.mailer(email);
      } catch (error) {
        delivery = { accepted: false, error: messageForLog(error) };
      }
    }
    const outcome = leavingNoticeOutcome(delivery, notice.attempts);
    let recorded: boolean;
    try {
      recorded = await this.record(tick.now, notice, outcome);
    } catch (error) {
      tick.tally.errors += 1;
      this.obs.error(
        'Leaving sweep: an answer could not be written; the notice is claimed again after its lease',
        { ...ids, answered: outcome.state, error: messageForLog(error) }
      );
      return;
    }
    if (!recorded) {
      tick.tally.notRecorded += 1;
      this.obs.warn(
        'Leaving sweep: the notice closed while its email was in flight; its answer was not written',
        { ...ids, answered: outcome.state }
      );
      return;
    }
    tick.tally[outcome.state] += 1;
    if (outcome.state === 'sent') return;
    // What the answer was, for support (a template missing shows as a 404),
    // never the delivery's error text.
    const answer =
      delivery === 'no_address' || delivery.accepted
        ? {}
        : 'status' in delivery
          ? { status: delivery.status }
          : 'skipped' in delivery
            ? { skipped: delivery.skipped }
            : {};
    const context = {
      ...ids,
      templateName: CONTENT_LEAVING_NOTICE_TEMPLATES[notice.kind],
      reason: outcome.reason,
      attempts: notice.attempts,
      ...answer,
    };
    if (outcome.state !== 'abandoned') {
      this.obs.warn(
        'Leaving sweep: an email was not accepted; it is tried again after its lease',
        context
      );
    } else if (outcome.reason === 'no_address') {
      this.obs.info(
        'Leaving sweep: no address (an erased account); not tried again',
        context
      );
    } else if (outcome.reason === 'unknown') {
      this.obs.error(
        'Leaving sweep: a notice was abandoned after its tries, the last with no answer; it may have gone',
        context
      );
    } else {
      this.obs.error(
        'Leaving sweep: a notice was abandoned after its tries; its person was not told',
        context
      );
    }
  }

  /** Writes an answer only while the notice is open; false when it closed. */
  private async record(
    now: Date,
    notice: Claimed,
    outcome: LeavingNoticeOutcome
  ): Promise<boolean> {
    const values: Partial<typeof contentLeavingNotices.$inferInsert> =
      outcome.state === 'sent'
        ? { state: 'sent', sentAt: now, lastReason: null, updatedAt: now }
        : { state: outcome.state, lastReason: outcome.reason, updatedAt: now };
    const written = await this.db
      .update(contentLeavingNotices)
      .set(values)
      .where(
        and(
          eq(contentLeavingNotices.id, notice.id),
          inArray(contentLeavingNotices.state, [
            ...CONTENT_LEAVING_NOTICE_OPEN_STATES,
          ])
        )
      )
      // No field list: on the HTTP-or-WebSocket client union, drizzle types
      // only the bare overload.
      .returning();
    return written.length > 0;
  }

  /**
   * Claims whose send never started go back as they were: their try and its
   * time undone, so the next tick takes them at once. Only while still open
   * and this tick's (its stamp, its count), so a claim given back twice, or
   * taken since, is left alone. Returns how many went back.
   */
  private async giveBack(now: Date, unsent: Claimed[]): Promise<number> {
    if (unsent.length === 0) return 0;
    const stamp = now.toISOString();
    const { rows } = await this.db.execute(sql`
      UPDATE ${contentLeavingNotices} AS n
      SET attempts = n.attempts - 1, attempted_at = g.prev,
          updated_at = ${stamp}::timestamptz
      FROM unnest(
        ARRAY[${sql.join(
          unsent.map((notice) => sql`${notice.id}::uuid`),
          sql`, `
        )}]::uuid[],
        ARRAY[${sql.join(
          unsent.map(
            (notice) =>
              sql`${notice.prevAttemptedAt?.toISOString() ?? null}::timestamptz`
          ),
          sql`, `
        )}]::timestamptz[],
        ARRAY[${sql.join(
          unsent.map((notice) => sql`${notice.attempts}::int`),
          sql`, `
        )}]::int[]
      ) AS g(id, prev, attempts)
      WHERE n.id = g.id
        AND n.attempts = g.attempts
        AND n.attempted_at = ${stamp}::timestamptz
        AND n.state IN (${OPEN_STATES})
      RETURNING n.id
    `);
    return rows.length;
  }

  /**
   * Logs the first NAMED_PER_TICK rows one by one and the rest as one line,
   * so one cause reaching thousands of notices is never thousands of lines.
   * The line keeps every id, and counts them by kind, whether tried
   * (`attempts > 0`: its person may have been told) and last reason.
   */
  private logEach(
    rows: readonly NoticeRow[],
    named: (row: NoticeRow) => void,
    folded: (more: FoldedNotices) => void
  ): void {
    for (const row of rows.slice(0, NAMED_PER_TICK)) named(row);
    const rest = rows.slice(NAMED_PER_TICK);
    if (rest.length === 0) return;
    const counts: Record<string, number> = {};
    for (const row of rest) {
      const key = `${row.kind}/${row.attempts > 0 ? 'tried' : 'untried'}/${row.last_reason ?? 'none'}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    folded({
      notices: rest.length,
      noticeIds: rest.map((row) => row.id),
      contentIds: [...new Set(rest.map((row) => row.content_id))].slice(
        0,
        NAMED_PER_TICK
      ),
      counts,
    });
  }
}
