/**
 * Branding Remote Functions
 *
 * Server-side functions for organization branding settings.
 * Uses `query()` for cached reads, `form()` for progressive-enhancement mutations,
 * and `command()` for programmatic mutations (logo upload/delete).
 *
 * References:
 * - Pattern: apps/web/src/lib/remote/avatar-upload.remote.ts
 * - Backend: workers/organization-api/src/routes/settings.ts
 * - Validation: packages/validation/src/schemas/settings.ts
 */

import type { BrandingSettingsResponse } from '@codex/shared-types';
import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { createServerApi, serverApiUrl } from '$lib/server/api';
import { invalidateCache } from '$lib/server/cache';
import { ApiError } from '$lib/server/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Branding Settings Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get branding settings for an organization
 *
 * Fetches all settings and extracts the branding section.
 * Requires admin/owner role (enforced by parent layout guard).
 *
 * Usage:
 * ```svelte
 * <script>
 *   const branding = await getBrandingSettings(orgId);
 * </script>
 * ```
 */
export const getBrandingSettings = query(
  z.string().uuid(),
  async (orgId): Promise<BrandingSettingsResponse> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const settings = await api.org.getSettings(orgId);
    return settings?.branding ?? null;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update Branding Form (Primary Color)
// ─────────────────────────────────────────────────────────────────────────────

const hexColorOptional = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color')
  .optional();

const hexColorNullable = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color')
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const updateBrandingFormSchema = z.object({
  orgId: z.string().uuid(),
  primaryColorHex: hexColorOptional,
  secondaryColorHex: hexColorNullable,
  accentColorHex: hexColorNullable,
  backgroundColorHex: hexColorNullable,
  fontBody: z
    .string()
    .max(50)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  fontHeading: z
    .string()
    .max(50)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  radiusValue: z.coerce.number().min(0).max(2).optional(),
  densityValue: z.coerce.number().min(0.75).max(1.25).optional(),
});

/**
 * Update branding settings form (primary color)
 *
 * Uses progressive enhancement: works without JS, enhances with JS.
 * Sends PUT to /api/organizations/:id/settings/branding
 *
 * Usage:
 * ```svelte
 * <form {...updateBrandingForm}>
 *   <input type="hidden" name="orgId" value={orgId} />
 *   <input type="color" name="primaryColorHex" value={color} />
 *   <button disabled={updateBrandingForm.pending > 0}>Save</button>
 * </form>
 * ```
 */
export const updateBrandingForm = form(
  updateBrandingFormSchema,
  async ({
    orgId,
    primaryColorHex,
    secondaryColorHex,
    accentColorHex,
    backgroundColorHex,
    fontBody,
    fontHeading,
    radiusValue,
    densityValue,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.org.updateBranding(orgId, {
        primaryColorHex,
        secondaryColorHex,
        accentColorHex,
        backgroundColorHex,
        fontBody,
        fontHeading,
        radiusValue,
        densityValue,
      });

      // Invalidate cache so layout picks up the new color
      await invalidateCache(platform, orgId);

      try {
        await getBrandingSettings(orgId).refresh();
      } catch {
        /* non-critical */
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to update branding',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update Branding Command (programmatic — for brand editor panel)
// ─────────────────────────────────────────────────────────────────────────────

const updateBrandingCommandSchema = z.object({
  orgId: z.string().uuid(),
  primaryColorHex: hexColorOptional,
  secondaryColorHex: hexColorNullable,
  accentColorHex: hexColorNullable,
  backgroundColorHex: hexColorNullable,
  fontBody: z
    .string()
    .max(50)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  fontHeading: z
    .string()
    .max(50)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  radiusValue: z.number().min(0).max(2).optional(),
  densityValue: z.number().min(0.75).max(1.25).optional(),
});

/**
 * Update branding settings programmatically (for brand editor panel).
 *
 * Uses command() instead of form() since the panel submits via JS,
 * not a native <form> submission.
 */
export const updateBrandingCommand = command(
  updateBrandingCommandSchema,
  async ({
    orgId,
    primaryColorHex,
    secondaryColorHex,
    accentColorHex,
    backgroundColorHex,
    fontBody,
    fontHeading,
    radiusValue,
    densityValue,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const result = await api.org.updateBranding(orgId, {
      primaryColorHex,
      secondaryColorHex,
      accentColorHex,
      backgroundColorHex,
      fontBody,
      fontHeading,
      radiusValue,
      densityValue,
    });

    await invalidateCache(platform, orgId);

    try {
      await getBrandingSettings(orgId).refresh();
    } catch {
      /* non-critical */
    }

    return result;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Upload Logo Form
// ─────────────────────────────────────────────────────────────────────────────

const uploadLogoSchema = z.object({
  orgId: z.string().uuid(),
  logo: z
    .instanceof(File)
    .refine(
      (file) =>
        ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(
          file.type
        ),
      'Logo must be PNG, JPEG, WebP, or SVG'
    )
    .refine(
      (file) => file.size <= 5 * 1024 * 1024,
      'File must be less than 5MB'
    ),
});

/**
 * Upload organization logo
 *
 * Uses form() for native FormData submission (File objects cannot be
 * serialized by command()/devalue).
 *
 * Usage:
 * ```svelte
 * <form {...uploadLogoForm} enctype="multipart/form-data">
 *   <input type="hidden" name="orgId" value={orgId} />
 *   <input type="file" name="logo" accept="image/*" />
 *   <button>Upload</button>
 * </form>
 * ```
 */
export const uploadLogoForm = form(
  uploadLogoSchema,
  async ({ orgId, logo }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.org.uploadLogo(orgId, logo);

      // Invalidate cache so layout picks up the new logo
      await invalidateCache(platform, orgId);

      try {
        await getBrandingSettings(orgId).refresh();
      } catch {
        /* non-critical */
      }

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload logo',
      };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Delete Logo Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete organization logo
 *
 * Uses command() since only an orgId string is sent (devalue-serializable).
 */
export const deleteLogo = command(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const result = await api.org.deleteLogo(orgId);

  // Invalidate cache so layout picks up logo removal
  await invalidateCache(platform, orgId);

  try {
    await getBrandingSettings(orgId).refresh();
  } catch {
    /* non-critical */
  }

  return result;
});
