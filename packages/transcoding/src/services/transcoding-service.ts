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
 * - Creator scoping on all queries, except the maintenance run's
   (MAINTENANCE_SCOPE, cron only), which sweeps every creator's rows
 * - Every state change is ONE guarded UPDATE: its WHERE names the state it
 *   moves from, so two writers can never both apply
 * - Proper error handling with custom error classes
 */

import {
  HEADERS,
  MAX_TRANSCODING_ATTEMPTS,
  MEDIA_STATUS,
  MIME_TYPES,
  RUNPOD_WORKERS_MAX_DEFAULT,
  RUNPOD_WORKERS_MAX_LIMIT,
  TRANSCODING_ERROR_CODES,
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
import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
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
import { type MediaStatusFeed, publishMediaStatus } from '../media-status';
import {
  isPassingFailure,
  RUNPOD_SERVERLESS_API_URL,
  RunPodApi,
} from '../runpod-api';
import type {
  MediaStatus,
  RunPodJobRequest,
  TranscodingMediaItem,
} from '../types';
import { failedFields, NO_PROGRESS, waitingFields } from './media-state';
import type { TranscodingAlerts } from './transcoding-alerts';

/**
 * The columns both media reads select. `satisfies` makes it name every
 * TranscodingMediaItem field: a field added to the type but not selected is a
 * compile error, not an `undefined` that the `as TranscodingMediaItem` casts
 * below would hide (a missing error code would read as "nothing went
 * wrong").
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
  /** The max workers the endpoint should have; a lower value is RunPod scaling it down. Default RUNPOD_WORKERS_MAX_DEFAULT. */
  runpodWorkersMax?: number;
  /** Tests inject one; by default it is built from the fields above. */
  runpodApi?: RunPodApi;
  /** Failure and setup-fault emails (Codex-l2c48.6). Absent: none sent. */
  alerts?: TranscodingAlerts;
  /**
   * The studio's live status (Codex-l2c48.9): every write that returned a
   * row is published, and progress goes there only. Absent: nothing is.
   */
  mediaStatus?: MediaStatusFeed;
}

export interface TranscodingServiceFullConfig
  extends ServiceConfig,
    TranscodingServiceConfig {}

/**
 * The longest one dispatch takes: /run, then waking a paused endpoint. The
 * maintenance run starts no retry with less than this left.
 */
export const DISPATCH_BUDGET_MS = 22_000;

/**
 * A webhook for job `jobId` may change the row only when the row holds that
 * job, or no job yet (the completion can beat the job-id write). A webhook
 * from an earlier attempt's job is stale and changes nothing.
 */
function heldJobIs(jobId: string) {
  return or(isNull(mediaItems.runpodJobId), eq(mediaItems.runpodJobId, jobId));
}

/**
 * An outcome someone must look at: a job we cannot account for, or a refusal
 * every upload will hit until the setup is fixed (bad key, endpoint, body).
 */
function needsAttention(outcome: RunPodDispatchOutcome): boolean {
  return (
    outcome.kind === 'ambiguous' ||
    (outcome.kind === 'rejected' &&
      transcodingErrorInfo(outcome.code).alertOwnerOnEntry)
  );
}

/** Where a creator's Retry may claim from: failed, or waiting for the transcoder. */
const RETRYABLE_FROM: readonly MediaStatus[] = [
  MEDIA_STATUS.FAILED,
  MEDIA_STATUS.UPLOADED,
];

const MAINTENANCE: unique symbol = Symbol('transcoding-maintenance');

/**
 * The hourly maintenance run's claim scope: every creator's media. NOT
 * exported from the package, so no route or other worker can pass it, and a
 * look-alike object is not it (claimForDispatch compares identity).
 */
export const MAINTENANCE_SCOPE: Readonly<{ trusted: typeof MAINTENANCE }> =
  Object.freeze({ trusted: MAINTENANCE });

/**
 * Whose media a claim may take. A route always names the creator; an omitted
 * creator must never mean "anyone's", so a scope that is neither throws.
 */
export type ClaimScope = { creatorId: string } | typeof MAINTENANCE_SCOPE;

/**
 * The claim's scope filter. Identity, not shape: only the package's own
 * MAINTENANCE_SCOPE sweeps across creators, and anything else without a
 * creator fails closed.
 */
function claimScopeFilter(scope: ClaimScope): SQL {
  if (scope === MAINTENANCE_SCOPE) return isNull(mediaItems.deletedAt);
  if ('creatorId' in scope && scope.creatorId) {
    return scopedNotDeleted(mediaItems, scope.creatorId);
  }
  throw new ValidationError('claimForDispatch: a creator scope is required');
}

