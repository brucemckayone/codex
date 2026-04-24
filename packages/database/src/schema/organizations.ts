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
     * The canonical Connect account owner for this org. Resolves "which
     * Connect account is the org's?" — previously answered by an arbitrary
     * .limit(1) because the unique constraint on stripe_connect_accounts
     * is (user_id, organization_id), meaning N users per org are allowed
     * to have their own Connect account. When the org has multiple, the
     * one owned by this user is the canonical routing target for tier
     * operations and revenue transfers. NULL means the org has not yet
     * onboarded a Connect account.
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
