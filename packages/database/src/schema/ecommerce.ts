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
 * Platform-level default fee configuration
 *
 * Defines the default platform fee percentage applied to all transactions.
 * Phase 1: 10% platform fee (1000 basis points = 10.00%)
 * effectiveUntil = NULL means indefinite (current active config)
 *
 * Future: Can add new records with different effectiveFrom dates to change fees over time
 */
export const platformFeeConfig = pgTable(
  'platform_fee_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stored as basis points (10000 = 100%, 1000 = 10%, 500 = 5%)
    platformFeePercentage: integer('platform_fee_percentage').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }), // NULL = indefinite
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_platform_fee_config_effective').on(
      table.effectiveFrom,
      table.effectiveUntil
    ),
    check(
      'check_platform_fee_percentage',
      sql`${table.platformFeePercentage} >= 0 AND ${table.platformFeePercentage} <= 10000`
    ),
  ]
);

/**
 * Organization-specific platform fee agreements
 *
 * Organizations can negotiate custom platform fees (e.g., volume discounts).
 * Phase 1: Not used (all orgs use default 10%)
 * Phase 2+: Large orgs can negotiate lower platform fees
 *
 * If no record exists for an org, falls back to platformFeeConfig default
 */
export const organizationPlatformAgreements = pgTable(
  'organization_platform_agreements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Custom platform fee for this organization (basis points)
    platformFeePercentage: integer('platform_fee_percentage').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }), // NULL = indefinite
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_org_platform_agreement_org_id').on(table.organizationId),
    index('idx_org_platform_agreement_effective').on(
      table.effectiveFrom,
      table.effectiveUntil
    ),
    check(
      'check_org_platform_fee_percentage',
      sql`${table.platformFeePercentage} >= 0 AND ${table.platformFeePercentage} <= 10000`
    ),
  ]
);

/**
 * Creator-Organization revenue split agreements
 *
 * Defines how much of the remaining revenue (after platform fee) goes to the organization.
 * Phase 1: 0% to org, 100% of (post-platform-fee) revenue to creator
 * Phase 2+: Orgs can negotiate revenue share with creators (e.g., 20% to org, 80% to creator)
 *
 * If no record exists, defaults to 0% org fee (all remaining revenue to creator)
 */
export const creatorOrganizationAgreements = pgTable(
  'creator_organization_agreements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Organization's cut of post-platform-fee revenue (basis points)
    organizationFeePercentage: integer('organization_fee_percentage').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }), // NULL = indefinite
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_creator_org_agreement_creator_id').on(table.creatorId),
    index('idx_creator_org_agreement_org_id').on(table.organizationId),
    index('idx_creator_org_agreement_effective').on(
      table.effectiveFrom,
      table.effectiveUntil
    ),
    check(
      'check_org_fee_percentage',
      sql`${table.organizationFeePercentage} >= 0 AND ${table.organizationFeePercentage} <= 10000`
    ),
    // Unique constraint: one active agreement per creator-org pair at any time
    unique('creator_org_agreement_unique').on(
      table.creatorId,
      table.organizationId,
      table.effectiveFrom
    ),
  ]
);

