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
  ContentNotFoundError,
  ContentService,
  contentQuerySchema,
  createContentSchema,
  updateContentSchema,
} from '@codex/content';
import { createPerRequestDbClient, dbHttp } from '@codex/database';
import type {
  ContentListResponse,
  ContentResponse,
  CreateContentResponse,
  DeleteContentResponse,
  PublishContentResponse,
  UnpublishContentResponse,
  UpdateContentResponse,
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
 * POST /api/content
 * Create new content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {CreateContentResponse}
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    handler: async (c, ctx): Promise<CreateContentResponse> => {
      // Create per-request database client with transaction support
      const { db, cleanup } = createPerRequestDbClient(ctx.env);

      try {
        const service = new ContentService({
          db,
          environment: ctx.env.ENVIRONMENT || 'development',
        });

        const content = await service.create(ctx.validated.body, ctx.user.id);

        // Schedule cleanup after response is sent
        c.executionCtx.waitUntil(cleanup());

        return { data: content };
      } catch (error) {
        // Ensure cleanup happens even on error
        await cleanup();
        throw error;
      }
    },
    successStatus: 201,
  })
);

/**
 * GET /api/content/:id
 * Get content by ID
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {ContentResponse}
 */
app.get(
  '/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx): Promise<ContentResponse> => {
      const service = new ContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const content = await service.get(ctx.validated.params.id, ctx.user.id);
      if (!content) {
        throw new ContentNotFoundError(ctx.validated.params.id);
      }

      return { data: content };
    },
  })
);

/**
 * PATCH /api/content/:id
 * Update content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {UpdateContentResponse}
 */
app.patch(
  '/:id',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
      body: updateContentSchema,
    },
    handler: async (c, ctx): Promise<UpdateContentResponse> => {
      const { db, cleanup } = createPerRequestDbClient(ctx.env);

      try {
        const service = new ContentService({
          db,
          environment: ctx.env.ENVIRONMENT || 'development',
        });

        const content = await service.update(
          ctx.validated.params.id,
          ctx.validated.body,
          ctx.user.id
        );

        c.executionCtx.waitUntil(cleanup());
        return { data: content };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  })
);

/**
 * GET /api/content
 * List content with filters and pagination
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {ContentListResponse}
 */
app.get(
  '/',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      query: contentQuerySchema,
    },
    handler: async (_c, ctx): Promise<ContentListResponse> => {
      const service = new ContentService({
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
 * POST /api/content/:id/publish
 * Publish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {PublishContentResponse}
 */
app.post(
  '/:id/publish',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (c, ctx): Promise<PublishContentResponse> => {
      const { db, cleanup } = createPerRequestDbClient(ctx.env);

      try {
        const service = new ContentService({
          db,
          environment: ctx.env.ENVIRONMENT || 'development',
        });

        const content = await service.publish(
          ctx.validated.params.id,
          ctx.user.id
        );

        c.executionCtx.waitUntil(cleanup());
        return { data: content };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  })
);

/**
 * POST /api/content/:id/unpublish
 * Unpublish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {UnpublishContentResponse}
 */
app.post(
  '/:id/unpublish',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (c, ctx): Promise<UnpublishContentResponse> => {
      const { db, cleanup } = createPerRequestDbClient(ctx.env);

      try {
        const service = new ContentService({
          db,
          environment: ctx.env.ENVIRONMENT || 'development',
        });

        const content = await service.unpublish(
          ctx.validated.params.id,
          ctx.user.id
        );

        c.executionCtx.waitUntil(cleanup());
        return { data: content };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  })
);

/**
 * DELETE /api/content/:id
 * Soft delete content
 *
 * Security: Creator/Admin only, Strict rate limit (5 req/15min)
 * @returns {DeleteContentResponse}
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
    handler: async (c, ctx): Promise<DeleteContentResponse> => {
      const { db, cleanup } = createPerRequestDbClient(ctx.env);

      try {
        const service = new ContentService({
          db,
          environment: ctx.env.ENVIRONMENT || 'development',
        });

        await service.delete(ctx.validated.params.id, ctx.user.id);

        c.executionCtx.waitUntil(cleanup());
        return null;
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
    successStatus: 204,
  })
);

export default app;
