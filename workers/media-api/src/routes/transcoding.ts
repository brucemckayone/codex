/**
 * Transcoding Routes
 *
 * Routes for transcoding orchestration:
 * - POST /internal/media/:id/transcode - Trigger transcoding (workerAuth)
 * - POST /api/transcoding/retry/:id - Retry failed transcoding (authenticated)
 * - GET /api/transcoding/status/:id - Get transcoding status (authenticated)
 */

import { workerAuth } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import { transcodingPrioritySchema } from '@codex/transcoding';
import { uuidSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

// Route-specific schemas that map URL params (id) to service params (mediaId)
const idParamSchema = z.object({ id: uuidSchema });
const triggerBodySchema = z.object({
  priority: transcodingPrioritySchema.optional(),
});

const app = new Hono<HonoEnv>();

// ============================================================================
// Internal Routes (Worker-to-Worker Auth)
// ============================================================================

/**
 * POST /internal/media/:id/transcode
 *
 * Trigger transcoding for a media item.
 * Called by content-api after media upload completes.
 *
 * Security: workerAuth (HMAC signature from calling worker)
 * Rate Limit: N/A (internal only)
 */
app.post(
  '/internal/media/:id/transcode',
  async (c, next) => {
    // Apply workerAuth middleware
    const secret = c.env.WORKER_SHARED_SECRET;
    if (!secret) {
      return c.json(
        {
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'Worker authentication not configured',
          },
        },
        500
      );
    }

    const middleware = workerAuth({ secret });
    return middleware(c, next);
  },
  procedure({
    policy: { auth: 'worker' },
    input: {
      params: idParamSchema,
      body: triggerBodySchema,
    },
    handler: async (ctx) => {
      const { id } = ctx.input.params;
      const { priority } = ctx.input.body;

      // Use internal method that doesn't require creatorId (workerAuth is auth layer)
      await ctx.services.transcoding.triggerJobInternal(id, priority);

      return { message: 'Transcoding job triggered', mediaId: id };
    },
  })
);

// ============================================================================
// User-Facing Routes (Session Auth)
// ============================================================================

/**
 * POST /api/transcoding/retry/:id
 *
 * Retry a failed transcoding job.
 * Only 1 retry allowed per media item.
 *
 * Security: requireAuth (session cookie)
 * Rate Limit: 10 requests per minute (stricter for mutation)
 */
app.post(
  '/api/transcoding/retry/:id',
  procedure({
    policy: { auth: 'required', rateLimit: 'auth' },
    input: {
      params: idParamSchema,
    },
    handler: async (ctx) => {
      const { id } = ctx.input.params;

      await ctx.services.transcoding.retryTranscoding(id, ctx.user.id);

      return { message: 'Transcoding retry triggered', mediaId: id };
    },
  })
);

/**
 * GET /api/transcoding/status/:id
 *
 * Get current transcoding status for a media item.
 *
 * Security: requireAuth (session cookie)
 * Rate Limit: api (100 requests per minute)
 */
app.get(
  '/api/transcoding/status/:id',
  procedure({
    policy: { auth: 'required', rateLimit: 'api' },
    input: {
      params: idParamSchema,
    },
    handler: async (ctx) => {
      const { id } = ctx.input.params;

      const status = await ctx.services.transcoding.getTranscodingStatus(
        id,
        ctx.user.id
      );

      return { data: status };
    },
  })
);

export default app;
