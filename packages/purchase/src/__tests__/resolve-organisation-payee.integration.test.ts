/**
 * `resolveOrganisationPayee` — who is paid the organisation's part of a sale
 * (Codex-2hxff.2).
 *
 * The rule under test: the owner AT THE TIME OF THE SALE is paid, not the owner
 * when the webhook is processed. A Stripe retry can land hours after a transfer
 * of ownership; asking "who owns it now?" would pay the new owner for a sale
 * the previous owner made. Ownership periods answer the time question.
 *
 * Also locked here, carried over from the resolver this replaces:
 *   - a REMOVED owner (`role='owner', status='inactive'`, a normal tombstone)
 *     is never paid on the no-periods fallback;
 *   - the retired `primary_connect_account_user_id` pin no longer routes money.
 *
 * Uses the Neon test DB (real schema) — the predicate under test is SQL, so a
 * mocked db would prove nothing.
 */

import {
  organizationMemberships,
  organizationOwnershipPeriods,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestMembershipInput,
  createTestOwnershipPeriodInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveOrganisationPayee } from '../utils/resolve-organisation-payee';

const LONG_AGO = new Date('2020-01-01T00:00:00Z');
const TRANSFER_AT = new Date('2024-06-01T12:00:00Z');
const BEFORE_TRANSFER = new Date('2024-05-31T23:59:59Z');
const AFTER_TRANSFER = new Date('2024-06-02T00:00:00Z');

