/**
 * The leaving notice (Codex-a6ofh.6, owner 2026-11-17; the design is
 * docs/handover/studio-content-media/leaving-notice-data-design.md).
 *
 * A creator who deletes a piece people own gives them notice instead of
 * ending their playback at once. The piece goes off sale with a date,
 * `content.leaves_at`, and its owners keep it until then. They are emailed,
 * and may download it if the creator allowed that when selling
 * (`content.owners_can_download`). A sweep finishes the delete on the day,
 * and the creator can keep the piece until then. The waiting state is never
 * `deleted_at`: the access check drops a deleted row before it reads any
 * purchase. A platform admin's delete, a takedown, stays immediate.
 *
 * This table holds one row per email an owner is due, so the sweep sends
 * it, retries it and never sends it twice:
 * - `leaving` rows are written in the delete's own transaction, one per
 *   owner, so nobody who owned it at the delete is missed;
 * - `reminder` rows are added by the sweep a few days before the date;
 * - `staying` rows are added when the creator keeps the piece, for everyone
 *   a `leaving` or `reminder` email of the round was tried for;
 * - `removed` rows are added by a platform admin's immediate delete.
 * Every writer adds `ON CONFLICT (content_id, kind, round, user_id) DO
 * NOTHING`. A person can own a piece several ways, and can have both a tried
 * `leaving` and a tried `reminder` row. DO NOTHING skips the repeat, even
 * within one statement. Without it (or with DO UPDATE) the unique below
 * refuses the whole statement, and so the delete or Keep around it. Writers
 * also read people from the one holders set (a UNION, never UNION ALL), so
 * the rows match the holder count the creator was shown.
 *
 * Whoever writes rows leaves out people whose account is deleted
 * (`users.deleted_at`): erasure scrubs the address but keeps the row, so
 * the cascade below never fires for them. A person erased after their row
 * was written is still claimed. Erasure leaves a tombstone address, not a
 * null one, so the send must take `users.deleted_at IS NOT NULL` as no
 * address, as the fee sweep does; the row then ends `abandoned` with
 * `no_address` and a try, as the CHECKs ask.
 *
 * `round` separates one notice period from the next. It copies the piece's
 * `leaves_at` (for `removed`, the time of the admin delete), so a piece kept
 * and then deleted again starts a fresh round, and each person is told again.
 * Both are stored to the millisecond, so a value read into JS and matched
 * back finds its rows.
 *
 * The sweep sends a row only while its email is still true, per kind:
 * - `leaving` and `reminder`: while the piece leaves on that round
 *   (`leaves_at = round`, not deleted);
 * - `staying`: while the piece is kept (`leaves_at IS NULL`, not deleted);
 * - `removed`: always.
 * Otherwise it cancels the row, with a warn log. Every delete also cancels
 * the piece's open `staying` rows in its own transaction.
 *
 * Rows are never deleted: a notice no longer needed becomes `cancelled`, and
 * one that used up its tries becomes `abandoned`. Both leave the sweep's
 * claim index, so it never re-reads them.
 */

import {
  CONTENT_LEAVING_NOTICE_KINDS,
  CONTENT_LEAVING_NOTICE_OPEN_STATES,
  CONTENT_LEAVING_NOTICE_REASONS,
  CONTENT_LEAVING_NOTICE_STATES,
  CONTENT_LEAVING_NOTICE_UNSENT_TRY_STATES,
  type ContentLeavingNoticeKind,
  type ContentLeavingNoticeReason,
  type ContentLeavingNoticeState,
} from '@codex/constants';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content } from './content';
import { users } from './users';

/**
 * `'a', 'b'` for a CHECK's or an index's IN list, from constant words. It is
 * raw SQL, so it takes only lower-case words and underscores.
 */
function sqlWords(words: readonly string[]) {
  for (const word of words) {
    if (!/^[a-z_]+$/.test(word)) {
      throw new Error(`Not a constant word for raw SQL: ${word}`);
    }
  }
  return sql.raw(words.map((word) => `'${word}'`).join(', '));
}

const SENT: readonly ContentLeavingNoticeState[] = ['sent'];
/** Every state a try leaves, `sent` among them: the claim counts each try. */
const AFTER_A_TRY: readonly ContentLeavingNoticeState[] = [
  ...SENT,
  ...CONTENT_LEAVING_NOTICE_UNSENT_TRY_STATES,
];
/**
 * What a `failed` try was answered with. No address is not retried: the row
 * is `abandoned` at once, since an erased account never gets one back.
 */
