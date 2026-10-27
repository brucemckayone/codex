/**
 * Who an organization's public creators list shows: its active owners,
 * admins and creators whose accounts are not deleted.
 *
 * Two places must agree on this. `OrganizationService.getPublicCreators`
 * READS the list, and `IdentityService` INVALIDATES each listing org's
 * cached copy when a member's card changes (Codex-kk9nv.7). If one of them
 * drifts, say a role added to the list but not to the invalidation, an org
 * keeps serving that member's old name or avatar for the cache's 4h TTL,
 * and nothing reports it. Both read the conditions from here.
 */

import type { SQL } from 'drizzle-orm';
import { eq, inArray, sql } from 'drizzle-orm';
import { organizationMemberships } from '../schema/content';
import { users } from '../schema/users';

/** The membership roles an org's public creators list shows. */
export const CREATOR_LIST_ROLES = ['owner', 'admin', 'creator'] as const;

/**
 * The membership half of {@link listedCreatorConditions}: an active owner,
 * admin or creator, whatever their account. Only for account deletion, which
 * reads the orgs that list the user after its scrub has marked the account
 * deleted, so the account condition no longer holds (Codex-kk9nv.8).
 */
export function listedMembershipConditions(): SQL[] {
  return [
    eq(organizationMemberships.status, 'active'),
    inArray(organizationMemberships.role, [...CREATOR_LIST_ROLES]),
  ];
}

/**
 * The conditions a membership meets to put its user on the org's public
 * creators list. Spread them into `and(...)` beside the org or user scope.
 */
export function listedCreatorConditions(): SQL[] {
  return [
    ...listedMembershipConditions(),
    // Deleting an account ends its memberships (Codex-kk9nv.8), but one
    // deleted before that, or by any other path, still is not listed. A
    // subquery rather than a join, so a caller that counts memberships alone
    // needs no join to agree with the list.
    sql`exists (select 1 from ${users} where ${users.id} = ${organizationMemberships.userId} and ${users.deletedAt} is null)`,
  ];
}
