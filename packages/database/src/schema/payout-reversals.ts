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

import { payouts } from './payouts';

/**
 * Payout reversals: one row per payout slice per cause (a Stripe refund now,
 * a dispute later). Design: docs/payments/refund-reversal-record.md
 * (Codex-2hxff.8, agreed 2026-10-19).
 *
 * It records what each refund did to each slice, so the clawback never has to
 * infer that from `payouts.status`, which cannot represent a second partial
 * refund, a retry, or a partial amount. The `payouts` row itself is never
 * rewritten: its `amount_cents` stays the slice's gross.
 *
 * - `transfer_reversal`: a paid slice's share, reversed in Stripe.
 * - `pending_reduction`: an unpaid slice's share, which the drain subtracts
 *   before it pays.
 * - `retained_fee`: the platform fee's share. No transfer exists, so nothing
 *   moves.
 * - `cancellation`: a full refund of an unpaid slice, which is cancelled
 *   (`cancelled_by_refund`).
 *
 * `status`: `pending` (recorded, not yet acted on), `done`, `failed` (retried
 * by redelivery, then the hourly cron), or `debt` (the payee's balance could
 * not cover it; a `refund_reviews` row records the debt).
 */
export const payoutReversals = pgTable(
  'payout_reversals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'restrict' }),

    causeType: varchar('cause_type', { length: 16 }).notNull(),
    /** The Stripe refund (`re_…`) or dispute (`dp_…`) id. */
    causeId: varchar('cause_id', { length: 255 }).notNull(),

    amountCents: integer('amount_cents').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),

    /** The `trr_…` id, once the transfer reversal exists. */
    stripeReversalId: varchar('stripe_reversal_id', { length: 255 }),
    /**
     * Part of the Stripe idempotency key. It advances only after a definitive
     * Stripe error, because Stripe replays a stored error for its key for 24h.
     */
    attempt: integer('attempt').notNull().default(0),
    /** When the current attempt was claimed: the lease a retry takes. */
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 64 }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    // The "already processed" check: a redelivered refund finds its row, and
    // a second refund of the same charge gets its own.
    uniqueIndex('uq_payout_reversals_per_cause').on(
      table.payoutId,
      table.causeType,
      table.causeId
    ),
    uniqueIndex('uq_payout_reversals_stripe_reversal_id')
      .on(table.stripeReversalId)
      .where(sql`${table.stripeReversalId} IS NOT NULL`),
    // What the cron retries.
    index('idx_payout_reversals_failed')
      .on(table.attemptedAt)
      .where(sql`${table.status} = 'failed'`),
    // The drain sums a pending row's reductions.
    index('idx_payout_reversals_payout').on(table.payoutId),

    check(
      'check_payout_reversals_amount_positive',
      sql`${table.amountCents} > 0`
    ),
    check(
      'check_payout_reversals_cause_type',
      sql`${table.causeType} IN ('refund', 'dispute')`
    ),
    check(
      'check_payout_reversals_kind',
      sql`${table.kind} IN ('transfer_reversal', 'pending_reduction', 'retained_fee', 'cancellation')`
    ),
    check(
      'check_payout_reversals_status',
      sql`${table.status} IN ('pending', 'done', 'failed', 'debt')`
    ),
    check(
      'check_payout_reversals_attempt_non_negative',
      sql`${table.attempt} >= 0`
    ),
  ]
);

export const payoutReversalsRelations = relations(
  payoutReversals,
  ({ one }) => ({
    payout: one(payouts, {
      fields: [payoutReversals.payoutId],
      references: [payouts.id],
    }),
  })
);

export type PayoutReversal = typeof payoutReversals.$inferSelect;
export type NewPayoutReversal = typeof payoutReversals.$inferInsert;
export type PayoutReversalKind =
  | 'transfer_reversal'
  | 'pending_reduction'
  | 'retained_fee'
  | 'cancellation';
export type PayoutReversalStatus = 'pending' | 'done' | 'failed' | 'debt';
