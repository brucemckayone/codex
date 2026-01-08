/**
 * Template Management Endpoints
 *
 * RESTful API for managing email templates across scopes:
 * - Global templates (platform_owner only)
 * - Organization templates (org admins)
 * - Creator templates (individual creators)
 *
 * All routes use procedure() for auth, validation, and rate limiting.
 * Business logic is delegated to TemplateService in @codex/notifications.
 */

import { createDbClient } from '@codex/database';
import { TemplateService } from '@codex/notifications';
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
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

// Helper to create TemplateService from context
function getTemplateService(env: HonoEnv['Bindings']) {
  const db = createDbClient(env);
  return new TemplateService({
    db,
    environment: env.ENVIRONMENT ?? 'development',
  });
}

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
    policy: { auth: 'platform_owner' },
    input: { query: listTemplatesQuerySchema },
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      return service.listGlobalTemplates(ctx.input.query);
    },
  })
);

/**
 * POST /global
 * Create a new global template
 */
app.post(
  '/global',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { body: createGlobalTemplateSchema },
    successStatus: 201,
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      return service.createGlobalTemplate(ctx.input.body, ctx.user.id);
    },
  })
);

/**
 * GET /global/:id
 * Get a specific global template
 */
app.get(
  '/global/:id',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      return service.getGlobalTemplate(ctx.input.params.id);
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
    policy: { auth: 'platform_owner' },
    input: {
      params: createIdParamsSchema(),
      body: updateTemplateSchema,
    },
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      return service.updateGlobalTemplate(ctx.input.params.id, ctx.input.body);
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
    policy: { auth: 'platform_owner' },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      await service.deleteGlobalTemplate(ctx.input.params.id);
      return null;
    },
  })
);

// ============================================================================
// Organization Template Routes
// ============================================================================

// Schema for org routes with orgId param
const orgIdParamSchema = z.object({
  orgId: uuidSchema,
});

// Combined params schema for org template with ID
const orgTemplateIdParamSchema = z.object({
  orgId: uuidSchema,
  id: uuidSchema,
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
      const service = getTemplateService(ctx.env);
      return service.listOrgTemplates(
        ctx.input.params.orgId,
        ctx.user.id,
        ctx.input.query
      );
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
      const service = getTemplateService(ctx.env);
      return service.createOrgTemplate(
        ctx.input.params.orgId,
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

/**
 * PATCH /organizations/:orgId/:id
 * Update an organization template
 */
app.patch(
  '/organizations/:orgId/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: orgTemplateIdParamSchema,
      body: updateTemplateSchema,
    },
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      return service.updateOrgTemplate(
        ctx.input.params.orgId,
        ctx.input.params.id,
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

/**
 * DELETE /organizations/:orgId/:id
 * Soft delete an organization template
 */
app.delete(
  '/organizations/:orgId/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: orgTemplateIdParamSchema },
    successStatus: 204,
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      await service.deleteOrgTemplate(
        ctx.input.params.orgId,
        ctx.input.params.id,
        ctx.user.id
      );
      return null;
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
      const service = getTemplateService(ctx.env);
      return service.listCreatorTemplates(ctx.user.id, ctx.input.query);
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
      const service = getTemplateService(ctx.env);
      return service.createCreatorTemplate(ctx.user.id, ctx.input.body);
    },
  })
);

/**
 * PATCH /creator/:id
 * Update a creator template
 */
app.patch(
  '/creator/:id',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: {
      params: createIdParamsSchema(),
      body: updateTemplateSchema,
    },
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      return service.updateCreatorTemplate(
        ctx.user.id,
        ctx.input.params.id,
        ctx.input.body
      );
    },
  })
);

/**
 * DELETE /creator/:id
 * Soft delete a creator template
 */
app.delete(
  '/creator/:id',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { params: createIdParamsSchema() },
    successStatus: 204,
    handler: async (ctx) => {
      const service = getTemplateService(ctx.env);
      await service.deleteCreatorTemplate(ctx.user.id, ctx.input.params.id);
      return null;
    },
  })
);

export default app;
