import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { content } from './content';
import { users } from './users';

/**
 * Tracks video playback progress for resume functionality
 *
 * Design decisions:
 * - Composite unique key (user_id + content_id) for upsert pattern
 * - Progress in seconds (not percentage) for accuracy
 * - completed flag set when user watches >= 95% of video
 * - Aligned with database-schema.md v2.0 (lines 465-497)
 *
 * Business rules:
 * - Update every 30 seconds during playback (frontend responsibility)
 * - Auto-complete when position >= 95% of duration
 * - No cleanup (historical record useful for analytics)
 */
export const videoPlayback = pgTable(
  'video_playback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),

    // Playback state
    positionSeconds: integer('position_seconds').notNull().default(0),
    durationSeconds: integer('duration_seconds').notNull(),
    completed: boolean('completed').notNull().default(false), // Watched >= 95%

    // Timestamps
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One playback record per user per video
    userContentUnique: unique().on(table.userId, table.contentId),

    // Indexes for common queries
    userIdIdx: index('idx_video_playback_user_id').on(table.userId),
    contentIdIdx: index('idx_video_playback_content_id').on(table.contentId),
  })
);

export const videoPlaybackRelations = relations(videoPlayback, ({ one }) => ({
  user: one(users, {
    fields: [videoPlayback.userId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [videoPlayback.contentId],
    references: [content.id],
  }),
}));

export type VideoPlayback = typeof videoPlayback.$inferSelect;
export type NewVideoPlayback = typeof videoPlayback.$inferInsert;