/**
 * Purchase records with immutable revenue split snapshots
 *
 * Records completed purchases with the revenue split calculated at purchase time.
 * Revenue splits are immutable - changes to fee agreements don't affect past purchases.
 *
 * Phase 1 defaults:
 * - Platform: 10% of amountPaidCents
 * - Organization: 0% of remaining
 * - Creator: 90% of amountPaidCents
 *
 * CHECK constraint ensures: amountPaidCents = platformFeeCents + organizationFeeCents + creatorPayoutCents
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

    // Revenue split snapshot (immutable - calculated at purchase time)
    // Phase 1: platformFeeCents = 10%, organizationFeeCents = 0%, creatorPayoutCents = 90%
    // DEFAULT 0 ensures safe migration for existing records (will be backfilled)
    platformFeeCents: integer('platform_fee_cents').notNull().default(0),
    organizationFeeCents: integer('organization_fee_cents')
      .notNull()
      .default(0),
    creatorPayoutCents: integer('creator_payout_cents').notNull().default(0),

    // References to agreements used (audit trail, NULL if defaults used)
    platformAgreementId: uuid('platform_agreement_id').references(
      () => organizationPlatformAgreements.id,
      { onDelete: 'set null' }
    ),
    creatorOrgAgreementId: uuid('creator_org_agreement_id').references(
      () => creatorOrganizationAgreements.id,
      { onDelete: 'set null' }
    ),

    // Stripe reference for payment reconciliation
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 })
      .notNull()
      .unique(),

    // Status with CHECK constraint enforcement
    status: varchar('status', { length: 50 }).notNull(),
    // 'pending', 'completed', 'refunded', 'failed'

    // Purchase completion timestamp (when status became 'completed')
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),

    // Refund tracking
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundReason: text('refund_reason'),
    refundAmountCents: integer('refund_amount_cents'),
    stripeRefundId: varchar('stripe_refund_id', { length: 255 }),

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
    index('idx_purchases_purchased_at').on(table.purchasedAt),
    index('idx_purchases_platform_agreement').on(table.platformAgreementId),
    index('idx_purchases_creator_org_agreement').on(
      table.creatorOrgAgreementId
    ),

    // Composite index for admin analytics queries (revenue by org + status + date)
    index('idx_purchases_org_status_created').on(
      table.organizationId,
      table.status,
      table.createdAt
    ),

    // Composite index for admin analytics queries filtering by purchasedAt
    index('idx_purchases_org_status_purchased').on(
      table.organizationId,
      table.status,
      table.purchasedAt
    ),

    // CHECK constraint for status enum values
    check(
      'check_purchase_status',
      sql`${table.status} IN ('pending', 'completed', 'refunded', 'failed')`
    ),

    // CHECK constraint for positive amounts
    check('check_amount_positive', sql`${table.amountPaidCents} >= 0`),
    check('check_platform_fee_positive', sql`${table.platformFeeCents} >= 0`),
    check('check_org_fee_positive', sql`${table.organizationFeeCents} >= 0`),
    check(
      'check_creator_payout_positive',
      sql`${table.creatorPayoutCents} >= 0`
    ),

    // CRITICAL: Revenue split must equal total amount paid
    check(
      'check_revenue_split_equals_total',
      sql`${table.amountPaidCents} = ${table.platformFeeCents} + ${table.organizationFeeCents} + ${table.creatorPayoutCents}`
    ),

    // NOTE: No unique constraint on (customerId, contentId)
    // Idempotency is enforced by stripePaymentIntentId unique constraint only
    // This allows users to retry failed payments or repurchase after refund
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
  platformAgreement: one(organizationPlatformAgreements, {
    fields: [purchases.platformAgreementId],
    references: [organizationPlatformAgreements.id],
  }),
  creatorOrgAgreement: one(creatorOrganizationAgreements, {
    fields: [purchases.creatorOrgAgreementId],
    references: [creatorOrganizationAgreements.id],
  }),
}));

export const organizationPlatformAgreementsRelations = relations(
  organizationPlatformAgreements,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationPlatformAgreements.organizationId],
      references: [organizations.id],
    }),
  })
);

export const creatorOrganizationAgreementsRelations = relations(
  creatorOrganizationAgreements,
  ({ one }) => ({
    creator: one(users, {
      fields: [creatorOrganizationAgreements.creatorId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [creatorOrganizationAgreements.organizationId],
      references: [organizations.id],
    }),
  })
);

// Type exports for type safety
export type ContentAccess = typeof contentAccess.$inferSelect;
export type NewContentAccess = typeof contentAccess.$inferInsert;

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;

export type PlatformFeeConfig = typeof platformFeeConfig.$inferSelect;
export type NewPlatformFeeConfig = typeof platformFeeConfig.$inferInsert;

export type OrganizationPlatformAgreement =
  typeof organizationPlatformAgreements.$inferSelect;
export type NewOrganizationPlatformAgreement =
  typeof organizationPlatformAgreements.$inferInsert;

export type CreatorOrganizationAgreement =
  typeof creatorOrganizationAgreements.$inferSelect;
export type NewCreatorOrganizationAgreement =
  typeof creatorOrganizationAgreements.$inferInsert;
