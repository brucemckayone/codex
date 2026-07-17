import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content } from './content';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Categories (per-space topic taxonomy)
 *
 * Curated topics that power the org landing "Browse by topic" module.
 * Scoping mirrors `content` EXACTLY: an org-owned row sets `organizationId`
 * (personal creator spaces leave it NULL) and every row is owned by a
 * `creatorId`. This supersedes the legacy free-text `content.category`
 * string, which is backfilled into this table and left read-only until a
 * later cleanup drops it.
 *
 * Unlike `content.category`, categories are first-class curated entities:
 * they carry a display icon, a dedicated R2 cover image, and an explicit
 * `sortOrder` for landing-page ordering, and attach to content
 * many-to-many via `content_categories`.
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL organizationId = personal creator space (mirrors `content`).
    // Org rows cascade-delete with their organization (ON DELETE CASCADE,
    // matching `content`): an org-scoped category has no life outside its org.
    // A `set null` here would orphan the row into the creator's personal space
    // and collide with `idx_unique_category_slug_personal` whenever a same-slug
    // personal row already exists (Postgres 23505). Directly-created personal
    // categories still use the NULL-org model.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    // Display
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(), // Unique per resolved space
    description: varchar('description', { length: 500 }),
    icon: varchar('icon', { length: 64 }), // emoji or lucide icon name
    coverImageKey: varchar('cover_image_key', { length: 500 }), // R2 key (sm/md/lg variants like content thumbnails)
    sortOrder: integer('sort_order').default(0).notNull(),

    // Timestamps
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
    // Scoping / listing indexes
    index('idx_categories_org_id').on(table.organizationId, table.deletedAt),
    index('idx_categories_creator_id').on(table.creatorId),

    // Partial unique indexes for slug uniqueness per resolved space (exclude
    // soft-deleted rows). Mirrors `content`'s slug uniqueness pattern: a
    // single (organizationId, creatorId, slug) index would NOT enforce
    // uniqueness on personal rows because Postgres treats the NULL
    // organizationId as distinct, so we split by resolved space.
    // Org rows: unique slug per organization.
    uniqueIndex('idx_unique_category_slug_per_org')
      .on(table.slug, table.organizationId)
      .where(
        sql`${table.organizationId} IS NOT NULL AND ${table.deletedAt} IS NULL`
      ),
    // Personal rows: unique slug per creator (organizationId IS NULL).
    uniqueIndex('idx_unique_category_slug_personal')
      .on(table.slug, table.creatorId)
      .where(
        sql`${table.organizationId} IS NULL AND ${table.deletedAt} IS NULL`
      ),
  ]
);

/**
 * Content ⇄ Category membership (many-to-many join)
 *
 * A content item can belong to N categories; a category holds N items.
 * Both sides cascade on delete — join rows are pure membership edges with
 * no independent lifecycle, so they follow their endpoints. Space scoping
 * is enforced at the service layer (categories and content must share a
 * space), not by the join table itself.
 */
export const contentCategories = pgTable(
  'content_categories',
  {
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.contentId, table.categoryId] }),
    index('idx_content_categories_category_id').on(table.categoryId),
    index('idx_content_categories_content_id').on(table.contentId),
  ]
);

// Relations
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  creator: one(users, {
    fields: [categories.creatorId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [categories.organizationId],
    references: [organizations.id],
  }),
  contentCategories: many(contentCategories),
}));

export const contentCategoriesRelations = relations(
  contentCategories,
  ({ one }) => ({
    content: one(content, {
      fields: [contentCategories.contentId],
      references: [content.id],
    }),
    category: one(categories, {
      fields: [contentCategories.categoryId],
      references: [categories.id],
    }),
  })
);

// Type exports
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type ContentCategory = typeof contentCategories.$inferSelect;
export type NewContentCategory = typeof contentCategories.$inferInsert;
