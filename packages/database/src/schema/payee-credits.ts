/**
 * Payee credits: money owed TO a payee after a late take-back (Codex-2hxff.72,
 * .73, Q10). Design: batch B data design §2.2, §7.
 *
 * The mirror of `refund_reviews`: one row per late effect of one
 * `payout_reversals` step. A delivery that lost its claim (`claimLost` in
 * packages/payments/src/clawback.ts) can find that a step support had already
 * settled took money after all. Each such finding is a row here, and support
 * settles it in Admin → Queue → "Owed to creators".
 *
 * - `effect`:
 *   - `reversal_landed`: a transfer reversal naming the step landed. Owed
 *     `trr.amount` as Stripe returned it, never `payout_reversals.amount_cents`.
 *   - `slice_cancelled`: the step cancelled the unpaid slice. Owed what the
 *     drain would have paid (the slice less its done pending reductions).
 *   - `unverified`: Stripe could not say. Support presses "Check Stripe again".
 *   - `transfer_kept`: the payee kept the transfer. Not owed; born resolved.
 * - `settled_as`: the step's status when the late effect was found
 *   (`cancelled`, `debt` or `done`).
 * - `resolution`: `repaid` (a new pending `payouts` row, `repay_payout_id`),
 *   `debt_collected` (counted against the step's open `refund_reviews` debt),
 *   or `not_owed` (support with a note, or the system after a check).
 * - `alert_error_id`: the errorId of the `claimLost` alert that found it, so a
 *   queue row joins to its log line.
 *
 * Every CHECK below is written so that it never evaluates to NULL (a CHECK
 * PASSES on NULL): `IS NOT DISTINCT FROM`, `COALESCE`, or an explicit
 * `IS NULL` arm.
 */

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
import { payoutReversals } from './payout-reversals';
import { payouts } from './payouts';
import { users } from './users';

export const payeeCredits = pgTable(
  'payee_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payoutReversalId: uuid('payout_reversal_id')
      .notNull()
      .references(() => payoutReversals.id, { onDelete: 'restrict' }),
    /** The slice the step belongs to. */
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'restrict' }),
    /** Null only for an organisation slice with no owner (its re-pay waits as no_owner). */
    payeeUserId: text('payee_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),

    effect: varchar('effect', { length: 16 }).notNull(),
    /** What the payee is owed: Stripe's trr.amount, or the cancelled share. Null while unverified. */
    amountCents: integer('amount_cents'),
    /** The `trr_…` id, when a reversal is known. */
    stripeReversalId: varchar('stripe_reversal_id', { length: 255 }),
    /** The `tr_…` id, when known. */
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),
    /** The step's status when the late effect was found: cancelled | debt | done. */
    settledAs: varchar('settled_as', { length: 16 }).notNull(),
    /** The errorId of the claimLost alert that found it: logs to row. */
    alertErrorId: uuid('alert_error_id').notNull(),

    foundAt: timestamp('found_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** The last "Check Stripe again". */
    checkedAt: timestamp('checked_at', { withTimezone: true }),

    resolution: varchar('resolution', { length: 16 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Null: the system resolved it. */
    resolvedByUserId: text('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolutionNote: text('resolution_note'),
    /** The re-pay row, once support re-paid it. */
    repayPayoutId: uuid('repay_payout_id').references(() => payouts.id, {
      onDelete: 'restrict',
    }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One credit per step: a later, confirmed finding upgrades an unverified
    // row through ON CONFLICT, and never adds a second.
    uniqueIndex('uq_payee_credits_per_step').on(table.payoutReversalId),
    // One credit per re-pay row: two clicks can never link one payout twice.
    uniqueIndex('uq_payee_credits_repay')
      .on(table.repayPayoutId)
      .where(sql`${table.repayPayoutId} IS NOT NULL`),
    index('idx_payee_credits_open')
      .on(table.foundAt)
      .where(sql`${table.resolvedAt} IS NULL`),
    index('idx_payee_credits_payee').on(table.payeeUserId),
    check(
      'check_payee_credits_effect',
      sql`${table.effect} IN ('reversal_landed', 'slice_cancelled', 'unverified', 'transfer_kept')`
    ),
    // COALESCE: a NULL amount would make the comparison NULL, and a CHECK
    // passes on NULL (as check_payouts_user_required, payouts.ts).
    check(
      'check_payee_credits_amount',
      sql`${table.effect} NOT IN ('reversal_landed', 'slice_cancelled') OR COALESCE(${table.amountCents} > 0, false)`
    ),
    check(
      'check_payee_credits_settled_as',
      sql`${table.settledAs} IN ('cancelled', 'debt', 'done')`
    ),
    check(
      'check_payee_credits_resolution',
      sql`${table.resolution} IS NULL OR ${table.resolution} IN ('repaid', 'debt_collected', 'not_owed')`
    ),
    check(
      'check_payee_credits_resolved_pair',
      sql`(${table.resolvedAt} IS NULL) = (${table.resolution} IS NULL)`
    ),
    check(
      'check_payee_credits_repaid_link',
      sql`(${table.resolution} IS NOT DISTINCT FROM 'repaid') = (${table.repayPayoutId} IS NOT NULL)`
    ),
    // Only a confirmed take-back can be re-paid or collect a debt.
    check(
      'check_payee_credits_owed_only',
      sql`${table.resolution} IS NULL OR ${table.resolution} = 'not_owed' OR ${table.effect} IN ('reversal_landed', 'slice_cancelled')`
    ),
    // Only a debt step can collect a debt.
    check(
      'check_payee_credits_debt_only',
      sql`${table.resolution} IS DISTINCT FROM 'debt_collected' OR ${table.settledAs} = 'debt'`
    ),
  ]
);

export const payeeCreditsRelations = relations(payeeCredits, ({ one }) => ({
  payoutReversal: one(payoutReversals, {
    fields: [payeeCredits.payoutReversalId],
    references: [payoutReversals.id],
  }),
  payout: one(payouts, {
    fields: [payeeCredits.payoutId],
    references: [payouts.id],
    relationName: 'payee_credit_slice',
  }),
  repayPayout: one(payouts, {
    fields: [payeeCredits.repayPayoutId],
    references: [payouts.id],
    relationName: 'payee_credit_repay',
  }),
  payee: one(users, {
    fields: [payeeCredits.payeeUserId],
    references: [users.id],
    relationName: 'payee_credit_payee',
  }),
  resolvedBy: one(users, {
    fields: [payeeCredits.resolvedByUserId],
    references: [users.id],
    relationName: 'payee_credit_resolver',
  }),
}));

export type PayeeCredit = typeof payeeCredits.$inferSelect;
export type NewPayeeCredit = typeof payeeCredits.$inferInsert;
/** What a late take-back did (§2.2). */
export type PayeeCreditEffect =
  | 'reversal_landed'
  | 'slice_cancelled'
  | 'unverified'
  | 'transfer_kept';
/** The step's status when the late effect was found. */
export type PayeeCreditSettledAs = 'cancelled' | 'debt' | 'done';
/** How a credit was settled (§7.2). */
export type PayeeCreditResolution = 'repaid' | 'debt_collected' | 'not_owed';
