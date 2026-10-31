/**
 * Fee changes, dated fee versions and the notices a rise waits for
 * (Codex-2hxff.33; batch C1 Part B data design §1.2).
 *
 * A fee change is stored once and never edited:
 * - `fee_changes`: one row per announcement, at one level (the platform, an
 *   organisation, or a creator in an organisation). A cut is dated at once; a
 *   rise waits (`effective_from` NULL) until everyone it affects is told, and
 *   is then dated the first UK midnight at least 30 days after the last of
 *   them (owner decisions F1-F9, 2026-10-29).
 * - `fee_config_versions`: the level's full values from that change onwards.
 *   A change has one live version; a smaller rise replaces it under the SAME
 *   change, so the change keeps its list and its clock (F2).
 * - `fee_change_notices`: one row per person per change per kind of email,
 *   with daily retries (F4). The 30 days start only once every `on_list`
 *   notice is `sent` or `told_another_way`.
 *
 * These replace `fee_config_platform`, `fee_config_org` and
 * `fee_config_org_creator` as the source of truth. Those three are still
 * written, with the values in force NOW (never a waiting rise), so code
 * rolled back to before 0123 reads the right fee (§6.1 Migrate). A removal is
 * a version with `removed = true`; nothing here is ever deleted.
 *
 * The resolver (`resolveFeesAt`, `@codex/payments`) reads each level's dated,
 * not voided, live versions and takes the newest with `effective_from <= at`.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

/** The level a change is made at. */
export type FeeChangeScope = 'platform' | 'org' | 'creator';
export type FeeChangeKind = 'cut' | 'rise';
export type FeeChangeVoidReason =
  | 'cancelled'
  | 'cut_below_today'
  | 'replaced_by_bigger';

/** One role a person is told about a change in (it feeds the email's lines). */
export interface FeeNoticeRole {
  /** Null for a creator's own sales with no organisation. */
  organizationId: string | null;
  as: 'creator' | 'owner';
}

/** A person's resolved fees in one role, for both kinds of sale. */
export interface FeeNoticeRoleValues extends FeeNoticeRole {
  oneOff: FeeNoticeValues;
  subscription: FeeNoticeValues;
}

export interface FeeNoticeValues {
  platformFeePercent: number;
  orgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
}

export type FeeNoticeKind = 'announce' | 'smaller' | 'cancelled';
export type FeeNoticeState =
  | 'due'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'told_another_way'
  | 'not_needed';
/** The same classes as `sendPriceChangeNotice` (`pending-price-change.ts`). */
export type FeeNoticeReason = 'refused' | 'skipped' | 'no_address' | 'unknown';

// ─── Changes ─────────────────────────────────────────────────────────────────

export const feeChanges = pgTable(
  'fee_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'platform' | 'org' | 'creator' */
    scope: text('scope').$type<FeeChangeScope>().notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    creatorId: text('creator_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    /** 'cut' | 'rise' */
    kind: text('kind').$type<FeeChangeKind>().notNull(),
    /**
     * When the change applies. Set at once for a cut. NULL while a rise waits
     * for its emails; set by the daily run, or by support's "told another
     * way" for the last person on the list.
     */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    /** When the daily run made the list. NULL until then. */
    firstRunAt: timestamp('first_run_at', { withTimezone: true }),
    /** The size of that list. */
    listedCount: integer('listed_count'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason').$type<FeeChangeVoidReason>(),
    /** The waiting rise this one replaced (F2, a bigger rise). */
    replacesChangeId: uuid('replaces_change_id'),
    /** NULL only on the 0123 backfill, for a row whose author was deleted. */
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.replacesChangeId],
      foreignColumns: [table.id],
      name: 'fk_fee_changes_replaces',
    }).onDelete('set null'),
    // The parent key of fee_config_versions' (change_id, scope) FK.
    uniqueIndex('uq_fee_changes_id_scope').on(table.id, table.scope),
    // One WAITING rise per level. A dated rise that hasn't started is kept
    // unique by the classifying write, which locks the level first: a
    // partial index can't say "not started yet", and a dated rise that has
    // started must not block the next one. COALESCE so the platform level's
    // NULL keys collide.
    uniqueIndex('uq_fee_changes_one_waiting_rise')
      .on(
        table.scope,
        sql`COALESCE(${table.organizationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${table.creatorId}, '')`
      )
      .where(
        sql`${table.kind} = 'rise' AND ${table.voidedAt} IS NULL AND ${table.effectiveFrom} IS NULL`
      ),
    // The resolver's and the write's read of one level.
    index('idx_fee_changes_level').on(
      table.scope,
      table.organizationId,
      table.creatorId
    ),
    // The daily run's waiting rises.
    index('idx_fee_changes_waiting')
      .on(table.createdAt)
      .where(
        sql`${table.kind} = 'rise' AND ${table.voidedAt} IS NULL AND ${table.effectiveFrom} IS NULL`
      ),
    check(
      'check_fee_changes_scope',
      sql`${table.scope} IN ('platform', 'org', 'creator')`
    ),
    check(
      'check_fee_changes_scope_keys',
      sql`(${table.scope} = 'platform' AND ${table.organizationId} IS NULL AND ${table.creatorId} IS NULL)
        OR (${table.scope} = 'org' AND ${table.organizationId} IS NOT NULL AND ${table.creatorId} IS NULL)
        OR (${table.scope} = 'creator' AND ${table.organizationId} IS NOT NULL AND ${table.creatorId} IS NOT NULL)`
    ),
    check('check_fee_changes_kind', sql`${table.kind} IN ('cut', 'rise')`),
    check(
      'check_fee_changes_cut_dated',
      sql`${table.kind} <> 'cut' OR ${table.effectiveFrom} IS NOT NULL`
    ),
    check(
      'check_fee_changes_listed_pair',
      sql`(${table.firstRunAt} IS NULL) = (${table.listedCount} IS NULL) AND (${table.firstRunAt} IS NULL OR ${table.kind} = 'rise')`
    ),
    check(
      'check_fee_changes_void_pair',
      sql`(${table.voidedAt} IS NULL) = (${table.voidReason} IS NULL)`
    ),
    check(
      'check_fee_changes_void_reason',
      sql`${table.voidReason} IS NULL OR ${table.voidReason} IN ('cancelled', 'cut_below_today', 'replaced_by_bigger')`
    ),
  ]
);

