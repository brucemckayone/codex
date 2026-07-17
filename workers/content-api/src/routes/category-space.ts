/**
 * Category Space Resolution + Management Gate
 *
 * Extracted from `categories.ts` so the security-critical owner/admin gate is
 * unit-testable WITHOUT a worker request or a live KV/DB. The route injects the
 * real `checkOrganizationMembership`; tests inject a fake to assert the gate
 * falsifiably (member/owner/admin/non-member → resolved space or ForbiddenError).
 */

import { ForbiddenError } from '@codex/service-errors';

/** Resolved, management-authorized space a category operation targets. */
export interface CategoryManagementSpace {
  /** Present for an org-owned space; absent for a personal creator space. */
  organizationId?: string;
  /** Owning/authoring creator — always the authenticated caller. */
  creatorId: string;
}

/**
 * Minimal membership shape the gate needs. Structurally satisfied by the
 * `OrganizationMembership` returned by `checkOrganizationMembership`.
 */
export interface MembershipLike {
  role: string;
}

/** Org-membership lookup, injected so the gate is testable without KV/DB. */
export type MembershipChecker = (
  organizationId: string,
  userId: string
) => Promise<MembershipLike | null>;

/** Org roles allowed to CURATE categories (edit/delete/reorder/cover) — mirrors
 * `requireOrgManagement`. List + create are open to any ACTIVE member. */
const MANAGEMENT_ROLES = new Set(['owner', 'admin']);

/**
 * Shared space resolver + org gate.
 *
 * ORG space (`organizationId` supplied): the caller MUST be an active member.
 * `checkOrganizationMembership` only ever returns ACTIVE memberships (it filters
 * status='active' and returns null otherwise), so a non-null result IS an active
 * member — the gate is fail-closed. When `requireManagement` is set, the member
 * additionally needs an owner/admin role (curation).
 *
 * Applied manually (rather than via `requireOrgManagement` / `requireOrgMembership`)
 * because category routes ALSO serve the PERSONAL creator space (no org), where
 * those policies would wrongly reject the request for lacking an org. The same
 * audited `checkOrganizationMembership` backs every path.
 *
 * PERSONAL space (no `organizationId`): auth-and-self — the space is the
 * caller's own creator id and the service scopes every query to it.
 *
 * @throws {ForbiddenError} when an org is supplied but the caller is not an
 *   active member (or, for curation, not an owner/admin).
 */
async function resolveCategorySpace(params: {
  organizationId: string | undefined;
  userId: string;
  checkMembership: MembershipChecker;
  requireManagement: boolean;
}): Promise<CategoryManagementSpace> {
  const { organizationId, userId, checkMembership, requireManagement } = params;

  if (!organizationId) {
    return { creatorId: userId };
  }

  const membership = await checkMembership(organizationId, userId);
  if (!membership) {
    throw new ForbiddenError(
      'Organization membership required to access categories',
      { organizationId, userId }
    );
  }
  if (requireManagement && !MANAGEMENT_ROLES.has(membership.role)) {
    throw new ForbiddenError(
      'Organization management permission required to curate categories',
      { organizationId, userId }
    );
  }

  return { organizationId, creatorId: userId };
}

/**
 * Curation gate (PATCH / DELETE / reorder / cover): org space requires an
 * owner/admin member; personal space is auth-and-self.
 */
export function resolveManagedCategorySpace(params: {
  organizationId: string | undefined;
  userId: string;
  checkMembership: MembershipChecker;
}): Promise<CategoryManagementSpace> {
  return resolveCategorySpace({ ...params, requireManagement: true });
}

/**
 * Member gate (list / create): org space requires any ACTIVE member (creator /
 * editor included — supports WP-5's content-form multiselect listing + inline
 * quick-add); personal space is auth-and-self.
 */
export function resolveMemberCategorySpace(params: {
  organizationId: string | undefined;
  userId: string;
  checkMembership: MembershipChecker;
}): Promise<CategoryManagementSpace> {
  return resolveCategorySpace({ ...params, requireManagement: false });
}
