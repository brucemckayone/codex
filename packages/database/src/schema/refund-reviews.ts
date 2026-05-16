/**
 * Refund Reviews — operations queue (Codex-d9t5r / DQ-7 sentinel layer).
 *
 * When `transfers.createReversal` fails on Stripe with
 * `insufficient_funds` (creator withdrew their slice before the refund
 * hit), the original payouts row stays `status='paid'` (the original
 * transfer succeeded) and we write a row here instead. The customer's
 * refund still completed — Stripe issued it from platform balance —
 * but the platform now holds an unresolved clawback obligation
 * against the creator. Ops resolves each row via the studio surface
 * (follow-up bead).
 *
 * Schema is intentionally minimal: payoutId points to the slice whose
 * reversal failed, creatorUserId is the recipient who owes the balance,
 * attemptedReversalCents is the figure we tried to claw back. The
 * `resolution` enum is populated only when ops marks the row resolved.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { purchases } from './ecommerce';
import { payouts } from './payouts';
import { users } from './users';

export const refundReviews = pgTable(
  'refund_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'restrict' }),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'restrict' }),
    creatorUserId: text('creator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    attemptedReversalCents: integer('attempted_reversal_cents').notNull(),
    errorCode: varchar('error_code', { length: 64 }).notNull(),
    errorMessage: text('error_message'),

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
    // Stripe webhook replays would otherwise insert duplicate rows. Only
    // one OPEN review row per payout makes sense at a time; once resolved,
    // history can accumulate (a creator who gets clawed back, withdraws
    // again, and lands a second insufficient_funds is a real scenario).
    uniqueIndex('uq_refund_reviews_open_per_payout')
      .on(table.payoutId)
      .where(sql`${table.resolvedAt} IS NULL`),
    check(
      'check_refund_reviews_amount_positive',
      sql`${table.attemptedReversalCents} > 0`
    ),
    check(
      'check_refund_reviews_resolution',
      sql`${table.resolution} IS NULL OR ${table.resolution} IN ('creator_absorbed', 'platform_absorbed', 'manually_reversed')`
    ),
    check(
      'check_refund_reviews_resolved_pair',
      sql`(${table.resolvedAt} IS NULL AND ${table.resolution} IS NULL) OR (${table.resolvedAt} IS NOT NULL AND ${table.resolution} IS NOT NULL)`
    ),
  ]
);

export const refundReviewsRelations = relations(refundReviews, ({ one }) => ({
  purchase: one(purchases, {
    fields: [refundReviews.purchaseId],
    references: [purchases.id],
  }),
  payout: one(payouts, {
    fields: [refundReviews.payoutId],
    references: [payouts.id],
  }),
  creator: one(users, {
    fields: [refundReviews.creatorUserId],
    references: [users.id],
  }),
}));

export type RefundReview = typeof refundReviews.$inferSelect;
export type NewRefundReview = typeof refundReviews.$inferInsert;
export type RefundReviewResolution =
  | 'creator_absorbed'
  | 'platform_absorbed'
  | 'manually_reversed';
