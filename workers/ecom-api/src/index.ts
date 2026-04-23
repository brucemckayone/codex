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
import { handleConnectWebhook } from './handlers/connect-webhook';
import { handlePaymentWebhook } from './handlers/payment-webhook';
import { handleSubscriptionWebhook } from './handlers/subscription-webhook';
import { verifyStripeSignature } from './middleware/verify-signature';
import checkout from './routes/checkout';
import connect from './routes/connect';
import purchases from './routes/purchases';
import subscriptions from './routes/subscriptions';
import { isDevEnvironment } from './utils/dev-env-guard';
import { routeDevWebhook } from './utils/dev-webhook-router';
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
      'STRIPE_WEBHOOK_SECRET_PAYMENT',
      'STRIPE_WEBHOOK_SECRET_SUBSCRIPTION',
      'STRIPE_WEBHOOK_SECRET_CONNECT',
      'RATE_LIMIT_KV',
    ],
    optional: [
      'ENVIRONMENT',
      'WEB_APP_URL',
      'API_URL',
      // Customer webhook is a logging stub only.
      // Dispute webhook is handled by handlePaymentWebhook (Codex-sxu5a) —
      // in production the endpoint has its own signing secret; in dev the
      // dev router forwards all `charge.*` events to the payment handler.
      'STRIPE_WEBHOOK_SECRET_CUSTOMER',
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

/**
 * Subscription routes
 * Handles subscription checkout, management, and queries
 */
app.route('/subscriptions', subscriptions);

/**
 * Connect routes
 * Handles Stripe Connect onboarding and account management
 */
app.route('/connect', connect);

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
  createWebhookHandler('Payment', handlePaymentWebhook)
);

/**
 * Subscription events webhook
 * Handles: customer.subscription.*, invoice.*
 */
app.post(
  '/webhooks/stripe/subscription',
  verifyStripeSignature(),
  createWebhookHandler('Subscription', handleSubscriptionWebhook)
);

/**
 * Connect events webhook
 * Handles: account.*, capability.*, person.*
 */
app.post(
  '/webhooks/stripe/connect',
  verifyStripeSignature(),
  createWebhookHandler('Connect', handleConnectWebhook)
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
 * Handles: charge.dispute.created (via handlePaymentWebhook — Codex-sxu5a)
 *
 * Other dispute lifecycle events (charge.dispute.updated, closed,
 * funds_reinstated, funds_withdrawn) and radar.early_fraud_warning.* are
 * still logging-only and flow through the switch's `default` branch inside
 * `handlePaymentWebhook`.
 */
app.post(
  '/webhooks/stripe/dispute',
  verifyStripeSignature(),
  createWebhookHandler('Dispute', handlePaymentWebhook)
);

// ============================================================================
// Development Webhook Router
// ============================================================================

/**
 * Dev-only catch-all webhook endpoint
 *
 * The Stripe CLI generates ONE signing secret and forwards ALL events to ONE URL.
 * In production, each endpoint has its own secret configured in the Stripe Dashboard.
 * This endpoint routes events to the correct handler by type.
 *
 * Uses STRIPE_WEBHOOK_SECRET_BOOKING as the signing secret (set all secrets
 * to the same CLI-generated value in .dev.vars for this to work).
 *
 * Usage: stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev
 */
app.post(
  '/webhooks/stripe/dev',
  (c, next) => {
    if (!isDevEnvironment(c.env.ENVIRONMENT)) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        404
      );
    }
    return next();
  },
  verifyStripeSignature(),
  createWebhookHandler('Dev', routeDevWebhook)
);

export default app;
