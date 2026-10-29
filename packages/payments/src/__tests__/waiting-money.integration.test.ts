/**
 * `waitingMoney`: the money waiting for a payee to set up payouts
 * (Codex-2hxff.34, Q5). Studio's banner and the monthly email both read it,
 * so its conditions are the contract they share (batch B design §5.1).
 *
 * Uses the test database (real schema): the predicate under test is SQL.
 */

import {
  organizations,
  payoutReversals,
  payouts,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestConnectAccountInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitingMoney, waitingSetupOf } from '../waiting-money';

const DAY = 24 * 60 * 60 * 1000;

describe('waitingMoney', () => {
  let db: Database;
  let subscriptionId: string;
  let orgA: { id: string; name: string };
  let orgB: { id: string; name: string };
  const createdPayoutIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    const [subscriber] = await seedTestUsers(db, 1);
    const orgs = await db
      .insert(organizations)
      .values([
        { name: 'Hollow Oak Films', slug: createUniqueSlug('wait-a') },
        { name: 'Northlight Collective', slug: createUniqueSlug('wait-b') },
      ])
      .returning();
    const [a, b] = orgs;
    if (!a || !b) throw new Error('orgs not inserted');
    orgA = a;
    orgB = b;
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgA.id))
      .returning();
    if (!tier) throw new Error('tier not inserted');
    const [sub] = await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(subscriber, orgA.id, tier.id))
      .returning();
    if (!sub) throw new Error('subscription not inserted');
    subscriptionId = sub.id;
  });

  // The hourly drain is global: a pending row left here would feed it.
  afterAll(async () => {
    if (createdPayoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, createdPayoutIds));
      await db.delete(payouts).where(inArray(payouts.id, createdPayoutIds));
    }
    if (userIds.length > 0) {
      await db
        .delete(stripeConnectAccounts)
        .where(inArray(stripeConnectAccounts.userId, userIds));
      await db
        .delete(stripeConnectAccountHistory)
        .where(inArray(stripeConnectAccountHistory.userId, userIds));
    }
    await teardownTestDatabase();
  });

  async function person(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    userIds.push(id);
    return id;
  }

  async function row(values: {
    userId: string | null;
    organizationId?: string;
    amountCents: number;
    payoutType?:
      | 'creator_payout'
      | 'organization_fee'
      | 'creator_payout_to_owner';
    status?: 'pending' | 'paid';
    reason?: string | null;
    createdAt?: Date;
  }): Promise<string> {
    const [inserted] = await db
      .insert(payouts)
      .values({
        userId: values.userId,
        organizationId: values.organizationId ?? orgA.id,
        subscriptionId,
        amountCents: values.amountCents,
        payoutType: values.payoutType ?? 'creator_payout',
        status: values.status ?? 'pending',
        reason:
          values.reason === undefined ? 'connect_not_ready' : values.reason,
        stripeChargeId: `ch_wait_${crypto.randomUUID().slice(0, 12)}`,
        ...(values.status === 'paid'
          ? {
              stripeTransferId: `tr_wait_${crypto.randomUUID().slice(0, 12)}`,
              resolvedAt: new Date(),
            }
          : {}),
        createdAt: values.createdAt ?? new Date(Date.now() - 40 * DAY),
      })
      .returning({ id: payouts.id });
    if (!inserted) throw new Error('payout not inserted');
    createdPayoutIds.push(inserted.id);
    return inserted.id;
  }

  async function account(
    userId: string,
    overrides: Parameters<typeof createTestConnectAccountInput>[2]
  ) {
    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, userId, overrides));
  }

  it('counts creators AND owners, every payee type and both reasons, across organisations', async () => {
    const userId = await person();
    const oldest = new Date(Date.now() - 50 * DAY);
    await row({ userId, amountCents: 4095, createdAt: oldest });
    await row({
      userId,
      organizationId: orgB.id,
      amountCents: 6000,
      payoutType: 'organization_fee',
      reason: 'connect_restricted',
    });
    await row({
      userId,
      organizationId: orgB.id,
      amountCents: 3630,
      payoutType: 'creator_payout_to_owner',
    });

    const waiting = await waitingMoney(db, { userId });

    expect(waiting).not.toBeNull();
    expect(waiting?.totalCents).toBe(4095 + 6000 + 3630);
    expect(waiting?.oldestAt.getTime()).toBe(oldest.getTime());
    expect(waiting?.setup).toBe('not_started');
    // The owner's share is one entry per organisation, apart from the
    // creator share in it, and largest first.
    expect(waiting?.organisations).toEqual([
      expect.objectContaining({
        organizationId: orgB.id,
        name: 'Northlight Collective',
        asOwner: true,
        cents: 9630,
      }),
      expect.objectContaining({
        organizationId: orgA.id,
        name: 'Hollow Oak Films',
        asOwner: false,
        cents: 4095,
      }),
    ]);
  });

  it('leaves out payable-now, no_owner, in-flight and paid rows', async () => {
    const payableNow = await person();
    await account(payableNow, {});
    await row({ userId: payableNow, amountCents: 500 });

    const inFlight = await person();
    await row({ userId: inFlight, amountCents: 700, reason: null });
    await row({
      userId: inFlight,
      amountCents: 800,
      status: 'paid',
      reason: null,
    });

    // A no_owner row has no person, so nobody is reminded of it.
    const noOwnerId = await row({
      userId: null,
      amountCents: 900,
      payoutType: 'organization_fee',
      reason: 'no_owner',
    });

    expect(await waitingMoney(db, { userId: payableNow })).toBeNull();
    expect(await waitingMoney(db, { userId: inFlight })).toBeNull();

    const page = await waitingMoney(db, {
      olderThan: new Date(),
      afterUserId: null,
      limit: 1000,
    });
    const listed = page.map((p) => p.userId);
    expect(listed).not.toContain(payableNow);
    expect(listed).not.toContain(inFlight);
    expect(noOwnerId).toBeTruthy();
  });

  it('nets out done pending reductions, and only done ones', async () => {
    const userId = await person();
    const reduced = await row({ userId, amountCents: 1000 });
    await db.insert(payoutReversals).values([
      {
        payoutId: reduced,
        causeType: 'refund',
        causeId: `re_wait_${crypto.randomUUID().slice(0, 12)}`,
        amountCents: 300,
        kind: 'pending_reduction',
        status: 'done',
      },
      {
        payoutId: reduced,
        causeType: 'refund',
        causeId: `re_wait_${crypto.randomUUID().slice(0, 12)}`,
        amountCents: 200,
        kind: 'pending_reduction',
        status: 'failed',
      },
    ]);

    const waiting = await waitingMoney(db, { userId });

    expect(waiting?.totalCents).toBe(700);
  });

  it('words the account: none, onboarding, and anything else unpayable', async () => {
    const incomplete = await person();
    await account(incomplete, {
      status: 'onboarding',
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    await row({ userId: incomplete, amountCents: 100 });

    const paused = await person();
    await account(paused, {
      status: 'restricted',
      chargesEnabled: true,
      payoutsEnabled: false,
    });
    await row({
      userId: paused,
      amountCents: 100,
      reason: 'connect_restricted',
    });

    expect((await waitingMoney(db, { userId: incomplete }))?.setup).toBe(
      'incomplete'
    );
    expect((await waitingMoney(db, { userId: paused }))?.setup).toBe('paused');
    expect(waitingSetupOf(null)).toBe('not_started');
    expect(waitingSetupOf({ status: 'disabled' })).toBe('paused');
  });

  it('pages the sweep by oldest row, at the 30-day boundary, in user-id order', async () => {
    const now = Date.now();
    const olderThan = new Date(now - 30 * DAY);
    const atBoundary = await person();
    await row({ userId: atBoundary, amountCents: 100, createdAt: olderThan });
    // Its newer row doesn't move the person: the oldest one decides.
    await row({
      userId: atBoundary,
      amountCents: 100,
      createdAt: new Date(now),
    });

    const tooNew = await person();
    await row({
      userId: tooNew,
      amountCents: 100,
      createdAt: new Date(olderThan.getTime() + 1000),
    });

    const page = await waitingMoney(db, {
      olderThan,
      afterUserId: null,
      limit: 1000,
    });
    const listed = page.map((p) => p.userId);
    expect(listed).toContain(atBoundary);
    expect(listed).not.toContain(tooNew);
    expect(listed).toEqual([...listed].sort());
    expect(page.find((p) => p.userId === atBoundary)?.totalCents).toBe(200);

    const after = await waitingMoney(db, {
      olderThan,
      afterUserId: atBoundary,
      limit: 1000,
    });
    expect(after.every((p) => p.userId > atBoundary)).toBe(true);

    const one = await waitingMoney(db, {
      olderThan,
      afterUserId: null,
      limit: 1,
    });
    expect(one).toHaveLength(1);
  });
});
