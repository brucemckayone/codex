/**
 * The leaving notice's emails (Codex-a6ofh.6; the design is
 * docs/handover/studio-content-media/leaving-notice-data-design.md §2).
 *
 * A creator who deletes a piece people own gives them notice: the piece goes
 * off sale, keeps playing for its owners until `content.leaves_at`, and a
 * sweep finishes the delete on that date. Each email an owner is due gets one
 * row here, so the sweep sends it, retries it and never sends it twice:
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
 * Rows are never deleted: a notice no longer needed becomes `cancelled`.
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

/** `'a', 'b'` for a CHECK's IN list, from a list of constant words. */
function sqlWords(words: readonly string[]) {
  return sql.raw(words.map((word) => `'${word}'`).join(', '));
}

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
    // One email of each kind per person per notice period.
    uniqueIndex('uq_content_leaving_notices_person').on(
      table.contentId,
      table.userId,
      table.kind,
      table.round
    ),
    // The sweep's claim: only the rows still to send.
    index('idx_content_leaving_notices_open')
      .on(table.state, table.createdAt)
      .where(sql`${table.state} IN ('due', 'failed')`),
    // Keep and the reminder step read one piece's notices.
    index('idx_content_leaving_notices_content').on(
      table.contentId,
      table.kind
    ),
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
