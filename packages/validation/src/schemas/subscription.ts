import { z } from 'zod';
import { uuidSchema } from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';
import { checkoutRedirectUrlSchema } from './purchase';

/**
 * Subscription Validation Schemas
 *
 * Validates subscription tier management, checkout, and lifecycle operations.
 *
 * Database constraint alignment:
 * - subscription_tiers.sort_order: positive integer (CHECK sort_order > 0)
 * - subscription_tiers.price_monthly/annual: non-negative integer in pence
 * - subscriptions.status: 'active' | 'past_due' | 'cancelling' | 'cancelled' | 'incomplete' | 'paused'
 * - subscriptions.billing_interval: 'month' | 'year'
 * - stripe_connect_accounts.status: 'onboarding' | 'active' | 'restricted' | 'disabled'
 *
 * Security:
 * - Checkout redirect URLs use the same domain whitelist as purchases
 * - UUIDs validated on all ID inputs
 * - String lengths match database column constraints
 */

// ============================================================================
// Enums (aligned with database CHECK constraints)
// ============================================================================

export const subscriptionStatusEnum = z.enum(
  ['active', 'past_due', 'cancelling', 'cancelled', 'incomplete', 'paused'],
  { message: 'Invalid subscription status' }
);

export const billingIntervalEnum = z.enum(['month', 'year'], {
  message: 'Billing interval must be month or year',
});

export const connectAccountStatusEnum = z.enum(
  ['onboarding', 'active', 'restricted', 'disabled'],
  { message: 'Invalid connect account status' }
);

// ============================================================================
// Tier Schemas
// ============================================================================

const baseTierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Tier name is required')
    .max(100, 'Tier name must be 100 characters or less'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or less')
    .optional(),
  priceMonthly: z
    .number()
    .int('Price must be a whole number (pence)')
    .min(100, 'Minimum price is £1.00 (100 pence)')
    .max(10000000, 'Maximum price is £100,000'),
  priceAnnual: z
    .number()
    .int('Price must be a whole number (pence)')
    .min(100, 'Minimum price is £1.00 (100 pence)')
    .max(10000000, 'Maximum price is £100,000'),
  isRecommended: z.boolean().optional(),
});

export const createTierSchema = baseTierSchema.refine(
  (data) => data.priceAnnual <= data.priceMonthly * 12,
  {
    message: 'Annual price must offer equal or better value than monthly',
    path: ['priceAnnual'],
  }
);

export const updateTierSchema = baseTierSchema.partial().refine(
  (data) => {
    // Only validate annual vs monthly when BOTH prices are present
    if (data.priceMonthly !== undefined && data.priceAnnual !== undefined) {
      return data.priceAnnual <= data.priceMonthly * 12;
    }
    return true;
  },
  {
    message: 'Annual price must offer equal or better value than monthly',
    path: ['priceAnnual'],
  }
);

export const reorderTiersSchema = z.object({
  // 50 is well above any realistic tier count (real orgs rarely exceed 5-10),
  // bounding the two-phase reorder txn's write count. Organisations with more
  // tiers should be handled via admin tooling, not this endpoint.
  tierIds: z
    .array(uuidSchema)
    .min(1, 'At least one tier ID is required')
    .max(50, 'Cannot reorder more than 50 tiers in one call'),
});

// ============================================================================
// Subscription Checkout Schemas
// ============================================================================

export const createSubscriptionCheckoutSchema = z.object({
  organizationId: uuidSchema,
  tierId: uuidSchema,
  billingInterval: billingIntervalEnum,
  successUrl: checkoutRedirectUrlSchema,
  cancelUrl: checkoutRedirectUrlSchema,
});

// ============================================================================
// Subscription Management Schemas
// ============================================================================

export const changeTierSchema = z.object({
  organizationId: uuidSchema,
  newTierId: uuidSchema,
  billingInterval: billingIntervalEnum,
  /**
   * Unix timestamp (seconds) returned by `previewTierChange()`. Threading
   * it back to `changeTier()` guarantees the commit-time charge matches
   * the dialog preview to the penny — Stripe re-runs the proration
   * calculation against `Date.now()` if omitted.
   */
  prorationDate: z.number().int().positive().optional(),
});

