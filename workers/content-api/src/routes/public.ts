/**
 * Public Content Endpoints
 *
 * Unauthenticated endpoints for browsing published content.
 *
 * Endpoints:
 * - GET /api/content/public - List published content for an organization (requires orgId or slug)
 * - GET /api/content/public/discover - Browse all published content platform-wide (discover page)
 */

import { CacheType, VersionedCache } from '@codex/cache';
import type { ContentWithRelations } from '@codex/content';
import {
  discoverContentQuerySchema,
  publicContentQuerySchema,
} from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { uuidSchema, z } from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { resolveCategoryCoverUrl } from './category-cover-url';
import {
  getCachedPublicContent,
  shouldCachePublicContentQuery,
} from './public-cache';

/** TTL for the public topic-categories list (seconds). Invalidated on category
 * mutation AND content publish/unpublish/delete, so this is a safety net. */
const PUBLIC_CATEGORIES_CACHE_TTL = 300;

const publicCategoriesQuerySchema = z.object({ orgId: uuidSchema });

const app = new Hono<HonoEnv>();

/** Resolve raw R2 keys to full CDN URLs — clients must never see raw keys */
function resolveR2Urls(
  items: ContentWithRelations[],
  r2Base: string | undefined
) {
  return items.map((item) => ({
    ...item,
    mediaItem: item.mediaItem
      ? {
          ...item.mediaItem,
          thumbnailUrl:
            item.mediaItem.thumbnailKey && r2Base
              ? `${r2Base}/${item.mediaItem.thumbnailKey}`
              : null,
          hlsPreviewUrl:
            item.mediaItem.hlsPreviewKey && r2Base
              ? `${r2Base}/${item.mediaItem.hlsPreviewKey}`
              : null,
        }
      : null,
  }));
}

/**
 * Cache-Control middleware for public content endpoints.
 *
 * Set to 60s (s-maxage=60 for CDN) so edge drift stays bounded now that
 * the KV layer has working event-driven invalidation. A longer window
 * would let CDN-cached responses serve stale content up to max-age after
 * publish, defeating the invalidation. See public-cache.ts for the KV
 * layer's invalidation contract.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
});

/**
 * GET /api/content/public
 * List published content for an organization (requires orgId or slug)
 *
 * Security: Public endpoint, API rate limit. Schema enforces org scoping.
 * Cache: 5 minute public cache for CDN/browser
 * @returns {PublicContentListResponse}
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'none', rateLimit: 'api' },
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
      const fetchContent = async () => {
        const result = await ctx.services.content.listPublic(ctx.input.query);
        return {
          items: resolveR2Urls(result.items, ctx.env.R2_PUBLIC_URL_BASE),
          pagination: result.pagination,
        };
      };

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
        const cache = new VersionedCache({
          kv: ctx.env.CACHE_KV,
          waitUntil: (p) => ctx.executionCtx.waitUntil(p),
        });
        const cached = await getCachedPublicContent(
          cache,
          orgId,
          ctx.input.query,
          fetchContent
        );
        return new PaginatedResult(cached.items, cached.pagination);
      }

      const uncached = await fetchContent();
      return new PaginatedResult(uncached.items, uncached.pagination);
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
 * ≥1-published set). CDN Cache-Control from the shared middleware above.
 */
app.get(
  '/categories',
  procedure({
    policy: { auth: 'none', rateLimit: 'api' },
    input: { query: publicCategoriesQuerySchema },
    handler: async (ctx) => {
      const { orgId } = ctx.input.query;
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

      if (ctx.env.CACHE_KV) {
        const cache = new VersionedCache({
          kv: ctx.env.CACHE_KV,
          waitUntil: (p) => ctx.executionCtx.waitUntil(p),
        });
        return cache.get(
          CacheType.CATEGORIES(orgId),
          'public:topics',
          fetchCategories,
          { ttl: PUBLIC_CATEGORIES_CACHE_TTL }
        );
      }

      return fetchCategories();
    },
  })
);

/**
 * GET /api/content/public/discover
 * Browse all published content platform-wide (discover page)
 *
 * Security: Public endpoint, API rate limit. No org scoping — intentionally platform-wide.
 * Cache: 5 minute public cache for CDN/browser
 * @returns {PublicContentListResponse}
 */
app.get(
  '/discover',
  procedure({
    policy: { auth: 'none', rateLimit: 'api' },
    input: { query: discoverContentQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.content.listPublic(ctx.input.query);
      return new PaginatedResult(
        resolveR2Urls(result.items, ctx.env.R2_PUBLIC_URL_BASE),
        result.pagination
      );
    },
  })
);

export default app;
