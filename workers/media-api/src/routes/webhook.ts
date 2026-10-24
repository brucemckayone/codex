/**
 * Webhook Routes
 *
 * Routes for external webhook callbacks:
 * - POST /api/transcoding/webhook - RunPod completion callback (HMAC verified)
 *
 * NOTE: Webhook routes don't use procedure() because:
 * 1. Auth is HMAC-based (not session), handled by verifyRunpodSignature
 * 2. Body must be read as raw text first for signature verification
 * 3. Then parsed and validated manually after verification
 *
 * Error handling uses mapErrorToResponse() for consistency.
 */

import { messageForLog } from '@codex/database';
import { isServiceError, ValidationError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import { classifyWebhookPayload } from '@codex/transcoding';
import { createWebhookServices } from '@codex/worker-utils';
import { type Context, Hono } from 'hono';
import { verifyRunpodSignature } from '../middleware/verify-runpod-signature';

const app = new Hono<HonoEnv>();

/**
 * How a webhook that threw is answered (same pattern as Stripe webhooks):
 * - Permanent (bad payload, business logic) → 200 to stop retries
 * - Transient (DB/network failure) → 500 to trigger RunPod retry
 */
function answerWebhookError(c: Context<HonoEnv>, error: unknown): Response {
  const obs = c.get('obs');
  const message =
    error instanceof Error ? error.message : 'Unknown webhook error';

  if (error instanceof ValidationError || isServiceError(error)) {
    // A signed payload we cannot read is a handler contract break, and the
    // 200 means RunPod will not send it again.
    const log = error instanceof ValidationError ? obs?.error : obs?.warn;
    log?.call(obs, 'transcoding.webhook_permanent_error', { error: message });
    return c.json({ received: true, error: message }, 200);
  }

  // Transient error: let RunPod retry. Logged at error, because a row stays
  // 'transcoding' until a retry gets through.
  obs?.error('transcoding.webhook_transient_error', {
    error: messageForLog(error),
  });
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Transient failure' } },
    500
  );
}

// ============================================================================
// Webhook Routes (HMAC Signature Verification)
// ============================================================================

/**
 * POST /api/transcoding/webhook
 *
 * Receive RunPod completion callbacks.
 * Updates media_items with transcoding results.
 *
 * Security: HMAC-SHA256 signature verification (timing-safe)
 * Rate Limit: High throughput (handled externally by Cloudflare if needed)
 *
 * NOTE: No session auth - webhooks are authenticated via HMAC signature.
 */
app.post(
  '/api/transcoding/webhook',
  // Apply HMAC signature verification middleware
  // Reads raw body, verifies signature, stores body in context
  verifyRunpodSignature({
    validateTimestamp: true,
    maxAge: 300, // 5 minutes
  }),
  async (c) => {
    const obs = c.get('obs');
    let release: (() => void) | undefined;
    try {
      // Raw body was stored by verifyRunpodSignature middleware
      // Type assertion: middleware guarantees rawBody is a string
      const rawBody = c.get('rawBody');
      if (!rawBody) {
        throw new ValidationError(
          'Request body not available after signature verification'
        );
      }

      // Parse JSON from the stored raw body
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new ValidationError('Invalid JSON in request body');
      }

      const classified = classifyWebhookPayload(payload);
      if (classified.kind === 'unreadable') {
        throw new ValidationError(
          `Invalid webhook payload: ${classified.issues}`
        );
      }
      if (classified.kind === 'rejected-progress') {
        // A progress update is advisory; the completion that follows decides.
        obs?.warn('transcoding.progress_webhook_rejected', {
          issues: classified.issues,
        });
        return c.json({ received: true, ignored: true }, 200);
      }

      // The registry's TranscodingService (the webhook exception: no
      // procedure(), so createWebhookServices builds it), released in finally.
      const webhook = await createWebhookServices(c.env, c.executionCtx, {
        obs,
      });
      release = webhook.release;
      const service = webhook.services.transcoding;

      if (classified.kind === 'rejected-terminal') {
        // The job is over but its result is unusable. Failing the row now
        // (OUTPUT_REJECTED) beats leaving it 'transcoding' until the cron
        // gives up. The creator sees a fixed sentence; the issues go to logs.
        obs?.error('transcoding.webhook_payload_rejected', {
          jobId: classified.jobId,
          mediaId: classified.mediaId,
          issues: classified.issues,
          payload: rawBody.slice(0, 500),
        });
        await service.rejectWebhookOutput(
          { jobId: classified.jobId, mediaId: classified.mediaId },
          "The transcoder's result did not pass validation"
        );
        return c.json({ received: true, rejected: true }, 200);
      }

      // Dispatch based on webhook type
      if (classified.payload.status === 'progress') {
        await service.handleProgressWebhook(classified.payload);
      } else {
        await service.handleWebhook(classified.payload);

        // TODO: Send transcoding status email to creator
        // Requires DB join (mediaItems → content → users) to resolve creator email.
        // Templates transcoding-complete and transcoding-failed are seeded and ready.
        // Wire up when TranscodingService returns creator context from handleWebhook().
      }

      // Return success - RunPod expects 200 OK to acknowledge receipt
      return c.json({ received: true }, 200);
    } catch (error) {
      return answerWebhookError(c, error);
    } finally {
      release?.();
    }
  }
);

export default app;
