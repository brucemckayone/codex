/**
 * Stripe Signature Verification Middleware
 *
 * CRITICAL SECURITY: Verifies Stripe webhook signatures to prevent spoofing.
 * This middleware MUST be applied to all webhook endpoints.
 *
 * @see https://stripe.com/docs/webhooks/signatures
 */

import { createStripeClient, verifyWebhookSignature } from '@codex/purchase';
import type { Context, Next } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

/**
 * Get the appropriate webhook secret based on the endpoint path
 */
function getWebhookSecret(
  c: Context<StripeWebhookEnv>,
  path: string
): string | undefined {
  if (path.includes('/payment')) {
    return c.env.STRIPE_WEBHOOK_SECRET_PAYMENT;
  } else if (path.includes('/subscription')) {
    return c.env.STRIPE_WEBHOOK_SECRET_SUBSCRIPTION;
  } else if (path.includes('/connect')) {
    return c.env.STRIPE_WEBHOOK_SECRET_CONNECT;
  } else if (path.includes('/customer')) {
    return c.env.STRIPE_WEBHOOK_SECRET_CUSTOMER;
  } else if (path.includes('/booking')) {
    return c.env.STRIPE_WEBHOOK_SECRET_BOOKING;
  } else if (path.includes('/dispute')) {
    return c.env.STRIPE_WEBHOOK_SECRET_DISPUTE;
  }
  return undefined;
}

/**
 * Middleware to verify Stripe webhook signatures
 *
 * Verifies the Stripe signature header and constructs the event.
 * On success, sets stripeEvent and stripe in context.
 * On failure, returns 400/401 error response.
 *
 * @returns Hono middleware handler
 */
export function verifyStripeSignature() {
  return async (c: Context<StripeWebhookEnv>, next: Next) => {
    const obs = c.get('obs');

    // Get signature from headers
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      obs.warn('Webhook rejected: Missing stripe-signature header', {
        path: c.req.path,
        method: c.req.method,
      });
      return c.json({ error: 'Missing signature' }, 400);
    }

    // Get raw body (CRITICAL: must be raw, not parsed JSON)
    const rawBody = await c.req.text();

    // Get the appropriate webhook secret for this endpoint
    const webhookSecret = getWebhookSecret(c, c.req.path);
    if (!webhookSecret) {
      obs.error('Webhook rejected: No webhook secret configured', {
        path: c.req.path,
      });
      return c.json({ error: 'Webhook secret not configured' }, 500);
    }

    // Initialize Stripe client
    if (!c.env.STRIPE_SECRET_KEY) {
      obs.error('Webhook rejected: STRIPE_SECRET_KEY not configured');
      return c.json({ error: 'Stripe not configured' }, 500);
    }

    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);

    // Verify signature
    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(rawBody, signature, webhookSecret, stripe);

      obs.info('Webhook signature verified', {
        type: event.type,
        id: event.id,
        path: c.req.path,
      });

      // Store the verified event in the context for handlers to use
      c.set('stripeEvent', event);
      c.set('stripe', stripe);

      await next();
    } catch (err) {
      const error = err as Error;
      obs.error('Webhook signature verification failed', {
        error: error.message,
        path: c.req.path,
        signaturePrefix: signature.substring(0, 20),
      });
      return c.json({ error: 'Invalid signature' }, 401);
    }
  };
}
