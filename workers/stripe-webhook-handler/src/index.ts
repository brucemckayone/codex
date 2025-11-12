/**
 * Stripe Webhook Handler Worker
 *
 * Processes Stripe webhook events with signature verification,
 * observability, and security features.
 */

import { Hono, Context, Next } from 'hono';
import {
  securityHeaders,
  CSP_PRESETS,
  rateLimit,
  RATE_LIMIT_PRESETS,
} from '@codex/security';
import { sequence } from '@codex/worker-utils';

import type { StripeWebhookEnv } from './types';
import { verifyStripeSignature } from './middleware/verify-signature';
import {
  createObservabilityMiddleware,
  createObservabilityErrorHandler,
} from './middleware/observability';
import { createWebhookHandler } from './utils/webhook-handler';

const app = new Hono<StripeWebhookEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

/**
 * Security headers middleware wrapper
 * Applies restrictive CSP for API worker
 */
const securityHeadersMiddleware = (
  c: Context<StripeWebhookEnv>,
  next: Next
) => {
  return securityHeaders({
    environment: c.env?.ENVIRONMENT || 'development',
    csp: CSP_PRESETS.api,
  })(c, next);
};

/**
 * Rate limiting middleware wrapper
 * Webhooks can be high volume, use appropriate presets
 */
const rateLimitMiddleware = (c: Context<StripeWebhookEnv>, next: Next) => {
  return rateLimit({
    kv: c.env?.RATE_LIMIT_KV as any,
    ...RATE_LIMIT_PRESETS.webhook,
  })(c, next);
};

// Apply global middleware in sequence
app.use(
  '*',
  sequence(
    securityHeadersMiddleware,
    rateLimitMiddleware,
    createObservabilityMiddleware()
  )
);

// ============================================================================
// Error Handling
// ============================================================================

app.onError(createObservabilityErrorHandler('stripe-webhook-handler'));

// ============================================================================
// Health Check Endpoints
// ============================================================================

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'stripe-webhook-handler' });
});

app.get('/health', (c) => {
  const obs = c.get('obs');
  obs.info('Health check endpoint hit');

  // ✅ SECURE: Don't leak secret configuration in logs/responses
  return c.json({
    status: 'healthy',
    worker: 'stripe-webhook-handler',
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Webhook Endpoints
// ============================================================================

/**
 * Payment events webhook
 * Handles: payment_intent.*, charge.*
 */
app.post(
  '/webhooks/stripe/payment',
  verifyStripeSignature(),
  createWebhookHandler('Payment')
  // TODO: Add handler: async (event, stripe, c) => { /* process payment */ }
);

/**
 * Subscription events webhook
 * Handles: customer.subscription.*, invoice.*
 */
app.post(
  '/webhooks/stripe/subscription',
  verifyStripeSignature(),
  createWebhookHandler('Subscription')
  // TODO: Add handler: async (event, stripe, c) => { /* process subscription */ }
);

/**
 * Connect events webhook
 * Handles: account.*, capability.*, person.*
 */
app.post(
  '/webhooks/stripe/connect',
  verifyStripeSignature(),
  createWebhookHandler('Connect')
  // TODO: Add handler: async (event, stripe, c) => { /* process connect */ }
);

/**
 * Customer events webhook
 * Handles: customer.created, customer.updated, customer.deleted
 */
app.post(
  '/webhooks/stripe/customer',
  verifyStripeSignature(),
  createWebhookHandler('Customer')
  // TODO: Add handler: async (event, stripe, c) => { /* process customer */ }
);

/**
 * Booking events webhook
 * Handles: checkout.session.*
 */
app.post(
  '/webhooks/stripe/booking',
  verifyStripeSignature(),
  createWebhookHandler('Booking')
  // TODO: Add handler: async (event, stripe, c) => { /* process booking */ }
);

/**
 * Dispute events webhook
 * Handles: charge.dispute.*, radar.early_fraud_warning.*
 */
app.post(
  '/webhooks/stripe/dispute',
  verifyStripeSignature(),
  createWebhookHandler('Dispute')
  // TODO: Add handler: async (event, stripe, c) => { /* process dispute */ }
);

export default app;
