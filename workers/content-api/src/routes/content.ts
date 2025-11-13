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
  createContentSchema,
  updateContentSchema,
  contentQuerySchema,
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
 * POST /api/content
 * Create new content
 */
app.post(
  '/',
  createAuthenticatedHandler({
    schema: createContentSchema,
    handler: async (input, c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.create(input, ctx.user.id);
    },
    successStatus: 201,
  })
);

/**
 * GET /api/content/:id
 * Get content by ID
 */
app.get(
  '/:id',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const id = c.req.param('id');
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.get(id, ctx.user.id);
    },
  })
);

/**
 * PATCH /api/content/:id
 * Update content
 */
app.patch(
  '/:id',
  createAuthenticatedHandler({
    schema: updateContentSchema,
    handler: async (input, c, ctx) => {
      const id = c.req.param('id');
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.update(id, input, ctx.user.id);
    },
  })
);

/**
 * GET /api/content
 * List content with filters and pagination
 */
app.get(
  '/',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const query = c.req.query();
      const validationResult = contentQuerySchema.safeParse(query);

      if (!validationResult.success) {
        throw validationResult.error; // Throw ZodError for proper error mapping
      }

      const service = createContentService({
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
 * POST /api/content/:id/publish
 * Publish content
 */
app.post(
  '/:id/publish',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const id = c.req.param('id');
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.publish(id, ctx.user.id);
    },
  })
);

/**
 * POST /api/content/:id/unpublish
 * Unpublish content
 */
app.post(
  '/:id/unpublish',
  createAuthenticatedGetHandler({
    handler: async (c, ctx) => {
      const id = c.req.param('id');
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.unpublish(id, ctx.user.id);
    },
  })
);

/**
 * DELETE /api/content/:id
 * Soft delete content
 */
app.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401
    );
  }

  try {
    const id = c.req.param('id');
    const service = createContentService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    await service.delete(id, user.id);
    return c.body(null, 204);
  } catch (err: unknown) {
    const { mapErrorToResponse } = await import('@codex/content');
    const { statusCode, response } = mapErrorToResponse(err);
    return c.json(response, statusCode);
  }
});

export default app;
