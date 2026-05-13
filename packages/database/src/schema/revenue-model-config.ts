/**
 * Revenue Model Config — singleton-row table
 *
 * Holds the four DB-editable knobs that drive the platform's revenue split
 * model:
 *
 * - platformFeePercent       — platform's cut of gross (basis points)
 * - subscriptionOrgFeePercent — org's cut of post-platform-fee (basis points)
 * - minPlatformFeeCents      — floor applied per-transaction so micro-payments
 *                              still cover gateway costs
 * - minTransferCents         — floor applied when executing transfers to a
 *                              Connect account (skips the transfer if amount
 *                              falls below)
 *
 * Singleton invariant: only ONE row may exist. Enforced by:
 *   1. `id` column defaults to 'singleton' so app-level upserts always target
 *      the same key
 *   2. CHECK constraint `id = 'singleton'` rejects any other id at the DB
 *      layer (defence in depth — covers raw SQL writes)
 *
 * When no row exists (fresh install, before any UPDATE), FeeConfigService
 * falls back to the code-default `FEES.*` constants in `@codex/constants`
 * and logs INFO so first-install ops sees the fallback path.
 *
 * Update via SQL (no admin UI yet):
 *   UPDATE revenue_model_config
 *     SET platform_fee_percent = 1200, updated_by = '<user-id>'
 *     WHERE id = 'singleton';
 *   INSERT INTO revenue_model_config (id, platform_fee_percent, ...)
 *     VALUES ('singleton', ...)
 *     ON CONFLICT (id) DO UPDATE SET ...;
 *
 * Cache: FeeConfigService wraps `getFees()` in VersionedCache with 10min TTL
 * and fire-and-forget invalidation on `updateFees()`.
 */
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const revenueModelConfig = pgTable(
  'revenue_model_config',
  {
    /**
     * Singleton key. Always `'singleton'` — the CHECK constraint below
     * enforces this at the DB layer.
     */
    id: text('id').primaryKey().default('singleton'),

    /** Platform's cut of gross, in basis points (10000 = 100%). */
    platformFeePercent: integer('platform_fee_percent').notNull(),

    /**
     * Org's cut of post-platform-fee revenue for subscriptions, in basis
     * points. Applies only when content is hosted on an org's page —
     * solo-creator pages skip the org fee.
     */
    subscriptionOrgFeePercent: integer(
      'subscription_org_fee_percent'
    ).notNull(),

    /**
     * Floor applied per-transaction so micro-payments still cover gateway
     * costs. If `(amountCents * platformFeePercent) / 10000` is below this
     * value, the floor wins.
     */
    minPlatformFeeCents: integer('min_platform_fee_cents').notNull(),

    /**
     * Floor applied at transfer execution time. Transfers below this
     * threshold are skipped (and either remain pending or are inserted as
     * a new pending row depending on the caller).
     */
    minTransferCents: integer('min_transfer_cents').notNull(),

    /** Updated when the row is written. NULL until first write. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),

    /**
     * FK to the user who performed the update. Required at the service
     * layer (FeeConfigService.updateFees throws when omitted) but kept
     * nullable in DB to allow seeded/initial rows.
     */
    updatedBy: text('updated_by').references(() => users.id),
  },
  (table) => [
    check('check_revenue_model_singleton', sql`${table.id} = 'singleton'`),
    check(
      'check_revenue_model_platform_fee_percent',
      sql`${table.platformFeePercent} >= 0 AND ${table.platformFeePercent} <= 10000`
    ),
    check(
      'check_revenue_model_subscription_org_fee_percent',
      sql`${table.subscriptionOrgFeePercent} >= 0 AND ${table.subscriptionOrgFeePercent} <= 10000`
    ),
    check(
      'check_revenue_model_min_platform_fee_cents',
      sql`${table.minPlatformFeeCents} >= 0`
    ),
    check(
      'check_revenue_model_min_transfer_cents',
      sql`${table.minTransferCents} >= 0`
    ),
  ]
);

export type RevenueModelConfig = typeof revenueModelConfig.$inferSelect;
export type NewRevenueModelConfig = typeof revenueModelConfig.$inferInsert;
