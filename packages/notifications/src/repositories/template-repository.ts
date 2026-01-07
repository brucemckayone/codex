import { type EmailTemplate, emailTemplates } from '@codex/database/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TemplateNotFoundError } from '../errors';
import type { Database } from '../types';

export class TemplateRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a template by name using the resolution scope order:
   * 1. Organization (if orgId provided)
   * 2. Creator (if creatorId provided)
   * 3. Global
   */
  async findTemplate(
    name: string,
    organizationId?: string | null,
    creatorId?: string | null
  ): Promise<EmailTemplate | null> {
    // 1. Try finding organization template
    if (organizationId) {
      const orgTemplate = await this.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.name, name),
          eq(emailTemplates.scope, 'organization'),
          eq(emailTemplates.organizationId, organizationId),
          isNull(emailTemplates.deletedAt)
        ),
      });
      if (orgTemplate) return orgTemplate;
    }

    // 2. Try finding creator template
    if (creatorId) {
      const creatorTemplate = await this.db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.name, name),
          eq(emailTemplates.scope, 'creator'),
          eq(emailTemplates.creatorId, creatorId),
          isNull(emailTemplates.deletedAt)
        ),
      });
      if (creatorTemplate) return creatorTemplate;
    }

    // 3. Fallback to global template
    const globalTemplate = await this.db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.name, name),
        eq(emailTemplates.scope, 'global'),
        isNull(emailTemplates.deletedAt)
      ),
    });

    return globalTemplate ?? null;
  }

  /**
   * Get a specific template by ID
   */
  async getTemplateById(id: string): Promise<EmailTemplate | null> {
    const template = await this.db.query.emailTemplates.findFirst({
      where: and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)),
    });
    return template ?? null;
  }

  /**
   * Create a new template (simple pass-through to DB currently)
   */
  async createTemplate(values: typeof emailTemplates.$inferInsert) {
    const [template] = await this.db
      .insert(emailTemplates)
      .values(values)
      .returning();
    return template;
  }
}
