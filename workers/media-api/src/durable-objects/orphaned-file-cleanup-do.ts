/**
 * Orphaned File Cleanup Durable Object
 *
 * Periodically cleans up orphaned R2 image files that failed initial deletion.
 * Uses Durable Object alarms for reliable, scheduled execution with:
 * - Single-writer guarantee (no concurrent cleanup runs)
 * - Persistent state across runs
 * - Self-rescheduling alarms
 *
 * Cleanup Strategy:
 * - Runs every hour via alarm, STARTED by media-api's hourly production cron
 *   (`scheduled()` -> POST /ensure-scheduled). Nothing else instantiates this
 *   object, and the alarm below is only ever set from inside it, so without
 *   that poke the sweep never runs at all (Codex-r85jo.3).
 * - Sweeps ASSETS_BUCKET, the bucket every orphan producer writes (see Env)
 * - Processes up to 50 pending orphans per run
 * - Retries failed deletions up to 3 times
 * - Marks permanently failed orphans for manual review
 */

import type { DurableObjectState } from '@cloudflare/workers-types';
import { R2Service } from '@codex/cloudflare-clients';
import { createDbClient } from '@codex/database';
import { OrphanedFileService } from '@codex/image-processing';
import { ObservabilityClient } from '@codex/observability';
import { InternalServiceError } from '@codex/service-errors';

/**
 * Cleanup interval: 1 hour in milliseconds
 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Batch size for each cleanup run
 */
const BATCH_SIZE = 50;

/**
 * Delay before a run the cron has just pulled in. Short, so the sweep lands
 * inside the Neon wake the cron's own DB work already paid for.
 */
const CRON_ALIGNED_DELAY_MS = 60_000;

/**
 * An existing alarm due within this window of a cron poke is left alone: it
 * will already fire inside that cron's Neon wake. One further out is pulled in
 * to CRON_ALIGNED_DELAY_MS. Kept under Neon's default 5-minute autosuspend.
 */
const CRON_ALIGN_WINDOW_MS = 4 * 60 * 1000;

