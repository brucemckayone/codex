import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { courseSubscriptions } from './course-commerce';
import { purchases } from './ecommerce';
import { organizations } from './organizations';
import { subscriptions } from './subscriptions';
import { users } from './users';

/**
 * Payouts — full ledger of every transfer event (paid, pending, failed)
 *
 * Replaces the misnamed `pending_payouts` table (which was actually an
 * exception queue, not a ledger). Every call to `stripe.transfers.create()`
 * inside `executeTransfers` writes a row here — successes with `status='paid'`
 * and a populated `stripe_transfer_id`, failures/deferrals with
 * `status='pending'` or `'failed'` and a reason.
 *
 * `pending_payouts` remains in the schema for one release cycle while data
 * migrates; it receives no new inserts after this PR. See
 * `docs/payments/connect-and-payouts.md` for the full lifecycle.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // organizationId nullable to admit bi-party (creator-direct) payouts —
    // Codex-ne89a unlocks the actual code path, h69cg makes the ledger ready.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    // userId nullable to admit platform_fee rows — the platform isn't a user
    // and there is no "recipient" for the platform's retained slice.
    userId: text('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    purchaseId: uuid('purchase_id').references(() => purchases.id, {
      onDelete: 'set null',
    }),
    // Codex-2pryk WP-6 (HARDENING §H3): course-specific subscriptions are NOT
    // org `subscriptions` rows, so their recurring-invoice payouts cannot hang
    // off `subscriptionId` (which hard-FKs org subscriptions). This third
    // nullable source-FK attributes a course-sub payout to its
    // `course_subscriptions` row. `set null` mirrors the other source refs so
    // deleting the source never destroys the immutable ledger row.
    courseSubscriptionId: uuid('course_subscription_id').references(
      () => courseSubscriptions.id,
      { onDelete: 'set null' }
    ),

    // Stripe correlation
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),
    transferGroup: varchar('transfer_group', { length: 255 }),

    // Money
    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('gbp'),

    // 'platform_fee' | 'organization_fee' | 'creator_payout' | 'creator_payout_to_owner'
    payoutType: varchar('payout_type', { length: 32 }).notNull(),

    // 'paid' | 'pending' | 'failed' | 'reversed' | 'cancelled_by_refund'
    status: varchar('status', { length: 32 }).notNull(),

    // 'purchase' | 'subscription' — denormalized for cheap source filtering on
    // /studio/payouts. Populated by writers at insert time; never derived.
    // Default is for the schema migration backfill (every pre-h69cg row is a
    // subscription pipeline row). All new writers MUST set this explicitly.
    sourceType: varchar('source_type', { length: 16 })
      .notNull()
      .default('subscription'),

    // null for paid, and for a pending row whose transfer is in flight (it is
    // reserved before the transfer, Codex-2hxff.11); one of the
    // failure/deferral reasons otherwise. `no_owner`: the organisation had no
    // owner at the sale's time, so the row has no payee yet.
    reason: varchar('reason', { length: 32 }),

    attemptedAt: timestamp('attempted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_payouts_stripe_transfer_id')
      .on(table.stripeTransferId)
      .where(sql`${table.stripeTransferId} IS NOT NULL`),

    index('idx_payouts_org_created').on(
      table.organizationId,
      table.createdAt.desc()
    ),
    index('idx_payouts_org_status_created').on(
      table.organizationId,
      table.status,
      table.createdAt.desc()
    ),
    index('idx_payouts_pending')
      .on(table.userId, table.organizationId, table.attemptedAt)
      .where(sql`${table.status} = 'pending'`),
    index('idx_payouts_user_org_created').on(
      table.userId,
      table.organizationId,
      table.createdAt.desc()
    ),
    index('idx_payouts_subscription').on(table.subscriptionId),
    index('idx_payouts_purchase').on(table.purchaseId),
    index('idx_payouts_course_subscription').on(table.courseSubscriptionId),
    index('idx_payouts_org_source_created').on(
      table.organizationId,
      table.sourceType,
      table.createdAt.desc()
    ),

    // Codex-g9owu: exactly one platform_fee row per charge. Without this
    // partial unique index, concurrent webhook redeliveries can race past
    // the SELECT pre-check in executeTransfers / writePurchasePayouts and
    // both INSERT — duplicating platform revenue. The check the existing
    // uq_payouts_stripe_transfer_id provides doesn't apply: platform_fee
    // rows have NULL stripeTransferId (no transfer happens; the slice
    // retains on platform balance).
    uniqueIndex('uq_payouts_platform_fee_per_charge')
      .on(table.stripeChargeId)
      .where(sql`${table.payoutType} = 'platform_fee'`),

    // Codex-2hxff.11: exactly one row per slice per charge, for every slice —
    // until this, only platform_fee was unique, so a redelivered webhook added
    // a second pending row and the drains paid both. A writer reserves its row
    // BEFORE transferring (ON CONFLICT DO NOTHING), so a replay finds the row
    // and never transfers again.
    //
    // The organisation's slices are unique per charge WHATEVER the payee: an
    // org has one owner at a sale's time, and a `no_owner` row (no payee yet)
    // that support later hands to a new owner must still block a replay that
    // would add the slice again (Codex-2hxff.37).
    uniqueIndex('uq_payouts_org_slice_per_charge')
      .on(table.stripeChargeId, table.payoutType)
      .where(
        sql`${table.stripeChargeId} IS NOT NULL AND ${table.payoutType} IN ('organization_fee', 'creator_payout_to_owner')`
      ),
    // A subscription invoice pays several creators; each has one slice.
    uniqueIndex('uq_payouts_creator_slice_per_charge')
      .on(table.stripeChargeId, table.userId)
      .where(
        sql`${table.stripeChargeId} IS NOT NULL AND ${table.payoutType} = 'creator_payout'`
      ),
    // The drains read pending AND failed rows (Codex-2hxff.11). A partial
    // index is usable only when the query's WHERE implies its predicate, and
    // `status = 'pending' OR (status = 'failed' AND …)` implies this IN list
    // but neither single-status index.
    index('idx_payouts_unresolved')
      .on(table.userId, table.organizationId, table.attemptedAt)
      .where(sql`${table.status} IN ('pending', 'failed')`),

    check('check_payouts_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'check_payouts_status',
      sql`${table.status} IN ('paid', 'pending', 'failed', 'reversed', 'cancelled_by_refund')`
    ),
    check(
      'check_payouts_reason',
      sql`${table.reason} IS NULL OR ${table.reason} IN ('connect_not_ready', 'connect_restricted', 'transfer_failed', 'min_transfer_floor', 'no_owner')`
    ),
    check(
      'check_payouts_type',
      sql`${table.payoutType} IN ('platform_fee', 'organization_fee', 'creator_payout', 'creator_payout_to_owner')`
    ),
    check(
      'check_payouts_source',
      sql`${table.sourceType} IN ('purchase', 'subscription')`
    ),
    // Codex-2pryk WP-6 (HARDENING §H3 "CHECK-one"): a ledger row attributes to
    // AT MOST ONE money source — an org subscription, a one-off purchase, or a
    // course subscription. (Not exactly-one: platform_fee rows and legacy rows
    // may reference none.) Prevents a single payout being double-attributed
    // across the reporting source filters.
    check(
      'check_payouts_source_ref_one',
      sql`(CASE WHEN ${table.subscriptionId} IS NULL THEN 0 ELSE 1 END) + (CASE WHEN ${table.purchaseId} IS NULL THEN 0 ELSE 1 END) + (CASE WHEN ${table.courseSubscriptionId} IS NULL THEN 0 ELSE 1 END) <= 1`
    ),
    // platform_fee rows may have a null user_id (platform isn't a user);
    // every other row type must name its recipient — except the
    // organisation's money while the organisation has no owner: it is held
    // pending as `no_owner` and handed to the next owner support assigns
    // (owner decision 2026-10-18, Codex-2hxff.37). It can never be paid
    // without a payee: only a pending row may lack one — or one a refund
    // cancelled, which nothing ever pays.
    //
    // COALESCE: with `reason` NULL, `reason = 'no_owner'` is NULL, and a
    // CHECK that evaluates to NULL PASSES. Without it a payee-less org slice
    // with no reason would be admitted.
    check(
      'check_payouts_user_required',
      sql`(${table.payoutType} = 'platform_fee') OR (${table.userId} IS NOT NULL) OR (COALESCE(${table.reason} = 'no_owner', false) AND ${table.status} IN ('pending', 'cancelled_by_refund') AND ${table.payoutType} IN ('organization_fee', 'creator_payout_to_owner'))`
    ),
    // Invariant: a paid row must carry EITHER a stripe_transfer_id (subscription
    // pipeline + secondary org-fee transfer) OR a stripe_charge_id (destination-
    // charged creator-payouts + platform_fee rows that retain into the platform
    // balance). At least one Stripe identifier must prove the money moved.
    check(
      'check_payouts_paid_invariant',
      sql`(${table.status} NOT IN ('paid', 'reversed')) OR ((${table.stripeTransferId} IS NOT NULL OR ${table.stripeChargeId} IS NOT NULL) AND ${table.resolvedAt} IS NOT NULL)`
    ),
  ]
);

export const payoutsRelations = relations(payouts, ({ one }) => ({
  user: one(users, {
    fields: [payouts.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [payouts.organizationId],
    references: [organizations.id],
  }),
  subscription: one(subscriptions, {
    fields: [payouts.subscriptionId],
    references: [subscriptions.id],
  }),
  purchase: one(purchases, {
    fields: [payouts.purchaseId],
    references: [purchases.id],
  }),
  courseSubscription: one(courseSubscriptions, {
    fields: [payouts.courseSubscriptionId],
    references: [courseSubscriptions.id],
  }),
}));

export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;

export type PayoutStatus =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'reversed'
  | 'cancelled_by_refund';
export type PayoutReason =
  | 'connect_not_ready'
  | 'connect_restricted'
  | 'transfer_failed'
  | 'min_transfer_floor'
  | 'no_owner';
export type PayoutType =
  | 'platform_fee'
  | 'organization_fee'
  | 'creator_payout'
  | 'creator_payout_to_owner';
export type PayoutSourceType = 'purchase' | 'subscription';
