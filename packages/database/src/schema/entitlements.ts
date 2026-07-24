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
import { organizations } from './organizations';
import { users } from './users';

/**
 * Entitlements — the granted-right record (D2 · SPEC §6.2).
 *
 * The greenfield access core. A single resolver (@codex/access, WP-2) unions
 * these STORED grants with DERIVED tier-subscription grants into "the set of
 * resources user U may access".
 *
 * **Split-FK, not a bare polymorphic `resourceId`.** The SPEC §6.2 sketch stored
 * one `resourceId uuid` + a `resourceType` discriminator; this table instead
 * carries two real, nullable FKs (`contentId` / `courseId`) with a CHECK that
 * EXACTLY ONE is set. Rationale: real foreign keys give referential integrity
 * (a deleted course/content cascades its grants) that a bare uuid cannot, and
 * the resolver still maps `(contentId ?? courseId)` back to the frozen
 * {@link import('@codex/shared-types').Entitlement} `{ resourceType, resourceId }`
 * domain shape, so the WP-0 contract is preserved at the domain boundary.
 *
 * `userId` is TEXT (users.id is `text('id')`, not uuid — [H]).
 *
 * `source` is constrained to {@link import('@codex/shared-types').StoredEntitlementSource}
 * values ONLY. `'tier_subscription'` is RESOLVER-OUTPUT-ONLY (tier access is
 * derived live from the user's active subscription + tier→resource mappings,
 * never materialised — so tier changes take effect instantly and can't strand a
 * stale grant; §6.2 [H]). It is deliberately OMITTED from the CHECK below.
 *
 * Revocation is the domain soft-delete here (`revokedAt`), matching the frozen
 * contract — there is no separate `deletedAt`.
 */
export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Split-FK resource target — EXACTLY ONE is non-null (CHECK below).
    contentId: uuid('content_id').references(() => content.id, {
      onDelete: 'cascade',
    }),
    courseId: uuid('course_id').references(() => courses.id, {
      onDelete: 'cascade',
    }),

    // StoredEntitlementSource ONLY — 'tier_subscription' is derived, never inserted.
    source: varchar('source', { length: 30 }).notNull(),
    // purchase id / subscription id / course_subscription id (audit ref).
    sourceRef: uuid('source_ref'),

    grantedAt: timestamp('granted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_entitlements_user_id').on(table.userId),
    index('idx_entitlements_org_id').on(table.organizationId),
    index('idx_entitlements_content_id').on(table.contentId),
    index('idx_entitlements_course_id').on(table.courseId),
    // Fast "does user U hold a live grant on resource R?" lookups (resolver hot path).
    index('idx_entitlements_user_content').on(table.userId, table.contentId),
    index('idx_entitlements_user_course').on(table.userId, table.courseId),

    // Idempotency of the WP-6 grant-write path (webhook redelivery / concurrent
    // completion). At most one LIVE (`revokedAt IS NULL`) grant per
    // (user, resource, source): the writers INSERT ... ON CONFLICT DO NOTHING,
    // so a Stripe replay is a no-op and never duplicates a grant. Scoped to
    // `revokedAt IS NULL` so a lawful re-purchase / re-subscribe AFTER
    // revocation still inserts a fresh row (the revoked row persists for audit).
    // Partial on the non-null resource FK so the split-FK CHECK stays honoured.
    uniqueIndex('uq_entitlement_live_content')
      .on(table.userId, table.contentId, table.source)
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.contentId} IS NOT NULL`
      ),
    uniqueIndex('uq_entitlement_live_course')
      .on(table.userId, table.courseId, table.source)
      .where(sql`${table.revokedAt} IS NULL AND ${table.courseId} IS NOT NULL`),

    // Exactly one resource target is set (split-FK polymorphism).
    check(
      'check_entitlement_resource_one',
      sql`(CASE WHEN ${table.contentId} IS NULL THEN 0 ELSE 1 END) + (CASE WHEN ${table.courseId} IS NULL THEN 0 ELSE 1 END) = 1`
    ),
    // Stored sources only — omits the resolver-derived 'tier_subscription' (§6.2 [H]).
    check(
      'check_entitlement_source',
      sql`${table.source} IN ('content_purchase', 'course_purchase', 'course_subscription', 'grant')`
    ),
  ]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const entitlementsRelations = relations(entitlements, ({ one }) => ({
  user: one(users, {
    fields: [entitlements.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [entitlements.organizationId],
    references: [organizations.id],
  }),
  content: one(content, {
    fields: [entitlements.contentId],
    references: [content.id],
  }),
  course: one(courses, {
    fields: [entitlements.courseId],
    references: [courses.id],
  }),
}));

// ─── Type Exports ────────────────────────────────────────────────────────────

export type EntitlementRow = typeof entitlements.$inferSelect;
export type NewEntitlementRow = typeof entitlements.$inferInsert;
