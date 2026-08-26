/**
 * Organization explore page - server load
 *
 * Extracts URL filter/search/pagination params and fetches content.
 * Auth-aware: authenticated users get additional sort options (viewCount, purchaseCount)
 * via the authenticated content endpoint; unauthenticated users use the public endpoint.
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import type { CourseCardSummary } from '$lib/journeys/types';
import { getPublicCategories } from '$lib/remote/categories.remote';
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
  category: string | undefined,
  page: number,
  creatorId: string | undefined
) {
  const params = new URLSearchParams();
  params.set('organizationId', orgId);
  params.set('status', 'published');
  if (q) params.set('search', q);
  if (contentType) params.set('contentType', contentType);
  // `category` is part of contentQuerySchema, so the browse endpoint honours
  // it. Omitting it here meant a signed-in user on an auth-only sort got a
  // URL and a chip claiming a category filter over a completely unfiltered
  // result set. `featured` is NOT in that schema — see the sort downgrade in
  // `load` for how that combination is kept honest instead.
  if (category) params.set('category', category);
  if (creatorId) params.set('creatorId', creatorId);
  params.set('sortBy', AUTH_SORT_MAP[sort].sortBy);
  params.set('sortOrder', AUTH_SORT_MAP[sort].sortOrder);
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  // Browse-mode endpoint: org-scoped, NOT creator-scoped. The studio
  // `api.content.list` returns only the signed-in user's content, which
  // is the wrong shape for /explore (the catalogue spans creators).
  return api.content.browse(params);
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
  // `?category=` carries a category SLUG, never a display name. Both filter
  // paths match `categories.slug` (content-service's membership subquery), and
  // `publicContentQueryParamsSchema.category` only accepts the slug charset
  // `^[\p{L}\p{N}-]+$` — a display name with a space or `&` ("Ancestral
  // Medicine", "Sound & Vibration") makes the whole page 400. The category
  // strip renders `categoryOptions` below, which carries name+slug pairs, so
  // the label the user reads and the value the URL carries stay separate.
  const category = url.searchParams.get('category') ?? undefined;
  const creatorUsername = url.searchParams.get('creator') ?? undefined;
  const featuredParam = url.searchParams.get('featured');
  const featured = featuredParam === 'true' ? true : undefined;

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

  // The authenticated browse endpoint (contentQuerySchema) has no `featured`
  // filter, so a popular/top-selling sort could not honour one — it silently
  // returned the whole catalogue while the URL and the chip both claimed
  // "Featured". Between the two intents the FILTER is the explicit ask, so the
  // sort yields: we fall through to the public branch, which does filter by
  // featured. `filters.sort` below returns the downgraded value, so the drawer
  // shows the sort that was actually applied rather than the one that wasn't.
  // Widening the browse schema + service is the real fix (cross-package).
  if (AUTH_ONLY_SORTS.has(sort) && featured) {
    sort = 'newest';
  }

  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  // ── Category strip options ────────────────────────────────────────
  // The org's TAXONOMY, deliberately NOT scraped from the loaded items. Three
  // defects came from deriving the strip from `item.category`:
  //   1. `content.category` is a legacy free-text DISPLAY NAME, while both
  //      filter paths match `categories.slug`. Writing the display name to
  //      `?category=` returned zero results for every single-word category and
  //      a full HTTP 400 error page for every one containing a space or `&`,
  //      since `publicContentQueryParamsSchema.category` only accepts the slug
  //      charset `^[\p{L}\p{N}-]+$`.
  //   2. `items` is server-filtered BY category, so options derived from it
  //      collapsed to just the active one on selection — moving from Ceremony
  //      to Healing cost a round trip through "All".
  //   3. Options only reflected the 12 items on the current page, so any
  //      multi-page org under-reported its own taxonomy.
  // `getPublicCategories` is the authority: org-scoped, KV-cached under
  // CATEGORIES(orgId), ordered by the curator's `sortOrder`, restricted to
  // categories with ≥1 published item, and it carries the name+slug pair the
  // strip needs to LABEL with a name while WRITING a slug.
  //
  // Kicked off HERE, awaited at the bottom, so its round trip overlaps the
  // content fetch instead of adding a serial hop to a public page's critical
  // path. `.catch()` is attached AT CREATION, not only at the await: an awaited
  // rejection would otherwise be in flight, unhandled, for the whole duration of
  // the content fetch. A taxonomy failure degrades to no strip and can never
  // fail the page — the content read owns that.
  const categoryOptionsPromise: Promise<Array<{ name: string; slug: string }>> =
    getPublicCategories(org.id)
      .then((rows) =>
        (rows ?? []).map((row) => ({ name: row.name, slug: row.slug }))
      )
      .catch(() => []);

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
      // Every param that varies the RESULT must vary the key, or two filter
      // combinations read each other's cached payload.
      const dataType = `content:auth:${sort}:${contentType ?? 'all'}:${category ?? 'all'}:${page}`;
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
            category,
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
        category,
        page,
        creator?.id
      );
    }
  } else {
    contentResult = await getPublicContent({
      orgId: org.id,
      search: q,
      contentType,
      category,
      sort: sort as 'newest' | 'oldest' | 'title',
      page,
      limit: PAGE_LIMIT,
      creatorId: creator?.id,
      featured,
    });
    // Auth-varying HTML (the org layout injects `user`), so this must not be
    // shared-cached: shared caches key by URL, NOT by Cookie, and would serve
    // the anonymous copy to signed-in users. The list DATA is still KV-cached
    // in content-api (and above), so PRIVATE costs an SSR render, not a query.
    // See docs/caching-strategy.md §HTTP/CDN caching.
    setHeaders(CACHE_HEADERS.PRIVATE);
  }

  // Journeys rail (SPEC §8.5) — the org's PUBLISHED courses as public discovery
  // cards. A SEPARATE public read from the content grid: it's SEO-relevant on
  // this public page so it's awaited, but resilient — a failure degrades to an
  // empty rail and NEVER interferes with the content-path cache headers above
  // (which own the poisoning guard). Runs AFTER the content fetch/setHeaders, so
  // it cannot reorder or gate them.
  let journeys: CourseCardSummary[] = [];
  try {
    const journeysApi = createServerApi(platform, cookies);
    journeys = (await journeysApi.access.listPublishedCourses(org.id)) ?? [];
  } catch {
    journeys = [];
  }

  // Awaited (not streamed) because the strip is page structure and the active
  // chip's label resolves from it — a streamed strip would pop in after first
  // paint and briefly render the slug instead of the name. The round trip was
  // already started above, so this await costs only whatever is left of it.
  const categoryOptions = await categoryOptionsPromise;

  return {
    content: {
      items: contentResult?.items ?? [],
      total: contentResult?.pagination?.total ?? 0,
    },
    journeys,
    categoryOptions,
    creator,
    filters: {
      q: q ?? '',
      type: contentType ?? '',
      sort,
      category: category ?? '',
      creator: creator?.username ?? '',
      featured: featured === true,
      page,
    },
    limit: PAGE_LIMIT,
  };
};
