/**
 * Organization Remote Functions
 *
 * Server-side functions for organization data access.
 * Supports both authenticated (full data) and unauthenticated (public branding) queries.
 */

import type { OrganizationWithRole } from '@codex/shared-types';
import { z } from 'zod';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

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
  const { platform, cookies } = getRequestEvent();
  try {
    const api = createServerApi(platform, cookies);
    const result = await api.org.getPublicBranding(slug);
    if (!result) return null;
    return result as PublicBrandingData;
  } catch {
    return null;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Org Info (Unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

interface PublicOrgInfo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  brandColors: { primary?: string };
}

/**
 * Get public org info by slug — no auth required.
 * Used by org layout to load org data across subdomains.
 */
/**
 * Get public org info by slug — no auth required.
 * Uses createServerApi but doesn't require cookies.
 */
export const getPublicOrgInfo = query(z.string().min(1), async (slug) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  const result = await api.org.getPublicInfo(slug);
  return result as PublicOrgInfo;
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
// Public Stats (Unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get public aggregate statistics for an organization.
 * Returns content counts by type, total duration, creator count, and views.
 * Used by hero section for social proof and content type pills.
 */
export const getPublicStats = query(z.string().min(1), async (slug) => {
  const { platform, cookies } = getRequestEvent();
  try {
    const api = createServerApi(platform, cookies);
    return await api.org.getPublicStats(slug);
  } catch {
    return null;
  }
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
// Organization Members (Authenticated Admin)
// ─────────────────────────────────────────────────────────────────────────────

const membersQuerySchema = z.object({
  orgId: z.string().uuid(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  role: z
    .enum(['owner', 'admin', 'creator', 'subscriber', 'member'])
    .optional(),
});

/**
 * Get organization members (authenticated, for admin/team page)
 *
 * Requires user to be a member of the organization.
 */
export const getOrgMembers = query(membersQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(params.limit));
  if (params.role) searchParams.set('role', params.role);

  return api.org.getMembers(params.orgId, searchParams);
});

/**
 * Invite a member to the organization
 */
export const inviteMember = command(
  z.object({
    orgId: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(['admin', 'creator', 'member']),
  }),
  async ({ orgId, email, role }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.inviteMember(orgId, { email, role });
  }
);

/**
 * Update a member's role
 */
export const updateMemberRole = command(
  z.object({
    orgId: z.string().uuid(),
    userId: z.string().min(1),
    role: z.enum(['owner', 'admin', 'creator', 'member']),
  }),
  async ({ orgId, userId, role }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.updateMemberRole(orgId, userId, { role });
  }
);

/**
 * Remove a member from the organization
 */
export const removeMember = command(
  z.object({
    orgId: z.string().uuid(),
    userId: z.string().min(1),
  }),
  async ({ orgId, userId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.removeMember(orgId, userId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Create Organization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new organization
 *
 * Creates the org and auto-assigns the current user as owner.
 * On success, redirect to the new org's studio via cross-subdomain navigation.
 */
export const createOrganization = command(
  z.object({
    name: z.string().min(1).max(255),
    slug: z.string().min(1).max(255),
    description: z.string().max(5000).optional(),
  }),
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.create(input);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Check Organization Slug Availability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an organization slug is available
 *
 * Used for real-time availability feedback in the create org dialog.
 */
export const checkOrgSlug = query(z.string().min(2), async (slug) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.org.checkSlug(slug);
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
  const response = await api.org.getMyOrganizations();
  return response;
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Follower (audience relationship — free opt-in)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Follow an organization (idempotent).
 */
export const followOrganization = command(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  await api.org.follow(orgId);
  return { success: true as const };
});

/**
 * Unfollow an organization (idempotent).
 */
export const unfollowOrganization = command(
  z.string().uuid(),
  async (orgId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    await api.org.unfollow(orgId);
    return { success: true as const };
  }
);

/**
 * Get follower count for an organization (public).
 */
export const getFollowerCount = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.org.getFollowerCount(orgId);
});
