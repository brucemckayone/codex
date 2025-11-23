import { createContentAccessService } from '@codex/access';
import type {
  PlaybackProgressResponse,
  StreamingUrlResponse,
  UpdatePlaybackProgressResponse,
  UserLibraryResponse,
} from '@codex/shared-types';
import {
  getPlaybackProgressSchema,
  getStreamingUrlSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
} from '@codex/validation';
import { createAuthenticatedHandler, withPolicy } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono();

/**
 * GET /api/access/content/:id/stream
 *
 * Generate signed streaming URL for content.
 * Protected by authenticated user policy with streaming rate limiting (60 req/min)
 * to prevent abuse while allowing legitimate HLS segment refreshes.
 *
 * Access verification done at service layer:
 * - Content's organizationId is fetched from database
 * - User access verified via purchase OR organization membership
 * - Works from both org subdomains and root domain (revelations.studio)
 * @returns {StreamingUrlResponse}
 */
app.get(
  '/content/:id/stream',
  withPolicy({
    auth: 'required',
    rateLimit: 'streaming', // 60 req/min - allows HLS segment refreshes
  }),
  createAuthenticatedHandler({
    schema: {
      params: getStreamingUrlSchema.pick({ contentId: true }),
      query: getStreamingUrlSchema.pick({ expirySeconds: true }),
    },
    handler: async (_c, ctx): Promise<StreamingUrlResponse> => {
      const { params, query } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      // Service fetches content's organizationId and verifies access
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
 * Protected by authenticated user policy with standard API rate limiting (100 req/min).
 * Returns 204 No Content on success (no response body needed for update operations).
 * @returns {UpdatePlaybackProgressResponse}
 */
app.post(
  '/content/:id/progress',
  withPolicy({
    auth: 'required',
    rateLimit: 'api', // 100 req/min - standard for API updates
  }),
  createAuthenticatedHandler({
    schema: {
      params: savePlaybackProgressSchema.pick({ contentId: true }),
      body: savePlaybackProgressSchema.omit({ contentId: true }),
    },
    successStatus: 204, // No Content - update successful, no response body
    handler: async (_c, ctx): Promise<UpdatePlaybackProgressResponse> => {
      const { params, body } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      await service.savePlaybackProgress(user.id, {
        contentId: params.contentId,
        ...body,
      });

      return null; // 204 returns no body
    },
  })
);

/**
 * GET /api/access/content/:id/progress
 *
 * Get playback progress for video content.
 * Protected by authenticated user policy with standard API rate limiting (100 req/min).
 * @returns {PlaybackProgressResponse}
 */
app.get(
  '/content/:id/progress',
  withPolicy({
    auth: 'required',
    rateLimit: 'api', // 100 req/min - standard for API reads
  }),
  createAuthenticatedHandler({
    schema: {
      params: getPlaybackProgressSchema,
    },
    handler: async (_c, ctx): Promise<PlaybackProgressResponse> => {
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
 * Protected by authenticated user policy with standard API rate limiting (100 req/min).
 * Complex database queries (purchases + content + media + playback) with pagination.
 * @returns {UserLibraryResponse}
 */
app.get(
  '/user/library',
  withPolicy({
    auth: 'required',
    rateLimit: 'api', // 100 req/min - prevents pagination abuse
  }),
  createAuthenticatedHandler({
    schema: {
      query: listUserLibrarySchema,
    },
    handler: async (_c, ctx): Promise<UserLibraryResponse> => {
      const { query } = ctx.validated;
      const user = ctx.user;

      const service = createContentAccessService(ctx.env);
      const result = await service.listUserLibrary(user.id, query);

      return result;
    },
  })
);

export default app;
