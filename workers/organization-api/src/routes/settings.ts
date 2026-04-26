/**
 * Organization Settings Endpoints
 *
 * RESTful API for managing organization platform settings.
 * All routes require organization management permissions.
 *
 * Endpoints:
 * - GET    /api/organizations/:id/settings              - Get all settings
 * - GET    /api/organizations/:id/settings/branding     - Get branding settings
 * - PUT    /api/organizations/:id/settings/branding     - Update branding settings
 * - POST   /api/organizations/:id/settings/branding/logo - Upload logo
 * - DELETE /api/organizations/:id/settings/branding/logo - Delete logo
 * - GET    /api/organizations/:id/settings/contact      - Get contact settings
 * - PUT    /api/organizations/:id/settings/contact      - Update contact settings
 * - GET    /api/organizations/:id/settings/features     - Get feature settings
 * - PUT    /api/organizations/:id/settings/features     - Update feature settings
 */

import { VersionedCache, type WaitUntilFn } from '@codex/cache';
import { BRAND_COLORS, CACHE_TTL } from '@codex/constants';
import { createDbClient, eq, schema } from '@codex/database';

type BrandingRow = typeof schema.brandingSettings.$inferSelect;

import type { Logger } from '@codex/observability';
import { InternalServiceError } from '@codex/service-errors';
import type {
  AllSettingsResponse,
  Bindings,
  BrandingSettingsResponse,
  ContactSettingsResponse,
  FeatureSettingsResponse,
  HonoEnv,
} from '@codex/shared-types';
import {
  ALLOWED_LOGO_MIME_TYPES,
  linkIntroVideoSchema,
  MAX_LOGO_FILE_SIZE_BYTES,
  updateBrandingSchema,
  updateContactSchema,
  updateFeaturesSchema,
  uuidSchema,
} from '@codex/validation';
import { multipartProcedure, procedure } from '@codex/worker-utils';

import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Update the branding cache in KV with fresh data from DB
 *
 * FIXES:
 * 1. Race conditions: Always fetches latest state from DB
 * 2. Performance: runs in background (waitUntil), removing DB fetch from request path
 * 3. Error reporting: Logs errors properly
 */
/**
 * Pure branding-response builder. Prefers `branding` fields, falls back to
 * `orgLogoUrl` for logo, then to null / sensible defaults for everything
 * else. Keeping this pure makes `updateBrandCache` straight-line code.
 */
function buildBrandingResponse(
  branding: BrandingRow | null | undefined,
  orgLogoUrl: string | null
): BrandingSettingsResponse {
  return {
    logoUrl: branding?.logoUrl ?? orgLogoUrl ?? null,
    primaryColorHex: branding?.primaryColorHex ?? BRAND_COLORS.DEFAULT_BLUE,
    secondaryColorHex: branding?.secondaryColorHex ?? null,
    accentColorHex: branding?.accentColorHex ?? null,
    backgroundColorHex: branding?.backgroundColorHex ?? null,
    fontBody: branding?.fontBody ?? null,
    fontHeading: branding?.fontHeading ?? null,
    radiusValue: Number(branding?.radiusValue ?? 0.5),
    densityValue: Number(branding?.densityValue ?? 1),
    introVideoMediaItemId: branding?.introVideoMediaItemId ?? null,
    introVideoUrl: branding?.introVideoUrl ?? null,
    tokenOverrides: branding?.tokenOverrides ?? null,
    darkModeOverrides: branding?.darkModeOverrides ?? null,
    textColorHex: branding?.textColorHex ?? null,
    shadowScale: branding?.shadowScale ?? null,
    shadowColor: branding?.shadowColor ?? null,
    textScale: branding?.textScale ?? null,
    headingWeight: branding?.headingWeight ?? null,
    bodyWeight: branding?.bodyWeight ?? null,
    heroLayout: branding?.heroLayout ?? 'default',
    pricingFaq: branding?.pricingFaq ?? null,
  };
}

