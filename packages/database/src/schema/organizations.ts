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
import { users } from './users';

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

    /**
     * The user whose single Connect account settles this org's revenue slice
     * (Codex-69t7c). This is now the SOLE org→account link: resolve it by
     * reading this field, then looking up that user's one account
     * (`stripe_connect_accounts.user_id` is unique). It replaced the former
     * arbitrary `.limit(1)` over `stripe_connect_accounts.organization_id`,
     * which is no longer part of account identity. Set when the org owner
     * onboards Connect; NULL means the org has not onboarded an account yet,
     * so its org-fee slice accrues to `pending_payouts` until one connects.
     */
    primaryConnectAccountUserId: text(
      'primary_connect_account_user_id'
    ).references(() => users.id, { onDelete: 'set null' }),

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
