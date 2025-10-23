// See /design/features/notifications/ttd-dphase-1.md
import { db } from '@codex/database';
import { schema } from '@codex/database';
import { eq } from 'drizzle-orm';

export interface TemplateContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Load template from database.
 * This is designed to be compatible with Cloudflare Workers (no filesystem access).
 */
export async function loadTemplate(templateName: string): Promise<TemplateContent> {
  // In a real implementation, we would cache this query result.
  const template = await db.query.emailTemplates.findFirst({
    where: eq(schema.emailTemplates.name, templateName)
  });

  if (!template) {
    throw new Error(`Email template not found: ${templateName}`);
  }

  return {
    subject: template.subject,
    html: template.htmlBody,
    text: template.textBody
  };
}
