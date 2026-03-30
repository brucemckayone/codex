/**
 * Public Content Endpoints
 *
 * Unauthenticated endpoints for browsing published content.
 * Used by org landing and explore pages to display content to visitors.
 *
 * Endpoints:
 * - GET /api/content/public - List published content for an organization
 */

import type { PublicContentListResponse } from '@codex/content';
import { publicContentQuerySchema } from '@codex/content';
import type { HonoEnv } from '@codex/shared-types';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

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
 * List published content for an organization (no auth required)
 *
 * Security: Public endpoint, API rate limit
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
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

export default app;
