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
import {
  type OrphanedFileRecord,
  OrphanedFileService,
  pageImageKeyOfObject,
} from '@codex/image-processing';
import { ObservabilityClient } from '@codex/observability';
import { InternalServiceError } from '@codex/service-errors';
import { readStillFolderName } from '@codex/validation';

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

/**
 * How much earlier than `orphanedAt` an object may have been written and still
 * be treated as a re-upload. `orphanedAt` is the database's clock and
 * `uploaded` is R2's, so the comparison needs slack, and the two errors do not
 * cost the same. Treating a real orphan as re-used keeps a few KB that nothing
 * references. Treating a re-upload as an orphan deletes a live image. So the
 * margin leans towards keeping.
 */
const REUPLOAD_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Whether the object now at an orphaned key was written AFTER the key was
 * orphaned, which means it holds new bytes rather than the orphan
 * (Codex-r85jo.6).
 *
 * An org logo's key, and a still's key stored before Codex-kk9nv.5, is a pure
 * function of an entity id and is overwritten in place: it is re-uploaded to
 * the SAME key it was deleted from. So an orphan recorded when a delete failed
 * can be re-occupied by the next upload before the sweep runs, and deleting it
 * then destroys the image the row now points at.
 */
export function wasRewrittenAfterOrphaning(
  uploaded: Date,
  orphanedAt: Date
): boolean {
  return uploaded.getTime() > orphanedAt.getTime() - REUPLOAD_CLOCK_SKEW_MS;
}

/**
 * Whether an object sits in a still folder named for its picture's size
 * (`{base}/{w}x{h}-{nonce}/{size}.webp`, Codex-kk9nv.5). Each upload mints a
 * new folder, so nothing ever re-writes one.
 */
export function isFreshStillObject(r2Key: string): boolean {
  const folder = r2Key.split('/').at(-2);
  return folder !== undefined && readStillFolderName(folder) !== null;
}

/**
 * The reasons a person has to act on: the sweep could not decide the key, so
 * it keeps the object rather than guess. A run reports each one.
 */
const LEFT_FOR_REVIEW = {
  notPageImage: 'not a page-image object key; left for review',
  unplacedFolder: 'sized folder with no owning row to check; left for review',
} as const;
const REVIEW_REASONS: ReadonlySet<string> = new Set(
  Object.values(LEFT_FOR_REVIEW)
);

/**
 * Why the object at an orphan's key must stay, or `null` to delete it.
 *
 * A page image (Codex-61zsk.10) is decided differently. Its key is minted
 * fresh per upload and never re-written, so the re-upload check can only
 * misfire on it — an image replaced minutes after its upload would be kept
 * for good. What decides a page image is whether a page still shows it, and
 * the row that queued it cannot say: undo, duplicated pages and overlapping
 * saves all put a reference back after the save that dropped it.
 *
 * A sized still folder is never re-written either, so the re-upload check can
 * only misfire on it (Codex-kk9nv.13). It misfired on every upload whose row
 * write and discard both failed: orphaned seconds after its put, the object
 * read as a re-upload and was kept for good. What decides it instead is
 * whether its own row, live, still addresses the folder. One the service
 * cannot place is left for review: the re-upload check would only misfire.
 */
export async function reasonToKeep(
  orphan: OrphanedFileRecord,
  r2Service: R2Service,
  orphanedFileService: OrphanedFileService
): Promise<string | null> {
  if (orphan.imageType === 'page_image') {
    const baseKey = pageImageKeyOfObject(orphan.r2Key);
    if (!baseKey) return LEFT_FOR_REVIEW.notPageImage;
    return (await orphanedFileService.isPageImageReferenced(baseKey))
      ? 'still referenced by a landing page'
      : null;
  }
  if (isFreshStillObject(orphan.r2Key)) {
    const folder = orphan.r2Key.slice(0, orphan.r2Key.lastIndexOf('/'));
    const referenced = await orphanedFileService.isStillFolderReferenced(
      orphan,
      folder
    );
    if (referenced === null) return LEFT_FOR_REVIEW.unplacedFolder;
    return referenced ? 'its row still addresses this folder' : null;
  }

  const current = await r2Service.head(orphan.r2Key);
  return current &&
    wasRewrittenAfterOrphaning(current.uploaded, orphan.orphanedAt)
    ? 'key re-written after it was orphaned; it holds a live upload'
    : null;
}

