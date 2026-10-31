/**
 * Price moves: who still has to be told about a new price, and where each
 * person stands (Codex-2hxff.85, .86). Design: batch C1 Part B data design §2.
 *
 * A Studio save that changes a tier's or a course plan's price writes one
 * `price_changes` row per interval that changed, and one
 * `subscription_price_moves` row per subscriber, in the save's own
 * transaction. ecom-api's hourly step then works the rows: notice first, then
 * the Stripe write, each person's 30 days counted from their own accepted
 * email. The record, not the log, is the source of truth: support reads held
 * people from here (Admin → Queue → Price moves), and Studio's progress note
 * counts the rows by state.
 *
 * `price_changes.state`:
 * - `running`: rows are still `due` or `notified`;
 * - `done`: none are (held rows don't keep a change running);
 * - `stopped`: every notice in the first batch was refused with a 4xx, so
 *   nobody moved. Support presses Restart (`restart_requested_*`); the run
 *   restarts a stopped change whose `restart_requested_at` is after its
 *   `stopped_at`, and a later stop writes new `stopped_*`;
 * - `superseded`: a newer price for the same tier and interval replaced it
 *   ("latest wins").
 *
 * `subscription_price_moves.state`:
 * - `due`: to be told (`next_attempt_at` null or past);
 * - `notified`: told, the Stripe write still to land (retried with no second
 *   email);
 * - `scheduled`: told and written (`scheduled_kind` now | pending);
 * - `unchanged`: already on the new price;
 * - `skipped`: not moved, for `skip_reason`;
 * - `held`: three tries failed, for `held_reason`; support's Queue lists it;
 * - `superseded`: its change was replaced before it moved.
 *
 * A `held` row that support retries goes back to `due` or `notified` and keeps
 * its `held_reason`, so the Queue can show "Queued for 11:00".
 *
 * Every CHECK below is written so that it never evaluates to NULL (a CHECK
 * PASSES on NULL): `IS NULL` arms or boolean comparisons of `IS NULL`.
 */

import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import {
  courseSubscriptionPlans,
  courseSubscriptions,
} from './course-commerce';
import { organizations } from './organizations';
import { subscriptions, subscriptionTiers } from './subscriptions';
import { users } from './users';

export const priceChanges = pgTable(
  'price_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    tierId: uuid('tier_id').references(() => subscriptionTiers.id, {
      onDelete: 'restrict',
    }),
    courseSubscriptionPlanId: uuid('course_subscription_plan_id').references(
      () => courseSubscriptionPlans.id,
      { onDelete: 'restrict' }
    ),
    interval: varchar('interval', { length: 10 }).notNull(),

    fromAmountCents: integer('from_amount_cents').notNull(),
    newAmountCents: integer('new_amount_cents').notNull(),
    newStripePriceId: varchar('new_stripe_price_id', { length: 255 }).notNull(),

    state: varchar('state', { length: 16 }).notNull().default('running'),
    stoppedReason: varchar('stopped_reason', { length: 64 }),
    stoppedErrorId: varchar('stopped_error_id', { length: 64 }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    restartRequestedAt: timestamp('restart_requested_at', {
      withTimezone: true,
    }),
    restartRequestedByUserId: text('restart_requested_by_user_id').references(
      () => users.id,
      { onDelete: 'restrict' }
    ),
    supersededById: uuid('superseded_by_id').references(
      (): AnyPgColumn => priceChanges.id,
      { onDelete: 'restrict' }
    ),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    /** Rows written for the change, including any Keep current plan adds. */
    totalCount: integer('total_count').notNull().default(0),
    /** The owner who saved the price; null when the system wrote it (Keep). */
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (table) => [
    // One live change per tier and interval, and per plan and interval:
    // a newer save supersedes the old one in the same transaction.
    uniqueIndex('uq_price_changes_live_tier')
      .on(table.tierId, table.interval)
      .where(
        sql`${table.tierId} IS NOT NULL AND ${table.state} IN ('running', 'stopped')`
      ),
    uniqueIndex('uq_price_changes_live_plan')
      .on(table.courseSubscriptionPlanId, table.interval)
      .where(
        sql`${table.courseSubscriptionPlanId} IS NOT NULL AND ${table.state} IN ('running', 'stopped')`
      ),
    index('idx_price_changes_tier').on(table.tierId, table.createdAt),
    index('idx_price_changes_plan').on(
      table.courseSubscriptionPlanId,
      table.createdAt
    ),

    check(
      'check_price_changes_kind',
      sql`(${table.kind} = 'tier' AND ${table.tierId} IS NOT NULL AND ${table.courseSubscriptionPlanId} IS NULL) OR (${table.kind} = 'course_plan' AND ${table.courseSubscriptionPlanId} IS NOT NULL AND ${table.tierId} IS NULL)`
    ),
    check(
      'check_price_changes_interval',
      sql`${table.interval} IN ('month', 'year')`
    ),
    check(
      'check_price_changes_amounts',
      sql`${table.fromAmountCents} >= 0 AND ${table.newAmountCents} >= 0`
    ),
    check(
      'check_price_changes_state',
      sql`${table.state} IN ('running', 'done', 'stopped', 'superseded')`
    ),
    check(
      'check_price_changes_stopped_set',
      sql`(${table.stoppedAt} IS NULL) = (${table.stoppedReason} IS NULL) AND (${table.stoppedAt} IS NULL) = (${table.stoppedErrorId} IS NULL) AND (${table.state} <> 'stopped' OR ${table.stoppedAt} IS NOT NULL)`
    ),
    check(
      'check_price_changes_restart_pair',
      sql`(${table.restartRequestedAt} IS NULL) = (${table.restartRequestedByUserId} IS NULL)`
    ),
    check(
      'check_price_changes_superseded_set',
      sql`(${table.supersededAt} IS NULL) = (${table.supersededById} IS NULL) AND (${table.state} = 'superseded') = (${table.supersededAt} IS NOT NULL)`
    ),
    check(
      'check_price_changes_done',
      sql`${table.state} <> 'done' OR ${table.doneAt} IS NOT NULL`
    ),
  ]
);

