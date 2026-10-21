/**
 * Who an organization's public creators list shows: its active owners,
 * admins and creators.
 *
 * Two places must agree on this. `OrganizationService.getPublicCreators`
 * READS the list, and `IdentityService` INVALIDATES each listing org's
 * cached copy when a member's card changes (Codex-kk9nv.7). If one of them
 * drifts, say a role added to the list but not to the invalidation, an org
 * keeps serving that member's old name or avatar for the cache's 4h TTL,
 * and nothing reports it. Both read the conditions from here.
 */

import type { SQL } from 'drizzle-orm';
import { eq, inArray } from 'drizzle-orm';
import { organizationMemberships } from '../schema/content';

/** The membership roles an org's public creators list shows. */
export const CREATOR_LIST_ROLES = ['owner', 'admin', 'creator'] as const;

/**
 * The conditions a membership meets to put its user on the org's public
 * creators list. Spread them into `and(...)` beside the org or user scope.
 */
export function listedCreatorConditions(): SQL[] {
  return [
    eq(organizationMemberships.status, 'active'),
    inArray(organizationMemberships.role, [...CREATOR_LIST_ROLES]),
  ];
}
