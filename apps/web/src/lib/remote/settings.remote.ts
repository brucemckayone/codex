/**
 * Settings Remote Functions
 *
 * Server-side functions for organization contact/general settings.
 * Uses `query()` for cached reads and `form()` for progressive-enhancement mutations.
 *
 * References:
 * - Pattern: apps/web/src/lib/remote/branding.remote.ts
 * - Backend: workers/organization-api/src/routes/settings.ts
 * - Validation: packages/validation/src/schemas/settings.ts
 */

import type { ContactSettingsResponse } from '@codex/shared-types';
import { z } from 'zod';
import { form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Contact Settings Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get contact settings for an organization
 *
 * Fetches all settings and extracts the contact section.
 * Requires admin/owner role (enforced by parent layout guard).
 *
 * Usage:
 * ```svelte
 * <script>
 *   const contact = await getContactSettings(orgId);
 * </script>
 * ```
 */
export const getContactSettings = query(
  z.string().uuid(),
  async (orgId): Promise<ContactSettingsResponse> => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const settings = await api.org.getSettings(orgId);
    return settings.contact;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Update Contact Settings Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: convert empty strings to undefined so optional fields pass validation
 */
const optionalField = z
  .string()
  .transform((val) => (val === '' ? undefined : val));

/**
 * Helper: convert empty strings to null for nullable URL fields
 */
const nullableUrlField = z
  .string()
  .transform((val) => (val === '' ? null : val));

const updateContactFormSchema = z.object({
  orgId: z.string().uuid(),
  platformName: z
    .string()
    .trim()
    .min(1, 'Platform name is required')
    .max(100, 'Platform name must be 100 characters or less')
    .optional(),
  supportEmail: optionalField.pipe(
    z.string().email('Invalid email format').optional()
  ),
  contactUrl: nullableUrlField.pipe(z.string().url().nullable().optional()),
  timezone: optionalField,
  twitterUrl: nullableUrlField.pipe(z.string().url().nullable().optional()),
  youtubeUrl: nullableUrlField.pipe(z.string().url().nullable().optional()),
  instagramUrl: nullableUrlField.pipe(z.string().url().nullable().optional()),
  tiktokUrl: nullableUrlField.pipe(z.string().url().nullable().optional()),
});

/**
 * Update contact settings form (progressive enhancement)
 *
 * Sends PUT to /api/organizations/:id/settings/contact
 *
 * Usage:
 * ```svelte
 * <form {...updateContactForm}>
 *   <input type="hidden" name="orgId" value={orgId} />
 *   <input name="platformName" value={platformName} />
 *   <button disabled={updateContactForm.pending > 0}>Save</button>
 * </form>
 * ```
 */
export const updateContactForm = form(
  updateContactFormSchema,
  async ({
    orgId,
    platformName,
    supportEmail,
    contactUrl,
    timezone,
    twitterUrl,
    youtubeUrl,
    instagramUrl,
    tiktokUrl,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.org.updateContactSettings(orgId, {
        platformName,
        supportEmail,
        contactUrl,
        timezone,
        twitterUrl,
        youtubeUrl,
        instagramUrl,
        tiktokUrl,
      });

      await getContactSettings(orgId).refresh();

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to update settings',
      };
    }
  }
);