const FAILED_REASONS: readonly ContentLeavingNoticeReason[] = [
  'refused',
  'skipped',
];
const CANCELLED: readonly ContentLeavingNoticeState[] = ['cancelled'];
/** A takedown's `removed` email is its only one, so it is never cancelled. */
const CANCELLABLE_KINDS: readonly ContentLeavingNoticeKind[] = [
  'leaving',
  'reminder',
  'staying',
];

export const contentLeavingNotices = pgTable(
  'content_leaving_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict, as purchases do: content is soft-deleted, never removed, and
    // a notice outlives the piece it was about.
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 })
      .$type<ContentLeavingNoticeKind>()
      .notNull(),
    round: timestamp('round', { withTimezone: true, precision: 3 }).notNull(),
    state: varchar('state', { length: 20 })
      .$type<ContentLeavingNoticeState>()
      .notNull()
      .default('due'),
    // Tries started. The sweep's claim adds one BEFORE it sends, as the fee
    // notices' does, so a `due` row with a try is in flight or was cut off
    // after sending. That makes `attempts > 0` the one test of whether a
    // person may have been told: Keep writes a `staying` row from it.
    attempts: integer('attempts').notNull().default(0),
    // The sweep's lease clock: raw-SQL updates never fire `$onUpdate`, so
    // `updated_at` can't stand in for it.
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // Why the last try did not send: a code, never the sender's message.
    lastReason: varchar('last_reason', {
      length: 20,
    }).$type<ContentLeavingNoticeReason>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One email of each kind per person per notice period, so every writer
    // takes each person once (above). Its order serves the reads too: Keep's
    // and the reminder's (content_id, kind, round), and the content row's
    // RESTRICT check (content_id).
    uniqueIndex('uq_content_leaving_notices_person').on(
      table.contentId,
      table.kind,
      table.round,
      table.userId
    ),
    // The sweep's claim, oldest first: only the rows still to send, in the
    // order it takes them.
    index('idx_content_leaving_notices_open')
      .on(table.createdAt, table.id)
      .where(
        sql`${table.state} IN (${sqlWords(CONTENT_LEAVING_NOTICE_OPEN_STATES)})`
      ),
    // A user delete's cascade, as fee_change_notices has.
    index('idx_content_leaving_notices_user').on(table.userId),
    check(
      'check_content_leaving_notices_kind',
      sql`${table.kind} IN (${sqlWords(CONTENT_LEAVING_NOTICE_KINDS)})`
    ),
    check(
      'check_content_leaving_notices_state',
      sql`${table.state} IN (${sqlWords(CONTENT_LEAVING_NOTICE_STATES)})`
    ),
    check(
      'check_content_leaving_notices_reason',
      sql`${table.lastReason} IS NULL OR ${table.lastReason} IN (${sqlWords(CONTENT_LEAVING_NOTICE_REASONS)})`
    ),
    check(
      'check_content_leaving_notices_attempts',
      sql`${table.attempts} >= 0`
    ),
    // A sent notice says when; nothing else does.
    check(
      'check_content_leaving_notices_sent',
      sql`(${table.state} IN (${sqlWords(SENT)})) = (${table.sentAt} IS NOT NULL)`
    ),
    // Every state a try leaves has the try counted, `sent` too, since
    // `attempts > 0` is how Keep tells who may have been told.
    check(
      'check_content_leaving_notices_tried',
      sql`${table.state} NOT IN (${sqlWords(AFTER_A_TRY)}) OR ${table.attempts} > 0`
    ),
    // A try that did not send says why, so an owner who was never told can
    // be told apart from a bug.
    check(
      'check_content_leaving_notices_reason_given',
      sql`${table.state} NOT IN (${sqlWords(CONTENT_LEAVING_NOTICE_UNSENT_TRY_STATES)}) OR ${table.lastReason} IS NOT NULL`
    ),
    // The reason fits the state: `unknown` is exactly a try with no usable
    // answer, and a `failed` one was answered (refused or skipped). A 5xx
    // recorded as a refusal would hide an email that may have gone. A null
    // reason passes here and is refused by `_reason_given`.
    check(
      'check_content_leaving_notices_reason_fits',
      sql`(${table.state} <> 'failed' OR ${table.lastReason} IN (${sqlWords(FAILED_REASONS)})) AND (${table.state} <> 'unknown' OR ${table.lastReason} = 'unknown')`
    ),
    check(
      'check_content_leaving_notices_cancelled',
      sql`${table.state} NOT IN (${sqlWords(CANCELLED)}) OR ${table.kind} IN (${sqlWords(CANCELLABLE_KINDS)})`
    ),
  ]
);
