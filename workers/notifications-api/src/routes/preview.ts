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

import { createDbClient, schema } from '@codex/database';
import {
  TemplateAccessDeniedError,
  TemplateNotFoundError,
  type TemplatePreviewResponse,
  type TestSendResponse,
} from '@codex/notifications';
import type { HonoEnv } from '@codex/shared-types';
import {
  createIdParamsSchema,
  previewTemplateSchema,
  testSendTemplateSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { eq } from 'drizzle-orm';
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
    handler: async (ctx): Promise<TemplatePreviewResponse> => {
      // Delegate to TemplateService for access control + rendering
      const preview = await ctx.services.templates.previewTemplateById(
        ctx.input.params.id,
        ctx.user.id,
        ctx.user.role,
        ctx.input.body.data,
        ctx.services.notifications
      );

      return { data: preview };
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
    handler: async (ctx): Promise<TestSendResponse> => {
      const db = createDbClient(ctx.env);

      // Get template (we need the name for sending)
      const template = await db.query.emailTemplates.findFirst({
        where: eq(schema.emailTemplates.id, ctx.input.params.id),
      });

      if (!template) {
        throw new TemplateNotFoundError(ctx.input.params.id);
      }

      // Check access using template service
      const hasAccess = await ctx.services.templates.checkTemplateAccess(
        template,
        ctx.user.id,
        ctx.user.role
      );

      if (!hasAccess) {
        throw new TemplateAccessDeniedError(ctx.input.params.id);
      }

      // Use notification service to send email
      const result = await ctx.services.notifications.sendEmail({
        to: ctx.input.body.recipientEmail,
        templateName: template.name,
        data: ctx.input.body.data,
        organizationId: template.organizationId,
        creatorId: template.creatorId,
      });

      return { data: result };
    },
  })
);

export default app;
