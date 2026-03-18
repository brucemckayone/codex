/**
 * Organization Remote Functions
 *
 * Server-side functions for organization data access.
 * Supports both authenticated (full data) and unauthenticated (public branding) queries.
 */

import type { OrganizationWithRole } from '@codex/shared-types';
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
// Public Creators (Unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

const publicCreatorsQuerySchema = z.object({
  slug: z.string().min(1),
  page: z.number().min(1).default(1).optional(),
  limit: z.number().min(1).max(100).default(20).optional(),
});

/**
 * Get public creators for an organization (unauthenticated, paginated)
 *
 * Returns public-safe creator information for the org directory page.
 *
 * Usage:
 * ```svelte
 * {#each (await getPublicCreators({ slug, page: 1, limit: 20 })).items as creator}
 *   <CreatorCard {...creator} />
 * {/each}
 * ```
 */
export const getPublicCreators = query(
  publicCreatorsQuerySchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));

    return api.org.getPublicCreators(
      params.slug,
      searchParams.toString() ? searchParams : undefined
    );
  }
);

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
  const api = createServerApi(platform, cookies);
  return api.fetch('org', `/api/organizations/${id}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// My Organizations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current user's organizations
 *
 * Returns array of organizations where user is an active member.
 * Used for StudioSwitcher dropdown.
 */
export const getMyOrganizations = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.org.getMyOrganizations();
}) as unknown as () => Promise<OrganizationWithRole[] | null>;

// ─────────────────────────────────────────────────────────────────────────────
// My Membership
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get user's membership in an organization
 *
 * @param orgId - Organization UUID
 * @returns Membership with role and joinedAt (null if not a member)
 */
export const getMyMembership = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.org.getMyMembership(orgId);
}) as unknown as (
  orgId: string
) => Promise<{ role: string | null; joinedAt: string | null }>;
