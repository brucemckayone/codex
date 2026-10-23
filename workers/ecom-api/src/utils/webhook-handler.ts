/**
 * Webhook Handler Factory
 *
 * Creates standardized webhook handlers with logging and error handling.
 * Eliminates duplication across webhook endpoints.
 */

import { isForeignStripeEnvironment } from '@codex/constants';
import { UnsupportedCurrencyError } from '@codex/service-errors';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';
import { describeRootCause, isTransientError } from './error-classification';

/**
 * Webhook handler function type
 */
type WebhookHandler = (
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) => Promise<void> | void;

/**
 * Where OUR metadata sits on an event's object.
 *
 * Almost every object carries it on `metadata`. An invoice is the exception:
 * Stripe snapshots the subscription's metadata into
 * `parent.subscription_details.metadata` when the invoice is created, and the
 * invoice's own `metadata` is never set by us. A charge carries the
 * PaymentIntent's metadata (also a snapshot, taken when the charge is made).
 */
function ownMetadata(event: Stripe.Event): Stripe.Metadata | null {
  const object = event.data.object as {
    object?: string;
    metadata?: Stripe.Metadata | null;
  };
  if (object.object === 'invoice') {
    return (
      (object as Stripe.Invoice).parent?.subscription_details?.metadata ?? null
    );
  }
  return object.metadata ?? null;
}

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

    // Production and local development share one Stripe sandbox and both get
    // every event. An event about an object ANOTHER environment created is
    // acknowledged and ignored before any handler — so before any DB client
    // opens or any row is written (Codex-2hxff.5). Untagged objects (everything
    // created before tagging began) are still processed.
    const environment = c.env.ENVIRONMENT || 'development';
    const metadata = ownMetadata(event);
    if (isForeignStripeEnvironment(metadata, environment)) {
      obs?.info(`${eventType} webhook ignored: another environment's object`, {
        type: event.type,
        id: event.id,
        objectEnvironment: metadata?.codex_env,
        environment,
      });
      return c.json({ received: true });
    }

    try {
      // Execute custom handler if provided
      if (handler) {
        await handler(event, stripe, c);
      }

      return c.json({ received: true });
    } catch (error) {
      const err = error as Error;
      // A service's wrap says only "An unexpected error occurred"; what went
      // wrong is the innermost error it replaced — the driver's, with its
      // SQLSTATE — never drizzle's query text and bound values
      // (Codex-2hxff.6).
      const cause = describeRootCause(error);

      if (isTransientError(error)) {
        // Transient failure — return 500 so Stripe retries with exponential backoff
        obs?.error(`${eventType} webhook transient error (will retry)`, {
          error: err.message,
          cause,
          eventType: event.type,
          eventId: event.id,
        });
        return c.json({ error: 'Temporary failure' }, 500);
      }

      // A payment in a currency the platform does not take was refused before
      // anything was written (assertGbpOnly, Codex-2hxff.23 PAY-25): the
      // buyer has paid and nothing records it. A redelivery cannot change
      // that, so it is acknowledged, but a person must refund it or record it
      // by hand, so it is an error with an id support can quote.
      const unsupported = findUnsupportedCurrency(error);
      if (unsupported) {
        obs?.error(
          `${eventType} webhook: a payment in an unsupported currency was not recorded`,
          {
            errorId: crypto.randomUUID(),
            currency: unsupported.received,
            eventType: event.type,
            eventId: event.id,
            ...(unsupported.context ?? {}),
          }
        );
        return c.json({ received: true }, 200);
      }

      // Permanent failure — acknowledge receipt to prevent futile retries
      obs?.warn(`${eventType} webhook permanent error (acknowledged)`, {
        error: err.message,
        cause,
        eventType: event.type,
        eventId: event.id,
      });
      return c.json({ received: true }, 200);
    }
  };
}

/** The UnsupportedCurrencyError behind `error`, through any `cause` wraps. */
function findUnsupportedCurrency(
  error: unknown
): UnsupportedCurrencyError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof UnsupportedCurrencyError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
