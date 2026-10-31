/**
 * The Studio's read of a person's upcoming fees (Codex-2hxff.33; batch C1
 * Part B data design §1.8; owner decisions F3, Q1, Q2, Q3), against the
 * real database: `FeeConfigService.listUpcomingForUser`.
 *
 * Each test makes its own organisation, whose own fee is 10% today, and a
 * rise in it to 15%. The daily run's notices are written directly.
 */

import {
  feeChangeNotices,
  feeChanges,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import { feeRiseStartAfter } from '@codex/payments';
import {
  createUniqueSlug,
  type Database,
  seedFeeLevel,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

describe('FeeConfigService.listUpcomingForUser (real DB)', () => {
  let db: Database;
  let svc: FeeConfigService;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  const FIRST_RUN = new Date('2026-11-03T08:00:00Z');
  const NOW = new Date('2026-11-04T09:00:00Z');

  beforeAll(() => {
    db = setupTestDatabase();
    svc = new FeeConfigService({ db, environment: 'test' });
  });

  afterAll(async () => {
    if (orgIds.length > 0) {
      await db
        .delete(feeChanges)
        .where(inArray(feeChanges.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await teardownTestDatabase();
  });

  /** An organisation with its owner and a creator, its own fee at 10%. */
  async function organisation() {
    const [owner, creator] = (await seedTestUsers(db, 2)) as [string, string];
    userIds.push(owner, creator);
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Hollow Oak Films', slug: createUniqueSlug('fee-up') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('org not inserted');
    orgIds.push(org.id);
    await db.insert(organizationMemberships).values([
      { organizationId: org.id, userId: owner, role: 'owner' },
      { organizationId: org.id, userId: creator, role: 'creator' },
    ]);
    await seedFeeLevel(
      db,
      { scope: 'org', organizationId: org.id },
      { orgFeePercent: 1000 }
    );
    return { organizationId: org.id, owner, creator };
  }

  async function rise(
    organizationId: string,
    values: Partial<typeof feeConfigVersions.$inferInsert>,
    change: Partial<typeof feeChanges.$inferInsert> = {}
  ): Promise<string> {
    const [row] = await db
      .insert(feeChanges)
      .values({
        scope: 'org',
        organizationId,
        kind: 'rise',
        firstRunAt: FIRST_RUN,
        listedCount: 1,
        ...change,
      })
      .returning({ id: feeChanges.id });
    if (!row) throw new Error('change not inserted');
    await db
      .insert(feeConfigVersions)
      .values({ changeId: row.id, scope: 'org', ...values });
    return row.id;
  }

  async function announce(
    changeId: string,
    userId: string,
    values: Partial<typeof feeChangeNotices.$inferInsert> = {}
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

  it("a creator's own rise: the line, the earliest date while it waits, and when they were told", async () => {
    const { organizationId, creator } = await organisation();
    const changeId = await rise(organizationId, { orgFeePercent: 1500 });
    const accepted = new Date('2026-11-03T08:01:00Z');
    await announce(changeId, creator, { state: 'sent', acceptedAt: accepted });

    const [item, ...more] = await svc.listUpcomingForUser(
      creator,
      undefined,
      NOW
    );

    expect(more).toEqual([]);
    expect(item).toEqual({
      changeId,
      kind: 'announce',
      scope: 'org',
      effectiveFrom: null,
      // Q1: the earliest it can be, if the last person is told today.
      earliestFrom: feeRiseStartAfter(NOW).toISOString(),
      announcedAt: accepted.toISOString(),
      lines: [
        {
          organizationId,
          organizationName: 'Hollow Oak Films',
          as: 'creator',
          value: 'orgFeePercent',
          context: 'both',
          from: 1000,
          to: 1500,
          replaced: null,
        },
      ],
    });
  });

  it('shown though their email failed, and then nobody says when they were told', async () => {
    const { organizationId, creator } = await organisation();
    const changeId = await rise(organizationId, { orgFeePercent: 1500 });
    await announce(changeId, creator, { state: 'failed', attempts: 1 });

    const [item] = await svc.listUpcomingForUser(creator, undefined, NOW);
    expect(item?.changeId).toBe(changeId);
    expect(item?.announcedAt).toBeNull();
  });

  it('a rise made smaller says the figure it replaced (Q2)', async () => {
    const { organizationId, creator } = await organisation();
    const changeId = await rise(organizationId, { orgFeePercent: 1200 });
    const role = { organizationId, as: 'creator' as const };
    const told = (orgFeePercent: number) => ({
      platformFeePercent: 1000,
      orgFeePercent,
      minPlatformFeeCents: 25,
      minTransferCents: 0,
    });
    await announce(changeId, creator, {
      state: 'sent',
      acceptedAt: FIRST_RUN,
      roles: [role],
      afterValues: [{ ...role, oneOff: told(1500), subscription: told(1500) }],
    });
    await db.insert(feeChangeNotices).values({
      changeId,
      userId: creator,
      kind: 'smaller',
      onList: false,
      roles: [role],
      beforeValues: [],
      afterValues: [],
    });

    const [item] = await svc.listUpcomingForUser(creator, undefined, NOW);
    expect(item).toMatchObject({
      kind: 'smaller',
      lines: [{ value: 'orgFeePercent', from: 1000, to: 1200, replaced: 1500 }],
    });
  });

  it("the owner's filter: an organisation-fee rise raises their share, so Billing shows nothing (F3); the creator's read shows nothing for an organisation they don't own", async () => {
    const { organizationId, owner, creator } = await organisation();
    const changeId = await rise(organizationId, { orgFeePercent: 1500 });
    await announce(changeId, creator, { state: 'sent', acceptedAt: FIRST_RUN });

    expect(await svc.listUpcomingForUser(owner, organizationId, NOW)).toEqual(
      []
    );
    expect(await svc.listUpcomingForUser(creator, organizationId, NOW)).toEqual(
      []
    );
  });

  it('a rise our fee makes is on the owner’s Billing, for their organisation', async () => {
    const { organizationId, owner } = await organisation();
    // A version holds the whole level: the organisation fee carries over.
    const changeId = await rise(organizationId, {
      platformFeePercent: 1500,
      orgFeePercent: 1000,
    });
    await announce(changeId, owner, { state: 'sent', acceptedAt: FIRST_RUN });

    const [item] = await svc.listUpcomingForUser(owner, organizationId, NOW);
    expect(item?.lines).toEqual([
      expect.objectContaining({
        organizationId,
        as: 'owner',
        value: 'platformFeePercent',
        to: 1500,
      }),
    ]);
  });

  it('nothing before the first run, nothing once started, nothing once cancelled', async () => {
    const { organizationId, creator } = await organisation();
    const notListed = await rise(
      organizationId,
      { orgFeePercent: 1500 },
      { firstRunAt: null, listedCount: null }
    );
    await announce(notListed, creator);
    const second = await organisation();
    const started = await rise(
      second.organizationId,
      { orgFeePercent: 1500 },
      { effectiveFrom: new Date('2026-11-01T00:00:00Z') }
    );
    await announce(started, second.creator, {
      state: 'sent',
      acceptedAt: FIRST_RUN,
    });
    const third = await organisation();
    const off = await rise(
      third.organizationId,
      { orgFeePercent: 1500 },
      { voidedAt: NOW, voidReason: 'cancelled' }
    );
    await announce(off, third.creator, {
      state: 'sent',
      acceptedAt: FIRST_RUN,
    });

    for (const who of [creator, second.creator, third.creator]) {
      expect(await svc.listUpcomingForUser(who, undefined, NOW)).toEqual([]);
    }
  });
});
