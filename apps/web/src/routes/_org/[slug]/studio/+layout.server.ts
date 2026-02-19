/**
 * Studio layout - server load
 *
 * Loads organization, user's role, and organizations for switcher.
 * Redirects to login if not authenticated.
 * Redirects to join if not a member of the organization.
 */
import { redirect } from '@sveltejs/kit';
import {
  getMyMembership,
  getMyOrganizations,
  getOrganization,
} from '$lib/remote/org.remote';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  // Auth gate: must be logged in
  if (!locals.user) {
    redirect(302, `/login?redirect=/${params.slug}/studio`);
  }

  // Disable edge caching - headers set via platform adapter
  // Note: SvelteKit platform adapter applies no-cache headers automatically

  const { slug } = params;

  // Load organization
  const orgResult = await getOrganization(slug);
  const org = orgResult?.data;

  if (!org) {
    redirect(302, '/404');
  }

  // Load user's membership in this org
  const membership = await getMyMembership(org.id);
  const { role, joinedAt } = membership;

  // Membership gate: must be creator, admin, or owner (members cannot access studio)
  if (!role || role === 'member') {
    redirect(302, `/${slug}?error=access_denied`);
  }

  // Load all user's organizations for switcher
  const orgsResult = await getMyOrganizations();
  const orgs = (orgsResult ?? []).map((o) => ({
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? undefined,
  }));

  return {
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      brandColors: org.brandColors,
    },
    userRole: role,
    userJoinedAt: joinedAt,
    orgs,
  };
};
