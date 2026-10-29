/**
 * The daily money sweep (Codex-2hxff.34, .30; batch B design §2.3, §5.2,
 * §12).
 *
 * The wording helpers are pure. The runs are database-backed (this worker's
 * `.dev.vars.test` database), with the mailer injected: the claim on
 * `money_notices` is the behaviour under test, so a mocked database would
 * prove nothing. Every row hangs off this file's own users and is deleted in
 * afterAll. The sweep reads the whole table, so the mailer may also see other
 * suites' people; every assertion filters to this file's.
 */

import { env } from 'cloudflare:test';
import { createDbClient, type Database, eq, inArray } from '@codex/database';
import {
  connectBalances,
  moneyNotices,
  organizations,
  payoutReversals,
  payouts,
  users,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  episodeKey,
  formatGbp,
  greetingName,
  organisationLines,
  ruleSentence,
  takeBackSentences,
  waitingReminderData,
} from '../money-notice-copy';
import {
  type MoneyMailerParams,
  runMoneyNoticesSweep,
} from '../money-notices-sweep';

const DAY = 24 * 60 * 60 * 1000;

// ─── Wording ────────────────────────────────────────────────────────────────

describe('money sweep wording', () => {
  it('formats pounds, with a real minus sign below zero', () => {
    expect(formatGbp(6710)).toBe('£67.10');
    expect(formatGbp(123456)).toBe('£1,234.56');
    expect(formatGbp(-840)).toBe('−£8.40');
  });

  it('greets by name, else "there", never blank', () => {
    expect(greetingName('Jonah Reyes')).toBe('Jonah Reyes');
    expect(greetingName('   ')).toBe('there');
    expect(greetingName(null)).toBe('there');
  });

  const waiting = {
    userId: 'u',
    totalCents: 13890,
    oldestAt: new Date('2026-09-02T09:00:00Z'),
    setup: 'incomplete' as const,
    organisations: [
      {
        organizationId: 'b',
        name: 'Northlight Collective',
        asOwner: true,
        cents: 9630,
        oldestAt: new Date('2026-09-02T09:00:00Z'),
      },
      {
        organizationId: 'a',
        name: 'Hollow Oak Films',
        asOwner: false,
        cents: 4260,
        oldestAt: new Date('2026-09-10T09:00:00Z'),
      },
    ],
  };

  it('lists the organisations on one line, the owner share named (M2)', () => {
    expect(organisationLines(waiting)).toBe(
      "Northlight Collective (organisation's share, as owner): £96.30 · Hollow Oak Films: £42.60"
    );
  });

  it('composes the payouts-waiting fields for each setup state (M1-M3)', () => {
    const data = waitingReminderData(waiting, 'Tom', 'https://x.test/e');
    expect(data).toMatchObject({
      userName: 'Tom',
      totalFormatted: '£138.90',
      waitingSince: '2 Sep 2026',
      buttonLabel: 'Finish setting up payouts',
      dashboardUrl: 'https://x.test/e',
    });
    expect(data.statusSentence).toContain("didn't finish");
    expect(
      waitingReminderData({ ...waiting, setup: 'not_started' }, 'T', 'u')
        .buttonLabel
    ).toBe('Set up payouts');
    expect(
      waitingReminderData({ ...waiting, setup: 'paused' }, 'T', 'u')
        .statusSentence
    ).toContain('Resume onboarding');
  });

  it('names the take-back, and only a chargeback can be paid back (M7)', () => {
    const at = new Date('2026-10-26T14:00:00Z');
    expect(
      takeBackSentences([
        {
          cents: 1440,
          causeType: 'dispute',
          at,
          title: 'Winter Light',
          organisationName: 'Hollow Oak Films',
        },
      ])
    ).toEqual({
      takeBackSentence:
        'A chargeback on ‘Winter Light’ (Hollow Oak Films) took back £14.40 on 26 Oct.',
      paidBackSentence:
        "If the buyer's bank decides for us, the £14.40 is paid back to you.",
    });
    expect(
      takeBackSentences([
        {
          cents: 500,
          causeType: 'refund',
          at,
          title: null,
          organisationName: null,
        },
        {
          cents: 100,
          causeType: 'refund',
          at,
          title: null,
          organisationName: null,
        },
      ])
    ).toEqual({
      takeBackSentence:
        'A refund on one of your sales took back £5.00 on 26 Oct, along with one other take-back.',
      paidBackSentence: '',
    });
    expect(takeBackSentences([]).paidBackSentence).toBe('');
  });

  it('the Q4 rule: £50 or less is written off at 180 days, more is invoiced at 90', () => {
    const since = new Date('2026-10-27T08:00:00Z');
    expect(ruleSentence(5000, since)).toBe(
      "£50 or less: if it's still below zero on 25 Apr 2027, we'll write off what's left."
    );
    expect(ruleSentence(5001, since)).toBe(
      "Over £50: if more than £50 is still owed on 25 Jan 2027, we'll send you an invoice for what's left."
    );
  });
});

