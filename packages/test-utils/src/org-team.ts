/**
 * Org team test helpers (Codex-a6ofh.2.1).
 *
 * Content may be filed into an org, and published there, only by an ACTIVE
 * owner, admin or creator of it (Codex-ocal6; publish checks it too since
 * Codex-a6ofh.2.1). A fixture that inserts org content directly, bypassing
 * create(), has to seat its creator on the team itself, or the publish under
 * test refuses with NOT_ON_ORG_TEAM before it reaches the rule being tested.
 */
import { organizationMemberships } from '@codex/database/schema';
import { and, eq } from 'drizzle-orm';
import type { Database } from './database';
import { createTestMembershipInput } from './factories';

/** Put users on an org's team, as active `creator` members. */
export async function joinTeam(
  db: Database,
  organizationId: string,
  ...userIds: string[]
): Promise<void> {
  await db
    .insert(organizationMemberships)
    .values(
      userIds.map((userId) =>
        createTestMembershipInput(organizationId, userId, { role: 'creator' })
      )
    );
}

/**
 * Change one user's membership of an org: take them off the team
 * (`status: 'inactive'`), move them to its audience (`role: 'subscriber'`),
 * or put them back.
 */
export async function setTeamMembership(
  db: Database,
  organizationId: string,
  userId: string,
  change: { role?: string; status?: string }
): Promise<void> {
  await db
    .update(organizationMemberships)
    .set(change)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId)
      )
    );
}
