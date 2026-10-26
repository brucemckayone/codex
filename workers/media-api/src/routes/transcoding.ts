/**
 * Transcoding Routes
 *
 * Routes for transcoding orchestration:
 * - POST /internal/media/:id/transcode - Trigger transcoding (workerAuth)
 * - POST /api/transcoding/retry/:id - Retry failed transcoding (authenticated)
 *
 * Progress is not polled: the studio reads it from the live status socket
 * (routes/media-status.ts).
 */

import type { HonoEnv } from '@codex/shared-types';
import { transcodingPrioritySchema } from '@codex/transcoding';
import { uuidSchema } from '@codex/validation';
import { type ProcedureContext, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

// Route-specific schemas that map URL params (id) to service params (mediaId)
const idParamSchema = z.object({ id: uuidSchema });
const triggerBodySchema = z.object({
  // The uploader content-api authenticated: the claim is scoped to them.
  // users.id is text (BetterAuth ids are alphanumeric, test users' are
  // uuids), and it only ever reaches a parameterised WHERE.
  creatorId: z.string().min(1).max(64),
  priority: transcodingPrioritySchema.optional(),
});

const app = new Hono<HonoEnv>();

/**
 * Run a claimed item's RunPod call after the reply.
 *
 * ctx.background, NOT ctx.executionCtx.waitUntil: the dispatch writes to the
 * DB after the response is sent (the job id, or the waiting state when RunPod
 * refuses). A bare waitUntil races procedure()'s own waitUntil(cleanup()),
 * which calls pool.end() and reliably wins, so those writes used to fail
 * every time and a refused dispatch left no trace.
 *
 * TranscodingService.dispatch never rejects. The .catch is belt-and-braces:
 * ctx.background settles rejections without logging them, so a future change
 * that lets one escape must surface in obs rather than evaporate.
 */
function dispatchAfterReply(
  ctx: Pick<ProcedureContext, 'background' | 'obs'>,
  mediaId: string,
  dispatchPromise: Promise<unknown>
): void {
  ctx.background(
    dispatchPromise.catch((err: unknown) => {
      ctx.obs?.error('transcoding.dispatch_rejected', {
        mediaId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
  );
}

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
 *           - procedure() applies workerAuth inline when policy.auth is 'worker'
 * Rate Limit: N/A (internal only)
 */
app.post(
  '/internal/media/:id/transcode',
  procedure({
    policy: { auth: 'worker' },
    input: {
      params: idParamSchema,
      body: triggerBodySchema,
    },
    handler: async (ctx) => {
      const { id } = ctx.input.params;
      const { creatorId, priority } = ctx.input.body;

      // Claims the media ('uploaded' -> 'transcoding') synchronously. The
      // RunPod dispatch runs in the background, after the reply.
      const result = await ctx.services.transcoding.triggerJobInternal(
        id,
        creatorId,
        priority
      );

      // Already transcoding, ready or failed: content-api re-POSTs
      // upload-complete to recover, so a second trigger is normal and must
      // not dispatch again.
      if (result.alreadyQueued) {
        return {
          message: 'Transcoding already queued',
          mediaId: id,
          alreadyQueued: true,
        };
      }

      dispatchAfterReply(ctx, id, result.dispatchPromise);

      return {
        message: 'Transcoding job triggered',
        mediaId: id,
        alreadyQueued: false,
      };
    },
  })
);

// ============================================================================
// User-Facing Routes (Session Auth)
// ============================================================================

/**
 * POST /api/transcoding/retry/:id
 *
 * Retry a failed (or waiting) transcoding job. One upload gets
 * MAX_TRANSCODING_ATTEMPTS accepted jobs in total; a file the transcoder
 * could not read is refused (the creator re-uploads).
 *
 * Security: requireAuth (session cookie)
 * Rate Limit: 10 requests per minute (stricter for mutation)
 */
app.post(
  '/api/transcoding/retry/:id',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: {
      params: idParamSchema,
    },
    handler: async (ctx) => {
      const { id } = ctx.input.params;

      // The claim happens here, so every refusal (wrong state, file problem,
      // no attempts left) is this request's error. The RunPod call runs after
      // the reply, as on the upload path.
      const { dispatchPromise } =
        await ctx.services.transcoding.retryTranscoding(id, ctx.user.id);
      dispatchAfterReply(ctx, id, dispatchPromise);

      return { message: 'Transcoding retry triggered', mediaId: id };
    },
  })
);

export default app;
