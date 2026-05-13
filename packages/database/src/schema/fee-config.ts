/**
 * Fee Configuration Schema (Codex-m644n)
 *
 * Three-tier DB-configurable fee model with audit trail.
 *
 * Tables:
 * - fee_config_platform (singleton row, id='singleton')
 * - fee_config_org (per-org overrides; nullable columns inherit from platform)
 * - fee_config_org_creator (per-creator-per-org overrides; nullable columns inherit from org)
 * - fee_config_audit_log (immutable change history)
 *
 * Fallback chain (consumed by FeeConfigService):
 *   creator-override → org-default → platform-default → FEES.* constants
 *
 * Naming note: The legacy `platform_fee_config` / `organization_platform_agreements`
 * tables (in ecommerce.ts) predate this design and use time-windowed UUID rows.
 * They are dormant (not read in production code) but retained for migration safety.
 * The new tables use the `fee_config_*` namespace to coexist without collision.
 *
 * Cache strategy: Reads are version-cached via @codex/cache VersionedCache.
 * Writers bump the row's `version` column then invalidate the cache key.
 * NO TTL on fee config — data is effectively immutable between writes.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

// ─── Platform-level singleton ────────────────────────────────────────────────

/**
 * Platform-wide default fee configuration (singleton row).
 *
 * Exactly one row with id='singleton'. Enforced by CHECK constraint.
 * All fee percentages are stored as basis points (10000 = 100%, 1000 = 10%).
 *
 * Distinct fee rates for subscription vs one-off purchase paths — the platform
 * keeps a flat % cut, but the org's cut can differ (e.g. 15% on subs, 0% on
 * one-offs as the current Phase 1 setting).
 */
export const feeConfigPlatform = pgTable(
  'fee_config_platform',
  {
    id: text('id').primaryKey().default('singleton'),

    /** Platform's cut as % of gross (basis points). Applied to both paths. */
    platformFeePercent: integer('platform_fee_percent').notNull(),

    /** Org's cut as % of post-platform amount on subscription invoices (bps). */
    subscriptionOrgFeePercent: integer(
      'subscription_org_fee_percent'
    ).notNull(),

    /** Org's cut as % of post-platform amount on one-off purchases (bps). */
    oneOffOrgFeePercent: integer('one_off_org_fee_percent').notNull(),

    /** Minimum platform fee floor (cents). Caller takes max(% of gross, floor). */
    minPlatformFeeCents: integer('min_platform_fee_cents').notNull(),

    /** Minimum transfer threshold (cents). Below this, payouts accumulate. */
    minTransferCents: integer('min_transfer_cents').notNull(),

    /** Version counter bumped on every UPDATE — drives VersionedCache key. */
    version: integer('version').notNull().default(1),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),

    updatedBy: text('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'check_fee_config_platform_singleton',
      sql`${table.id} = 'singleton'`
    ),
    check(
      'check_platform_fee_percent_bps',
      sql`${table.platformFeePercent} >= 0 AND ${table.platformFeePercent} <= 10000`
    ),
    check(
      'check_subscription_org_fee_percent_bps',
      sql`${table.subscriptionOrgFeePercent} >= 0 AND ${table.subscriptionOrgFeePercent} <= 10000`
    ),
    check(
      'check_one_off_org_fee_percent_bps',
      sql`${table.oneOffOrgFeePercent} >= 0 AND ${table.oneOffOrgFeePercent} <= 10000`
    ),
    check(
      'check_min_platform_fee_non_negative',
      sql`${table.minPlatformFeeCents} >= 0`
    ),
    check(
      'check_min_transfer_non_negative',
      sql`${table.minTransferCents} >= 0`
    ),
  ]
);

// ─── Per-org override ───────────────────────────────────────────────────────

