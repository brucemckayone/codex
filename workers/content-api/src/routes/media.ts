/**
 * Media Management Endpoints
 *
 * RESTful API for managing media items (uploaded videos and audio files).
 * All routes require authentication and enforce creator ownership.
 *
 * Endpoints:
 * - POST   /api/media        - Create media item
 * - GET    /api/media/:id    - Get by ID
 * - PATCH  /api/media/:id    - Update media
 * - GET    /api/media        - List with filters
 * - DELETE /api/media/:id    - Soft delete
 */

import {
  AUTH_ROLES,
  FILE_SIZES,
  MEDIA_STATUS,
  SUPPORTED_MEDIA_MIME_TYPES,
} from '@codex/constants';
import type {
  CreateMediaResponse,
  DeleteMediaResponse,
  MediaResponse,
  UpdateMediaResponse,
} from '@codex/content';
import {
  createMediaItemSchema,
  MediaItemService,
  MediaNotFoundError,
  mediaQuerySchema,
  updateMediaItemSchema,
} from '@codex/content';
import { createDbClient } from '@codex/database';
import { workerFetch } from '@codex/security';
import { ConflictError, InternalServiceError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import { createIdParamsSchema } from '@codex/validation';
import {
  binaryUploadProcedure,
  PaginatedResult,
  procedure,
} from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * Persist a transcoding-dispatch failure so it's diagnosable + recoverable.
 *
 * Runs inside `waitUntil`, after the request's own db lifecycle has ended, so
 * it builds a fresh stateless HTTP db client (same pattern as the cache-bump
 * helpers in content.ts). Never throws — failing to record a failure must not
 * crash the background task; it's logged instead.
 */
async function recordTranscodingTriggerFailure(
  env: HonoEnv['Bindings'],
  mediaId: string,
  creatorId: string,
  reason: string,
  obs?: { error: (message: string, metadata?: Record<string, unknown>) => void }
): Promise<void> {
  try {
    const media = new MediaItemService({
      db: createDbClient(env),
      environment: env.ENVIRONMENT,
    });
    await media.recordTranscodingTriggerFailure(mediaId, creatorId, reason);
  } catch (error) {
    obs?.error('Failed to persist transcoding-trigger failure', {
      mediaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * POST /api/media
 * Create new media item
 *
 * Body: CreateMediaItemInput
 * Returns: MediaItem (201)
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {CreateMediaResponse}
 */
app.post(
  '/',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: createMediaItemSchema },
    successStatus: 201,
    handler: async (ctx): Promise<CreateMediaResponse['data']> => {
      return await ctx.services.media.create(ctx.input.body, ctx.user.id);
    },
  })
);

/**
 * GET /api/media/:id
 * Get media item by ID
 *
 * Returns: MediaItem (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {MediaResponse}
 */
app.get(
  '/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<MediaResponse['data']> => {
      const media = await ctx.services.media.get(
        ctx.input.params.id,
        ctx.user.id
      );
      if (!media) {
        throw new MediaNotFoundError(ctx.input.params.id);
      }
      return media;
    },
  })
);

/**
 * PATCH /api/media/:id
 * Update media item
 *
 * Body: UpdateMediaItemInput
 * Returns: MediaItem (200)
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {UpdateMediaResponse}
 */
