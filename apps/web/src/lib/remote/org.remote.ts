/**
 * Organization Remote Functions
 *
 * Server-side functions for organization data access.
 * Supports both authenticated (full data) and unauthenticated (public branding) queries.
 */

import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import { createServerApi, serverApiUrl } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Organization by Slug (Authenticated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get organization by slug (authenticated, full data)
 *
 * Usage:
 * ```svelte
 * {#await getOrganization(slug)}
 *   <OrgSkeleton />
 * {:then org}
 *   <OrgProfile org={org.data} />
 * {/await}
 * ```
 */
export const getOrganization = query(z.string().min(1), async (slug) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.org.getBySlug(slug);
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Branding (Unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

interface PublicBrandingData {
  logoUrl: string | null;
  primaryColorHex: string;
  platformName: string;
}

/**
 * Get public branding for theming (unauthenticated, fast)
 *
 * This is called from layouts for theming and should be fast.
 * Returns null if organization not found.
 *
 * Usage:
 * ```svelte
 * <script>
 *   const branding = $derived(await getPublicBranding(slug));
 * </script>
 * <div style:--primary={branding?.primaryColorHex || '#000'}>
 *   ...
 * </div>
 * ```
 */
export const getPublicBranding = query(z.string().min(1), async (slug) => {
  const { platform } = getRequestEvent();
  const orgApiUrl = serverApiUrl(platform, 'org');

  const response = await fetch(`${orgApiUrl}/api/organizations/public/${slug}`);
  if (!response.ok) return null;

  return (await response.json()) as PublicBrandingData;
});

// ─────────────────────────────────────────────────────────────────────────────
// Organization Settings (Authenticated Admin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get organization settings (authenticated, for admin/settings page)
 *
 * Requires user to be admin/owner of the organization.
 */
export const getOrgSettings = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.org.getSettings(orgId);
});

// ─────────────────────────────────────────────────────────────────────────────
// Organization by ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get organization by ID (for internal use)
 */
export const getOrganizationById = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();

  // Note: This assumes an endpoint exists, otherwise use list with filter
  const orgApiUrl = serverApiUrl(platform, 'org');
  const response = await fetch(`${orgApiUrl}/api/organizations/${id}`, {
    headers: {
      Cookie: cookies.get('codex-session')
        ? `codex-session=${cookies.get('codex-session')}`
        : '',
    },
  });

  if (!response.ok) {
    throw new Error('Organization not found');
  }

  return response.json();
});
