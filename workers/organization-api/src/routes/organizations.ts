/**
 * Organization Management Endpoints
 *
 * RESTful API for managing organizations.
 * All routes require authentication.
 *
 * Endpoints:
 * - POST   /api/organizations           - Create organization
 * - GET    /api/organizations/:id       - Get by ID
 * - GET    /api/organizations/slug/:slug - Get by slug
 * - PATCH  /api/organizations/:id       - Update organization
 * - GET    /api/organizations           - List with filters
 * - DELETE /api/organizations/:id       - Soft delete
 * - GET    /api/organizations/check-slug/:slug - Check slug availability
 */

import type {
  CreateOrganizationResponse,
  OrganizationBySlugResponse,
  OrganizationListResponse,
  OrganizationResponse,
  UpdateOrganizationResponse,
} from '@codex/organization';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@codex/organization';
import { NotFoundError } from '@codex/service-errors';
import type {
  CheckSlugResponse,
  DeleteOrganizationResponse,
  HonoEnv,
} from '@codex/shared-types';
import {
  createSlugSchema,
  organizationQuerySchema,
  uuidSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

/**
 * POST /api/organizations
 * Create new organization
 *
 * Body: CreateOrganizationInput
 * Returns: Organization (201)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {CreateOrganizationResponse}
 */
app.post(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { body: createOrganizationSchema },
    successStatus: 201,
    handler: async (ctx): Promise<CreateOrganizationResponse['data']> => {
      return await ctx.services.organization.create(ctx.input.body);
    },
  })
);

/**
 * GET /api/organizations/check-slug/:slug
 * Check if slug is available
 *
 * Returns: { available: boolean } (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {CheckSlugResponse}
 */
app.get(
  '/check-slug/:slug',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ slug: createSlugSchema(255) }) },
    handler: async (ctx): Promise<CheckSlugResponse> => {
      const available = await ctx.services.organization.isSlugAvailable(
        ctx.input.params.slug
      );
      return { available };
    },
  })
);

/**
 * GET /api/organizations/slug/:slug
 * Get organization by slug
 *
 * Returns: Organization (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {OrganizationBySlugResponse}
 */
app.get(
  '/slug/:slug',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ slug: createSlugSchema(255) }) },
    handler: async (ctx): Promise<OrganizationBySlugResponse['data']> => {
      const organization = await ctx.services.organization.getBySlug(
        ctx.input.params.slug
      );

      if (!organization) {
        throw new NotFoundError('Organization not found', {
          slug: ctx.input.params.slug,
        });
      }

      return organization;
    },
  })
);

/**
 * GET /api/organizations/:id
 * Get organization by ID
 *
 * Returns: Organization (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {OrganizationResponse}
 */
app.get(
  '/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    handler: async (ctx): Promise<OrganizationResponse['data']> => {
      const organization = await ctx.services.organization.get(
        ctx.input.params.id
      );

      if (!organization) {
        throw new NotFoundError('Organization not found', {
          organizationId: ctx.input.params.id,
        });
      }

      return organization;
    },
  })
);

/**
 * PATCH /api/organizations/:id
 * Update organization
 *
 * Body: UpdateOrganizationInput
 * Returns: Organization (200)
 * Security: Requires owner/admin role in the organization, API rate limit (100 req/min)
 * @returns {UpdateOrganizationResponse}
 */
app.patch(
  '/:id',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema }),
      body: updateOrganizationSchema,
    },
    handler: async (ctx): Promise<UpdateOrganizationResponse['data']> => {
      return await ctx.services.organization.update(
        ctx.input.params.id,
        ctx.input.body
      );
    },
  })
);

/**
 * GET /api/organizations
 * List organizations with filters
 *
 * Query params: search, sortBy, sortOrder, page, limit
 * Returns: PaginatedResponse<Organization> (200)
 * Security: Authenticated users, API rate limit (100 req/min)
 * @returns {OrganizationListResponse}
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { query: organizationQuerySchema },
    handler: async (ctx): Promise<OrganizationListResponse> => {
      const { search, sortBy, sortOrder, page, limit } = ctx.input.query;

      return await ctx.services.organization.list(
        { search, sortBy, sortOrder },
        { page, limit }
      );
    },
  })
);

/**
 * DELETE /api/organizations/:id
 * Soft delete organization
 *
 * Returns: Success message (200)
 * Security: Requires owner/admin role in the organization, Strict rate limit (5 req/15min)
 * @returns {DeleteOrganizationResponse}
 */
app.delete(
  '/:id',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'auth', // Stricter rate limit for deletion
    },
    input: { params: z.object({ id: uuidSchema }) },
    handler: async (ctx): Promise<DeleteOrganizationResponse> => {
      await ctx.services.organization.delete(ctx.input.params.id);
      return {
        success: true,
        message: 'Organization deleted successfully',
      };
    },
  })
);

export default app;
