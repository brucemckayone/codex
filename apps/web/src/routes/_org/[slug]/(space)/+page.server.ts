/**
 * Organization landing page - server load
 *
 * Fetches new releases, creators, and (for auth'd users) continue-watching
 * data in parallel. Each fetch is independently error-handled so one failure
 * does not break the page.
 */

import type { UserLibraryResponse } from '@codex/access';
import { getPublicContent } from '$lib/remote/content.remote';
import { getPublicCreators } from '$lib/remote/org.remote';
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

  // Continue watching: only for authenticated users
  let continueWatchingPromise: Promise<UserLibraryResponse> | null = null;
  if (locals.user) {
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', org.id);
    params.set('filter', 'in_progress');
    params.set('limit', '6');
    params.set('sortBy', 'recent');
    continueWatchingPromise = api.access.getUserLibrary(params);
  }

  // Await all in parallel — each independently error-handled
  const [contentResult, creatorsResult, continueWatchingResult] =
    await Promise.all([
      contentPromise.catch(() => null),
      creatorsPromise.catch(() => null),
      continueWatchingPromise?.catch(() => null) ?? Promise.resolve(null),
    ]);

  return {
    newReleases: contentResult?.items ?? [],
    creators: {
      items: creatorsResult?.items ?? [],
      total: creatorsResult?.pagination?.total ?? 0,
    },
    continueWatching: continueWatchingResult?.items ?? undefined,
  };
};
