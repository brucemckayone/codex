import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { purchases } from './ecommerce';

/**
 * Disputes: one row per Stripe dispute, for any source (Codex-2hxff.9; design
 * in docs/payments/dispute-record.md, agreed 2026-10-19).
 *
 * - **An open dispute holds the charge's unpaid slices**: the drain skips them
 *   (`isDrainablePayout`). An inquiry holds them too, though it takes no money
 *   (owner decision Q1).
 * - **A chargeback** (`needs_response`, `under_review`, then `won` or `lost`)
 *   is a clawback cause: its share of each paid slice is reversed
 *   (`payout_reversals.cause_type = 'dispute'`).
 * - **Won** re-pays what was reversed; **lost** cancels the held slices
 *   (`cancelled_by_dispute`).
 *
 * `status` mirrors Stripe's and moves forward only: `won`, `lost`,
 * `warning_closed` and `prevented` are final. `outcome_applied_at` is set once
 * a final status has been acted on, so a redelivery stops there.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stripeDisputeId: varchar('stripe_dispute_id', { length: 255 }).notNull(),
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }).notNull(),
    /** The purchase, when the charge is a purchase's; null for a subscription's. */
    purchaseId: uuid('purchase_id').references(() => purchases.id, {
      onDelete: 'restrict',
    }),

    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    /** Stripe's `reason`, such as `fraudulent`. */
    reason: varchar('reason', { length: 64 }),
    /** Stripe's `created`: the order the clawback takes causes in. */
    stripeCreatedAt: timestamp('stripe_created_at', {
      withTimezone: true,
    }).notNull(),
    /** When a final status was acted on: re-paid (won) or cancelled (lost). */
    outcomeAppliedAt: timestamp('outcome_applied_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_disputes_stripe_dispute_id').on(table.stripeDisputeId),
    index('idx_disputes_purchase').on(table.purchaseId),
    // The drain's hold: open disputes, by charge.
    index('idx_disputes_open_charge')
      .on(table.stripeChargeId)
      .where(
        sql`${table.status} NOT IN ('won', 'lost', 'warning_closed', 'prevented')`
      ),
    check('check_disputes_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'check_disputes_status',
      sql`${table.status} IN ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented')`
    ),
  ]
);

export const disputesRelations = relations(disputes, ({ one }) => ({
  purchase: one(purchases, {
    fields: [disputes.purchaseId],
    references: [purchases.id],
  }),
}));

export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;
export type DisputeStatus =
  | 'warning_needs_response'
  | 'warning_under_review'
  | 'warning_closed'
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'prevented';
