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

import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import {
  createMediaItemService,
  createMediaItemSchema,
  updateMediaItemSchema,
  mediaQuerySchema,
} from '@codex/content';
import { dbHttp } from '@codex/database';
import {
  createAuthenticatedHandler,
  createAuthenticatedGetHandler,
  withPolicy,
  POLICY_PRESETS,
} from '@codex/worker-utils';
import { createIdParamsSchema } from '@codex/validation';

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
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createMediaItemSchema,
    },
    handler: async (c, ctx) => {
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.create(ctx.validated.body, ctx.user.id);
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
 */
app.get(
  '/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.get(ctx.validated.params.id, ctx.user.id);
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
 */
app.patch(
  '/:id',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
      body: updateMediaItemSchema,
    },
    handler: async (_c, ctx) => {
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.update(
        ctx.validated.params.id,
        ctx.validated.body,
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
 */
app.get(
  '/',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    schema: {
      query: mediaQuerySchema,
    },
    handler: async (_c, ctx) => {
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const result = await service.list(ctx.user.id, ctx.validated.query);

      return {
        items: result.items,
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
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
 */
app.delete(
  '/:id',
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'auth', // Stricter rate limit for deletion
  }),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createMediaItemService({
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
