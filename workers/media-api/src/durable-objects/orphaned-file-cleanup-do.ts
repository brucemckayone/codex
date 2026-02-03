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
 * - Runs every hour via alarm
 * - Processes up to 50 pending orphans per run
 * - Retries failed deletions up to 3 times
 * - Marks permanently failed orphans for manual review
 */

import type { DurableObjectState } from '@cloudflare/workers-types';
import { R2Service } from '@codex/cloudflare-clients';
import { createDbClient } from '@codex/database';
import { OrphanedFileService } from '@codex/image-processing';
import { ObservabilityClient } from '@codex/observability';

/**
 * Cleanup interval: 1 hour in milliseconds
 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Batch size for each cleanup run
 */
const BATCH_SIZE = 50;

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
  MEDIA_BUCKET: R2Bucket;
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
   */
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
   */
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

    // Initialize services
    const db = createDbClient({
      DATABASE_URL: this.env.DATABASE_URL,
      DB_METHOD: this.env.DB_METHOD,
    });

    const orphanedFileService = new OrphanedFileService({
      db,
      environment: this.env.ENVIRONMENT ?? 'development',
    });

    const r2Service = new R2Service(this.env.MEDIA_BUCKET);

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
