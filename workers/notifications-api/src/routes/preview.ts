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
  createEmailProvider,
  NotificationsService,
  TemplateAccessDeniedError,
  TemplateNotFoundError,
} from '@codex/notifications';
import type { HonoEnv } from '@codex/shared-types';
import {
  createIdParamsSchema,
  previewTemplateSchema,
  testSendTemplateSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * Helper to check if user can access a template
 */
async function checkTemplateAccess(
  db: ReturnType<typeof createDbClient>,
  template: NonNullable<
    Awaited<ReturnType<typeof db.query.emailTemplates.findFirst>>
  >,
  userId: string,
  userRole: string
): Promise<boolean> {
  if (template.scope === 'global') {
    return userRole === 'platform_owner'; // Only platform owner has global template access
  }

  if (template.scope === 'organization' && template.organizationId) {
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(schema.organizationMemberships.userId, userId),
        eq(
          schema.organizationMemberships.organizationId,
          template.organizationId
        ),
        eq(schema.organizationMemberships.status, 'active')
      ),
    });
    return !!membership;
  }

  if (template.scope === 'creator') {
    return template.creatorId === userId;
  }

  return false;
}

/**
 * POST /:id/preview
 * Render a template with test data without sending
 */
app.post(
  '/:id/preview',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: createIdParamsSchema(),
      body: previewTemplateSchema,
    },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      // Get template
      const template = await db.query.emailTemplates.findFirst({
        where: eq(schema.emailTemplates.id, ctx.input.params.id),
      });

      if (!template) {
        throw new TemplateNotFoundError(ctx.input.params.id);
      }

      // Check access
      const hasAccess = await checkTemplateAccess(
        db,
        template,
        ctx.user.id,
        ctx.user.role
      );

      if (!hasAccess) {
        throw new TemplateAccessDeniedError(ctx.input.params.id);
      }

      // Create service for preview
      const emailProvider = createEmailProvider({ useMock: true });

      const notificationService = new NotificationsService({
        db,
        emailProvider,
        fromEmail:
          (ctx.env as Record<string, string>).FROM_EMAIL ||
          'noreply@example.com',
        fromName: (ctx.env as Record<string, string>).FROM_NAME || 'Codex',
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const preview = await notificationService.previewTemplate(
        template.name,
        ctx.input.body.data,
        template.organizationId ?? undefined,
        template.creatorId ?? undefined
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
    policy: { auth: 'required' },
    input: {
      params: createIdParamsSchema(),
      body: testSendTemplateSchema,
    },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      // Get template
      const template = await db.query.emailTemplates.findFirst({
        where: eq(schema.emailTemplates.id, ctx.input.params.id),
      });

      if (!template) {
        throw new TemplateNotFoundError(ctx.input.params.id);
      }

      // Check access
      const hasAccess = await checkTemplateAccess(
        db,
        template,
        ctx.user.id,
        ctx.user.role
      );

      if (!hasAccess) {
        throw new TemplateAccessDeniedError(ctx.input.params.id);
      }

      // Create provider based on environment
      const emailProvider = createEmailProvider({
        useMock: (ctx.env as Record<string, string>).USE_MOCK_EMAIL === 'true',
        resendApiKey: (ctx.env as Record<string, string>).RESEND_API_KEY,
        mailhogUrl: (ctx.env as Record<string, string>).MAILHOG_URL,
      });

      const notificationService = new NotificationsService({
        db,
        emailProvider,
        fromEmail:
          (ctx.env as Record<string, string>).FROM_EMAIL ||
          'noreply@example.com',
        fromName: (ctx.env as Record<string, string>).FROM_NAME || 'Codex',
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const result = await notificationService.sendEmail({
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
