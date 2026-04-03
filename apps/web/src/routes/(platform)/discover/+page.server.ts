/**
 * Discover page - server load
 * Fetches all published content across all orgs using the dedicated discover endpoint.
 * No auth required — uses getDiscoverContent (GET /api/content/public/discover)
 * which is intentionally unscoped for platform-wide browsing.
 */

import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const EMPTY_CONTENT = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

export const load: PageServerLoad = async ({
  platform,
  cookies,
  url,
  setHeaders,
}) => {
  // Public endpoint — cacheable for all visitors
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const api = createServerApi(platform, cookies);

  const params = new URLSearchParams();
  params.set('sort', 'newest');

  const search = url.searchParams.get('q')?.slice(0, 200) ?? '';
  if (search) {
    params.set('search', search);
  }

  const pageParam = url.searchParams.get('page');
  const pageNum = pageParam
    ? Math.max(1, Math.min(100, parseInt(pageParam, 10) || 1))
    : undefined;
  if (pageNum) {
    params.set('page', String(pageNum));
  }

  try {
    const content = await api.content.getDiscoverContent(params);
    return {
      content: content ?? EMPTY_CONTENT,
      search,
      error: false,
    };
  } catch (err) {
    logger.warn('Failed to load discover content', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { content: EMPTY_CONTENT, search, error: true };
  }
};
