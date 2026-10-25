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
 * Refunds: one row per Stripe refund, for any source (Codex-2hxff.8; owner
 * decisions 2026-10-19, "One refunds table" and "Hold it for support").
 *
 * - **A purchase's refunds** are its rows. A charge can be refunded in parts,
 *   and each part has its own id, amount and reason.
 * - **The buyer is emailed once per refund**: `notified_at` is the gate.
 * - **Support's queue** is the failed rows not yet resolved. A refund can fail
 *   after it succeeded, up to 30 days later. Stripe returns the money to the
 *   platform balance, but the customer must still be refunded some other way,
 *   so the creators' clawback stands. Support either refunds the customer
 *   elsewhere (`refunded_elsewhere`) or, if the customer is not to be refunded,
 *   re-pays the creators (`creators_repaid`). That action and its screen are
 *   Codex-2hxff.28.
 *
 * `status` mirrors Stripe's. `failed` and `canceled` are final, and a stale
 * event never moves a row backwards (`recordRefund` in @codex/purchase).
 */
export const refunds = pgTable(
  'refunds',
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
    status: varchar('status', { length: 16 }).notNull(),
    /** Stripe's `reason`, such as `requested_by_customer`. */
    reason: varchar('reason', { length: 64 }),
    /** Stripe's `failure_reason`, such as `expired_or_canceled_card`. */
    failureReason: varchar('failure_reason', { length: 64 }),
    /** Stripe's `created`: a charge's refunds are ordered by it. */
    stripeCreatedAt: timestamp('stripe_created_at', {
      withTimezone: true,
    }).notNull(),

    /** When the buyer was emailed about this refund. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    /**
     * Who in support issued it, from the Stripe refund's
     * `metadata.codex_requested_by` (Codex-2hxff.28, Q3). Null for a refund
     * made in the Stripe Dashboard or by the platform itself.
     */
    requestedByUserId: text('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** How support settled a failed refund. */
    resolution: varchar('resolution', { length: 32 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: text('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Support's note on the settlement: a money record, not a log line (Q6). */
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
    uniqueIndex('uq_refunds_stripe_refund_id').on(table.stripeRefundId),
    index('idx_refunds_purchase').on(table.purchaseId),
    // Every clawback and early-refund check reads a charge's refunds
    // (Codex-2hxff.59); without this each is a sequential scan.
    index('idx_refunds_charge').on(table.stripeChargeId),
    // Support's open queue, oldest first.
    index('idx_refunds_failed_open')
      .on(table.createdAt)
      .where(sql`${table.status} = 'failed' AND ${table.resolvedAt} IS NULL`),
    check('check_refunds_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'check_refunds_status',
      sql`${table.status} IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')`
    ),
    check(
      'check_refunds_resolution',
      sql`${table.resolution} IS NULL OR (${table.status} = 'failed' AND ${table.resolution} IN ('refunded_elsewhere', 'creators_repaid'))`
    ),
    check(
      'check_refunds_resolved_pair',
      sql`(${table.resolvedAt} IS NULL AND ${table.resolution} IS NULL) OR (${table.resolvedAt} IS NOT NULL AND ${table.resolution} IS NOT NULL)`
    ),
  ]
);

export const refundsRelations = relations(refunds, ({ one }) => ({
  purchase: one(purchases, {
    fields: [refunds.purchaseId],
    references: [purchases.id],
  }),
  resolvedBy: one(users, {
    fields: [refunds.resolvedByUserId],
    references: [users.id],
  }),
  requestedBy: one(users, {
    fields: [refunds.requestedByUserId],
    references: [users.id],
  }),
}));

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type RefundStatus =
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'canceled';
export type RefundResolution = 'refunded_elsewhere' | 'creators_repaid';
