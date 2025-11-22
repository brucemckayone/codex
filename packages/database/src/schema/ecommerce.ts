import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content, organizations } from './content';
import { users } from './users';

/**
 * NOTE: This is a placeholder schema based on the needs of P1-ACCESS-001.
 * The full schema should be defined in P1-ECOM-001.
 *
 * Tracks user access to content, granted via purchase, subscription, etc.
 *
 * Aligned with database-schema.md v2.0 (lines 418-448)
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
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Access type with CHECK constraint enforcement
    accessType: varchar('access_type', { length: 50 }).notNull(),
    // Phase 1: 'purchased', 'complimentary'
    // Phase 2: 'subscription', 'preview'

    // Access window
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Phase 1: null (permanent access)
    // Phase 2: Can expire with subscriptions

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Indexes
    index('idx_content_access_user_id').on(table.userId),
    index('idx_content_access_content_id').on(table.contentId),
    index('idx_content_access_organization_id').on(table.organizationId),

    // CHECK constraint for access_type enum values
    check(
      'check_access_type',
      sql`${table.accessType} IN ('purchased', 'subscription', 'complimentary', 'preview')`
    ),

    // Unique constraint: one access record per user per content
    unique('content_access_user_content_unique').on(
      table.userId,
      table.contentId
    ),
  ]
);

/**
 * NOTE: This is a placeholder schema based on the needs of P1-ACCESS-001.
 * The full schema should be defined in P1-ECOM-001.
 *
 * Records completed purchases of content.
 *
 * Aligned with database-schema.md v2.0 (lines 321-389)
 * Phase 1: Simple purchases with 100% to creator
 * Phase 2+: Revenue splitting with organization fees
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
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    // Payment (stored as integer cents to avoid rounding errors)
    amountPaidCents: integer('amount_paid_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),

    // Stripe reference for payment reconciliation
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 })
      .notNull()
      .unique(),

    // Status with CHECK constraint enforcement
    status: varchar('status', { length: 50 }).notNull(),
    // 'pending', 'completed', 'refunded', 'failed'

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Indexes
    index('idx_purchases_customer_id').on(table.customerId),
    index('idx_purchases_content_id').on(table.contentId),
    index('idx_purchases_organization_id').on(table.organizationId),
    index('idx_purchases_stripe_payment_intent').on(
      table.stripePaymentIntentId
    ),
    index('idx_purchases_created_at').on(table.createdAt),

    // CHECK constraint for status enum values
    check(
      'check_purchase_status',
      sql`${table.status} IN ('pending', 'completed', 'refunded', 'failed')`
    ),

    // CHECK constraint for positive amounts
    check('check_amount_positive', sql`${table.amountPaidCents} >= 0`),
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
  organization: one(organizations, {
    fields: [contentAccess.organizationId],
    references: [organizations.id],
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
  organization: one(organizations, {
    fields: [purchases.organizationId],
    references: [organizations.id],
  }),
}));

// Type exports for type safety
export type ContentAccess = typeof contentAccess.$inferSelect;
export type NewContentAccess = typeof contentAccess.$inferInsert;

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
