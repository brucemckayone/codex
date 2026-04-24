export const STRIPE_EVENTS = {
  // Purchase (Phase 1)
  CHECKOUT_COMPLETED: 'checkout.session.completed',
  // Subscription lifecycle
  SUBSCRIPTION_CREATED: 'customer.subscription.created',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  SUBSCRIPTION_PAUSED: 'customer.subscription.paused',
  SUBSCRIPTION_RESUMED: 'customer.subscription.resumed',
  SUBSCRIPTION_TRIAL_WILL_END: 'customer.subscription.trial_will_end',
  // Invoices (subscription renewals)
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  // Connect
  ACCOUNT_UPDATED: 'account.updated',
  ACCOUNT_DEAUTHORIZED: 'account.application.deauthorized',
  // Refunds
  CHARGE_REFUNDED: 'charge.refunded',
  // Disputes (treated as refunds for access purposes — purchase.disputedAt
  // is set and contentAccess is soft-deleted via processDispute)
  CHARGE_DISPUTE_CREATED: 'charge.dispute.created',
  // Dashboard-drift detection + sync-back: tier metadata edited outside
  // Codex (e.g. in Stripe Dashboard) mirrors back into subscriptionTiers.
  // product.updated → mirror name/description.
  // price.created   → adopt as canonical for the tier+interval, archive old.
  // price.updated   → log-only (archive-without-replacement is operator drift).
  // Q1 product decision: Dashboard editing is in-bounds and auto-propagates.
  PRODUCT_UPDATED: 'product.updated',
  PRICE_CREATED: 'price.created',
  PRICE_UPDATED: 'price.updated',
} as const;

export const PURCHASE_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
  INCOMPLETE: 'incomplete',
  PAUSED: 'paused',
} as const;

/**
 * Structured churn-reason taxonomy for subscription cancellation (Q7).
 *
 * Persisted on `subscriptions.churn_reason` alongside the existing free-text
 * `cancel_reason`. The 'other' option is the only value that requires the
 * free-text field to be set — all others can stand alone.
 *
 * This const is the single source of truth for the allowed values, shared
 * between the DB CHECK constraint (packages/database) and the Zod enum
 * (packages/validation) so a taxonomy change touches exactly one file.
 */
export const CHURN_REASON = {
  TOO_EXPENSIVE: 'too_expensive',
  NOT_ENOUGH_CONTENT: 'not_enough_content',
  FOUND_ALTERNATIVE: 'found_alternative',
  NOT_USING_IT: 'not_using_it',
  TECHNICAL_ISSUES: 'technical_issues',
  OTHER: 'other',
} as const;

export const CHURN_REASON_VALUES = Object.values(CHURN_REASON) as [
  string,
  ...string[],
];

export type ChurnReason = (typeof CHURN_REASON)[keyof typeof CHURN_REASON];

export const BILLING_INTERVAL = {
  MONTH: 'month',
  YEAR: 'year',
} as const;

export const CONNECT_ACCOUNT_STATUS = {
  ONBOARDING: 'onboarding',
  ACTIVE: 'active',
  RESTRICTED: 'restricted',
  DISABLED: 'disabled',
} as const;

export const FEES = {
  PLATFORM_PERCENT: 1000, // 10.00% of gross
  ORG_PERCENT: 0, // 0% for one-time purchases
  SUBSCRIPTION_ORG_PERCENT: 1500, // 15.00% of post-platform-fee for subscriptions
} as const;

export const CURRENCY = {
  GBP: 'gbp',
  USD: 'usd',
  EUR: 'eur',
} as const;