/**
 * Per-organization fee override.
 *
 * orgId is the PK — one row per org. All fee columns are nullable; NULL means
 * "inherit from the platform default". A row may exist with all nulls to seed
 * a future override without changing behaviour.
 *
 * `orgFeePercent` is a single column (not split by path) because the design
 * decision (Codex-8qmop Q2) is that one-off and subscription share the same
 * shape at the org-override layer — the platform row carries the path-specific
 * default. The resolver applies orgFeePercent to whichever path is active.
 */
export const feeConfigOrg = pgTable(
  'fee_config_org',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** Override for platform cut (bps) — NULL = inherit from platform default */
    platformFeePercent: integer('platform_fee_percent'),
    /** Override for org cut (bps) — NULL = inherit. Applies to active path. */
    orgFeePercent: integer('org_fee_percent'),
    /** Override for min platform fee floor (cents) — NULL = inherit */
    minPlatformFeeCents: integer('min_platform_fee_cents'),
    /** Override for min transfer threshold (cents) — NULL = inherit */
    minTransferCents: integer('min_transfer_cents'),

    version: integer('version').notNull().default(1),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),

    updatedBy: text('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'check_org_platform_fee_percent_bps',
      sql`${table.platformFeePercent} IS NULL OR (${table.platformFeePercent} >= 0 AND ${table.platformFeePercent} <= 10000)`
    ),
    check(
      'check_org_org_fee_percent_bps',
      sql`${table.orgFeePercent} IS NULL OR (${table.orgFeePercent} >= 0 AND ${table.orgFeePercent} <= 10000)`
    ),
    check(
      'check_org_min_platform_fee_non_negative',
      sql`${table.minPlatformFeeCents} IS NULL OR ${table.minPlatformFeeCents} >= 0`
    ),
    check(
      'check_org_min_transfer_non_negative',
      sql`${table.minTransferCents} IS NULL OR ${table.minTransferCents} >= 0`
    ),
  ]
);

// ─── Per-creator-per-org override ───────────────────────────────────────────

/**
 * Per-creator-per-org fee override (negotiated contracts).
 *
 * Composite PK (organizationId, creatorId). All fee columns nullable for
 * partial overrides — e.g. set only `orgFeePercent` to 0 to give a featured
 * creator a 100% org-cut waiver while leaving platform fee at the default.
 *
 * `notes` captures the negotiation context (free-text), e.g. "white-label
 * deal Q2 2026" or "featured launch partner — revisit 2027-01".
 */
export const feeConfigOrgCreator = pgTable(
  'fee_config_org_creator',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    platformFeePercent: integer('platform_fee_percent'),
    orgFeePercent: integer('org_fee_percent'),
    minPlatformFeeCents: integer('min_platform_fee_cents'),
    minTransferCents: integer('min_transfer_cents'),

    notes: text('notes'),

    version: integer('version').notNull().default(1),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),

    updatedBy: text('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.creatorId],
      name: 'fee_config_org_creator_pkey',
    }),
    index('idx_fee_config_org_creator_org').on(table.organizationId),
    index('idx_fee_config_org_creator_creator').on(table.creatorId),
    check(
      'check_override_platform_fee_percent_bps',
      sql`${table.platformFeePercent} IS NULL OR (${table.platformFeePercent} >= 0 AND ${table.platformFeePercent} <= 10000)`
    ),
    check(
      'check_override_org_fee_percent_bps',
      sql`${table.orgFeePercent} IS NULL OR (${table.orgFeePercent} >= 0 AND ${table.orgFeePercent} <= 10000)`
    ),
    check(
      'check_override_min_platform_fee_non_negative',
      sql`${table.minPlatformFeeCents} IS NULL OR ${table.minPlatformFeeCents} >= 0`
    ),
    check(
      'check_override_min_transfer_non_negative',
      sql`${table.minTransferCents} IS NULL OR ${table.minTransferCents} >= 0`
    ),
  ]
);

// ─── Audit log ──────────────────────────────────────────────────────────────

