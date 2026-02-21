/**
 * Organization Remote Functions
 *
 * Server-side functions for organization data access.
 * Supports both authenticated (full data) and unauthenticated (public branding) queries.
 */

import type {
  OrganizationWithRole,
  PublicBrandingResponse,
  PublicCreatorsResponse,
} from '@codex/shared-types';
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

  return (await response.json()) as PublicBrandingResponse;
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

// ─────────────────────────────────────────────────────────────────────────────
// Public Creators List (Unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get public creators list for an organization (unauthenticated)
 *
 * Used for the org creators directory page.
 *
 * Usage:
 * ```svelte
 * {#await listPublicCreators({ slug: 'my-org', page: 1, limit: 12 })}
 *   <CreatorsSkeleton />
 * {:then data}
 *   <CreatorsGrid items={data.items} />
 * {/await}
 * ```
 */
export const listPublicCreators = query(
  z.object({
    slug: z.string().min(1),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(50).default(12),
  }),
  async (params) => {
    const { platform } = getRequestEvent();
    const api = createServerApi(platform);

    const searchParams = new URLSearchParams();
    searchParams.set('page', String(params.page));
    searchParams.set('limit', String(params.limit));

    try {
      const result = await api.org.listPublicCreators(
        params.slug,
        searchParams
      );

      // Transform from PaginatedListResponse to flat response expected by components
      return {
        items: result.items,
        total: result.pagination.total,
        page: result.pagination.page,
        limit: result.pagination.limit,
        totalPages: result.pagination.totalPages,
      };
    } catch {
      // Return empty state on error
      return {
        items: [],
        total: 0,
        page: 1,
        limit: params.limit,
        totalPages: 0,
      };
    }
  }
);