describe('resolveOrganisationPayee', () => {
  let db: Database;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function makeOrg(label: string) {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Test Org ${label}`, slug: createUniqueSlug(label) })
      .returning();
    if (!org) throw new Error('Failed to create test organization');
    return org;
  }

  /** An org that moved from `previous` to `next` at TRANSFER_AT. */
  async function makeTransferredOrg(label: string) {
    const [previous, next] = await seedTestUsers(db, 2);
    if (!previous || !next) throw new Error('seed failed');
    const org = await makeOrg(label);
    await db.insert(organizationOwnershipPeriods).values([
      createTestOwnershipPeriodInput(org.id, previous, {
        startedAt: LONG_AGO,
        endedAt: TRANSFER_AT,
      }),
      createTestOwnershipPeriodInput(org.id, next, {
        startedAt: TRANSFER_AT,
        source: 'transfer',
      }),
    ]);
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(null, previous),
        createTestConnectAccountInput(null, next),
      ]);
    return { org, previous, next };
  }

  it('pays the owner at the time of the sale, not the current owner', async () => {
    const { org, previous, next } = await makeTransferredOrg('sale-before');

    const before = await resolveOrganisationPayee(db, org.id, BEFORE_TRANSFER);
    const after = await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER);

    expect(before?.userId).toBe(previous);
    expect(before?.account?.userId).toBe(previous);
    expect(after?.userId).toBe(next);
    expect(after?.account?.userId).toBe(next);
  });

  it('gives the transfer instant itself to the new owner', async () => {
    const { org, next } = await makeTransferredOrg('sale-at-boundary');

    // `ended_at > at` excludes the closed period, `started_at <= at` admits
    // the new one — an instant is never owned by both, nor by neither.
    const payee = await resolveOrganisationPayee(db, org.id, TRANSFER_AT);

    expect(payee?.userId).toBe(next);
  });

  it('returns the payee without an account when they have not onboarded', async () => {
    const [owner] = await seedTestUsers(db, 1);
    if (!owner) throw new Error('seed failed');
    const org = await makeOrg('payee-no-account');
    await db
      .insert(organizationOwnershipPeriods)
      .values(createTestOwnershipPeriodInput(org.id, owner));

    const payee = await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER);

    // The caller records the slice pending in this user's name.
    expect(payee).toEqual({ userId: owner, account: undefined });
  });

  it('pays the first owner, with a warning, for a sale before every period', async () => {
    const { org, previous } = await makeTransferredOrg('sale-predates');
    const warn = vi.fn();

    const payee = await resolveOrganisationPayee(
      db,
      org.id,
      new Date('2019-01-01T00:00:00Z'),
      { warn }
    );

    expect(payee?.userId).toBe(previous);
    expect(warn).toHaveBeenCalledOnce();
  });

  // No period covers the sale: nobody owned the organisation then. The money
  // goes to the NEXT owner — never a former one, who no longer owns it — or,
  // if there is none yet, is held (`no_owner`) for the owner support assigns
  // (owner decision 2026-10-18, Codex-2hxff.37).
  describe('a sale while the organisation had no owner', () => {
    async function makeVacatedOrg(label: string) {
      const [former, later] = await seedTestUsers(db, 2);
      if (!former || !later) throw new Error('seed failed');
      const org = await makeOrg(label);
      await db.insert(organizationOwnershipPeriods).values(
        createTestOwnershipPeriodInput(org.id, former, {
          startedAt: LONG_AGO,
          endedAt: TRANSFER_AT,
        })
      );
      return { org, former, later };
    }

    it('the owner left and nobody has been assigned: held, never the former owner', async () => {
      const { org, former } = await makeVacatedOrg('owner-left');
      const warn = vi.fn();

      const payee = await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER, {
        warn,
      });

      expect(payee).toBeUndefined();
      expect(payee?.userId).not.toBe(former);
      expect(warn).toHaveBeenCalledOnce();
    });

    it('a later owner has been assigned since: the sale is theirs', async () => {
      const { org, later } = await makeVacatedOrg('gap-then-owner');
      await db.insert(organizationOwnershipPeriods).values(
        createTestOwnershipPeriodInput(org.id, later, {
          startedAt: new Date('2024-07-01T00:00:00Z'),
          source: 'support',
        })
      );

      const payee = await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER, {
        warn: vi.fn(),
      });

      expect(payee?.userId).toBe(later);
    });
  });

  it('ignores the retired primary-connect pin', async () => {
    const { org, next } = await makeTransferredOrg('pin-ignored');
    const [stranger] = await seedTestUsers(db, 1);
    if (!stranger) throw new Error('seed failed');
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, stranger));
    await db
      .update(organizations)
      .set({ primaryConnectAccountUserId: stranger })
      .where(eq(organizations.id, org.id));

    const payee = await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER);

    expect(payee?.userId).toBe(next);
  });

  describe('an org with no ownership periods (inserted outside createOrganization)', () => {
    it('falls back to the active owner, with a warning, skipping a removed founder', async () => {
      const [removedFounderId, activeOwnerId] = await seedTestUsers(db, 2);
      if (!removedFounderId || !activeOwnerId) throw new Error('seed failed');
      const org = await makeOrg('no-periods-removed-founder');

      // The founder joined FIRST and was later removed: role survives, status
      // does not.
      await db.insert(organizationMemberships).values([
        createTestMembershipInput(org.id, removedFounderId, {
          role: 'owner',
          status: 'inactive',
          createdAt: LONG_AGO,
        }),
        createTestMembershipInput(org.id, activeOwnerId, {
          role: 'owner',
          status: 'active',
          createdAt: TRANSFER_AT,
        }),
      ]);
      // BOTH have onboarded, so resolution decides — not payability.
      await db
        .insert(stripeConnectAccounts)
        .values([
          createTestConnectAccountInput(org.id, removedFounderId),
          createTestConnectAccountInput(org.id, activeOwnerId),
        ]);
      const warn = vi.fn();

      const payee = await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER, {
        warn,
      });

      expect(payee?.userId).toBe(activeOwnerId);
      expect(payee?.account?.userId).toBe(activeOwnerId);
      expect(warn).toHaveBeenCalledOnce();
    });

    it('resolves to nothing when the only owner has been removed', async () => {
      const [removedFounderId, bystanderId] = await seedTestUsers(db, 2);
      if (!removedFounderId || !bystanderId) throw new Error('seed failed');
      const org = await makeOrg('no-periods-only-owner-removed');

      await db.insert(organizationMemberships).values([
        createTestMembershipInput(org.id, removedFounderId, {
          role: 'owner',
          status: 'inactive',
          createdAt: LONG_AGO,
        }),
        // A remaining plain member must never be treated as the payee.
        createTestMembershipInput(org.id, bystanderId, {
          role: 'member',
          status: 'active',
          createdAt: TRANSFER_AT,
        }),
      ]);
      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(org.id, removedFounderId));

      // Better to resolve nothing (and leave the fee unsettled, visibly) than
      // to pay a removed founder.
      expect(
        await resolveOrganisationPayee(db, org.id, AFTER_TRANSFER)
      ).toBeUndefined();
    });
  });
});
