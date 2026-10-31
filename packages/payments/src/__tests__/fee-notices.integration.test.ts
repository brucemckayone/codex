/**
 * Who a fee rise is waiting for, and when it starts (Codex-2hxff.33; batch
 * C1 Part B data design §1.5, §1.6; owner decisions F3, F4, F8).
 *
 * `affectedPayees` resolves each person's fees before and after with the
 * same layering every sale uses, so the people it skips are exactly the
 * ones whose take doesn't fall: shielded by their own setting, an owner when
 * only the organisation fee rises, a member who isn't active. The platform
 * level is shared with every other suite, so one platform rise is made, kept
 * WAITING (it moves nobody's fee) and deleted at once; assertions filter to
 * this file's people.
 */

import {
  feeChangeNotices,
  feeChanges,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedFeeLevel,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { affectedPayees, dateRiseIfAllTold } from '../fee-notices';
import { feeRiseStartAfter } from '../fee-versions';

describe('affectedPayees and dateRiseIfAllTold (real DB)', () => {
  let db: Database;
  let org: string;
  let shieldedOrg: string;
  const people = {} as Record<
    | 'owner'
    | 'creator'
    | 'admin'
    | 'shielded'
    | 'inactive'
    | 'subscriber'
    | 'deleted'
    | 'orgless'
    | 'shieldedOrgCreator',
    string
  >;
  let userIds: string[] = [];

  /** A waiting rise at `level` whose live version is `values`. */
  async function rise(
    level:
      | { scope: 'platform' }
      | { scope: 'org'; organizationId: string }
      | { scope: 'creator'; organizationId: string; creatorId: string },
    values: Partial<typeof feeConfigVersions.$inferInsert>
  ) {
    const [change] = await db
      .insert(feeChanges)
      .values({
        scope: level.scope,
        organizationId:
          level.scope === 'platform' ? null : level.organizationId,
        creatorId: level.scope === 'creator' ? level.creatorId : null,
        kind: 'rise',
      })
      .returning();
    if (!change) throw new Error('no change');
    await db.insert(feeConfigVersions).values({
      changeId: change.id,
      scope: level.scope,
      ...values,
    });
    return change;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    userIds = await seedTestUsers(db, 9);
    const keys = Object.keys({
      owner: 0,
      creator: 0,
      admin: 0,
      shielded: 0,
      inactive: 0,
      subscriber: 0,
      deleted: 0,
      orgless: 0,
      shieldedOrgCreator: 0,
    }) as Array<keyof typeof people>;
    keys.forEach((key, i) => {
      people[key] = userIds[i] as string;
    });
    const [a, b] = await db
      .insert(organizations)
      .values([
        { name: 'Hollow Oak Films', slug: createUniqueSlug('fee-aff-a') },
        { name: 'Northlight Collective', slug: createUniqueSlug('fee-aff-b') },
      ])
      .returning({ id: organizations.id });
    if (!a || !b) throw new Error('orgs not inserted');
    org = a.id;
    shieldedOrg = b.id;
    await db.insert(organizationMemberships).values([
      { organizationId: org, userId: people.owner, role: 'owner' },
      { organizationId: org, userId: people.creator, role: 'creator' },
      { organizationId: org, userId: people.admin, role: 'admin' },
      { organizationId: org, userId: people.shielded, role: 'creator' },
      {
        organizationId: org,
        userId: people.inactive,
        role: 'creator',
        status: 'inactive',
      },
      { organizationId: org, userId: people.subscriber, role: 'subscriber' },
      { organizationId: org, userId: people.deleted, role: 'creator' },
      {
        organizationId: shieldedOrg,
        userId: people.shieldedOrgCreator,
        role: 'creator',
      },
    ]);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, people.deleted));
    await db
      .update(users)
      .set({ role: 'creator' })
      .where(eq(users.id, people.orgless));
    // The shielded creator's own 0% org fee, and an organisation that pins
    // our fee at today's 10% for everyone in it.
    await seedFeeLevel(
      db,
      { scope: 'creator', organizationId: org, creatorId: people.shielded },
      { orgFeePercent: 0 }
    );
    await seedFeeLevel(
      db,
      { scope: 'org', organizationId: shieldedOrg },
      { platformFeePercent: 1000 }
    );
  });

  // Only this file's rises: the table is shared.
  beforeEach(async () => {
    await db
      .delete(feeChanges)
      .where(
        and(
          eq(feeChanges.kind, 'rise'),
          inArray(feeChanges.organizationId, [org, shieldedOrg])
        )
      );
  });

  afterAll(async () => {
    await db
      .delete(feeChanges)
      .where(inArray(feeChanges.organizationId, [org, shieldedOrg]));
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [org, shieldedOrg]));
    await db.delete(users).where(inArray(users.id, userIds));
    await teardownTestDatabase();
  });

  const ours = (list: Array<{ userId: string }>) =>
    list
      .map((p) => p.userId)
      .filter((id) => userIds.includes(id))
      .sort();

  it('an organisation fee rise lists its creators and admins, not the owner, the shielded, or non-members', async () => {
    const change = await rise(
      { scope: 'org', organizationId: org },
      { orgFeePercent: 1500 }
    );
    const payees = await affectedPayees(db, change, new Date());

    expect(ours(payees)).toEqual([people.admin, people.creator].sort());
    const creator = payees.find((p) => p.userId === people.creator);
    expect(creator?.roles).toEqual([{ organizationId: org, as: 'creator' }]);
    // 10% → 15% on one-off sales; subscriptions were 15% already.
    expect(creator?.before[0]?.oneOff.orgFeePercent).toBe(1000);
    expect(creator?.after[0]?.oneOff.orgFeePercent).toBe(1500);
    expect(creator?.after[0]?.subscription.orgFeePercent).toBe(1500);
  });

  it('our fee raised for one organisation lists its owner too', async () => {
    const change = await rise(
      { scope: 'org', organizationId: org },
      { platformFeePercent: 1200 }
    );
    const payees = await affectedPayees(db, change, new Date());

    expect(ours(payees)).toEqual(
      [people.admin, people.creator, people.owner, people.shielded].sort()
    );
    expect(payees.find((p) => p.userId === people.owner)?.roles).toEqual([
      { organizationId: org, as: 'owner' },
    ]);
  });

  it("a creator's own override rise lists that creator and the owner whose share moves", async () => {
    const change = await rise(
      { scope: 'creator', organizationId: org, creatorId: people.creator },
      { platformFeePercent: 1500 }
    );
    const payees = await affectedPayees(db, change, new Date());

    expect(ours(payees)).toEqual([people.creator, people.owner].sort());
  });

  it('a platform rise reaches orgless creators and skips an organisation that pins the fee', async () => {
    const change = await rise(
      { scope: 'platform' },
      {
        platformFeePercent: 1200,
        oneOffOrgFeePercent: 1000,
        subscriptionOrgFeePercent: 1500,
        minPlatformFeeCents: 25,
        minTransferCents: 0,
      }
    );
    try {
      const payees = await affectedPayees(db, change, new Date());
      const mine = ours(payees);
      expect(mine).toContain(people.orgless);
      expect(mine).toContain(people.owner);
      expect(mine).toContain(people.creator);
      expect(mine).not.toContain(people.shieldedOrgCreator);
      expect(payees.find((p) => p.userId === people.orgless)?.roles).toEqual([
        { organizationId: null, as: 'creator' },
      ]);
      // One person, one call: the Studio read's filter.
      expect(
        ours(
          await affectedPayees(db, change, new Date(), {
            onlyUserId: people.creator,
          })
        )
      ).toEqual([people.creator]);
    } finally {
      await db.delete(feeChanges).where(eq(feeChanges.id, change.id));
    }
  });

  // ── dateRiseIfAllTold ─────────────────────────────────────────────────────

  async function notice(
    changeId: string,
    userId: string,
    values: Partial<typeof feeChangeNotices.$inferInsert>
  ) {
    await db.insert(feeChangeNotices).values({
      changeId,
      userId,
      kind: 'announce',
      onList: true,
      roles: [],
      beforeValues: [],
      afterValues: [],
      ...values,
    });
  }

  it('waits for anyone on the list not yet told, never for a joiner', async () => {
    const change = await rise(
      { scope: 'org', organizationId: org },
      { orgFeePercent: 1500 }
    );
    expect(
      await db.transaction((tx) => dateRiseIfAllTold(tx, change.id))
    ).toMatchObject({ dated: false, reason: 'not_listed' });

    const firstRun = new Date('2026-11-03T08:00:00Z');
    await db
      .update(feeChanges)
      .set({ firstRunAt: firstRun, listedCount: 2 })
      .where(eq(feeChanges.id, change.id));
    const sentAt = new Date('2026-11-03T08:01:00Z');
    const toldAt = new Date('2026-11-04T10:42:00Z');
    await notice(change.id, people.creator, {
      state: 'sent',
      acceptedAt: sentAt,
    });
    await notice(change.id, people.admin, { state: 'failed' });
    // A joiner whose email failed holds nothing (F8).
    await notice(change.id, people.shielded, {
      onList: false,
      state: 'failed',
    });

    expect(
      await db.transaction((tx) => dateRiseIfAllTold(tx, change.id))
    ).toMatchObject({ dated: false, reason: 'still_waiting', waitingFor: 1 });

    await db
      .update(feeChangeNotices)
      .set({
        state: 'told_another_way',
        toldNote: 'phoned',
        toldByUserId: people.owner,
        toldAt,
      })
      .where(eq(feeChangeNotices.userId, people.admin));

    const dated = await db.transaction((tx) =>
      dateRiseIfAllTold(tx, change.id)
    );
    // The latest of the accepted email and support's mark.
    expect(dated).toEqual({
      dated: true,
      effectiveFrom: feeRiseStartAfter(toldAt),
    });
    expect(dated.dated && dated.effectiveFrom.toISOString()).toBe(
      '2026-12-05T00:00:00.000Z'
    );
    // A second call finds it dated and leaves it.
    expect(
      await db.transaction((tx) => dateRiseIfAllTold(tx, change.id))
    ).toMatchObject({ dated: false, reason: 'not_waiting' });
  });

  it('an empty list dates the rise 30 days from its first run', async () => {
    const change = await rise(
      { scope: 'org', organizationId: org },
      { orgFeePercent: 1500 }
    );
    const firstRun = new Date('2026-11-03T08:00:00Z');
    await db
      .update(feeChanges)
      .set({ firstRunAt: firstRun, listedCount: 0 })
      .where(eq(feeChanges.id, change.id));
    expect(
      await db.transaction((tx) => dateRiseIfAllTold(tx, change.id))
    ).toEqual({ dated: true, effectiveFrom: feeRiseStartAfter(firstRun) });
  });

  it('a voided rise is never dated', async () => {
    const change = await rise(
      { scope: 'org', organizationId: org },
      { orgFeePercent: 1500 }
    );
    await db
      .update(feeChanges)
      .set({
        firstRunAt: new Date(),
        listedCount: 0,
        voidedAt: new Date(),
        voidReason: 'cancelled',
      })
      .where(eq(feeChanges.id, change.id));
    expect(
      await db.transaction((tx) => dateRiseIfAllTold(tx, change.id))
    ).toMatchObject({ dated: false, reason: 'not_waiting' });
  });
});
