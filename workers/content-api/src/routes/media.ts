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

import {
  createMediaItemSchema,
  MediaItemService,
  MediaNotFoundError,
  mediaQuerySchema,
  updateMediaItemSchema,
} from '@codex/content';
import { dbHttp } from '@codex/database';
import type {
  CreateMediaResponse,
  DeleteMediaResponse,
  MediaListResponse,
  MediaResponse,
  UpdateMediaResponse,
} from '@codex/shared-types';
import { createIdParamsSchema } from '@codex/validation';
import {
  createAuthenticatedHandler,
  POLICY_PRESETS,
  withPolicy,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import type { HonoEnv } from '../types';

const app = new Hono<HonoEnv>();

// Note: Route-level security policies applied via withPolicy()
// Each route declares its own authentication and authorization requirements

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
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createMediaItemSchema,
    },
    handler: async (_c, ctx): Promise<CreateMediaResponse> => {
      const service = new MediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      const media = await service.create(ctx.validated.body, ctx.user.id);
      return { data: media };
    },
    successStatus: 201,
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
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx): Promise<MediaResponse> => {
      const service = new MediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      const media = await service.get(ctx.validated.params.id, ctx.user.id);
      if (!media) {
        throw new MediaNotFoundError(ctx.validated.params.id);
      }

      return { data: media };
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
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
      body: updateMediaItemSchema,
    },
    handler: async (_c, ctx): Promise<UpdateMediaResponse> => {
      const service = new MediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      const media = await service.update(
        ctx.validated.params.id,
        ctx.validated.body,
        ctx.user.id
      );
      return { data: media };
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
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      query: mediaQuerySchema,
    },
    handler: async (_c, ctx): Promise<MediaListResponse> => {
      const service = new MediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const result = await service.list(ctx.user.id, ctx.validated.query);

      // Service returns PaginatedResponse<T> which already matches our response type
      return result;
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
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'auth', // Stricter rate limit for deletion
  }),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx): Promise<DeleteMediaResponse> => {
      const service = new MediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      await service.delete(ctx.validated.params.id, ctx.user.id);
      return null;
    },
    successStatus: 204,
  })
);

export default app;
