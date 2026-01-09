import { type EmailTemplate, emailTemplates } from '@codex/database/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
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
    // Single query to fetch all candidates (Organization, Creator, Global)
    // We fetch up to 3 candidates and prioritize them in memory to avoid N+1 queries
    const templates = await this.db.query.emailTemplates.findMany({
      where: and(
        eq(emailTemplates.name, name),
        isNull(emailTemplates.deletedAt),
        or(
          // 1. Organization Scope
          organizationId
            ? and(
                eq(emailTemplates.scope, 'organization'),
                eq(emailTemplates.organizationId, organizationId)
              )
            : undefined,
          // 2. Creator Scope
          creatorId
            ? and(
                eq(emailTemplates.scope, 'creator'),
                eq(emailTemplates.creatorId, creatorId)
              )
            : undefined,
          // 3. Global Scope
          eq(emailTemplates.scope, 'global')
        )
      ),
      limit: 3,
    });

    // In-memory priority resolution: Organization > Creator > Global
    return (
      templates.find((t) => t.scope === 'organization') ??
      templates.find((t) => t.scope === 'creator') ??
      templates.find((t) => t.scope === 'global') ??
      null
    );
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
