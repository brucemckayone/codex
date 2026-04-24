/**
 * Users table - Core identity entity
 *
 * This is the foundational user table referenced by all other schemas.
 * Separated from auth.ts to maintain clean identity/auth separation.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Social links type for user profiles
 */
export type SocialLinks = {
  website?: string;
  twitter?: string;
  youtube?: string;
  instagram?: string;
};

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    /** Custom uploaded avatar URL (R2 base path). Falls back to `image` if null. */
    avatarUrl: text('avatar_url'),
    role: text('role').default('customer').notNull(),
    /** Unique username for creator profile URLs (e.g., codex.platform/u/username) */
    username: text('username'),
    /** User biography/bio for creator profile */
    bio: text('bio'),
    /** Social media and website links for creator profile */
    socialLinks: jsonb('social_links').$type<SocialLinks>(),
    /**
     * Unified Stripe Customer ID (Codex-pkqxd epic).
     *
     * One Customer per Codex user, shared across every org they transact with.
     * Nullable: users that have never hit checkout (one-time or subscription)
     * stay NULL until first subscribe — `resolveOrCreateCustomer` (Codex-49gev)
     * will populate it lazily.
     *
     * Partial unique index below guarantees at most one Codex user per Stripe
     * Customer while permitting many NULL rows.
     */
    stripeCustomerId: text('stripe_customer_id'),
    /** Soft delete timestamp - null means account is active */
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_unique_username')
      .on(table.username)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('idx_unique_users_stripe_customer_id')
      .on(table.stripeCustomerId)
      .where(sql`${table.stripeCustomerId} IS NOT NULL`),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
