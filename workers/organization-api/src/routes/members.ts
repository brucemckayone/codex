/**
 * Organization Member Management Endpoints
 *
 * RESTful API for managing organization members.
 * All routes require authentication and org membership.
 *
 * Mounted at: /api/organizations/:id/members
 *
 * Endpoints:
 * - GET    /                - List members with filters
 * - POST   /invite          - Invite a member by email
 * - PATCH  /:userId         - Update member role
 * - DELETE /:userId         - Remove member
 */

import type { WaitUntilFn } from '@codex/cache';
import {
  invalidateUserLibrary as invalidateUserLibraryShared,
  VersionedCache,
} from '@codex/cache';
import { createDbClient } from '@codex/database';
import type { Logger } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import {
  inviteMemberSchema,
  listMembersQuerySchema,
  updateMemberRoleSchema,
  userIdSchema,
  uuidSchema,
} from '@codex/validation';
import {
  invalidateOrgSlugCache as invalidateOrgSlugCacheShared,
  membershipCacheKey,
  PaginatedResult,
  procedure,
  sendEmailToWorker,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

/** Context shape shared by cache-invalidation helpers */
interface CacheCtx {
  env: HonoEnv['Bindings'];
  executionCtx: { waitUntil: WaitUntilFn };
}

/**
 * Invalidate the per-user membership cache after a mutation.
 *
 * Bumps the {@link VersionedCache} version key for `${orgId}:${userId}` so
 * the next `checkOrganizationMembership()` call falls through to Neon.
 * Fire-and-forget via `waitUntil` — cache invalidation never blocks the
 * mutation response and never throws (graceful degradation).
 */
function invalidateMembershipCache(
  ctx: CacheCtx,
  orgId: string,
  userId: string
) {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
  const cacheId = membershipCacheKey(orgId, userId);
  ctx.executionCtx.waitUntil(cache.invalidate(cacheId).catch(() => {}));
}

/**
 * Invalidate slug-keyed cache (public org info, stats, creators) after
 * membership changes. Resolves slug from orgId in fire-and-forget fashion.
 *
 * R14: thin wrapper over the shared `@codex/cache` helper — preserves the
 * waitUntil dispatch and per-task swallow ergonomics expected by callers.
 */
function dispatchOrgSlugInvalidation(
  ctx: CacheCtx,
  orgId: string,
  obs?: Logger
): void {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
  const db = createDbClient(ctx.env);
  ctx.executionCtx.waitUntil(
    invalidateOrgSlugCacheShared({ db, cache, orgId, logger: obs })
  );
}

const app = new Hono<HonoEnv>();

/**
 * GET /api/organizations/:id/members
 * List organization members with pagination and optional filters
 *
 * Query: page, limit, role?, status?
 * Returns: Paginated list of members (200)
 * Security: Authenticated, org membership required
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      params: z.object({ id: uuidSchema }),
      query: listMembersQuerySchema,
    },
    handler: async (ctx) => {
      const result = await ctx.services.organization.listMembers(
        ctx.input.params.id,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/organizations/:id/members/invite
 * Invite a user to the organization by email
 *
 * Body: { email, role }
 * Returns: Created membership (201)
 * Security: Authenticated, org management (owner/admin) required
 */
app.post(
  '/invite',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema }),
      body: inviteMemberSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      const result = await ctx.services.organization.inviteMember(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );

      // Bust the per-user membership cache so the new member's next
      // `requireOrgMembership` check sees them, then invalidate public
      // org caches (creators / stats) that reflect membership.
      invalidateMembershipCache(ctx, ctx.input.params.id, result.userId);
      dispatchOrgSlugInvalidation(ctx, ctx.input.params.id, ctx.obs);
      // Invalidate invited user's library cache (Codex-c01do) — gaining a
      // management role unlocks team-only content in their library UI.
      invalidateUserLibraryShared({
        kv: ctx.env.CACHE_KV,
        waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
        userId: result.userId,
        logger: ctx.obs,
      });

      // Send invitation email (fire-and-forget)
      sendEmailToWorker(ctx.env, ctx.executionCtx, {
        to: ctx.input.body.email,
        templateName: 'org-member-invitation',
        category: 'transactional',
        data: {
          inviterName: ctx.user.name || 'A team member',
          orgName: 'the organisation', // TODO: resolve from ctx.services.organization.getById()
          roleName: ctx.input.body.role,
          acceptUrl: `${ctx.env.WEB_APP_URL || ''}/accept-invite`,
          expiryDays: '7',
        },
      });

      return result;
    },
  })
);

/**
 * PATCH /api/organizations/:id/members/:userId
 * Update a member's role
 *
 * Body: { role }
 * Returns: Updated membership (200)
 * Security: Authenticated, org management (owner/admin) required
 */
app.patch(
  '/:userId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema, userId: userIdSchema }),
      body: updateMemberRoleSchema,
    },
    handler: async (ctx) => {
      const result = await ctx.services.organization.updateMemberRole(
        ctx.input.params.id,
        ctx.input.params.userId,
        ctx.input.body.role
      );
      // Bust per-user membership cache — role changes take effect on the
      // next `requireOrgMembership` check (no longer waits up to 5 min).
      invalidateMembershipCache(
        ctx,
        ctx.input.params.id,
        ctx.input.params.userId
      );
      dispatchOrgSlugInvalidation(ctx, ctx.input.params.id, ctx.obs);
      // Invalidate the role-target user's library cache (Codex-c01do) — role
      // changes toggle management-content access.
      invalidateUserLibraryShared({
        kv: ctx.env.CACHE_KV,
        waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
        userId: ctx.input.params.userId,
        logger: ctx.obs,
      });
      return result;
    },
  })
);

/**
 * DELETE /api/organizations/:id/members/:userId
 * Remove a member from the organization
 *
 * Returns: 204 No Content
 * Security: Authenticated, org management (owner/admin) required
 */
app.delete(
  '/:userId',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema, userId: userIdSchema }),
    },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.organization.removeMember(
        ctx.input.params.id,
        ctx.input.params.userId
      );
      // Bust per-user membership cache — the removed user's next
      // `requireOrgMembership` check refetches and sees `null`, denying access.
      invalidateMembershipCache(
        ctx,
        ctx.input.params.id,
        ctx.input.params.userId
      );
      dispatchOrgSlugInvalidation(ctx, ctx.input.params.id, ctx.obs);
      // Invalidate the removed user's library cache (Codex-c01do) — they
      // lose all management-conditional content access.
      invalidateUserLibraryShared({
        kv: ctx.env.CACHE_KV,
        waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
        userId: ctx.input.params.userId,
        logger: ctx.obs,
      });
      return null;
    },
  })
);

/**
 * GET /api/organizations/:id/members/my-membership
 * Get the current user's membership in the organization
 *
 * Returns: { role: string | null, joinedAt: string | null }
 * Security: Authenticated, org membership NOT required (allows non-members to check)
 */
app.get(
  '/my-membership',
  procedure({
    policy: { auth: 'required' }, // Note: NO requireOrgMembership - allows non-members to check
    input: {
      params: z.object({ id: uuidSchema }),
    },
    handler: async (ctx) => {
      return await ctx.services.organization.getMyMembership(
        ctx.input.params.id,
        ctx.user.id
      );
    },
  })
);

export default app;
