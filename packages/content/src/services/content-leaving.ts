/**
 * The leaving notice's writes (Codex-a6ofh.6, design §4): what a delete of a
 * piece people own does instead of ending their playback, Keep, the day-30
 * delete and a platform admin's takedown. The rules for the notice rows are
 * in `@codex/database`'s `schema/content-leaving.ts`; every function here
 * keeps them.
 *
 * Each runs inside its caller's transaction, after the caller has locked the
 * piece's row under its own scope: the creator's (`ContentService`), the
 * org's (`AdminContentManagementService.deleteContent`) or the platform
 * admin's (`takedownContent`). So the writes here go by id alone.
 */
import {
  CONTENT_LEAVING_NOTICE_OPEN_STATES,
  CONTENT_STATUS,
  type ContentLeavingNoticeKind,
  LEAVING_NOTICE_DAYS,
  LEAVING_ROUND_GAP_HOURS,
} from '@codex/constants';
import { content, contentLeavingNotices } from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ContentLeavingTooSoonError, LeaveNotYoursError } from '../errors';
import type {
  DatabaseTransaction,
  DeleteContentResult,
  KeepContentResult,
} from '../types';
import { holdersOf } from './content-buyers';
import { NO_PUBLISH_REQUEST } from './publish-gate';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What the leaving writes log through (an `ObservabilityClient`). */
interface LeavingLog {
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * Whose delete or Keep it is (owner 2026-11-19): the creator's own
 * (`ContentService`), or an org owner or admin's (`@codex/admin`). Only the
 * side that started a leave can Keep it.
 */
type LeaveSide = 'creator' | 'org';

/** The locked row a delete reads. */
interface DeletingPiece {
  id: string;
  status: string;
  offSaleAt: Date | null;
  leavesAt: Date | null;
  leavingByOrg: boolean;
}

/** The locked row Keep reads. */
interface KeepingPiece {
  id: string;
  leavesAt: Date | null;
  leavingByOrg: boolean;
}

/** The day a piece deleted at `now` leaves ({@link LEAVING_NOTICE_DAYS}). */
export function leaveDateFrom(now: Date): Date {
  return new Date(now.getTime() + LEAVING_NOTICE_DAYS * DAY_MS);
}

/**
 * Guard (b) of the delete (design §4): the notice INSERT ... SELECT reads the
 * one holders set the count read, in one statement, so it writes one row per
 * holder. Fewer
 * means ON CONFLICT DO NOTHING skipped someone, who would never be told, so
 * this logs and throws, which rolls the delete back.
 */
export function assertWroteEveryHolder(
  log: LeavingLog,
  context: { contentId: string; kind: ContentLeavingNoticeKind },
  holders: number,
  inserted: number
): void {
  if (inserted === holders) return;
  log.error('leaving notice: rows written do not match the holders', {
    ...context,
    holders,
    inserted,
  });
  throw new InternalServiceError('Could not write every owner’s notice', {
    ...context,
    holders,
    inserted,
  });
}

/**
 * Open notices of `kinds` for the piece become `cancelled`: of one `round`
 * when given, else of every round.
 */
async function cancelOpen(
  tx: DatabaseTransaction,
  contentId: string,
  kinds: readonly ContentLeavingNoticeKind[],
  now: Date,
  round?: Date
): Promise<void> {
  const open = [
    eq(contentLeavingNotices.contentId, contentId),
    inArray(contentLeavingNotices.kind, [...kinds]),
    inArray(contentLeavingNotices.state, [
      ...CONTENT_LEAVING_NOTICE_OPEN_STATES,
    ]),
  ];
  if (round) open.push(eq(contentLeavingNotices.round, round));
  await tx
    .update(contentLeavingNotices)
    .set({ state: 'cancelled', updatedAt: now })
    .where(and(...open));
}

/** What {@link writeHolderNotices} counted, from one snapshot. */
interface HolderNotices {
  /** The piece's holders (`holdersOf`). */
  holders: number;
  /** The rows the INSERT wrote: one per holder, unless DO NOTHING skipped. */
  inserted: number;
  /** The piece's latest round BEFORE this write, if it had one. */
  lastRound: Date | null;
  /**
   * The latest round BEFORE this write in which an email was tried (a row
   * with `attempts > 0`): the last notice period that may have emailed
   * anyone. A period cancelled before any try emailed nobody.
   */
  lastEmailedRound: Date | null;
}

/**
 * One `kind` row per holder of the piece, for `round`, each person once (ON
 * CONFLICT DO NOTHING skips a repeat). ONE statement counts the holders,
 * writes their rows and reads the piece's last round before the write, so
 * the count and the rows read one set: as two statements, a grant landing
 * between them would read as a skipped holder. The INSERT is SQL around the
 * holders' SELECT, since drizzle's insert-select takes only a select of
 * every column, in table order.
 */
async function writeHolderNotices(
  tx: DatabaseTransaction,
  contentId: string,
  kind: 'leaving' | 'removed',
  round: Date
): Promise<HolderNotices> {
  const holders = holdersOf(tx, [contentId]);
  const people = tx
    .select({
      contentId: sql`${holders.contentId}`.as('content_id'),
      userId: sql`${holders.userId}`.as('user_id'),
    })
    .from(holders);
  const { rows } = await tx.execute(sql`
    WITH people AS (${people}),
    last AS (
      SELECT max(round) AS round,
        max(round) FILTER (WHERE attempts > 0) AS emailed
      FROM content_leaving_notices
      WHERE content_id = ${contentId}::uuid
    ),
    written AS (
      INSERT INTO content_leaving_notices (content_id, user_id, kind, round)
      SELECT people.content_id, people.user_id, ${kind}, ${round.toISOString()}::timestamptz
      FROM people
      ON CONFLICT (content_id, kind, round, user_id) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM people)::int AS holders,
      (SELECT count(*) FROM written)::int AS inserted,
      (SELECT round FROM last) AS last_round,
      (SELECT emailed FROM last) AS last_emailed_round
  `);
  const [counted] = rows as Array<{
    holders: number;
    inserted: number;
    last_round: Date | string | null;
    last_emailed_round: Date | string | null;
  }>;
  // The SELECT of scalars always answers one row. Without it, a count read
  // as 0 would take the delete down its no-holders branch: deleted at once,
  // every owner's playback ended with no notice. So a missing row, or a date
  // that does not parse (which would let guard (a) or the gap pass), is an
  // error.
  if (!counted) {
    throw new InternalServiceError('The leaving notice wrote no count row', {
      contentId,
      kind,
    });
  }
  const asRound = (value: Date | string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new InternalServiceError('The last notice round did not parse', {
        contentId,
        kind,
      });
    }
    return date;
  };
  return {
    holders: counted.holders,
    inserted: counted.inserted,
    lastRound: asRound(counted.last_round),
    lastEmailedRound: asRound(counted.last_emailed_round),
  };
}

