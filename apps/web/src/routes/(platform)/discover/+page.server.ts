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

const SORT_VALUES = ['newest', 'oldest', 'title'] as const;
type SortValue = (typeof SORT_VALUES)[number];

const TYPE_VALUES = ['video', 'audio', 'written'] as const;
type TypeValue = (typeof TYPE_VALUES)[number];

function parseSort(raw: string | null): SortValue {
  return (SORT_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as SortValue)
    : 'newest';
}

function parseType(raw: string | null): TypeValue | undefined {
  return (TYPE_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as TypeValue)
    : undefined;
}

export const load: PageServerLoad = async ({
  platform,
  cookies,
  url,
  setHeaders,
}) => {
  const api = createServerApi(platform, cookies);

  const search = url.searchParams.get('q')?.slice(0, 200) ?? '';
  const sort = parseSort(url.searchParams.get('sort'));
  const type = parseType(url.searchParams.get('type'));

  const pageParam = url.searchParams.get('page');
  const pageNum = pageParam
    ? Math.max(1, Math.min(100, parseInt(pageParam, 10) || 1))
    : undefined;

  const params = new URLSearchParams();
  params.set('sort', sort);
  if (search) params.set('search', search);
  if (type) params.set('contentType', type);
  if (pageNum) params.set('page', String(pageNum));

  const filters = { q: search, type: type ?? 'all', sort } as const;

  // PRIVATE (not DYNAMIC_PUBLIC) — the (platform) layout renders the
  // auth-aware SidebarRailUserSection into the SSR HTML, and shared
  // caches key by URL alone. A `public, s-maxage=300` response cached
  // during an anonymous visit would otherwise be served to subsequent
  // authenticated visitors, hiding their avatar trigger. CI's miniflare
  // cache emulation made this deterministic (CF-Cache-Status: HIT served
  // anon HTML to the auth test in nav-redesign/a11y-responsive).
  try {
    const content = await api.content.getDiscoverContent(params);
    setHeaders(CACHE_HEADERS.PRIVATE);
    return {
      content: content ?? EMPTY_CONTENT,
      search,
      filters,
      error: false,
    };
  } catch (err) {
    logger.warn('Failed to load discover content', {
      error: err instanceof Error ? err.message : String(err),
    });
    setHeaders(CACHE_HEADERS.PRIVATE);
    return {
      content: EMPTY_CONTENT,
      search,
      filters,
      error: true,
    };
  }
};
