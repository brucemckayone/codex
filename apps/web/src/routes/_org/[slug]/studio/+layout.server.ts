/**
 * Studio layout - server load
 *
 * Uses parent org data (avoids redundant getOrganization call).
 * Loads user's membership role and organizations for the studio switcher.
 * Redirects to login if not authenticated, PRESERVING the requested path so a
 * bookmarked deep link (a builder URL, say) survives the sign-in — see
 * {@link _safeStudioRedirect}.
 * Redirects to home if not a privileged member.
 */
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { getMyOrganizations } from '$lib/remote/org.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { resolveMembershipWithRetry } from '$lib/server/membership-retry';
import type { LayoutServerLoad } from './$types';

/**
 * The `redirect=` value handed to the login page — the path the visitor actually
 * asked for, or `/studio` when that path cannot be safely handed back.
 *
 * WHY THIS EXISTS. The guard used to redirect to a hard-coded
 * `/login?redirect=/studio`, so requesting `/studio/journeys/<id>/page` while
 * signed out cost the deep link: after signing in you landed on the studio
 * dashboard and had to navigate back. Every creator who bookmarks a builder URL,
 * and every agent driving that surface, paid for it.
 *
 * WHY IT VALIDATES SOMETHING IT BUILT ITSELF. The target is assembled from
 * `url.pathname` + `url.search`, so it is same-origin and path-only BY
 * CONSTRUCTION — but `pathname` is attacker-influenced, and a request for
 * `//evil.example/x` on this host parses to the pathname `//evil.example/x`,
 * which a browser reads as a PROTOCOL-RELATIVE URL. Handing that to a login page
 * that redirects to it is an open redirect, and an open redirect on the sign-in
 * path is a credential-phishing primitive. So the shape is re-checked here rather
 * than trusted: a leading `/` followed by a character that is neither `/` nor
 * `\` (some browsers treat `/\host` as protocol-relative too). Nothing else is
 * allowed — no absolute URL, no scheme, no host.
 *
 * The login action applies its own `startsWith('/') && !startsWith('//')` check
 * before it redirects. That is defence in depth, deliberately duplicated: this
 * function must be correct on its own, because it is what puts the value into a
 * URL in the first place.
 *
 * THE SEARCH STRING IS KEPT. The builder's own "View live" uses `?preview=1`, and
 * a future builder deep link may carry state; dropping the query would send the
 * creator back to a different page than the one they asked for.
 *
 * Exported with a `_` prefix because SvelteKit rejects any other name on a
 * `+layout.server` module (`validate_layout_server_exports`) — the same idiom
 * `_org/[slug]/+layout.server.ts` uses for `_resetMissingOrgSlugCache`.
 */
export function _safeStudioRedirect(url: URL): string {
  const target = `${url.pathname}${url.search}`;
  // A single regex, and each part of it earns its place: `^\/` a path, `[^/\\]`
  // not protocol-relative in any browser's reading of it, and no `i` flag or
  // alternation that could be widened by accident.
  if (!/^\/[^/\\]/.test(target)) return '/studio';
  return target;
}

export const load: LayoutServerLoad = async ({
  locals,
  parent,
  depends,
  platform,
  cookies,
  setHeaders,
  url,
}) => {
  // Auth gate: must be logged in. The requested path is preserved so signing in
  // returns the creator to the page they asked for, not to the studio dashboard
  // — see `_safeStudioRedirect` for why the target is validated and encoded.
  if (!locals.user) {
    redirect(
      302,
      `/login?redirect=${encodeURIComponent(_safeStudioRedirect(url))}`
    );
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

  // Raw API client (uncached) — reused for the membership retry below AND the
  // draft-count call further down.
  const api = createServerApi(platform, cookies);

  const [membershipResult, orgsResult] = await Promise.all([
    // Read-after-write retry (Codex-jko8i): a freshly-created owner's membership
    // row can be momentarily invisible on the follow-up read right after org
    // creation, which would otherwise bounce them to access_denied. We call the
    // RAW api client (NOT the cached remote getMyMembership query(), which would
    // dedupe repeat reads) so each retry attempt is a fresh DB read.
    resolveMembershipWithRetry(() => api.org.getMyMembership(org.id)).catch(
      (err: unknown) => {
        logger.error('studio-layout:getMyMembership failed', {
          orgId: org.id,
          error: String(err),
        });
        return { role: null, joinedAt: null };
      }
    ),
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
      // Carried through from the parent org layout so studio surfaces (e.g. the
      // brand editor's Hero-text control) can seed the org subheading. Without
      // it this child `org` shadows the parent's richer one and description is
      // undefined → the field falls back to its placeholder.
      description: org.description,
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
