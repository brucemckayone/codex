import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './content';
import { users } from './users';

/**
 * Subscription Tiers — org-scoped tier definitions
 *
 * Tiers are hierarchical: higher sortOrder = more content access.
 * Each tier has monthly and annual prices (GBP, stored as pence).
 * Stripe Product + Prices are created on tier save and synced on update.
 *
 * Phase 1: Multi-tier, org owner configures. Stripe Prices are immutable —
 * price changes create new Prices and archive old ones.
 */
export const subscriptionTiers = pgTable(
  'subscription_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull(),
    priceMonthly: integer('price_monthly').notNull(),
    priceAnnual: integer('price_annual').notNull(),

    // Stripe sync — Product + 2 Prices (monthly, annual)
    stripeProductId: varchar('stripe_product_id', { length: 255 }),
    stripePriceMonthlyId: varchar('stripe_price_monthly_id', { length: 255 }),
    stripePriceAnnualId: varchar('stripe_price_annual_id', { length: 255 }),

    isActive: boolean('is_active').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Indexes
    index('idx_subscription_tiers_org_id').on(table.organizationId),
    index('idx_subscription_tiers_org_active').on(
      table.organizationId,
      table.isActive
    ),

    // Unique sortOrder per org (only among non-deleted tiers)
    uniqueIndex('uq_subscription_tiers_org_sort')
      .on(table.organizationId, table.sortOrder)
      .where(sql`${table.deletedAt} IS NULL`),

    // CHECK constraints
    check('check_tier_price_monthly_positive', sql`${table.priceMonthly} >= 0`),
    check('check_tier_price_annual_positive', sql`${table.priceAnnual} >= 0`),
    check('check_tier_sort_order_positive', sql`${table.sortOrder} > 0`),
  ]
);

/**
 * Subscriptions — active subscription records
 *
 * Links a user to an org tier with Stripe subscription lifecycle.
 * Revenue split is snapshotted immutably at creation (same pattern as purchases).
 * Only one active/cancelling subscription per user per org (enforced by unique index).
 *
 * Status flow: incomplete → active → cancelling → cancelled
 *              active → past_due → active (on retry success) or cancelled
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => subscriptionTiers.id, { onDelete: 'restrict' }),

    // Stripe references
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 })
      .notNull()
      .unique(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).notNull(),

    // Lifecycle
    status: varchar('status', { length: 50 }).notNull(),
    billingInterval: varchar('billing_interval', { length: 10 }).notNull(),
    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', {
      withTimezone: true,
    }).notNull(),

    // Cancellation
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),

    // Revenue split snapshot (immutable — calculated at creation, updated on renewal)
    // Platform keeps 10% of gross. Org gets 15% of post-platform. Creators get remainder.
    amountCents: integer('amount_cents').notNull(),
    platformFeeCents: integer('platform_fee_cents').notNull().default(0),
    organizationFeeCents: integer('organization_fee_cents')
      .notNull()
      .default(0),
    creatorPayoutCents: integer('creator_payout_cents').notNull().default(0),

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
    index('idx_subscriptions_user_id').on(table.userId),
    index('idx_subscriptions_org_id').on(table.organizationId),
    index('idx_subscriptions_tier_id').on(table.tierId),
    index('idx_subscriptions_stripe_id').on(table.stripeSubscriptionId),
    index('idx_subscriptions_org_status').on(
      table.organizationId,
      table.status
    ),
    index('idx_subscriptions_user_org').on(table.userId, table.organizationId),

    // One active subscription per user per org
    uniqueIndex('uq_active_subscription_per_user_org')
      .on(table.userId, table.organizationId)
      .where(sql`${table.status} IN ('active', 'past_due', 'cancelling')`),

    // CHECK constraints
    check(
      'check_subscription_status',
      sql`${table.status} IN ('active', 'past_due', 'cancelling', 'cancelled', 'incomplete')`
    ),
    check(
      'check_billing_interval',
      sql`${table.billingInterval} IN ('month', 'year')`
    ),
    check('check_sub_amount_positive', sql`${table.amountCents} >= 0`),
    check(
      'check_sub_platform_fee_positive',
      sql`${table.platformFeeCents} >= 0`
    ),
    check(
      'check_sub_org_fee_positive',
      sql`${table.organizationFeeCents} >= 0`
    ),
    check(
      'check_sub_creator_payout_positive',
      sql`${table.creatorPayoutCents} >= 0`
    ),
    // Revenue split must equal total
    check(
      'check_sub_revenue_split_equals_total',
      sql`${table.amountCents} = ${table.platformFeeCents} + ${table.organizationFeeCents} + ${table.creatorPayoutCents}`
    ),
  ]
);

/**
 * Stripe Connect Accounts — org and creator Stripe Express accounts
 *
 * Both org owners and creators need Connect accounts to receive payouts.
 * One account per user (unique on userId). Orgs also have a unique constraint
 * on organizationId for the org-level account (the owner's).
 *
 * Onboarding: stripe.accounts.create() → stripe.accountLinks.create()
 * Verification: account.updated webhook updates chargesEnabled/payoutsEnabled
 */
