/**
 * Notifications API Worker
 *
 * Cloudflare Worker for email template management and sending.
 *
 * Security Features:
 * - Rate limiting via KV namespace
 * - Security headers (CSP, XFO, etc.)
 * - Error sanitization (no internal details exposed)
 *
 * Architecture:
 * - Hono framework for routing and middleware
 * - @codex/database for data persistence (HTTP client)
 * - @codex/notifications for email sending
 * - @codex/worker-utils for standardized worker setup
 *
 * Routes:
 * - /health - Health check endpoint (public)
 * - /api/templates/* - Template management endpoints
 */

import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import { dispatchScheduled } from './handlers/agreement-expiring-sweep';
// Import route modules
import internalRoutes from './routes/internal';
import previewRoutes from './routes/preview';
import templateRoutes from './routes/templates';
import unsubscribeRoutes from './routes/unsubscribe';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'notifications-api',
  version: '1.0.0',
  enableRequestTracking: true,
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false, // Using route-level procedure() instead
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
  },
});

/**
 * Environment validation
 * Validates required environment variables on first request
 * Runs once per worker instance (not per request)
 */
app.use(
  '*',
  createEnvValidationMiddleware({
    required: ['DATABASE_URL', 'RATE_LIMIT_KV', 'WORKER_SHARED_SECRET'],
    optional: [
      'ENVIRONMENT',
      'WEB_APP_URL',
      'API_URL',
      'FROM_EMAIL',
      'FROM_NAME',
      'USE_MOCK_EMAIL',
      'RESEND_API_KEY',
      'MAILHOG_URL',
    ],
  })
);

// ============================================================================
// Custom Middleware
// ============================================================================

/**
 * Rate limit unsubscribe endpoints (CAN-SPAM/GDPR public routes).
 *
 * The /unsubscribe/* routes bypass procedure() because they use HMAC-token
 * verification rather than session auth. Without this middleware they would
 * have NO rate-limit protection — every request forces an HMAC verification
 * cycle and the POST mutates `notification_preferences`. Without a limit:
 *   - DoS via repeated POST /unsubscribe/<random> (HMAC verify per request)
 *   - DB write amplification on the hot preferences upsert path
 *   - Token-format enumeration via HMAC timing
 *
 * Uses the `api` preset (100 req/min) — permissive enough for legitimate
 * humans retrying an unsubscribe link, tight enough to stop scripted DoS.
 * Keyed per-IP per-route via the default keyGenerator (CF-Connecting-IP).
 *
 * Mounted BEFORE app.route('/unsubscribe', ...) so it intercepts every
 * request to that subtree. See denoise iter-002 F2 (Codex-ttavz.8).
 */
app.use('/unsubscribe/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api,
  })(c, next);
});

// ============================================================================
// API Routes
// ============================================================================

/**
 * Mount API routes
 * Template routes for CRUD operations
 * Preview routes for template testing
 * Preferences routes for user notification settings
 */
app.route('/api/templates', templateRoutes);
app.route('/api/templates', previewRoutes);
app.route('/internal', internalRoutes);
app.route('/unsubscribe', unsubscribeRoutes);
// ============================================================================
// Export (with Cron Trigger support)
// ============================================================================

export default {
  fetch: app.fetch,
  scheduled(
    controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext
  ): void {
    // Cron expressions live in wrangler.jsonc → triggers.crons.
    // Currently configured: `0 8 * * *` (daily 08:00 UTC) — fires the
    // agreement-expiring-soon sweep (Codex-tugez). Future schedules
    // (weekly digest, etc.) get added to the array and discriminated
    // by `controller.cron` inside dispatchScheduled.
    dispatchScheduled(controller, env, ctx);
  },
};
