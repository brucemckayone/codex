/**
 * Webhook Error Classification
 *
 * Classifies errors as transient (Stripe should retry) vs permanent (acknowledge receipt).
 *
 * Conservative default: unknown errors are treated as permanent to prevent retry storms.
 * Only explicitly recognized transient patterns return true.
 *
 * Transient errors return 500 → Stripe retries with exponential backoff (~24h total).
 * Permanent errors return 200 → Stripe considers the webhook delivered.
 */

import { ServiceError } from '@codex/service-errors';

/** Stripe error type strings (from stripe-node SDK) */
const TRANSIENT_STRIPE_TYPES = new Set([
  'StripeAPIError',
  'StripeConnectionError',
  'StripeRateLimitError',
]);

/** Network/DB error message patterns indicating transient failures */
const TRANSIENT_MESSAGE_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'connection',
  'timeout',
  'socket hang up',
  'fetch failed',
] as const;

/**
 * Determine if an error is transient (should trigger Stripe retry).
 *
 * Returns true for: DB connection failures, Stripe server errors (5xx),
 * Stripe rate limits, and network errors.
 *
 * Returns false for: business logic errors (ServiceError subclasses),
 * Stripe client errors (4xx), and anything unrecognized.
 */
export function isTransientError(error: unknown): boolean {
  // ServiceError subclasses are always business logic (permanent)
  if (error instanceof ServiceError) {
    return false;
  }

  if (error instanceof Error) {
    // Check for Stripe SDK error types
    const stripeType = (error as { type?: string }).type;
    if (stripeType && TRANSIENT_STRIPE_TYPES.has(stripeType)) {
      // StripeAPIError is only transient for 5xx status codes
      if (stripeType === 'StripeAPIError') {
        const statusCode = (error as { statusCode?: number }).statusCode;
        return statusCode !== undefined && statusCode >= 500;
      }
      return true;
    }

    // Check message for network/DB transient patterns
    const msg = error.message.toLowerCase();
    for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
      if (msg.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  // Conservative default: unknown errors are permanent
  return false;
}