export const stripeConnectAccounts = pgTable(
  'stripe_connect_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    stripeAccountId: varchar('stripe_account_id', { length: 255 })
      .notNull()
      .unique(),

    // Onboarding status
    status: varchar('status', { length: 50 }).notNull().default('onboarding'),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    onboardingCompletedAt: timestamp('onboarding_completed_at', {
      withTimezone: true,
    }),

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
    index('idx_stripe_connect_org_id').on(table.organizationId),
    index('idx_stripe_connect_user_id').on(table.userId),
    index('idx_stripe_connect_stripe_id').on(table.stripeAccountId),

    // One Connect account per user per org
    unique('uq_stripe_connect_user_org').on(table.userId, table.organizationId),

    // CHECK constraint for status
    check(
      'check_connect_status',
      sql`${table.status} IN ('onboarding', 'active', 'restricted', 'disabled')`
    ),
  ]
);

/**
 * Pending Payouts — accumulated creator payouts when Connect is unavailable
 *
 * When a creator's Connect account is restricted/disabled but their content
 * is generating subscription revenue, their share accumulates here.
 * Paid out when the creator reconnects their Stripe account.
 */
export const pendingPayouts = pgTable(
  'pending_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),

    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('gbp'),
    reason: varchar('reason', { length: 100 }).notNull(),
    // 'connect_not_ready' | 'connect_restricted' | 'transfer_failed'

    // Resolution
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_pending_payouts_user_id').on(table.userId),
    index('idx_pending_payouts_org_id').on(table.organizationId),
    index('idx_pending_payouts_unresolved').on(table.userId, table.resolvedAt),

    check('check_pending_payout_positive', sql`${table.amountCents} > 0`),
    check(
      'check_pending_payout_reason',
      sql`${table.reason} IN ('connect_not_ready', 'connect_restricted', 'transfer_failed')`
    ),
  ]
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const subscriptionTiersRelations = relations(
  subscriptionTiers,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [subscriptionTiers.organizationId],
      references: [organizations.id],
    }),
    subscriptions: many(subscriptions),
  })
);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
  tier: one(subscriptionTiers, {
    fields: [subscriptions.tierId],
    references: [subscriptionTiers.id],
  }),
}));

export const stripeConnectAccountsRelations = relations(
  stripeConnectAccounts,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [stripeConnectAccounts.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [stripeConnectAccounts.userId],
      references: [users.id],
    }),
  })
);

export const pendingPayoutsRelations = relations(pendingPayouts, ({ one }) => ({
  user: one(users, {
    fields: [pendingPayouts.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [pendingPayouts.organizationId],
    references: [organizations.id],
  }),
  subscription: one(subscriptions, {
    fields: [pendingPayouts.subscriptionId],
    references: [subscriptions.id],
  }),
}));

// ─── Type Exports ────────────────────────────────────────────────────────────

export type SubscriptionTier = typeof subscriptionTiers.$inferSelect;
export type NewSubscriptionTier = typeof subscriptionTiers.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;
export type NewStripeConnectAccount = typeof stripeConnectAccounts.$inferInsert;

export type PendingPayout = typeof pendingPayouts.$inferSelect;
export type NewPendingPayout = typeof pendingPayouts.$inferInsert;
