/**
 * Organization Management Endpoints
 *
 * RESTful API for managing organizations.
 * All routes require authentication (except public branding and members endpoints).
 *
 * Endpoints:
 * - POST   /api/organizations           - Create organization
 * - GET    /api/organizations/:id       - Get by ID
 * - GET    /api/organizations/slug/:slug - Get by slug
 * - GET    /api/organizations/public/:slug - Get public branding (no auth)
 * - GET    /api/organizations/public/:slug/creators - Get public creators (no auth)
 * - GET    /api/organizations/public/:slug/members - Get public members (no auth)
 * - PATCH  /api/organizations/:id       - Update organization
 * - GET    /api/organizations           - List with filters
 * - DELETE /api/organizations/:id       - Soft delete
 * - GET    /api/organizations/check-slug/:slug - Check slug availability
 */

import { BRAND_COLORS } from '@codex/constants';
import { createDbClient } from '@codex/database';
import type {
  CreateOrganizationResponse,
  OrganizationBySlugResponse,
  OrganizationResponse,
  UpdateOrganizationResponse,
} from '@codex/organization';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@codex/organization';
import { BrandingSettingsService } from '@codex/platform-settings';
import { NotFoundError } from '@codex/service-errors';
import type {
  CheckSlugResponse,
  HonoEnv,
  PublicBrandingResponse,
} from '@codex/shared-types';
import {
  createSlugSchema,
  organizationQuerySchema,
  uuidSchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
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
    policy: { auth: 'required', roles: ['creator', 'admin', 'platform_owner'] },
    input: { body: createOrganizationSchema },
    successStatus: 201,
    handler: async (ctx): Promise<CreateOrganizationResponse['data']> => {
      const org = await ctx.services.organization.create(
        ctx.input.body,
        ctx.user.id
      );

      // Issue 4: Warm cache with default branding for new org
      if (ctx.env.BRAND_KV) {
        ctx.executionCtx.waitUntil(updateBrandCache(ctx.env, org.id, ctx.obs));
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

/**
 * GET /api/organizations/my-organizations
 * Get current user's organizations
 *
 * Returns: Array of organizations with user's role (200)
 * Security: Authenticated users only
 */
app.get(
  '/my-organizations',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.organization.getUserOrganizations(ctx.user.id);
    },
  })
);

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
        secondaryColorHex: branding.secondaryColorHex ?? null,
        accentColorHex: branding.accentColorHex ?? null,
        backgroundColorHex: branding.backgroundColorHex ?? null,
        fontBody: branding.fontBody ?? null,
        fontHeading: branding.fontHeading ?? null,
        radiusValue: branding.radiusValue ?? 0.5,
        densityValue: branding.densityValue ?? 1,
      };
    },
  })
);

/**
 * GET /api/organizations/public/:slug/info
 * Public org info endpoint - no auth required
 *
 * Returns org identity + branding for the org layout (works without cookies).
 */
app.get(
  '/public/:slug/info',
  procedure({
    policy: { auth: 'none' },
    input: { params: z.object({ slug: createSlugSchema(255) }) },
    handler: async (ctx) => {
      const organization = await ctx.services.organization.getBySlug(
        ctx.input.params.slug
      );

      if (!organization) {
        throw new NotFoundError('Organization not found', {
          slug: ctx.input.params.slug,
        });
      }

      // Create a branding service scoped to the found org's ID.
      // Can't use ctx.services.settings — requires requireOrgMembership
      // which isn't available on this public (no-auth) endpoint.
      const brandingDb = createDbClient(ctx.env);
      const brandingSvc = new BrandingSettingsService({
        db: brandingDb,
        environment: ctx.env.ENVIRONMENT ?? 'development',
        organizationId: organization.id,
      });

      let branding: {
        logoUrl: string | null;
        primaryColorHex: string;
        secondaryColorHex: string | null;
        accentColorHex: string | null;
        backgroundColorHex: string | null;
        fontBody: string | null;
        fontHeading: string | null;
        radiusValue: number;
        densityValue: number;
      } = {
        logoUrl: null,
        primaryColorHex: BRAND_COLORS.DEFAULT_BLUE,
        secondaryColorHex: null,
        accentColorHex: null,
        backgroundColorHex: null,
        fontBody: null,
        fontHeading: null,
        radiusValue: 0.5,
        densityValue: 1,
      };
      try {
        const b = await brandingSvc.get();
        branding = {
          logoUrl: b.logoUrl ?? null,
          primaryColorHex: b.primaryColorHex ?? BRAND_COLORS.DEFAULT_BLUE,
          secondaryColorHex: b.secondaryColorHex ?? null,
          accentColorHex: b.accentColorHex ?? null,
          backgroundColorHex: b.backgroundColorHex ?? null,
          fontBody: b.fontBody ?? null,
          fontHeading: b.fontHeading ?? null,
          radiusValue: b.radiusValue ?? 0.5,
          densityValue: b.densityValue ?? 1,
        };
      } catch (err) {
        console.error(
          '[public-info] getBranding failed:',
          err instanceof Error ? err.message : err
        );
      }

      return {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        description: organization.description,
        logoUrl: branding.logoUrl,
        brandColors: {
          primary: branding.primaryColorHex,
          secondary: branding.secondaryColorHex,
          accent: branding.accentColorHex,
          background: branding.backgroundColorHex,
        },
        brandFonts: {
          body: branding.fontBody,
          heading: branding.fontHeading,
        },
        brandRadius: branding.radiusValue,
        brandDensity: branding.densityValue,
      };
    },
  })
);

