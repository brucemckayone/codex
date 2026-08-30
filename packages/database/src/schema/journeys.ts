import type {
  BrandTokenOverrides,
  PageOffer,
  PageSection,
  PageSeo,
  SectionDesign,
} from '@codex/shared-types';
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

    // The page's PRESENTATION of the journey's ways-in (§7 "one course, three
    // ways in") — which paths the sales page shows + their teaser prices in
    // pence, GBP. NOT the source of truth for access or for what a buyer is
    // charged: the authoritative one-off price is `courses.price_cents`, which
    // `updateJourneyOffer` writes in the SAME transaction that writes this bag.
    // Nullable — a page authored before pricing was set has no offer.
    offer: jsonb('offer').$type<PageOffer>(),

    // The page's LOOK — the nine design axes every section on it inherits
    // (`docs/design/journey-sections/02-axis-contract.md` A3). A section's own
    // `PageSection.design` (inside the `sections` jsonb) overrides this PER AXIS;
    // anything neither states falls to `SECTION_DESIGN_DEFAULTS`.
    //
    // NULLABLE, and yet no page should ever hold NULL: the migration that added
    // this column wrote the Candlelit bundle onto every PRE-EXISTING row in the
    // same step (so a published page cannot change appearance the moment a
    // section starts reading the axes), and `createJourney` writes the Signal
    // bundle onto every new one. Nullable is only the migration's transient
    // state plus forward-compat for a row written by an older deployment —
    // `resolveDesign` is total, so a NULL still renders coherently.
    design: jsonb('design').$type<SectionDesign>(),

    // The page's SEO / share metadata — meta title + description (and, later, a
    // share-image ref). The builder's SEO panel writes it; the public sell
    // page's `<svelte:head>` reads it from the AWAITED envelope, never from a
    // streamed promise, because it is SEO-critical.
    //
    // NULLABLE with no backfill, mirroring `offer` (migration 0081): unset is a
    // legitimate and common state — the head then derives its title from
    // `title` and its description from the course lede, exactly as it did before
    // this column existed. So there is no value to write onto existing rows, and
    // an empty `{}` would be indistinguishable from "the creator cleared it".
    seo: jsonb('seo').$type<PageSeo>(),

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

    // Still-image COVER — the base R2 key, NOT a `media_items` ref (Codex-eqh0z).
    // `media_items` is CHECK-constrained to ('video','audio'), so a poster image
    // cannot live there; this reuses the `categories.cover_image_key` convention
    // (`ImageProcessingService.processCourseCover` writes {sm,md,lg}.webp under
    // the key, cards serve `md`). Deterministic per course id ⇒ a re-upload
    // overwrites in place, so replacing a cover never orphans an object.
    coverImageKey: varchar('cover_image_key', { length: 500 }),

    // Still-image HERO — an UPLOADED image, the same shape as `coverImageKey`
    // above and for the same reason (Codex-490z7, contract amendment A32).
    //
    // NOT a `media_items` ref: that table is CHECK-constrained to
    // ('video','audio'), which is the entire reason this gap existed. `heroMediaId`
    // below can only ever name a VIDEO, so the "hero image" a creator picked there
    // was really that video's auto-generated poster frame — a creator who owned a
    // photograph and no film had no way to put it in the loudest section of their
    // own sales page.
    //
    // A32's fallback chain, resolved by `getCourseSellPreview`:
    //   heroImageKey (this) ?? heroMediaId's poster frame ?? the synthetic plate.
    // Uploaded outranks derived — an explicit choice beats a by-product.
    //
    // `ImageProcessingService.processCourseHero` writes {sm,md,lg}.webp under this
    // base key and the hero serves `lg` (it paints full-bleed, where the cover's
    // `md` serves a card). Deterministic per course id ⇒ a re-upload overwrites in
    // place, so replacing a hero never orphans an object.
    heroImageKey: varchar('hero_image_key', { length: 500 }),

    // Still-image SIGNATURE — the guide's sign-off mark, an UPLOADED image
    // (Codex-wqxv4's remaining named-slot half). Third instance of the same
    // shape as `coverImageKey` / `heroImageKey`, and the shape exists because of
    // the same constraint: `media_items` is CHECK-constrained to
    // ('video','audio'), so `signatureMediaId` below can only ever name a VIDEO
    // and the "signature" it resolves is that video's poster frame.
    //
    // A signature is a scan of ink. Nobody films one. So of the three columns
    // that CANNOT be a media ref, this was the one where the media ref was not
    // merely a compromise but useless: `guide.letter` describes signing off with
    // the guide's own mark, and until this column there was no way to put a mark
    // there at all. That is why A27 shipped `signatureMediaId` and the letter
    // still rendered only typeset text.
    //
    // The same ORDERED chain as the hero, resolved by `getCourseSellPreview`:
    //   signatureImageKey (this) ?? signatureMediaId's poster frame ?? nothing
    //     (the letter signs off with the typeset name alone).
    // Uploaded outranks derived, for the reason A32 gives: an explicit choice
    // beats a by-product.
    //
    // `ImageProcessingService.processCourseSignature` writes {sm,md,lg}.webp
    // under this base key and the letter serves `md` — a signature is a small
    // inline mark (~180px in `GuideSection`), so `lg` would be 800px of payload
    // for a 180px slot while `sm` (200px) leaves nothing for a 2x display.
    // Deterministic per course id ⇒ a re-upload overwrites in place, so
    // replacing a signature never orphans an object.
    signatureImageKey: varchar('signature_image_key', { length: 500 }),

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
    // Hero + signature stills (contract amendment A27, Codex-wqxv4). Same shape
    // as the three above — a `media_items` ref, `set null` on delete — because
    // `media_items` is CHECK-constrained to ('video','audio'), so the STILL these
    // two name is the item's `thumbnailKey`, resolved by `getCourseSellPreview`'s
    // `toStill` exactly as `guide.portraitMediaId` already is. Before A27 the
    // page had NO hero image slot at all, so `hero.full-bleed` / `hero.poster`
    // rendered a synthetic gradient plate and the `media` design axis was
    // meaningless on the highest-visibility section of the page.
    heroMediaId: uuid('hero_media_id').references(() => mediaItems.id, {
      onDelete: 'set null',
    }),
    // The guide's signature mark — `guide.letter`'s sign-off.
    signatureMediaId: uuid('signature_media_id').references(
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