export const subscriptionPriceMoves = pgTable(
  'subscription_price_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    priceChangeId: uuid('price_change_id')
      .notNull()
      .references(() => priceChanges.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'restrict',
    }),
    courseSubscriptionId: uuid('course_subscription_id').references(
      () => courseSubscriptions.id,
      { onDelete: 'restrict' }
    ),
    stripeSubscriptionId: varchar('stripe_subscription_id', {
      length: 255,
    }).notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    state: varchar('state', { length: 16 }).notNull().default('due'),
    scheduledKind: varchar('scheduled_kind', { length: 16 }),
    skipReason: varchar('skip_reason', { length: 32 }),
    heldReason: varchar('held_reason', { length: 32 }),

    /** Their own accepted email, and the date it named. */
    noticeAt: timestamp('notice_at', { withTimezone: true }),
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    /**
     * For someone waiting to move TO this tier (.16): `pending_tier_from` + 1 s.
     * Their earliest date is max(noticeAt + 30 days, floor_from).
     */
    floorFrom: timestamp('floor_from', { withTimezone: true }),
    source: varchar('source', { length: 24 }).notNull().default('price_change'),

    attempts: integer('attempts').notNull().default(0),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /** A short code for the last failure, never a message with PII. */
    lastError: varchar('last_error', { length: 64 }),
    alertErrorId: varchar('alert_error_id', { length: 64 }),

    retryRequestedAt: timestamp('retry_requested_at', { withTimezone: true }),
    retryRequestedByUserId: text('retry_requested_by_user_id').references(
      () => users.id,
      { onDelete: 'restrict' }
    ),

    resolution: varchar('resolution', { length: 32 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: text('resolved_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    /** Support's note: required when they close a row by hand. */
    resolutionNote: text('resolution_note'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_price_moves_change_subscription')
      .on(table.priceChangeId, table.subscriptionId)
      .where(sql`${table.subscriptionId} IS NOT NULL`),
    uniqueIndex('uq_price_moves_change_course_subscription')
      .on(table.priceChangeId, table.courseSubscriptionId)
      .where(sql`${table.courseSubscriptionId} IS NOT NULL`),
    // The hourly claim: `due` rows to tell, and `notified` rows whose Stripe
    // write is retried.
    index('idx_price_moves_claim')
      .on(table.state, table.nextAttemptAt)
      .where(sql`${table.state} IN ('due', 'notified')`),
    // Studio's progress counts.
    index('idx_price_moves_change_state').on(table.priceChangeId, table.state),
    // Support's Queue.
    index('idx_price_moves_held_open')
      .on(table.state)
      .where(sql`${table.state} = 'held' AND ${table.resolvedAt} IS NULL`),
    // A subscriber's own move (the account card's later price, Keep).
    index('idx_price_moves_subscription')
      .on(table.subscriptionId)
      .where(sql`${table.subscriptionId} IS NOT NULL`),
    index('idx_price_moves_course_subscription')
      .on(table.courseSubscriptionId)
      .where(sql`${table.courseSubscriptionId} IS NOT NULL`),

    check(
      'check_price_moves_one_subscription',
      sql`num_nonnulls(${table.subscriptionId}, ${table.courseSubscriptionId}) = 1`
    ),
    check(
      'check_price_moves_state',
      sql`${table.state} IN ('due', 'notified', 'scheduled', 'unchanged', 'skipped', 'held', 'superseded')`
    ),
    check(
      'check_price_moves_scheduled_kind',
      sql`(${table.state} = 'scheduled') = (${table.scheduledKind} IS NOT NULL) AND (${table.scheduledKind} IS NULL OR ${table.scheduledKind} IN ('now', 'pending'))`
    ),
    check(
      'check_price_moves_skip_reason',
      sql`(${table.state} = 'skipped') = (${table.skipReason} IS NOT NULL) AND (${table.skipReason} IS NULL OR ${table.skipReason} IN ('moving_away', 'other_interval', 'no_items', 'ended'))`
    ),
    check(
      'check_price_moves_held_reason',
      sql`(${table.state} <> 'held' OR ${table.heldReason} IS NOT NULL) AND (${table.heldReason} IS NULL OR ${table.heldReason} IN ('no_address', 'notice_refused', 'notice_skipped', 'notice_unknown', 'move_refused', 'move_unknown', 'read_failed', 'same_amount_write_failed'))`
    ),
    check(
      'check_price_moves_told',
      sql`(${table.state} NOT IN ('notified', 'scheduled') OR ${table.noticeAt} IS NOT NULL) AND (${table.state} <> 'scheduled' OR ${table.effectiveAt} IS NOT NULL)`
    ),
    check(
      'check_price_moves_source',
      sql`${table.source} IN ('price_change', 'keep_current_plan')`
    ),
    check('check_price_moves_attempts', sql`${table.attempts} >= 0`),
    check(
      'check_price_moves_retry_pair',
      sql`(${table.retryRequestedAt} IS NULL) = (${table.retryRequestedByUserId} IS NULL)`
    ),
    check(
      'check_price_moves_resolution',
      sql`(${table.resolvedAt} IS NULL) = (${table.resolution} IS NULL) AND (${table.resolution} IS NULL OR ${table.resolution} IN ('moved_by_hand', 'not_needed', 'retried_ok')) AND (${table.resolution} IS NULL OR ${table.resolution} = 'retried_ok' OR ${table.resolutionNote} IS NOT NULL)`
    ),
  ]
);

export const priceChangesRelations = relations(
  priceChanges,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [priceChanges.organizationId],
      references: [organizations.id],
    }),
    tier: one(subscriptionTiers, {
      fields: [priceChanges.tierId],
      references: [subscriptionTiers.id],
    }),
    coursePlan: one(courseSubscriptionPlans, {
      fields: [priceChanges.courseSubscriptionPlanId],
      references: [courseSubscriptionPlans.id],
    }),
    moves: many(subscriptionPriceMoves),
  })
);

