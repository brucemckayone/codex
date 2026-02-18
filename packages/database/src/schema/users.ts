/**
 * Users table - Core identity entity
 *
 * This is the foundational user table referenced by all other schemas.
 * Separated from auth.ts to maintain clean identity/auth separation.
 */
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Social links type for user profiles
 */
export type SocialLinks = {
  website?: string;
  twitter?: string;
  youtube?: string;
  instagram?: string;
};

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  /** Custom uploaded avatar URL (R2 base path). Falls back to `image` if null. */
  avatarUrl: text('avatar_url'),
  role: text('role').default('customer').notNull(),
  /** Unique username for creator profile URLs (e.g., codex.platform/u/username) */
  username: text('username').unique(),
  /** User biography/bio for creator profile */
  bio: text('bio'),
  /** Social media and website links for creator profile */
  socialLinks: jsonb('social_links').$type<SocialLinks>(),
  /** Soft delete timestamp - null means account is active */
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
