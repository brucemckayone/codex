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

import { CacheType, VersionedCache } from '@codex/cache';
import { BRAND_COLORS, CACHE_TTL } from '@codex/constants';
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
import {
  BrandingSettingsService,
  FeatureSettingsService,
} from '@codex/platform-settings';
import { NotFoundError } from '@codex/service-errors';
import type {
  Bindings,
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
      // Use fetchPublicOrgInfo — ctx.services.settings requires org context
      // which is unavailable on public (no-auth) endpoints
      const info = await fetchPublicOrgInfo(ctx, ctx.input.params.slug);

      return {
        logoUrl: info.logoUrl ?? null,
        primaryColorHex: info.brandColors.primary ?? BRAND_COLORS.DEFAULT_BLUE,
        secondaryColorHex: info.brandColors.secondary ?? null,
        accentColorHex: info.brandColors.accent ?? null,
        backgroundColorHex: info.brandColors.background ?? null,
        fontBody: info.brandFonts.body ?? null,
        fontHeading: info.brandFonts.heading ?? null,
        radiusValue: info.brandRadius ?? 0.5,
        densityValue: info.brandDensity ?? 1,
        introVideoUrl: info.introVideoUrl ?? null,
        heroLayout: info.heroLayout ?? 'default',
      };
    },
  })
);

/**
 * Fetch public org identity + branding from DB.
 * Extracted so VersionedCache can use it as a fetcher on cache miss,
 * and it can be called directly when CACHE_KV is unavailable.
 */
async function fetchPublicOrgInfo(
  ctx: {
    services: {
      organization: {
        getBySlug(slug: string): Promise<{
          id: string;
          slug: string;
          name: string;
          description: string | null;
        } | null>;
      };
    };
    env: Bindings;
  },
  slug: string
) {
  const organization = await ctx.services.organization.getBySlug(slug);

  if (!organization) {
    throw new NotFoundError('Organization not found', { slug });
  }

  // Fetch branding + features in parallel (both need org.id, but are independent).
  // Can't use ctx.services.settings — requires requireOrgMembership
  // which isn't available on this public (no-auth) endpoint.
  const brandingDb = createDbClient(ctx.env);
  const brandingSvc = new BrandingSettingsService({
    db: brandingDb,
    environment: ctx.env.ENVIRONMENT ?? 'development',
    organizationId: organization.id,
  });
  const featureDb = createDbClient(ctx.env);
  const featureSvc = new FeatureSettingsService({
    db: featureDb,
    environment: ctx.env.ENVIRONMENT ?? 'development',
    organizationId: organization.id,
  });

  const [brandingResult, featuresResult] = await Promise.allSettled([
    brandingSvc.get(),
    featureSvc.get(),
  ]);

  type BrandingInfo = {
    logoUrl: string | null;
    primaryColorHex: string;
    secondaryColorHex: string | null;
    accentColorHex: string | null;
    backgroundColorHex: string | null;
    fontBody: string | null;
    fontHeading: string | null;
    radiusValue: number;
    densityValue: number;
    introVideoUrl: string | null;
    tokenOverrides: string | null;
    darkModeOverrides: string | null;
    shadowScale: string | null;
    shadowColor: string | null;
    textScale: string | null;
    headingWeight: string | null;
    bodyWeight: string | null;
    heroLayout: string;
  };

  const brandingDefaults: BrandingInfo = {
    logoUrl: null,
    primaryColorHex: BRAND_COLORS.DEFAULT_BLUE,
    secondaryColorHex: null,
    accentColorHex: null,
    backgroundColorHex: null,
    fontBody: null,
    fontHeading: null,
    radiusValue: 0.5,
    densityValue: 1,
    introVideoUrl: null,
    tokenOverrides: null,
    darkModeOverrides: null,
    shadowScale: null,
    shadowColor: null,
    textScale: null,
    headingWeight: null,
    bodyWeight: null,
    heroLayout: 'default',
  };

  let branding: BrandingInfo = brandingDefaults;
  if (brandingResult.status === 'fulfilled') {
    const b = brandingResult.value;
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
      introVideoUrl: b.introVideoUrl ?? null,
      tokenOverrides: b.tokenOverrides ?? null,
      darkModeOverrides: b.darkModeOverrides ?? null,
      shadowScale: b.shadowScale ?? null,
      shadowColor: b.shadowColor ?? null,
      textScale: b.textScale ?? null,
      headingWeight: b.headingWeight ?? null,
      bodyWeight: b.bodyWeight ?? null,
      heroLayout: b.heroLayout ?? 'default',
    };
  }

  // Non-critical — defaults to true so subscriptions aren't hidden on fetch failure.
  const enableSubscriptions =
    featuresResult.status === 'fulfilled'
      ? featuresResult.value.enableSubscriptions
      : true;

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
    introVideoUrl: branding.introVideoUrl,
    heroLayout: branding.heroLayout,
    brandFineTune: {
      tokenOverrides: branding.tokenOverrides,
      darkModeOverrides: branding.darkModeOverrides,
      shadowScale: branding.shadowScale,
      shadowColor: branding.shadowColor,
      textScale: branding.textScale,
      headingWeight: branding.headingWeight,
      bodyWeight: branding.bodyWeight,
    },
    enableSubscriptions,
  };
}

