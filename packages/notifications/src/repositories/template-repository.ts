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
   *
   * Optimization Strategy:
   * - Single query fetches up to 3 candidates (Organization, Creator, Global)
   * - In-memory priority resolution avoids N+1 queries
   * - Fetch limit of 3 ensures minimal data transfer
   *
   * Security Note:
   * - Conditions are built explicitly to avoid relying on undocumented
   *   Drizzle behavior with undefined values in or() clauses.
   */
  async findTemplate(
    name: string,
    organizationId?: string | null,
    creatorId?: string | null
  ): Promise<EmailTemplate | null> {
    // Build scope conditions explicitly (no undefined values)
    // Global scope is always included as the fallback
    const scopeConditions: ReturnType<typeof and>[] = [
      eq(emailTemplates.scope, 'global'),
    ];

    // Add organization scope if orgId provided (highest priority)
    if (organizationId) {
      scopeConditions.unshift(
        and(
          eq(emailTemplates.scope, 'organization'),
          eq(emailTemplates.organizationId, organizationId)
        )
      );
    }

    // Add creator scope if creatorId provided
    if (creatorId) {
      scopeConditions.push(
        and(
          eq(emailTemplates.scope, 'creator'),
          eq(emailTemplates.creatorId, creatorId)
        )
      );
    }

    // Single query to fetch all candidates
    const templates =
      (await this.db.query.emailTemplates.findMany({
        where: and(
          eq(emailTemplates.name, name),
          isNull(emailTemplates.deletedAt),
          or(...scopeConditions)
        ),
        limit: 3,
      })) ?? [];

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
