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
import { createDbClient } from '@codex/database';

import type { ObservabilityClient } from '@codex/observability';
import { InternalServiceError } from '@codex/service-errors';
import type {
  AllSettingsResponse,
  Bindings,
  BrandingSettingsResponse,
  ContactSettingsResponse,
  FeatureSettingsResponse,
  HonoEnv,
  StudioIntroFilm,
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
import {
  invalidateOrgSlugCache,
  multipartProcedure,
  procedure,
} from '@codex/worker-utils';

import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Invalidate the slug-keyed public info cache (read by `/public/:slug/info`)
 * and bump the org-id version key for client staleness detection.
 *
 * Codex-ja9zp: the SLUG-keyed CACHE_KV invalidation runs INLINE (awaited)
 * because that is the key the org layout reads via `/public/:slug/info`.
 * If it stayed in waitUntil, a user reloading fast enough after save would
 * hit the stale pre-save cached branding (the race that made font/color
 * changes appear to "not persist"). The orgId-keyed version bump stays
 * fire-and-forget via waitUntil — clients detect staleness via polling.
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
  obs?: ObservabilityClient
): Promise<void> {
  if (!ctx.env.CACHE_KV) return;

  // 1. Synchronous: invalidate the slug-keyed public info cache.
  //    This is the cache that `/public/:slug/info` reads on reload.
  //    R14 (denoise iter-011): use shared `invalidateOrgSlugCache` helper
  //    instead of inlining the slug-resolve + invalidate block.
  const db = createDbClient(ctx.env);
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV,
    waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
    // The cache logs a failed invalidation only through its own obs.
    obs,
  });
  await invalidateOrgSlugCache({ db, cache, orgId, logger: obs });

  // 2. Fire-and-forget: bump orgId-keyed version for client staleness polling.
  ctx.executionCtx.waitUntil(
    cache.invalidate(orgId).catch((err: unknown) => {
      obs?.warn(`Background CACHE_KV invalidate failed for org ${orgId}`, {
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
 * Link a media item as the org's intro film (Codex-376dl): one of the
 * caller's own finished videos, picked in the brand studio.
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
 * GET /api/organizations/:id/settings/branding/intro-video
 * The intro film as the brand studio shows it: what was picked and which
 * version visitors get (the whole film, its 30-second preview, or none, with
 * why). Null when no film is picked. Read through the access service, by the
 * same check the landing's minter runs, so the two never disagree.
 */
app.get(
  '/branding/intro-video',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<StudioIntroFilm | null> =>
      ctx.services.access.getStudioIntroFilm(ctx.input.params.id),
  })
);

/**
 * DELETE /api/organizations/:id/settings/branding/intro-video
 * Take the intro film off the landing page. The media item stays in the
 * creator's library: it may be used by content too.
 */
app.delete(
  '/branding/intro-video',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { params: orgIdParamSchema },
    handler: async (ctx): Promise<BrandingSettingsResponse> => {
      const result = await ctx.services.settings.unlinkIntroVideo();

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
        const cache = new VersionedCache({
          kv: ctx.env.CACHE_KV,
          waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
        });
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
        const cache = new VersionedCache({
          kv: ctx.env.CACHE_KV,
          waitUntil: (promise) => ctx.executionCtx.waitUntil(promise),
        });
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
