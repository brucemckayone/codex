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
import { userIdSchema, uuidSchema } from '@codex/validation';
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

      const membership = await checkOrganizationMembership(
        orgId,
        userId,
        ctx.env,
        ctx.obs
      );

      if (!membership) {
        return { role: null, joinedAt: null };
      }

      return {
        role: membership.role as MembershipLookupResponse['role'],
        joinedAt: membership.joinedAt.toISOString(),
      };
    },
  })
);

export default app;
