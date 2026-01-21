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

import { AUTH_ROLES } from '@codex/constants';
import type {
  ContentListResponse,
  ContentResponse,
  CreateContentResponse,
  DeleteContentResponse,
  PublishContentResponse,
  UnpublishContentResponse,
  UpdateContentResponse,
} from '@codex/content';
import {
  ContentNotFoundError,
  contentQuerySchema,
  createContentSchema,
  updateContentSchema,
} from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { createIdParamsSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /api/content
 * Create new content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 * @returns {CreateContentResponse}
 */
app.post(
  '/',
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { body: createContentSchema },
    successStatus: 201,
    handler: async (ctx): Promise<CreateContentResponse['data']> => {
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
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
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<ContentResponse['data']> => {
      const content = await ctx.services.content.get(
        ctx.input.params.id,
        ctx.user.id
      );
      if (!content) {
        throw new ContentNotFoundError(ctx.input.params.id);
      }
      return content;
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
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: {
      params: createIdParamsSchema(),
      body: updateContentSchema,
    },
    handler: async (ctx): Promise<UpdateContentResponse['data']> => {
      return await ctx.services.content.update(
        ctx.input.params.id,
        ctx.input.body,
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
 * @returns {ContentListResponse}
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { query: contentQuerySchema },
    handler: async (ctx): Promise<ContentListResponse> => {
      return await ctx.services.content.list(ctx.user.id, ctx.input.query);
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
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<PublishContentResponse['data']> => {
      return await ctx.services.content.publish(
        ctx.input.params.id,
        ctx.user.id
      );
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
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
    },
    input: { params: createIdParamsSchema() },
    handler: async (ctx): Promise<UnpublishContentResponse['data']> => {
      return await ctx.services.content.unpublish(
        ctx.input.params.id,
        ctx.user.id
      );
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
  procedure({
    policy: {
      auth: 'required',
      roles: [AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN],
      rateLimit: 'auth', // Stricter rate limit for deletion
    },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx): Promise<DeleteContentResponse> => {
      await ctx.services.content.delete(ctx.input.params.id, ctx.user.id);
      return null;
    },
  })
);

export default app;
