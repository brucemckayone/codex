import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content } from './content';
import { users } from './users';

/**
 * NOTE: This is a placeholder schema based on the needs of P1-ACCESS-001.
 * The full schema should be defined in P1-ECOM-001.
 *
 * Tracks user access to content, granted via purchase, subscription, etc.
 */
export const contentAccess = pgTable(
  'content_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    accessType: varchar('access_type', { length: 50 }).notNull(), // 'purchased', 'subscription', etc.
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_content_access_user_id').on(table.userId),
    index('idx_content_access_content_id').on(table.contentId),
  ]
);

/**
 * NOTE: This is a placeholder schema based on the needs of P1-ACCESS-001.
 * The full schema should be defined in P1-ECOM-001.
 *
 * Records completed purchases of content.
 */
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: text('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 50 }).notNull(), // 'completed', 'pending', 'failed'
    amountPaidCents: integer('amount_paid_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_purchases_customer_id').on(table.customerId),
    index('idx_purchases_content_id').on(table.contentId),
  ]
);

// Relations
export const contentAccessRelations = relations(contentAccess, ({ one }) => ({
  user: one(users, {
    fields: [contentAccess.userId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [contentAccess.contentId],
    references: [content.id],
  }),
}));

export const purchasesRelations = relations(purchases, ({ one }) => ({
  customer: one(users, {
    fields: [purchases.customerId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [purchases.contentId],
    references: [content.id],
  }),
}));
