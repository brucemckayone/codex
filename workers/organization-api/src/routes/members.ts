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

import type { HonoEnv } from '@codex/shared-types';
import {
  inviteMemberSchema,
  listMembersQuerySchema,
  updateMemberRoleSchema,
  uuidSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { z } from 'zod';

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
      return await ctx.services.organization.listMembers(
        ctx.input.params.id,
        ctx.input.query
      );
    },
  })
);

/**
 * POST /api/organizations/:id/members/invite
 * Invite a user to the organization by email
 *
 * Body: { email, role }
 * Returns: Created membership (201)
 * Security: Authenticated, org membership required
 */
app.post(
  '/invite',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      params: z.object({ id: uuidSchema }),
      body: inviteMemberSchema,
    },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.organization.inviteMember(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

/**
 * PATCH /api/organizations/:id/members/:userId
 * Update a member's role
 *
 * Body: { role }
 * Returns: Updated membership (200)
 * Security: Authenticated, org membership required
 */
app.patch(
  '/:userId',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      params: z.object({ id: uuidSchema, userId: z.string().min(1) }),
      body: updateMemberRoleSchema,
    },
    handler: async (ctx) => {
      return await ctx.services.organization.updateMemberRole(
        ctx.input.params.id,
        ctx.input.params.userId,
        ctx.input.body.role
      );
    },
  })
);

/**
 * DELETE /api/organizations/:id/members/:userId
 * Remove a member from the organization
 *
 * Returns: 204 No Content
 * Security: Authenticated, org membership required
 */
app.delete(
  '/:userId',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      params: z.object({ id: uuidSchema, userId: z.string().min(1) }),
    },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.organization.removeMember(
        ctx.input.params.id,
        ctx.input.params.userId
      );
      return null;
    },
  })
);

export default app;
