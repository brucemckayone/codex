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
 * Schema for updating a member's role.
 *
 * `owner` is not settable here (Codex-2hxff.2): an organisation has exactly one
 * owner, and ownership moves only by the owner's offer being accepted
 * (`offerOwnershipSchema`) or by platform support (`reassignOwnerSchema`).
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'creator', 'member']),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Ownership transfer (Codex-2hxff.2)
 */

/**
 * The owner offers ownership to an active admin or creator. `confirmName` is
 * the organisation's name as the owner typed it; the service compares it
 * trimmed and case-insensitively, so a stale tab cannot send an offer by
 * accident.
 */
export const offerOwnershipSchema = z.object({
  recipientUserId: z.string().trim().min(1, 'Choose who to offer ownership to'),
  confirmName: z
    .string()
    .trim()
    .min(1, "Type the organisation's name to confirm")
    .max(255),
});

export type OfferOwnershipInput = z.infer<typeof offerOwnershipSchema>;

/**
 * Platform support assigns a new owner (admin-api). `reason` is logged as a
 * structured field for the audit trail; it must never carry PII.
 */
export const reassignOwnerSchema = z.object({
  userId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(500),
});

export type ReassignOwnerInput = z.infer<typeof reassignOwnerSchema>;

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
