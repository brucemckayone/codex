import { relations } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Organization Followers
 *
 * Tracks free audience relationships — users who opt-in to follow an org.
 * Separate from organizationMemberships (team roles: owner/admin/creator).
 *
 * Hierarchy: public < followers < subscribers (paid) < team
 *
 * - Following is a free, explicit opt-in (follow button on org page)
 * - Subscribers auto-follow on subscription creation (idempotent)
 * - Follower persists after subscription cancellation (must explicitly unfollow)
 * - Used for content gating: accessType='followers' requires a row here,
 *   an active subscription, or a management membership
 */
export const organizationFollowers = pgTable(
  'organization_followers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_unique_org_follower').on(
      table.organizationId,
      table.userId
    ),
    index('idx_org_followers_org').on(table.organizationId),
    index('idx_org_followers_user').on(table.userId),
  ]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const organizationFollowersRelations = relations(
  organizationFollowers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationFollowers.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationFollowers.userId],
      references: [users.id],
    }),
  })
);
