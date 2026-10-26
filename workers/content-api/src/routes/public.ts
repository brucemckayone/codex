/**
 * Public Content Endpoints
 *
 * Unauthenticated endpoints for browsing published content.
 *
 * Endpoints:
 * - GET /api/content/public - List published content for an organization or a creator (requires orgId, creatorId or slug)
 * - GET /api/content/public/discover - Browse all published content platform-wide (discover page)
 */

import { CacheType, logCacheStats, VersionedCache } from '@codex/cache';
import {
  discoverContentQuerySchema,
  publicContentQuerySchema,
} from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { orgIdQuerySchema, z } from '@codex/validation';
import { cachedRead, PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { resolveCategoryCoverUrl } from './category-cover-url';
import {
  getCachedPublicContent,
  shouldCachePublicContentQuery,
} from './public-cache';
import { resolveR2PublicBases, toPublicItems } from './r2-public-urls';

/**
 * TTL for the public topic-categories list (seconds). Invalidated on category
 * mutation AND content publish/unpublish/delete, so this is a safety net —
 * which is precisely why it can be long.
 *
 * Raised 300 -> 7200 on 2026-09-07 alongside the content and portal rails; see
 * `PUBLIC_CONTENT_CACHE_TTL` for the production measurement (overnight readers
 * 26–80 min apart, median ~53, so a 5 minute slot never survived to serve the
 * next one). The topic list is the SLOWEST-changing of the three: it only shifts
 * when a category gains or loses its last published item.
 */
const PUBLIC_CATEGORIES_CACHE_TTL = 7200;

// Lowercased: the id keys the topics cache, which org delete invalidates under
// the lowercase DB id (see orgIdQuerySchema).
const publicCategoriesQuerySchema = z.object({ orgId: orgIdQuerySchema });

const app = new Hono<HonoEnv>();

/**
 * WHY EVERY ROUTE BELOW DECLARES `cache: 'public'` RATHER THAN THIS ROUTER
 * CARRYING AN `app.use('*')`.
 *
 * There used to be one here, setting `public, max-age=60, s-maxage=60` after
 * `await next()`. It emitted the right bytes and was safe on THIS router (every
 * route is `auth: 'none'`), but it was safe by coincidence of the file's current
 * contents: the next `auth: 'required'` route added to `public.ts` would have
 * been stamped publicly cacheable on the way out, and shared caches key on URL
 * and NEVER on Cookie. `policy.cache` moves the decision onto the route that
 * knows the answer, and `procedure()` emits the header centrally
 * (`resolveCacheControl`), defaulting an undeclared route to `private`. There is
 * no wildcard mount left to mis-scope, and the preset strings live in one place
 * (`CACHE_PRESETS` in `@codex/constants`) instead of being retyped per router.
 *
 * THE 60s IN THAT PRESET IS BOUNDED BY THE INVALIDATION MECHANISM, NOT BY THE
 * HIT RATE — the argument the deleted docstring carried, and it still applies to
 * exactly these routes. Content freshness here is event-driven: a publish bumps
 * one KV version and every `VersionedCache` entry for the org stales at once
 * (`public-cache.ts` holds that contract). No such event can reach a CDN or a
 * browser — an HTTP cache only expires on the clock — so a shared-cache window
 * is a window during which a publish is INVISIBLE, and it must not outlive the
 * mechanism that is supposed to make the publish visible. 60s is the value this
 * router chose on those grounds and the value `CACHE_PRESETS.public` now carries
 * platform-wide.
 */

/**
 * GET /api/content/public
 * List published content for an organization, or for one creator across
 * every org they publish in and their personal space (requires orgId,
 * creatorId or slug). The creator form backs their public profile
 * (Codex-osuqt).
 *
 * Security: Public endpoint, API rate limit. Schema enforces an org, creator
 * or slug scope.
 * Cache: `public` — the body is a PUBLISHED catalogue page, identical
 * for every viewer (no session is read; `auth: 'none'` means none is even
 * resolved), so any shared cache may serve one visitor's copy to the next. 60s
 * browser + CDN, bounded by the KV invalidation window above. A query naming a
 * creator is never KV-cached (`shouldCachePublicContentQuery` skips it), so
 * its 60s CDN window is its only cache, as for /discover, and a publish shows
 * on the profile within 60s. The docstring
 * used to say "5 minute public cache"; the header it sat over has emitted 60s
 * since the KV layer's event-driven invalidation landed, and now says so.
 * @returns {PublicContentListResponse}
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'none', rateLimit: 'api', cache: 'public' },
    input: { query: publicContentQuerySchema },
    handler: async (ctx) => {
      const { orgId } = ctx.input.query;

      // Returns a PLAIN `{ items, pagination }`, NOT a PaginatedResult.
      //
      // Codex-e32xz: this fetcher used to build the `PaginatedResult` itself and
      // hand it straight to `cache.get`, which round-trips it through
      // JSON.stringify/parse. A cache HIT therefore returned a plain object,
      // `procedure()`'s `result instanceof PaginatedResult` check failed, and
      // the list envelope silently degraded to `{ data: { items, pagination } }`
      // — breaking every client of this endpoint. It was invisible only because
      // the data slot never landed, so there was never a hit. Cache the plain
      // shape and re-wrap AFTER the cache, exactly as
      // `organization-api /public/:slug/creators` already does.
      //
      // The cache holds the narrowed ROWS, and the wire items are built after
      // it: a URL built inside the fetcher froze a missing CDN base into the
      // slot as a null poster for its whole TTL, warned about only on a miss.
      const fetchContent = async () => {
        const result = await ctx.services.content.listPublic(ctx.input.query);
        return { items: result.items, pagination: result.pagination };
      };
      const toWire = (rows: Awaited<ReturnType<typeof fetchContent>>) =>
        new PaginatedResult(
          toPublicItems(rows.items, resolveR2PublicBases(ctx.env), ctx.obs),
          rows.pagination
        );

      // KV cache-aside for org-scoped browse queries only.
      // getCachedPublicContent keys every filter combo under a shared
      // version (COLLECTION_ORG_CONTENT(orgId)) so one publish-side
      // invalidate stales them all. See public-cache.ts.
      if (
        orgId &&
        shouldCachePublicContentQuery(ctx.input.query) &&
        ctx.env.CACHE_KV
      ) {
        // `waitUntil` is REQUIRED on a read path (Codex-e32xz) — without it the
        // data-slot put is cancelled when the response returns.
        //
        // This site keeps its own construction rather than moving to
        // `cachedRead`: `getCachedPublicContent` takes a CACHE deliberately, so
        // that its id/type contract can be asserted directly in
        // public-cache.test.ts, and that contract is the fix for a real
        // fragmentation bug (see the module comment there). Re-shaping it around
        // a ctx would rewrite those assertions to prove less. So `obs` is passed
        // here and the stats emitted after the read instead.
        const cache = new VersionedCache({
          kv: ctx.env.CACHE_KV,
          waitUntil: (p) => ctx.executionCtx.waitUntil(p),
          obs: ctx.obs,
        });
        const cached = await getCachedPublicContent(
          cache,
          orgId,
          ctx.input.query,
          fetchContent
        );
        if (ctx.obs) {
          logCacheStats(cache, ctx.obs, { cacheType: 'public:content' });
        }
        return toWire(cached);
      }

      return toWire(await fetchContent());
    },
  })
);

/**
 * GET /api/content/public/categories
 * List an org's published topic categories for the landing "Browse by topic".
 *
 * Returns ORG-space categories that have ≥1 published content item, ordered by
 * the curator's `sortOrder`. Raw R2 cover keys are never exposed — the md
 * variant is resolved to a CDN URL.
 *
 * Security: Public endpoint, API rate limit. Requires orgId.
 * Cache: KV cache-aside under CATEGORIES(orgId) — invalidated on category
 * mutation AND on content publish/unpublish/delete (which changes the
 * ≥1-published set). CDN `Cache-Control` is `cache: 'public'` on the policy —
 * the taxonomy is org chrome, identical for every viewer.
 */
app.get(
  '/categories',
  procedure({
    policy: { auth: 'none', rateLimit: 'api', cache: 'public' },
    input: { query: publicCategoriesQuerySchema },
    handler: async (ctx) => {
      const { orgId } = ctx.input.query;
      // ASSETS base only, deliberately: a category cover is an uploaded image
      // in the public assets bucket, never a media-bucket key. Nothing here
      // needs `resolveR2PublicBases`.
      const r2Base = ctx.env.R2_PUBLIC_URL_BASE;

      const fetchCategories = async () => {
        const rows = await ctx.services.categories.listPublicForOrg(orgId);
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          icon: row.icon,
          sortOrder: row.sortOrder,
          // Never expose the raw R2 key — resolve the md variant to a CDN URL.
          coverImageUrl: resolveCategoryCoverUrl(row.coverImageKey, r2Base),
        }));
      };

      return cachedRead(
        ctx,
        CacheType.CATEGORIES(orgId),
        'public:topics',
        fetchCategories,
        { ttl: PUBLIC_CATEGORIES_CACHE_TTL }
      );
    },
  })
);

/**
 * GET /api/content/public/discover
 * Browse all published content platform-wide (discover page)
 *
 * Security: Public endpoint, API rate limit. No org scoping — intentionally platform-wide.
 * Cache: `public` — platform-wide published content, no viewer input of any
 * kind, so the body is shared by construction. NOT KV-cached (unlike `/` above,
 * which keys on orgId): the 60s CDN window is this route's only cache, and it
 * is the same 60s bound for the same reason.
 * @returns {PublicContentListResponse}
 */
app.get(
  '/discover',
  procedure({
    policy: { auth: 'none', rateLimit: 'api', cache: 'public' },
    input: { query: discoverContentQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.content.listPublic(ctx.input.query);
      return new PaginatedResult(
        toPublicItems(result.items, resolveR2PublicBases(ctx.env), ctx.obs),
        result.pagination
      );
    },
  })
);

export default app;
