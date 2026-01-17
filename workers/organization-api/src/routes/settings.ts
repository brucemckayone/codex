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

import { createDbClient, eq, schema } from '@codex/database';
import type { Bindings, HonoEnv } from '@codex/shared-types';
import {
  ALLOWED_LOGO_MIME_TYPES,
  type AllSettingsResponse,
  type BrandingSettingsResponse,
  type ContactSettingsResponse,
  type FeatureSettingsResponse,
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
 * Update the branding cache in KV
 * Used to ensure zero-latency branding on the edge
 */
async function updateBrandCache(
  kv: Bindings['BRAND_KV'],
  slug: string,
  branding: BrandingSettingsResponse
): Promise<void> {
  if (!kv) return;
  try {
    const cacheData = {
      updatedAt: new Date().toISOString(),
      branding,
    };
    // 7 days TTL
    await kv.put(`brand:${slug}`, JSON.stringify(cacheData), {
      expirationTtl: 604800,
    });
  } catch (err) {
    console.warn(`Failed to update brand cache for ${slug}:`, err);
  }
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

      // Invalidate cache - Optimized: fetch only slug
      const db = createDbClient(ctx.env);
      const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.id, ctx.input.params.id),
        columns: { slug: true },
      });

      if (org) {
        ctx.executionCtx.waitUntil(
          updateBrandCache(ctx.env.BRAND_KV, org.slug, result)
        );
      }

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

      // Invalidate cache
      const org = await ctx.services.organization.get(ctx.input.params.id);
      if (org) {
        ctx.executionCtx.waitUntil(
          updateBrandCache(ctx.env.BRAND_KV, org.slug, result)
        );
      }

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
        throw new Error('Logo operations not configured');
      }
      const result = await ctx.services.settings.deleteLogo();

      // Invalidate cache - Optimized lookup
      const db = createDbClient(ctx.env);
      const organizationId = ctx.input.params.id; // Define organizationId from ctx.input.params.id
      const branding = result; // Define branding from the result of deleteLogo()
      const org = await db.query.organizations.findFirst({
        where: eq(schema.organizations.id, organizationId),
        columns: { slug: true },
      });

      if (org) {
        ctx.executionCtx.waitUntil(
          updateBrandCache(ctx.env.BRAND_KV, org.slug, branding)
        );
      }

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
      return await ctx.services.settings.updateContact(ctx.input.body);
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
      return await ctx.services.settings.updateFeatures(ctx.input.body);
    },
  })
);

export default app;
