export const STRIPE_EVENTS = {
  CHECKOUT_COMPLETED: 'checkout.session.completed',
} as const;

export const PURCHASE_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

export const FEES = {
  PLATFORM_PERCENT: 1000, // 10.00%
  ORG_PERCENT: 0, // 0%
} as const;

export const CURRENCY = {
  USD: 'usd',
  EUR: 'eur',
} as const;