export const cancelSubscriptionSchema = z.object({
  organizationId: uuidSchema,
  // Free-text reason (legacy field, optional). When `churnReason === 'other'`
  // the client should ensure this is non-empty but we don't enforce that
  // server-side — a user who clicks confirm quickly still gets cancelled.
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be 500 characters or less')
    .optional(),
  // Structured churn taxonomy (Q7). See CHURN_REASON in @codex/constants.
  churnReason: z
    .enum([
      'too_expensive',
      'not_enough_content',
      'found_alternative',
      'not_using_it',
      'technical_issues',
      'other',
    ])
    .optional(),
});

export const reactivateSubscriptionSchema = z.object({
  organizationId: uuidSchema,
});

export const resumeSubscriptionSchema = z.object({
  organizationId: uuidSchema,
});

// ============================================================================
// Query Schemas
// ============================================================================

export const listSubscribersQuerySchema = paginationSchema.extend({
  tierId: uuidSchema.optional(),
  status: subscriptionStatusEnum.optional(),
  // BUG-023: `listSubscribers` excludes cancelled rows by default. Set this
  // to `true` from the studio Subscribers page when the operator toggles
  // the "Show cancelled" view. Ignored if `status` is explicitly set.
  includeCancelled: z.coerce.boolean().optional(),
  // Free-text search across user name / email — case-insensitive ILIKE.
  search: z.string().trim().min(1).max(120).optional(),
});

/**
 * Payout status filter for the studio payouts table (Codex-zqaxo).
 *
 * Phase 1 surfaces three states:
 *  - `pending`   — row exists, `resolvedAt IS NULL`
 *  - `resolved`  — `resolvedAt IS NOT NULL` AND `stripeTransferId IS NOT NULL`
 *  - `failed`    — `reason='transfer_failed'` AND unresolved
 *  - `all`       — no status filter (default)
 *
 * The enum is shared by the worker route's query schema below AND the
 * frontend remote function so both ends stay in sync.
 */
export const payoutStatusFilterEnum = z.enum([
  'all',
  'pending',
  'paid',
  'resolved', // legacy URL alias for 'paid' (PR3); dropped in PR4
  'failed',
  'needs_attention',
]);

export const listPayoutsQuerySchema = paginationSchema.extend({
  organizationId: uuidSchema,
  status: payoutStatusFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getPayoutSummaryQuerySchema = z.object({
  organizationId: uuidSchema,
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getCurrentSubscriptionQuerySchema = z.object({
  organizationId: uuidSchema,
});

export const getSubscriptionStatsQuerySchema = z.object({
  organizationId: uuidSchema,
});

// ============================================================================
// Stripe Connect Schemas
// ============================================================================

export const connectOnboardSchema = z.object({
  organizationId: uuidSchema,
  returnUrl: checkoutRedirectUrlSchema,
  refreshUrl: checkoutRedirectUrlSchema,
});

export const connectStatusQuerySchema = z.object({
  organizationId: uuidSchema,
});

export const connectDashboardSchema = z.object({
  organizationId: uuidSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

export type SubscriptionStatus = z.infer<typeof subscriptionStatusEnum>;
export type BillingInterval = z.infer<typeof billingIntervalEnum>;
export type ConnectAccountStatus = z.infer<typeof connectAccountStatusEnum>;

export type CreateTierInput = z.infer<typeof createTierSchema>;
export type UpdateTierInput = z.infer<typeof updateTierSchema>;
export type ReorderTiersInput = z.infer<typeof reorderTiersSchema>;

export type CreateSubscriptionCheckoutInput = z.infer<
  typeof createSubscriptionCheckoutSchema
>;
export type ChangeTierInput = z.infer<typeof changeTierSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type ReactivateSubscriptionInput = z.infer<
  typeof reactivateSubscriptionSchema
>;
export type ResumeSubscriptionInput = z.infer<typeof resumeSubscriptionSchema>;
export type PayoutStatusFilter = z.infer<typeof payoutStatusFilterEnum>;
export type ListPayoutsQueryInput = z.infer<typeof listPayoutsQuerySchema>;
export type GetPayoutSummaryQueryInput = z.infer<
  typeof getPayoutSummaryQuerySchema
>;

export type ListSubscribersQueryInput = z.infer<
  typeof listSubscribersQuerySchema
>;

export type ConnectOnboardInput = z.infer<typeof connectOnboardSchema>;
