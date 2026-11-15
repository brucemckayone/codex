import type { DisputeAppealStatus } from '@codex/constants';
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
import { courseSubscriptions } from './course-commerce';
import { purchases } from './ecommerce';
import { subscriptions } from './subscriptions';

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
 * a final status has been acted on, so a redelivery stops there. A `lost`
 * dispute keeps holding until then: its held slices are cancelled, not paid.
 *
 * **A late win** is the one way back (Codex-2hxff.70; late-win data design
 * §3): Stripe can turn a lost dispute into a won one, and the row then moves
 * lost → won once. `late_won_at` marks it, and the loss's applied time is
 * kept in `lost_applied_at` when the undo clears `outcome_applied_at`.
 *
 * **An appeal** of a lost chargeback (API 2026-10-28.endive) is recorded,
 * and acted on, as `lost`, and kept in `appeal_status`, never in `status`:
 * the sale stays held and the loss is applied as before (Codex-wzaoh; owner
 * D34).
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
    /**
     * The subscription the disputed invoice belongs to, set when the dispute
     * first pauses it, so later events find it directly. At most one of these
     * and `purchase_id` is set.
     */
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'restrict',
    }),
    courseSubscriptionId: uuid('course_subscription_id').references(
      () => courseSubscriptions.id,
      { onDelete: 'restrict' }
    ),

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
    /**
     * When the row moved lost → won: a late win, for the undo's extra step,
     * support's history and the logs. Null for every other dispute.
     */
    lateWonAt: timestamp('late_won_at', { withTimezone: true }),
    /**
     * The loss's `outcome_applied_at`, kept when a late win clears that
     * column. Null when the loss never finished. Support's "lost on …".
     */
    lostAppliedAt: timestamp('lost_applied_at', { withTimezone: true }),
    /**
     * The `re_` refund a late win made for a buyer who had bought the item
     * again (Q1), so a re-run finds it and the refund email words it.
     */
    lateWinRefundId: varchar('late_win_refund_id', { length: 255 }),
    /**
     * The buyer's "access is back" email, claimed by a conditional update
     * before it is sent, so a redelivery never sends a second one.
     */
    buyerToldAt: timestamp('buyer_told_at', { withTimezone: true }),
    /**
     * When the buyer was refunded outside Stripe (owner decision 2026-11-08,
     * "Block it in code"). From then on the charge is never refunded through
     * Stripe: support's refund route refuses it (`REFUNDED_OUTSIDE_STRIPE`).
     * Three writers:
     * - the runbook step that settles the charge by hand
     *   (docs/payments/operations.md, "Settling a late-win refund Stripe
     *   won't make"), in the transaction that marks the outcome;
     * - support settling the late win's own failed refund as refunded
     *   elsewhere when the charge's succeeded Stripe refunds don't cover
     *   it, in the transaction that resolves it (`settleRefundedElsewhere`,
     *   @codex/admin);
     * - a manual UPDATE, with the owner's OK, for a buyer refunded another
     *   way that the settle never saw (docs/payments/release-checklist.md,
     *   R19 (b)).
     * No date is overwritten. The runbook step runs only on a charge with no
     * refund recorded, so it never meets a set date; the other two guard
     * with `IS NULL`.
     */
    refundedOutsideStripeAt: timestamp('refunded_outside_stripe_at', {
      withTimezone: true,
    }),
    /**
     * The appeal of a lost chargeback, while it runs (owner D34):
     * `appeal_needs_response`, then `appeal_under_review`. Set only on a
     * `lost` row, in code: no CHECK holds it, since a CHECK binds an older
     * worker after a rollback too, and its late win doesn't clear the mark.
     * It follows Stripe's appeal; the bank's decision (a late win, or a
     * `lost` read live from Stripe) clears it, and the hourly reconcile
     * clears one left stale. Support shows "Appeal…" only under Lost, while
     * the appeal runs. Null for every other dispute.
     */
    appealStatus: varchar('appeal_status', {
      length: 32,
    }).$type<DisputeAppealStatus>(),

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
    // The drain's hold and the clawback read a charge's disputes. Not partial:
    // the hold's predicate (open, or lost and not yet applied) is not one a
    // partial index could imply, and the table stays small.
    index('idx_disputes_charge').on(table.stripeChargeId),
    // A won dispute restores the subscription only when no other chargeback
    // on it is still open.
    index('idx_disputes_subscription').on(table.subscriptionId),
    index('idx_disputes_course_subscription').on(table.courseSubscriptionId),
    check('check_disputes_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'check_disputes_one_source',
      sql`num_nonnulls(${table.purchaseId}, ${table.subscriptionId}, ${table.courseSubscriptionId}) <= 1`
    ),
    check(
      'check_disputes_status',
      sql`${table.status} IN ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented')`
    ),
    // A late win is a won row, and only a late win keeps a loss date, a
    // late-win refund or a told buyer (Codex-h301h). `status` is NOT NULL, so
    // none of these can be NULL.
    check(
      'check_disputes_late_won_status',
      sql`${table.lateWonAt} IS NULL OR ${table.status} = 'won'`
    ),
    check(
      'check_disputes_late_win_refund',
      sql`${table.lateWinRefundId} IS NULL OR ${table.lateWonAt} IS NOT NULL`
    ),
    check(
      'check_disputes_lost_applied',
      sql`${table.lostAppliedAt} IS NULL OR ${table.lateWonAt} IS NOT NULL`
    ),
    check(
      'check_disputes_buyer_told',
      sql`${table.buyerToldAt} IS NULL OR ${table.lateWonAt} IS NOT NULL`
    ),
    // DISPUTE_APPEAL_STATUSES (@codex/constants), written out.
    check(
      'check_disputes_appeal_status',
      sql`${table.appealStatus} IS NULL OR ${table.appealStatus} IN ('appeal_needs_response', 'appeal_under_review')`
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
