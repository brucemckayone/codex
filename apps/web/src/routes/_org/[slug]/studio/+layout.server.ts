/**
 * Studio layout - server load
 *
 * Uses parent org data (avoids redundant getOrganization call).
 * Loads user's membership role and organizations for the studio switcher.
 * Redirects to login if not authenticated.
 * Redirects to home if not a privileged member.
 */
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { getMyMembership, getMyOrganizations } from '$lib/remote/org.remote';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, parent, depends }) => {
  // Auth gate: must be logged in
  if (!locals.user) {
    redirect(302, '/login?redirect=/studio');
  }

  // Prevents re-running this load on every studio sub-page navigation.
  // Hard refresh still re-fetches (correct behavior).
  depends('cache:studio');

  const layoutTimer = logger.startTimer('studio-layout', { threshold: 3000 });

  // Reuse org data from parent layout — saves one API round-trip
  const { org } = await parent();

  if (!org) {
    redirect(302, '/404');
  }

  // Load user's membership and all orgs in parallel
  const membershipTimer = logger.startTimer('studio-layout:membership+orgs', {
    threshold: 2000,
  });
  const [membership, orgsResult] = await Promise.all([
    getMyMembership(org.id),
    getMyOrganizations(),
  ]);
  membershipTimer.end({ orgId: org.id });

  const { role, joinedAt } = membership;

  // Membership gate: must be creator, admin, or owner (members cannot access studio)
  if (!role || role === 'member') {
    redirect(302, '/?error=access_denied');
  }

  const orgs = (orgsResult ?? []).map((o) => ({
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? undefined,
  }));

  layoutTimer.end({ slug: org.slug, role });

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
