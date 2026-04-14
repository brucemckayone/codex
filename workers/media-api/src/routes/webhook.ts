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

import { createDbClient } from '@codex/database';
import { isServiceError, ValidationError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import {
  runpodWebhookUnionSchema,
  TranscodingService,
} from '@codex/transcoding';
import { Hono } from 'hono';
import { verifyRunpodSignature } from '../middleware/verify-runpod-signature';

const app = new Hono<HonoEnv>();

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

      // Validate against union schema (completed | failed | progress)
      const result = runpodWebhookUnionSchema.safeParse(payload);
      if (!result.success) {
        const zodErrors = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new ValidationError(`Invalid webhook payload: ${zodErrors}`);
      }

      // Create database client and TranscodingService
      // Note: Env vars are validated by global middleware in index.ts
      // B2 credentials are configured in RunPod's secret manager, not passed here
      const db = createDbClient(c.env);

      // Guard against missing env vars (should be caught by global middleware)
      const runpodApiKey = c.env.RUNPOD_API_KEY;
      const runpodEndpointId = c.env.RUNPOD_ENDPOINT_ID;
      if (!runpodApiKey || !runpodEndpointId) {
        throw new ValidationError(
          'Missing required environment variables: RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID'
        );
      }

      const service = new TranscodingService({
        db,
        environment: c.env.ENVIRONMENT || 'development',
        runpodApiKey,
        runpodEndpointId,
        webhookBaseUrl: c.env.API_URL || 'http://localhost:4002',
      });

      // Dispatch based on webhook type
      if (result.data.status === 'progress') {
        await service.handleProgressWebhook(result.data);
      } else {
        await service.handleWebhook(result.data);

        // TODO: Send transcoding status email to creator
        // Requires DB join (mediaItems → content → users) to resolve creator email.
        // Templates transcoding-complete and transcoding-failed are seeded and ready.
        // Wire up when TranscodingService returns creator context from handleWebhook().
      }

      // Return success - RunPod expects 200 OK to acknowledge receipt
      return c.json({ received: true }, 200);
    } catch (error) {
      // Transient/permanent classification (same pattern as Stripe webhooks):
      // - Permanent (bad payload, business logic) → 200 to stop retries
      // - Transient (DB/network failure) → 500 to trigger RunPod retry
      const isPermanent =
        error instanceof ValidationError || isServiceError(error);

      const message =
        error instanceof Error ? error.message : 'Unknown webhook error';

      if (isPermanent) {
        // Log so schema mismatches are visible in Worker logs
        console.error('[webhook] Permanent webhook error:', message);
        // Acknowledge receipt so RunPod doesn't retry a non-fixable error
        return c.json({ received: true, error: message }, 200);
      }

      // Transient error — let RunPod retry
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Transient failure' } },
        500
      );
    }
  }
);

export default app;
