/**
 * Portal (journey) public-read cache wiring — the sibling of `public-cache.ts`.
 *
 * WHY THIS EXISTS: the org landing page serves its content, categories, stats
 * and creators from KV cache-aside, but the two PORTAL rails beside them hit
 * Postgres on every render. This module gives the portal reads the same
 * treatment so the whole landing page shares one caching model (Codex-72k55).
 *
 * CONTRACT (identical in shape to `public-cache.ts`): the `id` arg of
 * `cache.get` is ALWAYS `CacheType.COLLECTION_ORG_JOURNEYS(orgId)`, so every
 * read variant for an org shares ONE version key and a single
 * `bumpOrgJourneysVersion` stales them all in one atomic KV write. The `type`
 * arg carries the per-variant differentiator. Getting this backwards is the bug
 * `public-cache.ts` documents: putting the variant in `id` fragments the version
 * namespace, and the write-side invalidate then never reaches the reader.
 *
 * WHY ITS OWN VERSION KEY (not `COLLECTION_ORG_CONTENT`): a portal card is part
 * page, part course and part content — `stageCount`/`practiceCount` come from
 * `loadPublishedCurriculumCounts`, which counts only practices whose content is
 * PUBLISHED. So a content publish MUST reach these lists. Sharing the content
 * key would achieve that for free, but would also make every portal publish
 * stale every cached content filter combo in the org. `CATEGORIES(orgId)` is the
 * established answer to exactly this trade-off: own key, and the content-side
 * bump helper invalidates it too.
 */

import { CacheType, VersionedCache } from '@codex/cache';
import type { Logger } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';

/**
 * TTL for cached portal discovery lists (seconds).
 *
 * Matched to `public-cache.ts`'s 300s so the rails on one landing page cannot
 * drift apart in age — a portals rail 5 minutes fresher than the catalogue it
 * sits beside is a confusing surface to debug. CDN `Cache-Control` is tighter
 * (60s) to bound edge drift, same as the public content routes.
 */
export const PUBLIC_JOURNEYS_CACHE_TTL = 300;

/**
 * `Cache-Control` for the PUBLIC portal reads.
 *
 * Applied PER ROUTE, never as a router-wide `app.use('*')` — unlike `public.ts`,
 * whose router is public end-to-end, `journeys.ts` mixes public reads with
 * `auth: 'required'` (`/enrolled`) and `requireOrgManagement` (`/studio/*`)
 * routes on the SAME Hono app. A blanket public header there would invite a
 * shared cache to store one member's enrolled shelf and serve it to the next
 * visitor, because CDNs key by URL and NOT by Cookie.
 */
export const PUBLIC_JOURNEYS_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';

/**
 * The ONLY paths on the journeys router that may carry a shared-cache header —
 * an explicit allow-list, matched exactly.
 *
 * Deliberately not expressed as a Hono path pattern. `/courses` and
 * `/courses/:courseId/dashboard` share a prefix but not a security posture: the
 * bare list is public chrome, while the dashboard returns curriculum data gated
 * on `canEnterCourse`. A `'/courses/*'` middleware would mark the entitlement-
 * gated read publicly cacheable, and CDNs key by URL and NOT by Cookie — so the
 * first entitled member's curriculum would be served to everyone who followed.
 * Matching the full pathname against this set is immune to that class of
 * mistake, and fails CLOSED: a route added later carries no public header until
 * someone adds it here deliberately.
 *
 * Paths are absolute (mount prefix included) because Hono's `c.req.path` is the
 * request pathname; the router is mounted at `/api/journeys` in `index.ts`.
 */
const PUBLIC_PORTAL_READ_PATHS = new Set([
  '/api/journeys/published',
  '/api/journeys/courses',
]);

/**
 * True when `pathname` is a fully public, org-scoped portal read that a shared
 * cache may store. Exported for the wiring test — the allow-list is a security
 * boundary, so it is asserted directly rather than only through the middleware.
 */
export function isPublicPortalRead(pathname: string): boolean {
  return PUBLIC_PORTAL_READ_PATHS.has(pathname);
}

/**
 * Builds the per-variant cache `type` suffix for the portal discovery list.
 *
 * `featured` and `limit` both select a strict subset, so each distinct pair must
 * occupy its own data slot under the shared org version key. `featured` is the
 * dimension that matters most: the landing page reads the list TWICE in one
 * render — once `featured: true` for Editor's picks and once unfiltered for the
 * portals rail — so a key omitting it would have the two rails serving each
 * other's rows (the exact latent bug `buildPublicContentCacheType` records for
 * content's `featured`).
 */
export function buildPublishedJourneysCacheType(query: {
  featured?: boolean | null;
  limit?: number | null;
}): string {
  return `journeys:published:${query.featured ? 'featured' : 'all'}:${
    query.limit ?? 'default'
  }`;
}

/**
 * Cache-aside wrapper for the public portal discovery list
 * (`GET /api/journeys/published`).
 */
export async function getCachedPublishedJourneys<T>(
  cache: VersionedCache,
  orgId: string,
  query: { featured?: boolean | null; limit?: number | null },
  fetcher: () => Promise<T>,
  opts: { ttl?: number } = {}
): Promise<T> {
  return cache.get(
    CacheType.COLLECTION_ORG_JOURNEYS(orgId),
    buildPublishedJourneysCacheType(query),
    fetcher,
    { ttl: opts.ttl ?? PUBLIC_JOURNEYS_CACHE_TTL }
  );
}

/**
 * Cache-aside wrapper for the published-COURSE card list
 * (`GET /api/journeys/courses`, the /explore portals rail).
 *
 * A different projection of the same rows as `getCachedPublishedJourneys`
 * (`CourseCardSummary` vs `JourneyCardView`), so it takes its own data slot but
 * deliberately shares the org version key — one write-side bump stales the
 * landing rails and the explore rail together. Unifying the two endpoints is a
 * separate concern; sharing the key means they can never disagree about
 * freshness in the meantime.
 */
export async function getCachedPublishedCourses<T>(
  cache: VersionedCache,
  orgId: string,
  fetcher: () => Promise<T>,
  opts: { ttl?: number } = {}
): Promise<T> {
  return cache.get(
    CacheType.COLLECTION_ORG_JOURNEYS(orgId),
    'journeys:courses:published',
    fetcher,
    { ttl: opts.ttl ?? PUBLIC_JOURNEYS_CACHE_TTL }
  );
}

/**
 * Bump the org's portal version in KV after a write that changes a portal card.
 * Fire-and-forget via `waitUntil` — mirrors `bumpOrgContentVersion` in
 * `content.ts`, including its swallow-and-warn posture: a failed invalidation
 * costs at most `PUBLIC_JOURNEYS_CACHE_TTL` of staleness and must never fail the
 * write that already succeeded.
 *
 * Unlike `bumpOrgContentVersion` this does NOT touch the slug-keyed org caches
 * (public info / stats / creators). Those report `contentCount` and member
 * counts, which a portal write does not change — a portal is a course plus a
 * page, and neither is content. Invalidating them here would throw away a
 * 30-minute branding cache on every cover upload for no gain.
 *
 * Call AFTER the DB write has succeeded, never before (@codex/cache rules).
 */
export function bumpOrgJourneysVersion(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  organizationId: string | null | undefined,
  obs?: Logger
): void {
  if (!organizationId || !env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: env.CACHE_KV });
  executionCtx.waitUntil(
    cache
      .invalidate(CacheType.COLLECTION_ORG_JOURNEYS(organizationId))
      .catch((err: unknown) => {
        obs?.warn('Portal cache invalidation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
  );
}
