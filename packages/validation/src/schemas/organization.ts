import { z } from 'zod';
import { paginationSchema } from '../shared/pagination-schema';

/**
 * Organization Member Management Schemas
 */

/**
 * Schema for inviting a member to an organization
 */
export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email format'),
  role: z.enum(['admin', 'creator', 'member'], {
    errorMap: () => ({
      message: "Role must be 'admin', 'creator', or 'member'",
    }),
  }),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Schema for updating a member's role
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'creator', 'member'], {
    errorMap: () => ({
      message: "Role must be 'owner', 'admin', 'creator', or 'member'",
    }),
  }),
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