export async function updateBrandCache(
  env: Bindings,
  organizationId: string,
  obs?: Logger
): Promise<void> {
  const kv = env.BRAND_KV;
  if (!kv) return;

  try {
    const db = createDbClient(env);

    // Try to fetch settings with branding and organization info
    // We query platformSettings because it has relations to both branding and organization
    const settings = await db.query.platformSettings.findFirst({
      where: eq(schema.platformSettings.organizationId, organizationId),
      with: {
        branding: true,
        organization: {
          columns: { slug: true, logoUrl: true },
        },
      },
    });

    let slug: string;
    let branding: BrandingSettingsResponse;

    if (settings?.organization) {
      slug = settings.organization.slug;
      branding = buildBrandingResponse(
        settings.branding,
        settings.organization.logoUrl
      );
    } else {
      // Fallback: Settings not created yet, fetch org directly
      const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.id, organizationId),
        columns: {
          slug: true,
          logoUrl: true,
        },
      });

      if (!org) {
        obs?.warn(`Skip update - Org not found: ${organizationId}`, {
          organizationId,
        });
        return;
      }

      slug = org.slug;
      branding = buildBrandingResponse(null, org.logoUrl);
    }

    const cacheData = {
      updatedAt: new Date().toISOString(),
      branding,
    };

    await kv.put(`brand:${slug}`, JSON.stringify(cacheData), {
      expirationTtl: CACHE_TTL.BRAND_CACHE_SECONDS,
    });
  } catch (err) {
    obs?.error?.(`Failed to update cache for org ${organizationId}`, {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Invalidate brand cache and bump org version for client staleness detection.
 * Also invalidates the slug-keyed VersionedCache for the public org info endpoint.
 * Extracts duplicated cache invalidation logic used by branding mutation handlers.
 *
 * Codex-ja9zp: the SLUG-keyed CACHE_KV invalidation runs INLINE (awaited)
 * because that is the key the org layout reads via `/public/:slug/info`.
 * If it stayed in waitUntil, a user reloading fast enough after save would
 * hit the stale pre-save cached branding (the race that made font/color
 * changes appear to "not persist"). BRAND_KV warm + orgId-version bump
 * stay fire-and-forget via waitUntil — they are belt-and-suspenders for
 * other consumers and not on the reload-critical path.
 *
 * Caller contract: awaited. Every call site is inside an async procedure
 * handler, so `await invalidateBrandAndCache(...)` blocks the response
 * by ~5–50ms (one DB lookup + one KV write). Acceptable for correctness.
 */
async function invalidateBrandAndCache(
  ctx: {
    env: Bindings;
    executionCtx: { waitUntil: WaitUntilFn };
  },
  orgId: string,
  obs?: Logger
): Promise<void> {
  // 1. Synchronous: invalidate the slug-keyed public info cache.
  //    This is the cache that `/public/:slug/info` reads on reload.
  if (ctx.env.CACHE_KV) {
    try {
      const db = createDbClient(ctx.env);
      const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.id, orgId),
        columns: { slug: true },
      });
      if (org?.slug) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        await cache.invalidate(org.slug);
      }
    } catch {
      // Non-critical — slug cache expires via TTL if the await path fails.
    }
  }

  // 2. Fire-and-forget: warm BRAND_KV + bump orgId version.
  //    These are not on the reload-critical path; clients that care about
  //    the orgId-keyed version detect staleness via client-side polling.
  //
  //    Each task gets its own `.catch()` so a KV reject on cache.invalidate
  //    can't cancel the BRAND_KV warm. updateBrandCache is internally
  //    try/caught, so `.catch()` here is belt-and-suspenders.
  const tasks: Promise<unknown>[] = [
    updateBrandCache(ctx.env, orgId, obs).catch((err: unknown) => {
      obs?.warn(`Background BRAND_KV warm failed for org ${orgId}`, {
        orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
  ];
  if (ctx.env.CACHE_KV) {
    const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
    tasks.push(
      cache.invalidate(orgId).catch((err: unknown) => {
        obs?.warn(`Background CACHE_KV invalidate failed for org ${orgId}`, {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }
  // Per-task `.catch()` above prevents Promise.all from rejecting; the
  // wrapper `.catch()` is belt-and-suspenders for the workers:
  // waitUntil-no-catch contract (and surfaces a final-fallback warn).
  ctx.executionCtx.waitUntil(
    Promise.all(tasks).catch((err: unknown) => {
      obs?.warn(`Background brand/version tasks failed for org ${orgId}`, {
        orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
  );
}

const app = new Hono<HonoEnv>();

// Param schema for org ID validation
const orgIdParamSchema = z.object({ id: uuidSchema });

// ============================================================================
// GET /api/organizations/:id/settings - Get all settings
// ============================================================================

app.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<AllSettingsResponse> => {
      return await ctx.services.settings.getAllSettings();
    },
  })
);

// ============================================================================
// Branding Settings Endpoints
// ============================================================================

/**
 * GET /api/organizations/:id/settings/branding
 * Get branding settings (logo URL, primary color)
 */
app.get(
  '/branding',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<BrandingSettingsResponse> => {
      return await ctx.services.settings.getBranding();
    },
  })
);

/**
 * PUT /api/organizations/:id/settings/branding
 * Update branding settings (primary color only - use POST /logo for logo)
 */
app.put(
  '/branding',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: orgIdParamSchema,
      body: updateBrandingSchema,
    },
    handler: async (ctx): Promise<BrandingSettingsResponse> => {
      const result = await ctx.services.settings.updateBranding(ctx.input.body);

      await invalidateBrandAndCache(ctx, ctx.input.params.id, ctx.obs);

      return result;
    },
  })
);

/**
 * POST /api/organizations/:id/settings/branding/logo
 * Upload a new logo (multipart form data)
 *
 * NOTE: This endpoint uses manual handling instead of procedure() because:
 * - Multipart form-data requires access to raw Request.formData()
 * - File objects cannot be validated with Zod schemas
 * - File validation (MIME type, size, magic numbers) happens after parsing
 * We still use mapErrorToResponse() for consistent error handling.
 *
 * Request body: multipart/form-data with 'logo' file field
 * Allowed types: image/png, image/jpeg, image/webp
 * Max size: 5MB
 */

app.post(
  '/branding/logo',
  multipartProcedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    files: {
      logo: {
        required: true,
        maxSize: MAX_LOGO_FILE_SIZE_BYTES,
        allowedMimeTypes: ALLOWED_LOGO_MIME_TYPES,
      },
    },
    handler: async (ctx) => {
      // Create facade with org context for upload
      // Note: We're dynamically importing to avoid loading heavy dependencies for other routes
      // But for cleaner code with procedure(), we could trust the service registry
      // However, PlatformSettingsFacade is not in standard registry yet?
      // Actually ctx.services.settings IS PlatformSettingsFacade.

      const logoFile = ctx.files.logo; // Typed as ValidatedFile

      const result = await ctx.services.settings.uploadLogo({
        buffer: logoFile.buffer,
        mimeType: logoFile.type,
        size: logoFile.size,
      });

      await invalidateBrandAndCache(ctx, ctx.input.params.id, ctx.obs);

      return result;
    },
  })
);

/**
 * DELETE /api/organizations/:id/settings/branding/logo
 * Delete the current logo
 */
app.delete(
  '/branding/logo',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<BrandingSettingsResponse> => {
      // Check if R2 bucket is configured
      if (!ctx.env.MEDIA_BUCKET) {
        throw new InternalServiceError('Logo operations not configured');
      }
      const result = await ctx.services.settings.deleteLogo();

      await invalidateBrandAndCache(ctx, ctx.input.params.id, ctx.obs);

      return result;
    },
  })
);

