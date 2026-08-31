/**
 * Membership Lookup Endpoint
 *
 * Resolves a user's role within an organization for internal service use.
 * Called by SvelteKit server hooks to determine user permissions on org subdomains.
 *
 * Endpoints:
 * - GET /:orgId/membership/:userId - Look up membership role
 *
 * Security: Worker-to-worker HMAC authentication required (WORKER_SHARED_SECRET)
 */

import type { HonoEnv, MembershipLookupResponse } from '@codex/shared-types';
import {
  orgMemberRoleSchema,
  userIdSchema,
  uuidSchema,
} from '@codex/validation';
import { checkOrganizationMembership, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

/**
 * GET /:orgId/membership/:userId
 * Look up a user's membership role in an organization
 *
 * Returns { role, joinedAt } if member, or { role: null, joinedAt: null } if not.
 */
app.get(
  '/:orgId/membership/:userId',
  procedure({
    policy: { auth: 'worker' },
    input: {
      params: z.object({
        orgId: uuidSchema,
        userId: userIdSchema,
      }),
    },
    handler: async (ctx): Promise<MembershipLookupResponse> => {
      const { orgId, userId } = ctx.input.params;

      // Argument 5 is `ctx.cacheWrite`, and it is not optional in practice.
      // On a miss `checkOrganizationMembership` writes its
      // `membership:{orgId}:{userId}` KV entry as the last thing it does, and a
      // Worker cancels every unawaited promise the moment the response is
      // returned — so with the argument omitted that `kv.put` is routinely
      // killed before KV sees it, the next lookup misses again, and a cache
      // whose whole purpose is to remove a ~46ms Neon round trip removes none
      // of them. `helpers.ts` threads the same handle for the `procedure()`
      // policy path (Codex-345hg); this route is the OTHER caller, and the one
      // where a miss is genuinely a miss: it resolves an ARBITRARY `userId` on
      // a worker-to-worker hop, not the caller's own, so nothing upstream has
      // already warmed the entry.
      const membership = await checkOrganizationMembership(
        orgId,
        userId,
        ctx.env,
        ctx.obs,
        ctx.cacheWrite
      );

      if (!membership) {
        return { role: null, joinedAt: null };
      }

      return {
        role: orgMemberRoleSchema.parse(membership.role),
        joinedAt: membership.joinedAt.toISOString(),
      };
    },
  })
);

/**
 * GET /:orgId/my-membership
 * Get the authenticated user's own membership in an organization
 *
 * Returns { role, status, joinedAt } if member, or null if not.
 */
app.get(
  '/:orgId/my-membership',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({
        orgId: uuidSchema,
      }),
    },
    handler: async (ctx) => {
      return await ctx.services.identity.getMyMembership(
        ctx.input.params.orgId,
        ctx.user.id
      );
    },
  })
);

export default app;
