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
 * Durable Objects:
 * - OrphanedFileCleanupDO: Periodic cleanup of orphaned R2 files
 *
 * Routes:
 * - /health - Health check endpoint (public)
 * - /internal/media/:id/transcode - Trigger transcoding (worker auth)
 * - /api/transcoding/webhook - RunPod webhook callback (HMAC verified)
 * - /api/transcoding/retry/:id - Retry failed transcoding (authenticated)
 * - /api/transcoding/status/:id - Get transcoding status (authenticated)
 * - /internal/orphan-cleanup/* - Orphan cleanup DO management (internal)
 */

import { createDbClient } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import { workerAuth as createWorkerAuth } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import { TranscodingService } from '@codex/transcoding';
import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWorker,
} from '@codex/worker-utils';
// Import route modules
import transcodingRoutes from './routes/transcoding';
import webhookRoutes from './routes/webhook';

// Export Durable Object class for Cloudflare binding
export { OrphanedFileCleanupDO } from './durable-objects/orphaned-file-cleanup-do';

// ============================================================================
// Application Setup
// ============================================================================

const app = createWorker({
  serviceName: 'media-api',
  version: '1.0.0',
  enableRequestTracking: true, // UUID request IDs, IP tracking, user agent
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
// Orphan Cleanup DO Routes (Internal)
// ============================================================================

/**
 * Forward requests to OrphanedFileCleanupDO
 * - GET /internal/orphan-cleanup/status - Get cleanup stats
 * - POST /internal/orphan-cleanup/trigger - Manually trigger cleanup
 * - POST /internal/orphan-cleanup/schedule - Reschedule next alarm
 */
app.all(
  '/internal/orphan-cleanup/*',
  async (c, next) => {
    // Enforce worker-to-worker HMAC auth before forwarding to DO
    const secret = c.env.WORKER_SHARED_SECRET;
    if (!secret) {
      return c.json({ error: 'Worker auth not configured' }, 503);
    }
    const middleware = createWorkerAuth({ secret });
    return middleware(c, next);
  },
  async (c) => {
    const env = c.env as unknown as {
      ORPHAN_CLEANUP_DO: DurableObjectNamespace;
    };

    if (!env.ORPHAN_CLEANUP_DO) {
      return c.json({ error: 'Orphan cleanup DO not configured' }, 503);
    }

    // Get the singleton DO instance
    const id = env.ORPHAN_CLEANUP_DO.idFromName('singleton');
    const stub = env.ORPHAN_CLEANUP_DO.get(id);

    // Extract the path after /internal/orphan-cleanup
    const url = new URL(c.req.url);
    const doPath = url.pathname.replace('/internal/orphan-cleanup', '');
    const doUrl = new URL(doPath || '/', url.origin);

    // Forward the request to the DO
    return stub.fetch(
      new Request(doUrl.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.method !== 'GET' ? c.req.raw.body : undefined,
      })
    );
  }
);

// ============================================================================
// Scheduled Handler (Cron Triggers)
// ============================================================================

/**
 * Recover media items stuck in 'transcoding' status.
 *
 * Runs on the cron schedule defined in wrangler.jsonc (`triggers.crons`).
 * If a RunPod webhook is lost (network failure, RunPod outage), the media
 * row stays in 'transcoding' indefinitely — this handler finds rows older
 * than STUCK_MAX_AGE_MINUTES and marks them 'failed' so they become
 * retryable by the creator.
 *
 * Error handling: NEVER throws. Scheduled handlers that throw uncaught
 * errors crash the invocation; we log and exit cleanly instead.
 */
const STUCK_MAX_AGE_MINUTES = 120;

async function runRecoverStuckTranscoding(
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  const obs = new ObservabilityClient(
    'media-api-cron',
    env.ENVIRONMENT ?? 'development'
  );

  // Guard against missing env vars — don't throw, log and exit.
  const runpodApiKey = env.RUNPOD_API_KEY;
  const runpodEndpointId = env.RUNPOD_ENDPOINT_ID;
  if (!env.DATABASE_URL || !runpodApiKey || !runpodEndpointId) {
    obs.error(
      'Cron recoverStuckTranscoding: missing required env vars, skipping',
      {
        hasDatabaseUrl: Boolean(env.DATABASE_URL),
        hasRunpodApiKey: Boolean(runpodApiKey),
        hasRunpodEndpointId: Boolean(runpodEndpointId),
      }
    );
    return;
  }

  try {
    const db = createDbClient(env);

    const service = new TranscodingService({
      db,
      environment: env.ENVIRONMENT ?? 'development',
      runpodApiKey,
      runpodEndpointId,
      webhookBaseUrl: env.API_URL ?? 'http://localhost:4002',
    });

    const recovered = await service.recoverStuckTranscoding(
      STUCK_MAX_AGE_MINUTES
    );

    obs.info('Cron recoverStuckTranscoding completed', {
      recovered,
      maxAgeMinutes: STUCK_MAX_AGE_MINUTES,
    });
  } catch (error) {
    obs.error('Cron recoverStuckTranscoding failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Reference ctx to satisfy lint — reserved for future waitUntil usage
  // (recoverStuckTranscoding is a single DB UPDATE; no post-response work).
  void ctx;
}

// ============================================================================
// Export
// ============================================================================

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    // Wrap in waitUntil so the cron invocation isn't killed before
    // logging/DB work settles, even if the promise is slow.
    ctx.waitUntil(runRecoverStuckTranscoding(env, ctx));
  },
};