// ─── Versions ────────────────────────────────────────────────────────────────

export const feeConfigVersions = pgTable(
  'fee_config_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeId: uuid('change_id').notNull(),
    /** The change's scope, repeated so a CHECK can hold the platform shape. */
    scope: text('scope').$type<FeeChangeScope>().notNull(),

    /** Basis points. NULL inherits the level above (never on the platform). */
    platformFeePercent: integer('platform_fee_percent'),
    /** Platform scope only: the organisation fee on one-off sales. */
    oneOffOrgFeePercent: integer('one_off_org_fee_percent'),
    /** Platform scope only: the organisation fee on subscriptions. */
    subscriptionOrgFeePercent: integer('subscription_org_fee_percent'),
    /** Organisation and creator scopes: one fee replacing both above. */
    orgFeePercent: integer('org_fee_percent'),
    minPlatformFeeCents: integer('min_platform_fee_cents'),
    minTransferCents: integer('min_transfer_cents'),
    /** Creator scope only. */
    notes: text('notes'),
    /**
     * "Remove this organisation's values" / "remove the override": every
     * value inherits. Nothing is deleted.
     */
    removed: boolean('removed').notNull().default(false),
    /** A smaller rise replaced this version under the same change (F2). */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.changeId, table.scope],
      foreignColumns: [feeChanges.id, feeChanges.scope],
      name: 'fk_fee_config_versions_change_scope',
    }).onDelete('cascade'),
    uniqueIndex('uq_fee_config_versions_live')
      .on(table.changeId)
      .where(sql`${table.supersededAt} IS NULL`),
    check(
      'check_fee_config_versions_scope',
      sql`${table.scope} IN ('platform', 'org', 'creator')`
    ),
    check(
      'check_fee_config_versions_platform_shape',
      sql`${table.scope} <> 'platform' OR (${table.platformFeePercent} IS NOT NULL AND ${table.oneOffOrgFeePercent} IS NOT NULL AND ${table.subscriptionOrgFeePercent} IS NOT NULL AND ${table.minPlatformFeeCents} IS NOT NULL AND ${table.minTransferCents} IS NOT NULL AND ${table.orgFeePercent} IS NULL AND NOT ${table.removed})`
    ),
    check(
      'check_fee_config_versions_level_shape',
      sql`${table.scope} = 'platform' OR (${table.oneOffOrgFeePercent} IS NULL AND ${table.subscriptionOrgFeePercent} IS NULL)`
    ),
    check(
      'check_fee_config_versions_notes_creator',
      sql`${table.notes} IS NULL OR ${table.scope} = 'creator'`
    ),
    check(
      'check_fee_config_versions_removed_empty',
      sql`NOT ${table.removed} OR (${table.platformFeePercent} IS NULL AND ${table.orgFeePercent} IS NULL AND ${table.minPlatformFeeCents} IS NULL AND ${table.minTransferCents} IS NULL AND ${table.notes} IS NULL)`
    ),
    check(
      'check_fee_config_versions_bps',
      sql`(${table.platformFeePercent} IS NULL OR ${table.platformFeePercent} BETWEEN 0 AND 10000)
        AND (${table.oneOffOrgFeePercent} IS NULL OR ${table.oneOffOrgFeePercent} BETWEEN 0 AND 10000)
        AND (${table.subscriptionOrgFeePercent} IS NULL OR ${table.subscriptionOrgFeePercent} BETWEEN 0 AND 10000)
        AND (${table.orgFeePercent} IS NULL OR ${table.orgFeePercent} BETWEEN 0 AND 10000)`
    ),
    check(
      'check_fee_config_versions_cents',
      sql`(${table.minPlatformFeeCents} IS NULL OR ${table.minPlatformFeeCents} >= 0)
        AND (${table.minTransferCents} IS NULL OR ${table.minTransferCents} >= 0)`
    ),
  ]
);