/** The holders a leaving piece's round wrote a `leaving` row for. */
function leavingRowsOf(
  tx: DatabaseTransaction,
  contentId: string,
  round: Date
): Promise<number> {
  return tx.$count(
    contentLeavingNotices,
    and(
      eq(contentLeavingNotices.contentId, contentId),
      eq(contentLeavingNotices.kind, 'leaving'),
      eq(contentLeavingNotices.round, round)
    )
  );
}

/**
 * A creator's (or an org admin's) delete of a locked, live row (design §4).
 *
 * - Already leaving: nothing is written and its date stands, so a second
 *   delete starts no new round and sends nobody a second email. Its holders
 *   are the ones its round wrote a row for.
 * - Every other delete cancels the piece's open `staying` emails: whatever
 *   Keep promised no longer holds.
 * - Nobody holds it: it is deleted at once, as before the notice existed.
 * - People hold it: it goes off sale with a date (`leaves_at`, never
 *   `deleted_at`, which would end their playback at once), is no longer
 *   scheduled, and each holder gets a `leaving` row. Its cover is kept: the
 *   caller cleans it up only for `deleted`.
 *
 * Two guards keep the round from tying (ON CONFLICT DO NOTHING would then
 * skip everyone the earlier round wrote a row for): the new round must be
 * later than every round the piece had, and the rows written must match the
 * holders. Either throws, which rolls the whole delete back, rows included.
 *
 * `by` says whose delete it is (owner 2026-11-19), so only that side can
 * Keep it: an org admin's delete of a piece already leaving by its
 * creator's makes it the org's, with no new round and no email. And a new
 * round must start {@link LEAVING_ROUND_GAP_HOURS} after the last one that
 * emailed anyone did, or the delete is refused (409, rolled back), so a
 * delete and a Keep, repeated, cannot email the owners every hour. A period
 * kept before any email was tried emailed nobody and starts no gap, so a
 * silent delete and Keep cannot hold off the other side's delete (owner
 * 2026-11-19, review round 2).
 */
