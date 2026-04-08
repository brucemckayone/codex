/**
 * Transcoding Service
 *
 * Manages media transcoding lifecycle via RunPod integration.
 *
 * Key Responsibilities:
 * - Trigger transcoding jobs on RunPod
 * - Handle webhook callbacks from RunPod
 * - Manage retry logic (max 3 retries)
 * - Update media item status and metadata
 *
 * Key Principles:
 * - All R2 paths come from paths.ts (SINGLE SOURCE OF TRUTH)
 * - Creator scoping on all queries
 * - Transaction safety for multi-step operations
 * - Proper error handling with custom error classes
 */

import { HEADERS, MEDIA_STATUS, MIME_TYPES } from '@codex/constants';
import { scopedNotDeleted } from '@codex/database';

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
import { and, eq, isNull, lt, or } from 'drizzle-orm';

import {
  InvalidMediaStateError,
  MaxRetriesExceededError,
  MediaOwnershipError,
  RunPodApiError,
  TranscodingJobNotFoundError,
  TranscodingMediaNotFoundError,
} from '../errors';
import { getTranscodingOutputKeys } from '../paths';
import type {
  HlsVariant,
  MediaType,
  RunPodJobRequest,
  RunPodJobResponse,
  TranscodingMediaItem,
  TranscodingStatusResponse,
} from '../types';

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
  runpodTimeout?: number; // Configurable timeout, defaults to 30000ms
}

export interface TranscodingServiceFullConfig
  extends ServiceConfig,
    TranscodingServiceConfig {}

/**
 * Transcoding Service Class
 *
 * Manages transcoding lifecycle for video and audio media via RunPod integration.
 *
 * ## RunPod Async Pattern
 *
 * RunPod's /run endpoint is asynchronous (fire-and-forget):
 * 1. triggerJob() calls POST /v2/{endpoint_id}/run
 * 2. RunPod returns immediately with { id: "job-xxx", status: "IN_QUEUE" }
 * 3. The actual transcoding runs on a GPU worker in the background
 * 4. On completion, RunPod POSTs results to our webhook URL
 * 5. handleWebhook() processes the callback and updates the database
 *
 * This means triggerJob() returns quickly - it doesn't wait for transcoding.
 * Status tracking relies on webhook callbacks, not polling.
 */
