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

import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import type { BrandingSettingsResponse } from '@codex/shared-types';
import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { createServerApi, serverApiUrl } from '$lib/server/api';
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
    return settings.branding;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update Branding Form (Primary Color)
// ─────────────────────────────────────────────────────────────────────────────

const updateBrandingFormSchema = z.object({
  orgId: z.string().uuid(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color')
    .optional(),
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
  async ({ orgId, primaryColorHex }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.org.updateBranding(orgId, { primaryColorHex });

      // Invalidate cache so layout picks up the new color
      const cache = platform?.env?.CACHE_KV
        ? new VersionedCache({ kv: platform.env.CACHE_KV as KVNamespace })
        : null;

      if (cache) {
        await cache.invalidate(orgId);
      }

      await getBrandingSettings(orgId).refresh();

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
// Upload Logo Command
// ─────────────────────────────────────────────────────────────────────────────

const uploadLogoSchema = z.object({
  orgId: z.string().uuid(),
  file: z
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
 * Sends multipart FormData to POST /api/organizations/:id/settings/branding/logo
 *
 * Usage:
 * ```svelte
 * <script>
 *   async function handleUpload(file: File) {
 *     const result = await uploadLogo({ orgId, file });
 *   }
 * </script>
 * ```
 */
export const uploadLogo = command(uploadLogoSchema, async ({ orgId, file }) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const result = await api.org.uploadLogo(orgId, file);

  // Invalidate cache so layout picks up the new logo
  const cache = platform?.env?.CACHE_KV
    ? new VersionedCache({ kv: platform.env.CACHE_KV as KVNamespace })
    : null;

  if (cache) {
    await cache.invalidate(orgId);
  }

  await getBrandingSettings(orgId).refresh();

  return result;
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete Logo Command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete organization logo
 *
 * Sends DELETE to /api/organizations/:id/settings/branding/logo
 *
 * Usage:
 * ```svelte
 * <script>
 *   async function handleDelete() {
 *     await deleteLogo(orgId);
 *   }
 * </script>
 * ```
 */
export const deleteLogo = command(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const result = await api.org.deleteLogo(orgId);

  // Invalidate cache so layout picks up logo removal
  const cache = platform?.env?.CACHE_KV
    ? new VersionedCache({ kv: platform.env.CACHE_KV as KVNamespace })
    : null;

  if (cache) {
    await cache.invalidate(orgId);
  }

  await getBrandingSettings(orgId).refresh();

  return result;
});
