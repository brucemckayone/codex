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
 *
 * CDN `Cache-Control` is tighter (60s) to bound edge drift — unchanged by this
 * value, the two are independent.
 *
 * RAISED 300 -> 7200 on 2026-09-07 from two production measurements, not a
 * guess. Sizing a TTL below the gap between consumers serves NOBODY: the slot is
 * always dead by the next visitor, so every read pays 2 KV reads + 1 KV write +
 * a Neon wake to store rows nobody reads back.
 *
 * Window 1 (6h14m after the stats gauge deployed): aggregate 83.9%, but marginal
 * overnight traffic hit at exactly 50% — reader clusters 12–83 min apart.
 * Window 2 (10h16m, the full post-deploy window): 79.3% aggregate, 25.0% over
 * the last 4h, and content-api specifically went 0-for-7 — a literal 0% hit rate
 * across four hours. Cluster gaps were ~26, 26, 27, 53, 79, 80, 80 min, i.e. a
 * MEDIAN of ~53 min. So 1800 would have covered 3 of those 7 gaps and 3600 only
 * 4; 7200 covers all seven.
 *
 * Why 2h is safe, and why the first draft of this note was wrong. The TTL is
 * only ever the backstop for a FAILED `bumpOrgContentVersion` (it runs inside
 * `waitUntil` and swallows its errors) — normal operation is unaffected, because
 * publish/unpublish/delete stales this immediately via the org version key, an
 * invariant now asserted end to end in `content-publish-invalidation.test.ts`.
 * An earlier draft justified 30 min as "identical to the window the slug-keyed
 * org reads already lived with", but the same change raised
 * `ORG_PUBLIC_INFO_SECONDS` from 30 min to 4h — so it argued from a ceiling it
 * had itself just replaced. 4h is the system's real failed-bump ceiling, and 2h
 * sits inside it, introducing no new staleness bound anywhere.
 *
 * MUST stay equal to `PUBLIC_JOURNEYS_CACHE_TTL` — see the note there.
 */
const PUBLIC_CONTENT_CACHE_TTL = 7200;

/**
 * The shape of a cached item. Bump it whenever listPublic's projection NARROWS
 * (a column or relation dropped, a field stripped). The data-slot key encodes
 * the query, not the payload, so without a bump every slot written by the old
 * code stays a valid hit after deploy and keeps serving what was removed, for
 * up to the TTL. v2 (Codex-osuqt): no creator email, and no body on a
 * catalogue read. v3 (Codex-039vo): no body on a by-slug read of a gated row,
 * which a course-only practice flagged free used to keep. Old slots are never
 * read again and age out. A bump also renames the cache-stats series
 * (`cacheStatsLabel` keeps four segments, so `content:public:newest` became
 * `content:public:v2:newest`, and now `content:public:v3:newest`).
 */
const PUBLIC_CONTENT_SHAPE_VERSION = 'v3';

/**
 * KV refuses a key over 512 bytes. A data-slot key is this type plus about 70
 * bytes (its prefix, the org's version id and a version stamp), so a type past
 * this budget, which only a long slug reaches, made every such read a KV error:
 * an error-level log any visitor could raise with a URL (Codex-osuqt). A read
 * that long skips KV; a real slug is far shorter.
 */
const MAX_CACHED_TYPE_BYTES = 400;

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
  category?: string | null;
  featured?: boolean | null;
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
    'sort' | 'limit' | 'page' | 'contentType' | 'slug' | 'category' | 'featured'
  >
): string {
  const base = `content:public:${PUBLIC_CONTENT_SHAPE_VERSION}:${query.sort ?? 'newest'}:${query.limit ?? 20}:${query.page ?? 1}:${query.contentType ?? 'all'}`;
  let type = base;
  // Category (topic slug) and featured are LIVE filter dimensions that select a
  // strict subset of the catalogue. Each distinct value MUST occupy its own
  // data slot or a filtered read collides with a broader one under the shared
  // org version key. `featured` in particular was the latent bug: it is already
  // a live query param, but the prior key omitted it — so `?featured=true`
  // (Editor's picks) and the unfiltered list shared one slot and served each
  // other's content. Both are appended ONLY when present, so an absent
  // dimension adds nothing to the key.
  if (query.category) {
    type += `:cat:${query.category}`;
  }
  if (query.featured !== undefined && query.featured !== null) {
    type += `:feat:${query.featured}`;
  }
  // Slug is an exact-lookup dimension (content-detail pages). Kept last so
  // distinct slugs occupy distinct data slots under the shared org version key
  // — without this they would collide. All slots still share
  // `COLLECTION_ORG_CONTENT(orgId)`, so one publish/update-side invalidate
  // stales every combo (list AND detail) atomically.
  if (query.slug) {
    type += `:slug:${query.slug}`;
  }
  return type;
}

/**
 * Returns true when the query is eligible for KV caching.
 *
 * Search and creatorId are bypassed:
 * - search: unbounded variant space, would pollute KV
 * - creatorId: a correctness rule, not tuning. The data-slot key carries no
 *   creator, so a creator-filtered org read cached here would collide with
 *   the org-wide slot and serve the whole org's list (or seed that slot with
 *   one creator's pieces).
 *
 * Slug lookups (content-detail pages) ARE cached now that
 * `buildPublicContentCacheType` folds the slug into the data-slot key
 * (previously excluded only because the key omitted it → collisions). This
 * shields the DB for content-detail SSR — the slug path never used the
 * catalogue list cache — and is invalidated by the same org version bump as
 * every other combo. See the auth-caching decision record in
 * docs/caching-strategy.md.
 *
 * `category` (topic slug) and `featured` are bounded-cardinality filters that
 * the key now folds in, so they stay cache-eligible (no bypass) — the landing
 * "Browse by topic" and Editor's-picks reads share the org version key and hit
 * the same one-write invalidation as every other combo.
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
 * A type over MAX_CACHED_TYPE_BYTES skips KV entirely and returns `fetcher()`.
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
  const type = buildPublicContentCacheType(query);
  if (new TextEncoder().encode(type).length > MAX_CACHED_TYPE_BYTES) {
    return fetcher();
  }
  return cache.get(CacheType.COLLECTION_ORG_CONTENT(orgId), type, fetcher, {
    ttl: opts.ttl ?? PUBLIC_CONTENT_CACHE_TTL,
  });
}
