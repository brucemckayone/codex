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
} from '@codex/constants';
import { content, contentLeavingNotices } from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import type { DatabaseTransaction, DeleteContentResult } from '../types';
import { countHolders, holdersOf } from './content-buyers';
import { NO_PUBLISH_REQUEST } from './publish-gate';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The notice table's unique: one email of each kind per person per round. */
const NOTICE_PERSON = [
  contentLeavingNotices.contentId,
  contentLeavingNotices.kind,
  contentLeavingNotices.round,
  contentLeavingNotices.userId,
];

/** What the leaving writes log through (an `ObservabilityClient`). */
export interface LeavingLog {
  error(message: string, metadata?: Record<string, unknown>): void;
}

/** The locked row a delete reads. */
export interface DeletingPiece {
  id: string;
  status: string;
  offSaleAt: Date | null;
  leavesAt: Date | null;
}

/** The day a piece deleted at `now` leaves ({@link LEAVING_NOTICE_DAYS}). */
export function leaveDateFrom(now: Date): Date {
  return new Date(now.getTime() + LEAVING_NOTICE_DAYS * DAY_MS);
}

/**
 * Guard (b) of the delete (design §4): the notice INSERT ... SELECT reads the
 * one holders set the count read, so it writes one row per holder. Fewer
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

/**
 * One `kind` row per holder of the piece, for `round`, from the one holders
 * set, each person once (ON CONFLICT DO NOTHING skips a repeat). Returns how
 * many it wrote.
 */
async function writeHolderNotices(
  tx: DatabaseTransaction,
  contentId: string,
  kind: 'leaving' | 'removed',
  round: Date
): Promise<number> {
  const holders = holdersOf(tx, [contentId]);
  const written = await tx
    .insert(contentLeavingNotices)
    .select(
      tx
        .select({
          contentId: sql<string>`${holders.contentId}`.as('content_id'),
          userId: holders.userId,
          kind: sql<ContentLeavingNoticeKind>`${kind}::varchar`.as('kind'),
          round: sql<Date>`${round.toISOString()}::timestamptz`.as('round'),
        })
        .from(holders)
    )
    .onConflictDoNothing({ target: NOTICE_PERSON })
    .returning({ id: contentLeavingNotices.id });
  return written.length;
}

/**
 * A creator's (or an org admin's) delete of a locked, live row (design §4).
 *
 * - Every delete cancels the piece's open `staying` emails: whatever Keep
 *   promised no longer holds.
 * - Nobody holds it: it is deleted at once, as before the notice existed.
 * - People hold it: it goes off sale with a date (`leaves_at`, never
 *   `deleted_at`, which would end their playback at once), is no longer
 *   scheduled, and each holder gets a `leaving` row. Its cover is kept: the
 *   caller cleans it up only for `deleted`.
 * - Already leaving: nothing is written and its date stands, so a second
 *   delete starts no new round and sends nobody a second email.
 *
 * Two guards keep the round from tying (ON CONFLICT DO NOTHING would then
 * skip everyone the earlier round wrote a row for): the new round must be
 * later than every round the piece has, and the rows written must match the
 * holders. Either throws, which rolls the whole delete back.
 */
export async function deleteOrLeave(
  tx: DatabaseTransaction,
  piece: DeletingPiece,
  log: LeavingLog,
  now: Date = new Date()
): Promise<DeleteContentResult> {
  const holders = await countHolders(tx, piece.id);
  if (piece.leavesAt) {
    return { outcome: 'leaving', leavesAt: piece.leavesAt, holders };
  }

  await cancelOpen(tx, piece.id, ['staying'], now);

  if (holders === 0) {
    await tx
      .update(content)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(content.id, piece.id));
    return { outcome: 'deleted', leavesAt: null, holders: 0 };
  }

  const leavesAt = leaveDateFrom(now);
  const [last] = await tx
    .select({ round: max(contentLeavingNotices.round) })
    .from(contentLeavingNotices)
    .where(eq(contentLeavingNotices.contentId, piece.id));
  if (last?.round && last.round.getTime() >= leavesAt.getTime()) {
    throw new InternalServiceError(
      'The leave date is not later than an earlier notice period',
      {
        contentId: piece.id,
        leavesAt: leavesAt.toISOString(),
        lastRound: last.round.toISOString(),
      }
    );
  }

  await tx
    .update(content)
    .set({
      status:
        piece.status === CONTENT_STATUS.PUBLISHED
          ? CONTENT_STATUS.ARCHIVED
          : piece.status,
      offSaleAt: piece.offSaleAt ?? now,
      leavesAt,
      ...NO_PUBLISH_REQUEST,
      updatedAt: now,
    })
    .where(eq(content.id, piece.id));

  const inserted = await writeHolderNotices(tx, piece.id, 'leaving', leavesAt);
  assertWroteEveryHolder(
    log,
    { contentId: piece.id, kind: 'leaving' },
    holders,
    inserted
  );
  return { outcome: 'leaving', leavesAt, holders };
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
 * Erased accounts get no row. Returns how many `staying` rows it wrote.
 */
export async function keepLeaving(
  tx: DatabaseTransaction,
  contentId: string,
  round: Date,
  now: Date = new Date()
): Promise<number> {
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
    .set({ leavesAt: null, updatedAt: now })
    .where(eq(content.id, contentId));
  return staying.rows.length;
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
): Promise<{ holders: number }> {
  await cancelOpen(tx, contentId, ['leaving', 'reminder', 'staying'], now);
  const holders = await countHolders(tx, contentId);

  await tx
    .update(content)
    .set({
      deletedAt: now,
      leavesAt: null,
      ...NO_PUBLISH_REQUEST,
      updatedAt: now,
    })
    .where(eq(content.id, contentId));

  const inserted = await writeHolderNotices(tx, contentId, 'removed', now);
  assertWroteEveryHolder(
    log,
    { contentId, kind: 'removed' },
    holders,
    inserted
  );
  return { holders };
}