/**
 * GET /api/organizations/public/:slug/info
 * Public org info endpoint - no auth required
 *
 * Returns org identity + branding for the org layout (works without cookies).
 * Cached in KV for 30 minutes; invalidated on branding/settings updates.
 */
app.get(
  '/public/:slug/info',
  procedure({
    policy: { auth: 'none' },
    input: { params: z.object({ slug: createSlugSchema(255) }) },
    handler: async (ctx) => {
      const slug = ctx.input.params.slug;

      // Use VersionedCache for KV caching (30 min TTL).
      // The cache key is the org slug — we don't know the orgId yet.
      // The fetcher resolves slug → org + branding from DB on cache miss.
      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        return cache.get(
          slug,
          CacheType.ORG_CONFIG,
          () => fetchPublicOrgInfo(ctx, slug),
          { ttl: CACHE_TTL.ORG_PUBLIC_INFO_SECONDS }
        );
      }

      // Fallback when CACHE_KV is not bound (shouldn't happen in production)
      return fetchPublicOrgInfo(ctx, slug);
    },
  })
);

/**
 * GET /api/organizations/public/:slug/stats
 * Public organization statistics - no auth required
 *
 * Returns aggregate statistics for an organization:
 * - Content counts by type (video, audio, written)
 * - Total duration in seconds (from linked media items)
 * - Active creator count
 * - Total views across all published content
 *
 * Designed for hero section display — lightweight, cacheable.
 *
 * Returns: OrganizationPublicStatsResponse (200)
 * Security: No auth required, API rate limited
 */
app.get(
  '/public/:slug/stats',
  procedure({
    policy: { auth: 'none', rateLimit: 'api' },
    input: { params: z.object({ slug: createSlugSchema(255) }) },
    handler: async (ctx) => {
      const slug = ctx.input.params.slug;

      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        return cache.get(
          slug,
          CacheType.ORG_STATS,
          () => ctx.services.organization.getPublicStats(slug),
          { ttl: CACHE_TTL.ORG_PUBLIC_INFO_SECONDS }
        );
      }

      return ctx.services.organization.getPublicStats(slug);
    },
  })
);

/**
 * GET /api/organizations/public/:slug/creators
 * Public creators endpoint - no auth required
 *
 * Returns paginated public creator profiles for an organization.
 * Includes name, username, avatar, bio, social links, role, joinedAt,
 * published content count, and the latest published content item.
 * Only active members with owner/admin/creator roles are included.
 * No emails or internal user IDs are exposed.
 *
 * Query Params:
 * - page: Page number (default: 1, min: 1)
 * - limit: Items per page (default: 20, min: 1, max: 100)
 *
 * Returns: PaginatedListResponse<{ name, username, avatarUrl, bio, socialLinks, role, joinedAt, contentCount, latestContent }> (200)
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
      const slug = ctx.input.params.slug;
      const { page, limit } = ctx.input.query ?? { page: 1, limit: 20 };

      const fetcher = () =>
        ctx.services.organization.getPublicCreators(slug, { page, limit });

      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        const result = await cache.get(
          slug,
          `${CacheType.ORG_CREATORS}:${page}:${limit}`,
          fetcher,
          { ttl: CACHE_TTL.ORG_PUBLIC_INFO_SECONDS }
        );
        return new PaginatedResult(result.items, result.pagination);
      }

      const result = await fetcher();
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

      // Invalidate VersionedCache for public org info (keyed by slug)
      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        const invalidations: Promise<void>[] = [cache.invalidate(updated.slug)];
        // If slug changed, also invalidate the old slug's cache
        if (oldSlug && updated.slug !== oldSlug) {
          invalidations.push(cache.invalidate(oldSlug));
        }
        ctx.executionCtx.waitUntil(Promise.all(invalidations).catch(() => {}));
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
      rateLimit: 'strict', // 20/min for destructive operations
    },
    input: { params: z.object({ id: uuidSchema }) },
    successStatus: 204,
    handler: async (ctx) => {
      // Get org slug for cache invalidation before deletion
      const org = await ctx.services.organization.get(ctx.input.params.id);

      await ctx.services.organization.delete(ctx.input.params.id);

      // Invalidate brand cache and slug-keyed VersionedCache
      if (org) {
        const invalidations: Promise<unknown>[] = [];
        if (ctx.env.BRAND_KV) {
          invalidations.push(ctx.env.BRAND_KV.delete(`brand:${org.slug}`));
        }
        if (ctx.env.CACHE_KV) {
          const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
          invalidations.push(cache.invalidate(org.slug));
        }
        if (invalidations.length > 0) {
          ctx.executionCtx.waitUntil(
            Promise.all(invalidations).catch(() => {})
          );
        }
      }

      return null;
    },
  })
);

export default app;
