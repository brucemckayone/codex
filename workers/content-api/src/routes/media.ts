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
} from '@codex/worker-utils';

const app = new Hono<HonoEnv>();

// Note: Authentication is applied at the app level in index.ts
// All routes mounted under /api/* inherit requireAuth middleware

/**
 * POST /api/media
 * Create new media item
 *
 * Body: CreateMediaItemInput
 * Returns: MediaItem (201)
 */
app.post(
  '/',
  createAuthenticatedHandler({
    schema: createMediaItemSchema,
    handler: async (input, c, ctx) => {
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.create(input, ctx.user.id);
    },
    successStatus: 201,
  })
);

/**
 * GET /api/media/:id
 * Get media item by ID
 *
 * Returns: MediaItem (200)
 */
app.get(
  '/:id',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const id = c.req.param('id');
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.get(id, ctx.user.id);
    },
  })
);

/**
 * PATCH /api/media/:id
 * Update media item
 *
 * Body: UpdateMediaItemInput
 * Returns: MediaItem (200)
 */
app.patch(
  '/:id',
  createAuthenticatedHandler({
    schema: updateMediaItemSchema,
    handler: async (input, c, ctx) => {
      const id = c.req.param('id');
      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });
      return service.update(id, input, ctx.user.id);
    },
  })
);

/**
 * GET /api/media
 * List media items with filters and pagination
 *
 * Query params: MediaQueryInput
 * Returns: PaginatedResponse<MediaItem> (200)
 */
app.get(
  '/',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const query = c.req.query();

      // Validate query parameters
      const validationResult = mediaQuerySchema.safeParse(query);
      if (!validationResult.success) {
        throw {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: validationResult.error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        };
      }

      const service = createMediaItemService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const result = await service.list(ctx.user.id, validationResult.data);

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
 */
app.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    const id = c.req.param('id');

    const service = createMediaItemService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    await service.delete(id, user.id);

    return c.body(null, 204);
  } catch (err) {
    // Import mapErrorToResponse for DELETE handler only
    const { mapErrorToResponse } = await import('@codex/content');
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode as any);
  }
});

export default app;
