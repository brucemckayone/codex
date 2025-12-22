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

import { R2Service } from '@codex/cloudflare-clients';
import {
  createPerRequestDbClient,
  type Database,
  type DatabaseWs,
} from '@codex/database';
import {
  FileTooLargeError,
  InvalidFileTypeError,
  PlatformSettingsFacade,
  SettingsUpsertError,
} from '@codex/platform-settings';
import type { HonoEnv } from '@codex/shared-types';
import {
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_FILE_SIZE_BYTES,
  updateBrandingSchema,
  updateContactSchema,
  updateFeaturesSchema,
  uuidSchema,
} from '@codex/validation';
import {
  createAuthenticatedHandler,
  POLICY_PRESETS,
  withPolicy,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

// Param schema for org ID validation
const orgIdParamSchema = z.object({ id: uuidSchema });

// ============================================================================
// Helper: Create PlatformSettingsFacade
// ============================================================================

/**
 * Creates a PlatformSettingsFacade with the provided database client.
 * Use createPerRequestDbClient() to get a WebSocket client for upsert operations.
 */
function createSettingsFacade(
  db: Database | DatabaseWs,
  organizationId: string,
  env: HonoEnv['Bindings']
): PlatformSettingsFacade {
  // Create R2Service if bucket is available
  const r2 = env.MEDIA_BUCKET ? new R2Service(env.MEDIA_BUCKET) : undefined;

  // Build public URL base for logos
  // In production, configure via R2 custom domain or CDN
  // For now, we use direct R2 paths that the service will store
  const r2PublicUrlBase = undefined;

  return new PlatformSettingsFacade({
    db,
    environment: env.ENVIRONMENT || 'development',
    organizationId,
    r2,
    r2PublicUrlBase,
  });
}

// ============================================================================
// GET /api/organizations/:id/settings - Get all settings
// ============================================================================

app.get(
  '/',
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');

      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] GET / - getAllSettings', {
        orgId,
        userId: ctx.user?.id,
      });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const allSettings = await facade.getAllSettings();
        obs?.info('[Settings] getAllSettings result', { orgId, allSettings });
        return allSettings;
      } catch (error) {
        obs?.error('[Settings] getAllSettings error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
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
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');
      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] GET /branding', { orgId, userId: ctx.user?.id });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const branding = await facade.getBranding();
        obs?.info('[Settings] getBranding result', { orgId, branding });
        return branding;
      } catch (error) {
        obs?.error('[Settings] getBranding error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
    },
  })
);

/**
 * PUT /api/organizations/:id/settings/branding
 * Update branding settings (primary color only - use POST /logo for logo)
 */
app.put(
  '/branding',
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
      body: updateBrandingSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');
      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] PUT /branding', {
        orgId,
        userId: ctx.user?.id,
        body: ctx.validated.body,
      });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const branding = await facade.updateBranding(ctx.validated.body);
        obs?.info('[Settings] updateBranding result', { orgId, branding });
        return branding;
      } catch (error) {
        obs?.error('[Settings] updateBranding error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
    },
  })
);

/**
 * POST /api/organizations/:id/settings/branding/logo
 * Upload a new logo (multipart form data)
 *
 * Request body: multipart/form-data with 'logo' file field
 * Allowed types: image/png, image/jpeg, image/webp
 * Max size: 5MB
 */
app.post(
  '/branding/logo',
  withPolicy(POLICY_PRESETS.orgManagement()),
  async (c) => {
    // Validate org ID param
    const orgIdResult = orgIdParamSchema.safeParse({
      id: c.req.param('id'),
    });
    if (!orgIdResult.success) {
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

    const { id: orgId } = orgIdResult.data;

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

      // Upload via facade with per-request db client
      const { db, cleanup } = createPerRequestDbClient(c.env);
      try {
        const facade = createSettingsFacade(db, orgId, c.env);
        const branding = await facade.uploadLogo(
          fileBuffer,
          logoFile.type,
          logoFile.size
        );

        return c.json({ data: branding });
      } finally {
        await cleanup();
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
  }
);

/**
 * DELETE /api/organizations/:id/settings/branding/logo
 * Delete the current logo
 */
app.delete(
  '/branding/logo',
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
    },
    handler: async (c, ctx) => {
      const { id: orgId } = ctx.validated.params;

      // Check if R2 bucket is configured
      if (!ctx.env.MEDIA_BUCKET) {
        return c.json(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Logo operations not configured',
            },
          },
          503
        );
      }

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const branding = await facade.deleteLogo();
        return branding;
      } finally {
        await cleanup();
      }
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
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');
      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] GET /contact', { orgId, userId: ctx.user?.id });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const contact = await facade.getContact();
        obs?.info('[Settings] getContact result', { orgId, contact });
        return contact;
      } catch (error) {
        obs?.error('[Settings] getContact error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
    },
  })
);

/**
 * PUT /api/organizations/:id/settings/contact
 * Update contact settings
 */
app.put(
  '/contact',
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
      body: updateContactSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');
      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] PUT /contact', {
        orgId,
        userId: ctx.user?.id,
        body: ctx.validated.body,
      });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const contact = await facade.updateContact(ctx.validated.body);
        obs?.info('[Settings] updateContact result', { orgId, contact });
        return contact;
      } catch (error) {
        obs?.error('[Settings] updateContact error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
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
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');
      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] GET /features', { orgId, userId: ctx.user?.id });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const features = await facade.getFeatures();
        obs?.info('[Settings] getFeatures result', { orgId, features });
        return features;
      } catch (error) {
        obs?.error('[Settings] getFeatures error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
    },
  })
);

/**
 * PUT /api/organizations/:id/settings/features
 * Update feature settings
 */
app.put(
  '/features',
  withPolicy(POLICY_PRESETS.orgManagement()),
  createAuthenticatedHandler({
    schema: {
      params: orgIdParamSchema,
      body: updateFeaturesSchema,
    },
    handler: async (c, ctx) => {
      const obs = c.get('obs');
      const { id: orgId } = ctx.validated.params;
      obs?.info('[Settings] PUT /features', {
        orgId,
        userId: ctx.user?.id,
        body: ctx.validated.body,
      });

      const { db, cleanup } = createPerRequestDbClient(ctx.env);
      try {
        const facade = createSettingsFacade(db, orgId, ctx.env);
        const features = await facade.updateFeatures(ctx.validated.body);
        obs?.info('[Settings] updateFeatures result', { orgId, features });
        return features;
      } catch (error) {
        obs?.error('[Settings] updateFeatures error', {
          orgId,
          error: String(error),
        });
        throw error;
      } finally {
        await cleanup();
      }
    },
  })
);

export default app;
