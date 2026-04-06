/**
 * Public Content Endpoints
 *
 * Unauthenticated endpoints for browsing published content.
 *
 * Endpoints:
 * - GET /api/content/public - List published content for an organization (requires orgId or slug)
 * - GET /api/content/public/discover - Browse all published content platform-wide (discover page)
 */

import type { ContentWithRelations } from '@codex/content';
import {
  discoverContentQuerySchema,
  publicContentQuerySchema,
} from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

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
          hlsPreviewUrl:
            item.mediaItem.hlsPreviewKey && r2Base
              ? `${r2Base}/${item.mediaItem.hlsPreviewKey}`
              : null,
        }
      : null,
  }));
}

/**
 * Cache-Control middleware for public content endpoints
 * Sets a 5-minute public cache for CDN and browser caching
 */
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=300');
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
      const result = await ctx.services.content.listPublic(ctx.input.query);
      return new PaginatedResult(
        resolveR2Urls(result.items, ctx.env.R2_PUBLIC_URL_BASE),
        result.pagination
      );
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