// ─── Runs against the database ──────────────────────────────────────────────

// Each run reads the whole (shared test) database over HTTP.
describe('runMoneyNoticesSweep', { timeout: 60_000 }, () => {
  let db: Database;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const payoutIds: string[] = [];
  const accountIds: string[] = [];
  let hollowOak: string;
  let northlight: string;

  const obsLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const obs = obsLog as unknown as ObservabilityClient;

  beforeAll(async () => {
    db = createDbClient(env as unknown as Bindings);
    const [a, b] = await db
      .insert(organizations)
      .values([
        { name: 'Hollow Oak Films', slug: `sweep-hollow-${suffix}` },
        { name: 'Northlight Collective', slug: `sweep-north-${suffix}` },
      ])
      .returning({ id: organizations.id });
    if (!a || !b) throw new Error('orgs not inserted');
    hollowOak = a.id;
    northlight = b.id;
  });

  afterAll(async () => {
    if (payoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, payoutIds));
      await db.delete(payouts).where(inArray(payouts.id, payoutIds));
    }
    if (accountIds.length > 0) {
      await db
        .delete(connectBalances)
        .where(inArray(connectBalances.stripeAccountId, accountIds));
    }
    if (userIds.length > 0) {
      // money_notices cascade with their user.
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [hollowOak, northlight]));
  });

  async function person(
    name: string,
    idPrefix = 'sweep'
  ): Promise<{ id: string; email: string }> {
    const id = `${idPrefix}-${suffix}-${userIds.length}`;
    const email = `${id}@example.test`;
    await db.insert(users).values({ id, name, email });
    userIds.push(id);
    return { id, email };
  }

  async function waitingRow(
    userId: string,
    organizationId: string,
    cents: number,
    createdAt: Date
  ) {
    const [row] = await db
      .insert(payouts)
      .values({
        userId,
        organizationId,
        amountCents: cents,
        payoutType: 'creator_payout',
        status: 'pending',
        reason: 'connect_not_ready',
        stripeChargeId: `ch_sweep_${crypto.randomUUID().slice(0, 12)}`,
        createdAt,
      })
      .returning({ id: payouts.id });
    if (!row) throw new Error('payout not inserted');
    payoutIds.push(row.id);
    return row.id;
  }

  async function negativeBalance(
    userId: string,
    values: Partial<typeof connectBalances.$inferInsert>
  ): Promise<string> {
    const stripeAccountId = `acct_sweep_${crypto.randomUUID().slice(0, 12)}`;
    await db
      .insert(connectBalances)
      .values({ stripeAccountId, userId, ...values });
    accountIds.push(stripeAccountId);
    return stripeAccountId;
  }

  const noticesOf = (userId: string) =>
    db.select().from(moneyNotices).where(eq(moneyNotices.userId, userId));

  function sweep(
    now: Date,
    overrides: {
      mailer?: (p: MoneyMailerParams) => Promise<void>;
      templateExists?: (name: string) => Promise<boolean>;
      pageSize?: number;
      maxPages?: number;
    } = {}
  ) {
    const mailer = vi.fn(overrides.mailer ?? (async () => {}));
    const run = runMoneyNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now,
      mailer,
      templateExists: overrides.templateExists ?? (async () => true),
      pageSize: overrides.pageSize,
      maxPages: overrides.maxPages,
    });
    return { run, mailer };
  }

  const callsFor = (
    mailer: ReturnType<typeof vi.fn>,
    userId: string
  ): MoneyMailerParams[] =>
    mailer.mock.calls
      .map((c) => c[0] as MoneyMailerParams)
      .filter((p) => p.userId === userId);

  // 1 Nov 2026, 08:00 London (GMT): the London month is 2026-11.
  const NOV_1 = new Date('2026-11-01T08:00:00Z');
  const SEP_14 = new Date('2026-09-14T15:00:00Z');

  it('reminds once per London month, with the M1 fields', async () => {
    const jonah = await person('Jonah Reyes');
    await waitingRow(jonah.id, hollowOak, 4095, SEP_14);
    await waitingRow(
      jonah.id,
      northlight,
      2615,
      new Date('2026-09-20T10:00:00Z')
    );

    const first = sweep(NOV_1);
    await first.run;
    const [sent, ...more] = callsFor(first.mailer, jonah.id);
    expect(more).toEqual([]);
    expect(sent).toMatchObject({
      to: jonah.email,
      templateName: 'payouts-waiting',
      category: 'transactional',
      data: {
        userName: 'Jonah Reyes',
        totalFormatted: '£67.10',
        organisationLines:
          'Hollow Oak Films: £40.95 · Northlight Collective: £26.15',
        waitingSince: '14 Sep 2026',
        buttonLabel: 'Set up payouts',
      },
    });
    const [notice] = await noticesOf(jonah.id);
    expect(notice).toMatchObject({
      kind: 'payouts_waiting',
      periodKey: '2026-11',
      amountCents: 6710,
      failedAt: null,
    });
    expect(notice?.sentAt).not.toBeNull();

    const again = sweep(new Date(NOV_1.getTime() + 3 * DAY));
    await again.run;
    expect(callsFor(again.mailer, jonah.id)).toEqual([]);
  });

  it('waits 21 days after the last reminder, whatever the month', async () => {
    const maya = await person('Maya Okafor');
    await waitingRow(maya.id, hollowOak, 4210, SEP_14);
    // Reminded on 31 Oct, under October's period.
    await db.insert(moneyNotices).values({
      userId: maya.id,
      kind: 'payouts_waiting',
      periodKey: '2026-10',
      amountCents: 4210,
      sentAt: new Date('2026-10-31T08:00:00Z'),
      createdAt: new Date('2026-10-31T08:00:00Z'),
    });

    const nextDay = sweep(NOV_1);
    await nextDay.run;
    expect(callsFor(nextDay.mailer, maya.id)).toEqual([]);

    const later = sweep(new Date('2026-11-22T08:00:00Z'));
    await later.run;
    expect(callsFor(later.mailer, maya.id)).toHaveLength(1);
  });

  it('a failed send records failed_at and is not sent again', async () => {
    const tom = await person('Tom Ellison');
    await waitingRow(tom.id, northlight, 9630, SEP_14);

    const failing = sweep(NOV_1, {
      mailer: async (p) => {
        if (p.userId === tom.id) throw new Error('notifications-api 503');
      },
    });
    const result = await failing.run;
    expect(result.sendsFailed).toBeGreaterThanOrEqual(1);
    const [notice] = await noticesOf(tom.id);
    expect(notice?.failedAt).not.toBeNull();
    expect(notice?.sentAt).toBeNull();

    const retry = sweep(new Date(NOV_1.getTime() + DAY));
    await retry.run;
    expect(callsFor(retry.mailer, tom.id)).toEqual([]);
  });

  it('a missing template skips its kind before anything is claimed', async () => {
    const ruth = await person('Ruth Calder');
    await waitingRow(ruth.id, hollowOak, 1000, SEP_14);

    const unseeded = sweep(NOV_1, {
      templateExists: async (name) => name !== 'payouts-waiting',
    });
    const result = await unseeded.run;
    expect(result.skippedKinds).toContain('payouts_waiting');
    expect(callsFor(unseeded.mailer, ruth.id)).toEqual([]);
    expect(await noticesOf(ruth.id)).toEqual([]);

    // Once the seed has run, the month's reminder still goes.
    const seeded = sweep(NOV_1);
    await seeded.run;
    expect(callsFor(seeded.mailer, ruth.id)).toHaveLength(1);
  });

  it('a balance below zero is emailed once per episode, naming the take-back (M7)', async () => {
    const priya = await person('Priya Shah');
    const since = new Date('2026-10-27T08:00:00Z');
    const after = new Date('2026-10-26T08:00:00Z');
    const [slice] = await db
      .insert(payouts)
      .values({
        userId: priya.id,
        organizationId: hollowOak,
        amountCents: 1440,
        payoutType: 'creator_payout',
        status: 'reversed',
        reason: null,
        stripeChargeId: `ch_sweep_${crypto.randomUUID().slice(0, 12)}`,
        stripeTransferId: `tr_sweep_${crypto.randomUUID().slice(0, 12)}`,
        resolvedAt: new Date('2026-10-26T14:00:00Z'),
      })
      .returning({ id: payouts.id });
    if (!slice) throw new Error('slice not inserted');
    payoutIds.push(slice.id);
    await db.insert(payoutReversals).values({
      payoutId: slice.id,
      causeType: 'dispute',
      causeId: `dp_sweep_${crypto.randomUUID().slice(0, 12)}`,
      amountCents: 1440,
      kind: 'transfer_reversal',
      status: 'done',
      resolvedAt: new Date('2026-10-26T14:00:00Z'),
    });
    const acct = await negativeBalance(priya.id, {
      availableCents: -840,
      pendingCents: 0,
      checkedAt: since,
      negativeSince: since,
      negativeAfter: after,
    });

    const first = sweep(new Date('2026-10-28T08:00:00Z'));
    await first.run;
    const [sent, ...more] = callsFor(first.mailer, priya.id);
    expect(more).toEqual([]);
    expect(sent).toMatchObject({
      templateName: 'stripe-balance-below-zero',
      data: {
        userName: 'Priya Shah',
        balanceFormatted: '−£8.40',
        takeBackSentence:
          'A chargeback on one of your sales (Hollow Oak Films) took back £14.40 on 26 Oct.',
        paidBackSentence:
          "If the buyer's bank decides for us, the £14.40 is paid back to you.",
        ruleSentence:
          "£50 or less: if it's still below zero on 25 Apr 2027, we'll write off what's left.",
      },
    });
    const [notice] = await noticesOf(priya.id);
    expect(notice).toMatchObject({
      kind: 'balance_below_zero',
      periodKey: episodeKey(acct, since, after),
      amountCents: 840,
    });

    const nextDay = sweep(new Date('2026-10-29T08:00:00Z'));
    await nextDay.run;
    expect(callsFor(nextDay.mailer, priya.id)).toEqual([]);
  });

  it("a run that reads before the job's write sends it the next morning", async () => {
    const owen = await person('Owen Clarke');
    const acct = await negativeBalance(owen.id, { availableCents: 200 });

    // Winter: both fire at 08:00 UTC, and the sweep read first.
    const early = sweep(new Date('2026-11-02T08:00:00Z'));
    await early.run;
    expect(callsFor(early.mailer, owen.id)).toEqual([]);

    const since = new Date('2026-11-02T08:00:05Z');
    await db
      .update(connectBalances)
      .set({ availableCents: -300, checkedAt: since, negativeSince: since })
      .where(eq(connectBalances.stripeAccountId, acct));
    const nextMorning = sweep(new Date('2026-11-03T08:00:00Z'));
    await nextMorning.run;
    expect(callsFor(nextMorning.mailer, owen.id)).toHaveLength(1);
  });

  async function endedEpisode(
    name: string,
    cleared: {
      clearedReason: 'recovered' | 'stripe_collected';
      availableCents: number;
      clearedOwedCents: number | null;
    },
    toldBelowZero = true
  ) {
    const who = await person(name);
    const since = new Date('2026-04-20T08:00:00Z');
    const acct = await negativeBalance(who.id, {
      availableCents: cleared.availableCents,
      clearedAt: new Date('2026-10-28T08:00:00Z'),
      // The ended episode's start: set exactly when cleared_at is.
      clearedSince: since,
      clearedReason: cleared.clearedReason,
      clearedOwedCents: cleared.clearedOwedCents,
    });
    if (toldBelowZero) {
      await db.insert(moneyNotices).values({
        userId: who.id,
        kind: 'balance_below_zero',
        periodKey: episodeKey(acct, since, null),
        amountCents: 840,
        sentAt: new Date('2026-04-21T08:00:00Z'),
        createdAt: new Date('2026-04-21T08:00:00Z'),
      });
    }
    return { ...who, key: episodeKey(acct, since, null) };
  }

  /** A done take-back on one of the person's slices, taken `at`. */
  async function takenBack(
    userId: string,
    cents: number,
    causeType: 'refund' | 'dispute',
    at: Date
  ) {
    const [slice] = await db
      .insert(payouts)
      .values({
        userId,
        organizationId: hollowOak,
        amountCents: cents,
        payoutType: 'creator_payout',
        status: 'reversed',
        reason: null,
        stripeChargeId: `ch_sweep_${crypto.randomUUID().slice(0, 12)}`,
        stripeTransferId: `tr_sweep_${crypto.randomUUID().slice(0, 12)}`,
        resolvedAt: at,
      })
      .returning({ id: payouts.id });
    if (!slice) throw new Error('slice not inserted');
    payoutIds.push(slice.id);
    await db.insert(payoutReversals).values({
      payoutId: slice.id,
      causeType,
      causeId: `${causeType}_sweep_${crypto.randomUUID().slice(0, 12)}`,
      amountCents: cents,
      kind: 'transfer_reversal',
      status: 'done',
      resolvedAt: at,
    });
  }

  /**
   * One episode, end to end: below zero from `since`, emailed; then cleared
   * as the job's clearing write leaves the row (both bounds nulled), and
   * emailed again. On the wall clock, as the claim's `created_at` is.
   */
  async function belowZeroThenRecoveredFor(
    who: { id: string },
    since: Date,
    after: Date | null
  ) {
    const acct = await negativeBalance(who.id, {
      availableCents: -840,
      pendingCents: 0,
      checkedAt: since,
      negativeSince: since,
      negativeAfter: after,
    });
    const first = sweep(new Date(since.getTime() + 60 * 60 * 1000));
    await first.run;
    const [belowZero] = callsFor(first.mailer, who.id);
    const clearedAt = new Date(Date.now() + 60 * 1000);
    await db
      .update(connectBalances)
      .set({
        availableCents: 360,
        negativeSince: null,
        negativeAfter: null,
        clearedAt,
        clearedSince: since,
        clearedReason: 'recovered',
        clearedOwedCents: 840,
      })
      .where(eq(connectBalances.stripeAccountId, acct));
    const second = sweep(new Date(clearedAt.getTime() + 60 * 60 * 1000));
    await second.run;
    const [recovered] = callsFor(second.mailer, who.id);
    return { belowZero, recovered };
  }

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it('the recovered email names no older take-back than the below-zero email did: inside 7 days, before the episode bound', async () => {
    const since = new Date(Date.now() - 2 * DAY);
    const after = new Date(since.getTime() - DAY);
    // Inside the 7 days a bound-less look-back reaches, but before the last
    // check above zero: not this episode's. Its own isn't on record yet.
    const nadia = await person('Nadia Ferris');
    await takenBack(
      nadia.id,
      600,
      'refund',
      new Date(since.getTime() - 3 * DAY)
    );
    const { belowZero, recovered } = await belowZeroThenRecoveredFor(
      nadia,
      since,
      after
    );
    expect(belowZero?.data.takeBackSentence).toBe(
      'Money was taken back from your Stripe balance for a refund or a chargeback.'
    );
    expect(recovered).toMatchObject({
      templateName: 'stripe-balance-recovered',
      data: {
        coveredSentence:
          'New sales have covered the −£8.40 left by a refund or a chargeback, so bank payouts have resumed.',
      },
    });
  });

  it('the recovered email names the take-back the below-zero email named, from a window wider than 7 days', async () => {
    const since = new Date(Date.now() - 2 * DAY);
    // Ten days since the last check above zero; the take-back is nine back.
    const after = new Date(since.getTime() - 10 * DAY);
    const omar = await person('Omar Haddad');
    await takenBack(
      omar.id,
      1440,
      'dispute',
      new Date(since.getTime() - 9 * DAY)
    );
    const { belowZero, recovered } = await belowZeroThenRecoveredFor(
      omar,
      since,
      after
    );
    expect(belowZero?.data.takeBackSentence).toContain(
      'A chargeback on one of your sales (Hollow Oak Films) took back £14.40 on'
    );
    expect(recovered?.data.coveredSentence).toBe(
      'New sales have covered the −£8.40 left by the chargeback on one of your sales, so bank payouts have resumed.'
    );
  });

  it('a recovered balance is emailed once, under the episode it ended (M9)', async () => {
    const who = await endedEpisode('Leah Ortiz', {
      clearedReason: 'recovered',
      availableCents: 360,
      clearedOwedCents: 840,
    });
    const run = sweep(new Date('2026-10-29T08:00:00Z'));
    await run.run;
    expect(callsFor(run.mailer, who.id)).toEqual([
      expect.objectContaining({
        templateName: 'stripe-balance-recovered',
        data: expect.objectContaining({
          balanceFormatted: '£3.60',
          // What the below-zero email said was owed (M9).
          coveredSentence:
            'New sales have covered the −£8.40 left by a refund or a chargeback, so bank payouts have resumed.',
        }),
      }),
    ]);
    const notices = await noticesOf(who.id);
    expect(notices.find((n) => n.kind === 'balance_recovered')?.periodKey).toBe(
      who.key
    );

    const again = sweep(new Date('2026-10-30T08:00:00Z'));
    await again.run;
    expect(callsFor(again.mailer, who.id)).toEqual([]);
  });

  it('a write-off states what was last owed, and only for £50 or less (M10)', async () => {
    const small = await endedEpisode('Sam Whitfield', {
      clearedReason: 'stripe_collected',
      availableCents: 0,
      clearedOwedCents: 520,
    });
    const large = await endedEpisode('Ellen Marsh', {
      clearedReason: 'stripe_collected',
      availableCents: 0,
      clearedOwedCents: 5820,
    });
    const run = sweep(new Date('2026-10-29T08:00:00Z'));
    await run.run;
    expect(callsFor(run.mailer, small.id)).toEqual([
      expect.objectContaining({
        templateName: 'debt-written-off',
        data: expect.objectContaining({
          amountFormatted: '£5.20',
          balanceFormatted: '£0.00',
          sinceSentence:
            'Your Stripe balance had been below zero since 20 Apr 2026.',
        }),
      }),
    ]);
    // Over £50 is held for the invoice (collected_owed_cents, Creator
    // debts' to_invoice): "you don't owe it" would be false.
    expect(callsFor(run.mailer, large.id)).toEqual([]);
    expect(
      (await noticesOf(large.id)).filter(
        (n) => n.kind === 'balance_written_off'
      )
    ).toEqual([]);
  });

  it('a person never told it went below zero is not told it recovered', async () => {
    const who = await endedEpisode(
      'Hannah Price',
      { clearedReason: 'recovered', availableCents: 100, clearedOwedCents: 50 },
      false
    );
    const run = sweep(new Date('2026-10-29T08:00:00Z'));
    await run.run;
    expect(callsFor(run.mailer, who.id)).toEqual([]);
  });

  it('a write-off with no figure on record is a warning with an errorId, and sends nothing', async () => {
    const who = await endedEpisode('Ben Carter', {
      clearedReason: 'stripe_collected',
      availableCents: 0,
      clearedOwedCents: null,
    });
    obsLog.warn.mockClear();
    const run = sweep(new Date('2026-10-29T08:00:00Z'));
    await run.run;
    expect(callsFor(run.mailer, who.id)).toEqual([]);
    expect(obsLog.warn).toHaveBeenCalledWith(
      'debt-written-off skipped: no written-off figure on record',
      expect.objectContaining({ errorId: expect.any(String) })
    );
  });

  it('a claim lost between the claim and the send is reported with an errorId, not resent', async () => {
    const lost = await person('Grace Liu');
    const [orphan] = await db
      .insert(moneyNotices)
      .values({
        userId: lost.id,
        kind: 'balance_below_zero',
        periodKey: `acct_lost:${suffix}`,
        amountCents: 300,
      })
      .returning({ id: moneyNotices.id });
    obsLog.error.mockClear();
    // Two hours after the claim (the row's created_at is the real now).
    const run = sweep(new Date(Date.now() + 2 * 60 * 60 * 1000));
    const result = await run.run;
    expect(result.orphanedClaims).toBeGreaterThanOrEqual(1);
    expect(obsLog.error).toHaveBeenCalledWith(
      'money notice claimed but never sent or failed; it is not resent',
      expect.objectContaining({
        errorId: expect.any(String),
        moneyNoticeId: orphan?.id,
        kind: 'balance_below_zero',
      })
    );
    expect(callsFor(run.mailer, lost.id)).toEqual([]);
  });

  it('past the page cap, the next run reaches the people the last one did not (MED-2)', async () => {
    // Ids that page first: the cap is reached on this file's own people.
    const [first, second, third] = [
      await person('Cap One', '00000000-b2cap'),
      await person('Cap Two', '00000000-b2cap'),
      await person('Cap Three', '00000000-b2cap'),
    ];
    for (const who of [first, second, third]) {
      if (!who) throw new Error('person not inserted');
      await waitingRow(who.id, hollowOak, 1200, SEP_14);
    }
    const capped = { pageSize: 1, maxPages: 2 };
    const today = sweep(NOV_1, capped);
    await today.run;
    const reached = (m: ReturnType<typeof vi.fn>) =>
      [first, second, third].map((who) => callsFor(m, who?.id ?? '').length);
    expect(reached(today.mailer)).toEqual([1, 1, 0]);

    const tomorrow = sweep(new Date(NOV_1.getTime() + DAY), capped);
    await tomorrow.run;
    // The reminded two are left out of the page, so the cap reaches the third.
    expect(reached(tomorrow.mailer)).toEqual([0, 0, 1]);
  });
});