export async function deleteOrLeave(
  tx: DatabaseTransaction,
  piece: DeletingPiece,
  by: LeaveSide,
  log: LeavingLog,
  now: Date = new Date()
): Promise<DeleteContentResult> {
  if (piece.leavesAt) {
    if (by === 'org' && !piece.leavingByOrg) {
      await tx
        .update(content)
        .set({ leavingByOrg: true, updatedAt: now })
        .where(eq(content.id, piece.id));
    }
    const holders = await leavingRowsOf(tx, piece.id, piece.leavesAt);
    return { outcome: 'leaving', leavesAt: piece.leavesAt, holders };
  }

  await cancelOpen(tx, piece.id, ['staying'], now);

  const leavesAt = leaveDateFrom(now);
  const written = await writeHolderNotices(tx, piece.id, 'leaving', leavesAt);
  if (written.holders === 0) {
    await tx
      .update(content)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(content.id, piece.id));
    return { outcome: 'deleted', leavesAt: null, holders: 0 };
  }
  const { lastRound } = written;
  if (lastRound && lastRound.getTime() >= leavesAt.getTime()) {
    throw new InternalServiceError(
      'The leave date is not later than an earlier notice period',
      {
        contentId: piece.id,
        leavesAt: leavesAt.toISOString(),
        lastRound: lastRound.toISOString(),
      }
    );
  }
  // Rounds are their period's end, each period the same length, so the
  // gap between two rounds is the gap between the deletes that started them.
  // Measured from the last period that emailed anyone, never the last one.
  const gapMs = LEAVING_ROUND_GAP_HOURS * HOUR_MS;
  const { lastEmailedRound: emailed } = written;
  if (emailed && leavesAt.getTime() - emailed.getTime() < gapMs) {
    throw new ContentLeavingTooSoonError(
      piece.id,
      new Date(now.getTime() + gapMs - (leavesAt.getTime() - emailed.getTime()))
    );
  }
  assertWroteEveryHolder(
    log,
    { contentId: piece.id, kind: 'leaving' },
    written.holders,
    written.inserted
  );

  await tx
    .update(content)
    .set({
      status:
        piece.status === CONTENT_STATUS.PUBLISHED
          ? CONTENT_STATUS.ARCHIVED
          : piece.status,
      offSaleAt: piece.offSaleAt ?? now,
      leavesAt,
      leavingByOrg: by === 'org',
      ...NO_PUBLISH_REQUEST,
      updatedAt: now,
    })
    .where(eq(content.id, piece.id));
  return { outcome: 'leaving', leavesAt, holders: written.holders };
}

/**
 * Keep (design §4): the creator cancels a leave. In this order, in the
 * caller's transaction:
 * 1. every open `leaving` and `reminder` email of the round is cancelled,
 *    tried or not;
 * 2. everyone whose newest email that counts says it leaves gets a
 *    `staying` row for the kept round. A `leaving` or `reminder` email
 *    counts once tried (it may have gone; the rows just cancelled included),
 *    a `staying` one only once sent. Newest is the latest round, and within
 *    a round a `staying` email comes last (one Keep per round), never
 *    `created_at`, the time a transaction began. Reading this before step 1
 *    would miss a send that started in between;
 * 3. the date is cleared, and the piece stays off sale.
 * Erased accounts get no row.
 *
 * Only the side whose delete started the leave can Keep it (`by`, owner
 * 2026-11-19); the other is refused (403) before anything is written. A
 * piece that is not leaving comes back as it is, writing nothing (`kept:
 * false`), as a cancel of a schedule that isn't there does.
 */
export async function keepLeaving(
  tx: DatabaseTransaction,
  piece: KeepingPiece,
  by: LeaveSide,
  now: Date = new Date()
): Promise<KeepContentResult> {
  const { id: contentId, leavesAt: round } = piece;
  if (!round) return { kept: false, staying: 0 };
  const startedBy: LeaveSide = piece.leavingByOrg ? 'org' : 'creator';
  if (startedBy !== by) throw new LeaveNotYoursError(contentId, startedBy);

  await cancelOpen(tx, contentId, ['leaving', 'reminder'], now, round);

  const staying = await tx.execute(sql`
    INSERT INTO content_leaving_notices (content_id, user_id, kind, round)
    SELECT ${contentId}::uuid, picked.user_id, 'staying', ${round.toISOString()}::timestamptz
    FROM (
      SELECT DISTINCT ON (n.user_id) n.user_id, n.kind
      FROM content_leaving_notices n
      JOIN users u ON u.id = n.user_id AND u.deleted_at IS NULL
      WHERE n.content_id = ${contentId}::uuid
        AND ((n.kind IN ('leaving', 'reminder') AND n.attempts > 0)
          OR (n.kind = 'staying' AND n.state = 'sent'))
      ORDER BY n.user_id, n.round DESC, (n.kind = 'staying') DESC
    ) picked
    WHERE picked.kind <> 'staying'
    ON CONFLICT (content_id, kind, round, user_id) DO NOTHING
    RETURNING id
  `);

  await tx
    .update(content)
    .set({ leavesAt: null, leavingByOrg: false, updatedAt: now })
    .where(eq(content.id, contentId));
  return { kept: true, staying: staying.rows.length };
}

/**
 * A platform admin's takedown (D4, design §4) of a locked, live row: deleted
 * at once, whoever holds it. Every open email about the piece is cancelled
 * (it is no longer leaving, kept or anything else), its date is cleared, so
 * a deleted piece with a date means exactly one that left with notice, and
 * each holder gets a `removed` row instead. Returns how many hold it.
 */
export async function takedownPiece(
  tx: DatabaseTransaction,
  contentId: string,
  log: LeavingLog,
  now: Date = new Date()
): Promise<number> {
  await cancelOpen(tx, contentId, ['leaving', 'reminder', 'staying'], now);
  await tx
    .update(content)
    .set({
      deletedAt: now,
      leavesAt: null,
      leavingByOrg: false,
      ...NO_PUBLISH_REQUEST,
      updatedAt: now,
    })
    .where(eq(content.id, contentId));

  const { holders, inserted } = await writeHolderNotices(
    tx,
    contentId,
    'removed',
    now
  );
  assertWroteEveryHolder(
    log,
    { contentId, kind: 'removed' },
    holders,
    inserted
  );
  return holders;
}