export class TranscodingService extends BaseService {
  private readonly runpodApiKey: string;
  private readonly runpodEndpointId: string;
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
    this.runpodEndpointId = config.runpodEndpointId;
    this.runpodTimeout = config.runpodTimeout ?? 30000;

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
   * Trigger a new transcoding job on RunPod
   *
   * @param mediaId - Media item UUID
   * @param creatorId - Creator ID for authorization
   * @param priority - Optional priority (0=urgent, 2=normal, 4=backlog)
   * @returns void
   *
   * @throws {TranscodingMediaNotFoundError} If media doesn't exist or not owned
   * @throws {InvalidMediaStateError} If media is not in 'uploaded' status
   * @throws {RunPodApiError} If RunPod API call fails
   */
  async triggerJob(
    mediaId: string,
    creatorId: string,
    priority?: number
  ): Promise<void> {
    this.obs.info('Triggering transcoding job', {
      mediaId,
      creatorId,
      priority,
    });

    // Step 1: Fetch and validate media
    const media = await this.getMediaForTranscoding(mediaId, creatorId);

    // Verify media is in correct state
    if (media.status !== MEDIA_STATUS.UPLOADED) {
      throw new InvalidMediaStateError(
        mediaId,
        media.status,
        MEDIA_STATUS.UPLOADED,
        {
          operation: 'triggerJob',
        }
      );
    }

    // Verify input file exists
    if (!media.r2Key) {
      throw new ValidationError('Input file not uploaded (r2Key missing)', {
        mediaId,
      });
    }

    // Step 2: Construct job request
    // SECURITY: Storage credentials are NOT passed in job payload.
    // - B2 and R2 credentials are configured in RunPod's secret manager
    // - Job payload only includes paths (inputKey, output paths) for the handler
    // - This avoids logging credentials in RunPod's system
    const jobRequest: RunPodJobRequest = {
      input: {
        mediaId: media.id,
        type: media.mediaType,
        creatorId: media.creatorId,
        inputKey: media.r2Key,
        webhookUrl: this.webhookUrl,
        priority: priority ?? media.transcodingPriority,
      },
    };

    // Step 3: Call RunPod /run API (async)
    let runpodJobId: string;

    try {
      // Call RunPod API with configurable timeout
      const response = await fetch(this.runpodApiUrl, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
          [HEADERS.AUTHORIZATION]: `Bearer ${this.runpodApiKey}`,
        },
        body: JSON.stringify(jobRequest),
        signal: AbortSignal.timeout(this.runpodTimeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.obs.error('RunPod API error', {
          mediaId,
          statusCode: response.status,
          errorText,
        });
        throw new RunPodApiError('triggerJob', response.status, {
          responseBody: errorText,
        });
      }

      const result = (await response.json()) as RunPodJobResponse;
      runpodJobId = result.id;
    } catch (error) {
      if (error instanceof RunPodApiError) {
        throw error;
      }
      // Check for timeout/abort errors
      throw new RunPodApiError('triggerJob', undefined, {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }

    // Step 4: Update media status to 'transcoding'
    await this.db
      .update(mediaItems)
      .set({
        status: MEDIA_STATUS.TRANSCODING,
        runpodJobId,
        transcodingPriority: priority ?? media.transcodingPriority,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));

    this.obs.info('Transcoding job started', {
      mediaId,
      runpodJobId,
      mediaType: media.mediaType,
    });
  }

  /**
   * Handle webhook callback from RunPod
   *
   * Called asynchronously when transcoding job completes (success or failure).
   * This is the second half of the RunPod async pattern - the completion callback.
   * Updates media_items atomically with all transcoding outputs.
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
    payload: RunPodWebhookPayload & { mediaId?: string }
  ): Promise<void> {
    const { jobId, status, output, error: errorMessage } = payload;
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
    });

    if (!media) {
      this.obs.warn('Webhook received for unknown media', { jobId });
      throw new TranscodingJobNotFoundError(jobId);
    }

    // NOTE: We rely on the atomic WHERE clause (status='transcoding') to prevent
    // race conditions. A previous early-return check was removed because it created
    // a TOCTOU vulnerability where:
    // 1. Check passes (status is 'transcoding')
    // 2. Concurrent request updates status to 'ready'
    // 3. This request continues and could overwrite with stale data
    // The atomic WHERE check handles this correctly.

    if (status === 'completed' && output) {
      // Defense in depth: readyVariants must be non-empty for completed jobs.
      // Schema validation (min(1)) catches this at the route level, but guard
      // here too in case handleWebhook is called from other paths.
      if (!output.readyVariants || output.readyVariants.length === 0) {
        this.obs.error('Completed webhook has no ready variants', {
          jobId,
          mediaId: media.id,
        });
        await this.db
          .update(mediaItems)
          .set({
            status: MEDIA_STATUS.FAILED,
            transcodingError:
              'Transcoding completed but produced no playable variants',
            transcodingAttempts: media.transcodingAttempts + 1,
            transcodingProgress: null,
            transcodingStep: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mediaItems.id, media.id),
              eq(mediaItems.status, MEDIA_STATUS.TRANSCODING)
            )
          );
        return;
      }

      // Success: Update atomically with all transcoding outputs
      // Only updates if status='transcoding' to prevent race conditions
      const result = await this.db
        .update(mediaItems)
        .set({
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
          transcodingProgress: null,
          transcodingStep: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaItems.id, media.id),
            eq(mediaItems.status, MEDIA_STATUS.TRANSCODING)
          )
        )
        .returning();

      if (result.length === 0) {
        this.obs.warn(
          'Media no longer in transcoding state (concurrent update)',
          {
            jobId,
            mediaId: media.id,
          }
        );
        return;
      }

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
    } else {
      // Failure: Store error message atomically, increment retry counter
      const result = await this.db
        .update(mediaItems)
        .set({
          status: MEDIA_STATUS.FAILED,
          // Truncate error message to fit varchar(2000) DB constraint
          transcodingError: (
            errorMessage || 'Unknown transcoding error'
          ).substring(0, 2000),
          transcodingAttempts: media.transcodingAttempts + 1,
          transcodingProgress: null,
          transcodingStep: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaItems.id, media.id),
            eq(mediaItems.status, MEDIA_STATUS.TRANSCODING)
          )
        )
        .returning();

      if (result.length === 0) {
        this.obs.warn(
          'Media no longer in transcoding state (concurrent update)',
          {
            jobId,
            mediaId: media.id,
          }
        );
        return;
      }

      this.obs.error('Transcoding failed', {
        mediaId: media.id,
        jobId,
        errorMessage: errorMessage || 'Unknown',
      });
    }
  }

  /**
   * Handle a progress webhook from the transcoding handler.
   * Updates progress percentage and current step in the database.
   * Fire-and-forget: silently ignores updates for completed/failed jobs.
   */
  async handleProgressWebhook(
    payload: RunPodProgressWebhookPayload
  ): Promise<void> {
    const { jobId, progress, step, mediaId } = payload;

    // Match by jobId OR mediaId (jobId may not be stored yet if /runsync is still blocking)
    try {
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
            isNull(mediaItems.deletedAt)
          )
        );
    } catch (error) {
      this.obs.warn('Progress webhook DB update failed', {
        jobId,
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Retry a failed transcoding job
   *
   * Only 3 retries are allowed per media item.
   * Uses atomic conditional update to prevent race conditions.
   *
   * @param mediaId - Media item UUID
   * @param creatorId - Creator ID for authorization
   * @returns void
   *
   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
   * @throws {MediaOwnershipError} If creator doesn't own the media
   * @throws {InvalidMediaStateError} If media is not in 'failed' status
   * @throws {MaxRetriesExceededError} If retry limit (3) reached
   */
  async retryTranscoding(mediaId: string, creatorId: string): Promise<void> {
    this.obs.info('Retrying transcoding', { mediaId, creatorId });

    // Step 1: Verify ownership first (separate from atomic update for clear error messages)
    const media = await this.getMediaForTranscoding(mediaId, creatorId);

    // Step 2: Atomic conditional update - prevents TOCTOU race
    // Only updates if status='failed' AND attempts < 3
    const result = await this.db
      .update(mediaItems)
      .set({
        status: MEDIA_STATUS.UPLOADED,
        transcodingAttempts: media.transcodingAttempts + 1,
        transcodingError: null,
        runpodJobId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaItems.id, mediaId),
          eq(mediaItems.status, MEDIA_STATUS.FAILED),
          lt(mediaItems.transcodingAttempts, 3) // Allow up to 3 retries
        )
      )
      .returning();

    if (result.length === 0) {
      // Determine which condition failed for appropriate error
      if (media.status !== MEDIA_STATUS.FAILED) {
        throw new InvalidMediaStateError(
          mediaId,
          media.status,
          MEDIA_STATUS.FAILED,
          {
            operation: 'retryTranscoding',
          }
        );
      }
      // Must be max retries exceeded
      throw new MaxRetriesExceededError(mediaId, media.transcodingAttempts);
    }

    // Step 3: Trigger new job
    await this.triggerJob(mediaId, creatorId);

    this.obs.info('Transcoding retry triggered', {
      mediaId,
      attempt: media.transcodingAttempts + 1,
    });
  }

  /**
   * Get current transcoding status for a media item
   *
   * @param mediaId - Media item UUID
   * @param creatorId - Creator ID for authorization
   * @returns Transcoding status response
   *
   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
   * @throws {MediaOwnershipError} If creator doesn't own the media
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
   * longer than `maxAgeMinutes` and marks them as 'failed' so they can
   * be retried.
   *
   * Intended for scheduled/cron invocation, not user-facing.
   *
   * @param maxAgeMinutes - How long to wait before considering stuck (default: 120)
   * @returns Number of media items recovered
   */
  async recoverStuckTranscoding(maxAgeMinutes: number = 120): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const result = await this.db
      .update(mediaItems)
      .set({
        status: MEDIA_STATUS.FAILED,
        transcodingError: `Stuck in transcoding for over ${maxAgeMinutes} minutes — no webhook received`,
        updatedAt: new Date(),
      })
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
   * Get expected output keys for a transcoding job
   *
   * Utility method to get all expected R2 paths for transcoding outputs.
   * Uses paths.ts as the single source of truth.
   *
   * @param creatorId - Creator ID
   * @param mediaId - Media item UUID
   * @param mediaType - Type of media (video or audio)
   * @returns Object with all expected output keys
   */
  getExpectedOutputKeys(
    creatorId: string,
    mediaId: string,
    mediaType: MediaType
  ) {
    return getTranscodingOutputKeys(creatorId, mediaId, mediaType);
  }

  /**
   * Internal helper to fetch and validate media for transcoding operations
   *
   * @param mediaId - Media item UUID
   * @param creatorId - Creator ID for authorization
   * @returns Media item data
   *
   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
   * @throws {MediaOwnershipError} If creator doesn't own the media
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
        columns: {
          id: true,
          creatorId: true,
          mediaType: true,
          status: true,
          r2Key: true,
          transcodingAttempts: true,
          runpodJobId: true,
          transcodingError: true,
          transcodingPriority: true,
          transcodingProgress: true,
          transcodingStep: true,
          hlsMasterPlaylistKey: true,
          hlsPreviewKey: true,
          thumbnailKey: true,
          waveformKey: true,
          waveformImageKey: true,
          durationSeconds: true,
          width: true,
          height: true,
          readyVariants: true,
        },
      });

      if (!media) {
        // Check if media exists but belongs to different creator
        const exists = await this.db.query.mediaItems.findFirst({
          where: eq(mediaItems.id, mediaId),
          columns: { id: true, creatorId: true },
        });

        if (exists && exists.creatorId !== creatorId) {
          throw new MediaOwnershipError(mediaId, creatorId);
        }

        throw new TranscodingMediaNotFoundError(mediaId);
      }

      return media as TranscodingMediaItem;
    } catch (error) {
      if (
        error instanceof TranscodingMediaNotFoundError ||
        error instanceof MediaOwnershipError
      ) {
        throw error;
      }
      this.handleError(error, 'getMedia');
    }
  }

  /**
   * Get media item for transcoding without authorization check
   *
   * INTERNAL USE ONLY: Used by triggerJobInternal for worker-to-worker calls
   * where authentication is done via HMAC instead of user session.
   */
  private async getMediaForTranscodingInternal(
    mediaId: string
  ): Promise<TranscodingMediaItem> {
    const media = await this.db.query.mediaItems.findFirst({
      where: and(eq(mediaItems.id, mediaId), isNull(mediaItems.deletedAt)),
      columns: {
        id: true,
        creatorId: true,
        mediaType: true,
        status: true,
        r2Key: true,
        transcodingAttempts: true,
        runpodJobId: true,
        transcodingError: true,
        transcodingPriority: true,
        transcodingProgress: true,
        transcodingStep: true,
        hlsMasterPlaylistKey: true,
        hlsPreviewKey: true,
        thumbnailKey: true,
        waveformKey: true,
        waveformImageKey: true,
        durationSeconds: true,
        width: true,
        height: true,
        readyVariants: true,
      },
    });

    if (!media) {
      throw new TranscodingMediaNotFoundError(mediaId);
    }

    return media as TranscodingMediaItem;
  }

  /**
   * Trigger transcoding job for internal worker-to-worker calls
   *
   * INTERNAL USE ONLY: Called by media-api internal route after content-api
   * triggers transcoding post-upload. Authentication is via HMAC workerAuth,
   * not user session, so no creatorId authorization check is needed.
   *
   * @param mediaId - Media item UUID
   * @param priority - Optional priority (0=urgent, 2=normal, 4=backlog)
   * @returns Object containing a dispatchPromise that the caller should pass to waitUntil()
   */
  async triggerJobInternal(
    mediaId: string,
    priority?: number
  ): Promise<{ dispatchPromise: Promise<void> }> {
    this.obs.info('Triggering transcoding job (internal)', {
      mediaId,
      priority,
    });

    // Fetch media without authorization check (workerAuth is the auth layer)
    const media = await this.getMediaForTranscodingInternal(mediaId);

    // Verify media is in correct state
    if (media.status !== MEDIA_STATUS.UPLOADED) {
      throw new InvalidMediaStateError(
        mediaId,
        media.status,
        MEDIA_STATUS.UPLOADED,
        {
          operation: 'triggerJobInternal',
        }
      );
    }

    // Update DB status BEFORE calling RunPod — ensures webhooks can find the
    // media item immediately, and the frontend sees 'transcoding' status.
    const finalPriority = priority ?? media.transcodingPriority ?? 2;

    await this.db
      .update(mediaItems)
      .set({
        status: MEDIA_STATUS.TRANSCODING,
        transcodingPriority: finalPriority,
        transcodingProgress: 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaItems.id, mediaId),
          eq(mediaItems.status, MEDIA_STATUS.UPLOADED)
        )
      );

    // Construct job request
    const jobRequest: RunPodJobRequest = {
      input: {
        mediaId: media.id,
        type: media.mediaType,
        creatorId: media.creatorId,
        inputKey: media.r2Key,
        webhookUrl: this.webhookUrl,
        priority: finalPriority,
      },
    };

    this.obs.info('Transcoding job triggered (internal)', {
      mediaId,
      runpodJobId: null,
    });

    // Return the RunPod dispatch as an unresolved promise.
    // The caller should use waitUntil() to keep the worker alive.
    // In production, RunPod /run returns in <1s. Locally, /runsync blocks for minutes.
    const dispatchPromise = this.dispatchRunPodJob(mediaId, jobRequest);

    return { dispatchPromise };
  }

  /**
   * Fire the RunPod API call and update DB with jobId on success.
   * Designed to be called via waitUntil() — does not throw on failure,
   * logs errors and marks media as failed instead.
   */
  private async dispatchRunPodJob(
    mediaId: string,
    jobRequest: RunPodJobRequest
  ): Promise<void> {
    try {
      const response = await fetch(this.runpodApiUrl, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
          [HEADERS.AUTHORIZATION]: `Bearer ${this.runpodApiKey}`,
        },
        body: JSON.stringify(jobRequest),
        signal: AbortSignal.timeout(this.runpodTimeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.obs.error('RunPod dispatch failed', {
          mediaId,
          statusCode: response.status,
          error: errorText,
        });
        await this.markTranscodingFailed(
          mediaId,
          `RunPod API error: ${response.status}`
        );
        return;
      }

      const result = (await response.json()) as RunPodJobResponse;

      // Store job ID for tracking (webhook uses mediaId as primary lookup)
      await this.db
        .update(mediaItems)
        .set({ runpodJobId: result.id, updatedAt: new Date() })
        .where(eq(mediaItems.id, mediaId));

      this.obs.info('RunPod job dispatched', {
        mediaId,
        runpodJobId: result.id,
      });
    } catch (error) {
      this.obs.error('RunPod dispatch error', {
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.markTranscodingFailed(
        mediaId,
        error instanceof Error ? error.message : 'RunPod dispatch failed'
      );
    }
  }

  /**
   * Mark a media item as failed (used by background dispatch on error)
   */
  private async markTranscodingFailed(
    mediaId: string,
    errorMessage: string
  ): Promise<void> {
    try {
      await this.db
        .update(mediaItems)
        .set({
          status: MEDIA_STATUS.FAILED,
          transcodingError: errorMessage.substring(0, 2000),
          transcodingProgress: null,
          transcodingStep: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaItems.id, mediaId),
            eq(mediaItems.status, MEDIA_STATUS.TRANSCODING)
          )
        );
    } catch (markError) {
      this.obs.error('Double failure: could not mark media as failed', {
        mediaId,
        originalError: errorMessage,
        markError:
          markError instanceof Error ? markError.message : String(markError),
      });
    }
  }
}
