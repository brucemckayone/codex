/**
 * Connect balances: one row per Stripe account we pay out (Codex-2hxff.29,
 * .30). Design: batch B data design §2.1.
 *
 * Bank payouts are manual (`interval: 'manual'`, `debit_negative_balances:
 * false`): a daily job pays out only the money past the 14-day refund window.
 * The same job reads every manual account's balance each morning and records
 * it here, so a negative balance (the debt Stripe now holds, Q2) and its start
 * are known without another Stripe call.
 *
 * Keyed by account, not user: a replaced account (in
 * `stripe_connect_account_history`) still has its money paid out, and Stripe
 * requires a manual-payout balance to be paid within 90 days.
 *
 * - `manual_payouts_since`: set once Stripe confirmed both settings (the
 *   backfill, or the `account.updated` webhook). Null means Stripe's own
 *   schedule still applies, and the job skips the account.
 * - `negative_since` / `negative_after`: the current negative episode. The
 *   first check that saw `available < 0`, and the last check before it that
 *   saw `available >= 0` (null if there was none). The take-back that started
 *   the episode lies between the two.
 * - `cleared_at` / `cleared_reason` / `cleared_owed_cents` / `cleared_since`:
 *   how the last episode ended, what was still owed at its last check, and
 *   when it began (the clearing write nulls `negative_since`, and a bank day
 *   that ran inside the episode paid nothing). `cleared_since` is set exactly
 *   when `cleared_at` is. `stripe_collected` is a heuristic (negative for 180
 *   days or more, when Stripe collects it from the platform); `recovered`
 *   otherwise.
 * - `cleared_balance_cents`: available + pending at the clearing reading,
 *   what was in Stripe once the episode ended (AMENDMENT 3: what each of the
 *   episode's sales put towards the take-back). Never set without
 *   `cleared_at`.
 * - `collected_owed_cents` / `collected_at`: a debt over £50 that Stripe
 *   collected from the platform at 180 days (§14: over £50 stays support's
 *   `to_invoice` case until invoicing ships, P6). The clearing transition
 *   adds to it; a new episode never touches it; only the P6 follow-up clears
 *   it. Both null, or both set with a positive amount.
 * - `last_error_code` / `failing_since`: the job's last refusal from Stripe for
 *   this account; a successful payout clears both.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const connectBalances = pgTable(
  'connect_balances',
  {
    stripeAccountId: varchar('stripe_account_id', { length: 255 }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Stripe confirmed interval 'manual' AND debit_negative_balances false. Null: Stripe's own schedule (not switched yet). */
    manualPayoutsSince: timestamp('manual_payouts_since', {
      withTimezone: true,
    }),

    /** The last balance read, GBP pence; available can be negative. */
    availableCents: integer('available_cents'),
    pendingCents: integer('pending_cents'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),

    /** The current negative episode: the first daily check that saw available < 0. */
    negativeSince: timestamp('negative_since', { withTimezone: true }),
    /** The last check before the episode that saw available >= 0; null if there was none. */
    negativeAfter: timestamp('negative_after', { withTimezone: true }),

    /** How the last episode ended. */
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    clearedReason: varchar('cleared_reason', { length: 16 }),
    /**
     * What was still owed, in pence, at the last check before the episode
     * ended: the `debt-written-off` email's figure. Written only by the
     * clearing write; null when no negative reading was on record.
     */
    clearedOwedCents: integer('cleared_owed_cents'),
    /** The start (`negative_since`) of the episode `cleared_at` ended. */
    clearedSince: timestamp('cleared_since', { withTimezone: true }),
    /** Available + pending at the clearing reading, pence. */
    clearedBalanceCents: integer('cleared_balance_cents'),

    /**
     * Over £50 collected by Stripe from the platform, awaiting the P6 invoice:
     * what the payee still owes the platform, in pence, and when Stripe first
     * collected it.
     */
    collectedOwedCents: integer('collected_owed_cents'),
    collectedAt: timestamp('collected_at', { withTimezone: true }),

    /** The last bank payout the job made (`po_…`). */
    lastPayoutId: varchar('last_payout_id', { length: 255 }),
    lastPayoutCents: integer('last_payout_cents'),
    lastPayoutAt: timestamp('last_payout_at', { withTimezone: true }),

    /** The job's last refusal from Stripe for this account; cleared by a success. */
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    failingSince: timestamp('failing_since', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_connect_balances_user').on(table.userId),
    // The job's account set: only the switched accounts.
    index('idx_connect_balances_manual')
      .on(table.manualPayoutsSince)
      .where(sql`${table.manualPayoutsSince} IS NOT NULL`),
    // Support's Creator debts and the money sweep's balance emails.
    index('idx_connect_balances_negative')
      .on(table.negativeSince)
      .where(sql`${table.negativeSince} IS NOT NULL`),
    check(
      'check_connect_balances_cleared_reason',
      sql`${table.clearedReason} IS NULL OR ${table.clearedReason} IN ('recovered', 'stripe_collected')`
    ),
    // Set exactly when cleared_at is. IS NULL is never NULL, so neither is
    // the comparison.
    check(
      'check_connect_balances_cleared_since',
      sql`(${table.clearedSince} IS NULL) = (${table.clearedAt} IS NULL)`
    ),
    // Never without cleared_at; IS NULL arms, so never NULL.
    check(
      'check_connect_balances_cleared_balance',
      sql`${table.clearedBalanceCents} IS NULL OR ${table.clearedAt} IS NOT NULL`
    ),
    // Both null, or both set with a positive amount. IS NULL arms keep the
    // check from ever evaluating NULL.
    check(
      'check_connect_balances_collected',
      sql`(${table.collectedOwedCents} IS NULL AND ${table.collectedAt} IS NULL) OR (${table.collectedOwedCents} IS NOT NULL AND ${table.collectedAt} IS NOT NULL AND ${table.collectedOwedCents} > 0)`
    ),
    // An episode's start is always after the last non-negative check. With
    // negative_after NULL the first arm holds; otherwise both sides are set,
    // so the comparison is never NULL.
    check(
      'check_connect_balances_negative_after',
      sql`${table.negativeAfter} IS NULL OR (${table.negativeSince} IS NOT NULL AND ${table.negativeAfter} < ${table.negativeSince})`
    ),
  ]
);

export const connectBalancesRelations = relations(
  connectBalances,
  ({ one }) => ({
    user: one(users, {
      fields: [connectBalances.userId],
      references: [users.id],
    }),
  })
);

export type ConnectBalance = typeof connectBalances.$inferSelect;
export type NewConnectBalance = typeof connectBalances.$inferInsert;
/** How a negative episode ended (§2.1). */
export type ConnectBalanceClearedReason = 'recovered' | 'stripe_collected';
