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

import {
  contentQuerySchema,
  createContentSchema,
  createContentService,
  updateContentSchema,
} from '@codex/content';
import { dbHttp } from '@codex/database';
import { createIdParamsSchema } from '@codex/validation';
import {
  createAuthenticatedGetHandler,
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
 * POST /api/content
 * Create new content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);

/**
 * GET /api/content/:id
 * Get content by ID
 *
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
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.get(ctx.validated.params.id, ctx.user.id);
    },
  })
);

/**
 * PATCH /api/content/:id
 * Update content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.patch(
  '/:id',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
      body: updateContentSchema,
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
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
 * GET /api/content
 * List content with filters and pagination
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 */
app.get(
  '/',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    schema: {
      query: contentQuerySchema,
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
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
 * POST /api/content/:id/publish
 * Publish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/:id/publish',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.publish(ctx.validated.params.id, ctx.user.id);
    },
  })
);

/**
 * POST /api/content/:id/unpublish
 * Unpublish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/:id/unpublish',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.unpublish(ctx.validated.params.id, ctx.user.id);
    },
  })
);

/**
 * DELETE /api/content/:id
 * Soft delete content
 *
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
      const service = createContentService({
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