/**
 * Immutable audit trail of every fee-config change.
 *
 * One row per column-mutation (so an UPDATE that changes 3 columns writes 3
 * rows). `scope` distinguishes which tier was edited; scopeOrgId/scopeCreatorId
 * disambiguate when scope='org' or scope='override'.
 *
 * Values are stored as text so the same table can record any column type
 * without schema churn. Callers stringify before insert.
 */
export const feeConfigAuditLog = pgTable(
  'fee_config_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 'platform' | 'org' | 'override' */
    scope: text('scope').notNull(),

    scopeOrgId: uuid('scope_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    scopeCreatorId: text('scope_creator_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    columnName: text('column_name').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value').notNull(),

    changedBy: text('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_fee_config_audit_scope').on(table.scope, table.changedAt),
    index('idx_fee_config_audit_org').on(table.scopeOrgId),
    index('idx_fee_config_audit_creator').on(table.scopeCreatorId),
    index('idx_fee_config_audit_changed_by').on(table.changedBy),
    check(
      'check_fee_config_audit_scope',
      sql`${table.scope} IN ('platform', 'org', 'override')`
    ),
    check(
      'check_fee_config_audit_scope_org_id',
      sql`(${table.scope} = 'platform' AND ${table.scopeOrgId} IS NULL AND ${table.scopeCreatorId} IS NULL)
        OR (${table.scope} = 'org' AND ${table.scopeOrgId} IS NOT NULL AND ${table.scopeCreatorId} IS NULL)
        OR (${table.scope} = 'override' AND ${table.scopeOrgId} IS NOT NULL AND ${table.scopeCreatorId} IS NOT NULL)`
    ),
  ]
);

// ─── Relations ──────────────────────────────────────────────────────────────

export const feeConfigPlatformRelations = relations(
  feeConfigPlatform,
  ({ one }) => ({
    updatedByUser: one(users, {
      fields: [feeConfigPlatform.updatedBy],
      references: [users.id],
    }),
  })
);

export const feeConfigOrgRelations = relations(feeConfigOrg, ({ one }) => ({
  organization: one(organizations, {
    fields: [feeConfigOrg.organizationId],
    references: [organizations.id],
  }),
  updatedByUser: one(users, {
    fields: [feeConfigOrg.updatedBy],
    references: [users.id],
  }),
}));

export const feeConfigOrgCreatorRelations = relations(
  feeConfigOrgCreator,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [feeConfigOrgCreator.organizationId],
      references: [organizations.id],
    }),
    creator: one(users, {
      fields: [feeConfigOrgCreator.creatorId],
      references: [users.id],
    }),
    updatedByUser: one(users, {
      fields: [feeConfigOrgCreator.updatedBy],
      references: [users.id],
    }),
  })
);

export const feeConfigAuditLogRelations = relations(
  feeConfigAuditLog,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [feeConfigAuditLog.scopeOrgId],
      references: [organizations.id],
    }),
    creator: one(users, {
      fields: [feeConfigAuditLog.scopeCreatorId],
      references: [users.id],
    }),
    changedByUser: one(users, {
      fields: [feeConfigAuditLog.changedBy],
      references: [users.id],
    }),
  })
);

// ─── Type exports ───────────────────────────────────────────────────────────

export type FeeConfigPlatformRow = typeof feeConfigPlatform.$inferSelect;
export type NewFeeConfigPlatformRow = typeof feeConfigPlatform.$inferInsert;

export type FeeConfigOrgRow = typeof feeConfigOrg.$inferSelect;
export type NewFeeConfigOrgRow = typeof feeConfigOrg.$inferInsert;

export type FeeConfigOrgCreatorRow = typeof feeConfigOrgCreator.$inferSelect;
export type NewFeeConfigOrgCreatorRow = typeof feeConfigOrgCreator.$inferInsert;

export type FeeConfigAuditLogRow = typeof feeConfigAuditLog.$inferSelect;
export type NewFeeConfigAuditLogRow = typeof feeConfigAuditLog.$inferInsert;
