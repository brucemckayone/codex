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
 *
 * Unexported — `public.ts` calls `getCachedPublicContent` / `shouldCachePublicContentQuery`
 * with object literals and never imports the named type. Tests likewise pass
 * literals. If an external consumer needs this shape, re-export and add a
 * barrel entry.
 */
interface PublicContentCacheQuery {
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
    'sort' | 'limit' | 'page' | 'contentType' | 'slug'
  >
): string {
  const base = `content:public:${query.sort ?? 'newest'}:${query.limit ?? 20}:${query.page ?? 1}:${query.contentType ?? 'all'}`;
  // Slug is an exact-lookup dimension (content-detail pages). Include it in
  // the type suffix so distinct slugs occupy distinct data slots under the
  // shared org version key — without this they would collide. All slots
  // still share `COLLECTION_ORG_CONTENT(orgId)`, so one publish/update-side
  // invalidate stales every combo (list AND detail) atomically.
  return query.slug ? `${base}:slug:${query.slug}` : base;
}

/**
 * Returns true when the query is eligible for KV caching.
 *
 * Search and creatorId are bypassed:
 * - search: unbounded variant space, would pollute KV
 * - creatorId: lower-volume per-creator filter; skipping avoids key
 *   explosion
 *
 * Slug lookups (content-detail pages) ARE cached now that
 * `buildPublicContentCacheType` folds the slug into the data-slot key
 * (previously excluded only because the key omitted it → collisions). This
 * shields the DB for content-detail SSR — the slug path never used the
 * catalogue list cache — and is invalidated by the same org version bump as
 * every other combo. See the auth-caching decision record in
 * docs/caching-strategy.md.
 */
export function shouldCachePublicContentQuery(
  query: PublicContentCacheQuery
): boolean {
  return !query.search && !query.creatorId;
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
