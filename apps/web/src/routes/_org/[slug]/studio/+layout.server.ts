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
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({
  locals,
  parent,
  depends,
  platform,
  cookies,
  setHeaders,
}) => {
  // Auth gate: must be logged in
  if (!locals.user) {
    redirect(302, '/login?redirect=/studio');
  }

  // Studio is always user-specific — prevent public caching
  setHeaders(CACHE_HEADERS.PRIVATE);

  // Prevents re-running this load on every studio sub-page navigation.
  // Hard refresh still re-fetches (correct behavior).
  depends('cache:studio');

  const layoutTimer = logger.startTimer('studio-layout', { threshold: 3000 });

  // Reuse org data from parent layout — saves one API round-trip
  const parentData = await parent().catch((err: unknown) => {
    logger.error('studio-layout:parent failed', { error: String(err) });
    throw err;
  });
  const { org } = parentData;

  if (!org) {
    redirect(302, '/404');
  }

  // Load user's membership and orgs in parallel
  const membershipTimer = logger.startTimer('studio-layout:membership+orgs', {
    threshold: 2000,
  });

  const [membershipResult, orgsResult] = await Promise.all([
    getMyMembership(org.id).catch((err: unknown) => {
      logger.error('studio-layout:getMyMembership failed', {
        orgId: org.id,
        error: String(err),
      });
      return { role: null, joinedAt: null };
    }),
    getMyOrganizations().catch((err: unknown) => {
      logger.error('studio-layout:getMyOrganizations failed', {
        orgId: org.id,
        error: String(err),
      });
      return null;
    }),
  ]);
  membershipTimer.end({ orgId: org.id });

  const { role, joinedAt } = membershipResult;

  // Membership gate: must be creator, admin, or owner (members cannot access studio)
  if (!role || role === 'member') {
    redirect(302, '/?error=access_denied');
  }

  // Draft count: lightweight call after auth check — limit=1 just to get pagination.total
  let draftCount = 0;
  try {
    const api = createServerApi(platform, cookies);
    const draftParams = new URLSearchParams();
    draftParams.set('organizationId', org.id);
    draftParams.set('status', 'draft');
    draftParams.set('limit', '1');
    draftParams.set('page', '1');
    const draftResult = await api.content.list(draftParams);
    draftCount = draftResult?.pagination?.total ?? 0;
  } catch {
    // Non-critical — badge just won't show
  }

  const orgs = (orgsResult ?? []).map((o) => ({
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? undefined,
    role: o.role,
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
    studioUser: {
      name: locals.user.name ?? '',
      email: locals.user.email ?? '',
    },
    badgeCounts: {
      draftContent: draftCount,
    },
  };
};
