/**
 * Organization explore page - server load
 *
 * Extracts URL filter/search/pagination params and fetches content.
 * Auth-aware: authenticated users get additional sort options (viewCount, purchaseCount)
 * via the authenticated content endpoint; unauthenticated users use the public endpoint.
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import { getPublicContent } from '$lib/remote/content.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

const VALID_TYPES = ['video', 'audio', 'written'] as const;
const VALID_SORTS = [
  'newest',
  'oldest',
  'title',
  'popular',
  'top-selling',
] as const;
const AUTH_ONLY_SORTS = new Set(['popular', 'top-selling']);
const AUTH_SORT_MAP: Record<string, { sortBy: string; sortOrder: string }> = {
  popular: { sortBy: 'viewCount', sortOrder: 'desc' },
  'top-selling': { sortBy: 'purchaseCount', sortOrder: 'desc' },
};
const PAGE_LIMIT = 12;

async function fetchAuthContent(
  api: ReturnType<typeof createServerApi>,
  orgId: string,
  sort: string,
  q: string | undefined,
  contentType: string | undefined,
  page: number
) {
  const params = new URLSearchParams();
  params.set('organizationId', orgId);
  params.set('status', 'published');
  if (q) params.set('search', q);
  if (contentType) params.set('contentType', contentType);
  params.set('sortBy', AUTH_SORT_MAP[sort].sortBy);
  params.set('sortOrder', AUTH_SORT_MAP[sort].sortOrder);
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  return api.content.list(params);
}

export const load: PageServerLoad = async ({
  url,
  setHeaders,
  parent,
  locals,
  platform,
  cookies,
}) => {
  const { org } = await parent();

  // Extract and validate URL search params
  const q = url.searchParams.get('q') ?? undefined;
  const typeParam = url.searchParams.get('type');
  const sortParam = url.searchParams.get('sort');
  const pageParam = url.searchParams.get('page');
  const category = url.searchParams.get('category') ?? undefined;

  const contentType = VALID_TYPES.includes(
    typeParam as (typeof VALID_TYPES)[number]
  )
    ? (typeParam as (typeof VALID_TYPES)[number])
    : undefined;

  let sort = VALID_SORTS.includes(sortParam as (typeof VALID_SORTS)[number])
    ? (sortParam as (typeof VALID_SORTS)[number])
    : 'newest';

  // Downgrade auth-only sorts for unauthenticated users
  if (AUTH_ONLY_SORTS.has(sort) && !locals.user) {
    sort = 'newest';
  }

  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  // Fork API call: authenticated endpoint for popularity/sales sort, public otherwise
  let contentResult: {
    items?: unknown[];
    pagination?: { total?: number };
  } | null = null;
  if (AUTH_ONLY_SORTS.has(sort) && locals.user) {
    setHeaders(CACHE_HEADERS.PRIVATE);
    const api = createServerApi(platform, cookies);

    // Cache sort-based browse queries (no search) — popularity shifts slowly (3min TTL).
    // Search queries bypass cache: too dynamic, key space explodes.
    const shouldCache = !q && platform?.env?.CACHE_KV;
    if (shouldCache) {
      const cacheId = `${org.id}:${sort}:${contentType ?? 'all'}:${page}`;
      const cache = new VersionedCache({
        kv: platform.env.CACHE_KV as KVNamespace,
      });
      contentResult = await cache.get(
        cacheId,
        CacheType.ORG_CONTENT_SORTED,
        () => fetchAuthContent(api, org.id, sort, q, contentType, page),
        { ttl: 180 }
      );
    } else {
      contentResult = await fetchAuthContent(
        api,
        org.id,
        sort,
        q,
        contentType,
        page
      );
    }
  } else {
    setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);
    contentResult = await getPublicContent({
      orgId: org.id,
      search: q,
      contentType,
      sort: sort as 'newest' | 'oldest' | 'title',
      page,
      limit: PAGE_LIMIT,
    });
  }

  return {
    content: {
      items: contentResult?.items ?? [],
      total: contentResult?.pagination?.total ?? 0,
    },
    filters: {
      q: q ?? '',
      type: contentType ?? '',
      sort,
      category: category ?? '',
      page,
    },
    limit: PAGE_LIMIT,
  };
};