interface CleanupRunResult {
  success: boolean;
  processed: number;
  deleted: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

interface Env {
  DATABASE_URL: string;
  DB_METHOD: string;
  /**
   * The bucket the orphans live in. Every producer is an
   * ImageProcessingService built by the service registry over ASSETS_BUCKET
   * (content-api thumbnails and stills, identity-api avatars). This sweep used
   * MEDIA_BUCKET, a DIFFERENT bucket — and an R2 delete of a key that does not
   * exist succeeds, so every orphan would have been marked `deleted` while the
   * object stayed put (Codex-r85jo.3). Optional in the type so a missing
   * binding fails the run loudly instead of falling back to the wrong bucket.
   */
  ASSETS_BUCKET?: R2Bucket;
  ENVIRONMENT?: string;
}

export class OrphanedFileCleanupDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Schedule first alarm on construction if not already scheduled
    this.state.blockConcurrencyWhile(async () => {
      const currentAlarm = await this.state.storage.getAlarm();
      if (!currentAlarm) {
        // Schedule first run in 1 minute (allows worker to fully initialize)
        await this.state.storage.setAlarm(Date.now() + 60_000);
      }
    });
  }

  /**
   * HTTP handler for manual operations
   *
   * GET /status - Get cleanup stats
   * POST /trigger - Manually trigger cleanup
   * POST /schedule - Reschedule next alarm
   * POST /ensure-scheduled - Idempotent start/align poke from the hourly cron
   *
   * Invoked by workerd when a request is routed to this DO stub, never called
   * statically, so every dead-code detector flags it. Suppressed by
   * construction rather than by name in .fallowrc.json, which would silence
   * `fetch` on every class in the repo.
   */
  // fallow-ignore-next-line unused-class-member
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/status') {
        return await this.handleStatus();
      }

      if (request.method === 'POST' && path === '/trigger') {
        return await this.handleManualTrigger();
      }

      if (request.method === 'POST' && path === '/schedule') {
        return await this.handleReschedule();
      }

      if (request.method === 'POST' && path === '/ensure-scheduled') {
        return await this.handleEnsureScheduled();
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Alarm handler - runs periodically to clean up orphaned files
   *
   * The workerd alarm callback. Scheduled via `state.storage.setAlarm` and
   * self-rescheduling; no call site exists or can exist.
   */
  // fallow-ignore-next-line unused-class-member
  async alarm(): Promise<void> {
    const obs = new ObservabilityClient(
      'OrphanedFileCleanupDO',
      this.env.ENVIRONMENT ?? 'development'
    );

    obs.info('Orphan cleanup alarm triggered');

    try {
      const result = await this.runCleanup();

      obs.info('Orphan cleanup completed', {
        processed: result.processed,
        deleted: result.deleted,
        failed: result.failed,
        durationMs: result.durationMs,
      });

      // Store last run result
      await this.state.storage.put('lastRunResult', result);
      await this.state.storage.put('lastRunAt', new Date().toISOString());
    } catch (error) {
      obs.error('Orphan cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Always reschedule next alarm
      await this.state.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }

  /**
   * Execute cleanup of orphaned files
   */
  private async runCleanup(): Promise<CleanupRunResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    if (!this.env.ASSETS_BUCKET) {
      // Checked before any orphan is read, so nothing is marked deleted.
      throw new InternalServiceError(
        'ASSETS_BUCKET not bound: the orphan sweep will not run against any other bucket'
      );
    }
    const r2Service = new R2Service(this.env.ASSETS_BUCKET);

    // Initialize services
    const db = createDbClient({
      DATABASE_URL: this.env.DATABASE_URL,
      DB_METHOD: this.env.DB_METHOD,
    });

    const orphanedFileService = new OrphanedFileService({
      db,
      environment: this.env.ENVIRONMENT ?? 'development',
    });

    // Get pending orphans
    const orphans = await orphanedFileService.getPendingOrphans(BATCH_SIZE);

    let deleted = 0;
    let failed = 0;

    // Process each orphan
    for (const orphan of orphans) {
      try {
        // Attempt to delete from R2
        await r2Service.delete(orphan.r2Key);

        // Mark as deleted in database
        await orphanedFileService.markDeleted(orphan.id);
        deleted++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Record failed attempt
        await orphanedFileService.recordFailedAttempt(orphan.id, errorMessage);
        failed++;
        errors.push(`${orphan.r2Key}: ${errorMessage}`);
      }
    }

    return {
      success: failed === 0,
      processed: orphans.length,
      deleted,
      failed,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Handle GET /status - return cleanup stats
   */
  private async handleStatus(): Promise<Response> {
    const db = createDbClient({
      DATABASE_URL: this.env.DATABASE_URL,
      DB_METHOD: this.env.DB_METHOD,
    });

    const orphanedFileService = new OrphanedFileService({
      db,
      environment: this.env.ENVIRONMENT ?? 'development',
    });

    const stats = await orphanedFileService.getStats();
    const lastRunResult =
      await this.state.storage.get<CleanupRunResult>('lastRunResult');
    const lastRunAt = await this.state.storage.get<string>('lastRunAt');
    const nextAlarm = await this.state.storage.getAlarm();

    return new Response(
      JSON.stringify({
        stats,
        lastRun: lastRunResult
          ? {
              ...lastRunResult,
              at: lastRunAt,
            }
          : null,
        nextScheduledRun: nextAlarm ? new Date(nextAlarm).toISOString() : null,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Handle POST /trigger - manually run cleanup
   */
  private async handleManualTrigger(): Promise<Response> {
    const result = await this.runCleanup();

    // Store result
    await this.state.storage.put('lastRunResult', result);
    await this.state.storage.put('lastRunAt', new Date().toISOString());

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle POST /ensure-scheduled — the cron's idempotent poke.
   *
   * Only ever moves the alarm EARLIER, never later. `/schedule` pushes the
   * alarm to now + 1h unconditionally, so calling it from an hourly cron would
   * keep postponing a run that is due at about the same moment, and the sweep
   * would never fire. Here, an alarm already due inside the window is kept, and
   * a missing or distant one is pulled in to fire shortly after the cron. Once
   * a run lands there its own +1h reschedule lands inside the next cron's
   * window, so the two stay aligned and the sweep adds no Neon wake of its own.
   */
  private async handleEnsureScheduled(): Promise<Response> {
    const now = Date.now();
    const current = await this.state.storage.getAlarm();
    const pulledIn = current === null || current > now + CRON_ALIGN_WINDOW_MS;
    const nextAlarm = pulledIn ? now + CRON_ALIGNED_DELAY_MS : current;

    if (pulledIn) {
      await this.state.storage.setAlarm(nextAlarm);
    }

    return new Response(
      JSON.stringify({
        scheduled: true,
        pulledIn,
        nextRun: new Date(nextAlarm).toISOString(),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Handle POST /schedule - reschedule next alarm
   */
  private async handleReschedule(): Promise<Response> {
    const nextAlarm = Date.now() + CLEANUP_INTERVAL_MS;
    await this.state.storage.setAlarm(nextAlarm);

    return new Response(
      JSON.stringify({
        scheduled: true,
        nextRun: new Date(nextAlarm).toISOString(),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
