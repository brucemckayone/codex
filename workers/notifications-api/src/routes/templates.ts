/**
 * Template Management Endpoints
 *
 * RESTful API for managing email templates across scopes:
 * - Global templates (platform_owner only)
 * - Organization templates (org admins)
 * - Creator templates (individual creators)
 *
 * All routes use procedure() for auth, validation, and rate limiting.
 */

import { createDbClient, schema } from '@codex/database';
import {
  TemplateAccessDeniedError,
  TemplateNotFoundError,
} from '@codex/notifications';
import type { HonoEnv } from '@codex/shared-types';
import {
  createCreatorTemplateSchema,
  createGlobalTemplateSchema,
  createIdParamsSchema,
  createOrgTemplateSchema,
  listTemplatesQuerySchema,
  updateTemplateSchema,
  uuidSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

// ============================================================================
// Global Template Routes (Platform Owner Only)
// ============================================================================

/**
 * GET /global
 * List all global templates
 */
app.get(
  '/global',
  procedure({
    policy: { auth: 'required', roles: ['admin'] },
    input: { query: listTemplatesQuerySchema },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);
      const { page, limit, status } = ctx.input.query;
      const offset = (page - 1) * limit;

      const templates = await db.query.emailTemplates.findMany({
        where: and(
          eq(schema.emailTemplates.scope, 'global'),
          isNull(schema.emailTemplates.deletedAt),
          status ? eq(schema.emailTemplates.status, status) : undefined
        ),
        limit,
        offset,
        orderBy: [desc(schema.emailTemplates.createdAt)],
      });

      return { data: templates };
    },
  })
);

/**
 * POST /global
 * Create a global template
 */
app.post(
  '/global',
  procedure({
    policy: { auth: 'required', roles: ['admin'] },
    input: { body: createGlobalTemplateSchema },
    successStatus: 201,
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      const [template] = await db
        .insert(schema.emailTemplates)
        .values({
          ...ctx.input.body,
          scope: 'global',
          organizationId: null,
          creatorId: null,
          createdBy: ctx.user.id,
        })
        .returning();

      return { data: template };
    },
  })
);

/**
 * GET /global/:id
 * Get a global template by ID
 */
app.get(
  '/global/:id',
  procedure({
    policy: { auth: 'required', roles: ['admin'] },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      const template = await db.query.emailTemplates.findFirst({
        where: and(
          eq(schema.emailTemplates.id, ctx.input.params.id),
          eq(schema.emailTemplates.scope, 'global'),
          isNull(schema.emailTemplates.deletedAt)
        ),
      });

      if (!template) {
        throw new TemplateNotFoundError(ctx.input.params.id);
      }

      return { data: template };
    },
  })
);

/**
 * PATCH /global/:id
 * Update a global template
 */
app.patch(
  '/global/:id',
  procedure({
    policy: { auth: 'required', roles: ['admin'] },
    input: {
      params: createIdParamsSchema(),
      body: updateTemplateSchema,
    },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      const [updated] = await db
        .update(schema.emailTemplates)
        .set({
          ...ctx.input.body,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.emailTemplates.id, ctx.input.params.id),
            eq(schema.emailTemplates.scope, 'global'),
            isNull(schema.emailTemplates.deletedAt)
          )
        )
        .returning();

      if (!updated) {
        throw new TemplateNotFoundError(ctx.input.params.id);
      }

      return { data: updated };
    },
  })
);

/**
 * DELETE /global/:id
 * Soft delete a global template
 */
app.delete(
  '/global/:id',
  procedure({
    policy: { auth: 'required', roles: ['admin'] },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      const [deleted] = await db
        .update(schema.emailTemplates)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.emailTemplates.id, ctx.input.params.id),
            eq(schema.emailTemplates.scope, 'global'),
            isNull(schema.emailTemplates.deletedAt)
          )
        )
        .returning();

      if (!deleted) {
        throw new TemplateNotFoundError(ctx.input.params.id);
      }

      return null;
    },
  })
);

// ============================================================================
// Organization Template Routes
// ============================================================================

const orgIdParamSchema = z.object({
  orgId: uuidSchema,
});

/**
 * GET /organizations/:orgId
 * List templates for an organization
 */
app.get(
  '/organizations/:orgId',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: orgIdParamSchema,
      query: listTemplatesQuerySchema,
    },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);
      const { orgId } = ctx.input.params;
      const { page, limit, status } = ctx.input.query;
      const offset = (page - 1) * limit;

      // Check membership
      const membership = await db.query.organizationMemberships.findFirst({
        where: and(
          eq(schema.organizationMemberships.userId, ctx.user.id),
          eq(schema.organizationMemberships.organizationId, orgId),
          eq(schema.organizationMemberships.status, 'active')
        ),
      });

      if (!membership) {
        throw new TemplateAccessDeniedError(orgId);
      }

      const templates = await db.query.emailTemplates.findMany({
        where: and(
          eq(schema.emailTemplates.scope, 'organization'),
          eq(schema.emailTemplates.organizationId, orgId),
          isNull(schema.emailTemplates.deletedAt),
          status ? eq(schema.emailTemplates.status, status) : undefined
        ),
        limit,
        offset,
        orderBy: [desc(schema.emailTemplates.createdAt)],
      });

      return { data: templates };
    },
  })
);

/**
 * POST /organizations/:orgId
 * Create a template for an organization
 */
app.post(
  '/organizations/:orgId',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: orgIdParamSchema,
      body: createOrgTemplateSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);
      const { orgId } = ctx.input.params;

      // Check admin/owner role
      const membership = await db.query.organizationMemberships.findFirst({
        where: and(
          eq(schema.organizationMemberships.userId, ctx.user.id),
          eq(schema.organizationMemberships.organizationId, orgId),
          eq(schema.organizationMemberships.status, 'active')
        ),
      });

      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw new TemplateAccessDeniedError(orgId);
      }

      const [template] = await db
        .insert(schema.emailTemplates)
        .values({
          ...ctx.input.body,
          scope: 'organization',
          organizationId: orgId,
          creatorId: null,
          createdBy: ctx.user.id,
        })
        .returning();

      return { data: template };
    },
  })
);

// ============================================================================
// Creator Template Routes
// ============================================================================

/**
 * GET /creator
 * List templates owned by the current creator
 */
app.get(
  '/creator',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { query: listTemplatesQuerySchema },
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);
      const { page, limit, status } = ctx.input.query;
      const offset = (page - 1) * limit;

      const templates = await db.query.emailTemplates.findMany({
        where: and(
          eq(schema.emailTemplates.scope, 'creator'),
          eq(schema.emailTemplates.creatorId, ctx.user.id),
          isNull(schema.emailTemplates.deletedAt),
          status ? eq(schema.emailTemplates.status, status) : undefined
        ),
        limit,
        offset,
        orderBy: [desc(schema.emailTemplates.createdAt)],
      });

      return { data: templates };
    },
  })
);

/**
 * POST /creator
 * Create a template for the current creator
 */
app.post(
  '/creator',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { body: createCreatorTemplateSchema },
    successStatus: 201,
    handler: async (ctx) => {
      const db = createDbClient(ctx.env);

      const [template] = await db
        .insert(schema.emailTemplates)
        .values({
          ...ctx.input.body,
          scope: 'creator',
          organizationId: ctx.input.body.organizationId ?? null,
          creatorId: ctx.user.id,
          createdBy: ctx.user.id,
        })
        .returning();

      return { data: template };
    },
  })
);

export default app;
