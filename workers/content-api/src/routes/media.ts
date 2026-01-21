/**
 * Media Management Endpoints
 *
 * RESTful API for managing media items (uploaded videos and audio).
 * All routes require authentication and enforce creator ownership.
 *
 * Endpoints:
 * - POST   /api/media        - Create media item
 * - GET    /api/media/:id    - Get by ID
 * - PATCH  /api/media/:id    - Update media
 * - GET    /api/media        - List with filters
 * - DELETE /api/media/:id    - Soft delete
 */

import { AUTH_ROLES, MEDIA_STATUS, MIME_TYPES } from '@codex/constants';
import type {
  CreateMediaResponse,
  DeleteMediaResponse,
  MediaListResponse,
  MediaResponse,
  UpdateMediaResponse,
} from '@codex/content';
import {
  createMediaItemSchema,
  MediaNotFoundError,
  mediaQuerySchema,
  updateMediaItemSchema,
} from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { createIdParamsSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

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
    handler: async (ctx): Promise<MediaListResponse> => {
      return await ctx.services.media.list(ctx.user.id, ctx.input.query);
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
    handler: async (ctx): Promise<{ success: boolean; status: string }> => {
      const mediaId = ctx.input.params.id;
      const creatorId = ctx.user.id;

      // 1. Verify ownership and get current media
      const media = await ctx.services.media.get(mediaId, creatorId);
      if (!media) {
        throw new MediaNotFoundError(mediaId);
      }

      // 2. Ensure media is in 'uploading' state
      if (media.status !== MEDIA_STATUS.UPLOADING) {
        throw new Error(
          `Cannot mark upload complete: media is already '${media.status}'`
        );
      }

      // 3. Update status to 'uploaded'
      await ctx.services.media.updateStatus(
        mediaId,
        MEDIA_STATUS.UPLOADED,
        creatorId
      );

      // 4. Trigger transcoding via media-api worker
      const mediaApiUrl = ctx.env.MEDIA_API_URL;
      if (!mediaApiUrl) {
        throw new Error('MEDIA_API_URL not configured');
      }

      const response = await fetch(
        `${mediaApiUrl}/internal/media/${mediaId}/transcode`,
        {
          method: 'POST',
          headers: {
            'Content-Type': MIME_TYPES.APPLICATION.JSON,
            'X-Worker-Secret': ctx.env.WORKER_SHARED_SECRET || '',
          },
          body: JSON.stringify({ creatorId }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to trigger transcoding: ${errorText}`);
        // Don't fail the request - media is still marked as 'uploaded'
        // Transcoding can be retried manually
        return { success: true, status: MEDIA_STATUS.UPLOADED };
      }

      return { success: true, status: MEDIA_STATUS.TRANSCODING };
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
      rateLimit: 'auth', // Stricter rate limit for deletion
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