/**
 * One orphan the run could not finish or decide. Logged as fields, not as one
 * `key: message` string: a key holds a 32-character user id, and the
 * production redactor would hash the whole string, message and all. A
 * `detail` that still carries such an id arrives hashed on its own; the row's
 * `error_message` keeps the full text, found by `orphanId`.
 */
interface OrphanOutcome {
  orphanId: string;
  imageType: OrphanedFileRecord['imageType'];
  detail: string;
}

/**
 * An error's message without a failed query's parameters. drizzle's error
 * reads `Failed query: … params: …`, and a parameter can be a folder holding a
 * user id; the driver's own error, its `cause`, says what went wrong.
 */
export function messageForLog(error: unknown): string {
  const reported =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  return reported instanceof Error ? reported.message : String(reported);
}

interface CleanupRunResult {
  success: boolean;
  processed: number;
  deleted: number;
  /**
   * Keys kept because a later upload re-occupied them (Codex-r85jo.6),
   * because a page still references them (page images, Codex-61zsk.10),
   * because their own live row still addresses the sized folder
   * (Codex-kk9nv.13), or because the sweep cannot decide them
   * (`LEFT_FOR_REVIEW`, listed in `leftForReview`).
   */
  retained: number;
  leftForReview: OrphanOutcome[];
  failed: number;
  errors: OrphanOutcome[];
  durationMs: number;
}

interface Env {
  DATABASE_URL: string;
  /**
   * Read by `createDbClient` under `DB_METHOD=LOCAL_PROXY`. Without it the DO
   * could not reach a database locally at all, so the sweep was untestable
   * outside CI (found by Codex-r85jo.6's test).
   */
  DATABASE_URL_LOCAL_PROXY?: string;
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
  /** One logger for the alarm and every run it or `/trigger` starts. */
  private readonly obs: ObservabilityClient;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.obs = new ObservabilityClient(
      'OrphanedFileCleanupDO',
      env.ENVIRONMENT ?? 'development'
    );

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
    const obs = this.obs;
    obs.info('Orphan cleanup alarm triggered');

    try {
      const result = await this.runCleanup();

      obs.info('Orphan cleanup completed', {
        processed: result.processed,
        deleted: result.deleted,
        retained: result.retained,
        failed: result.failed,
        durationMs: result.durationMs,
      });
      // A failure is otherwise only a count here and an entry in DO storage.
      if (result.failed > 0) {
        obs.error('Orphan cleanup had failures', {
          failed: result.failed,
          errors: result.errors.slice(0, 10),
        });
      }
      // Store last run result
      await this.state.storage.put('lastRunResult', result);
      await this.state.storage.put('lastRunAt', new Date().toISOString());
    } catch (error) {
      obs.error('Orphan cleanup failed', { error: messageForLog(error) });
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
    const errors: OrphanOutcome[] = [];
    const leftForReview: OrphanOutcome[] = [];
    const obs = this.obs;

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
      DATABASE_URL_LOCAL_PROXY: this.env.DATABASE_URL_LOCAL_PROXY,
      DB_METHOD: this.env.DB_METHOD,
    });

    const orphanedFileService = new OrphanedFileService({
      db,
      environment: this.env.ENVIRONMENT ?? 'development',
    });

    // Get pending orphans
    const orphans = await orphanedFileService.getPendingOrphans(BATCH_SIZE);

    let deleted = 0;
    let retained = 0;
    let failed = 0;

    // Process each orphan
    for (const orphan of orphans) {
      try {
        // Checked per orphan, immediately before its delete. A batch-wide check
        // up front would leave the whole run as the window for a re-upload.
        const keep = await reasonToKeep(orphan, r2Service, orphanedFileService);
        if (keep) {
          await orphanedFileService.markRetained(orphan.id, keep);
          retained++;
          if (REVIEW_REASONS.has(keep)) {
            const outcome = {
              orphanId: orphan.id,
              imageType: orphan.imageType,
              detail: keep,
            };
            leftForReview.push(outcome);
            // Retained is terminal, so this is the one time the orphan is
            // named: now, as it is kept, not when the run ends, which a run
            // that stops early never reaches.
            obs.warn('Orphan left for review', outcome);
          }
          continue;
        }

        // An absent object is already gone, and the delete is a no-op, so it
        // stays on the one path that marks the row deleted.
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
        errors.push({
          orphanId: orphan.id,
          imageType: orphan.imageType,
          detail: messageForLog(error),
        });
      }
    }

    return {
      success: failed === 0,
      processed: orphans.length,
      deleted,
      retained,
      leftForReview,
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
      DATABASE_URL_LOCAL_PROXY: this.env.DATABASE_URL_LOCAL_PROXY,
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
