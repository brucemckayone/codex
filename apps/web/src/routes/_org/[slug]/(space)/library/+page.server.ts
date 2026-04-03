/**
 * Organization Library Page - Server Load
 *
 * Fetches user's library scoped to this organization.
 * Redirects unauthenticated users to login.
 * Data structure matches the root (platform) library for component reuse.
 */

import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const LIBRARY_LIMIT = 12;

/** Map URL sort param to API sortBy value */
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
  parent,
}) => {
  setHeaders(CACHE_HEADERS.PRIVATE);

  if (!locals.user) {
    redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  const { org } = await parent();

  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );
  const sortParam = url.searchParams.get('sort') ?? 'recent';
  const sortBy = parseSortParam(sortParam);

  const api = createServerApi(platform, cookies);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(LIBRARY_LIMIT));
  params.set('sortBy', sortBy);
  params.set('organizationId', org.id);

  try {
    const library = await api.access.getUserLibrary(params);
    return {
      library: library ?? {
        items: [],
        pagination: { page: 1, limit: LIBRARY_LIMIT, total: 0, totalPages: 0 },
      },
      sort: sortParam,
      error: false,
      errorCode: null as string | null,
    };
  } catch (err) {
    const { ApiError } = await import('$lib/server/errors');
    const code = err instanceof ApiError ? String(err.status) : 'UNKNOWN';
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load org library [${code}]: ${msg}`);
    return {
      library: {
        items: [],
        pagination: { page: 1, limit: LIBRARY_LIMIT, total: 0, totalPages: 0 },
      },
      sort: sortParam,
      error: true,
      errorCode: code,
    };
  }
};
