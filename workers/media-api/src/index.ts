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

import { messageForLog } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import { workerAuth as createWorkerAuth } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import {
  createEnvValidationMiddleware,
  createKvCheck,
  createWebhookServices,
  createWorker,
  standardDatabaseCheck,
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
    // DB check added 2026-05-22 (post-epic audit) — without it the WP-9
    // smoke gate would have missed media-api DB regressions on deploy,
    // even though the transcoding routes query the DB on every request.
    checkDatabase: standardDatabaseCheck,
    // RATE_LIMIT_KV is gone: rate-limit counters moved off KV (Codex-kgrdp.17).
    checkKV: createKvCheck(['AUTH_SESSION_KV']),
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
// Mock RunPod /run endpoint (test/dev only)
// ============================================================================

/**
 * POST /internal/mock-runpod
 *
 * Stands in for RunPod's `/v2/<endpoint>/run` API, so `dispatch()` can
 * dispatch without a real RunPod account.
 *
 * NOT USED BY CI — do not point `RUNPOD_DIRECT_URL` back at this route.
 * Doing so makes media-api fetch its OWN dev server: the dispatch re-enters
 * the wrangler instance that is serving the request, and a request landing
 * during an isolate reload comes back as HTTP 503 "Your worker restarted
 * mid-request". TranscodingService records that as RunPod refusing ("RunPod
 * answered 503"), so the
 * failure reads as a third-party outage rather than a harness problem. That
 * flake failed `should allow retrying failed transcoding` in CI run
 * 33667762392 and, because deploy-production.yml gates on
 * `workflow_run.conclusion == 'success'`, skipped the 2026-09-02 production
 * deploy entirely.
 *
 * The e2e suite therefore dispatches to the standalone stub in
 * `e2e/helpers/mock-runpod.ts` (a separate process cannot be reloaded by
 * wrangler). This route is kept for hand-driven local probing — curl it
 * directly, or set `RUNPOD_DIRECT_URL` to it in a shell where media-api is
 * NOT the caller.
 *
 * Returns a fake job id + IN_QUEUE status, mimicking the real RunPod
 * response shape. The transcoding service stores the job id and waits for
 * a webhook callback — in e2e tests the webhook is forged separately, so
 * this mock does NOT need to schedule its own callback.
 *
 * Guarded by ENVIRONMENT — returns 404 in production.
 */
app.post('/internal/mock-runpod', async (c) => {
  const env = c.env as unknown as Bindings & { ENVIRONMENT?: string };
  const environment = env.ENVIRONMENT || 'development';
  if (environment !== 'development' && environment !== 'test') {
    return c.notFound();
  }

  return c.json(
    {
      id: `mock-job-${crypto.randomUUID()}`,
      status: 'IN_QUEUE',
    },
    200
  );
});

// ============================================================================
// Orphan Cleanup DO Routes (Internal)
// ============================================================================

/**
 * Forward requests to OrphanedFileCleanupDO
 * - GET /internal/orphan-cleanup/status - Get cleanup stats
 * - POST /internal/orphan-cleanup/trigger - Manually trigger cleanup
 * - POST /internal/orphan-cleanup/schedule - Reschedule next alarm
 *
 * (`POST /ensure-scheduled` is reached by `scheduled()` below straight through
 * the DO binding, not via this route: an in-worker call needs no HMAC.)
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
 * The hourly transcoding maintenance run (Codex-l2c48.5): keep-alive ping,
 * endpoint wake, lost-job reconcile, waiting retries and stalled-upload
 * checks. See TranscodingMaintenance.
 *
 * Services come from the registry (createWebhookServices), so the cron gets
 * the same TRANSCODING_WEBHOOK_URL, RUNPOD_DIRECT_URL and RUNPOD_WORKERS_MAX
 * wiring as the routes. NEVER throws: a scheduled handler that throws
 * crashes the invocation; this logs and returns.
 */
const MAINTENANCE_BUDGET_MS = 10 * 60 * 1000; // the cron's wall limit is 15 min

async function runTranscodingMaintenance(
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  const obs = new ObservabilityClient(
    'media-api-cron',
    env.ENVIRONMENT ?? 'development'
  );

  if (!env.DATABASE_URL || !env.RUNPOD_API_KEY || !env.RUNPOD_ENDPOINT_ID) {
    obs.error('transcoding.maintenance_skipped', {
      reason: 'missing required env vars',
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      hasRunpodApiKey: Boolean(env.RUNPOD_API_KEY),
      hasRunpodEndpointId: Boolean(env.RUNPOD_ENDPOINT_ID),
    });
    return;
  }

  let release: (() => void) | undefined;
  try {
    const webhook = await createWebhookServices(env, ctx, { obs });
    release = webhook.release;
    const report = await webhook.services.transcodingMaintenance.run({
      deadline: Date.now() + MAINTENANCE_BUDGET_MS,
    });
    obs.info('transcoding.maintenance_completed', { ...report });
  } catch (error) {
    obs.error('transcoding.maintenance_failed', {
      error: messageForLog(error),
    });
  } finally {
    release?.();
  }
}

/**
 * Start (or re-align) the OrphanedFileCleanupDO sweep (Codex-r85jo.3).
 *
 * The DO's alarm is only ever set from INSIDE the DO, and the DO is only
 * instantiated by a request to its stub. Before this, the sole route to it was
 * `/internal/orphan-cleanup/*`, which nothing in the repo calls, so in
 * production the alarm never started and the orphan table was never swept.
 *
 * Rides the EXISTING hourly production cron rather than adding one: Cloudflare
 * caps cron triggers per account, and a separate schedule would wake Neon on
 * its own cadence. `/ensure-scheduled` puts the run ~60s after this cron, inside
 * the Neon wake that `runTranscodingMaintenance` already pays for.
 *
 * NEVER throws, the same contract as the other scheduled job.
 */
async function runEnsureOrphanCleanupScheduled(
  env: Bindings & { ORPHAN_CLEANUP_DO?: DurableObjectNamespace }
): Promise<void> {
  const obs = new ObservabilityClient(
    'media-api-cron',
    env.ENVIRONMENT ?? 'development'
  );

  if (!env.ORPHAN_CLEANUP_DO) {
    obs.error('Cron ensureOrphanCleanupScheduled: ORPHAN_CLEANUP_DO not bound');
    return;
  }

  try {
    const stub = env.ORPHAN_CLEANUP_DO.get(
      env.ORPHAN_CLEANUP_DO.idFromName('singleton')
    );
    // A DO stub ignores the host; only the path is routed.
    const response = await stub.fetch(
      'https://orphan-cleanup.internal/ensure-scheduled',
      { method: 'POST' }
    );
    if (!response.ok) {
      obs.error('Cron ensureOrphanCleanupScheduled: DO rejected the poke', {
        status: response.status,
      });
      return;
    }
    obs.info('Cron ensureOrphanCleanupScheduled completed', {
      result: await response.json(),
    });
  } catch (error) {
    obs.error('Cron ensureOrphanCleanupScheduled failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
    // One waitUntil, in order. The poke goes first: it takes a second, and
    // a maintenance run that hangs until the wall limit must not take it
    // down too. Its sweep runs ~60 s on, inside the Neon wake the
    // maintenance run pays for.
    ctx.waitUntil(
      (async () => {
        await runEnsureOrphanCleanupScheduled(env);
        await runTranscodingMaintenance(env, ctx);
      })()
    );
  },
};
