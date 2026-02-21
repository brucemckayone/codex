/**
 * Organization creators directory page - server load
 * Fetches paginated list of public creators for the organization
 */

import { ApiError } from '$lib/api/errors';
import { getOrgCreators } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const ssr = true;

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { slug } = params;
  // Validate page parameter to ensure it's always >= 1
  const pageParam = url.searchParams.get('page');
  const page = Math.max(1, Number(pageParam ?? '1'));

  try {
    const result = await getOrgCreators({ slug, page, limit: 12 });

    return {
      creators: result?.items ?? [],
      pagination: {
        page: result?.pagination?.page ?? 1,
        totalPages: result?.pagination?.totalPages ?? 0,
        total: result?.pagination?.total ?? 0,
      },
      error: null,
    };
  } catch (err) {
    // Log actual error for debugging while returning user-friendly message
    console.error('Failed to load org creators:', err);

    // Preserve ApiError messages when available
    const errorMessage =
      err instanceof ApiError ? err.message : 'Failed to load creators';

    return {
      creators: [],
      pagination: { page: 1, totalPages: 0, total: 0 },
      error: errorMessage,
    };
  }
};
