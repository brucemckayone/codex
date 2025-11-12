/**
 * Stripe Webhook Handler Worker
 *
 * Processes Stripe webhook events with signature verification,
 * observability, and security features.
 */

import { Hono } from 'hono';
import {
  sequence,
  createObservabilityMiddleware,
  createObservabilityErrorHandler,
  createSecurityHeadersWrapper,
  createRateLimitWrapper,
} from '@codex/worker-utils';
import { CSP_PRESETS } from '@codex/security';

import type { StripeWebhookEnv } from './types';
import { verifyStripeSignature } from './middleware/verify-signature';
import { createWebhookHandler } from './utils/webhook-handler';

const app = new Hono<StripeWebhookEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

app.use(
  '*',
  sequence(
    createSecurityHeadersWrapper({ csp: CSP_PRESETS.api }),
    createRateLimitWrapper('webhook'),
    createObservabilityMiddleware('stripe-webhook-handler')
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
