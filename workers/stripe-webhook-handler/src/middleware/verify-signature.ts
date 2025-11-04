import type { Context, Next } from 'hono';
import Stripe from 'stripe';
import { ObservabilityClient } from '@codex/observability';

type Bindings = {
  ENVIRONMENT?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION?: string;
  STRIPE_WEBHOOK_SECRET_CONNECT?: string;
  STRIPE_WEBHOOK_SECRET_CUSTOMER?: string;
  STRIPE_WEBHOOK_SECRET_BOOKING?: string;
  STRIPE_WEBHOOK_SECRET_DISPUTE?: string;
};

type Variables = {
  stripeEvent: Stripe.Event;
  stripe: Stripe;
};

/**
 * Get the appropriate webhook secret based on the endpoint path
 */
function getWebhookSecret(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
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
 * CRITICAL SECURITY: This middleware MUST be applied to all webhook endpoints.
 * It prevents webhook spoofing by verifying the Stripe signature header.
 *
 * @see https://stripe.com/docs/webhooks/signatures
 */
export function verifyStripeSignature() {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const obs = new ObservabilityClient(
      'stripe-webhook-handler',
      c.env.ENVIRONMENT || 'development'
    );

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

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-10-29.clover',
    });

    // Verify signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

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
