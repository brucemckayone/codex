/**
 * Discover page - server load
 * Fetches published public content for the discover grid.
 */

import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  platform,
  cookies,
  url,
  setHeaders,
}) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const api = createServerApi(platform, cookies);

  const params = new URLSearchParams();
  params.set('status', 'published');
  params.set('visibility', 'public');

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
    const content = await api.content.list(params);
    return {
      content: content ?? { data: [], total: 0, page: 1, limit: 20 },
      search,
    };
  } catch (error) {
    console.error('Failed to load discover content:', error);
    return {
      content: { data: [], total: 0, page: 1, limit: 20 },
      search,
    };
  }
};
