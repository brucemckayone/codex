import type { BrandTokenOverrides, PageSection } from '@codex/shared-types';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content, mediaItems } from './content';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Landing pages & curriculum (Landing-Page-Builder & Guided-Journeys, SPEC §4–§5).
 *
 * A **page** is generic presentation; a **course** is curriculum. A course-type
 * page binds to a course via the polymorphic `subjectType`/`subjectId` pair
 * (validated in the service layer — deliberately NO FK, so a future page type
 * can present a different subject without a schema change; HARDENING §C).
 */

/**
 * Course guide bag — the person presenting the course (SPEC §5 `courses.guide`).
 * Stored inline as jsonb rather than a join because it is 1:1 with the course
 * and never queried independently.
 */
export interface CourseGuide {
  name: string;
  bio?: string;
  portraitMediaId?: string;
  quote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing pages (D1 — SPEC §4 + §4.1)
// ─────────────────────────────────────────────────────────────────────────────

export const landingPages = pgTable(
  'landing_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    // 'course' now; 'retreat' etc. later (D1). Stored as varchar, NOT a CHECK
    // enum, so a future page type needs no migration (forward-compat).
    pageType: varchar('page_type', { length: 30 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(), // unique per org (partial idx, not-deleted)
    title: varchar('title', { length: 500 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    featured: boolean('featured').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),

    // Polymorphic subject — 'course' → the domain object this page presents.
    // Validated in the service layer (no FK; HARDENING §C).
    subjectType: varchar('subject_type', { length: 30 }),
    subjectId: uuid('subject_id'),

    // Per-page brand overrides (D6 — inherit org brand when null) + ordered,
    // typed, toggleable sections (§4.1). Section `type` is a widenable string
    // inside the jsonb, NOT a CHECK enum (forward-compat — WP-0 interp C).
    brandOverrides: jsonb('brand_overrides').$type<BrandTokenOverrides>(),
    sections: jsonb('sections').$type<PageSection[]>().notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_landing_pages_org_id').on(table.organizationId),
    index('idx_landing_pages_creator_id').on(table.creatorId),
    index('idx_landing_pages_subject').on(table.subjectType, table.subjectId),
    index('idx_landing_pages_org_status')
      .on(table.organizationId, table.status, table.publishedAt)
      .where(sql`${table.deletedAt} IS NULL`),

    // Unique slug per org (only among non-deleted pages)
    uniqueIndex('uq_landing_pages_org_slug')
      .on(table.organizationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),

    check(
      'check_landing_page_status',
      sql`${table.status} IN ('draft', 'published', 'archived')`
    ),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Courses & curriculum (SPEC §5)
// ─────────────────────────────────────────────────────────────────────────────

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    slug: varchar('slug', { length: 160 }).notNull(), // unique per org
    title: varchar('title', { length: 500 }).notNull(),
    kicker: varchar('kicker', { length: 255 }),
    lede: text('lede'),

    status: varchar('status', { length: 20 }).notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),

    // { name, bio, portraitMediaId, quote }
    guide: jsonb('guide').$type<CourseGuide>(),

    // Sell media — media-item refs (reuse the transcoding pipeline; §10).
    introVideoMediaId: uuid('intro_video_media_id').references(
      () => mediaItems.id,
      { onDelete: 'set null' }
    ),
    previewVideoMediaId: uuid('preview_video_media_id').references(
      () => mediaItems.id,
      { onDelete: 'set null' }
    ),
    guideVideoMediaId: uuid('guide_video_media_id').references(
      () => mediaItems.id,
      { onDelete: 'set null' }
    ),

    // One-off purchase price in pence (NULL = not sold standalone; §6/§7).
    // The course-specific subscription plan lives in course_subscription_plans.
    priceCents: integer('price_cents'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_courses_org_id').on(table.organizationId),
    index('idx_courses_creator_id').on(table.creatorId),
    index('idx_courses_org_status')
      .on(table.organizationId, table.status, table.publishedAt)
      .where(sql`${table.deletedAt} IS NULL`),

    // Unique slug per org (only among non-deleted courses)
    uniqueIndex('uq_courses_org_slug')
      .on(table.organizationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),

    // Codex-2pryk WP-6: composite-FK target for `course_tier_access`'s N1
    // guarantee (see subscriptions.ts `uq_subscription_tiers_id_org`). `id` is
    // already unique via the PK; this redundant unique on (id, organization_id)
    // is what the composite FK referencing (id, organization_id) requires.
    uniqueIndex('uq_courses_id_org').on(table.id, table.organizationId),

    check(
      'check_course_status',
      sql`${table.status} IN ('draft', 'published', 'archived')`
    ),
    check(
      'check_course_price_non_negative',
      sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`
    ),
  ]
);

/** ORDERED gates, owned by one course (SPEC §5). */
export const courseStages = pgTable(
  'course_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    gloss: text('gloss'),
    sortOrder: integer('sort_order').notNull(), // the gate order

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_course_stages_course_id').on(table.courseId),
    // Unique gate order within a course (only among non-deleted stages)
    uniqueIndex('uq_course_stages_course_sort')
      .on(table.courseId, table.sortOrder)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

/**
 * stage ⋈ content join (the concurrent practice pool of a stage). A practice IS
 * a `content` row. The space guard (content.orgId === course.orgId) is enforced
 * in the service layer via `spaceWhere` (mirrors categories-service; there is NO
 * syncContentCategories helper — HARDENING §5). Hard-delete of the association
 * is intentional (join row, not a domain row — mirrors content_categories).
 */
export const stagePractices = pgTable(
  'stage_practices',
  {
    stageId: uuid('stage_id')
      .notNull()
      .references(() => courseStages.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.stageId, table.contentId] }),
    index('idx_stage_practices_content_id').on(table.contentId),
  ]
);

export const courseTestimonials = pgTable(
  'course_testimonials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    quote: text('quote').notNull(),
    authorName: varchar('author_name', { length: 255 }).notNull(),
    authorContext: varchar('author_context', { length: 255 }),
    avatarMediaId: uuid('avatar_media_id').references(() => mediaItems.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('idx_course_testimonials_course_id').on(table.courseId)]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const landingPagesRelations = relations(landingPages, ({ one }) => ({
  organization: one(organizations, {
    fields: [landingPages.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [landingPages.creatorId],
    references: [users.id],
  }),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [courses.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [courses.creatorId],
    references: [users.id],
  }),
  stages: many(courseStages),
  testimonials: many(courseTestimonials),
}));

export const courseStagesRelations = relations(
  courseStages,
  ({ one, many }) => ({
    course: one(courses, {
      fields: [courseStages.courseId],
      references: [courses.id],
    }),
    practices: many(stagePractices),
  })
);

export const stagePracticesRelations = relations(stagePractices, ({ one }) => ({
  stage: one(courseStages, {
    fields: [stagePractices.stageId],
    references: [courseStages.id],
  }),
  content: one(content, {
    fields: [stagePractices.contentId],
    references: [content.id],
  }),
}));

export const courseTestimonialsRelations = relations(
  courseTestimonials,
  ({ one }) => ({
    course: one(courses, {
      fields: [courseTestimonials.courseId],
      references: [courses.id],
    }),
  })
);

// ─── Type Exports ────────────────────────────────────────────────────────────

export type LandingPage = typeof landingPages.$inferSelect;
export type NewLandingPage = typeof landingPages.$inferInsert;

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;

export type CourseStage = typeof courseStages.$inferSelect;
export type NewCourseStage = typeof courseStages.$inferInsert;

export type StagePractice = typeof stagePractices.$inferSelect;
export type NewStagePractice = typeof stagePractices.$inferInsert;

export type CourseTestimonial = typeof courseTestimonials.$inferSelect;
export type NewCourseTestimonial = typeof courseTestimonials.$inferInsert;