// ============================================================================
// Intro Video Endpoints
// ============================================================================

/**
 * POST /api/organizations/:id/settings/branding/intro-video
 * Link a media item as the org's intro video.
 * The media item is created via content-api (presigned upload flow).
 */
app.post(
  '/branding/intro-video',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: orgIdParamSchema,
      body: linkIntroVideoSchema,
    },
    handler: async (ctx): Promise<BrandingSettingsResponse> => {
      const result = await ctx.services.settings.linkIntroVideo(
        ctx.input.body.mediaItemId,
        ctx.user.id
      );

      await invalidateBrandAndCache(ctx, ctx.input.params.id, ctx.obs);

      return result;
    },
  })
);

/**
 * GET /api/organizations/:id/settings/branding/intro-video/status
 * Poll intro video transcoding status. Auto-finalizes URL when ready.
 */
app.get(
  '/branding/intro-video/status',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx) => {
      return await ctx.services.settings.getIntroVideoStatus();
    },
  })
);

/**
 * DELETE /api/organizations/:id/settings/branding/intro-video
 * Remove the intro video. Soft-deletes the media item.
 */
app.delete(
  '/branding/intro-video',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<BrandingSettingsResponse> => {
      const result = await ctx.services.settings.deleteIntroVideo();

      await invalidateBrandAndCache(ctx, ctx.input.params.id, ctx.obs);

      return result;
    },
  })
);

// ============================================================================
// Contact Settings Endpoints
// ============================================================================

/**
 * GET /api/organizations/:id/settings/contact
 * Get contact settings (platform name, support email, contact URL, timezone)
 */
app.get(
  '/contact',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<ContactSettingsResponse> => {
      return await ctx.services.settings.getContact();
    },
  })
);

/**
 * PUT /api/organizations/:id/settings/contact
 * Update contact settings
 */
app.put(
  '/contact',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: orgIdParamSchema,
      body: updateContactSchema,
    },
    handler: async (ctx): Promise<ContactSettingsResponse> => {
      const result = await ctx.services.settings.updateContact(ctx.input.body);

      // Bump org version for client staleness detection
      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        const orgId = ctx.input.params.id;
        ctx.executionCtx.waitUntil(
          cache.invalidate(orgId).catch((err: unknown) => {
            ctx.obs?.warn(`Failed to invalidate org cache after PUT /contact`, {
              orgId,
              error: err instanceof Error ? err.message : String(err),
            });
          })
        );
      }

      return result;
    },
  })
);

// ============================================================================
// Feature Settings Endpoints
// ============================================================================

/**
 * GET /api/organizations/:id/settings/features
 * Get feature settings (enable signups, enable purchases)
 */
app.get(
  '/features',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<FeatureSettingsResponse> => {
      return await ctx.services.settings.getFeatures();
    },
  })
);

/**
 * PUT /api/organizations/:id/settings/features
 * Update feature settings
 */
app.put(
  '/features',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: orgIdParamSchema,
      body: updateFeaturesSchema,
    },
    handler: async (ctx): Promise<FeatureSettingsResponse> => {
      const result = await ctx.services.settings.updateFeatures(ctx.input.body);

      // Bump org version for client staleness detection
      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        const orgId = ctx.input.params.id;
        ctx.executionCtx.waitUntil(
          cache.invalidate(orgId).catch((err: unknown) => {
            ctx.obs?.warn(
              `Failed to invalidate org cache after PUT /features`,
              {
                orgId,
                error: err instanceof Error ? err.message : String(err),
              }
            );
          })
        );
      }

      return result;
    },
  })
);

export default app;
