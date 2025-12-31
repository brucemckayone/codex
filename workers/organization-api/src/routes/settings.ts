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

import {
  FileTooLargeError,
  InvalidFileTypeError,
  SettingsUpsertError,
} from '@codex/platform-settings';
import type { HonoEnv } from '@codex/shared-types';
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
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

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
      return await ctx.services.settings.updateBranding(ctx.input.body);
    },
  })
);

/**
 * POST /api/organizations/:id/settings/branding/logo
 * Upload a new logo (multipart form data)
 *
 * NOTE: This endpoint uses manual handling for multipart form data
 * which cannot be easily abstracted into the procedure() pattern.
 *
 * Request body: multipart/form-data with 'logo' file field
 * Allowed types: image/png, image/jpeg, image/webp
 * Max size: 5MB
 */
app.post('/branding/logo', async (c) => {
  // Check if R2 bucket is configured
  if (!c.env.MEDIA_BUCKET) {
    return c.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Logo uploads not configured',
        },
      },
      503
    );
  }

  // Validate org ID param
  const id = c.req.param('id');
  const paramResult = uuidSchema.safeParse(id);
  if (!paramResult.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid organization ID',
        },
      },
      400
    );
  }

  // Auth is handled by middleware in parent app
  const user = c.get('user');
  if (!user) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401
    );
  }

  // Get organization context (set by org management check)
  // Use paramResult.data since it's validated, falling back to context if set
  const organizationId = c.get('organizationId') ?? paramResult.data;

  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const logoFile = formData.get('logo');

    if (!logoFile || !(logoFile instanceof File)) {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Logo file is required',
          },
        },
        400
      );
    }

    // Validate MIME type
    if (
      !ALLOWED_LOGO_MIME_TYPES.includes(
        logoFile.type as (typeof ALLOWED_LOGO_MIME_TYPES)[number]
      )
    ) {
      return c.json(
        {
          error: {
            code: 'INVALID_FILE_TYPE',
            message: `Logo must be one of: ${ALLOWED_LOGO_MIME_TYPES.join(', ')}`,
          },
        },
        400
      );
    }

    // Validate file size
    if (logoFile.size > MAX_LOGO_FILE_SIZE_BYTES) {
      const maxSizeMB = MAX_LOGO_FILE_SIZE_BYTES / (1024 * 1024);
      return c.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Logo must be less than ${maxSizeMB}MB`,
          },
        },
        400
      );
    }

    // Read file data
    const fileBuffer = await logoFile.arrayBuffer();

    // Create facade with org context for upload
    const { PlatformSettingsFacade } = await import('@codex/platform-settings');
    const { createPerRequestDbClient } = await import('@codex/database');
    const { R2Service } = await import('@codex/cloudflare-clients');

    const { db, cleanup } = createPerRequestDbClient(c.env);
    const r2 = new R2Service(c.env.MEDIA_BUCKET);

    try {
      const environment = c.env.ENVIRONMENT ?? 'development';
      const facade = new PlatformSettingsFacade({
        db,
        environment,
        organizationId,
        r2,
        r2PublicUrlBase: undefined,
      });

      const branding = await facade.uploadLogo(
        fileBuffer,
        logoFile.type,
        logoFile.size
      );

      return c.json({ data: branding });
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  } catch (err) {
    if (err instanceof InvalidFileTypeError) {
      return c.json(
        {
          error: {
            code: 'INVALID_FILE_TYPE',
            message: (err as InvalidFileTypeError).message,
          },
        },
        400
      );
    }

    if (err instanceof FileTooLargeError) {
      return c.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: (err as FileTooLargeError).message,
          },
        },
        400
      );
    }

    if (err instanceof SettingsUpsertError) {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: (err as SettingsUpsertError).message,
          },
        },
        500
      );
    }

    throw err;
  }
});

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
      return await ctx.services.settings.deleteLogo();
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
