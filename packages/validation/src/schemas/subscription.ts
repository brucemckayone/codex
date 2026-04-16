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
 * - subscriptions.status: 'active' | 'past_due' | 'cancelling' | 'cancelled' | 'incomplete'
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
  ['active', 'past_due', 'cancelling', 'cancelled', 'incomplete'],
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
  tierIds: z.array(uuidSchema).min(1, 'At least one tier ID is required'),
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
});

export const cancelSubscriptionSchema = z.object({
  organizationId: uuidSchema,
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be 500 characters or less')
    .optional(),
});

export const reactivateSubscriptionSchema = z.object({
  organizationId: uuidSchema,
});

// ============================================================================
// Query Schemas
// ============================================================================

export const listSubscribersQuerySchema = paginationSchema.extend({
  tierId: uuidSchema.optional(),
  status: subscriptionStatusEnum.optional(),
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
export type ListSubscribersQueryInput = z.infer<
  typeof listSubscribersQuerySchema
>;

export type ConnectOnboardInput = z.infer<typeof connectOnboardSchema>;
