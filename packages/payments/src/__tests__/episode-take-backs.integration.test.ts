/**
 * What took a balance below zero (`episodeTakeBacks`): the one rule the M7
 * email and Studio's below-zero card share. Only the payee's own slices, only
 * steps that moved money, only inside the episode's window.
 */

import {
  organizations,
  payoutReversals,
  payouts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { episodeTakeBacks, ledgerSalesSince } from '../bank-payouts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The morning check that first saw the balance below zero. */
const SINCE = new Date('2026-10-20T08:00:00Z');

describe('episodeTakeBacks', () => {
  let db: Database;
  let orgId: string;
  let tierName: string;
  let subscriptionId: string;
  let tierId: string;
  const payoutIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    const [subscriber] = await seedTestUsers(db, 1);
    if (!subscriber) throw new Error('no subscriber');
    userIds.push(subscriber);
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Hollow Oak Films', slug: createUniqueSlug('takeback') })
      .returning();
    if (!org) throw new Error('org not inserted');
    orgId = org.id;
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(orgId))
      .returning();
    if (!tier) throw new Error('tier not inserted');
    tierId = tier.id;
    tierName = tier.name;
    const [sub] = await db
      .insert(subscriptions)
      .values(createTestSubscriptionInput(subscriber, orgId, tier.id))
      .returning();
    if (!sub) throw new Error('subscription not inserted');
    subscriptionId = sub.id;
  });

  // Only this file's rows: the money sweep reads take-backs globally.
  afterAll(async () => {
    if (payoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, payoutIds));
      await db.delete(payouts).where(inArray(payouts.id, payoutIds));
    }
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId));
    await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tierId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await teardownTestDatabase();
  });

  async function payee(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    if (!id) throw new Error('no user');
    userIds.push(id);
    return id;
  }

  /** A reversed slice of the payee's, from a subscription sale. */
  async function slice(
    userId: string,
    payoutType:
      | 'creator_payout'
      | 'organization_fee'
      | 'creator_payout_to_owner' = 'creator_payout'
  ): Promise<string> {
    const [row] = await db
      .insert(payouts)
      .values({
        userId,
        organizationId: orgId,
        subscriptionId,
        amountCents: 5000,
        payoutType,
        status: 'reversed',
        reason: null,
        stripeTransferId: `tr_tb_${crypto.randomUUID().slice(0, 12)}`,
        resolvedAt: new Date(SINCE.getTime() - 30 * DAY),
      })
      .returning();
    if (!row) throw new Error('payout not inserted');
    payoutIds.push(row.id);
    return row.id;
  }

  async function step(
    payoutId: string,
    values: {
      at: Date;
      cents: number;
      causeType?: 'refund' | 'dispute';
      kind?: string;
      status?: string;
      stripeReversalId?: string | null;
      /** Default: a cause of its own. */
      causeId?: string;
    }
  ): Promise<void> {
    await db.insert(payoutReversals).values({
      payoutId,
      causeType: values.causeType ?? 'refund',
      causeId: values.causeId ?? `re_tb_${crypto.randomUUID().slice(0, 12)}`,
      amountCents: values.cents,
      kind: values.kind ?? 'transfer_reversal',
      status: values.status ?? 'done',
      stripeReversalId:
        values.stripeReversalId === undefined
          ? `trr_tb_${crypto.randomUUID().slice(0, 12)}`
          : values.stripeReversalId,
      resolvedAt: values.at,
    });
  }

  it('the payee’s own take-backs that moved money in the window, newest first, named', async () => {
    const me = await payee();
    const other = await payee();
    const mine = await slice(me);
    const theirs = await slice(other);
    const hoursBefore = (hours: number) =>
      new Date(SINCE.getTime() - hours * HOUR);
    // In: a chargeback's reversal, and a cancellation that reversed a late transfer.
    await step(mine, { at: hoursBefore(2), cents: 840, causeType: 'dispute' });
    await step(mine, { at: hoursBefore(6), cents: 300, kind: 'cancellation' });
    // Out: moved nothing, not done, outside the window, or someone else's.
    await step(mine, {
      at: hoursBefore(1),
      cents: 111,
      kind: 'pending_reduction',
    });
    await step(mine, {
      at: hoursBefore(3),
      cents: 222,
      kind: 'cancellation',
      stripeReversalId: null,
    });
    await step(mine, { at: hoursBefore(4), cents: 333, status: 'failed' });
    await step(mine, { at: hoursBefore(30), cents: 444 });
    await step(mine, { at: new Date(SINCE.getTime() + HOUR), cents: 555 });
    await step(theirs, {
      at: hoursBefore(1),
      cents: 666,
      causeType: 'dispute',
    });

    const takeBacks = await episodeTakeBacks(db, {
      userId: me,
      negativeSince: SINCE,
      negativeAfter: hoursBefore(24),
    });

    expect(takeBacks).toEqual([
      {
        causeType: 'dispute',
        cents: 840,
        at: hoursBefore(2),
        title: tierName,
        organizationId: orgId,
        organisationName: 'Hollow Oak Films',
        payoutTypes: ['creator_payout'],
      },
      {
        causeType: 'refund',
        cents: 300,
        at: hoursBefore(6),
        title: tierName,
        organizationId: orgId,
        organisationName: 'Hollow Oak Films',
        payoutTypes: ['creator_payout'],
      },
    ]);
  });

  it('with no check above zero on record, the window is the 7 days before', async () => {
    const me = await payee();
    const mine = await slice(me);
    await step(mine, { at: new Date(SINCE.getTime() - 6 * DAY), cents: 700 });
    await step(mine, { at: new Date(SINCE.getTime() - 8 * DAY), cents: 800 });

    const takeBacks = await episodeTakeBacks(db, {
      userId: me,
      negativeSince: SINCE,
      negativeAfter: null,
    });

    expect(takeBacks.map((takeBack) => takeBack.cents)).toEqual([700]);
  });

  it('more than 20 in the window: the newest 20, newest first', async () => {
    const me = await payee();
    const mine = await slice(me);
    // 22 take-backs, one an hour before the check; cents names the hour.
    for (let hour = 1; hour <= 22; hour++) {
      await step(mine, {
        at: new Date(SINCE.getTime() - hour * HOUR),
        cents: hour,
      });
    }

    const takeBacks = await episodeTakeBacks(db, {
      userId: me,
      negativeSince: SINCE,
      negativeAfter: null,
    });

    expect(takeBacks.map((takeBack) => takeBack.cents)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
  });

  // Web r2 R2-L2: a solo owner-creator's one chargeback is two steps.
  it('one entry per cause: its steps summed, its payout types named', async () => {
    const owner = await payee();
    const ownerShare = await slice(owner, 'organization_fee');
    const creatorShare = await slice(owner, 'creator_payout');
    const dispute = `dp_tb_${crypto.randomUUID().slice(0, 12)}`;
    await step(ownerShare, {
      at: new Date(SINCE.getTime() - 3 * HOUR),
      cents: 144,
      causeType: 'dispute',
      causeId: dispute,
    });
    await step(creatorShare, {
      at: new Date(SINCE.getTime() - 2 * HOUR),
      cents: 1296,
      causeType: 'dispute',
      causeId: dispute,
    });
    // A refund of another sale stays its own cause.
    await step(creatorShare, {
      at: new Date(SINCE.getTime() - 5 * HOUR),
      cents: 300,
    });

    const takeBacks = await episodeTakeBacks(db, {
      userId: owner,
      negativeSince: SINCE,
      negativeAfter: null,
    });

    expect(takeBacks).toEqual([
      {
        causeType: 'dispute',
        cents: 1440,
        at: new Date(SINCE.getTime() - 2 * HOUR),
        title: tierName,
        organizationId: orgId,
        organisationName: 'Hollow Oak Films',
        payoutTypes: ['creator_payout', 'organization_fee'],
      },
      expect.objectContaining({
        causeType: 'refund',
        cents: 300,
        payoutTypes: ['creator_payout'],
      }),
    ]);
  });

  // Amendment 3: the ledger rows the towards-sharing reads.
  describe('ledgerSalesSince', () => {
    async function paid(
      userId: string,
      values: {
        cents: number;
        at: Date;
        payoutType?: 'creator_payout' | 'organization_fee' | 'platform_fee';
        status?: 'paid' | 'reversed';
      }
    ): Promise<string> {
      const [row] = await db
        .insert(payouts)
        .values({
          userId,
          organizationId: orgId,
          subscriptionId,
          amountCents: values.cents,
          payoutType: values.payoutType ?? 'creator_payout',
          status: values.status ?? 'paid',
          reason: null,
          stripeChargeId: `ch_ls_${crypto.randomUUID().slice(0, 12)}`,
          stripeTransferId: `tr_ls_${crypto.randomUUID().slice(0, 12)}`,
          createdAt: values.at,
          resolvedAt: values.at,
        })
        .returning();
      if (!row) throw new Error('payout not inserted');
      payoutIds.push(row.id);
      return row.id;
    }

    it('the payee’s own sent rows since then: what the drain sent, and each take-back that moved money, with when', async () => {
      const me = await payee();
      const other = await payee();
      const recent = new Date(SINCE.getTime() - 2 * DAY);
      const later = new Date(SINCE.getTime() + 3 * DAY);
      const sale = await paid(me, { cents: 5000, at: recent });
      // A partial refund before the drain: it sent £47, not £50, so the
      // reduction is off what was sent (review r5 MED-1; the drain's own
      // `payable`). Not a take-back: Stripe moved nothing.
      await step(sale, { at: recent, cents: 300, kind: 'pending_reduction' });
      await step(sale, { at: later, cents: 1200 });
      // Moved nothing: neither sent less nor taken back.
      await step(sale, {
        at: later,
        cents: 50,
        kind: 'cancellation',
        stripeReversalId: null,
      });
      await step(sale, { at: later, cents: 70, status: 'failed' });
      const share = await paid(me, {
        cents: 700,
        at: recent,
        payoutType: 'organization_fee',
      });
      // Reversed since: kept, so a reading before its reversal values it
      // as it was then (review r5 MED-2).
      const reversed = await paid(me, {
        cents: 200,
        at: recent,
        status: 'reversed',
      });
      await step(reversed, { at: later, cents: 200 });
      // Not the payee's money in Stripe, or not theirs at all, or too old.
      await paid(me, { cents: 100, at: recent, payoutType: 'platform_fee' });
      await paid(other, { cents: 300, at: recent });
      await paid(me, { cents: 400, at: new Date(SINCE.getTime() - 40 * DAY) });

      const rows = await ledgerSalesSince(
        db,
        me,
        new Date(SINCE.getTime() - 20 * DAY)
      );

      expect(
        rows
          .map(({ payoutId, sentCents, takeBacks }) => ({
            payoutId,
            sentCents,
            takeBacks,
          }))
          .sort((a, b) => a.sentCents - b.sentCents)
      ).toEqual([
        {
          payoutId: reversed,
          sentCents: 200,
          takeBacks: [{ at: later, cents: 200 }],
        },
        { payoutId: share, sentCents: 700, takeBacks: [] },
        {
          payoutId: sale,
          sentCents: 4700,
          takeBacks: [{ at: later, cents: 1200 }],
        },
      ]);
      expect(rows.find((row) => row.payoutId === sale)).toMatchObject({
        stripeTransferId: expect.stringMatching(/^tr_ls_/),
        createdAt: recent,
        transferredAt: recent,
        hasCharge: true,
      });
    });
  });
});
