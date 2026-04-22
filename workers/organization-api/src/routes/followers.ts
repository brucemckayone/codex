/**
 * Organization Follower Endpoints
 *
 * RESTful API for free audience relationships (follow/unfollow).
 * Separate from membership (team roles: owner/admin/creator).
 *
 * Mounted at: /api/organizations/:id/followers
 *
 * Endpoints:
 * - POST   /       - Follow an organization (auth required)
 * - DELETE /       - Unfollow an organization (auth required)
 * - GET    /count  - Get follower count (public)
 */

import { CacheType, VersionedCache } from '@codex/cache';
import type { HonoEnv } from '@codex/shared-types';
import { uuidSchema } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Bump one user's library KV version key (Codex-c01do).
 *
 * Follow/unfollow toggles access to `followers`-gated content on the org.
 * Library UI needs to reflect the change immediately — without this bump,
 * the follower-gated items stay with stale access flags until the next
 * visibility-change staleness roundtrip.
 *
 * Fire-and-forget via waitUntil.
 */
function bumpUserLibrary(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  userId: string
): void {
  if (!env.CACHE_KV || !userId) return;
  const cache = new VersionedCache({ kv: env.CACHE_KV });
  executionCtx.waitUntil(
    cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId)).catch(() => {})
  );
}

const app = new Hono<HonoEnv>();

/**
 * POST /api/organizations/:id/followers
 * Follow an organization (idempotent — no error if already following).
 *
 * Security: Authenticated
 */
app.post(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    successStatus: 201,
    handler: async (ctx) => {
      await ctx.services.organization.followOrganization(
        ctx.input.params.id,
        ctx.user.id
      );
      // Codex-c01do — follow unlocks follower-gated content; bump the
      // actor's library cache so their UI reflects access changes on next
      // load.
      bumpUserLibrary(ctx.env, ctx.executionCtx, ctx.user.id);
      return null;
    },
  })
);

/**
 * DELETE /api/organizations/:id/followers
 * Unfollow an organization (idempotent — no error if not following).
 *
 * Security: Authenticated
 */
app.delete(
  '/',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    handler: async (ctx) => {
      await ctx.services.organization.unfollowOrganization(
        ctx.input.params.id,
        ctx.user.id
      );
      // Codex-c01do — unfollow revokes follower-gated access; bump the
      // actor's library cache so their UI reflects the change.
      bumpUserLibrary(ctx.env, ctx.executionCtx, ctx.user.id);
      return null;
    },
  })
);

/**
 * GET /api/organizations/:id/followers/me
 * Check if the authenticated user is following this organization.
 *
 * Security: Authenticated
 */
app.get(
  '/me',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: uuidSchema }) },
    handler: async (ctx) => {
      const following = await ctx.services.organization.isFollowing(
        ctx.input.params.id,
        ctx.user.id
      );
      return { following };
    },
  })
);

/**
 * GET /api/organizations/:id/followers/count
 * Get the total follower count for an organization (public).
 *
 * Security: None (public endpoint)
 */
app.get(
  '/count',
  procedure({
    policy: { auth: 'optional' },
    input: { params: z.object({ id: uuidSchema }) },
    handler: async (ctx) => {
      const count = await ctx.services.organization.getFollowerCount(
        ctx.input.params.id
      );
      return { count };
    },
  })
);

export default app;
