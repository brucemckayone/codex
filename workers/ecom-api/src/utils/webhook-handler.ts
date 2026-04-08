/**
 * Webhook Handler Factory
 *
 * Creates standardized webhook handlers with logging and error handling.
 * Eliminates duplication across webhook endpoints.
 */

import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';
import { isTransientError } from './error-classification';

/**
 * Webhook handler function type
 */
type WebhookHandler = (
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) => Promise<void> | void;

/**
 * Create a webhook handler with standard logging and error handling
 *
 * @param eventType - Type of webhook event (e.g., 'Payment', 'Subscription')
 * @param handler - Optional handler function for processing the event
 * @returns Hono handler function
 *
 * @example
 * ```typescript
 * app.post(
 *   '/webhooks/stripe/payment',
 *   verifyStripeSignature(),
 *   createWebhookHandler('Payment', async (event, stripe, c) => {
 *     // Handle payment event
 *     await processPaymentEvent(event);
 *   })
 * );
 * ```
 */
export function createWebhookHandler(
  eventType: string,
  handler?: WebhookHandler
) {
  return async (c: Context<StripeWebhookEnv>) => {
    const obs = c.get('obs');
    const event = c.get('stripeEvent');
    const stripe = c.get('stripe');

    obs?.info(`${eventType} webhook received`, {
      type: event.type,
      id: event.id,
    });

    try {
      // Execute custom handler if provided
      if (handler) {
        await handler(event, stripe, c);
      }

      return c.json({ received: true });
    } catch (error) {
      const err = error as Error;

      if (isTransientError(error)) {
        // Transient failure — return 500 so Stripe retries with exponential backoff
        obs?.error(`${eventType} webhook transient error (will retry)`, {
          error: err.message,
          eventType: event.type,
          eventId: event.id,
        });
        return c.json({ error: 'Temporary failure' }, 500);
      }

      // Permanent failure — acknowledge receipt to prevent futile retries
      obs?.warn(`${eventType} webhook permanent error (acknowledged)`, {
        error: err.message,
        eventType: event.type,
        eventId: event.id,
      });
      return c.json({ received: true }, 200);
    }
  };
}
