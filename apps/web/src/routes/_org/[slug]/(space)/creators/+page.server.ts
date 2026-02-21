/**
 * Organization creators directory page - server load
 * Fetches paginated list of public creators for the organization
 */
import { getOrgCreators } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const ssr = true;

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { slug } = params;
  const page = Number(url.searchParams.get('page') ?? '1');

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
    return {
      creators: [],
      pagination: { page: 1, totalPages: 0, total: 0 },
      error: 'Failed to load creators',
    };
  }
};
