/**
 * Lock order and live-user guards against an account deletion
 * (Codex-kk9nv.8).
 *
 * Every path that locks a member's rows takes an ownership offer before any
 * membership. Two transactions that take the same rows in different orders
 * wait on each other until Postgres aborts one (40P01), so each case here
 * holds the offer in a transaction of its own, lets the path under test block
 * on it, then locks the membership too. A path that keeps the order is still
 * waiting on the offer, so the membership is free and both commit. One that
 * locked the membership first deadlocks, and the case fails.
 *
 * The same harness checks what the waiting path then does. When the holder
 * makes the member the owner, the removal or demotion must refuse, because
 * its write carries the owner condition. When the holder commits a new offer
 * while the removal waits on the membership, the removal must withdraw it.
 *
 * `create` and `inviteMember` read the user under KEY SHARE. Each case holds
 * the user's row as an account deletion's scrub does, lets the path block on
 * it, then soft-deletes the user and commits: the path must find no live
 * user, rather than attach an org or a membership to a deleted account.
 *
 * Real Neon test DB: row locks cannot be mocked. A run that keeps the order
 * takes milliseconds; a deadlock takes Postgres's deadlock_timeout (1s).
 */

import * as schema from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnershipTransferRequiredError } from '../../errors';
import { OrganizationService } from '../organization-service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const ORG_NAME = 'Lock Order Studio';
const DONE = 'done';

