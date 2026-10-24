/**
 * The hourly maintenance run (Codex-l2c48.5): the safety net under the
 * dispatch state machine. Rides media-api's EXISTING hourly production cron:
 * a new trigger would wake Neon on its own cadence.
 *
 * Steps run in order, each on its own so one failing never stops the next:
 * 1. Endpoint check: raise max workers if RunPod scaled the endpoint down
 *    (first, so the ping below reaches an awake endpoint).
 * 2. Keep-alive ping, once a day: RunPod pauses an endpoint after 7 days
 *    without a request.
 * 3. Reconcile `transcoding` rows RunPod has had too long: ask RunPod, then
 *    fail or put back to waiting; fail any still unresolved 24 h past due.
 * 4. Retry `uploaded` rows idle 10 min, whatever their code (waiting for the
 *    transcoder, or stranded by a failed content-api hop); give up at 24 h.
 * 5. Check `uploading` rows untouched for 24 h against R2: the file arrived
 *    (upload-complete was lost) or it never did.
 *
 * Every write is guarded on the state the run saw, so a creator's Retry or a
 * webhook that got there first is never overwritten. When RunPod or R2
 * cannot answer for one row it cannot for the next, so the step stops asking
 * and the next run picks the rest up.
 */

import {
  MEDIA_STATUS,
  TRANSCODING_ERROR_CODES,
  TRANSCODING_JOB_CONTRACT,
  transcodingErrorInfo,
} from '@codex/constants';
import { messageForLog } from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import {
  BaseService,
  InternalServiceError,
  type ServiceConfig,
} from '@codex/service-errors';
import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import {
  type JobAnswer,
  type LostJobAction,
  lostJobAction,
  MIN_RECONCILE_AGE_MS,
  PING_HOUR_UTC,
  reconcileDueAt,
  STALLED_UPLOAD_MS,
  WAITING_IDLE_MS,
  waitingAction,
} from '../maintenance-rules';
import type { RunPodApiFailureReason } from '../runpod-api';
import { failedFields, waitingFields } from './media-state';
import {
  DISPATCH_BUDGET_MS,
  type EndpointWakeOutcome,
  MAINTENANCE_SCOPE,
  type TranscodingService,
} from './transcoding-service';

/** Rows one step handles per run; the next run takes the rest. */
const ROWS_PER_STEP = 25;
/**
 * Rows step 3 reads to find ROWS_PER_STEP due ones: a long video is not due
 * for hours, and must not hold a slot a due row needs.
 */
const RECONCILE_READ_AHEAD = 4 * ROWS_PER_STEP;
/** Failures that say RunPod will not answer for the next job either. */
const ENDPOINT_WIDE: ReadonlySet<RunPodApiFailureReason> = new Set([
  'unavailable',
  'out_of_time',
  'not_permitted',
  'unsupported',
]);
/** A retry is not started with less left: a dispatch, plus its claim. */
const DISPATCH_RESERVE_MS = DISPATCH_BUDGET_MS + 3_000;
/** At this many in one run, a lost upload is a fault, not abandonment. */
const INCOMPLETE_UPLOAD_BURST = 5;

interface TranscodingMaintenanceConfig extends ServiceConfig {
  transcoding: TranscodingService;
  /**
   * true when the original is in R2, false when it is not. Throws when R2
   * cannot say, and the row is left alone. Without it step 5 fails, every
   * run, at error.
   */
  originalExists?: (r2Key: string) => Promise<boolean>;
}

export interface MaintenanceReport {
  ping: 'not_due' | 'accepted' | RunPodApiFailureReason;
  endpoint: EndpointWakeOutcome;
  /** notDue: read, but inside its job's time (not counted against the cap). */
  reconciled: { failed: number; waiting: number; left: number; notDue: number };
  /** notAccepted: the dispatch that ended this run's retries. */
  waiting: {
    retried: number;
    notAccepted: number;
    gaveUp: number;
    deferred: number;
  };
  uploads: { arrived: number; incomplete: number; unknown: number };
  /** Writes and claims that matched nothing: a webhook, a Retry or another run got there first. */
  raced: number;
  /** Steps that threw; the run went on. */
  failedSteps: string[];
}

