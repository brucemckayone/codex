/**
 * E-commerce API Worker
 *
 * Handles e-commerce functionality including Stripe webhook events,
 * checkout session creation, and purchase management.
 *
 * Security Features:
 * - Request tracking (UUID request IDs, IP tracking, user agent)
 * - Security headers (CSP, XFO, etc.)
 * - Rate limiting for webhook endpoints
 * - Stripe signature verification
 * - No authentication required for webhooks (Stripe signature serves as auth)
 *
 * Note: This worker uses custom Hono setup instead of createWorker
 * because it requires StripeWebhookEnv with Stripe-specific variables.
 */

import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import {
  createHealthCheckHandler,
  createKvCheck,
  createNotFoundHandler,
  createObservabilityErrorHandler,
  createStandardMiddlewareChain,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { handleCheckoutCompleted } from './handlers/checkout';
import { verifyStripeSignature } from './middleware/verify-signature';
import checkout from './routes/checkout';
import type { StripeWebhookEnv } from './types';
import { createWebhookHandler } from './utils/webhook-handler';

// ============================================================================
// Application Setup
// ============================================================================

const app = new Hono<StripeWebhookEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

/**
 * Global middleware chain
 * Applies request tracking, logging, security headers, and observability to all routes
 */
const globalMiddleware = createStandardMiddlewareChain({
  serviceName: 'ecom-api',
  enableObservability: true,
});

for (const middleware of globalMiddleware) {
  app.use('*', middleware);
}

// Rate limiting for webhook endpoints
app.use('/webhooks/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.webhook, // 1000 req/min
  })(c, next);
});

// ============================================================================
// Error Handling
// ============================================================================

app.onError(createObservabilityErrorHandler('ecom-api'));
app.notFound(createNotFoundHandler());

// ============================================================================
// Health Check Endpoints
// ============================================================================

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'ecom-api' });
});

app.get(
  '/health',
  createHealthCheckHandler('ecom-api', '1.0.0', {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
  })
);

// ============================================================================
// API Routes
// ============================================================================

/**
 * Checkout routes
 * Handles Stripe Checkout session creation for purchases
 */
app.route('/checkout', checkout);

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
 * Handles: checkout.session.completed
 */
app.post(
  '/webhooks/stripe/booking',
  verifyStripeSignature(),
  createWebhookHandler('Booking', handleCheckoutCompleted)
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
