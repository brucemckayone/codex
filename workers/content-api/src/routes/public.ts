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

/**
 * The two public hosts this route resolves keys against.
 *
 * TWO, NOT ONE, and that split is the point of the type (Codex-1g5lh.13).
 * `thumbnailKey` genuinely lives in the PUBLIC assets bucket. `hlsPreviewKey`
 * is `{creatorId}/hls/{mediaId}/preview/preview.m3u8` and lives in the PRIVATE
 * media bucket — packages/transcoding/src/paths.ts:7 documents the whole HLS
 * tree as "a single MEDIA_BUCKET", and the RunPod handler proves it by
 * uploading the entire hls_dir (preview included) to R2_BUCKET_NAME
 * (= codex-media-*) while sending only thumbnails to the assets bucket.
 *
 * Building BOTH fields from `R2_PUBLIC_URL_BASE` is what broke every public HLS
 * preview in production: that base is the assets host, served by apps/web's
 * cdn-proxy from ASSETS_BUCKET alone, so `ASSETS_BUCKET.get(previewKey)`
 * returned null and the manifest 404'd while the poster loaded fine — a play
 * affordance that does nothing, on the highest-traffic public surface.
 */
type R2PublicBases = {
  /** Public assets host — thumbnails, logos. `R2_PUBLIC_URL_BASE`. */
  assets: string | undefined;
  /** Host that serves the public 30s HLS preview prefix. */
  mediaPreview: string | undefined;
};

/**
 * Resolve the two bases from the worker bindings.
 *
 * DEFAULT, and what production runs: both are `R2_PUBLIC_URL_BASE`, because
 * apps/web's cdn-proxy now serves `{creatorId}/hls/{mediaId}/preview/` — and
 * ONLY that prefix — from a read-only media binding, so the assets host finally
 * answers for previews.
 *
 * `R2_PUBLIC_MEDIA_URL_BASE` is the seam for the other shape: a preview-only
 * host or worker route, for if the owner declines to bind the private bucket
 * into apps/web. Set it and previews move with no code change, while thumbnails
 * stay on the assets host. NEVER point both at a media host — that would 404
 * every thumbnail platform-wide, which is the trap this signature exists to
 * make hard to fall into.
 *
 * The parameter type is declared locally because `R2_PUBLIC_MEDIA_URL_BASE` is
 * not yet on `Bindings` in packages/shared-types/src/worker-types.ts (outside
 * this change); the canonical declaration belongs there, by `R2_PUBLIC_URL_BASE`.
 */
function resolveR2PublicBases(env: {
  R2_PUBLIC_URL_BASE?: string;
  R2_PUBLIC_MEDIA_URL_BASE?: string;
}): R2PublicBases {
  const assets = env.R2_PUBLIC_URL_BASE;
  return { assets, mediaPreview: env.R2_PUBLIC_MEDIA_URL_BASE ?? assets };
}

/** Resolve raw R2 keys to full CDN URLs — clients must never see raw keys */
function resolveR2Urls(items: ContentWithRelations[], bases: R2PublicBases) {
  return items.map((item) => ({
    ...item,
    mediaItem: item.mediaItem
      ? {
          ...item.mediaItem,
          thumbnailUrl:
            item.mediaItem.thumbnailKey && bases.assets
              ? `${bases.assets}/${item.mediaItem.thumbnailKey}`
              : null,
          hlsPreviewUrl:
            item.mediaItem.hlsPreviewKey && bases.mediaPreview
              ? `${bases.mediaPreview}/${item.mediaItem.hlsPreviewKey}`
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
          items: resolveR2Urls(result.items, resolveR2PublicBases(ctx.env)),
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
        resolveR2Urls(result.items, resolveR2PublicBases(ctx.env)),
        result.pagination
      );
    },
  })
);

export default app;
