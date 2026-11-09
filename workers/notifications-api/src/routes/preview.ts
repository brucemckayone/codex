/**
 * Template Preview & Test Send Endpoints
 *
 * Routes for previewing and testing email templates:
 * - POST /:id/preview - Render template without sending
 * - POST /:id/test-send - Send test email to specified address
 *
 * Access control checks ensure users can only preview/test templates
 * they have access to based on scope and ownership.
 */

import { TemplateAccessDeniedError } from '@codex/notifications';
import type { HonoEnv } from '@codex/shared-types';
import {
  createIdParamsSchema,
  previewTemplateSchema,
  testSendTemplateSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * POST /:id/preview
 * Render a template with test data without sending
 */
app.post(
  '/:id/preview',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'strict', // 20 requests per minute (defined in @codex/security)
    },
    input: {
      params: createIdParamsSchema(),
      body: previewTemplateSchema,
    },
    handler: async (ctx) => {
      // Delegate to TemplateService for access control + rendering
      const preview = await ctx.services.templates.previewTemplateById(
        ctx.input.params.id,
        ctx.user.id,
        ctx.user.role,
        ctx.input.body.data,
        ctx.services.notifications
      );

      return preview;
    },
  })
);

/**
 * POST /:id/test-send
 * Send a test email using the template
 */
app.post(
  '/:id/test-send',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'strict', // 20 requests per minute (defined in @codex/security)
    },
    input: {
      params: createIdParamsSchema(),
      body: testSendTemplateSchema,
    },
    handler: async (ctx) => {
      // Get template via service (replaces ad-hoc createDbClient)
      const template = await ctx.services.templates.getTemplateById(
        ctx.input.params.id
      );

      // A test send goes out in the template's org brand: the send-time
      // check. A creator template naming an org needs a team role in it; an
      // org's own template needs its owner or admin (Codex-tgkgb).
      const hasAccess = await ctx.services.templates.checkTemplateSendAccess(
        template,
        ctx.user.id,
        ctx.user.role
      );

      if (!hasAccess) {
        throw new TemplateAccessDeniedError(ctx.input.params.id);
      }

      // An org-branded creator template goes only to the sender's own
      // address: the signed-in user's, never one the body names.
      ctx.services.templates.requireTestSendRecipient(
        template,
        ctx.input.body.recipientEmail,
        ctx.user.email
      );

      // Use notification service to send email. A test send: the caller's
      // data renders the email but never reaches the email log, where the
      // sweeps would read its keys as one of their own sends.
      const result = await ctx.services.notifications.sendEmail({
        to: ctx.input.body.recipientEmail,
        templateName: template.name,
        data: ctx.input.body.data,
        organizationId: template.organizationId,
        creatorId: template.creatorId,
        testSend: true,
      });

      return result;
    },
  })
);

export default app;
