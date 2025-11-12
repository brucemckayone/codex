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
  mapErrorToResponse,
  createMediaItemSchema,
  updateMediaItemSchema,
  mediaQuerySchema,
} from '@codex/content';
import { dbHttp } from '@codex/database';

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
app.post('/', async (c) => {
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

    const body = await c.req.json();

    // Validate request body
    const validationResult = createMediaItemSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validationResult.error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
        },
        400
      );
    }

    const service = createMediaItemService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const mediaItem = await service.create(validationResult.data, user.id);

    return c.json({ data: mediaItem }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/media/:id
 * Get media item by ID
 *
 * Returns: MediaItem (200)
 */
app.get('/:id', async (c) => {
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

    const mediaItem = await service.getById(id, user.id);

    return c.json({ data: mediaItem });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * PATCH /api/media/:id
 * Update media item
 *
 * Body: UpdateMediaItemInput
 * Returns: MediaItem (200)
 */
app.patch('/:id', async (c) => {
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
    const body = await c.req.json();

    // Validate request body
    const validationResult = updateMediaItemSchema.safeParse(body);
    if (!validationResult.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validationResult.error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
        },
        400
      );
    }

    const service = createMediaItemService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const mediaItem = await service.update(id, validationResult.data, user.id);

    return c.json({ data: mediaItem });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/media
 * List media items with filters and pagination
 *
 * Query params: MediaQueryInput
 * Returns: PaginatedResponse<MediaItem> (200)
 */
app.get('/', async (c) => {
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

    const query = c.req.query();

    // Validate query parameters
    const validationResult = mediaQuerySchema.safeParse(query);
    if (!validationResult.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validationResult.error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
        },
        400
      );
    }

    const service = createMediaItemService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const result = await service.list(user.id, validationResult.data);

    return c.json({
      data: {
        items: result.items,
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
        hasMore: result.pagination.hasMore,
      },
    });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

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
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

export default app;
