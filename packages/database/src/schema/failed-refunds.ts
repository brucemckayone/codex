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
import { purchases } from './ecommerce';
import { users } from './users';

/**
 * Failed refunds: support's queue of refunds Stripe could not pay out
 * (Codex-2hxff.8; owner decision 2026-10-19, "Hold it for support").
 *
 * A refund can fail after it succeeded, up to 30 days later. Stripe returns the
 * money to the platform balance, and the customer must still be refunded some
 * other way. So the clawback stands: the creators' share of a failed refund is
 * clawed back like a succeeded one's. Support then either refunds the customer
 * elsewhere (`refunded_elsewhere`) or, if the customer is not to be refunded,
 * re-pays the creators (`creators_repaid`). That action and its screen are
 * Codex-2hxff.28.
 *
 * One row per Stripe refund, so a redelivered event collapses onto it.
 */
export const failedRefunds = pgTable(
  'failed_refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }).notNull(),
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }).notNull(),
    /** The purchase, when the charge is a purchase's; null for a subscription's. */
    purchaseId: uuid('purchase_id').references(() => purchases.id, {
      onDelete: 'restrict',
    }),

    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    /** Stripe's `failure_reason`, such as `expired_or_canceled_card`. */
    failureReason: varchar('failure_reason', { length: 64 }),

    resolution: varchar('resolution', { length: 32 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: text('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_failed_refunds_stripe_refund_id').on(table.stripeRefundId),
    // Support's open queue, oldest first.
    index('idx_failed_refunds_open')
      .on(table.createdAt)
      .where(sql`${table.resolvedAt} IS NULL`),
    check(
      'check_failed_refunds_amount_positive',
      sql`${table.amountCents} > 0`
    ),
    check(
      'check_failed_refunds_resolution',
      sql`${table.resolution} IS NULL OR ${table.resolution} IN ('refunded_elsewhere', 'creators_repaid')`
    ),
    check(
      'check_failed_refunds_resolved_pair',
      sql`(${table.resolvedAt} IS NULL AND ${table.resolution} IS NULL) OR (${table.resolvedAt} IS NOT NULL AND ${table.resolution} IS NOT NULL)`
    ),
  ]
);

export const failedRefundsRelations = relations(failedRefunds, ({ one }) => ({
  purchase: one(purchases, {
    fields: [failedRefunds.purchaseId],
    references: [purchases.id],
  }),
  resolvedBy: one(users, {
    fields: [failedRefunds.resolvedByUserId],
    references: [users.id],
  }),
}));

export type FailedRefund = typeof failedRefunds.$inferSelect;
export type NewFailedRefund = typeof failedRefunds.$inferInsert;
export type FailedRefundResolution = 'refunded_elsewhere' | 'creators_repaid';
