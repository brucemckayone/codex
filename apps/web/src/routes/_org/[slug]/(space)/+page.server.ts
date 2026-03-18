/**
 * Organization landing page - server load
 * Fetches featured content and sets public cache headers for edge caching
 */

import { getPublicContent } from '$lib/remote/content.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders, parent }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { org } = await parent();

  // Fetch up to 6 newest published items for the featured grid
  const contentResult = await getPublicContent({
    orgId: org.id,
    limit: 6,
    sort: 'newest',
  });

  return {
    featuredContent: contentResult?.items ?? [],
  };
};