describe('lock order and live-user guards (Codex-kk9nv.8)', () => {
  let db: Database;
  let service: OrganizationService;
  let orgId: string;
  let ownerId: string;
  let adminId: string;
  let creatorId: string;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    service = new OrganizationService({
      db,
      environment: 'test',
      ownershipMailer: async () => {},
      webAppUrl: 'http://lvh.me:3000',
      waitUntil: () => {},
    });
    [ownerId, adminId, creatorId] = await seedTestUsers(db, 3);
    const org = await service.create(
      { name: ORG_NAME, slug: createUniqueSlug('lock-order') },
      ownerId
    );
    orgId = org.id;
    await db.insert(schema.organizationMemberships).values([
      {
        organizationId: orgId,
        userId: adminId,
        role: 'admin',
        status: 'active',
      },
      {
        organizationId: orgId,
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
    ]);
  });

  /**
   * Resolve once a statement on `table` is waiting on a lock that `pid`
   * holds. The table, not only the pid: on a shared local database, a peer's
   * cleanup can block on the same rows, and an early return would let a
   * regressed order through.
   */
  async function untilBlockedBy(pid: number, table: string): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const { rows } = await db.execute(
        sql`select 1 from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid)) and query ilike ${`%"${table}"%`}`
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`the path under test never waited on ${table}`);
  }

  /**
   * Take `hold` in a transaction of our own, start `run`, and once `run` is
   * waiting on it in a statement on `waitsOn`, do `then` in the same
   * transaction and commit. Resolves to DONE, or to the error `run` rejected
   * with.
   */
  async function whileHolding(
    hold: (tx: Tx) => Promise<unknown>,
    waitsOn: string,
    run: () => Promise<unknown>,
    then: (tx: Tx) => Promise<unknown>
  ): Promise<unknown> {
    let outcome: Promise<unknown> = Promise.resolve(DONE);
    await db.transaction(async (tx) => {
      await hold(tx);
      const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`);
      const pid = Number((rows[0] as { pid: unknown } | undefined)?.pid);
      outcome = run().then(
        () => DONE,
        (error: unknown) => error
      );
      await untilBlockedBy(pid, waitsOn);
      await then(tx);
    });
    return outcome;
  }

  const OFFERS = 'organization_ownership_offers';
  const MEMBERSHIPS = 'organization_memberships';
  const USERS = 'users';

  const lockOffer = (offerId: string) => (tx: Tx) =>
    tx
      .select({ id: schema.organizationOwnershipOffers.id })
      .from(schema.organizationOwnershipOffers)
      .where(eq(schema.organizationOwnershipOffers.id, offerId))
      .for('update');

  const lockMembership = (userId: string) => (tx: Tx) =>
    tx
      .select({ id: schema.organizationMemberships.id })
      .from(schema.organizationMemberships)
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, orgId),
          eq(schema.organizationMemberships.userId, userId)
        )
      )
      .for('update');

  const lockUser = (userId: string) => (tx: Tx) =>
    tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for('update');

  /** What an account deletion's scrub writes, minus the rest of the PII. */
  const softDelete = (userId: string) => (tx: Tx) =>
    tx
      .update(schema.users)
      .set({
        deletedAt: new Date(),
        email: `deleted-${userId}@deleted.invalid`,
      })
      .where(eq(schema.users.id, userId));

  const offerTo = (recipientUserId: string) =>
    service.offerOwnership(orgId, ownerId, {
      recipientUserId,
      confirmName: ORG_NAME,
    });

  async function offerStatus(offerId: string) {
    const row = await db.query.organizationOwnershipOffers.findFirst({
      where: (o, { eq }) => eq(o.id, offerId),
    });
    return row?.status;
  }

  /** The membership writes of an accept: demote the owner, promote `userId`. */
  const acceptAs = (offerId: string, userId: string) => async (tx: Tx) => {
    const member = (id: string) =>
      and(
        eq(schema.organizationMemberships.organizationId, orgId),
        eq(schema.organizationMemberships.userId, id)
      );
    await tx
      .update(schema.organizationMemberships)
      .set({ role: 'admin' })
      .where(member(ownerId));
    await tx
      .update(schema.organizationMemberships)
      .set({ role: 'owner' })
      .where(member(userId));
    await tx
      .update(schema.organizationOwnershipOffers)
      .set({ status: 'accepted', respondedAt: new Date() })
      .where(eq(schema.organizationOwnershipOffers.id, offerId));
  };

  async function activeOwners() {
    const rows = await db
      .select({ userId: schema.organizationMemberships.userId })
      .from(schema.organizationMemberships)
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, orgId),
          eq(schema.organizationMemberships.role, 'owner'),
          eq(schema.organizationMemberships.status, 'active')
        )
      );
    return rows.map((row) => row.userId);
  }

  describe('a member made owner while the write waited', () => {
    // An UPDATE that waited re-checks only its own WHERE: without the owner
    // condition on it, the removal or demotion would land on the new owner,
    // and the org would be left with none.
    it('removeMember refuses, and the org keeps its new owner', async () => {
      const created = await offerTo(creatorId);

      const outcome = await whileHolding(
        lockOffer(created.id),
        OFFERS,
        () => service.removeMember(orgId, creatorId),
        acceptAs(created.id, creatorId)
      );

      expect(outcome).toBeInstanceOf(OwnershipTransferRequiredError);
      expect(await activeOwners()).toEqual([creatorId]);
    });

    it('updateMemberRole refuses, and the org keeps its new owner', async () => {
      const created = await offerTo(creatorId);

      const outcome = await whileHolding(
        lockOffer(created.id),
        OFFERS,
        () => service.updateMemberRole(orgId, creatorId, 'member'),
        acceptAs(created.id, creatorId)
      );

      expect(outcome).toBeInstanceOf(OwnershipTransferRequiredError);
      expect(await activeOwners()).toEqual([creatorId]);
    });
  });

  describe('an offer created while the membership change waited', () => {
    // createOwnershipOffer holds the recipient's membership while it inserts.
    // The removal withdraws after its membership change, by a fresh read, so
    // that offer is withdrawn rather than left open to an inactive member.
    it('removeMember withdraws it', async () => {
      let createdId = '';

      const outcome = await whileHolding(
        lockMembership(creatorId),
        MEMBERSHIPS,
        () => service.removeMember(orgId, creatorId),
        async (tx) => {
          const [row] = await tx
            .insert(schema.organizationOwnershipOffers)
            .values({
              organizationId: orgId,
              offeredByUserId: ownerId,
              recipientUserId: creatorId,
              status: 'open',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            })
            .returning();
          createdId = row?.id ?? '';
        }
      );

      expect(outcome).toBe(DONE);
      expect(await offerStatus(createdId)).toBe('withdrawn');
    });
  });

  describe('an offer before any membership', () => {
    it('removeMember locks the offer before the membership', async () => {
      const created = await offerTo(creatorId);

      const outcome = await whileHolding(
        lockOffer(created.id),
        OFFERS,
        () => service.removeMember(orgId, creatorId),
        lockMembership(creatorId)
      );

      expect(outcome).toBe(DONE);
      expect(await offerStatus(created.id)).toBe('withdrawn');
    });

    it('updateMemberRole locks the offer before the membership', async () => {
      const created = await offerTo(creatorId);

      const outcome = await whileHolding(
        lockOffer(created.id),
        OFFERS,
        () => service.updateMemberRole(orgId, creatorId, 'member'),
        lockMembership(creatorId)
      );

      expect(outcome).toBe(DONE);
      expect(await offerStatus(created.id)).toBe('withdrawn');
    });

    it("withdrawOwnershipOffer locks the offer before the owner's membership", async () => {
      const created = await offerTo(creatorId);

      const outcome = await whileHolding(
        lockOffer(created.id),
        OFFERS,
        () => service.withdrawOwnershipOffer(orgId, created.id, ownerId),
        lockMembership(ownerId)
      );

      expect(outcome).toBe(DONE);
      expect(await offerStatus(created.id)).toBe('withdrawn');
    });

    it('reassignOwner locks the open offer before any membership', async () => {
      const created = await offerTo(creatorId);

      const outcome = await whileHolding(
        lockOffer(created.id),
        OFFERS,
        () => service.reassignOwner(orgId, adminId),
        lockMembership(ownerId)
      );

      expect(outcome).toBe(DONE);
      expect(await offerStatus(created.id)).toBe('withdrawn');
    });
  });

  describe('a live user, read under KEY SHARE', () => {
    it('create waits for a deletion holding the user, then finds no live user', async () => {
      const [doomedId] = await seedTestUsers(db, 1);
      if (!doomedId) throw new Error('no user seeded');

      const outcome = await whileHolding(
        lockUser(doomedId),
        USERS,
        () =>
          service.create(
            { name: 'Doomed Studio', slug: createUniqueSlug('doomed') },
            doomedId
          ),
        softDelete(doomedId)
      );

      expect(outcome).toBeInstanceOf(NotFoundError);
      const owned = await db
        .select({ id: schema.organizationMemberships.id })
        .from(schema.organizationMemberships)
        .where(eq(schema.organizationMemberships.userId, doomedId));
      expect(owned).toEqual([]);
    });

    it('inviteMember waits for a deletion holding the user, then finds no live user', async () => {
      const [doomedId] = await seedTestUsers(db, 1);
      if (!doomedId) throw new Error('no user seeded');
      const doomed = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, doomedId),
        columns: { email: true },
      });
      if (!doomed) throw new Error('seeded user not found');

      const outcome = await whileHolding(
        lockUser(doomedId),
        USERS,
        () =>
          service.inviteMember(
            orgId,
            { email: doomed.email, role: 'creator' },
            ownerId
          ),
        softDelete(doomedId)
      );

      expect(outcome).toBeInstanceOf(NotFoundError);
      const joined = await db
        .select({ id: schema.organizationMemberships.id })
        .from(schema.organizationMemberships)
        .where(eq(schema.organizationMemberships.userId, doomedId));
      expect(joined).toEqual([]);
    });
  });
});