export class TranscodingMaintenance extends BaseService {
  private readonly transcoding: TranscodingService;
  private readonly originalExists?: (r2Key: string) => Promise<boolean>;

  constructor(config: TranscodingMaintenanceConfig) {
    super(config);
    this.transcoding = config.transcoding;
    this.originalExists = config.originalExists;
  }

  /** One run. NEVER THROWS: a failing step is logged and reported. */
  async run({
    now = new Date(),
    deadline,
  }: {
    now?: Date;
    deadline: number;
  }): Promise<MaintenanceReport> {
    const report: MaintenanceReport = {
      ping: 'not_due',
      endpoint: { kind: 'unknown', reason: 'not_run' },
      reconciled: { failed: 0, waiting: 0, left: 0, notDue: 0 },
      waiting: { retried: 0, notAccepted: 0, gaveUp: 0, deferred: 0 },
      uploads: { arrived: 0, incomplete: 0, unknown: 0 },
      raced: 0,
      failedSteps: [],
    };

    const step = async (name: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        report.failedSteps.push(name);
        this.obs.error('transcoding.maintenance_step_failed', {
          step: name,
          error: messageForLog(error),
        });
      }
    };

    await step('endpoint', async () => {
      report.endpoint = await this.transcoding.ensureEndpointAwake(
        Math.min(deadline, Date.now() + 20_000)
      );
    });
    await step('ping', () => this.ping(now, deadline, report));
    await step('reconcile', () => this.reconcile(now, deadline, report));
    await step('waiting', () => this.retryWaiting(now, deadline, report));
    await step('uploads', () =>
      this.checkStalledUploads(now, deadline, report)
    );
    return report;
  }

  private async ping(
    now: Date,
    deadline: number,
    report: MaintenanceReport
  ): Promise<void> {
    if (now.getUTCHours() !== PING_HOUR_UTC) return;
    const answer = await this.transcoding.runpodJobs.ping(
      TRANSCODING_JOB_CONTRACT,
      Math.min(deadline, Date.now() + 10_000)
    );
    report.ping = answer.ok ? 'accepted' : answer.reason;
    // Never alerted: an old handler fails the ping job, and the request
    // reset RunPod's idle clock all the same.
    if (!answer.ok) {
      this.obs.warn('transcoding.keepalive_ping_not_accepted', {
        reason: answer.reason,
        statusCode: answer.status,
      });
    }
  }

  private async reconcile(
    now: Date,
    deadline: number,
    report: MaintenanceReport
  ): Promise<void> {
    const rows = await this.db.query.mediaItems.findMany({
      columns: {
        id: true,
        runpodJobId: true,
        durationSeconds: true,
        updatedAt: true,
      },
      where: and(
        eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
        isNull(mediaItems.deletedAt),
        lt(mediaItems.updatedAt, new Date(now.getTime() - MIN_RECONCILE_AGE_MS))
      ),
      orderBy: asc(mediaItems.updatedAt),
      limit: RECONCILE_READ_AHEAD,
    });

    let handled = 0;
    let runpodCannotSay = false;
    for (const row of rows) {
      const dueAt = reconcileDueAt(row);
      if (dueAt > now.getTime()) {
        report.reconciled.notDue++;
        continue;
      }
      if (handled >= ROWS_PER_STEP) break;
      handled++;

      let answer: JobAnswer = 'no_job';
      if (row.runpodJobId) {
        answer = 'unanswered';
        if (!runpodCannotSay) {
          const asked = await this.askRunPod(row.id, row.runpodJobId, deadline);
          answer = asked.answer;
          runpodCannotSay = asked.endpointWide;
        }
      }
      const action = lostJobAction(answer, now.getTime() - dueAt);
      if (action.kind === 'leave') {
        report.reconciled.left++;
        continue;
      }
      await this.resolveLostJob(row, dueAt, action, report);
    }
  }

  /**
   * What RunPod says about one job. `endpointWide`: it will not answer for
   * the next job either (down, out of time, a key that may not ask); an
   * unreadable answer is this job's alone.
   */
  private async askRunPod(
    mediaId: string,
    jobId: string,
    deadline: number
  ): Promise<{ answer: JobAnswer; endpointWide: boolean }> {
    const status = await this.transcoding.runpodJobs.jobStatus(jobId, deadline);
    if (status.ok) return { answer: status, endpointWide: false };

    // Only a passing outage is a warning: a key that may not ask, or an
    // answer that cannot be read, leaves rows unresolved every run.
    const context = {
      mediaId,
      runpodJobId: jobId,
      reason: status.reason,
      statusCode: status.status,
    };
    if (status.reason === 'unavailable' || status.reason === 'out_of_time') {
      this.obs.warn('transcoding.reconcile_unanswered', context);
    } else {
      this.obs.error('transcoding.reconcile_unanswered', context);
    }
    return {
      answer: 'unanswered',
      endpointWide: ENDPOINT_WIDE.has(status.reason),
    };
  }

  /** Write what became of a lost job, guarded on the row the run read. */
  private async resolveLostJob(
    row: { id: string; runpodJobId: string | null },
    dueAt: number,
    action: Exclude<LostJobAction, { kind: 'leave' }>,
    report: MaintenanceReport
  ): Promise<void> {
    const jobId = row.runpodJobId;
    // Still the row the run looked at: same job (or still none), not
    // deleted, and not touched since it fell due.
    const sameRow = and(
      eq(mediaItems.id, row.id),
      eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
      isNull(mediaItems.deletedAt),
      jobId
        ? eq(mediaItems.runpodJobId, jobId)
        : isNull(mediaItems.runpodJobId),
      lt(mediaItems.updatedAt, new Date(dueAt))
    );
    const written = await this.db
      .update(mediaItems)
      .set(
        action.kind === 'fail'
          ? failedFields(action.code, action.detail)
          : waitingFields(
              TRANSCODING_ERROR_CODES.TRANSCODER_UNAVAILABLE,
              action.detail
            )
      )
      .where(sameRow)
      .returning();
    if (written.length === 0) {
      report.raced++;
      return;
    }

    const context = {
      mediaId: row.id,
      runpodJobId: jobId,
      action: action.kind,
    };
    if (action.kind === 'wait') {
      report.reconciled.waiting++;
      this.obs.warn('transcoding.lost_job_resolved', context);
      return;
    }
    report.reconciled.failed++;
    // A lost webhook, a failed job that never reported, or a job nobody
    // could account for in a day: the pipeline itself broke.
    const broke =
      action.ceiling ||
      transcodingErrorInfo(action.code).category === 'internal';
    const failed = { ...context, code: action.code };
    if (broke) this.obs.error('transcoding.lost_job_resolved', failed);
    else this.obs.warn('transcoding.lost_job_resolved', failed);
  }

  private async retryWaiting(
    now: Date,
    deadline: number,
    report: MaintenanceReport
  ): Promise<void> {
    const idleSince = new Date(now.getTime() - WAITING_IDLE_MS);
    const rows = await this.db.query.mediaItems.findMany({
      columns: {
        id: true,
        transcodingErrorCode: true,
        transcodingAttempts: true,
        uploadedAt: true,
        createdAt: true,
      },
      where: and(
        eq(mediaItems.status, MEDIA_STATUS.UPLOADED),
        isNull(mediaItems.deletedAt),
        lt(mediaItems.updatedAt, idleSince)
      ),
      orderBy: asc(mediaItems.updatedAt),
      limit: ROWS_PER_STEP,
    });

    let runpodRefused = false;
    for (const row of rows) {
      const action = waitingAction(row, now);
      if (action.kind === 'give_up') {
        const written = await this.db
          .update(mediaItems)
          .set(failedFields(action.code, action.detail))
          .where(
            and(
              eq(mediaItems.id, row.id),
              eq(mediaItems.status, MEDIA_STATUS.UPLOADED),
              isNull(mediaItems.deletedAt),
              lt(mediaItems.updatedAt, idleSince)
            )
          )
          .returning();
        if (written.length === 0) {
          report.raced++;
          continue;
        }
        report.waiting.gaveUp++;
        this.obs.warn('transcoding.waiting_given_up', {
          mediaId: row.id,
          code: action.code,
          reason: action.detail,
        });
        continue;
      }

      // After one dispatch RunPod did not accept, the rest would fare the
      // same: they wait for the next run (dispatch already logged why).
      if (runpodRefused || deadline - Date.now() < DISPATCH_RESERVE_MS) {
        report.waiting.deferred++;
        continue;
      }
      const claimed = await this.transcoding.claimForDispatch(
        row.id,
        [MEDIA_STATUS.UPLOADED],
        MAINTENANCE_SCOPE
      );
      if (!claimed) {
        report.raced++;
        continue;
      }
      const outcome = await this.transcoding.dispatch(claimed);
      if (outcome.kind === 'accepted') {
        report.waiting.retried++;
      } else {
        report.waiting.notAccepted++;
        runpodRefused = true;
      }
    }
  }

  private async checkStalledUploads(
    now: Date,
    deadline: number,
    report: MaintenanceReport
  ): Promise<void> {
    const originalExists = this.originalExists;
    // Every run, at error: lost upload-completes would otherwise stay
    // `uploading` for ever.
    if (!originalExists) {
      throw new InternalServiceError(
        'No R2 bucket for originals: stalled uploads cannot be checked'
      );
    }

    const stalledSince = new Date(now.getTime() - STALLED_UPLOAD_MS);
    const rows = await this.db.query.mediaItems.findMany({
      columns: { id: true, r2Key: true, updatedAt: true },
      where: and(
        eq(mediaItems.status, MEDIA_STATUS.UPLOADING),
        isNull(mediaItems.deletedAt),
        lt(mediaItems.updatedAt, stalledSince)
      ),
      orderBy: asc(mediaItems.updatedAt),
      limit: ROWS_PER_STEP,
    });

    for (const row of rows) {
      if (Date.now() >= deadline) break;
      let exists: boolean;
      try {
        exists = await originalExists(row.r2Key);
      } catch (error) {
        // Only a definite "not there" may fail an upload. The rest wait for
        // the next run: R2 that cannot say for one key cannot for the next.
        report.uploads.unknown++;
        this.obs.error('transcoding.stalled_upload_unchecked', {
          mediaId: row.id,
          error: messageForLog(error),
        });
        break;
      }

      const stillStalled = and(
        eq(mediaItems.id, row.id),
        eq(mediaItems.status, MEDIA_STATUS.UPLOADING),
        isNull(mediaItems.deletedAt),
        lt(mediaItems.updatedAt, stalledSince)
      );
      if (exists) {
        // upload-complete never arrived. The 24 h clock starts now, and the
        // next run's retry step dispatches it.
        const written = await this.db
          .update(mediaItems)
          .set({
            status: MEDIA_STATUS.UPLOADED,
            uploadedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(stillStalled)
          .returning();
        if (written.length > 0) report.uploads.arrived++;
        else report.raced++;
        continue;
      }

      const written = await this.db
        .update(mediaItems)
        .set(
          failedFields(
            TRANSCODING_ERROR_CODES.UPLOAD_INCOMPLETE,
            'The upload never finished'
          )
        )
        .where(stillStalled)
        .returning();
      if (written.length === 0) {
        report.raced++;
        continue;
      }
      report.uploads.incomplete++;
      this.obs.warn('transcoding.upload_incomplete', {
        mediaId: row.id,
        ageHours: Math.floor(
          (now.getTime() - row.updatedAt.getTime()) / 3_600_000
        ),
      });
    }

    if (report.uploads.incomplete >= INCOMPLETE_UPLOAD_BURST) {
      this.obs.error('transcoding.upload_incomplete_burst', {
        count: report.uploads.incomplete,
      });
    }
  }
}
