/**
 * Public Content Endpoints
 *
 * Unauthenticated endpoints for browsing published content.
 *
 * Endpoints:
 * - GET /api/content/public - List published content for an organization (requires orgId or slug)
 * - GET /api/content/public/discover - Browse all published content platform-wide (discover page)
 */

import { VersionedCache } from '@codex/cache';
import type { ContentWithRelations } from '@codex/content';
import {
  discoverContentQuerySchema,
  publicContentQuerySchema,
} from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import {
  getCachedPublicContent,
  shouldCachePublicContentQuery,
} from './public-cache';

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

      const fetchContent = async () => {
        const result = await ctx.services.content.listPublic(ctx.input.query);
        return new PaginatedResult(
          resolveR2Urls(result.items, ctx.env.R2_PUBLIC_URL_BASE),
          result.pagination
        );
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
        const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
        return getCachedPublicContent(
          cache,
          orgId,
          ctx.input.query,
          fetchContent
        );
      }

      return fetchContent();
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
