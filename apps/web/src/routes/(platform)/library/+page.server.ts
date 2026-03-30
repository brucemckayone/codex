/**
 * Library Page - Server Load
 *
 * Fetches user's library on the server for SSR.
 * Data is hydrated into TanStack Query cache on client mount.
 * Supports URL-driven sort and pagination: ?page=1&sort=recent
 */

import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const LIBRARY_LIMIT = 12;

/** Map URL sort param to API sortBy value (must match listUserLibrarySchema) */
function parseSortParam(sort: string | null): 'recent' | 'title' | 'duration' {
  switch (sort) {
    case 'az':
    case 'za':
      return 'title';
    case 'watched':
    case 'recent':
    default:
      return 'recent';
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
  const sortBy = parseSortParam(sortParam);

  const api = createServerApi(platform, cookies);

  // Build query params (must match listUserLibrarySchema: page, limit, sortBy, filter)
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(LIBRARY_LIMIT));
  params.set('sortBy', sortBy);

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
      errorCode: null as string | null,
    };
  } catch (err) {
    const { ApiError } = await import('$lib/server/errors');
    const code = err instanceof ApiError ? String(err.status) : 'UNKNOWN';
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load library [${code}]: ${msg}`);
    return {
      library: { items: [], total: 0, page: 1, limit: LIBRARY_LIMIT },
      sort: sortParam,
      error: true,
      errorCode: code,
    };
  }
};
