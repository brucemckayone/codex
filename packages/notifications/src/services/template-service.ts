/**
 * Template Service
 *
 * Manages email template CRUD operations across scopes (global, organization, creator).
 * Encapsulates business logic including access control and membership validation.
 */

import { type dbHttp, type dbWs, schema } from '@codex/database';
import { BaseService, InternalServiceError } from '@codex/service-errors';
import type { PaginatedListResponse } from '@codex/shared-types';
import type {
  CreateCreatorTemplateInput,
  CreateGlobalTemplateInput,
  CreateOrgTemplateInput,
  ListTemplatesQuery,
  UpdateTemplateInput,
} from '@codex/validation';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { TemplateAccessDeniedError, TemplateNotFoundError } from '../errors';
import type { NotificationsService } from './notifications-service';

/**
 * Configuration for TemplateService
 */
export interface TemplateServiceConfig {
  db: typeof dbHttp | typeof dbWs;
  environment: string;
}

type EmailTemplate = typeof schema.emailTemplates.$inferSelect;

/**
 * TemplateService
 *
 * Handles template management operations with proper access control.
 * All business logic for template CRUD is encapsulated here.
 */
export class TemplateService extends BaseService {
  // ===========================================================================
  // Global Template Operations (Platform Owner Only)
  // ===========================================================================

  /**
   * List all global templates
   *
   * @param query - Pagination and filter criteria
   * @returns Paginated list of global templates
   */
  async listGlobalTemplates(
    query: ListTemplatesQuery
  ): Promise<PaginatedListResponse<EmailTemplate>> {
    const { page, limit, status } = query;
    const offset = (page - 1) * limit;

    const whereGlobalTemplates = and(
      eq(schema.emailTemplates.scope, 'global'),
      isNull(schema.emailTemplates.deletedAt),
      status ? eq(schema.emailTemplates.status, status) : undefined
    );

    const [templates, countResult] = await Promise.all([
      this.db.query.emailTemplates.findMany({
        where: whereGlobalTemplates,
        limit,
        offset,
        orderBy: [desc(schema.emailTemplates.createdAt)],
      }),
      this.db
        .select({ count: count(schema.emailTemplates.id) })
        .from(schema.emailTemplates)
        .where(whereGlobalTemplates),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      items: templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a global template
   */
  async createGlobalTemplate(
    input: CreateGlobalTemplateInput,
    createdBy: string
  ): Promise<EmailTemplate> {
    try {
      const [template] = await this.db
        .insert(schema.emailTemplates)
        .values({
          ...input,
          scope: 'global',
          organizationId: null,
          creatorId: null,
          createdBy,
        })
        .returning();

      if (!template) {
        throw new Error('Failed to create global template');
      }

      // Log after successful DB operation
      this.obs.info('Global template created', {
        templateId: template.id,
        name: template.name,
      });

      return template;
    } catch (error) {
      this.obs.error('Error creating global template', { error, input });
      if (error instanceof BaseService) throw error; // Re-throw specialized errors
      throw new InternalServiceError('Failed to create global template', {
        originalError: error,
      });
    }
  }

  /**
   * Get a global template by ID
   */
  async getGlobalTemplate(id: string): Promise<EmailTemplate> {
    const template = await this.db.query.emailTemplates.findFirst({
      where: and(
        eq(schema.emailTemplates.id, id),
        eq(schema.emailTemplates.scope, 'global'),
        isNull(schema.emailTemplates.deletedAt)
      ),
    });

    if (!template) {
      throw new TemplateNotFoundError(id);
    }

    return template;
  }

  /**
   * Update a global template
   */
  async updateGlobalTemplate(
    id: string,
    input: UpdateTemplateInput
  ): Promise<EmailTemplate> {
    const [updated] = await this.db
      .update(schema.emailTemplates)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.emailTemplates.id, id),
          eq(schema.emailTemplates.scope, 'global'),
          isNull(schema.emailTemplates.deletedAt)
        )
      )
      .returning();

    if (!updated) {
      throw new TemplateNotFoundError(id);
    }

    this.obs.info('Global template updated', { templateId: id });

    return updated;
  }

