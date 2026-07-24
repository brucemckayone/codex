import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content } from './content';
import { courses } from './journeys';
import { users } from './users';

/**
 * Progress, completion & reporting (D7 · SPEC §11).
 *
 * A practice is a `content` row inside a course stage. Completion is an EXPLICIT
 * "mark complete" action (works for `written` practices, which have no playback
 * signal) — the row here is the source of truth; watch-% from `videoPlayback` is
 * used for resume position only, never completion. `userId` is TEXT ([H]).
 */

/** One row per (user, practice-content) marked complete. */
export const practiceCompletions = pgTable(
  'practice_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // 'manual' = explicit mark-complete (source of truth); 'auto' = auto-suggested
    // from playback and confirmed. Written practices are always 'manual'.
    source: varchar('source', { length: 30 }).notNull().default('manual'),
  },
  (table) => [
    index('idx_practice_completions_user_id').on(table.userId),
    index('idx_practice_completions_content_id').on(table.contentId),
    // A practice is completed once per user.
    uniqueIndex('uq_practice_completion_user_content').on(
      table.userId,
      table.contentId
    ),
    check(
      'check_practice_completion_source',
      sql`${table.source} IN ('manual', 'auto')`
    ),
  ]
);

/**
 * Who is "on" / "has taken" a course (SPEC §11). Created on entitlement grant or
 * first dashboard access; drives the dashboard and reporting. Course completion
 * (all required practices done) is stamped in `completedAt`. Progress rollup =
 * `practice_completions ⋈ stage_practices` scoped to the enrollment.
 *
 * `source` records how the enrollment began (an entitlement source or
 * `'first_access'`); left unconstrained by a CHECK so WP-6/WP-7 can extend it.
 */
export const courseEnrollments = pgTable(
  'course_enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    source: varchar('source', { length: 30 }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_course_enrollments_user_id').on(table.userId),
    index('idx_course_enrollments_course_id').on(table.courseId),
    // A user enrolls in a course once.
    uniqueIndex('uq_course_enrollment_user_course').on(
      table.userId,
      table.courseId
    ),
  ]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const practiceCompletionsRelations = relations(
  practiceCompletions,
  ({ one }) => ({
    user: one(users, {
      fields: [practiceCompletions.userId],
      references: [users.id],
    }),
    content: one(content, {
      fields: [practiceCompletions.contentId],
      references: [content.id],
    }),
  })
);

export const courseEnrollmentsRelations = relations(
  courseEnrollments,
  ({ one }) => ({
    user: one(users, {
      fields: [courseEnrollments.userId],
      references: [users.id],
    }),
    course: one(courses, {
      fields: [courseEnrollments.courseId],
      references: [courses.id],
    }),
  })
);

// ─── Type Exports ────────────────────────────────────────────────────────────

export type PracticeCompletion = typeof practiceCompletions.$inferSelect;
export type NewPracticeCompletion = typeof practiceCompletions.$inferInsert;

export type CourseEnrollment = typeof courseEnrollments.$inferSelect;
export type NewCourseEnrollment = typeof courseEnrollments.$inferInsert;
