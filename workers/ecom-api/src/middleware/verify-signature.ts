/**
 * Stripe Signature Verification Middleware
 *
 * CRITICAL SECURITY: Verifies Stripe webhook signatures to prevent spoofing.
 * This middleware MUST be applied to all webhook endpoints.
 *
 * @see https://stripe.com/docs/webhooks/signatures
 */

import { createStripeClient, verifyWebhookSignature } from '@codex/purchase';
import type { Bindings } from '@codex/shared-types';
import type { Context, Next } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

type WebhookSecretKey = Extract<
  keyof Bindings,
  `STRIPE_WEBHOOK_SECRET_${string}`
>;

/**
 * Exact-path → env-var lookup. Substring matching (`path.includes('/payment')`)
 * collides if any future route contains those substrings — use explicit paths.
 * Add every webhook path to this table; unit tests assert parity with the
 * registered routes in `src/index.ts`.
 */
const WEBHOOK_SECRET_KEYS: Readonly<Record<string, WebhookSecretKey>> = {
  '/webhooks/stripe/payment': 'STRIPE_WEBHOOK_SECRET_PAYMENT',
  '/webhooks/stripe/subscription': 'STRIPE_WEBHOOK_SECRET_SUBSCRIPTION',
  '/webhooks/stripe/connect': 'STRIPE_WEBHOOK_SECRET_CONNECT',
  '/webhooks/stripe/customer': 'STRIPE_WEBHOOK_SECRET_CUSTOMER',
  '/webhooks/stripe/booking': 'STRIPE_WEBHOOK_SECRET_BOOKING',
  '/webhooks/stripe/dispute': 'STRIPE_WEBHOOK_SECRET_DISPUTE',
  // Dev catch-all reuses the booking secret: in local dev, set every
  // STRIPE_WEBHOOK_SECRET_* to the same CLI-generated value.
  '/webhooks/stripe/dev': 'STRIPE_WEBHOOK_SECRET_BOOKING',
};

export const WEBHOOK_PATHS = Object.keys(WEBHOOK_SECRET_KEYS);

function getWebhookSecret(
  c: Context<StripeWebhookEnv>,
  path: string
): string | undefined {
  const key = WEBHOOK_SECRET_KEYS[path];
  return key ? c.env[key] : undefined;
}

/**
 * Warm-isolate memoisation of the Stripe client. Cloudflare Workers reuse the
 * module scope across requests on the same isolate; re-creating the client per
 * webhook is wasted allocation during renewal-wave bursts.
 */
let cachedStripe: { key: string; client: Stripe } | null = null;

function getStripeClient(apiKey: string): Stripe {
  if (cachedStripe?.key === apiKey) {
    return cachedStripe.client;
  }
  cachedStripe = { key: apiKey, client: createStripeClient(apiKey) };
  return cachedStripe.client;
}

export function _resetStripeClientCacheForTests(): void {
  cachedStripe = null;
}

/**
 * Middleware to verify Stripe webhook signatures
 *
 * Verifies the Stripe signature header and constructs the event.
 * On success, sets stripeEvent and stripe in context.
 * On failure, returns 400/401/501 error response.
 *
 * Error-status policy: 501 (Not Implemented) for configuration gaps so Stripe
 * stops retrying — 5xx would trigger infinite retry storms during a
 * misconfiguration. 400 for malformed requests, 401 for invalid signatures.
 *
 * @returns Hono middleware handler
 */
export function verifyStripeSignature() {
  return async (c: Context<StripeWebhookEnv>, next: Next) => {
    const obs = c.get('obs');

    const signature = c.req.header('stripe-signature');
    if (!signature) {
      obs?.warn('Webhook rejected: Missing stripe-signature header', {
        path: c.req.path,
        method: c.req.method,
      });
      return c.json({ error: 'Missing signature' }, 400);
    }

    const rawBody = await c.req.text();

    const webhookSecret = getWebhookSecret(c, c.req.path);
    if (!webhookSecret) {
      obs?.error('Webhook rejected: No webhook secret configured', {
        path: c.req.path,
      });
      return c.json({ error: 'Webhook secret not configured' }, 501);
    }

    if (!c.env.STRIPE_SECRET_KEY) {
      obs?.error('Webhook rejected: STRIPE_SECRET_KEY not configured');
      return c.json({ error: 'Stripe not configured' }, 501);
    }

    const stripe = getStripeClient(c.env.STRIPE_SECRET_KEY);

    let event: Stripe.Event;
    try {
      event = await verifyWebhookSignature(
        rawBody,
        signature,
        webhookSecret,
        stripe
      );

      obs?.info('Webhook signature verified', {
        type: event.type,
        id: event.id,
        path: c.req.path,
      });

      c.set('stripeEvent', event);
      c.set('stripe', stripe);

      await next();
    } catch (err) {
      const error = err as Error;
      obs?.error('Webhook signature verification failed', {
        error: error.message,
        path: c.req.path,
        signaturePrefix: signature.substring(0, 20),
      });
      return c.json({ error: 'Invalid signature' }, 401);
    }
  };
}
