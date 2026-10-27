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
 * - GET    /:userId/departure-preview - What removing them would unwind
 */

import { invalidateUserLibrary as invalidateUserLibraryShared } from '@codex/cache';
import { ENV_NAMES } from '@codex/constants';
import { NotFoundError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import { buildOrgUrlFromEnv, type EnvName } from '@codex/urls';
import {
  type InviteMemberInput,
  inviteMemberSchema,
  listMembersQuerySchema,
  updateMemberRoleSchema,
  userIdSchema,
  uuidSchema,
} from '@codex/validation';
import {
  dispatchOrgSlugInvalidation,
  invalidateMembershipCache,
  PaginatedResult,
  procedure,
  sendEmailToWorker,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<HonoEnv>();

/**
 * What the invitation email says for each role, and where its one button
 * goes (owner decision 2026-10-27, "Open the org", Codex-bnxhw). Adding
 * someone makes them a member at once, so there is nothing to accept. An admin
 * or creator works in the org Studio. A member opens the organisation's home
 * page, because the Studio turns a member away.
 */
const INVITATION_BY_ROLE = {
  admin: { roleName: 'an admin', path: '/studio' },
  creator: { roleName: 'a creator', path: '/studio' },
  member: { roleName: 'a member', path: '/' },
} as const satisfies Record<
  InviteMemberInput['role'],
  { roleName: string; path: string }
>;

const ENV_NAME_VALUES: readonly string[] = Object.values(ENV_NAMES);

function isEnvName(value: string): value is EnvName {
  return ENV_NAME_VALUES.includes(value);
}

/**
 * GET /api/organizations/:id/members
 * List organization members with pagination and optional filters
 *
 * Query: page, limit, role?, status?
 * Returns: Paginated list of members (200)
 * Security: Authenticated, org management (owner/admin) required
 * (Codex-2hxff.82). The list carries every member's email. Membership alone
 * also admitted subscribers, who hold membership rows. Every web caller is
 * already owner or admin only (Team, Revenue share, the dashboard nudge).
 */
app.get(
  '/',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
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
      const organizationId = ctx.input.params.id;
      // Read before the invite, so a missing organisation adds nobody. The
      // email names the organisation and links to it.
      const org = await ctx.services.organization.get(organizationId);
      if (!org) {
        throw new NotFoundError('Organization not found', { organizationId });
      }

      const result = await ctx.services.organization.inviteMember(
        organizationId,
        ctx.input.body,
        ctx.user.id
      );

      // Bust the per-user membership cache so the new member's next
      // `requireOrgMembership` check sees them, then invalidate public
      // org caches (creators / stats) that reflect membership.
      invalidateMembershipCache(
        ctx,
        ctx.input.params.id,
        result.userId,
        ctx.obs
      );
      dispatchOrgSlugInvalidation(ctx, ctx.input.params.id, ctx.obs);
      // Invalidate invited user's library cache (Codex-c01do) — gaining a
      // management role unlocks team-only content in their library UI.
      invalidateUserLibraryShared({
        kv: ctx.env.CACHE_KV,
        waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
        userId: result.userId,
        logger: ctx.obs,
      });

      // Send the invitation email (fire-and-forget). Its link is built from
      // the env name, never WEB_APP_URL or a request host: the apex has no
      // Studio, and on staging `parseHost` reports the production apex.
      if (!ctx.env.ENVIRONMENT) {
        // Unset outside local dev means a misconfigured deploy: the link
        // would point at a dev host.
        ctx.obs?.warn(
          'ENVIRONMENT is unset; the invitation email links to development',
          { organizationId, userId: result.userId }
        );
      }
      const environment = ctx.env.ENVIRONMENT ?? 'development';
      if (isEnvName(environment)) {
        const invitation = INVITATION_BY_ROLE[ctx.input.body.role];
        const orgUrl = buildOrgUrlFromEnv(
          environment,
          org.slug,
          invitation.path
        );
        sendEmailToWorker(ctx.env, ctx.executionCtx, {
          to: ctx.input.body.email,
          templateName: 'org-member-invitation',
          category: 'transactional',
          userId: result.userId,
          organizationId,
          data: {
            inviterName: ctx.user.name || 'A team member',
            orgName: org.name,
            roleName: invitation.roleName,
            orgUrl,
            // Transitional, for one release (Codex-2hxff.83): the old
            // notifications-api requires these, and a template row 0117 has
            // not rewritten still renders them. Drop both once it is live.
            acceptUrl: orgUrl,
            expiryDays: '7',
          },
        });
      } else {
        // The member is added either way; only the email has no link to give.
        ctx.obs?.error(
          'Member added, but no invitation email: unknown ENVIRONMENT',
          {
            errorId: crypto.randomUUID(),
            organizationId,
            userId: result.userId,
            environment,
          }
        );
      }

      return result;
    },
  })
);

/**
 * PATCH /api/organizations/:id/members/:userId
 * Update a member's role
 *
 * Body: { role } — admin | creator | member; `owner` is not settable here.
 * Returns: Updated membership (200); 409 OWNERSHIP_TRANSFER_REQUIRED for the
 * owner (ownership moves only by transfer, Codex-2hxff.2)
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
        ctx.input.params.userId,
        ctx.obs
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
 * Returns: 204 No Content; 409 OWNERSHIP_TRANSFER_REQUIRED for the owner
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
      // That sentence is only true because `invalidateMembershipCache` DELETES
      // `membership:{orgId}:{userId}`; the reader has no version check, so a
      // bump-style invalidation leaves the removed member's cached `role`
      // readable for the full 60s TTL and this comment becomes a lie for that
      // long. Guarded by
      // `src/routes/__tests__/members-cache-invalidation.test.ts`, which
      // asserts the deleted key equals the key the reader's `kv.get` asked for
      // — and that the next check really does return `null`.
      invalidateMembershipCache(
        ctx,
        ctx.input.params.id,
        ctx.input.params.userId,
        ctx.obs
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
 * GET /api/organizations/:id/members/:userId/departure-preview
 * What removing this member would unwind, shown in the Studio's Remove dialog
 * before the owner confirms (Codex-2hxff.64)
 *
 * Returns: { data: { agreements, contentOnSale, coursesOnSale,
 *   courseSubscriptions, tierSubscribersAffected } } — counts only, scoped to
 *   this organisation and this member as creator; 404 MEMBER_NOT_FOUND if they
 *   are not a member. Not cached: read once, when the dialog opens.
 * Security: the same policy as DELETE /:userId — whoever may remove a member
 * may see what the removal does, and no one else.
 */
app.get(
  '/:userId/departure-preview',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema, userId: userIdSchema }),
    },
    handler: async (ctx) => {
      return await ctx.services.organization.getDeparturePreview(
        ctx.input.params.id,
        ctx.input.params.userId
      );
    },
  })
);

/**
 * GET /api/organizations/:id/members/my-membership
 * Get the current user's membership in the organization
 *
 * Returns: { role, joinedAt, pendingOwnershipOffer } — the last is the
 * caller's open ownership offer for this org (the Studio banner), or null
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
