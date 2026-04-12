/**
 * Internal Routes (Worker-to-Worker)
 *
 * POST /internal/send — Central email sending endpoint.
 * All workers call this to send emails via the template system.
 *
 * Security: HMAC worker-to-worker auth (X-Worker-Signature + X-Worker-Timestamp)
 */

import type { HonoEnv } from '@codex/shared-types';
import { internalSendEmailSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /send
 *
 * Send an email using the template system.
 * Validates input, checks preferences (non-transactional), resolves template,
 * renders with branding, sends via provider, writes audit log.
 */
app.post(
  '/send',
  procedure({
    policy: { auth: 'worker' },
    input: { body: internalSendEmailSchema },
    handler: async (ctx) => {
      const {
        to,
        toName,
        templateName,
        data,
        organizationId,
        creatorId,
        category,
        userId,
      } = ctx.input.body;

      const result = await ctx.services.notifications.sendEmail({
        to,
        toName,
        templateName,
        data,
        organizationId,
        creatorId,
        category,
        userId,
      });

      return {
        success: result.success,
        messageId: result.messageId,
        skipped: result.skipped,
      };
    },
  })
);

export default app;
