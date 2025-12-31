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
 * Configuration:
 * - enableGlobalAuth: false (webhooks use signature auth, checkout uses procedure())
 */

import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import { handleCheckoutCompleted } from './handlers/checkout';
import { verifyStripeSignature } from './middleware/verify-signature';
import checkout from './routes/checkout';
import purchases from './routes/purchases';
import { createWebhookHandler } from './utils/webhook-handler';

// ============================================================================
// Application Setup
// ============================================================================

/**
 * Create worker with standard middleware
 *
 * Configuration:
 * - enableGlobalAuth: false (webhooks don't use session auth)
 * - healthCheck: database and KV checks
 */
const app = createWorker({
  serviceName: 'ecom-api',
  version: '1.0.0',
  enableGlobalAuth: false,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
  },
});

// ============================================================================
// Environment Validation
// ============================================================================

/**
 * Environment validation
 * Validates required environment variables on first request
 * Runs once per worker instance (not per request)
 */
app.use(
  '*',
  createEnvValidationMiddleware({
    required: [
      'DATABASE_URL',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET_BOOKING',
      'RATE_LIMIT_KV',
    ],
    optional: [
      'ENVIRONMENT',
      'WEB_APP_URL',
      'API_URL',
      'STRIPE_WEBHOOK_SECRET_PAYMENT',
      'STRIPE_WEBHOOK_SECRET_SUBSCRIPTION',
      'STRIPE_WEBHOOK_SECRET_CUSTOMER',
      'STRIPE_WEBHOOK_SECRET_CONNECT',
      'STRIPE_WEBHOOK_SECRET_DISPUTE',
    ],
  })
);

// ============================================================================
// Custom Middleware
// ============================================================================

// Rate limiting for webhook endpoints
app.use('/webhooks/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.webhook, // 1000 req/min
  })(c, next);
});

// ============================================================================
// API Routes
// ============================================================================

/**
 * Checkout routes
 * Handles Stripe Checkout session creation for purchases
 */
app.route('/checkout', checkout);

/**
 * Purchase routes
 * Handles purchase listing and retrieval for customers
 */
app.route('/purchases', purchases);

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
);

/**
 * Subscription events webhook
 * Handles: customer.subscription.*, invoice.*
 */
app.post(
  '/webhooks/stripe/subscription',
  verifyStripeSignature(),
  createWebhookHandler('Subscription')
);

/**
 * Connect events webhook
 * Handles: account.*, capability.*, person.*
 */
app.post(
  '/webhooks/stripe/connect',
  verifyStripeSignature(),
  createWebhookHandler('Connect')
);

/**
 * Customer events webhook
 * Handles: customer.created, customer.updated, customer.deleted
 */
app.post(
  '/webhooks/stripe/customer',
  verifyStripeSignature(),
  createWebhookHandler('Customer')
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
);

export default app;
