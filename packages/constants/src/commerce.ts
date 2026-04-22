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
