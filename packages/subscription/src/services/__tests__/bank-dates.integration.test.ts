/**
 * What Studio and the payout-released email say about the bank
 * (Codex-2hxff.29, data design §3.3, §5.4), and the waiting-money banner's
 * total (Codex-2hxff.34, §3.3): `bankOn` on both ledger reads, `waiting` on
 * the earnings summary, and the drain's three bank fields.
 *
 * Real database: `bankOn` depends on the payee's `connect_balances` row, and
 * `waiting` is the shared `waitingMoney` query.
 */

import {
  connectBalances,
  organizations,
  payoutReversals,
  payouts,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestMoneyDeps,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SubscriptionService } from '../subscription-service';

const DAY = 24 * 60 * 60 * 1000;

describe('bank dates and waiting money on the earnings reads', () => {
  let db: Database;
  let orgId: string;
  const userIds: string[] = [];
  const accountIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('bank-dates') })
        )
        .returning()
    ).id;
  });

  // Every row this file wrote: the hourly drain and the money sweep are global.
  afterAll(async () => {
    if (userIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(
          inArray(
            payoutReversals.payoutId,
            db
              .select({ id: payouts.id })
              .from(payouts)
              .where(inArray(payouts.userId, userIds))
          )
        );
      await db.delete(payouts).where(inArray(payouts.userId, userIds));
      await db
        .delete(connectBalances)
        .where(inArray(connectBalances.userId, userIds));
      await db
        .delete(stripeConnectAccounts)
        .where(inArray(stripeConnectAccounts.userId, userIds));
    }
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await teardownTestDatabase();
  });

  /** A payee with an active account; `manualSince` switches it. */
  async function payee(manualSince: Date | null): Promise<{
    userId: string;
    stripeAccountId: string;
  }> {
    const [userId] = await seedTestUsers(db, 1);
    if (!userId) throw new Error('no user');
    userIds.push(userId);
    const stripeAccountId = `acct_dates_${crypto.randomUUID().slice(0, 12)}`;
    accountIds.push(stripeAccountId);
    await db.insert(stripeConnectAccounts).values({
      userId,
      stripeAccountId,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    if (manualSince) {
      await db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: manualSince,
      });
    }
    return { userId, stripeAccountId };
  }

  async function row(
    userId: string,
    values: Partial<typeof payouts.$inferInsert>
  ): Promise<string> {
    return takeFirst(
      await db
        .insert(payouts)
        .values({
          userId,
          organizationId: orgId,
          sourceType: 'purchase',
          amountCents: 1170,
          currency: 'gbp',
          payoutType: 'creator_payout',
          status: 'paid',
          reason: null,
          stripeChargeId: `ch_dates_${crypto.randomUUID().slice(0, 12)}`,
          stripeTransferId: `tr_dates_${crypto.randomUUID().slice(0, 12)}`,
          ...values,
        })
        .returning()
    ).id;
  }

  function service() {
    const payoutMailer = vi.fn();
    return {
      payoutMailer,
      service: new SubscriptionService(
        {
          db,
          environment: 'test',
          // The bare domain, as WEB_APP_URL is: it has no studio route.
          webAppUrl: 'http://lvh.me:3000',
          ...createTestMoneyDeps(),
          payoutMailer,
        },
        createMockStripe()
      ),
    };
  }

  it('bankOn: a paid sale on a switched account goes at the first 08:00 London 14 days after it', async () => {
    const { userId } = await payee(new Date('2026-09-01T00:00:00Z'));
    const sale = await row(userId, {
      createdAt: new Date('2026-10-14T12:00:00Z'),
      resolvedAt: new Date('2026-10-14T12:00:05Z'),
    });
    // A re-pay row has no charge: it goes at the next run after its transfer.
    const repay = await row(userId, {
      stripeChargeId: null,
      createdAt: new Date('2026-10-27T15:00:00Z'),
      resolvedAt: new Date('2026-10-28T09:00:00Z'),
    });
    const waiting = await row(userId, {
      status: 'pending',
      reason: 'connect_not_ready',
      stripeTransferId: null,
      createdAt: new Date('2026-10-20T12:00:00Z'),
    });

    const { items } = await service().service.listPayoutsForCreator(userId, {
      page: 1,
      limit: 20,
    });
    const bankOn = new Map(items.map((item) => [item.id, item.bankOn]));

    expect(bankOn.get(sale)).toBe('2026-10-29');
    expect(bankOn.get(repay)).toBe('2026-10-29');
    expect(bankOn.get(waiting)).toBeNull();
  });

  it('bankOn is null while Stripe’s own schedule still pays the account', async () => {
    const { userId } = await payee(null);
    const sale = await row(userId, {
      createdAt: new Date('2026-10-14T12:00:00Z'),
      resolvedAt: new Date('2026-10-14T12:00:05Z'),
    });

    const { items } = await service().service.listPayoutsForCreator(userId, {
      page: 1,
      limit: 20,
    });

    expect(items.find((item) => item.id === sale)?.bankOn).toBeNull();
  });

  it('the organisation’s ledger dates each row by its own payee’s account', async () => {
    const switched = await payee(new Date('2026-09-01T00:00:00Z'));
    const unswitched = await payee(null);
    const at = {
      createdAt: new Date('2026-10-14T12:00:00Z'),
      resolvedAt: new Date('2026-10-14T12:00:05Z'),
    };
    const switchedRow = await row(switched.userId, at);
    const unswitchedRow = await row(unswitched.userId, at);

    const { items } = await service().service.listPayoutsByOrg(orgId, {
      page: 1,
      limit: 100,
    });
    const bankOn = new Map(items.map((item) => [item.id, item.bankOn]));

    expect(bankOn.get(switchedRow)).toBe('2026-10-29');
    expect(bankOn.get(unswitchedRow)).toBeNull();
  });

  // Round 6: nothing went to the bank while the balance was below zero, so a
  // date inside the last episode that ended moves to the run that saw it
  // clear. Mon 26 Oct to Mon 2 Nov 2026, GMT.
  describe('after a below-zero episode that has cleared', () => {
    const sales = {
      before: '2026-10-10T12:00:00Z',
      inside: '2026-10-14T12:00:00Z',
      after: '2026-10-19T12:00:00Z',
    };
    async function clearedPayee() {
      const who = await payee(new Date('2026-09-01T00:00:00Z'));
      await db
        .update(connectBalances)
        .set({
          clearedSince: new Date('2026-10-26T08:00:00Z'),
          clearedAt: new Date('2026-11-02T08:00:00Z'),
          clearedReason: 'recovered',
          clearedOwedCents: 840,
        })
        .where(eq(connectBalances.stripeAccountId, who.stripeAccountId));
      const ids: Record<string, string> = {};
      for (const [when, iso] of Object.entries(sales)) {
        ids[when] = await row(who.userId, {
          createdAt: new Date(iso),
          resolvedAt: new Date(new Date(iso).getTime() + 5000),
        });
      }
      return { ...who, ids };
    }

    it('the earnings ledger: inside moves to the clearing run; before and after stand', async () => {
      const { userId, ids } = await clearedPayee();

      const { items } = await service().service.listPayoutsForCreator(userId, {
        page: 1,
        limit: 20,
      });
      const bankOn = new Map(items.map((item) => [item.id, item.bankOn]));

      expect(bankOn.get(ids.before ?? '')).toBe('2026-10-25');
      expect(bankOn.get(ids.inside ?? '')).toBe('2026-11-02');
      expect(bankOn.get(ids.after ?? '')).toBe('2026-11-03');
    });

    it('the organisation’s ledger moves only that payee’s rows', async () => {
      const cleared = await clearedPayee();
      const other = await payee(new Date('2026-09-01T00:00:00Z'));
      const othersInside = await row(other.userId, {
        createdAt: new Date(sales.inside),
        resolvedAt: new Date(new Date(sales.inside).getTime() + 5000),
      });

      const { items } = await service().service.listPayoutsByOrg(orgId, {
        page: 1,
        limit: 100,
      });
      const bankOn = new Map(items.map((item) => [item.id, item.bankOn]));

      expect(bankOn.get(cleared.ids.inside ?? '')).toBe('2026-11-02');
      expect(bankOn.get(cleared.ids.before ?? '')).toBe('2026-10-25');
      expect(bankOn.get(othersInside)).toBe('2026-10-29');
    });
  });

  // Web r2 R2-L3: the Held rows are the ones transferred lately, not created.
  it('transferredFrom keeps a backlog sale released late, which a createdAt window drops', async () => {
    const { userId } = await payee(new Date(Date.now() - 60 * DAY));
    const backlog = await row(userId, {
      createdAt: new Date(Date.now() - 40 * DAY),
      resolvedAt: new Date(Date.now() - DAY),
    });
    const old = await row(userId, {
      createdAt: new Date(Date.now() - 40 * DAY),
      resolvedAt: new Date(Date.now() - 40 * DAY),
    });
    const threeDaysAgo = new Date(Date.now() - 3 * DAY).toISOString();
    const ids = async (filter: {
      transferredFrom?: string;
      fromDate?: string;
    }) =>
      new Set(
        (
          await service().service.listPayoutsByOrg(orgId, {
            page: 1,
            limit: 100,
            ...filter,
          })
        ).items.map((item) => item.id)
      );

    const transferred = await ids({ transferredFrom: threeDaysAgo });
    expect(transferred.has(backlog)).toBe(true);
    expect(transferred.has(old)).toBe(false);
    // The createdAt window it replaces for Held drops the backlog sale.
    expect((await ids({ fromDate: threeDaysAgo })).has(backlog)).toBe(false);
  });

  it('waiting: the money waiting for setup, from the email’s own query', async () => {
    const [userId] = await seedTestUsers(db, 1);
    if (!userId) throw new Error('no user');
    userIds.push(userId);
    const createdAt = new Date(Date.now() - 40 * DAY);
    await row(userId, {
      status: 'pending',
      reason: 'connect_not_ready',
      stripeTransferId: null,
      amountCents: 4210,
      createdAt,
    });

    const summary =
      await service().service.getEarningsSummaryForCreator(userId);

    expect(summary.waiting).toEqual({
      totalCents: 4210,
      oldestAt: createdAt.toISOString(),
      organisations: [
        expect.objectContaining({
          organizationId: orgId,
          asOwner: false,
          cents: 4210,
        }),
      ],
      setup: 'not_started',
    });
  });

  it('payout-released says when the money reaches the bank, from the account’s real state, and greets by name', async () => {
    const switched = await payee(new Date(Date.now() - 60 * DAY));
    const unswitched = await payee(null);
    for (const { userId } of [switched, unswitched]) {
      await row(userId, {
        status: 'pending',
        reason: 'connect_not_ready',
        stripeTransferId: null,
        createdAt: new Date(Date.now() - 40 * DAY),
      });
    }
    const [{ name } = { name: null }] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, switched.userId));

    const manual = service();
    await manual.service.resolvePendingPayoutsForAccount(
      switched.stripeAccountId
    );
    const scheduled = service();
    await scheduled.service.resolvePendingPayoutsForAccount(
      unswitched.stripeAccountId
    );

    const sent = (mailer: ReturnType<typeof vi.fn>) =>
      mailer.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(manual.payoutMailer).toHaveBeenCalledOnce();
    expect(sent(manual.payoutMailer)).toMatchObject({
      creatorName: name || 'there',
      bankSentence: expect.stringMatching(
        /^Every sale in it is more than 14 days old, so it goes to your bank at the next daily payout, on \w{3} \d{1,2} \w{3}\./
      ),
      bankLines: expect.stringMatching(/^To your bank on .+: £11\.70$/),
      bankDate: expect.stringMatching(/^\w{3} \d{1,2} \w{3}$/),
      // Earnings is on the creators subdomain; the bare domain's is a 404.
      dashboardUrl: 'http://creators.lvh.me:3000/studio/earnings',
    });
    expect(sent(scheduled.payoutMailer)).toMatchObject({
      bankSentence:
        'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.',
    });
  });

  // Review r2 LOW-1: only the cron's own drain runs ahead of the bank payout
  // in its wake; any other drain's transfer may land after the job read the
  // account. Wed 4 Nov 2026 is GMT: the run is 08:00Z.
  it.each([
    { who: 'the cron’s own drain', cronDrain: true, day: 'Wed 4 Nov' },
    { who: 'any other drain', cronDrain: false, day: 'Thu 5 Nov' },
  ])('in the 08:00 wake, $who names $day', async ({ cronDrain, day }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T08:05:00Z'));
    try {
      const switched = await payee(new Date(Date.now() - 60 * DAY));
      await row(switched.userId, {
        status: 'pending',
        reason: 'connect_not_ready',
        stripeTransferId: null,
        createdAt: new Date(Date.now() - 40 * DAY),
      });
      const drain = service();

      await drain.service.resolvePendingPayoutsForAccount(
        switched.stripeAccountId,
        undefined,
        { cronDrain }
      );

      expect(drain.payoutMailer.mock.calls[0]?.[0]?.data).toMatchObject({
        bankDate: day,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the hourly sweep hands its cron flag to each payee’s drain', async () => {
    const switched = await payee(new Date(Date.now() - 60 * DAY));
    const stripe = createMockStripe();
    stripe.accounts.retrieve = vi
      .fn()
      .mockResolvedValue({ charges_enabled: true, payouts_enabled: true });
    const sweep = new SubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        payoutMailer: vi.fn(),
      },
      stripe
    );
    // Only this payee: the claim reads the whole table.
    vi.spyOn(
      sweep as unknown as { claimSweepPayees: () => Promise<unknown> },
      'claimSweepPayees'
    ).mockResolvedValue([{ userId: switched.userId, organizationId: null }]);
    const drain = vi
      .spyOn(sweep, 'resolvePendingPayoutsForAccount')
      .mockResolvedValue({ resolved: 0, failed: 0 });

    await sweep.sweepUnresolvedPayouts(15, 50, { cronDrain: true });
    await sweep.sweepUnresolvedPayouts(15, 50);

    expect(drain.mock.calls.map(([id, , options]) => [id, options])).toEqual([
      [switched.stripeAccountId, { cronDrain: true }],
      [switched.stripeAccountId, { cronDrain: false }],
    ]);
  });

  /** A done step of `kind` on a row, resolved at `at`. */
  async function step(
    payoutId: string,
    at: string,
    causeType: 'refund' | 'dispute',
    kind = 'transfer_reversal'
  ): Promise<void> {
    await db.insert(payoutReversals).values({
      payoutId,
      causeType,
      causeId: `re_taken_${crypto.randomUUID().slice(0, 12)}`,
      amountCents: 300,
      kind,
      status: 'done',
      stripeReversalId:
        kind === 'transfer_reversal'
          ? `trr_taken_${crypto.randomUUID().slice(0, 12)}`
          : null,
      resolvedAt: new Date(at),
    });
  }

  it('takenBack: a reversed row’s latest step that moved money; null on any other row', async () => {
    const me = await payee(new Date(Date.now() - 60 * DAY));
    const paidAt = new Date(Date.now() - 20 * DAY);
    const reversed = await row(me.userId, {
      status: 'reversed',
      resolvedAt: paidAt,
    });
    const partlyRefunded = await row(me.userId, { resolvedAt: paidAt });
    await step(reversed, '2026-10-20T10:00:00Z', 'refund');
    await step(reversed, '2026-10-26T10:00:00Z', 'dispute');
    // Later, but it moved nothing.
    await step(reversed, '2026-10-27T10:00:00Z', 'refund', 'pending_reduction');
    await step(partlyRefunded, '2026-10-26T10:00:00Z', 'refund');

    const { items } = await service().service.listPayoutsForCreator(me.userId, {
      page: 1,
      limit: 50,
    });

    const of = (id: string) => items.find((item) => item.id === id)?.takenBack;
    expect(of(reversed)).toEqual({ causeType: 'dispute', on: '2026-10-26' });
    expect(of(partlyRefunded)).toBeNull();
  });

  it('takenBack never reads another payee’s rows', async () => {
    const me = await payee(new Date(Date.now() - 60 * DAY));
    const other = await payee(new Date(Date.now() - 60 * DAY));
    const theirs = await row(other.userId, {
      status: 'reversed',
      resolvedAt: new Date(Date.now() - 20 * DAY),
    });
    await step(theirs, '2026-10-26T10:00:00Z', 'dispute');
    const reader = service().service as unknown as {
      takenBackFor(
        userId: string,
        ids: string[]
      ): Promise<Map<string, unknown>>;
    };

    expect((await reader.takenBackFor(me.userId, [theirs])).size).toBe(0);
    expect((await reader.takenBackFor(other.userId, [theirs])).size).toBe(1);
  });
});
