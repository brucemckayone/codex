/**
 * `listMembers` says whether each member has a creator account
 * (`hasCreatorAccount`, Codex-2hxff.76).
 *
 * A revenue-share proposal names only a member whose PLATFORM role can enter
 * the creators' Studio (`STUDIO_ROLES`: creator, admin, platform_owner).
 * Joining an organisation leaves the platform role alone, so the membership
 * role says nothing about it. The Revenue share roster reads this field to
 * show "Needs a creator account first" instead of Propose. It is a boolean,
 * never the role itself, because the list goes to every member.
 *
 * Real DB. The local database is shared with other sessions, so every row
 * hangs off this file's own organisation and users, deleted in afterAll.
 */

import * as schema from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationService } from '../organization-service';

describe('OrganizationService.listMembers: hasCreatorAccount (Codex-2hxff.76)', () => {
  let db: Database;
  let orgId: string;
  const userIds: string[] = [];
  /** Membership role, platform role, and the answer expected. */
  const cases = [
    { membershipRole: 'owner', platformRole: 'creator', expected: true },
    { membershipRole: 'creator', platformRole: 'creator', expected: true },
    { membershipRole: 'admin', platformRole: 'admin', expected: true },
    {
      membershipRole: 'member',
      platformRole: 'platform_owner',
      expected: true,
    },
    { membershipRole: 'creator', platformRole: 'customer', expected: false },
    { membershipRole: 'member', platformRole: 'customer', expected: false },
  ];

  beforeAll(async () => {
    db = setupTestDatabase();
    userIds.push(...(await seedTestUsers(db, cases.length)));
    const [org] = await db
      .insert(schema.organizations)
      .values({
        name: 'Creator Account Org',
        slug: createUniqueSlug('creator-account'),
      })
      .returning({ id: schema.organizations.id });
    if (!org) throw new Error('organisation not seeded');
    orgId = org.id;
    for (const [index, c] of cases.entries()) {
      const userId = userIds[index] as string;
      await db
        .update(schema.users)
        .set({ role: c.platformRole })
        .where(eq(schema.users.id, userId));
      await db.insert(schema.organizationMemberships).values({
        organizationId: orgId,
        userId,
        role: c.membershipRole,
        status: 'active',
      });
    }
  });

  afterAll(async () => {
    await db
      .delete(schema.organizationMemberships)
      .where(eq(schema.organizationMemberships.organizationId, orgId));
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await teardownTestDatabase();
  });

  it('is true exactly for the platform roles that can enter the creators Studio', async () => {
    const service = new OrganizationService({ db, environment: 'test' });
    const { items } = await service.listMembers(orgId, { page: 1, limit: 20 });

    expect(items).toHaveLength(cases.length);
    for (const [index, c] of cases.entries()) {
      const item = items.find((m) => m.userId === userIds[index]);
      expect(
        item?.hasCreatorAccount,
        `${c.membershipRole} with platform role ${c.platformRole}`
      ).toBe(c.expected);
    }
  });

  it('never sends the platform role itself', async () => {
    const service = new OrganizationService({ db, environment: 'test' });
    const { items } = await service.listMembers(orgId, { page: 1, limit: 20 });
    for (const item of items) {
      expect(Object.keys(item)).not.toContain('platformRole');
      // `role` is the MEMBERSHIP role, never the platform one.
      expect(['owner', 'creator', 'admin', 'member']).toContain(item.role);
    }
  });
});
