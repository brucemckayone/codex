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
import { mapErrorToResponse, ValidationError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import { runpodWebhookSchema, TranscodingService } from '@codex/transcoding';
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

      // Validate against schema
      const result = runpodWebhookSchema.safeParse(payload);
      if (!result.success) {
        throw new ValidationError('Invalid webhook payload');
      }

      // Create database client and TranscodingService
      // Note: Env vars are validated by global middleware in index.ts
      const db = createDbClient(c.env);
      const service = new TranscodingService({
        db,
        environment: c.env.ENVIRONMENT || 'development',
        runpodApiKey: c.env.RUNPOD_API_KEY!,
        runpodEndpointId: c.env.RUNPOD_ENDPOINT_ID!,
        webhookBaseUrl: c.env.API_URL || 'http://localhost:4002',
        b2Endpoint: c.env.B2_ENDPOINT!,
        b2AccessKeyId: c.env.B2_KEY_ID!,
        b2SecretAccessKey: c.env.B2_APP_KEY!,
        b2BucketName: c.env.B2_BUCKET!,
      });

      // Process the webhook
      await service.handleWebhook(result.data);

      // Return success - RunPod expects 200 OK to acknowledge receipt
      return c.json({ received: true }, 200);
    } catch (error) {
      // Map service errors to HTTP responses using standard error handler
      const { statusCode, response } = mapErrorToResponse(error);
      return c.json(
        response,
        statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
      );
    }
  }
);

export default app;
