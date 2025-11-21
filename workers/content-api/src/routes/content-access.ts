import { createContentAccessService } from '@codex/access';
import {
  getPlaybackProgressSchema,
  getStreamingUrlSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
} from '@codex/validation';
import {
  createAuthenticatedHandler,
  POLICY_PRESETS,
  withPolicy,
} from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono();

/**
 * GET /api/access/content/:id/stream
 *
 * Generate signed streaming URL for content.
 * Protected by authenticated user policy.
 */
app.get(
  '/content/:id/stream',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: getStreamingUrlSchema.pick({ contentId: true }),
      query: getStreamingUrlSchema.pick({ expirySeconds: true }),
    },
    handler: async (_c, ctx) => {
      const { params, query } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      const result = await service.getStreamingUrl(user.id, {
        contentId: params.contentId,
        expirySeconds: query?.expirySeconds,
      });

      return {
        streamingUrl: result.streamingUrl,
        expiresAt: result.expiresAt.toISOString(),
        contentType: result.contentType,
      };
    },
  })
);

/**
 * POST /api/access/content/:id/progress
 *
 * Save playback progress for video content.
 * Protected by authenticated user policy.
 */
app.post(
  '/content/:id/progress',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: savePlaybackProgressSchema.pick({ contentId: true }),
      body: savePlaybackProgressSchema.omit({ contentId: true }),
    },
    handler: async (_c, ctx) => {
      const { params, body } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      await service.savePlaybackProgress(user.id, {
        contentId: params.contentId,
        ...body,
      });

      return { success: true };
    },
  })
);

/**
 * GET /api/access/content/:id/progress
 *
 * Get playback progress for video content.
 * Protected by authenticated user policy.
 */
app.get(
  '/content/:id/progress',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: getPlaybackProgressSchema,
    },
    handler: async (_c, ctx) => {
      const { params } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      const progress = await service.getPlaybackProgress(user.id, {
        contentId: params.contentId,
      });

      if (!progress) {
        return { progress: null };
      }

      return {
        progress: {
          ...progress,
          updatedAt: progress.updatedAt.toISOString(),
        },
      };
    },
  })
);

/**
 * GET /api/access/user/library
 *
 * List user's purchased content with playback progress.
 * Protected by authenticated user policy.
 */
app.get(
  '/user/library',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      query: listUserLibrarySchema,
    },
    handler: async (_c, ctx) => {
      const { query } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      const result = await service.listUserLibrary(user.id, query);

      return result;
    },
  })
);

export default app;
