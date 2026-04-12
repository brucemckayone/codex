/**
 * Organization landing page - server load
 *
 * Fetches new releases, creators, and (for auth'd users) continue-watching
 * data in parallel. Each fetch is independently error-handled so one failure
 * does not break the page.
 */

import type { UserLibraryResponse } from '@codex/access';
import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators, getPublicStats } from '$lib/remote/org.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  platform,
  cookies,
  locals,
  setHeaders,
  parent,
}) => {
  const { org } = await parent();

  // Downgrade cache to PRIVATE when user is logged in (response includes personal library data)
  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  // Build parallel fetch promises
  const contentPromise = getPublicContent({
    orgId: org.id,
    limit: 6,
    sort: 'newest',
  });

  const creatorsPromise = getPublicCreators({
    slug: org.slug,
    limit: 3,
  });

  const statsPromise = getPublicStats(org.slug);

  // Continue watching + follow status: only for authenticated users
  let continueWatchingPromise: Promise<UserLibraryResponse> | null = null;
  let isFollowingPromise: Promise<boolean> | null = null;
  if (locals.user) {
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', org.id);
    params.set('filter', 'in_progress');
    params.set('limit', '6');
    params.set('sortBy', 'recent');
    continueWatchingPromise = api.access.getUserLibrary(params);
    isFollowingPromise = api.org
      .isFollowing(org.id)
      .then((r) => r.following)
      .catch(() => false);
  }

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
    continueWatching:
      continueWatchingPromise
        ?.then((r) => r?.items ?? undefined)
        ?.catch(() => undefined) ?? Promise.resolve(undefined),
    isFollowing: isFollowingPromise ? await isFollowingPromise : false,
  };
};
