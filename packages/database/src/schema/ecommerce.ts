import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { content } from './content';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Content-access grants. One row per (user, content); access granted via
 * purchase / subscription / complimentary / preview (see CHECK constraint).
 * Soft-deleted (`deletedAt`) on refund, dispute, or revocation.
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

    // Soft delete (null = active, set on refund/revocation)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
 * Agreement proposals — immutable audit of revenue-share negotiation rounds.
 *
 * Codex-ppxtd (WP-1 of Codex-nk4km).
 *
 * Every owner-offer / creator-counter / counter-of-counter is a row here.
 * Lineage walks via `parent_proposal_id` (NULL = the round-1 initial offer
 * from the owner). When a proposal is accepted, `creator_organization_agreements`
 * is written/updated and points back via `current_proposal_id`. Proposals are
 * NEVER updated except for terminal status transitions (open → accepted /
 * declined / withdrawn / countered / superseded) — the row body is the
 * historical record.
 *
 * Revenue type is per-row: a creator can hold one active `subscription`
 * agreement AND one active `content_purchase` agreement with the same org.
 */
export const agreementProposals = pgTable(
  'agreement_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'subscription' | 'content_purchase' — see CHECK below
    revenueType: varchar('revenue_type', { length: 32 }).notNull(),

    // Self-FK lineage. NULL = round-1 initial offer.
    parentProposalId: uuid('parent_proposal_id').references(
      (): AnyPgColumn => agreementProposals.id,
      { onDelete: 'set null' }
    ),
    // 1 for the owner's initial offer; +1 per counter.
    roundNumber: integer('round_number').notNull(),

    proposedByUserId: text('proposed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'owner' | 'creator' — see CHECK below
    proposedByRole: varchar('proposed_by_role', { length: 16 }).notNull(),

    // Creator's slice of the post-platform-fee pool (basis points 0–10000).
    proposedCreatorSharePercent: integer(
      'proposed_creator_share_percent'
    ).notNull(),
    // Proposed soft-lock review window in months. NULL = indefinite.
    proposedTermMonths: integer('proposed_term_months'),
    proposedEffectiveFrom: timestamp('proposed_effective_from', {
      withTimezone: true,
    }).notNull(),

    note: text('note'),

    // 'open' | 'accepted' | 'declined' | 'countered' | 'withdrawn' | 'superseded'
    status: varchar('status', { length: 16 }).notNull(),

    respondedAt: timestamp('responded_at', { withTimezone: true }),
    respondedByUserId: text('responded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    declineReason: text('decline_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Thread lookup: list all proposals in the (org, creator, revenue_type) negotiation.
    index('idx_agreement_proposals_thread').on(
      table.organizationId,
      table.creatorId,
      table.revenueType
    ),
    // Creator portfolio queries — "what's waiting on me?" / "what have I countered?"
    index('idx_agreement_proposals_creator_status').on(
      table.creatorId,
      table.status
    ),
    // Owner pending queries — "what counters are waiting on me?"
    index('idx_agreement_proposals_org_status').on(
      table.organizationId,
      table.status
    ),

    check(
      'check_agreement_proposals_revenue_type',
      sql`${table.revenueType} IN ('subscription', 'content_purchase')`
    ),
    check(
      'check_agreement_proposals_proposed_by_role',
      sql`${table.proposedByRole} IN ('owner', 'creator')`
    ),
    check(
      'check_agreement_proposals_status',
      sql`${table.status} IN ('open', 'accepted', 'declined', 'countered', 'withdrawn', 'superseded')`
    ),
    check(
      'check_agreement_proposals_share_bps',
      sql`${table.proposedCreatorSharePercent} >= 0 AND ${table.proposedCreatorSharePercent} <= 10000`
    ),
    check(
      'check_agreement_proposals_round_positive',
      sql`${table.roundNumber} >= 1`
    ),
    check(
      'check_agreement_proposals_term_positive',
      sql`${table.proposedTermMonths} IS NULL OR ${table.proposedTermMonths} > 0`
    ),
  ]
);

/**
 * Creator-Organization revenue split agreements
 *
 * Defines how much of the remaining revenue (after platform fee) goes to the
 * creator. Owner residual = (post-platform-fee pool) − Σ(active creator shares).
 *
 * One row per (organization, creator, revenue_type) where status='active'
 * (enforced by partial unique index). Terminated/expired rows persist for
 * audit and may multiply on the same (org, creator, revenue_type) key.
 *
 * `current_proposal_id` points at the accepted proposal that produced this
 * row's economics.
 *
 * Codex-ppxtd (WP-1 of Codex-nk4km) extended this from the Phase-1 single
 * "org fee" model into a per-revenue-type lifecycle-aware contract.
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
    // Organization's cut of post-platform-fee revenue (basis points).
    // (Legacy column — Phase 2+ math uses proposed_creator_share_percent on the
    //  accepted proposal as the source of truth. Retained for backwards-compat
    //  during the WP-2/WP-4 service rollout.)
    organizationFeePercentage: integer('organization_fee_percentage').notNull(),

    // WP-1 additions:
    // 'subscription' | 'content_purchase'
    revenueType: varchar('revenue_type', { length: 32 })
      .notNull()
      .default('subscription'),
    // 'active' | 'terminated' | 'expired'
    status: varchar('status', { length: 16 }).notNull().default('active'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    terminatedByUserId: text('terminated_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' }
    ),
    terminationReason: text('termination_reason'),
    currentProposalId: uuid('current_proposal_id').references(
      () => agreementProposals.id,
      { onDelete: 'set null' }
    ),

    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }), // NULL = indefinite
    // WP-? (Codex-tugez): set when the agreement-expiring-soon cron has
    // already fired for this row. Used to make the cron idempotent —
    // re-running the sweep after a partial failure does NOT re-send.
    // NULL = no expiring-soon email has been sent yet. Cleared on
    // renewal (future scope; today renewal means a new row).
    expiringSoonEmailSentAt: timestamp('expiring_soon_email_sent_at', {
      withTimezone: true,
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
    index('idx_creator_org_agreement_creator_id').on(table.creatorId),
    index('idx_creator_org_agreement_org_id').on(table.organizationId),
    index('idx_creator_org_agreement_effective').on(
      table.effectiveFrom,
      table.effectiveUntil
    ),
    // Composite for "active per (org, creator, type)" lookups in the payout pipeline.
    index('idx_creator_org_agreement_active_lookup').on(
      table.organizationId,
      table.creatorId,
      table.revenueType,
      table.status
    ),
    check(
      'check_org_fee_percentage',
      sql`${table.organizationFeePercentage} >= 0 AND ${table.organizationFeePercentage} <= 10000`
    ),
    check(
      'check_creator_org_agreement_revenue_type',
      sql`${table.revenueType} IN ('subscription', 'content_purchase')`
    ),
    check(
      'check_creator_org_agreement_status',
      sql`${table.status} IN ('active', 'terminated', 'expired')`
    ),
    check(
      'check_creator_org_agreement_terminated_shape',
      sql`(${table.status} = 'terminated') = (${table.terminatedAt} IS NOT NULL)`
    ),
    // Legacy tuple-unique. Extended in WP-1 with revenue_type so two
    // different-revenue-type agreements can co-exist at the same
    // effective_from. The PARTIAL unique below is the authoritative
    // "one active per (org, creator, type)" invariant; this tuple-unique
    // is retained to keep prior upsert-by-effectiveFrom semantics working.
    unique('creator_org_agreement_unique').on(
      table.creatorId,
      table.organizationId,
      table.effectiveFrom,
      table.revenueType
    ),
    // WP-1 partial unique: at most one ACTIVE agreement per (org, creator, type).
    // Allows multiple terminated/expired rows for the same triple (audit history).
    uniqueIndex('uq_creator_org_agreement_active_per_type')
      .on(table.organizationId, table.creatorId, table.revenueType)
      .where(sql`${table.status} = 'active'`),
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
    currency: varchar('currency', { length: 3 }).notNull().default('gbp'),

    // Revenue split snapshot (immutable - calculated at purchase time)
    // Defaults: platformFeeCents = 10% of gross, organizationFeeCents = 10% of
    // post-platform, creatorPayoutCents = 90% of post-platform (Codex-h69cg).
    // DEFAULT 0 ensures safe migration for existing records (will be backfilled).
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

    // Dispute tracking (charge.dispute.created). Disputes don't mutate
    // `status` (still 'completed' or 'refunded'), but `disputedAt` flips
    // the purchase into a disputed state for reporting and also triggers
    // a contentAccess soft-delete — the same access-reducing effect as
    // a refund. `disputeReason` mirrors the Stripe dispute `reason` enum.
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    disputeReason: text('dispute_reason'),
    stripeDisputeId: varchar('stripe_dispute_id', { length: 255 }),

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

    // Composite index for customer purchase history (filtered by customer, sorted by date)
    index('idx_purchases_customer_purchased').on(
      table.customerId,
      table.purchasedAt
    ),

    // Composite index for library query join path (customer + status + content)
    index('idx_purchases_customer_status_content').on(
      table.customerId,
      table.status,
      table.contentId
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
      relationName: 'creatorOrganizationAgreementCreator',
    }),
    organization: one(organizations, {
      fields: [creatorOrganizationAgreements.organizationId],
      references: [organizations.id],
    }),
    currentProposal: one(agreementProposals, {
      fields: [creatorOrganizationAgreements.currentProposalId],
      references: [agreementProposals.id],
    }),
    terminatedBy: one(users, {
      fields: [creatorOrganizationAgreements.terminatedByUserId],
      references: [users.id],
      relationName: 'creatorOrganizationAgreementTerminatedBy',
    }),
  })
);

export const agreementProposalsRelations = relations(
  agreementProposals,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [agreementProposals.organizationId],
      references: [organizations.id],
    }),
    creator: one(users, {
      fields: [agreementProposals.creatorId],
      references: [users.id],
      relationName: 'agreementProposalCreator',
    }),
    proposedBy: one(users, {
      fields: [agreementProposals.proposedByUserId],
      references: [users.id],
      relationName: 'agreementProposalProposedBy',
    }),
    respondedBy: one(users, {
      fields: [agreementProposals.respondedByUserId],
      references: [users.id],
      relationName: 'agreementProposalRespondedBy',
    }),
    parentProposal: one(agreementProposals, {
      fields: [agreementProposals.parentProposalId],
      references: [agreementProposals.id],
      relationName: 'agreementProposalParent',
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

export type AgreementProposal = typeof agreementProposals.$inferSelect;
export type NewAgreementProposal = typeof agreementProposals.$inferInsert;
