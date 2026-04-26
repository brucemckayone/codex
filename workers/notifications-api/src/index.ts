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
import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';
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
// Export (with Cron Trigger support for weekly digest)
// ============================================================================

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Record<string, unknown>,
    ctx: ExecutionContext
  ) {
    // Weekly digest cron handler
    // Configured in wrangler.toml: crons = ["0 9 * * 1"] (Monday 09:00 UTC)
    // TODO: Implement handleWeeklyDigest — query opted-in users,
    // fetch new content from last 7 days, batch-send digest emails.
  },
};
