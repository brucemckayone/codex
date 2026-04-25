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
import { getPublicCreators } from '$lib/remote/org.remote';
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
  page: number,
  creatorId: string | undefined
) {
  const params = new URLSearchParams();
  params.set('organizationId', orgId);
  params.set('status', 'published');
  if (q) params.set('search', q);
  if (contentType) params.set('contentType', contentType);
  if (creatorId) params.set('creatorId', creatorId);
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
  const creatorUsername = url.searchParams.get('creator') ?? undefined;

  // Resolve creator username → userId + profile for the banner.
  // We reuse getPublicCreators (KV-cached upstream, returns up to 100 members) rather
  // than adding a username-specific endpoint. Typical orgs have <20 creators, so the
  // cost of the broader fetch is negligible and it keeps the backend surface small.
  let creator: {
    id: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    bio: string | null;
    socialLinks: {
      website?: string;
      twitter?: string;
      youtube?: string;
      instagram?: string;
    } | null;
    role: string;
    contentCount: number;
  } | null = null;
  if (creatorUsername) {
    try {
      const creators = await getPublicCreators({
        slug: org.slug,
        limit: 100,
      });
      const match = creators?.items?.find(
        (c) => c.username === creatorUsername
      );
      if (match) {
        creator = {
          id: match.id,
          name: match.name,
          username: match.username,
          avatarUrl: match.avatarUrl,
          bio: match.bio,
          socialLinks: match.socialLinks,
          role: match.role,
          contentCount: match.contentCount,
        };
      }
    } catch {
      // Degrade gracefully — unknown creator just means we don't render the banner
      // and don't filter the content (defensive: avoids an empty-grid dead-end).
      creator = null;
    }
  }

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

    // Cache sort-based browse queries (no search, no creator filter) — popularity
    // shifts slowly (3min TTL). Search + creator-filtered queries bypass cache: they
    // have too many variants, so caching would just pollute KV.
    //
    // Cache uses id=COLLECTION_ORG_CONTENT(orgId) so auth sorts share the
    // same version key as the public list. One publish-side
    // cache.invalidate(COLLECTION_ORG_CONTENT(orgId)) stales every cached
    // auth-sort combo atomically. `type` carries the per-combo differentiator.
    const shouldCache = !q && !creator && platform?.env?.CACHE_KV;
    if (shouldCache) {
      const cache = new VersionedCache({
        kv: platform.env.CACHE_KV as KVNamespace,
      });
      const dataType = `content:auth:${sort}:${contentType ?? 'all'}:${page}`;
      contentResult = await cache.get(
        CacheType.COLLECTION_ORG_CONTENT(org.id),
        dataType,
        () =>
          fetchAuthContent(
            api,
            org.id,
            sort,
            q,
            contentType,
            page,
            creator?.id
          ),
        { ttl: 180 }
      );
    } else {
      contentResult = await fetchAuthContent(
        api,
        org.id,
        sort,
        q,
        contentType,
        page,
        creator?.id
      );
    }
  } else {
    contentResult = await getPublicContent({
      orgId: org.id,
      search: q,
      contentType,
      sort: sort as 'newest' | 'oldest' | 'title',
      page,
      limit: PAGE_LIMIT,
      creatorId: creator?.id,
    });
    // Set the public cache header only after the fetch succeeds. If
    // getPublicContent throws (4xx/5xx), the error response inherits the
    // default no-cache headers instead of poisoning the CDN.
    setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);
  }

  return {
    content: {
      items: contentResult?.items ?? [],
      total: contentResult?.pagination?.total ?? 0,
    },
    creator,
    filters: {
      q: q ?? '',
      type: contentType ?? '',
      sort,
      category: category ?? '',
      creator: creator?.username ?? '',
      page,
    },
    limit: PAGE_LIMIT,
  };
};
