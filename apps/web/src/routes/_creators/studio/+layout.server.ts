/**
 * Creator Studio layout - server load
 *
 * Access control guard for the personal creator studio.
 * Redirects unauthenticated users to login and non-creators to homepage.
 * Loads creator profile and organization list for the sidebar/switcher.
 */
import { AUTH_ROLES } from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import { getProfile } from '$lib/remote/account.remote';
import { getMyOrganizations } from '$lib/remote/org.remote';
import type { LayoutServerLoad } from './$types';

/** Roles permitted to access the creator studio */
const STUDIO_ROLES = new Set([
  AUTH_ROLES.CREATOR,
  AUTH_ROLES.ADMIN,
  AUTH_ROLES.PLATFORM_OWNER,
]);

export const load: LayoutServerLoad = async ({ locals, depends, url }) => {
  // Auth gate: must be logged in
  // Use full URL in redirect param to preserve the creators subdomain after login
  if (!locals.user) {
    redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  // Role gate: must be a creator, admin, or platform_owner
  if (!(STUDIO_ROLES as Set<string>).has(locals.user.role)) {
    redirect(302, '/?error=access_denied');
  }

  depends('cache:studio');

  // Load profile and orgs in parallel for sidebar/switcher
  const [profile, orgsResult] = await Promise.all([
    getProfile().catch(() => null),
    getMyOrganizations().catch(() => []),
  ]);

  const orgs = (orgsResult ?? []).map((o) => ({
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? undefined,
  }));

  return {
    creator: {
      id: locals.user.id,
      name: profile?.name ?? locals.user.name ?? 'Creator',
      username: profile?.username ?? null,
      avatarUrl: profile?.image ?? null,
    },
    orgs,
  };
};
