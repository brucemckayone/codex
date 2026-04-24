/**
 * Public Content Cache Wiring
 *
 * Extracted from the `/api/content/public` route handler so the cache
 * id/type contract can be tested directly.
 *
 * Contract: the `id` arg of `cache.get` is always
 * `CacheType.COLLECTION_ORG_CONTENT(orgId)` so every filter combo for an
 * org shares one version key. Publish-side
 * `cache.invalidate(COLLECTION_ORG_CONTENT(orgId))` (see content.ts)
 * then stales ALL cached combos in one atomic KV write.
 *
 * Prior bug (fixed): `id` was set to the filter-combo string, which
 * fragmented the version namespace so publish's invalidate never reached
 * the reader cache → stale content on home + explore pages until TTL.
 */

import { CacheType, type VersionedCache } from '@codex/cache';

/**
 * Default TTL for cached public content lists (seconds).
 * Kept at 5 min; CDN Cache-Control is tighter (60s) to bound edge drift.
 */
const PUBLIC_CONTENT_CACHE_TTL = 300;

/**
 * Public content list query shape accepted by the cache wiring.
 * Kept narrow so callers can pass the worker's validated input directly.
 */
export interface PublicContentCacheQuery {
  orgId?: string;
  sort?: string | null;
  limit?: number | null;
  page?: number | null;
  contentType?: string | null;
  search?: string | null;
  slug?: string | null;
  creatorId?: string | null;
}

/**
 * Builds the per-filter-combo cache `type` suffix.
 *
 * Distinct combos produce distinct `type` strings so they occupy separate
 * data slots under the shared org version key.
 */
export function buildPublicContentCacheType(
  query: Pick<
    PublicContentCacheQuery,
    'sort' | 'limit' | 'page' | 'contentType'
  >
): string {
  return `content:public:${query.sort ?? 'newest'}:${query.limit ?? 20}:${query.page ?? 1}:${query.contentType ?? 'all'}`;
}

/**
 * Returns true when the query is eligible for KV caching.
 *
 * Search, slug, and creatorId are bypassed:
 * - search: unbounded variant space, would pollute KV
 * - slug: exact-lookup path; cache key doesn't include slug so different
 *   slugs would collide
 * - creatorId: lower-volume per-creator filter; skipping avoids key
 *   explosion
 */
export function shouldCachePublicContentQuery(
  query: PublicContentCacheQuery
): boolean {
  return !query.search && !query.slug && !query.creatorId;
}

/**
 * Cache-aside wrapper for the public content list.
 *
 * On cache hit: returns cached result.
 * On cache miss: calls `fetcher`, caches the result, returns it.
 *
 * Every filter combo for `orgId` shares one version key
 * (`cache:version:org:{orgId}:content`) so a single publish-side
 * `cache.invalidate(COLLECTION_ORG_CONTENT(orgId))` stales them all
 * atomically.
 */
export async function getCachedPublicContent<T>(
  cache: VersionedCache,
  orgId: string,
  query: PublicContentCacheQuery,
  fetcher: () => Promise<T>,
  opts: { ttl?: number } = {}
): Promise<T> {
  return cache.get(
    CacheType.COLLECTION_ORG_CONTENT(orgId),
    buildPublicContentCacheType(query),
    fetcher,
    { ttl: opts.ttl ?? PUBLIC_CONTENT_CACHE_TTL }
  );
}
