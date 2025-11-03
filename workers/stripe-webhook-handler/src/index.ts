import { Hono } from 'hono';
import type Stripe from 'stripe';
import type { KVNamespace } from '@cloudflare/workers-types';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
import {
  securityHeaders,
  CSP_PRESETS,
  rateLimit,
  RATE_LIMIT_PRESETS,
} from '@codex/security';
import { verifyStripeSignature } from './middleware/verify-signature';

type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION?: string;
  STRIPE_WEBHOOK_SECRET_CONNECT?: string;
  STRIPE_WEBHOOK_SECRET_CUSTOMER?: string;
  STRIPE_WEBHOOK_SECRET_BOOKING?: string;
  STRIPE_WEBHOOK_SECRET_DISPUTE?: string;
  RATE_LIMIT_KV?: KVNamespace;
};

type Variables = {
  stripeEvent: Stripe.Event;
  stripe: Stripe;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Security headers middleware
app.use('*', (c, next) => {
  return securityHeaders({
    environment: c.env?.ENVIRONMENT || 'development',
    csp: CSP_PRESETS.api, // Restrictive CSP for API worker
  })(c, next);
});

// Rate limiting middleware (webhook endpoints can be high volume)
app.use('*', (c, next) => {
  return rateLimit({
    kv: c.env?.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.webhook,
  })(c, next);
});

// Request timing middleware
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error handling
app.onError((err, c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  obs.trackError(err, { url: c.req.url, method: c.req.method });
  return c.text('Internal Server Error', 500);
});

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'stripe-webhook-handler' });
});

app.get('/health', (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  obs.info('Health check endpoint hit');

  // ✅ SECURE: Don't leak secret configuration in logs/responses
  return c.json({
    status: 'healthy',
    worker: 'stripe-webhook-handler',
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ========================================
// Webhook Endpoints with Signature Verification
// ========================================

/**
 * Payment events webhook
 * Handles: payment_intent.*, charge.*
 */
app.post('/webhooks/stripe/payment', verifyStripeSignature(), async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const event = c.get('stripeEvent') as Stripe.Event;

  obs.info('Payment webhook received', {
    type: event.type,
    id: event.id,
  });

  // TODO: Implement payment event handlers
  // See: workers/stripe-webhook-handler/src/handlers/payment.ts (to be created)

  return c.json({ received: true });
});

/**
 * Subscription events webhook
 * Handles: customer.subscription.*, invoice.*
 */
app.post(
  '/webhooks/stripe/subscription',
  verifyStripeSignature(),
  async (c) => {
    const obs = new ObservabilityClient(
      'stripe-webhook-handler',
      c.env.ENVIRONMENT || 'development'
    );
    const event = c.get('stripeEvent') as Stripe.Event;

    obs.info('Subscription webhook received', {
      type: event.type,
      id: event.id,
    });

    // TODO: Implement subscription event handlers

    return c.json({ received: true });
  }
);

/**
 * Connect events webhook
 * Handles: account.*, capability.*, person.*
 */
app.post('/webhooks/stripe/connect', verifyStripeSignature(), async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const event = c.get('stripeEvent') as Stripe.Event;

  obs.info('Connect webhook received', {
    type: event.type,
    id: event.id,
  });

  // TODO: Implement Connect event handlers

  return c.json({ received: true });
});

/**
 * Customer events webhook
 * Handles: customer.created, customer.updated, customer.deleted
 */
app.post('/webhooks/stripe/customer', verifyStripeSignature(), async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const event = c.get('stripeEvent') as Stripe.Event;

  obs.info('Customer webhook received', {
    type: event.type,
    id: event.id,
  });

  // TODO: Implement customer event handlers

  return c.json({ received: true });
});

/**
 * Booking events webhook
 * Handles: checkout.session.*
 */
app.post('/webhooks/stripe/booking', verifyStripeSignature(), async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const event = c.get('stripeEvent') as Stripe.Event;

  obs.info('Booking webhook received', {
    type: event.type,
    id: event.id,
  });

  // TODO: Implement booking event handlers

  return c.json({ received: true });
});

/**
 * Dispute events webhook
 * Handles: charge.dispute.*, radar.early_fraud_warning.*
 */
app.post('/webhooks/stripe/dispute', verifyStripeSignature(), async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const event = c.get('stripeEvent') as Stripe.Event;

  obs.info('Dispute webhook received', {
    type: event.type,
    id: event.id,
  });

  // TODO: Implement dispute event handlers

  return c.json({ received: true });
});

export default app;
