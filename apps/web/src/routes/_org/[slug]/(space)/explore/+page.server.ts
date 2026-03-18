/**
 * Organization explore page - server load
 * Extracts URL filter/search/pagination params and fetches public content.
 * Sets public cache headers for edge caching.
 */
import { getPublicContent } from '$lib/remote/content.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const VALID_TYPES = ['video', 'audio', 'written'] as const;
const VALID_SORTS = ['newest', 'oldest', 'title'] as const;
const PAGE_LIMIT = 12;

export const load: PageServerLoad = async ({ url, setHeaders, parent }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const { org } = await parent();

  // Extract and validate URL search params
  const q = url.searchParams.get('q') ?? undefined;
  const typeParam = url.searchParams.get('type');
  const sortParam = url.searchParams.get('sort');
  const pageParam = url.searchParams.get('page');

  const contentType = VALID_TYPES.includes(
    typeParam as (typeof VALID_TYPES)[number]
  )
    ? (typeParam as (typeof VALID_TYPES)[number])
    : undefined;
  const sort = VALID_SORTS.includes(sortParam as (typeof VALID_SORTS)[number])
    ? (sortParam as (typeof VALID_SORTS)[number])
    : 'newest';
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const contentResult = await getPublicContent({
    orgId: org.id,
    search: q,
    contentType,
    sort,
    page,
    limit: PAGE_LIMIT,
  });

  return {
    content: {
      items: contentResult?.items ?? [],
      total: contentResult?.pagination?.total ?? 0,
    },
    filters: {
      q: q ?? '',
      type: contentType ?? '',
      sort,
      page,
    },
    limit: PAGE_LIMIT,
  };
};
