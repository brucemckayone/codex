/**
 * Money notices: one email per person per period (Codex-2hxff.34 Q5, and the
 * Stripe balance emails of .30). Design: batch B data design §2.3.
 *
 * The send is claim-then-send, at most once: the sender does
 * `INSERT … ON CONFLICT DO NOTHING RETURNING id`, and only the caller that
 * inserted sends. It then sets `sent_at`, or `failed_at` if the send failed.
 * There is no retry: a lost reminder is covered by next month's, and a lost
 * balance email by the Studio card.
 *
 * | kind                   | template                   | period_key                          |
 * |------------------------|----------------------------|-------------------------------------|
 * | `payouts_waiting`      | `payouts-waiting`          | the London month, `2026-11`         |
 * | `connect_needed_first` | `creator-connect-needed`   | `episode:<oldest waiting payouts.id>` |
 * | `balance_below_zero`   | `stripe-balance-below-zero`| `<acct>:<negative_since ISO>[/<negative_after ISO>]` |
 * | `balance_recovered`    | `stripe-balance-recovered` | the same episode key                |
 * | `balance_written_off`  | `debt-written-off`         | the same episode key                |
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
import { users } from './users';

export const moneyNotices = pgTable(
  'money_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    periodKey: varchar('period_key', { length: 128 }).notNull(),
    /** What the email said, in pence. */
    amountCents: integer('amount_cents'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // The claim: one notice per person, kind and period.
    uniqueIndex('uq_money_notices_per_period').on(
      table.userId,
      table.kind,
      table.periodKey
    ),
    // The monthly reminder's 21-day guard reads the person's latest notice.
    index('idx_money_notices_recent').on(
      table.userId,
      table.kind,
      table.createdAt.desc()
    ),
    check(
      'check_money_notices_kind',
      sql`${table.kind} IN ('payouts_waiting', 'connect_needed_first', 'balance_below_zero', 'balance_recovered', 'balance_written_off')`
    ),
  ]
);

export const moneyNoticesRelations = relations(moneyNotices, ({ one }) => ({
  user: one(users, {
    fields: [moneyNotices.userId],
    references: [users.id],
  }),
}));

export type MoneyNotice = typeof moneyNotices.$inferSelect;
export type NewMoneyNotice = typeof moneyNotices.$inferInsert;
/** Which email a notice records (§2.3). */
export type MoneyNoticeKind =
  | 'payouts_waiting'
  | 'connect_needed_first'
  | 'balance_below_zero'
  | 'balance_recovered'
  | 'balance_written_off';
