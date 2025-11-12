/**
 * Content Management Endpoints
 *
 * RESTful API for managing content items (videos, audio, written content).
 * All routes require authentication and enforce creator ownership.
 *
 * Endpoints:
 * - POST   /api/content            - Create content
 * - GET    /api/content/:id        - Get by ID
 * - PATCH  /api/content/:id        - Update content
 * - GET    /api/content            - List with filters
 * - POST   /api/content/:id/publish   - Publish content
 * - POST   /api/content/:id/unpublish - Unpublish content
 * - DELETE /api/content/:id        - Soft delete
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import {
  createContentService,
  mapErrorToResponse,
  createContentSchema,
  updateContentSchema,
  contentQuerySchema,
} from '@codex/content';
import { dbHttp } from '@codex/database';

const app = new Hono<HonoEnv>();

// Note: Authentication is applied at the app level in index.ts
// All routes mounted under /api/* inherit requireAuth middleware

/**
 * POST /api/content
 * Create new content
 *
 * Body: CreateContentInput
 * Returns: Content (201)
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
    const validationResult = createContentSchema.safeParse(body);
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

    const service = createContentService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    // Extract organizationId from validated data if present
    const organizationId = validationResult.data.organizationId || null;

    const content = await service.create(
      validationResult.data,
      user.id,
      organizationId
    );

    return c.json({ data: content }, 201);
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/content/:id
 * Get content by ID
 *
 * Returns: Content (200)
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

    const service = createContentService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const content = await service.getById(id, user.id);

    return c.json({ data: content });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * PATCH /api/content/:id
 * Update content
 *
 * Body: UpdateContentInput
 * Returns: Content (200)
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
    const validationResult = updateContentSchema.safeParse(body);
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

    const service = createContentService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const content = await service.update(id, validationResult.data, user.id);

    return c.json({ data: content });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * GET /api/content
 * List content with filters and pagination
 *
 * Query params: ContentQueryInput
 * Returns: PaginatedResponse<Content> (200)
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
    const validationResult = contentQuerySchema.safeParse(query);
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

    const service = createContentService({
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
 * POST /api/content/:id/publish
 * Publish content (mark as published)
 *
 * Returns: Content (200)
 */
app.post('/:id/publish', async (c) => {
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

    const service = createContentService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const content = await service.publish(id, user.id);

    return c.json({ data: content });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * POST /api/content/:id/unpublish
 * Unpublish content (revert to draft)
 *
 * Returns: Content (200)
 */
app.post('/:id/unpublish', async (c) => {
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

    const service = createContentService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const content = await service.unpublish(id, user.id);

    return c.json({ data: content });
  } catch (err) {
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

/**
 * DELETE /api/content/:id
 * Soft delete content (sets deleted_at)
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

    const service = createContentService({
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
