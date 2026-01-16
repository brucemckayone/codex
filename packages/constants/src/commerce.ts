export const STRIPE_EVENTS = {
  CHECKOUT_COMPLETED: 'checkout.session.completed',
} as const;

export const FEES = {
  PLATFORM_PERCENT: 1000, // 10.00%
} as const;

export const CURRENCY = {
  USD: 'usd',
  EUR: 'eur',
} as const;
