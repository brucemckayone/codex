/**
 * Development Webhook Router
 *
 * In production, Stripe sends events to separate endpoints with per-endpoint
 * signing secrets. In local development, the Stripe CLI generates ONE signing
 * secret and forwards ALL events to ONE URL.
 *
 * This router solves that mismatch: it accepts all events on a single endpoint
 * and dispatches them to the correct handler based on event type.
 *
 * Production endpoints are unchanged — this is dev-only.
 *
 * Usage:
 *   stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev
 */

import { STRIPE_EVENTS } from '@codex/constants';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { handleCheckoutCompleted } from '../handlers/checkout';
import { handleConnectWebhook } from '../handlers/connect-webhook';
import { handlePaymentWebhook } from '../handlers/payment-webhook';
import { handleSubscriptionWebhook } from '../handlers/subscription-webhook';
import type { StripeWebhookEnv } from '../types';

/** Map event type prefixes/names to handler functions */
const EVENT_ROUTES: Array<{
  match: (type: string) => boolean;
  label: string;
  handler: (
    event: Stripe.Event,
    stripe: Stripe,
    c: Context<StripeWebhookEnv>
  ) => Promise<void> | void;
}> = [
  {
    // checkout.session.completed → both purchase and subscription handlers.
    // In production Stripe sends this event to both endpoints independently;
    // each handler filters by session.mode (payment vs subscription).
    match: (type) => type === STRIPE_EVENTS.CHECKOUT_COMPLETED,
    label: 'Checkout (dual dispatch)',
    handler: async (event, stripe, c) => {
      await handleCheckoutCompleted(event, stripe, c);
      await handleSubscriptionWebhook(event, stripe, c);
    },
  },
  {
    // customer.subscription.* and invoice.* → subscription handler
    match: (type) =>
      type.startsWith('customer.subscription.') || type.startsWith('invoice.'),
    label: 'Subscription',
    handler: handleSubscriptionWebhook,
  },
  {
    // charge.* and payment_intent.* → payment handler
    match: (type) =>
      type.startsWith('charge.') || type.startsWith('payment_intent.'),
    label: 'Payment',
    handler: handlePaymentWebhook,
  },
  {
    // account.* → connect handler
    match: (type) => type.startsWith('account.'),
    label: 'Connect',
    handler: handleConnectWebhook,
  },
];

/**
 * Route a verified Stripe event to the correct handler.
 * Logs which handler was dispatched (or "Unhandled" if none matched).
 */
export async function routeDevWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  const obs = c.get('obs');

  for (const route of EVENT_ROUTES) {
    if (route.match(event.type)) {
      obs?.info(`Dev router → ${route.label} handler`, {
        type: event.type,
        id: event.id,
      });
      await route.handler(event, stripe, c);
      return;
    }
  }

  obs?.info('Dev router: no handler for event type', {
    type: event.type,
    id: event.id,
  });
}
