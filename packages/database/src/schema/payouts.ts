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
 * `docs/payouts/payout-pipeline.md` for the full lifecycle.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),

    // Stripe correlation
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),
    transferGroup: varchar('transfer_group', { length: 255 }),

    // Money
    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('gbp'),

    // 'organization_fee' | 'creator_payout' | 'creator_payout_to_owner'
    payoutType: varchar('payout_type', { length: 32 }).notNull(),

    // 'paid' | 'pending' | 'failed'
    status: varchar('status', { length: 16 }).notNull(),

    // null for paid; one of the failure/deferral reasons otherwise
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

    check('check_payouts_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'check_payouts_status',
      sql`${table.status} IN ('paid', 'pending', 'failed')`
    ),
    check(
      'check_payouts_reason',
      sql`${table.reason} IS NULL OR ${table.reason} IN ('connect_not_ready', 'connect_restricted', 'transfer_failed', 'min_transfer_floor')`
    ),
    check(
      'check_payouts_type',
      sql`${table.payoutType} IN ('organization_fee', 'creator_payout', 'creator_payout_to_owner')`
    ),
    // Invariant: a paid row must carry a stripe_transfer_id and resolved_at.
    // Catches accidental success-path inserts that forget to record the
    // Stripe correlation — without this, "paid" rows could exist with no
    // proof Stripe ever moved the money.
    check(
      'check_payouts_paid_invariant',
      sql`(${table.status} != 'paid') OR (${table.stripeTransferId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`
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
}));

export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;

export type PayoutStatus = 'paid' | 'pending' | 'failed';
export type PayoutReason =
  | 'connect_not_ready'
  | 'connect_restricted'
  | 'transfer_failed'
  | 'min_transfer_floor';
export type PayoutType =
  | 'organization_fee'
  | 'creator_payout'
  | 'creator_payout_to_owner';