// ─── Notices ─────────────────────────────────────────────────────────────────

export const feeChangeNotices = pgTable(
  'fee_change_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeId: uuid('change_id')
      .notNull()
      .references(() => feeChanges.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'announce' | 'smaller' | 'cancelled' */
    kind: text('kind').$type<FeeNoticeKind>().notNull(),
    /**
     * Found on the change's first run, so this person holds the date. False
     * for a joiner (F8), who gets the same date and holds nothing.
     */
    onList: boolean('on_list').notNull(),
    roles: jsonb('roles').$type<FeeNoticeRole[]>().notNull(),
    /** The person's resolved fees before and after, per role, as told. */
    beforeValues: jsonb('before_values')
      .$type<FeeNoticeRoleValues[]>()
      .notNull(),
    afterValues: jsonb('after_values').$type<FeeNoticeRoleValues[]>().notNull(),
    /** The London date their email named (the earliest it can be, Q1). */
    quotedFrom: date('quoted_from', { mode: 'string' }),
    state: text('state').$type<FeeNoticeState>().notNull().default('due'),
    lastReason: text('last_reason').$type<FeeNoticeReason>(),
    attempts: integer('attempts').notNull().default(0),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Joins the alert's log line, as `payee_credits.alert_error_id` does. */
    alertErrorId: uuid('alert_error_id'),
    toldNote: text('told_note'),
    toldByUserId: text('told_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    toldAt: timestamp('told_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_fee_change_notices_person').on(
      table.changeId,
      table.userId,
      table.kind
    ),
    // The daily run's claim.
    index('idx_fee_change_notices_open')
      .on(table.state, table.createdAt)
      .where(sql`${table.state} IN ('due', 'failed', 'unknown')`),
    // Studio's read of the caller's own notices.
    index('idx_fee_change_notices_user').on(table.userId),
    index('idx_fee_change_notices_change').on(table.changeId, table.state),
    check(
      'check_fee_change_notices_kind',
      sql`${table.kind} IN ('announce', 'smaller', 'cancelled')`
    ),
    check(
      'check_fee_change_notices_state',
      sql`${table.state} IN ('due', 'sent', 'failed', 'unknown', 'told_another_way', 'not_needed')`
    ),
    check(
      'check_fee_change_notices_reason',
      sql`${table.lastReason} IS NULL OR ${table.lastReason} IN ('refused', 'skipped', 'no_address', 'unknown')`
    ),
    check('check_fee_change_notices_attempts', sql`${table.attempts} >= 0`),
    // `state` is NOT NULL, so `state <> …` never yields NULL: these never
    // pass on a NULL (the refund_reviews style).
    check(
      'check_fee_change_notices_sent',
      sql`${table.state} <> 'sent' OR ${table.acceptedAt} IS NOT NULL`
    ),
    check(
      'check_fee_change_notices_told',
      sql`${table.state} <> 'told_another_way' OR (${table.toldNote} IS NOT NULL AND ${table.toldByUserId} IS NOT NULL AND ${table.toldAt} IS NOT NULL)`
    ),
  ]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const feeChangesRelations = relations(feeChanges, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [feeChanges.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [feeChanges.creatorId],
    references: [users.id],
  }),
  versions: many(feeConfigVersions),
  notices: many(feeChangeNotices),
}));

export const feeConfigVersionsRelations = relations(
  feeConfigVersions,
  ({ one }) => ({
    change: one(feeChanges, {
      fields: [feeConfigVersions.changeId],
      references: [feeChanges.id],
    }),
  })
);

export const feeChangeNoticesRelations = relations(
  feeChangeNotices,
  ({ one }) => ({
    change: one(feeChanges, {
      fields: [feeChangeNotices.changeId],
      references: [feeChanges.id],
    }),
    user: one(users, {
      fields: [feeChangeNotices.userId],
      references: [users.id],
    }),
  })
);

// ─── Type exports ────────────────────────────────────────────────────────────

export type FeeChangeRow = typeof feeChanges.$inferSelect;
export type NewFeeChangeRow = typeof feeChanges.$inferInsert;
export type FeeConfigVersionRow = typeof feeConfigVersions.$inferSelect;
export type NewFeeConfigVersionRow = typeof feeConfigVersions.$inferInsert;
export type FeeChangeNoticeRow = typeof feeChangeNotices.$inferSelect;
export type NewFeeChangeNoticeRow = typeof feeChangeNotices.$inferInsert;