  /**
   * Soft delete a global template
   */
  async deleteGlobalTemplate(id: string): Promise<void> {
    const [deleted] = await this.db
      .update(schema.emailTemplates)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.emailTemplates.id, id),
          eq(schema.emailTemplates.scope, 'global'),
          isNull(schema.emailTemplates.deletedAt)
        )
      )
      .returning();

    if (!deleted) {
      throw new TemplateNotFoundError(id);
    }

    this.obs.info('Global template deleted', { templateId: id });
  }

  // ===========================================================================
  // Organization Template Operations
  // ===========================================================================

  /**
   * List organization templates (requires active membership)
   */
  async listOrgTemplates(
    orgId: string,
    userId: string,
    query: ListTemplatesQuery
  ): Promise<PaginatedListResponse<EmailTemplate>> {
    // Verify membership
    await this.requireOrgMembership(orgId, userId);

    const { page, limit, status } = query;
    const offset = (page - 1) * limit;

    const whereClause = and(
      eq(schema.emailTemplates.scope, 'organization'),
      eq(schema.emailTemplates.organizationId, orgId),
      isNull(schema.emailTemplates.deletedAt),
      status ? eq(schema.emailTemplates.status, status) : undefined
    );

    const [templates, countResult] = await Promise.all([
      this.db.query.emailTemplates.findMany({
        where: whereClause,
        limit,
        offset,
        orderBy: [desc(schema.emailTemplates.createdAt)],
      }),
      this.db
        .select({ count: count(schema.emailTemplates.id) })
        .from(schema.emailTemplates)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      items: templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create an organization template (requires admin/owner role)
   *
   * @param orgId - Organization ID
   * @param userId - User ID (must be admin/owner)
   * @param input - Template creation data
   * @throws {TemplateAccessDeniedError} If user is not admin/owner
   * @returns Created template
   */
  async createOrgTemplate(
    orgId: string,
    userId: string,
    input: CreateOrgTemplateInput
  ): Promise<EmailTemplate> {
    // Verify admin/owner role
    await this.requireOrgAdminRole(orgId, userId);

    try {
      const [template] = await this.db
        .insert(schema.emailTemplates)
        .values({
          ...input,
          scope: 'organization',
          organizationId: orgId,
          creatorId: null,
          createdBy: userId,
        })
        .returning();

      if (!template) {
        throw new Error('Failed to create organization template');
      }

      // Log after successful DB operation
      this.obs.info('Org template created', { templateId: template.id, orgId });

      return template;
    } catch (error) {
      this.obs.error('Error creating organization template', {
        error,
        orgId,
        input,
      });
      throw error;
    }
  }

  /**
   * Update an organization template (requires admin/owner role)
   *
   * Security Note: Org admin role is verified before update. The WHERE clause
   * enforces organization scoping at the database level, mitigating TOCTOU risks
   * by ensuring the update only affects templates in the verified organization.
   */
  async updateOrgTemplate(
    orgId: string,
    templateId: string,
    userId: string,
    input: UpdateTemplateInput
  ): Promise<EmailTemplate> {
    return this.db.transaction(async (tx) => {
      // Verify admin/owner role - authorization check (within transaction)
      await this.requireOrgAdminRole(orgId, userId, tx);

      const [updated] = await tx
        .update(schema.emailTemplates)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.emailTemplates.id, templateId),
            eq(schema.emailTemplates.scope, 'organization'),
            eq(schema.emailTemplates.organizationId, orgId),
            isNull(schema.emailTemplates.deletedAt)
          )
        )
        .returning();

      if (!updated) {
        throw new TemplateNotFoundError(templateId);
      }

      this.obs.info('Org template updated', { templateId, orgId });

      return updated;
    });
  }

  /**
   * Soft delete an organization template (requires admin/owner role)
   */
  async deleteOrgTemplate(
    orgId: string,
    templateId: string,
    userId: string
  ): Promise<void> {
    // Verify admin/owner role
    await this.requireOrgAdminRole(orgId, userId);

    const [deleted] = await this.db
      .update(schema.emailTemplates)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.emailTemplates.id, templateId),
          eq(schema.emailTemplates.scope, 'organization'),
          eq(schema.emailTemplates.organizationId, orgId),
          isNull(schema.emailTemplates.deletedAt)
        )
      )
      .returning();

    if (!deleted) {
      throw new TemplateNotFoundError(templateId);
    }

    this.obs.info('Org template deleted', { templateId, orgId });
  }

  // ===========================================================================
  // Creator Template Operations
  // ===========================================================================

  /**
   * List templates owned by a creator
   */
  async listCreatorTemplates(
    creatorId: string,
    query: ListTemplatesQuery
  ): Promise<PaginatedListResponse<EmailTemplate>> {
    const { page, limit, status } = query;
    const offset = (page - 1) * limit;

    const whereClause = and(
      eq(schema.emailTemplates.scope, 'creator'),
      eq(schema.emailTemplates.creatorId, creatorId),
      isNull(schema.emailTemplates.deletedAt),
      status ? eq(schema.emailTemplates.status, status) : undefined
    );

    const [templates, countResult] = await Promise.all([
      this.db.query.emailTemplates.findMany({
        where: whereClause,
        limit,
        offset,
        orderBy: [desc(schema.emailTemplates.createdAt)],
      }),
      this.db
        .select({ count: count(schema.emailTemplates.id) })
        .from(schema.emailTemplates)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      items: templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a creator template
   */
  async createCreatorTemplate(
    creatorId: string,
    input: CreateCreatorTemplateInput
  ): Promise<EmailTemplate> {
    try {
      const [template] = await this.db
        .insert(schema.emailTemplates)
        .values({
          ...input,
          scope: 'creator',
          organizationId: input.organizationId ?? null,
          creatorId,
          createdBy: creatorId,
        })
        .returning();

      if (!template) {
        throw new Error('Failed to create creator template');
      }

      // Log after successful DB operation
      this.obs.info('Creator template created', {
        templateId: template.id,
        creatorId,
      });

      return template;
    } catch (error) {
      this.obs.error('Error creating creator template', {
        error,
        creatorId,
        input,
      });
      throw error;
    }
  }

  /**
   * Update a creator template (must be owner)
   */
  async updateCreatorTemplate(
    creatorId: string,
    templateId: string,
    input: UpdateTemplateInput
  ): Promise<EmailTemplate> {
    const [updated] = await this.db
      .update(schema.emailTemplates)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.emailTemplates.id, templateId),
          eq(schema.emailTemplates.scope, 'creator'),
          eq(schema.emailTemplates.creatorId, creatorId),
          isNull(schema.emailTemplates.deletedAt)
        )
      )
      .returning();

    if (!updated) {
      throw new TemplateNotFoundError(templateId);
    }

    this.obs.info('Creator template updated', { templateId, creatorId });

    return updated;
  }

  /**
   * Soft delete a creator template (must be owner)
   */
  async deleteCreatorTemplate(
    creatorId: string,
    templateId: string
  ): Promise<void> {
    const [deleted] = await this.db
      .update(schema.emailTemplates)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.emailTemplates.id, templateId),
          eq(schema.emailTemplates.scope, 'creator'),
          eq(schema.emailTemplates.creatorId, creatorId),
          isNull(schema.emailTemplates.deletedAt)
        )
      )
      .returning();

    if (!deleted) {
      throw new TemplateNotFoundError(templateId);
    }

    this.obs.info('Creator template deleted', { templateId, creatorId });
  }

  // ===========================================================================
  // Template Preview Operations
  // ===========================================================================

  /**
   * Preview a template by ID with access control
   * Used by worker routes to delegate preview logic with proper access checks
   */
  async previewTemplateById(
    templateId: string,
    userId: string,
    userRole: string,
    data: Record<string, string | number | boolean | null>,
    notificationsService: NotificationsService
  ): Promise<{
    subject: string;
    html: string;
    text: string;
  }> {
    // Get template
    const template = await this.db.query.emailTemplates.findFirst({
      where: and(
        eq(schema.emailTemplates.id, templateId),
        isNull(schema.emailTemplates.deletedAt)
      ),
    });

    if (!template) {
      throw new TemplateNotFoundError(templateId);
    }

    // Check access based on scope
    const hasAccess = await this.checkTemplateAccess(
      template,
      userId,
      userRole
    );

    if (!hasAccess) {
      throw new TemplateAccessDeniedError(templateId);
    }

    // Delegate to NotificationsService for rendering
    return notificationsService.previewTemplate(
      template.name,
      data,
      template.organizationId ?? undefined,
      template.creatorId ?? undefined
    );
  }

  /**
   * Check if a user has access to a template based on scope
   * Public for use in worker routes that need access checks separate from preview
   */
  async checkTemplateAccess(
    template: EmailTemplate,
    userId: string,
    userRole: string
  ): Promise<boolean> {
    if (template.scope === 'global') {
      return userRole === 'platform_owner'; // Only platform owner has global template access
    }

    if (template.scope === 'organization' && template.organizationId) {
      const membership = await this.db.query.organizationMemberships.findFirst({
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

  // ===========================================================================
  // Access Control Helpers
  // ===========================================================================

  /**
   * Require active organization membership
   */
  private async requireOrgMembership(
    orgId: string,
    userId: string
  ): Promise<void> {
    const membership = await this.db.query.organizationMemberships.findFirst({
      where: and(
        eq(schema.organizationMemberships.userId, userId),
        eq(schema.organizationMemberships.organizationId, orgId),
        eq(schema.organizationMemberships.status, 'active')
      ),
    });

    if (!membership) {
      throw new TemplateAccessDeniedError(orgId);
    }
  }

  /**
   * Require admin or owner role in organization
   */
  private async requireOrgAdminRole(
    orgId: string,
    userId: string,
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle transaction type is complex to extract
    tx?: any
  ): Promise<void> {
    const db = tx ?? this.db;
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(schema.organizationMemberships.userId, userId),
        eq(schema.organizationMemberships.organizationId, orgId),
        eq(schema.organizationMemberships.status, 'active')
      ),
    });

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      throw new TemplateAccessDeniedError(orgId);
    }
  }
}
