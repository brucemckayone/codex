/**
 * Organization Management Endpoints
 *
 * RESTful API for managing organizations.
 * All routes require authentication (except public branding endpoint).
 *
 * Endpoints:
 * - POST   /api/organizations           - Create organization
 * - GET    /api/organizations/:id       - Get by ID
 * - GET    /api/organizations/slug/:slug - Get by slug
 * - GET    /api/organizations/public/:slug - Get public branding (no auth)
 * - PATCH  /api/organizations/:id       - Update organization
 * - GET    /api/organizations           - List with filters
 * - DELETE /api/organizations/:id       - Soft delete
 * - GET    /api/organizations/check-slug/:slug - Check slug availability
 */

import { BRAND_COLORS } from '@codex/constants';
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
import { updateBrandCache } from './settings';

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
      const org = await ctx.services.organization.create(ctx.input.body);

      // Issue 4: Warm cache with default branding for new org
      if (ctx.env.BRAND_KV) {
        ctx.executionCtx.waitUntil(updateBrandCache(ctx.env, org.id));
      }

      return org;
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

/** Response type for public branding endpoint */
interface PublicBrandingResponse {
  logoUrl: string | null;
  primaryColorHex: string;
}

/**
 * GET /api/organizations/public/:slug
 * Public branding endpoint - no auth required
 *
 * Returns only public branding fields: { logoUrl, primaryColorHex }
 * Returns: PublicBrandingResponse (200)
 * Security: No auth required, rate limited
 * @returns {PublicBrandingResponse}
 */
app.get(
  '/public/:slug',
  procedure({
    policy: { auth: 'none' },
    input: { params: z.object({ slug: createSlugSchema(255) }) },
    handler: async (ctx): Promise<PublicBrandingResponse> => {
      const organization = await ctx.services.organization.getBySlug(
        ctx.input.params.slug
      );

      if (!organization) {
        throw new NotFoundError('Organization not found', {
          slug: ctx.input.params.slug,
        });
      }

      // Get branding from platform settings service
      const branding = await ctx.services.settings.getBranding();

      return {
        logoUrl: branding.logoUrl ?? null,
        primaryColorHex: branding.primaryColorHex ?? BRAND_COLORS.DEFAULT_BLUE,
      };
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
      // Get org before update to detect slug change for cache invalidation
      const existingOrg = await ctx.services.organization.get(
        ctx.input.params.id
      );
      const oldSlug = existingOrg?.slug;

      const updated = await ctx.services.organization.update(
        ctx.input.params.id,
        ctx.input.body
      );

      // Handle slug change: invalidate old cache, new cache warmed on first access
      // FIX: Warm new cache immediately using updateBrandCache
      if (ctx.env.BRAND_KV) {
        if (oldSlug && updated.slug !== oldSlug) {
          ctx.executionCtx.waitUntil(
            ctx.env.BRAND_KV.delete(`brand:${oldSlug}`)
          );
        }
        // Always refresh cache on update (in case slug changed OR other relevant fields)
        ctx.executionCtx.waitUntil(updateBrandCache(ctx.env, updated.id));
      }

      return updated;
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
      // Get org slug for cache invalidation before deletion
      const org = await ctx.services.organization.get(ctx.input.params.id);

      await ctx.services.organization.delete(ctx.input.params.id);

      // Invalidate brand cache if exists
      if (org && ctx.env.BRAND_KV) {
        ctx.executionCtx.waitUntil(
          ctx.env.BRAND_KV.delete(`brand:${org.slug}`)
        );
      }

      return {
        success: true,
        message: 'Organization deleted successfully',
      };
    },
  })
);

export default app;
