import type {
  PlaybackProgressResponse,
  StreamingUrlResponse,
  UpdatePlaybackProgressResponse,
  UserLibraryResponse,
} from '@codex/shared-types';
import {
  createIdParamsSchema,
  getStreamingUrlSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
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
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'streaming', // 60 req/min - allows HLS segment refreshes
    },
    input: {
      params: createIdParamsSchema(),
      query: getStreamingUrlSchema.pick({ expirySeconds: true }),
    },
    handler: async (ctx): Promise<StreamingUrlResponse> => {
      const { params, query } = ctx.input;

      // Service fetches content's organizationId and verifies access
      const result = await ctx.services.access.getStreamingUrl(ctx.user.id, {
        contentId: params.id,
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
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - standard for API updates
    },
    input: {
      params: createIdParamsSchema(),
      body: savePlaybackProgressSchema.omit({ contentId: true }),
    },
    successStatus: 204, // No Content - update successful, no response body
    handler: async (ctx): Promise<UpdatePlaybackProgressResponse> => {
      const { params, body } = ctx.input;

      await ctx.services.access.savePlaybackProgress(ctx.user.id, {
        contentId: params.id,
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
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - standard for API reads
    },
    input: {
      params: createIdParamsSchema(),
    },
    handler: async (ctx): Promise<PlaybackProgressResponse> => {
      const { params } = ctx.input;

      const progress = await ctx.services.access.getPlaybackProgress(
        ctx.user.id,
        {
          contentId: params.id,
        }
      );

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
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'api', // 100 req/min - prevents pagination abuse
    },
    input: {
      query: listUserLibrarySchema,
    },
    handler: async (ctx): Promise<UserLibraryResponse> => {
      return await ctx.services.access.listUserLibrary(
        ctx.user.id,
        ctx.input.query
      );
    },
  })
);

export default app;