/**
 * Where /run is. A direct URL (a local container) is used as-is; otherwise
 * the base URL plus the endpoint id (RunPod cloud).
 */
function runpodRunUrl(config: TranscodingServiceConfig): string {
  if (config.runpodDirectUrl) return config.runpodDirectUrl;
  const apiBaseUrl = config.runpodApiBaseUrl || RUNPOD_SERVERLESS_API_URL;
  return `${apiBaseUrl}/${config.runpodEndpointId}/run`;
}

/** 0 would read a paused endpoint as awake for ever. */
function isSaneWorkersMax(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 1 && value <= RUNPOD_WORKERS_MAX_LIMIT
  );
}

/** What ensureEndpointAwake found and did. */
export type EndpointWakeOutcome =
  | { kind: 'awake'; max: number }
  | { kind: 'raised'; from: number; to: number }
  | { kind: 'not_raised'; from: number; reason: string }
  | { kind: 'unknown'; reason: string };

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
  private readonly runpodApi: RunPodApi;
  private readonly alerts?: TranscodingAlerts;
  private readonly mediaStatus?: MediaStatusFeed;
  private readonly runpodWorkersMax: number;
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

    this.runpodApiUrl = runpodRunUrl(config);
    this.webhookUrl = `${config.webhookBaseUrl}/api/transcoding/webhook`;

    // A bad value falls back to the default rather than stopping every
    // upload, and says so.
    const workersMax = config.runpodWorkersMax ?? RUNPOD_WORKERS_MAX_DEFAULT;
    if (!isSaneWorkersMax(workersMax)) {
      this.obs.error('transcoding.workers_max_invalid', {
        value: String(workersMax),
        using: RUNPOD_WORKERS_MAX_DEFAULT,
      });
    }
    this.runpodWorkersMax = isSaneWorkersMax(workersMax)
      ? workersMax
      : RUNPOD_WORKERS_MAX_DEFAULT;
    this.alerts = config.alerts;
    this.mediaStatus = config.mediaStatus;
    this.runpodApi =
      config.runpodApi ??
      new RunPodApi({
        apiKey: config.runpodApiKey,
        endpointId: config.runpodEndpointId,
        serverlessBaseUrl: config.runpodApiBaseUrl,
        directUrl: config.runpodDirectUrl,
      });
  }

  /**
   * Claim a media item for dispatch: move it to `transcoding` and count the
   * attempt, in ONE statement.
   *
   * The WHERE is the whole guard: the row must be in scope (the creator's,
   * unless the maintenance run says otherwise), not deleted, in one of
   * `allowedFrom`, with attempts left, and not stopped by
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
    scope: ClaimScope,
    options: { priority?: number } = {}
  ): Promise<TranscodingMediaItem | null> {
    const inScope = claimScopeFilter(scope);
    const nonRetryableCodes = Object.values(TRANSCODING_ERROR_CODES).filter(
      (code) => !transcodingErrorInfo(code).retryable
    );
    // A bound instant, not the SQL clock: the query text stays the same on
    // every request, so Hyperdrive can cache it (data-access contract rule 6).
    const now = new Date();
    const [claimed] = await this.db
      .update(mediaItems)
      .set({
        ...NO_PROGRESS,
        status: MEDIA_STATUS.TRANSCODING,
        transcodingAttempts: sql`${mediaItems.transcodingAttempts} + 1`,
        transcodingError: null,
        transcodingErrorCode: null,
        runpodJobId: null,
        ...(options.priority !== undefined && {
          transcodingPriority: options.priority,
        }),
        uploadedAt: sql`CASE WHEN ${mediaItems.status} = ${MEDIA_STATUS.FAILED} THEN ${now} ELSE ${mediaItems.uploadedAt} END`,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaItems.id, mediaId),
          inScope,
          inArray(mediaItems.status, [...allowedFrom]),
          lt(mediaItems.transcodingAttempts, MAX_TRANSCODING_ATTEMPTS),
          or(
            isNull(mediaItems.transcodingErrorCode),
            notInArray(mediaItems.transcodingErrorCode, nonRetryableCodes)
          )
        )
      )
      .returning();

    if (!claimed) return null;
    this.publish(claimed);
    return claimed as TranscodingMediaItem;
  }

  /** Tell the studio what a guarded write returned. Never throws. */
  publish(row: typeof mediaItems.$inferSelect): void {
    publishMediaStatus(this.mediaStatus, row, this.obs);
  }

  /**
   * Send a claimed item to RunPod and record what the answer means (see
   * RunPodDispatchOutcome; recordDispatchOutcome writes it). A refusal gives
   * the attempt back: RunPod transcoded nothing, so it must not use up the
   * creator's budget.
   *
   * NEVER THROWS: it runs after the HTTP response (ctx.background), where a
   * rejection would only be lost. Every outcome is logged and returned. A
   * setup fault it reveals goes to the alerts, which mail it once a day.
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

    const startedAt = Date.now();
    let refusedWith409 = false;
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
      refusedWith409 = response.status === 409;
      if (outcome.kind !== 'accepted') {
        this.logNotAccepted(media.id, response.status, outcome, body);
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

    // A 409 is how a paused endpoint answers (the body's code is
    // undocumented, so the endpoint's max workers is read to be sure). The
    // waiting state is already written; waking RunPod is all that is left,
    // inside the background budget. The retry comes from the scheduler.
    const woke = refusedWith409
      ? await this.ensureEndpointAwake(startedAt + DISPATCH_BUDGET_MS)
      : undefined;
    this.alerts?.dispatchRefused(media.id, outcome);
    if (woke) this.alerts?.endpointStuck(woke);
    return outcome;
  }

  /**
   * A wait (paused, busy, down) clears up by itself. A job we cannot account
   * for, or a refusal that every upload will hit until the setup is fixed,
   * needs someone to look.
   */
  private logNotAccepted(
    mediaId: string,
    statusCode: number,
    outcome: Exclude<RunPodDispatchOutcome, { kind: 'accepted' }>,
    body: string
  ): void {
    const context = {
      mediaId,
      statusCode,
      outcome: outcome.kind,
      code: outcome.kind === 'rejected' ? outcome.code : undefined,
      // RunPod's body, for the logs only: the detail the creator sees names
      // the status and RunPod's code, nothing else.
      body: body.slice(0, 500),
    };
    if (needsAttention(outcome)) {
      this.obs.error('transcoding.dispatch_not_accepted', context);
    } else {
      this.obs.warn('transcoding.dispatch_not_accepted', context);
    }
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
      for (const row of stored) this.publish(row);
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
        .set(waitingFields(outcome.code, outcome.detail))
        .where(claimStillHeld)
        .returning();
      for (const row of waiting) this.publish(row);
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
   * The RunPod calls the maintenance run makes itself. Changing the endpoint
   * stays behind ensureEndpointAwake.
   */
  get runpodJobs(): Pick<RunPodApi, 'jobStatus' | 'ping'> {
    return this.runpodApi;
  }

  /**
   * Raise the endpoint's max workers when RunPod has scaled it down (paused:
   * 0; after three idle days: 2). Reads first, so an awake endpoint costs one
   * GET. NEVER THROWS.
   *
   * A key that may not read or change the endpoint (`not_permitted`) is
   * logged at error as `auto_unpause_not_permitted`: auto-unpause is
   * unavailable until the owner gives the key Serverless write access, and a
   * paused endpoint then needs raising by hand. Every other failure that is
   * not passing (an unreadable answer, a raise RunPod did not apply) is an
   * error too.
   */
  async ensureEndpointAwake(deadline: number): Promise<EndpointWakeOutcome> {
    const current = await this.runpodApi.endpointWorkers(deadline);
    if (!current.ok) {
      // Anything but a passing failure means auto-unpause cannot work until
      // someone fixes the key or the setup: a paused endpoint would then stay
      // paused, every upload waiting, so it is an error.
      const context = { reason: current.reason, statusCode: current.status };
      if (current.reason === 'not_permitted') {
        this.obs.error('transcoding.auto_unpause_not_permitted', context);
      } else if (isPassingFailure(current.reason)) {
        this.obs.warn('transcoding.endpoint_workers_unread', context);
      } else {
        this.obs.error('transcoding.endpoint_workers_unread', context);
      }
      return { kind: 'unknown', reason: current.reason };
    }
    if (current.max >= this.runpodWorkersMax) {
      return { kind: 'awake', max: current.max };
    }

    const raised = await this.runpodApi.setWorkersMax(
      this.runpodWorkersMax,
      deadline
    );
    if (!raised.ok) {
      const context = {
        from: current.max,
        wanted: this.runpodWorkersMax,
        reason: raised.reason,
        statusCode: raised.status,
      };
      if (raised.reason === 'not_permitted') {
        this.obs.error('transcoding.auto_unpause_not_permitted', context);
      } else if (isPassingFailure(raised.reason)) {
        this.obs.warn('transcoding.endpoint_workers_not_raised', context);
      } else {
        this.obs.error('transcoding.endpoint_workers_not_raised', context);
      }
      return { kind: 'not_raised', from: current.max, reason: raised.reason };
    }
    // A 2xx is not a raise: RunPod must confirm the new value.
    if (raised.max < this.runpodWorkersMax) {
      this.obs.error('transcoding.endpoint_workers_not_raised', {
        from: current.max,
        wanted: this.runpodWorkersMax,
        confirmed: raised.max,
        reason: 'not_applied',
      });
      return { kind: 'not_raised', from: current.max, reason: 'not_applied' };
    }
    this.obs.warn('transcoding.endpoint_workers_raised', {
      from: current.max,
      to: raised.max,
    });
    return { kind: 'raised', from: current.max, to: raised.max };
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
        ...NO_PROGRESS,
        status: MEDIA_STATUS.READY,
        hlsMasterPlaylistKey: output.hlsMasterKey,
        hlsPreviewKey: output.hlsPreviewKey,
        // The 'lg' poster. Every other size sits beside it in the same
        // folder (the web derives each from this key): sm/md/lg/xl in the
        // sized layout `{w}x{h}-{nonce}/` when the job is contract 2 and the
        // picture's size is known; otherwise sm/md/lg in the flat layout
        // (an older handler always writes that).
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
        updatedAt: new Date(),
      },
      { heldJobId: media.runpodJobId }
    );
    if (!applied) return;
    this.publish(applied);

    // thumbnailVariants is logged, not stored: every size is beside
    // thumbnailKey, in the folder it names.
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
   * holds this job (heldJobIs). Returns the row written, or undefined when
   * nothing was (which is logged).
   */
  private async writeIfJobHeld(
    mediaId: string,
    jobId: string,
    set: Partial<typeof mediaItems.$inferInsert>,
    logContext: Record<string, unknown>
  ): Promise<typeof mediaItems.$inferSelect | undefined> {
    const result = await this.db
      .update(mediaItems)
      .set(set)
      .where(
        and(
          eq(mediaItems.id, mediaId),
          eq(mediaItems.status, MEDIA_STATUS.TRANSCODING),
          isNull(mediaItems.deletedAt),
          heldJobIs(jobId)
        )
      )
      .returning();

    if (result.length === 0) {
      this.obs.warn('transcoding.webhook_not_applied', {
        jobId,
        mediaId,
        ...logContext,
        reason: 'row not transcoding, deleted, or holds another job',
      });
      return undefined;
    }
    return result[0];
  }

  /**
   * Fail the row from a webhook. The emails go only when this delivery's
   * write applied: a retried delivery finds the row already failed.
   */
  private async failFromWebhook(
    mediaId: string,
    jobId: string,
    code: TranscodingErrorCode,
    detail: string
  ): Promise<boolean> {
    const failed = await this.writeIfJobHeld(
      mediaId,
      jobId,
      failedFields(code, detail),
      { code }
    );
    if (failed) {
      this.publish(failed);
      this.alerts?.mediaFailed(failed);
    }
    return failed !== undefined;
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
    for (const failed of result) {
      this.publish(failed);
      this.alerts?.mediaFailed(failed);
    }
    return result.length > 0;
  }

  /**
   * A progress webhook from the transcoding handler: it goes to the studio's
   * live status only, never Postgres (Codex-l2c48.9; about nine writes a job
   * removed). The object applies a tick only while the row is `transcoding`
   * and holds this job (or none yet), the rule the SQL WHERE used to be.
   * Advisory: a tick that cannot be delivered is logged by the feed.
   */
  async handleProgressWebhook(
    payload: RunPodProgressWebhookPayload
  ): Promise<void> {
    const { jobId, progress, step, mediaId, creatorId } = payload;
    // Every handler since the first sends mediaId when it has one; without
    // it there is no item to show the tick on. Without the feed (an env with
    // no MEDIA_STATUS binding) there is nowhere to keep it.
    if (!mediaId || !this.mediaStatus) {
      this.obs.warn('transcoding.progress_dropped', {
        jobId,
        reason: mediaId ? 'no_feed' : 'no_media_id',
      });
      return;
    }
    await this.mediaStatus.progress(
      { mediaId, jobId, step, progress },
      creatorId ?? null
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

    const claimed = await this.claimForDispatch(mediaId, RETRYABLE_FROM, {
      creatorId,
    });
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
      { creatorId },
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
