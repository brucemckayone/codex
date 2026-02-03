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

import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';

// Import route modules
import previewRoutes from './routes/preview';
import templateRoutes from './routes/templates';

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
    required: ['DATABASE_URL', 'RATE_LIMIT_KV'],
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
// API Routes
// ============================================================================

/**
 * Mount API routes
 * Template routes for CRUD operations
 * Preview routes for template testing
 */
app.route('/api/templates', templateRoutes);
app.route('/api/templates', previewRoutes);

// ============================================================================
// Export
// ============================================================================

export default app;
