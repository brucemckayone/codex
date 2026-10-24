/**
 * Transcoding Service
 *
 * Manages media transcoding lifecycle via RunPod integration.
 *
 * Key Responsibilities:
 * - Claim media for dispatch, once (claimForDispatch)
 * - Send jobs to RunPod and record what its answer means (dispatch)
 * - Handle webhook callbacks from RunPod
 * - Creator retries, within MAX_TRANSCODING_ATTEMPTS
 *
 * Key Principles:
 * - All R2 paths come from paths.ts (SINGLE SOURCE OF TRUTH)
 * - Creator scoping on all queries
 * - Every state change is ONE guarded UPDATE: its WHERE names the state it
 *   moves from, so two writers can never both apply
 * - Proper error handling with custom error classes
 */

import {
  HEADERS,
  MAX_TRANSCODING_ATTEMPTS,
  MEDIA_STATUS,
  MIME_TYPES,
  TRANSCODING_ERROR_CODES,
  TRANSCODING_ERROR_MAX_LENGTH,
  TRANSCODING_JOB_CONTRACT,
  type TranscodingErrorCode,
  transcodingErrorInfo,
} from '@codex/constants';
import { messageForLog, scopedNotDeleted } from '@codex/database';

import { mediaItems } from '@codex/database/schema';
import {
  BaseService,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import type {
  RunPodProgressWebhookPayload,
  RunPodWebhookPayload,
} from '@codex/validation';
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';

import {
  classifyRunPodAnswer,
  jobFailureFromWebhook,
  type RunPodDispatchOutcome,
  transcodingJobPolicy,
} from '../dispatch';
import {
  InvalidMediaStateError,
  MaxRetriesExceededError,
  TranscodingJobNotFoundError,
  TranscodingMediaNotFoundError,
  TranscodingNotRetryableError,
} from '../errors';
import type {
  HlsVariant,
  MediaStatus,
  RunPodJobRequest,
  TranscodingMediaItem,
  TranscodingStatusResponse,
} from '../types';

/**
 * The columns both media reads select. `satisfies` makes it name every
 * TranscodingMediaItem field: a field added to the type but not selected is a
 * compile error, not an `undefined` that the `as TranscodingMediaItem` casts
 * below would hide (the status endpoint would report a missing error code as
 * "nothing went wrong").
 */
const TRANSCODING_MEDIA_COLUMNS = {
  id: true,
  creatorId: true,
  mediaType: true,
  status: true,
  r2Key: true,
  transcodingAttempts: true,
  runpodJobId: true,
  transcodingError: true,
  transcodingErrorCode: true,
  transcodingPriority: true,
  hlsMasterPlaylistKey: true,
  hlsPreviewKey: true,
  thumbnailKey: true,
  waveformKey: true,
  waveformImageKey: true,
  durationSeconds: true,
  width: true,
  height: true,
  readyVariants: true,
  mezzanineKey: true,
  mezzanineStatus: true,
  transcodingProgress: true,
  transcodingStep: true,
} as const satisfies Record<keyof TranscodingMediaItem, true>;

/**
 * Extended service config for TranscodingService
 *
 * SECURITY: All storage credentials (B2 and R2) are configured in
 * RunPod's secret manager, not passed via job payload or this config.
 * This service only needs RunPod API credentials to trigger jobs.
 */
export interface TranscodingServiceConfig {
  runpodApiKey: string;
  runpodEndpointId: string;
  webhookBaseUrl: string; // Required for callbacks
  runpodApiBaseUrl?: string; // Optional: Override base RunPod API URL
  runpodDirectUrl?: string; // Optional: Use this URL as-is (skips path construction, for local container)
  runpodTimeout?: number; // /run answer timeout, defaults to 10000ms
}

export interface TranscodingServiceFullConfig
  extends ServiceConfig,
    TranscodingServiceConfig {}

/**
 * A webhook for job `jobId` may change the row only when the row holds that
 * job, or no job yet (the completion can beat the job-id write). A webhook
 * from an earlier attempt's job is stale and changes nothing.
 */
function heldJobIs(jobId: string) {
  return or(isNull(mediaItems.runpodJobId), eq(mediaItems.runpodJobId, jobId));
}

/** The SET of every move to `failed`; the detail is cut to fit the column. */
function failedFields(code: TranscodingErrorCode, detail: string) {
  return {
    status: MEDIA_STATUS.FAILED,
    transcodingError: detail.slice(0, TRANSCODING_ERROR_MAX_LENGTH),
    transcodingErrorCode: code,
    transcodingProgress: null,
    transcodingStep: null,
    updatedAt: new Date(),
  };
}

/**
 * An outcome someone must look at: a job we cannot account for, or a refusal
 * every upload will hit until the setup is fixed (bad key, endpoint, body).
 */
function needsAttention(outcome: RunPodDispatchOutcome): boolean {
  return (
    outcome.kind === 'ambiguous' ||
    (outcome.kind === 'rejected' &&
      transcodingErrorInfo(outcome.code).category === 'config')
  );
}

/** Where a creator's Retry may claim from: failed, or waiting for the transcoder. */
const RETRYABLE_FROM: readonly MediaStatus[] = [
  MEDIA_STATUS.FAILED,
  MEDIA_STATUS.UPLOADED,
];

/** What triggerJobInternal did; the route runs `dispatchPromise` after replying. */
export type InternalTriggerResult =
  | { alreadyQueued: true }
  | { alreadyQueued: false; dispatchPromise: Promise<RunPodDispatchOutcome> };

/**
 * Transcoding Service Class
 *
 * ## The dispatch state machine (Codex-l2c48.4)
 *
 * ```
 * uploaded --claim--> transcoding --webhook ok--> ready
 *    ^  |                 |  \--webhook failed--> failed --retry (claim)--+
 *    |  |                 |                                                |
 *    |  +- RunPod refuses (409/429/4xx/5xx): back to uploaded + code,      |
 *    |     attempt given back ("waiting"; the cron re-claims it)           |
 *    +---------------------------------------------------------------------+
 * ```
 *
 * - claimForDispatch is the ONLY way into `transcoding`, and the only place
 *   an attempt is counted.
 * - A timeout or network error leaves the row `transcoding`: RunPod may have
 *   queued the job. The maintenance cron asks RunPod (Codex-l2c48.5).
 * - RunPod's /run is asynchronous: it queues the job and answers at once; the
 *   handler POSTs the result to our webhook later.
 */
export class TranscodingService extends BaseService {
  private readonly runpodApiKey: string;
  private readonly runpodApiUrl: string;
  private readonly webhookUrl: string;
  private readonly runpodTimeout: number;

  /**
   * Initialize TranscodingService with RunPod credentials
   *
   * @param config - Service config with RunPod API credentials
   */
  constructor(config: TranscodingServiceFullConfig) {
    super(config);

    // Validate required config
    if (!config.runpodApiKey) {
      throw new ValidationError('TranscodingService: runpodApiKey is required');
    }
    if (!config.runpodEndpointId) {
      throw new ValidationError(
        'TranscodingService: runpodEndpointId is required'
      );
    }
    if (!config.webhookBaseUrl) {
      throw new ValidationError(
        'TranscodingService: webhookBaseUrl is required'
      );
    }

    this.runpodApiKey = config.runpodApiKey;
    // /run answers in under a second when RunPod is healthy. The dispatch runs
    // after the response, inside the worker's background budget, so a hung
    // call must give up well before that budget does.
    this.runpodTimeout = config.runpodTimeout ?? 10000;

    // Pre-construct URLs (won't change during service lifetime)
    // If a direct URL is provided (local container), use it as-is.
    // Otherwise construct from base URL + endpoint ID (RunPod cloud API).
    if (config.runpodDirectUrl) {
      this.runpodApiUrl = config.runpodDirectUrl;
    } else {
      const apiBaseUrl = config.runpodApiBaseUrl || 'https://api.runpod.ai/v2';
      this.runpodApiUrl = `${apiBaseUrl}/${config.runpodEndpointId}/run`;
    }
    this.webhookUrl = `${config.webhookBaseUrl}/api/transcoding/webhook`;
  }

  /**
   * Claim a media item for dispatch: move it to `transcoding` and count the
   * attempt, in ONE statement.
   *
   * The WHERE is the whole guard: the row must be the creator's, not
   * deleted, in one of `allowedFrom`, with attempts left, and not stopped by
   * a failure a retry cannot fix (the file itself). Two concurrent claims
   * cannot both match, so a job is dispatched once. The claim also clears the
   * last run's error, code, job id and progress, and restarts the upload's
   * 24 h clock when the item comes back from `failed` (a new submission; SET
   * reads the OLD status). A row that was only waiting keeps its clock.
   *
   * @returns The claimed row, or null when nothing matched.
   */
  async claimForDispatch(
    mediaId: string,
    allowedFrom: readonly MediaStatus[],
    creatorId: string,
    options: { priority?: number } = {}
  ): Promise<TranscodingMediaItem | null> {
    const nonRetryableCodes = Object.values(TRANSCODING_ERROR_CODES).filter(
      (code) => !transcodingErrorInfo(code).retryable
    );
    const [claimed] = await this.db
      .update(mediaItems)
      .set({
        status: MEDIA_STATUS.TRANSCODING,
        transcodingAttempts: sql`${mediaItems.transcodingAttempts} + 1`,
        transcodingError: null,
        transcodingErrorCode: null,
        runpodJobId: null,
        transcodingProgress: 0,
        transcodingStep: null,
        ...(options.priority !== undefined && {
          transcodingPriority: options.priority,
        }),
        uploadedAt: sql`CASE WHEN ${mediaItems.status} = ${MEDIA_STATUS.FAILED} THEN now() ELSE ${mediaItems.uploadedAt} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaItems.id, mediaId),
          scopedNotDeleted(mediaItems, creatorId),
          inArray(mediaItems.status, [...allowedFrom]),
          lt(mediaItems.transcodingAttempts, MAX_TRANSCODING_ATTEMPTS),
          or(
            isNull(mediaItems.transcodingErrorCode),
            notInArray(mediaItems.transcodingErrorCode, nonRetryableCodes)
          )
        )
      )
      .returning();

    return claimed ? (claimed as TranscodingMediaItem) : null;
  }

  /**
   * Send a claimed item to RunPod and record what the answer means (see
   * RunPodDispatchOutcome; recordDispatchOutcome writes it). A refusal gives
   * the attempt back: RunPod transcoded nothing, so it must not use up the
   * creator's budget.
   *
   * NEVER THROWS: it runs after the HTTP response (ctx.background), where a
   * rejection would only be lost. Every outcome is logged and returned.
   */
  async dispatch(media: TranscodingMediaItem): Promise<RunPodDispatchOutcome> {
    const request: RunPodJobRequest = {
      input: {
        mediaId: media.id,
        type: media.mediaType,
        creatorId: media.creatorId,
        inputKey: media.r2Key,
        webhookUrl: this.webhookUrl,
        priority: media.transcodingPriority,
        contract: TRANSCODING_JOB_CONTRACT,
      },
      policy: transcodingJobPolicy(media.durationSeconds),
    };

    let outcome: RunPodDispatchOutcome;
    try {
      const response = await fetch(this.runpodApiUrl, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
          [HEADERS.AUTHORIZATION]: `Bearer ${this.runpodApiKey}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.runpodTimeout),
      });
      const body = await response.text();
      outcome = classifyRunPodAnswer(response.status, body);
      if (outcome.kind !== 'accepted') {
        const context = {
          mediaId: media.id,
          statusCode: response.status,
          outcome: outcome.kind,
          code: outcome.kind === 'rejected' ? outcome.code : undefined,
          // RunPod's body, for the logs only: the detail the creator sees
          // names the status and RunPod's code, nothing else.
          body: body.slice(0, 500),
        };
        // A wait (paused, busy, down) clears up by itself. A job we cannot
        // account for, or a refusal that every upload will hit until the
        // setup is fixed, needs someone to look.
        if (needsAttention(outcome)) {
          this.obs.error('transcoding.dispatch_not_accepted', context);
        } else {
          this.obs.warn('transcoding.dispatch_not_accepted', context);
        }
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      outcome = {
        kind: 'ambiguous',
        detail: timedOut
          ? `RunPod did not answer within ${this.runpodTimeout / 1000} s`
          : 'RunPod could not be reached',
      };
      this.obs.error('transcoding.dispatch_ambiguous', {
        mediaId: media.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await this.recordDispatchOutcome(media.id, outcome);
    } catch (error) {
      // The whole outcome: an accepted job's id is otherwise in neither the
      // row nor the logs, and reconciling with RunPod needs it.
      this.obs.error('transcoding.dispatch_outcome_not_recorded', {
        mediaId: media.id,
        ...outcome,
        outcome: outcome.kind,
        error: messageForLog(error),
      });
    }
    return outcome;
  }

  /**
   * Write what a /run answer means. Both writes are guarded on the state the
   * claim left (`transcoding`, no job id yet), so a webhook or a second
   * dispatch that got there first is never overwritten.
   */
  private async recordDispatchOutcome(
    mediaId: string,
    outcome: RunPodDispatchOutcome
  ): Promise<void> {
    const claimStillHeld = and(
      eq(mediaItems.id, mediaId),
      eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
      isNull(mediaItems.runpodJobId)
    );

    if (outcome.kind === 'accepted') {
      const stored = await this.db
        .update(mediaItems)
        .set({ runpodJobId: outcome.jobId, updatedAt: new Date() })
        .where(claimStillHeld)
        .returning();
      this.obs.info('transcoding.dispatched', {
        mediaId,
        runpodJobId: outcome.jobId,
        // false: the webhook already moved the row on (fast local jobs).
        jobIdStored: stored.length > 0,
      });
      return;
    }

    if (outcome.kind === 'rejected') {
      const waiting = await this.db
        .update(mediaItems)
        .set({
          status: MEDIA_STATUS.UPLOADED,
          transcodingError: outcome.detail,
          transcodingErrorCode: outcome.code,
          transcodingAttempts: sql`GREATEST(${mediaItems.transcodingAttempts} - 1, 0)`,
          transcodingProgress: null,
          transcodingStep: null,
          updatedAt: new Date(),
        })
        .where(claimStillHeld)
        .returning();
      const context = {
        mediaId,
        code: outcome.code,
        recorded: waiting.length > 0,
      };
      if (needsAttention(outcome)) {
        this.obs.error('transcoding.waiting_for_transcoder', context);
      } else {
        this.obs.warn('transcoding.waiting_for_transcoder', context);
      }
    }
    // ambiguous: nothing to write; the row stays `transcoding`.
  }

  /**
   * Handle webhook callback from RunPod
   *
   * Called asynchronously when transcoding job completes (success or failure).
   * This is the second half of the RunPod async pattern - the completion callback.
   * Updates media_items atomically with all transcoding outputs.
   *
   * Every write is guarded on `transcoding` AND the job (heldJobIs): a late
   * webhook from an earlier attempt's job changes nothing. Attempts are NOT
   * counted here; the claim counted this job.
   *
   * NOTE: Webhook signature verification (HMAC-SHA256) must be performed by
   * the calling worker before invoking this method. This service trusts
   * that the payload has already been authenticated.
   *
   * @param payload - Validated RunPod webhook payload (already HMAC-verified)
   * @returns void
   *
   * @throws {TranscodingJobNotFoundError} If no media matches the jobId
   */
  async handleWebhook(
    payload: RunPodWebhookPayload & { mediaId?: string | null }
  ): Promise<void> {
    const { jobId, status, output, error: errorMessage, errorCode } = payload;
    // Top-level mediaId sent by Python handler on failure (fallback when
    // runpodJobId hasn't been stored yet, common in local /runsync flow)
    const fallbackMediaId = payload.mediaId;

    this.obs.info('Processing transcoding webhook', { jobId, status });

    // Find media by job ID, output.mediaId, or top-level mediaId
    const media = await this.db.query.mediaItems.findFirst({
      where: and(
        or(
          eq(mediaItems.runpodJobId, jobId),
          output?.mediaId ? eq(mediaItems.id, output.mediaId) : undefined,
          fallbackMediaId ? eq(mediaItems.id, fallbackMediaId) : undefined
        ),
        isNull(mediaItems.deletedAt)
      ),
      columns: { id: true, runpodJobId: true },
    });

    if (!media) {
      this.obs.warn('Webhook received for unknown media', { jobId });
      throw new TranscodingJobNotFoundError(jobId);
    }

    if (status === 'completed') {
      await this.completeFromWebhook(media, jobId, output);
    } else {
      await this.recordJobFailure(media.id, jobId, errorCode, errorMessage);
    }
  }

  /** A completion: `ready` with every output, for the held job only. */
  private async completeFromWebhook(
    media: { id: string; runpodJobId: string | null },
    jobId: string,
    output: RunPodWebhookPayload['output']
  ): Promise<void> {
    // Defense in depth: readyVariants must be non-empty for completed jobs.
    // Schema validation (min(1)) catches this at the route level, but guard
    // here too in case handleWebhook is called from other paths.
    if (!output?.readyVariants || output.readyVariants.length === 0) {
      this.obs.error('Completed webhook has no ready variants', {
        jobId,
        mediaId: media.id,
      });
      await this.failFromWebhook(
        media.id,
        jobId,
        TRANSCODING_ERROR_CODES.OUTPUT_REJECTED,
        'Transcoding completed but produced no playable variants'
      );
      return;
    }

    // Success: Update atomically with all transcoding outputs
    const applied = await this.writeIfJobHeld(
      media.id,
      jobId,
      {
        status: MEDIA_STATUS.READY,
        hlsMasterPlaylistKey: output.hlsMasterKey,
        hlsPreviewKey: output.hlsPreviewKey,
        // Store 'lg' variant as canonical thumbnailKey
        // (sm/md variants reconstructed via getMediaThumbnailKey helper)
        thumbnailKey: output.thumbnailKey,
        waveformKey: output.waveformKey,
        waveformImageKey: output.waveformImageKey,
        mezzanineKey: output.mezzanineKey ?? null,
        mezzanineStatus: output.mezzanineKey ? 'ready' : null,
        durationSeconds: output.durationSeconds,
        width: output.width,
        height: output.height,
        readyVariants: output.readyVariants,
        loudnessIntegrated: output.loudnessIntegrated,
        loudnessPeak: output.loudnessPeak,
        loudnessRange: output.loudnessRange,
        transcodingError: null, // Clear any previous error
        transcodingErrorCode: null,
        transcodingProgress: null,
        transcodingStep: null,
        updatedAt: new Date(),
      },
      { heldJobId: media.runpodJobId }
    );
    if (!applied) return;

    // NOTE: thumbnailVariants (sm/md/lg) are NOT stored in DB - by design.
    // Only thumbnailKey ('lg' variant) is persisted. The sm/md variants are
    // reconstructed on-demand using getMediaThumbnailKey(creatorId, mediaId, size).
    // This avoids schema changes and keeps the DB lean since paths are deterministic.
    this.obs.info('Transcoding completed successfully', {
      mediaId: media.id,
      jobId,
      durationSeconds: output.durationSeconds,
      thumbnailVariants: output.thumbnailVariants, // Logged for debugging, not stored
    });
  }

  /** A failure: the job ran and failed. Only job-side codes are accepted. */
  private async recordJobFailure(
    mediaId: string,
    jobId: string,
    errorCode: RunPodWebhookPayload['errorCode'],
    errorMessage: RunPodWebhookPayload['error']
  ): Promise<void> {
    const failure = jobFailureFromWebhook(errorCode, errorMessage);
    if (failure.unrecognisedCode) {
      this.obs.warn('transcoding.unknown_error_code', {
        jobId,
        mediaId,
        rawErrorCode: failure.unrecognisedCode,
      });
    } else if (errorCode === undefined || errorCode === null) {
      this.obs.info('transcoding.webhook_without_error_code', {
        jobId,
        mediaId,
        note: 'handler predates errorCode',
      });
    }
    const applied = await this.failFromWebhook(
      mediaId,
      jobId,
      failure.code,
      failure.detail
    );
    if (applied) {
      this.obs.error('Transcoding failed', {
        mediaId,
        jobId,
        code: failure.code,
        errorMessage: errorMessage || 'Unknown',
      });
    }
  }

  /**
   * A webhook's write: it applies only while the row is `transcoding` and
   * holds this job (heldJobIs). False = not applied, which is logged.
   */
  private async writeIfJobHeld(
    mediaId: string,
    jobId: string,
    set: Partial<typeof mediaItems.$inferInsert>,
    logContext: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.db
      .update(mediaItems)
      .set(set)
      .where(
        and(
          eq(mediaItems.id, mediaId),
          eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
          heldJobIs(jobId)
        )
      )
      .returning();

    if (result.length === 0) {
      this.obs.warn('transcoding.webhook_not_applied', {
        jobId,
        mediaId,
        ...logContext,
        reason: 'row not transcoding, or holds another job',
      });
      return false;
    }
    return true;
  }

  private failFromWebhook(
    mediaId: string,
    jobId: string,
    code: TranscodingErrorCode,
    detail: string
  ): Promise<boolean> {
    return this.writeIfJobHeld(mediaId, jobId, failedFields(code, detail), {
      code,
    });
  }

  /**
   * A signed completion or failure webhook that our schema rejected. The job
   * is over, so the row fails now (OUTPUT_REJECTED) instead of sitting in
   * `transcoding` until the cron gives up on it. Uses the ids the raw payload
   * carried. Without a job id it fails only a row that holds no job, since
   * nothing else proves the webhook is for the current attempt.
   *
   * @returns true when a row was failed.
   */
  async rejectWebhookOutput(
    ids: { jobId: string | null; mediaId: string | null },
    detail: string
  ): Promise<boolean> {
    const { jobId, mediaId } = ids;
    // Built and checked here, never inline: and() silently DROPS an undefined
    // argument, so a missing match would fail every transcoding row. or() of
    // nothing is undefined.
    const row = or(
      jobId ? eq(mediaItems.runpodJobId, jobId) : undefined,
      mediaId ? eq(mediaItems.id, mediaId) : undefined
    );
    if (!row) {
      this.obs.warn('transcoding.rejected_webhook_unmatched', {
        reason: 'no job id or media id in the payload',
      });
      return false;
    }

    const result = await this.db
      .update(mediaItems)
      .set(failedFields(TRANSCODING_ERROR_CODES.OUTPUT_REJECTED, detail))
      .where(
        and(
          row,
          eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
          isNull(mediaItems.deletedAt),
          jobId ? heldJobIs(jobId) : isNull(mediaItems.runpodJobId)
        )
      )
      .returning();

    this.obs.warn('transcoding.webhook_output_rejected', {
      jobId,
      mediaId,
      failedRows: result.length,
    });
    return result.length > 0;
  }

  /**
   * Handle a progress webhook from the transcoding handler.
   * Updates progress percentage and current step in the database.
   * Fire-and-forget: silently ignores updates for completed/failed jobs and
   * for jobs the row no longer holds.
   */
  async handleProgressWebhook(
    payload: RunPodProgressWebhookPayload
  ): Promise<void> {
    const { jobId, progress, step, mediaId } = payload;

    // Match by jobId OR mediaId (the job id may not be stored yet). A DB
    // error propagates: the webhook route logs it and answers 500.
    await this.db
      .update(mediaItems)
      .set({
        transcodingProgress: progress,
        transcodingStep: step,
        updatedAt: new Date(),
      })
      .where(
        and(
          or(
            eq(mediaItems.runpodJobId, jobId),
            mediaId ? eq(mediaItems.id, mediaId) : undefined
          ),
          eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
          heldJobIs(jobId),
          isNull(mediaItems.deletedAt)
        )
      );
  }

  /**
   * Retry transcoding: the creator's Retry button.
   *
   * Allowed from `failed`, and from `uploaded` (an item waiting for the
   * transcoder: a retry while RunPod is paused just waits again). Refused
   * when the last failure was the file itself (a retry would fail the same
   * way; the creator re-uploads), and past MAX_TRANSCODING_ATTEMPTS.
   *
   * Returns the running dispatch: the route hands it to ctx.background, so
   * the creator is answered without waiting on RunPod.
   *
   * @throws {TranscodingMediaNotFoundError} If the media isn't the creator's
   * @throws {InvalidMediaStateError} If it is transcoding, ready, or uploading
   * @throws {TranscodingNotRetryableError} If the file itself failed
   * @throws {MaxRetriesExceededError} If no attempts are left
   */
  async retryTranscoding(
    mediaId: string,
    creatorId: string
  ): Promise<{ dispatchPromise: Promise<RunPodDispatchOutcome> }> {
    this.obs.info('Retrying transcoding', { mediaId, creatorId });

    const media = await this.getMediaForTranscoding(mediaId, creatorId);
    this.assertRetryable(media);

    const claimed = await this.claimForDispatch(
      mediaId,
      RETRYABLE_FROM,
      creatorId
    );
    if (!claimed) {
      // Something moved the row between the read and the claim; say what.
      const now = await this.getMediaForTranscoding(mediaId, creatorId);
      this.assertRetryable(now);
      throw new InvalidMediaStateError(mediaId, now.status, [
        ...RETRYABLE_FROM,
      ]);
    }

    this.obs.info('Transcoding retry claimed', {
      mediaId,
      attempt: claimed.transcodingAttempts,
    });
    return { dispatchPromise: this.dispatch(claimed) };
  }

  private assertRetryable(media: TranscodingMediaItem): void {
    if (!RETRYABLE_FROM.includes(media.status)) {
      throw new InvalidMediaStateError(media.id, media.status, [
        ...RETRYABLE_FROM,
      ]);
    }
    if (
      media.transcodingErrorCode &&
      !transcodingErrorInfo(media.transcodingErrorCode).retryable
    ) {
      throw new TranscodingNotRetryableError(
        media.id,
        media.transcodingErrorCode
      );
    }
    if (media.transcodingAttempts >= MAX_TRANSCODING_ATTEMPTS) {
      throw new MaxRetriesExceededError(media.id, media.transcodingAttempts);
    }
  }

  /**
   * Get current transcoding status for a media item
   *
   * @param mediaId - Media item UUID
   * @param creatorId - Creator ID for authorization
   * @returns Transcoding status response
   *
   * @throws {TranscodingMediaNotFoundError} If media doesn't exist or isn't the creator's
   */
  async getTranscodingStatus(
    mediaId: string,
    creatorId: string
  ): Promise<TranscodingStatusResponse> {
    const media = await this.getMediaForTranscoding(mediaId, creatorId);

    return {
      status: media.status,
      transcodingAttempts: media.transcodingAttempts,
      transcodingError: media.transcodingError,
      transcodingErrorCode: media.transcodingErrorCode,
      runpodJobId: media.runpodJobId,
      transcodingPriority: media.transcodingPriority,
      transcodingProgress: media.transcodingProgress ?? null,
      // Cast from varchar to TranscodingStep - DB stores as text, validated on write
      transcodingStep: media.transcodingStep ?? null,
      // Cast from string[] to HlsVariant[] - DB stores as text[], validated on write
      readyVariants: media.readyVariants as HlsVariant[] | null,
    };
  }

  /**
   * Recover media items stuck in 'transcoding' status.
   *
   * If a webhook never arrives (network failure, RunPod outage), media
   * stays in 'transcoding' indefinitely. This method finds items stuck
   * longer than `maxAgeMinutes` and marks them as 'failed' (TIMED_OUT) so
   * they can be retried.
   *
   * Intended for scheduled/cron invocation, not user-facing.
   *
   * @param maxAgeMinutes - How long to wait before considering stuck (default: 120)
   * @returns Number of media items recovered
   *
   * Reachable only through the media-api hourly cron, which is why dead-code
   * detection flags it. Proven chain: workers/media-api/wrangler.jsonc
   * `crons: ["0 * * * *"]` -> src/index.ts:284 `export default { scheduled }`
   * -> :293 `ctx.waitUntil(runRecoverStuckTranscoding(env, ctx))` -> :261
   * `service.recoverStuckTranscoding(STUCK_MAX_AGE_MINUTES)`. Verify the chain
   * before deleting; a cron NAME is not evidence of a wired cron.
   */
  // fallow-ignore-next-line unused-class-member
  async recoverStuckTranscoding(maxAgeMinutes: number = 120): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const result = await this.db
      .update(mediaItems)
      .set(
        failedFields(
          TRANSCODING_ERROR_CODES.TIMED_OUT,
          `Stuck in transcoding for over ${maxAgeMinutes} minutes — no webhook received`
        )
      )
      .where(
        and(
          eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
          lt(mediaItems.updatedAt, cutoff),
          isNull(mediaItems.deletedAt)
        )
      )
      .returning();

    if (result.length > 0) {
      this.obs.warn(`Recovered ${result.length} stuck transcoding jobs`, {
        maxAgeMinutes,
        mediaIds: result.map((m) => m.id),
      });
    }

    return result.length;
  }

  /**
   * Internal helper to fetch media for a creator's transcoding operation.
   *
   * One answer for "missing" and "someone else's" (Codex-jxvg8): telling them
   * apart would let any account probe whether a media id exists.
   *
   * @throws {TranscodingMediaNotFoundError} If it doesn't exist or isn't the creator's
   */
  private async getMediaForTranscoding(
    mediaId: string,
    creatorId: string
  ): Promise<TranscodingMediaItem> {
    try {
      const media = await this.db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.id, mediaId),
          scopedNotDeleted(mediaItems, creatorId)
        ),
        columns: TRANSCODING_MEDIA_COLUMNS,
      });

      if (!media) {
        throw new TranscodingMediaNotFoundError(mediaId);
      }

      return media as TranscodingMediaItem;
    } catch (error) {
      if (error instanceof TranscodingMediaNotFoundError) {
        throw error;
      }
      this.handleError(error, 'getMedia');
    }
  }

  /**
   * Trigger transcoding after an upload completes (content-api, worker HMAC).
   * content-api names the uploader, so the claim is creator-scoped like any
   * other.
   *
   * Claims from `uploaded` only. A claim that matches nothing because the
   * item is already transcoding, ready or failed is NOT an error: content-api
   * re-POSTs upload-complete to recover, and two triggers for one upload must
   * dispatch once. That answers `alreadyQueued`.
   *
   * @param mediaId - Media item UUID
   * @param creatorId - The uploader, as content-api authenticated them
   * @param priority - Optional priority (0=urgent, 2=normal, 4=backlog)
   * @throws {TranscodingMediaNotFoundError} If it doesn't exist or isn't the creator's
   * @throws {InvalidMediaStateError} If it is still uploading
   * @throws {MaxRetriesExceededError} If it waits with no attempts left
   */
  async triggerJobInternal(
    mediaId: string,
    creatorId: string,
    priority?: number
  ): Promise<InternalTriggerResult> {
    this.obs.info('Triggering transcoding job (internal)', {
      mediaId,
      priority,
    });

    const claimed = await this.claimForDispatch(
      mediaId,
      [MEDIA_STATUS.UPLOADED],
      creatorId,
      { priority }
    );

    if (!claimed) {
      const media = await this.getMediaForTranscoding(mediaId, creatorId);
      if (media.status === MEDIA_STATUS.UPLOADING) {
        // Not uploaded yet, so not queued either: say so rather than "queued".
        throw new InvalidMediaStateError(
          mediaId,
          media.status,
          MEDIA_STATUS.UPLOADED,
          { operation: 'triggerJobInternal' }
        );
      }
      if (
        media.status === MEDIA_STATUS.UPLOADED &&
        media.transcodingAttempts >= MAX_TRANSCODING_ATTEMPTS
      ) {
        throw new MaxRetriesExceededError(mediaId, media.transcodingAttempts);
      }
      this.obs.info('transcoding.already_queued', {
        mediaId,
        status: media.status,
      });
      return { alreadyQueued: true };
    }

    return { alreadyQueued: false, dispatchPromise: this.dispatch(claimed) };
  }
}
