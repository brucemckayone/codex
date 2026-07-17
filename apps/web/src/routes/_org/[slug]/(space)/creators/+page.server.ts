/**
 * Organization creators directory page - server load
 *
 * Fetches paginated list of public creators for the organization.
 * Uses the GET /api/organizations/public/:slug/creators endpoint.
 * Sets PRIVATE cache headers — the page is auth-varying (org layout injects
 * `user`), so it must not be shared-cached.
 */
import { getPublicCreators } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const PAGE_LIMIT = 12;

export const load: PageServerLoad = async ({ url, setHeaders, parent }) => {
  const { org } = await parent();

  // Extract pagination from URL
  const pageParam = url.searchParams.get('page');
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const creatorsResult = await getPublicCreators({
    slug: org.slug,
    page,
    limit: PAGE_LIMIT,
  });

  // Auth-varying HTML — the org layout injects the auth-aware `user` section,
  // so the SAME URL differs by auth state. Shared caches (Cloudflare edge,
  // miniflare) key by URL, NOT by Cookie, so a `public` copy cached for an
  // anonymous visitor is served to signed-in users too. PRIVATE keeps it out
  // of shared caches. See docs/caching-strategy.md §HTTP/CDN caching.
  setHeaders(CACHE_HEADERS.PRIVATE);

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
