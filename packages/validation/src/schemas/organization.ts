import { z } from 'zod';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * Organization Member Management Schemas
 */

/**
 * Runtime guard for organization member roles. Mirrors the
 * `organizationMembers.role` CHECK constraint in @codex/database and the
 * `OrgMemberRole` type in @codex/shared-types/member-types.ts. Used to
 * narrow `string`-typed role values flowing across worker boundaries
 * (e.g. identity-api membership lookup) without an unguarded `as` cast.
 */
export const orgMemberRoleSchema = z.enum([
  'owner',
  'admin',
  'creator',
  'member',
  'subscriber',
]);

/**
 * Schema for inviting a member to an organization
 */
export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email format'),
  role: z.enum(['admin', 'creator', 'member']),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Schema for updating a member's role
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'creator', 'member']),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Schema for listing members with optional filters
 */
export const listMembersQuerySchema = paginationSchema.extend({
  role: z
    .enum(['owner', 'admin', 'creator', 'subscriber', 'member'])
    .optional(),
  status: z.enum(['active', 'inactive', 'invited']).optional(),
});

export type ListMembersQueryInput = z.infer<typeof listMembersQuerySchema>;

/**
 * Schema for public members query parameters
 * Extends pagination with optional role filter for public endpoint
 */
export const publicMembersQuerySchema = paginationSchema.extend({
  role: z
    .enum(['owner', 'admin', 'creator', 'subscriber', 'member'])
    .optional(),
});

export type PublicMembersQueryInput = z.infer<typeof publicMembersQuerySchema>;