export const subscriptionPriceMovesRelations = relations(
  subscriptionPriceMoves,
  ({ one }) => ({
    priceChange: one(priceChanges, {
      fields: [subscriptionPriceMoves.priceChangeId],
      references: [priceChanges.id],
    }),
    subscription: one(subscriptions, {
      fields: [subscriptionPriceMoves.subscriptionId],
      references: [subscriptions.id],
    }),
    courseSubscription: one(courseSubscriptions, {
      fields: [subscriptionPriceMoves.courseSubscriptionId],
      references: [courseSubscriptions.id],
    }),
  })
);

export type PriceChange = typeof priceChanges.$inferSelect;
export type NewPriceChange = typeof priceChanges.$inferInsert;
export type SubscriptionPriceMove = typeof subscriptionPriceMoves.$inferSelect;
export type NewSubscriptionPriceMove =
  typeof subscriptionPriceMoves.$inferInsert;

export type PriceChangeState = 'running' | 'done' | 'stopped' | 'superseded';
export type PriceMoveState =
  | 'due'
  | 'notified'
  | 'scheduled'
  | 'unchanged'
  | 'skipped'
  | 'held'
  | 'superseded';
/** `moving_away`: waiting to move off the repriced tier (.16, Part A rule 1). */
export type PriceMoveSkipReason =
  | 'moving_away'
  | 'other_interval'
  | 'no_items'
  | 'ended';
export type PriceMoveHeldReason =
  | 'no_address'
  | 'notice_refused'
  | 'notice_skipped'
  | 'notice_unknown'
  | 'move_refused'
  | 'move_unknown'
  | 'read_failed'
  | 'same_amount_write_failed';
export type PriceMoveResolution = 'moved_by_hand' | 'not_needed' | 'retried_ok';
