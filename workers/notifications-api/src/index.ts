/**
 * Notifications API Worker
 *
 * Minimal Cloudflare Worker placeholder for future notification endpoints.
 * Currently provides only health check endpoint.
 *
 * Security Features:
 * - Rate limiting via KV namespace
 * - Security headers (CSP, XFO, etc.)
 * - Error sanitization (no internal details exposed)
 *
 * Architecture:
 * - Hono framework for routing and middleware
 * - @codex/database for data persistence (HTTP client)
 * - @codex/worker-utils for standardized worker setup
 *
 * Routes:
 * - /health - Health check endpoint (public)
 */

import {
  createKvCheck,
  createWorker,
  standardDatabaseCheck,
} from '@codex/worker-utils';

import { createEnvValidationMiddleware } from './utils/validate-env';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'notifications-api',
  version: '1.0.0',
  enableRequestTracking: true,
  enableLogging: true,
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
  },
});

/**
 * Environment validation
 * Validates required environment variables on first request
 * Runs once per worker instance (not per request)
 */
app.use('*', createEnvValidationMiddleware());

// ============================================================================
// Export
// ============================================================================

export default app;
