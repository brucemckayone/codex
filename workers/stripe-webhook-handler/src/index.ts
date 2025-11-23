/**
 * Stripe Webhook Handler Worker
 *
 * Processes Stripe webhook events with signature verification,
 * observability, and security features.
 *
 * Security Features:
 * - Request tracking (UUID request IDs, IP tracking, user agent)
 * - Security headers (CSP, XFO, etc.)
 * - Rate limiting for webhook endpoints
 * - Stripe signature verification
 * - No authentication required (Stripe signature serves as auth)
 *
 * Note: This worker uses custom Hono setup instead of createWorker
 * because it requires StripeWebhookEnv with Stripe-specific variables.
 */

import { testDbConnection } from '@codex/database';
import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import {
  createHealthCheckHandler,
  createKvCheck,
  createLoggerMiddleware,
  createNotFoundHandler,
  createObservabilityErrorHandler,
  createObservabilityMiddleware,
  createRequestTrackingMiddleware,
  createSecurityHeadersMiddleware,
} from '@codex/worker-utils';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { verifyStripeSignature } from './middleware/verify-signature';
import type { StripeWebhookEnv } from './types';
import { createWebhookHandler } from './utils/webhook-handler';

// ============================================================================
// Application Setup
// ============================================================================

const app = new Hono<StripeWebhookEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

// Request tracking (request ID, IP, user agent)
app.use('*', createRequestTrackingMiddleware());

// Logging
app.use('*', createLoggerMiddleware());

// Security headers
app.use('*', createSecurityHeadersMiddleware());

// Observability middleware for all routes
app.use('*', createObservabilityMiddleware('stripe-webhook-handler'));

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

app.onError(createObservabilityErrorHandler('stripe-webhook-handler'));
app.notFound(createNotFoundHandler());

// ============================================================================
// Health Check Endpoints
// ============================================================================

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'stripe-webhook-handler' });
});

app.get(
  '/health',
  createHealthCheckHandler('stripe-webhook-handler', '1.0.0', {
    checkDatabase: async (_c: Context) => {
      const isConnected = await testDbConnection();
      return {
        status: isConnected ? 'ok' : 'error',
        message: isConnected
          ? 'Database connection is healthy.'
          : 'Database connection failed.',
      };
    },
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
  })
);

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
