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
  obs?: Logger
): Promise<void> {
  if (!ctx.env.CACHE_KV) return;

  // 1. Synchronous: invalidate the slug-keyed public info cache.
  //    This is the cache that `/public/:slug/info` reads on reload.
  //    R14 (denoise iter-011): use shared `invalidateOrgSlugCache` helper
  //    instead of inlining the slug-resolve + invalidate block.
  const db = createDbClient(ctx.env);
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
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
