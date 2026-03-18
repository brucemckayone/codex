/**
 * Library Page - Server Load
 *
 * Fetches user's library on the server for SSR.
 * Data is hydrated into TanStack Query cache on client mount.
 * Supports URL-driven sort and pagination: ?page=1&sort=recent
 */

import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const LIBRARY_LIMIT = 12;

/** Map URL sort param to API sortBy/sortOrder */
function parseSortParam(sort: string | null): {
  sortBy: 'addedAt' | 'title' | 'lastPlayed';
  sortOrder: 'asc' | 'desc';
} {
  switch (sort) {
    case 'watched':
      return { sortBy: 'lastPlayed', sortOrder: 'desc' };
    case 'az':
      return { sortBy: 'title', sortOrder: 'asc' };
    case 'za':
      return { sortBy: 'title', sortOrder: 'desc' };
    case 'recent':
    default:
      return { sortBy: 'addedAt', sortOrder: 'desc' };
  }
}

export const load: PageServerLoad = async ({
  platform,
  cookies,
  locals,
  url,
  setHeaders,
}) => {
  setHeaders(CACHE_HEADERS.PRIVATE);

  // Ensure user is authenticated
  if (!locals.user) {
    redirect(303, '/login?redirect=/library');
  }

  // Parse URL params for pagination and sorting
  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );
  const sortParam = url.searchParams.get('sort') ?? 'recent';
  const { sortBy, sortOrder } = parseSortParam(sortParam);

  const api = createServerApi(platform, cookies);

  // Build query params
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(LIBRARY_LIMIT));
  params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);

  try {
    const library = await api.access.getUserLibrary(params);
    return {
      library: library ?? {
        items: [],
        total: 0,
        page: 1,
        limit: LIBRARY_LIMIT,
      },
      sort: sortParam,
      error: false,
    };
  } catch (error) {
    console.error('Failed to load library:', error);
    return {
      library: { items: [], total: 0, page: 1, limit: LIBRARY_LIMIT },
      sort: sortParam,
      error: true,
    };
  }
};
