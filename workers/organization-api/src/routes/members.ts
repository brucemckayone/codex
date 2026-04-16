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

import { VersionedCache } from '@codex/cache';
import { createDbClient, eq, schema } from '@codex/database';
import type { HonoEnv } from '@codex/shared-types';
import {
  inviteMemberSchema,
  listMembersQuerySchema,
  updateMemberRoleSchema,
  userIdSchema,
  uuidSchema,
} from '@codex/validation';
import {
  PaginatedResult,
  procedure,
  sendEmailToWorker,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Invalidate KV-cached membership check for a specific user+org pair.
 *
 * The membership cache is keyed as `org:{orgId}:member:{userId}` (see
 * `checkOrganizationMembership` in org-helpers.ts).  After any membership
 * mutation we bump the version so the next request falls through to the DB.
 */
function invalidateMembershipCache(
  ctx: {
    env: { CACHE_KV?: unknown };
    executionCtx: { waitUntil(p: Promise<unknown>): void };
  },
  orgId: string,
  userId: string
) {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV as import('@cloudflare/workers-types').KVNamespace,
  });
  const cacheId = `org:${orgId}:member:${userId}`;
  ctx.executionCtx.waitUntil(cache.invalidate(cacheId).catch(() => {}));
}

/**
 * Invalidate slug-keyed cache (public org info, stats, creators) after membership changes.
 * Resolves slug from orgId in fire-and-forget fashion.
 */
function invalidateOrgSlugCache(ctx: {
  env: { CACHE_KV?: unknown; ENVIRONMENT?: string };
  executionCtx: { waitUntil(p: Promise<unknown>): void };
  input: { params: { id: string } };
}) {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV as import('@cloudflare/workers-types').KVNamespace,
  });
  ctx.executionCtx.waitUntil(
    (async () => {
      try {
        const db = createDbClient(
          ctx.env as Parameters<typeof createDbClient>[0]
        );
        const org = await db.query.organizations.findFirst({
          where: eq(schema.organizations.id, ctx.input.params.id),
          columns: { slug: true },
        });
        if (org?.slug) {
          await cache.invalidate(org.slug);
        }
      } catch {
        // Non-critical — slug cache expires via TTL
      }
    })()
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

      // Invalidate membership + public creators caches
      invalidateMembershipCache(ctx, ctx.input.params.id, result.userId);
      invalidateOrgSlugCache(ctx);

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
      invalidateMembershipCache(
        ctx,
        ctx.input.params.id,
        ctx.input.params.userId
      );
      invalidateOrgSlugCache(ctx);
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
      invalidateMembershipCache(
        ctx,
        ctx.input.params.id,
        ctx.input.params.userId
      );
      invalidateOrgSlugCache(ctx);
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
