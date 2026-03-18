/**
 * Organization creators directory page - server load
 *
 * Fetches paginated list of public creators for the organization.
 * Uses the GET /api/organizations/public/:slug/creators endpoint.
 * Sets DYNAMIC_PUBLIC cache headers for edge caching.
 */
import { getPublicCreators } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const PAGE_LIMIT = 20;

export const load: PageServerLoad = async ({ url, setHeaders, parent }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { org } = await parent();

  // Extract pagination from URL
  const pageParam = url.searchParams.get('page');
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const creatorsResult = await getPublicCreators({
    slug: org.slug,
    page,
    limit: PAGE_LIMIT,
  });

  return {
    creators: {
      items: creatorsResult?.items ?? [],
      total: creatorsResult?.pagination?.total ?? 0,
    },
    pagination: {
      page,
      limit: PAGE_LIMIT,
    },
  };
};