/**
 * GET /api/organizations/public/:slug/creators
 * Public creators endpoint - no auth required
 *
 * Returns paginated public creator profiles for an organization.
 * Includes name, avatar, role, joinedAt, and published content count.
 * Only active members with owner/admin/creator roles are included.
 * No emails or internal user IDs are exposed.
 *
 * Query Params:
 * - page: Page number (default: 1, min: 1)
 * - limit: Items per page (default: 20, min: 1, max: 100)
 *
 * Returns: PaginatedListResponse<{ name, avatarUrl, role, joinedAt, contentCount }> (200)
 * Security: No auth required, API rate limited
 */
app.get(
  '/public/:slug/creators',
  procedure({
    policy: { auth: 'none', rateLimit: 'api' },
    input: {
      params: z.object({ slug: createSlugSchema(255) }),
      query: z
        .object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
        })
        .optional(),
    },
    handler: async (ctx) => {
      const result = await ctx.services.organization.getPublicCreators(
        ctx.input.params.slug,
        ctx.input.query ?? { page: 1, limit: 20 }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/organizations/public/:slug/members
 * Public members endpoint - no auth required
 *
 * Returns paginated public member profiles for an organization.
 * Includes name, avatar, role, and joinedAt.
 * Only active members are included (all roles: owner, admin, creator, subscriber, member).
 * No emails or internal user IDs are exposed.
 *
 * Query Params:
 * - page: Page number (default: 1, min: 1)
 * - limit: Items per page (default: 20, min: 1, max: 100)
 * - role: Optional filter by role (owner, admin, creator, subscriber, member)
 *
 * Returns: PaginatedListResponse<{ name, avatarUrl, role, joinedAt }> (200)
 * Security: No auth required, API rate limited
 */
app.get(
  '/public/:slug/members',
  procedure({
    policy: { auth: 'none', rateLimit: 'api' },
    input: {
      params: z.object({ slug: createSlugSchema(255) }),
      query: z
        .object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
          role: z
            .enum(['owner', 'admin', 'creator', 'subscriber', 'member'])
            .optional(),
        })
        .optional(),
    },
    handler: async (ctx) => {
      const result = await ctx.services.organization.getPublicMembers(
        ctx.input.params.slug,
        ctx.input.query ?? { page: 1, limit: 20 }
      );
      return new PaginatedResult(result.items, result.pagination);
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
        ctx.executionCtx.waitUntil(
          updateBrandCache(ctx.env, updated.id, ctx.obs)
        );
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
    handler: async (ctx) => {
      const { search, sortBy, sortOrder, page, limit } = ctx.input.query;

      const result = await ctx.services.organization.list(
        { search, sortBy, sortOrder },
        { page, limit }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * DELETE /api/organizations/:id
 * Soft delete organization
 *
 * Returns: 204 No Content
 * Security: Requires owner/admin role in the organization, Strict rate limit (5 req/15min)
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
    successStatus: 204,
    handler: async (ctx) => {
      // Get org slug for cache invalidation before deletion
      const org = await ctx.services.organization.get(ctx.input.params.id);

      await ctx.services.organization.delete(ctx.input.params.id);

      // Invalidate brand cache if exists
      if (org && ctx.env.BRAND_KV) {
        ctx.executionCtx.waitUntil(
          ctx.env.BRAND_KV.delete(`brand:${org.slug}`)
        );
      }

      return null;
    },
  })
);

export default app;
