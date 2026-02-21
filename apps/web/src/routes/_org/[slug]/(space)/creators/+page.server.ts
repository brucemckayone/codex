/**
 * Organization creators page - server load
 * Sets public cache headers for edge caching and provides pagination
 */
import { listPublicCreators } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const ssr = true;

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { slug } = params;
  const page = Number(url.searchParams.get('page') ?? '1');

  try {
    const result = await listPublicCreators({ slug, page, limit: 12 });

    return {
      org: { slug },
      items: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  } catch {
    // Return empty state on error
    return {
      org: { slug },
      items: [],
      total: 0,
      page: 1,
      limit: 12,
      totalPages: 0,
    };
  }
};