app.patch(
  '/:id',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: {
      params: createIdParamsSchema(),
      body: updateMediaItemSchema,
    },
    handler: async (ctx): Promise<UpdateMediaResponse['data']> => {
      return await ctx.services.media.update(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

/**
 * GET /api/media
 * List media items with filters and pagination
 *
 * Query params: MediaQueryInput
 * Returns: PaginatedResponse<MediaItem> (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {MediaListResponse}
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { query: mediaQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.media.list(
        ctx.user.id,
        ctx.input.query
      );
      const cdnBase = ctx.env.R2_PUBLIC_URL_BASE;
      const items = result.items.map((item) => ({
        ...item,
        thumbnailUrl:
          item.thumbnailKey && cdnBase
            ? `${cdnBase}/${item.thumbnailKey}`
            : null,
      }));
      return new PaginatedResult(items, result.pagination);
    },
  })
);

/**
 * POST /api/media/:id/upload
 * Upload file data to R2 via the media service.
 *
 * Fallback for local dev when presigned R2 URLs are unavailable.
 * In production, clients PUT directly to the presigned URL instead.
 *
 * NOTE: Uses procedure() normally — the body is read from the raw request
 * inside the handler since procedure() skips body parsing when no body schema
 * is defined. The Hono context is accessed via the closure.
 *
 * Security: Creator/Admin only
 */
app.post(
  '/:id/upload',
  binaryUploadProcedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    file: {
      maxSize: FILE_SIZES.MEDIA_MAX_BYTES,
      minSize: FILE_SIZES.MEDIA_MIN_BYTES,
      allowedMimeTypes: SUPPORTED_MEDIA_MIME_TYPES,
    },
    handler: async (ctx) => {
      return ctx.services.media.upload(
        ctx.input.params.id,
        ctx.file.body,
        ctx.file.contentType,
        ctx.user.id
      );
    },
  })
);

/**
 * POST /api/media/:id/upload-complete
 * Mark upload as complete and trigger transcoding
 *
 * Called by frontend after R2 upload completes.
 * Transitions status: uploading → uploaded → transcoding
 *
 * Flow:
 * 1. Verify creator owns media and status is 'uploading'
 * 2. Update status to 'uploaded'
 * 3. Call media-api to trigger transcoding
 *
 * Security: Creator/Admin only
 * @returns {{ success: boolean, status: string }}
 */
app.post(
  '/:id/upload-complete',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    handler: async (
      ctx
    ): Promise<{
      success: boolean;
      transcodingTriggered: boolean;
      status: string;
    }> => {
      const mediaId = ctx.input.params.id;
      const creatorId = ctx.user.id;

      // 1. Verify ownership and get current media
      const media = await ctx.services.media.get(mediaId, creatorId);
      if (!media) {
        throw new MediaNotFoundError(mediaId);
      }

      // 2. Idempotent: if already uploaded, skip status update and re-trigger transcoding.
      // This handles the case where upload succeeded but transcoding trigger failed.
      if (
        media.status !== MEDIA_STATUS.UPLOADING &&
        media.status !== MEDIA_STATUS.UPLOADED
      ) {
        throw new ConflictError(
          `Cannot mark upload complete: media is in '${media.status}' state`
        );
      }

      // 3. Update status to 'uploaded' (no-op if already uploaded)
      if (media.status === MEDIA_STATUS.UPLOADING) {
        await ctx.services.media.updateStatus(
          mediaId,
          MEDIA_STATUS.UPLOADED,
          creatorId
        );
      }

      // 4. Trigger transcoding via media-api worker (fire-and-forget)
      // The media-api call blocks until RunPod completes (minutes on /runsync),
      // so we dispatch it via waitUntil and return immediately to the client.
      const mediaApiUrl = ctx.env.MEDIA_API_URL;
      if (!mediaApiUrl) {
        throw new InternalServiceError(
          'Media transcoding service URL not configured'
        );
      }

      const workerSecret = ctx.env.WORKER_SHARED_SECRET;
      if (!workerSecret) {
        throw new InternalServiceError('Worker shared secret not configured');
      }

      const triggerPromise = workerFetch(
        `${mediaApiUrl}/internal/media/${mediaId}/transcode`,
        {
          method: 'POST',
          body: JSON.stringify({ creatorId }),
        },
        workerSecret
      )
        .then(async (response) => {
          if (!response.ok) {
            const errorText = await response.text();
            ctx.obs?.error('Failed to trigger transcoding', {
              mediaId,
              statusCode: response.status,
              error: errorText,
            });
            await recordTranscodingTriggerFailure(
              ctx.env,
              mediaId,
              creatorId,
              `Transcoding dispatch returned ${response.status}: ${errorText}`,
              ctx.obs
            );
          }
        })
        .catch(async (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.obs?.error('Transcoding trigger failed', {
            mediaId,
            error: message,
          });
          await recordTranscodingTriggerFailure(
            ctx.env,
            mediaId,
            creatorId,
            `Transcoding dispatch failed: ${message}`,
            ctx.obs
          );
        });

      ctx.executionCtx.waitUntil(triggerPromise);

      // Note: transcoding dispatch runs in background via waitUntil.
      // Frontend should poll media status rather than relying on this field.
      return {
        success: true,
        transcodingTriggered: true,
        status: MEDIA_STATUS.UPLOADED,
      };
    },
  })
);

/**
 * DELETE /api/media/:id
 * Soft delete media item (sets deleted_at)
 *
 * Returns: 204 No Content
 * Security: Creator/Admin only, Strict rate limit (5 req/15min)
 * @returns {DeleteMediaResponse}
 */
app.delete(
  '/:id',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
      rateLimit: 'strict', // 20/min for destructive operations
    },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx): Promise<DeleteMediaResponse> => {
      await ctx.services.media.delete(ctx.input.params.id, ctx.user.id);
      return null;
    },
  })
);

export default app;
