/**
 * Transcoding Service
 *
 * Manages media transcoding lifecycle via RunPod integration.
 *
 * Key Responsibilities:
 * - Trigger transcoding jobs on RunPod
 * - Handle webhook callbacks from RunPod
 * - Manage retry logic (max 1 retry)
 * - Update media item status and metadata
 *
 * Key Principles:
 * - All R2 paths come from paths.ts (SINGLE SOURCE OF TRUTH)
 * - Creator scoping on all queries
 * - Transaction safety for multi-step operations
 * - Proper error handling with custom error classes
 */

import { scopedNotDeleted } from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import type { RunPodWebhookPayload } from '@codex/validation';
import { and, eq, isNull, or } from 'drizzle-orm';

import {
  InvalidMediaStateError,
  MaxRetriesExceededError,
  MediaOwnershipError,
  RunPodApiError,
  TranscodingJobNotFoundError,
  TranscodingMediaNotFoundError,
  wrapError,
} from '../errors';
import { getTranscodingOutputKeys } from '../paths';
import type {
  HlsVariant,
  MediaStatus,
  MediaType,
  RunPodJobRequest,
  RunPodJobResponse,
  TranscodingMediaItem,
  TranscodingServiceConfig,
  TranscodingStatusResponse,
} from '../types';

/**
 * Extended service config for TranscodingService
 */
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

  /**
   * Initialize TranscodingService with RunPod credentials
   *
   * @param config - Service config with RunPod API credentials
   */
  constructor(config: TranscodingServiceFullConfig) {
    super(config);

    // Validate required config
    if (!config.runpodApiKey) {
      throw new Error('TranscodingService: runpodApiKey is required');
    }
    if (!config.runpodEndpointId) {
      throw new Error('TranscodingService: runpodEndpointId is required');
    }
    if (!config.webhookBaseUrl) {
      throw new Error('TranscodingService: webhookBaseUrl is required');
    }

    this.runpodApiKey = config.runpodApiKey;
    this.runpodEndpointId = config.runpodEndpointId;

    // Pre-construct URLs (won't change during service lifetime)
    this.runpodApiUrl = `https://api.runpod.ai/v2/${config.runpodEndpointId}/run`;
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
    if (media.status !== 'uploaded') {
      throw new InvalidMediaStateError(mediaId, media.status, 'uploaded', {
        operation: 'triggerJob',
      });
    }

    // Step 2: Construct job request
    // Note: webhookUrl is pre-constructed in constructor for consistency
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
    // IMPORTANT: RunPod /run is fire-and-forget. The API returns immediately
    // with a job ID while the transcoding runs in the background. Completion
    // is reported via webhook callback to this.webhookUrl.
    let runpodJobId: string;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(this.runpodApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.runpodApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jobRequest),
        signal: controller.signal,
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
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RunPodApiError('triggerJob', undefined, {
          originalError: 'Request timed out after 30 seconds',
        });
      }
      throw new RunPodApiError('triggerJob', undefined, {
        originalError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Step 4: Update media status to 'transcoding'
    await this.db
      .update(mediaItems)
      .set({
        status: 'transcoding',
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
  async handleWebhook(payload: RunPodWebhookPayload): Promise<void> {
    const { jobId, status, output, error: errorMessage } = payload;

    this.obs.info('Processing transcoding webhook', { jobId, status });

    // Find media by job ID or mediaId from output
    const media = await this.db.query.mediaItems.findFirst({
      where: or(
        eq(mediaItems.runpodJobId, jobId),
        output?.mediaId ? eq(mediaItems.id, output.mediaId) : undefined
      ),
    });

    if (!media) {
      this.obs.warn('Webhook received for unknown media', { jobId });
      throw new TranscodingJobNotFoundError(jobId);
    }

    // Ignore stale webhooks - only process if media is in 'transcoding' state
    if (media.status !== 'transcoding') {
      this.obs.warn('Webhook received for non-transcoding media, ignoring', {
        jobId,
        mediaId: media.id,
        currentStatus: media.status,
      });
      return;
    }

    if (status === 'completed' && output) {
      // Success: Update with all transcoding outputs
      await this.db
        .update(mediaItems)
        .set({
          status: 'ready',
          hlsMasterPlaylistKey: output.hlsMasterKey,
          hlsPreviewKey: output.hlsPreviewKey,
          thumbnailKey: output.thumbnailKey,
          waveformKey: output.waveformKey,
          waveformImageKey: output.waveformImageKey,
          durationSeconds: output.durationSeconds,
          width: output.width,
          height: output.height,
          readyVariants: output.readyVariants,
          loudnessIntegrated: output.loudnessIntegrated,
          loudnessPeak: output.loudnessPeak,
          loudnessRange: output.loudnessRange,
          transcodingError: null, // Clear any previous error
          updatedAt: new Date(),
        })
        .where(eq(mediaItems.id, media.id));

      this.obs.info('Transcoding completed successfully', {
        mediaId: media.id,
        jobId,
        durationSeconds: output.durationSeconds,
      });
    } else {
      // Failure: Store error message
      await this.db
        .update(mediaItems)
        .set({
          status: 'failed',
          transcodingError: errorMessage || 'Unknown transcoding error',
          updatedAt: new Date(),
        })
        .where(eq(mediaItems.id, media.id));

      this.obs.error('Transcoding failed', {
        mediaId: media.id,
        jobId,
        errorMessage: errorMessage || 'Unknown',
      });
    }
  }

  /**
   * Retry a failed transcoding job
   *
   * Only 1 retry is allowed per media item.
   * Resets status to 'uploaded' and triggers a new job.
   *
   * @param mediaId - Media item UUID
   * @param creatorId - Creator ID for authorization
   * @returns void
   *
   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
   * @throws {InvalidMediaStateError} If media is not in 'failed' status
   * @throws {MaxRetriesExceededError} If retry limit (1) reached
   */
  async retryTranscoding(mediaId: string, creatorId: string): Promise<void> {
    this.obs.info('Retrying transcoding', { mediaId, creatorId });

    // Step 1: Fetch and validate media
    const media = await this.getMediaForTranscoding(mediaId, creatorId);

    // Verify media is in failed state
    if (media.status !== 'failed') {
      throw new InvalidMediaStateError(mediaId, media.status, 'failed', {
        operation: 'retryTranscoding',
      });
    }

    // Step 2: Check retry limit
    if (media.transcodingAttempts >= 1) {
      throw new MaxRetriesExceededError(mediaId, media.transcodingAttempts);
    }

    // Step 3: Reset status and increment attempts
    await this.db
      .update(mediaItems)
      .set({
        status: 'uploaded',
        transcodingAttempts: media.transcodingAttempts + 1,
        transcodingError: null, // Clear previous error
        runpodJobId: null, // Clear old job ID
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));

    // Step 4: Trigger new job
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
      // Cast from string[] to HlsVariant[] - DB stores as text[], validated on write
      readyVariants: media.readyVariants as HlsVariant[] | null,
    };
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
      throw wrapError(error, { mediaId, creatorId });
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
   * @param priority - Optional job priority (1-100, higher = more urgent)
   */
  async triggerJobInternal(mediaId: string, priority?: number): Promise<void> {
    this.obs.info('Triggering transcoding job (internal)', {
      mediaId,
      priority,
    });

    // Fetch media without authorization check (workerAuth is the auth layer)
    const media = await this.getMediaForTranscodingInternal(mediaId);

    // Verify media is in correct state
    if (media.status !== 'uploaded') {
      throw new InvalidMediaStateError(mediaId, media.status, 'uploaded', {
        operation: 'triggerJobInternal',
      });
    }

    // Construct job request using media's creatorId
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

    // Call RunPod /run API
    let runpodJobId: string;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(this.runpodApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.runpodApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jobRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new RunPodApiError('triggerJobInternal', response.status, {
          responseBody: errorText,
        });
      }

      const result = (await response.json()) as RunPodJobResponse;
      runpodJobId = result.id;
    } catch (error) {
      if (error instanceof RunPodApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RunPodApiError('triggerJobInternal', undefined, {
          originalError: 'Request timed out after 30 seconds',
        });
      }
      throw new RunPodApiError('triggerJobInternal', undefined, {
        originalError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Update media status to 'transcoding'
    await this.db
      .update(mediaItems)
      .set({
        status: 'transcoding',
        runpodJobId,
        transcodingPriority: priority ?? media.transcodingPriority,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));

    this.obs.info('Transcoding job triggered (internal)', {
      mediaId,
      runpodJobId,
    });
  }
}
