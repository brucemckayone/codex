/**
 * `resolvePrimaryConnect` — the org-fee settlement target must never be a
 * REMOVED owner.
 *
 * Regression guard. `OrganizationService.removeMember` tombstones a membership
 * by setting `status = 'inactive'` and leaves `role` untouched, so
 * `role='owner' AND status='inactive'` is a normal persisted state. The owner
 * fallback here filtered on `role` alone and ordered by `created_at ASC`, so
 * the earliest-joined owner won the tiebreak *permanently* — including after
 * being removed from the org. A founder who left and later onboarded Connect
 * would receive the organisation's fee slice on every purchase.
 *
 * Every sibling owner-resolver already constrained status
 * (`AgreementService.assertActiveOwner`, `getFirstActiveOwnerContact`); a
 * repo-wide census of the ten `role, 'owner'` query sites found four outliers,
 * all four on the money-routing path.
 *
 * Uses the shared Neon test DB (real schema) — the predicate under test is SQL,
 * so a mocked db would prove nothing.
 */

import {
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestMembershipInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePrimaryConnect } from '../utils/resolve-primary-connect';

/** Earlier than any owner we add, so the removed founder always wins createdAt ASC. */
const LONG_AGO = new Date('2020-01-01T00:00:00Z');
const LATER = new Date('2024-06-01T00:00:00Z');

describe('resolvePrimaryConnect — removed owners must not receive the org fee', () => {
  let db: Database;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function makeOrg(ownerId: string, label: string) {
    const [org] = await db
      .insert(organizations)
      .values({
        name: `Test Org ${label}`,
        slug: createUniqueSlug(label),
        ownerId,
      })
      .returning();
    if (!org) throw new Error('Failed to create test organization');
    return org;
  }

  it('skips a removed founder and settles on the active owner', async () => {
    const [removedFounderId, activeOwnerId] = await seedTestUsers(db, 2);
    if (!removedFounderId || !activeOwnerId) throw new Error('seed failed');

    const org = await makeOrg(activeOwnerId, 'removed-founder');

    // The founder joined FIRST and was later removed: role survives, status does not.
    await db.insert(organizationMemberships).values([
      createTestMembershipInput(org.id, removedFounderId, {
        role: 'owner',
        status: 'inactive',
        createdAt: LONG_AGO,
      }),
      createTestMembershipInput(org.id, activeOwnerId, {
        role: 'owner',
        status: 'active',
        createdAt: LATER,
      }),
    ]);

    // BOTH have onboarded Connect — so resolution, not payability, decides.
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(org.id, removedFounderId),
        createTestConnectAccountInput(org.id, activeOwnerId),
      ]);

    const account = await resolvePrimaryConnect(db, org.id);

    expect(account).toBeDefined();
    expect(account?.userId).toBe(activeOwnerId);
    expect(account?.userId).not.toBe(removedFounderId);
  });

  it('resolves to nothing when the only owner has been removed', async () => {
    const [removedFounderId, bystanderId] = await seedTestUsers(db, 2);
    if (!removedFounderId || !bystanderId) throw new Error('seed failed');

    // ownerId on the org row is vestigial for this path; membership is what counts.
    const org = await makeOrg(removedFounderId, 'only-owner-removed');

    await db.insert(organizationMemberships).values([
      createTestMembershipInput(org.id, removedFounderId, {
        role: 'owner',
        status: 'inactive',
        createdAt: LONG_AGO,
      }),
      // A remaining plain member must never be treated as a settlement target.
      createTestMembershipInput(org.id, bystanderId, {
        role: 'member',
        status: 'active',
        createdAt: LATER,
      }),
    ]);

    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(org.id, removedFounderId));

    const account = await resolvePrimaryConnect(db, org.id);

    // Better to resolve nothing (and leave the fee unsettled, visibly) than to
    // pay a removed founder.
    expect(account).toBeUndefined();
  });

  it('still honours an explicit primary-connect pin', async () => {
    const [pinnedUserId, activeOwnerId] = await seedTestUsers(db, 2);
    if (!pinnedUserId || !activeOwnerId) throw new Error('seed failed');

    const org = await makeOrg(activeOwnerId, 'pin-wins');

    await db.insert(organizationMemberships).values(
      createTestMembershipInput(org.id, activeOwnerId, {
        role: 'owner',
        status: 'active',
        createdAt: LATER,
      })
    );
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(org.id, pinnedUserId),
        createTestConnectAccountInput(org.id, activeOwnerId),
      ]);
    await db
      .update(organizations)
      .set({ primaryConnectAccountUserId: pinnedUserId })
      .where(eq(organizations.id, org.id));

    const account = await resolvePrimaryConnect(db, org.id);

    // The pin can deliberately point at a non-owner, so the status predicate
    // must not have narrowed this path.
    expect(account?.userId).toBe(pinnedUserId);
  });
});
