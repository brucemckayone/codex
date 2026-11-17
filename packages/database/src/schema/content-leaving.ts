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
 * - `staying` rows are added when the creator keeps the piece, for the people
 *   already told;
 * - `removed` rows are added by a platform admin's immediate delete.
 *
 * `round` separates one notice period from the next. It copies the piece's
 * `leaves_at` (for `removed`, the time of the admin delete), so a piece kept
 * and then deleted again starts a fresh round, and each person is told again.
 *
 * Rows are never deleted: a notice no longer needed becomes `cancelled`, and
 * one that used up its tries becomes `abandoned`. Both leave the sweep's
 * claim index, so it never re-reads them.
 */

import {
  CONTENT_LEAVING_NOTICE_KINDS,
  CONTENT_LEAVING_NOTICE_STATES,
  type ContentLeavingNoticeKind,
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

/** The states the sweep still has to send. */
const OPEN_STATES: readonly ContentLeavingNoticeState[] = ['due', 'failed'];

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
    round: timestamp('round', { withTimezone: true }).notNull(),
    state: varchar('state', { length: 20 })
      .$type<ContentLeavingNoticeState>()
      .notNull()
      .default('due'),
    attempts: integer('attempts').notNull().default(0),
    // The sweep's lease clock: raw-SQL updates never fire `$onUpdate`, so
    // `updated_at` can't stand in for it.
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // The error's code only, never an address or a message with one in it.
    lastError: varchar('last_error', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One email of each kind per person per notice period. Its order serves
    // the reads too: Keep's and the reminder's (content_id, kind, round), and
    // the content row's RESTRICT check (content_id).
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
      .where(sql`${table.state} IN (${sqlWords(OPEN_STATES)})`),
    check(
      'check_content_leaving_notices_kind',
      sql`${table.kind} IN (${sqlWords(CONTENT_LEAVING_NOTICE_KINDS)})`
    ),
    check(
      'check_content_leaving_notices_state',
      sql`${table.state} IN (${sqlWords(CONTENT_LEAVING_NOTICE_STATES)})`
    ),
    check(
      'check_content_leaving_notices_attempts',
      sql`${table.attempts} >= 0`
    ),
    // A sent notice says when; nothing else does.
    check(
      'check_content_leaving_notices_sent',
      sql`(${table.state} = 'sent') = (${table.sentAt} IS NOT NULL)`
    ),
  ]
);
