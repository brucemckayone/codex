/**
 * Organization landing page - server load
 *
 * Fetches new releases, creators, and stats in parallel.
 * Continue watching is client-side via libraryCollection (localStorage).
 * Each fetch is independently error-handled so one failure
 * does not break the page.
 */

import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators, getPublicStats } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params: routeParams,
  locals,
  setHeaders,
  parent,
}) => {
  // Fire stats + creators BEFORE awaiting parent — they only need the slug
  // which is already in URL params. This overlaps with the layout's org fetch.
  const statsPromise = getPublicStats(routeParams.slug);

  // Landing page shows a horizontal carousel of creators directly under the hero.
  // Limit 12 gives the carousel enough content to scroll through on orgs with a deep team,
  // while still being a single cheap query (typical orgs have <10 creators).
  const creatorsPromise = getPublicCreators({
    slug: routeParams.slug,
    limit: 12,
  });

  // Now wait for layout (needed for orgId → content fetch)
  const { org } = await parent();

  // Cache headers — layout streams tiers (public), subscription is client-side
  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  // Content needs orgId — must wait for parent()
  const contentPromise = getPublicContent({
    orgId: org.id,
    limit: 6,
    sort: 'newest',
  });

  // Await only what's critical for first paint (hero + new releases + stats)
  const [contentResult, statsResult] = await Promise.all([
    contentPromise.catch(() => null),
    statsPromise.catch(() => null),
  ]);

  return {
    newReleases: contentResult?.items ?? [],
    stats: statsResult,
    // Stream non-critical data — bare promises resolve client-side.
    // .catch() on each prevents "unhandled promise rejection" server crashes.
    creators: creatorsPromise
      .then((r) => ({
        items: r?.items ?? [],
        total: r?.pagination?.total ?? 0,
      }))
      .catch(() => ({ items: [], total: 0 })),
  };
};
