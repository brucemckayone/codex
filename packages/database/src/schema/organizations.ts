import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Organizations table
 * Aligned with database-schema.md lines 256-281
 * Phase 1: Basic organization support
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description'),

    // Branding
    logoUrl: text('logo_url'),
    websiteUrl: text('website_url'),

    // The retired payee pin `primary_connect_account_user_id` is still in the
    // database for one release, unread; step 2 drops it (Codex-2hxff.36).

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
    index('idx_organizations_slug').on(table.slug),
    uniqueIndex('idx_unique_org_slug')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);
