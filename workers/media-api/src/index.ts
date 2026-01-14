/**
 * Media API Worker
 *
 * Cloudflare Worker providing transcoding orchestration endpoints.
 *
 * Security Features:
 * - workerAuth for internal endpoints (worker-to-worker HMAC)
 * - HMAC-SHA256 signature verification for RunPod webhooks (timing-safe)
 * - Session-based authentication for user-facing endpoints
 * - Rate limiting via KV namespace
 * - Security headers (CSP, XFO, etc.)
 *
 * Architecture:
 * - Hono framework for routing and middleware
 * - @codex/transcoding for business logic
 * - @codex/database for data persistence
 * - @codex/security for authentication
 * - @codex/worker-utils for standardized worker setup
 *
 * Routes:
 * - /health - Health check endpoint (public)
 * - /internal/media/:id/transcode - Trigger transcoding (worker auth)
 * - /api/transcoding/webhook - RunPod webhook callback (HMAC verified)
 * - /api/transcoding/retry/:id - Retry failed transcoding (authenticated)
 * - /api/transcoding/status/:id - Get transcoding status (authenticated)
 */

import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
} from '@codex/worker-utils';
// Import route modules
import transcodingRoutes from './routes/transcoding';
import webhookRoutes from './routes/webhook';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'media-api',
  version: '1.0.0',
  enableRequestTracking: true, // UUID request IDs, IP tracking, user agent
  enableLogging: true,
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false, // Using route-level procedure() instead
  healthCheck: {
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
    required: [
      'DATABASE_URL',
      'RUNPOD_API_KEY',
      'RUNPOD_ENDPOINT_ID',
      'RUNPOD_WEBHOOK_SECRET',
      'WORKER_SHARED_SECRET',
      'RATE_LIMIT_KV',
      'B2_ENDPOINT',
      'B2_KEY_ID',
      'B2_APP_KEY',
      'B2_BUCKET',
    ],
    optional: ['ENVIRONMENT', 'WEB_APP_URL', 'API_URL'],
  })
);

// ============================================================================
// API Routes
// ============================================================================

/**
 * Mount transcoding routes
 * - /internal/media/:id/transcode (workerAuth)
 * - /api/transcoding/retry/:id (authenticated)
 * - /api/transcoding/status/:id (authenticated)
 */
app.route('/', transcodingRoutes);

/**
 * Mount webhook routes
 * - /api/transcoding/webhook (HMAC verified, no session auth)
 */
app.route('/', webhookRoutes);

// ============================================================================
// Export
// ============================================================================

export default app;
