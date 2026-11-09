/**
 * The hourly price-moves step (Codex-2hxff.86; batch C1 Part B data design
 * §2.4): it tells and moves the people a price change recorded.
 *
 * Real DB, a fake Stripe that keeps each subscription's live item and
 * metadata, and a fake mailer. Changes are recorded with the real
 * `recordTierPriceChange` / `recordPlanPriceChange`, and every run is
 * limited to this file's own changes (`onlyChangeIds`), as the suites share
 * one database. Every run's time is fixed, away from the 08:00 London run.
 * Every row hangs off this file's own organisations and users, deleted in
 * afterAll, children first: the new foreign keys all RESTRICT.
 */

import { TEST_SEND_METADATA } from '@codex/database';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  emailAuditLogs,
  organizations,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addMonthsClamped,
  type NoticeDelivery,
  type PriceChangeNoticeMailer,
  recordPlanPriceChange,
  recordTierPriceChange,
} from '../pending-price-change';
import {
  PRICE_MOVES_PER_RUN,
  type PriceMoveStepOptions,
  priceMovesDoneBy,
  readPriceChangeProgress,
  runPriceMoveStep,
} from '../price-moves-sweep';

type Tier = typeof subscriptionTiers.$inferSelect;
type Sub = typeof subscriptions.$inferSelect;
type Move = typeof subscriptionPriceMoves.$inferSelect;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DAY_S = 86_400;
/** Thu 14 Jan 2027, 10:00 London (GMT): not the bank payout's run. */
const NOW = Date.UTC(2027, 0, 14, 10);
/** Each run's emails go five minutes after its scheduled time. */
const SENT_AFTER_MS = 5 * 60 * 1000;
const PRICE_OLD = 'price_pm_old';
const PRICE_NEW = 'price_pm_new';
const AMOUNTS: Record<string, number> = {
  [PRICE_OLD]: 1200,
  [PRICE_NEW]: 1400,
};

interface Live {
  priceId: string;
  amount: number;
  interval: 'month' | 'year';
  /** Unix seconds. */
  periodEnd: number;
  status: Stripe.Subscription.Status;
  metadata: Record<string, string>;
}

/** Stripe's subscriptions, as far as the step reads and writes them. */
function fakeStripe() {
  const live = new Map<string, Live>();
  const failWrites = new Map<string, Error>();
  const toSubscription = (id: string, l: Live) =>
    ({
      id,
      object: 'subscription',
      status: l.status,
      metadata: { ...l.metadata },
      billing_cycle_anchor: l.periodEnd,
      items: {
        data: [
          {
            id: `si_${id}`,
            current_period_end: l.periodEnd,
            price: {
              id: l.priceId,
              unit_amount: l.amount,
              recurring: { interval: l.interval },
            },
          },
        ],
      },
    }) as unknown as Stripe.Subscription;
  const retrieve = vi.fn(async (id: string) => {
    const l = live.get(id);
    if (!l) {
      throw Object.assign(new Error('No such subscription'), {
        statusCode: 404,
      });
    }
    return toSubscription(id, l);
  });
  const update = vi.fn(
    async (id: string, params: Stripe.SubscriptionUpdateParams) => {
      const failure = failWrites.get(id);
      if (failure) throw failure;
      const l = live.get(id);
      if (!l) throw new Error(`unknown subscription ${id}`);
      const price = params.items?.[0]?.price;
      if (price) {
        l.priceId = price;
        l.amount = AMOUNTS[price] ?? 0;
      }
      for (const [key, value] of Object.entries(params.metadata ?? {})) {
        if (value === '') delete l.metadata[key];
        else l.metadata[key] = String(value);
      }
      return toSubscription(id, l);
    }
  );
  return {
    stripe: { subscriptions: { retrieve, update } } as unknown as Stripe,
    live,
    failWrites,
    update,
  };
}

const stripeError = (statusCode: number) =>
  Object.assign(new Error(`stripe ${statusCode} (test)`), { statusCode });

describe('the hourly price-moves step (Codex-2hxff.86)', () => {
  let db: Database;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      const emails = await db
        .select({ email: users.email })
        .from(users)
        .where(inArray(users.id, userIds));
      if (emails.length > 0) {
        await db.delete(emailAuditLogs).where(
          inArray(
            emailAuditLogs.recipientEmail,
            emails.map((e) => e.email)
          )
        );
      }
      await db
        .delete(subscriptionPriceMoves)
        .where(inArray(subscriptionPriceMoves.userId, userIds));
    }
    if (orgIds.length > 0) {
      await db
        .update(priceChanges)
        .set({
          supersededById: null,
          supersededAt: null,
          state: 'done',
          doneAt: new Date(),
        })
        .where(inArray(priceChanges.organizationId, orgIds));
      await db
        .delete(priceChanges)
        .where(inArray(priceChanges.organizationId, orgIds));
    }
    if (userIds.length > 0) {
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.userId, userIds));
      await db
        .delete(courseSubscriptions)
        .where(inArray(courseSubscriptions.userId, userIds));
    }
    if (courseIds.length > 0) {
      await db
        .delete(courseSubscriptionPlans)
        .where(inArray(courseSubscriptionPlans.courseId, courseIds));
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (orgIds.length > 0) {
      await db
        .delete(subscriptionTiers)
        .where(inArray(subscriptionTiers.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await teardownTestDatabase();
  });

  async function org(slug: string) {
    const row = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput({ slug: createUniqueSlug(slug) }))
        .returning()
    );
    orgIds.push(row.id);
    const tier = async (name: string, sortOrder: number, monthly: number) =>
      takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(row.id, {
              name,
              sortOrder,
              priceMonthly: monthly,
              priceAnnual: monthly * 10,
            })
          )
          .returning()
      );
    return {
      org: row,
      basic: await tier('Basic', 1, 500),
      pro: await tier('Pro', 2, 1200),
    };
  }

  async function subscriber(
    orgId: string,
    tier: Tier,
    overrides: Partial<typeof subscriptions.$inferInsert> = {}
  ): Promise<Sub> {
    const userId = takeFirst(await seedTestUsers(db, 1), 'subscriber');
    userIds.push(userId);
    return takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tier.id, {
            amountCents: 1200,
            platformFeeCents: 0,
            organizationFeeCents: 0,
            creatorPayoutCents: 1200,
            ...overrides,
          })
        )
        .returning()
    );
  }

  /** Their live subscription at Stripe: on Pro's old monthly Price by default. */
  function onStripe(
    fake: ReturnType<typeof fakeStripe>,
    sub: { stripeSubscriptionId: string },
    renewsInDays: number,
    overrides: Partial<Live> = {}
  ) {
    fake.live.set(sub.stripeSubscriptionId, {
      priceId: PRICE_OLD,
      amount: 1200,
      interval: 'month',
      periodEnd: Math.floor(NOW / 1000) + renewsInDays * DAY_S,
      status: 'active',
      metadata: {},
      ...overrides,
    });
  }

  /** Pro's monthly price goes from 1200 to 1400, recorded the day before NOW. */
  async function reprice(orgId: string, tier: Tier) {
    const recorded = await recordTierPriceChange(db, tier.id, {
      organizationId: orgId,
      interval: 'month',
      fromAmountCents: 1200,
      newAmountCents: 1400,
      newStripePriceId: PRICE_NEW,
      createdByUserId: null,
      now: new Date(NOW - DAY_MS),
    });
    return recorded.changeId;
  }

  function mailer(
    answer: (to: string) => NoticeDelivery = () => ({ accepted: true })
  ) {
    return vi.fn<PriceChangeNoticeMailer>(async (params) => answer(params.to));
  }

  function logger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  /** One run, at NOW plus `hours`, for these changes only. */
  async function run(
    changeIds: string[],
    deps: {
      fake: ReturnType<typeof fakeStripe>;
      send: ReturnType<typeof mailer>;
      obs?: ReturnType<typeof logger>;
      onMoverScheduled?: (who: {
        userId: string;
        organizationId: string;
      }) => void;
      db?: typeof db;
    },
    hours = 0,
    options: Partial<PriceMoveStepOptions> = {}
  ) {
    const now = NOW + hours * HOUR_MS;
    return runPriceMoveStep(
      {
        db: deps.db ?? db,
        stripe: deps.fake.stripe,
        mailer: deps.send,
        obs: deps.obs ?? logger(),
        webAppUrl: 'https://app.example.test',
        onMoverScheduled: deps.onMoverScheduled,
      },
      {
        now: new Date(now),
        clock: () => now + SENT_AFTER_MS,
        interBatchDelayMs: 0,
        onlyChangeIds: changeIds,
        ...options,
      }
    );
  }

  const movesOf = async (changeId: string) =>
    db
      .select()
      .from(subscriptionPriceMoves)
      .where(eq(subscriptionPriceMoves.priceChangeId, changeId));

  async function moveOf(changeId: string, sub: { id: string }): Promise<Move> {
    return takeFirst(
      await db
        .select()
        .from(subscriptionPriceMoves)
        .where(
          and(
            eq(subscriptionPriceMoves.priceChangeId, changeId),
            eq(subscriptionPriceMoves.subscriptionId, sub.id)
          )
        )
    );
  }

  const changeOf = async (changeId: string) =>
    takeFirst(
      await db.select().from(priceChanges).where(eq(priceChanges.id, changeId))
    );

  const emailOf = async (sub: { userId: string }) =>
    takeFirst(
      await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, sub.userId))
    ).email;

  it('tells each person, then moves them: now with 30+ days to the renewal, else at the first renewal 30 days after their own email', async () => {
    const { org: o, pro } = await org('pm-happy');
    const fake = fakeStripe();
    const soon = await subscriber(o.id, pro);
    const later = await subscriber(o.id, pro);
    const pastDue = await subscriber(o.id, pro, { status: 'past_due' });
    // Set to cancel at the period end: still moved, so a reactivation renews
    // at the new price.
    const cancelling = await subscriber(o.id, pro, { status: 'cancelling' });
    onStripe(fake, soon, 10);
    onStripe(fake, cancelling, 40);
    // Grandfathered: billed 10.00, not the 12.00 list price.
    onStripe(fake, later, 40, { amount: 1000 });
    onStripe(fake, pastDue, 40, { status: 'past_due' });
    const changeId = await reprice(o.id, pro);
    const send = mailer();

    const result = await run([changeId], { fake, send });

    expect(result).toMatchObject({
      ran: true,
      claimed: 4,
      scheduled: 4,
      retrying: 0,
      held: 0,
      done: 1,
    });
    const sentAt = new Date(NOW + SENT_AFTER_MS);
    const laterRow = await moveOf(changeId, later);
    expect(laterRow).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'now',
      noticeAt: sentAt,
      effectiveAt: new Date(NOW + 40 * DAY_MS),
      attempts: 1,
    });
    expect(fake.live.get(later.stripeSubscriptionId)?.priceId).toBe(PRICE_NEW);
    // Under 30 days to the renewal: the one after, by the pending marker.
    const soonRow = await moveOf(changeId, soon);
    expect(soonRow).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
    });
    expect(soonRow.effectiveAt?.getTime()).toBeGreaterThanOrEqual(
      sentAt.getTime() + 30 * DAY_MS
    );
    expect(fake.live.get(soon.stripeSubscriptionId)).toMatchObject({
      priceId: PRICE_OLD,
      metadata: { codex_pending_price_id: PRICE_NEW },
    });
    // Past due is never swapped: the marker, and it moves once paid.
    expect(await moveOf(changeId, pastDue)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
    });
    expect(await moveOf(changeId, cancelling)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'now',
    });

    expect(send).toHaveBeenCalledTimes(4);
    const toLater = send.mock.calls.find(
      ([params]) => params.data.priceMoveId === laterRow.id
    )?.[0];
    expect(toLater).toMatchObject({
      to: await emailOf(later),
      templateName: 'subscription-tier-price-change',
      category: 'transactional',
      userId: later.userId,
      organizationId: o.id,
      data: {
        planName: 'Pro',
        oldPriceFormatted: '£10.00',
        newPriceFormatted: '£14.00',
        billingInterval: 'month',
        effectiveDate: new Date(NOW + 40 * DAY_MS).toLocaleDateString('en-GB', {
          timeZone: 'UTC',
        }),
        manageUrl: 'https://app.example.test/account/subscriptions',
      },
    });

    expect(await changeOf(changeId)).toMatchObject({
      state: 'done',
      doneAt: new Date(NOW),
      lastRunAt: new Date(NOW),
    });
  });

  it('reads our row again first: the ended, another interval and anyone leaving are skipped; a mover gets their floor and a cache bump', async () => {
    const { org: o, basic, pro } = await org('pm-skips');
    const fake = fakeStripe();
    const moveAt = new Date(NOW + 40 * DAY_MS);
    const ended = await subscriber(o.id, pro);
    const endedAt = await subscriber(o.id, pro);
    const switched = await subscriber(o.id, pro);
    const leaving = await subscriber(o.id, pro);
    const leavingAtStripe = await subscriber(o.id, pro);
    // Waiting to move TO Pro; their item already carries Pro's Price.
    const mover = await subscriber(o.id, basic, {
      pendingTierId: pro.id,
      pendingTierFrom: moveAt,
      heldAmountCents: 500,
    });
    for (const sub of [ended, endedAt, switched, leaving, mover])
      onStripe(fake, sub, 40);
    onStripe(fake, leavingAtStripe, 40, {
      metadata: { codex_move_tier_id: basic.id },
    });
    const changeId = await reprice(o.id, pro);
    // Since the save: two ended, one switched billing, one started leaving.
    await db
      .update(subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(subscriptions.id, ended.id));
    await db
      .update(subscriptions)
      .set({ endedAt: new Date(NOW - HOUR_MS) })
      .where(eq(subscriptions.id, endedAt.id));
    // Support had retried the first one: a skip closes it too.
    await db
      .update(subscriptionPriceMoves)
      .set({
        heldReason: 'notice_refused',
        retryRequestedAt: new Date(NOW - HOUR_MS),
        retryRequestedByUserId: ended.userId,
      })
      .where(eq(subscriptionPriceMoves.subscriptionId, ended.id));
    await db
      .update(subscriptions)
      .set({ billingInterval: 'year' })
      .where(eq(subscriptions.id, switched.id));
    await db
      .update(subscriptions)
      .set({
        pendingTierId: basic.id,
        pendingTierFrom: moveAt,
        heldAmountCents: 1200,
      })
      .where(eq(subscriptions.id, leaving.id));
    const send = mailer();
    const onMoverScheduled = vi.fn();

    const result = await run([changeId], { fake, send, onMoverScheduled });

    expect(result).toMatchObject({ claimed: 6, skipped: 5, scheduled: 1 });
    expect(await moveOf(changeId, ended)).toMatchObject({
      state: 'skipped',
      skipReason: 'ended',
      resolution: 'retried_ok',
      resolvedAt: new Date(NOW),
    });
    expect(await moveOf(changeId, endedAt)).toMatchObject({
      state: 'skipped',
      skipReason: 'ended',
      resolution: null,
    });
    expect(await moveOf(changeId, switched)).toMatchObject({
      state: 'skipped',
      skipReason: 'other_interval',
    });
    expect(await moveOf(changeId, leaving)).toMatchObject({
      state: 'skipped',
      skipReason: 'moving_away',
    });
    expect(await moveOf(changeId, leavingAtStripe)).toMatchObject({
      state: 'skipped',
      skipReason: 'moving_away',
    });
    // The mover: 40 days to go, but never swapped now; the new price starts
    // at the renewal after their move.
    const moverRow = await moveOf(changeId, mover);
    expect(moverRow).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
    });
    expect(moverRow.effectiveAt?.getTime()).toBeGreaterThan(moveAt.getTime());
    expect(
      Number(
        fake.live.get(mover.stripeSubscriptionId)?.metadata
          .codex_pending_price_from
      )
    ).toBe(Math.floor(moveAt.getTime() / 1000) + 1);
    expect(onMoverScheduled).toHaveBeenCalledExactlyOnceWith({
      userId: mover.userId,
      organizationId: o.id,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  // Review C1, F1: a change of plan that lands while their email is being
  // sent is never written over. Stripe is read again after the notice.
  describe('a change of plan made during their email (review C1, F1)', () => {
    /**
     * One Pro member, renewing in 40 days, whose `during` lands while their
     * email is being sent. Stripe is read again after the notice.
     */
    async function during(
      slug: string,
      change: (live: Live, tiers: { basic: Tier; renewal: string }) => void
    ) {
      const { org: o, basic, pro } = await org(slug);
      const fake = fakeStripe();
      const sub = await subscriber(o.id, pro);
      onStripe(fake, sub, 40, { metadata: { codex_tier_id: pro.id } });
      const changeId = await reprice(o.id, pro);
      const renewal = String(Math.floor(NOW / 1000) + 40 * DAY_S);
      const send = vi.fn<PriceChangeNoticeMailer>(async () => {
        const live = fake.live.get(sub.stripeSubscriptionId);
        if (live) change(live, { basic, renewal });
        return { accepted: true };
      });
      const result = await run([changeId], { fake, send });
      expect(send).toHaveBeenCalledOnce();
      return {
        result,
        row: await moveOf(changeId, sub),
        live: fake.live.get(sub.stripeSubscriptionId),
      };
    }
    const sentAt = new Date(NOW + SENT_AFTER_MS);

    it("a move to a cheaper tier (A to B): skipped as told, and A's new Price is never written over B's", async () => {
      const { result, row, live } = await during('pm-during-down', (l, t) => {
        l.priceId = 'price_pm_basic';
        l.amount = 500;
        Object.assign(l.metadata, {
          codex_move_tier_id: t.basic.id,
          codex_move_at: t.renewal,
          codex_hold_price_id: PRICE_OLD,
          codex_hold_amount: '1200',
        });
      });

      expect(result).toMatchObject({ claimed: 1, skipped: 1, scheduled: 0 });
      expect(row).toMatchObject({
        state: 'skipped',
        skipReason: 'moving_away',
        noticeAt: sentAt,
        effectiveAt: new Date(NOW + 40 * DAY_MS),
      });
      expect(live?.priceId).toBe('price_pm_basic');
      expect(live?.metadata).not.toHaveProperty('codex_pending_price_id');
    });

    it('an upgrade (A to C): skipped as told; no A Price and no pending marker on the C-bound subscription', async () => {
      const { result, row, live } = await during('pm-during-up', (l) => {
        l.priceId = 'price_pm_top';
        l.amount = 2000;
        l.metadata.codex_tier_id = crypto.randomUUID();
      });

      expect(result).toMatchObject({ claimed: 1, skipped: 1, scheduled: 0 });
      expect(row).toMatchObject({
        state: 'skipped',
        skipReason: 'moving_away',
        noticeAt: sentAt,
      });
      expect(live?.priceId).toBe('price_pm_top');
      expect(live?.metadata).not.toHaveProperty('codex_pending_price_id');
    });

    it('still on the tier, but past due by the time they were told: decided again, the marker and not a swap', async () => {
      const { result, row, live } = await during('pm-during-pastdue', (l) => {
        l.status = 'past_due';
      });

      expect(result).toMatchObject({ claimed: 1, scheduled: 1 });
      expect(row).toMatchObject({
        state: 'scheduled',
        scheduledKind: 'pending',
        noticeAt: sentAt,
      });
      expect(live).toMatchObject({
        priceId: PRICE_OLD,
        metadata: { codex_pending_price_id: PRICE_NEW },
      });
    });
  });

  it('a notice refused for one person is tried each hour, then held for support with its own alert line', async () => {
    const { org: o, pro } = await org('pm-retry');
    const fake = fakeStripe();
    const fine = await subscriber(o.id, pro);
    const refused = await subscriber(o.id, pro);
    onStripe(fake, fine, 40);
    onStripe(fake, refused, 40);
    const changeId = await reprice(o.id, pro);
    const refusedEmail = await emailOf(refused);
    const send = mailer((to) =>
      to === refusedEmail
        ? { accepted: false, status: 422 }
        : { accepted: true }
    );

    await run([changeId], { fake, send });
    expect(await moveOf(changeId, refused)).toMatchObject({
      state: 'due',
      attempts: 1,
      lastError: 'notice_refused_422',
      nextAttemptAt: new Date(NOW + HOUR_MS),
    });
    expect((await changeOf(changeId)).state).toBe('running');

    // Not before the next hour.
    const between = await run([changeId], { fake, send }, 0.5);
    expect(between.claimed).toBe(0);

    await run([changeId], { fake, send }, 1);
    expect(await moveOf(changeId, refused)).toMatchObject({
      state: 'due',
      attempts: 2,
    });

    const obs = logger();
    const third = await run([changeId], { fake, send, obs }, 2);
    expect(third).toMatchObject({ held: 1, done: 1 });
    const heldRow = await moveOf(changeId, refused);
    expect(heldRow).toMatchObject({
      state: 'held',
      heldReason: 'notice_refused',
      lastError: 'notice_refused_422',
      attempts: 3,
      nextAttemptAt: null,
    });
    const line = obs.error.mock.calls.find(
      ([, data]) => data?.priceMoveId === heldRow.id
    );
    expect(line?.[1]).toMatchObject({
      errorId: heldRow.alertErrorId,
      heldReason: 'notice_refused',
      subscriptionId: refused.id,
      userId: refused.userId,
    });
    expect(JSON.stringify(obs.error.mock.calls)).not.toContain(refusedEmail);
    // Held rows don't keep the change running.
    expect((await changeOf(changeId)).state).toBe('done');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('told, but the Stripe write failed: the next hour retries the write only, from their own email; three failures hold it as a move failure', async () => {
    const { org: o, pro } = await org('pm-write');
    const fake = fakeStripe();
    const flaky = await subscriber(o.id, pro);
    const refusedWrite = await subscriber(o.id, pro);
    onStripe(fake, flaky, 40);
    onStripe(fake, refusedWrite, 40);
    fake.failWrites.set(flaky.stripeSubscriptionId, stripeError(500));
    fake.failWrites.set(refusedWrite.stripeSubscriptionId, stripeError(400));
    const changeId = await reprice(o.id, pro);
    const send = mailer();

    await run([changeId], { fake, send });
    const told = new Date(NOW + SENT_AFTER_MS);
    expect(await moveOf(changeId, flaky)).toMatchObject({
      state: 'notified',
      noticeAt: told,
      effectiveAt: new Date(NOW + 40 * DAY_MS),
      lastError: 'move_unknown_500',
      nextAttemptAt: new Date(NOW + HOUR_MS),
    });
    expect(send).toHaveBeenCalledTimes(2);

    // Stripe is back for one of them: the write lands, with no second email
    // and their first email's date.
    fake.failWrites.delete(flaky.stripeSubscriptionId);
    await run([changeId], { fake, send }, 1);
    expect(await moveOf(changeId, flaky)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'now',
      noticeAt: told,
      effectiveAt: new Date(NOW + 40 * DAY_MS),
    });

    await run([changeId], { fake, send }, 2);
    const held = await moveOf(changeId, refusedWrite);
    expect(held).toMatchObject({
      state: 'held',
      heldReason: 'move_refused',
      lastError: 'move_refused_400',
      // They were told: Studio counts them as emailed.
      noticeAt: told,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect((await changeOf(changeId)).state).toBe('done');
  });

  it('Retry the move after its renewal passed (Q5): no second email, the original notice, the next renewal; the retried row closes as retried_ok', async () => {
    const { org: o, pro } = await org('pm-retry-move');
    const fake = fakeStripe();
    const sub = await subscriber(o.id, pro);
    onStripe(fake, sub, 20);
    const changeId = await reprice(o.id, pro);
    const toldAt = new Date(NOW - 40 * DAY_MS);
    // Held, then support pressed Retry the move: notified, fresh tries.
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'notified',
        heldReason: 'move_refused',
        noticeAt: toldAt,
        effectiveAt: new Date(NOW - 10 * DAY_MS),
        attempts: 0,
        retryRequestedAt: new Date(NOW - HOUR_MS),
        retryRequestedByUserId: sub.userId,
      })
      .where(eq(subscriptionPriceMoves.subscriptionId, sub.id));
    const send = mailer();

    await run([changeId], { fake, send });

    expect(send).not.toHaveBeenCalled();
    expect(await moveOf(changeId, sub)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'now',
      noticeAt: toldAt,
      effectiveAt: new Date(NOW + 20 * DAY_MS),
      resolution: 'retried_ok',
      resolvedAt: new Date(NOW),
    });
    expect(fake.live.get(sub.stripeSubscriptionId)?.priceId).toBe(PRICE_NEW);
  });

  it('an unknown outcome is looked for before anything is sent again: in the email log, then at Stripe', async () => {
    const { org: o, pro } = await org('pm-unknown');
    const fake = fakeStripe();
    const logged = await subscriber(o.id, pro);
    const landed = await subscriber(o.id, pro);
    const lost = await subscriber(o.id, pro);
    const retried = await subscriber(o.id, pro);
    for (const sub of [logged, landed, lost, retried]) onStripe(fake, sub, 10);
    const changeId = await reprice(o.id, pro);

    await run([changeId], {
      fake,
      send: mailer(() => ({ accepted: false, status: 503 })),
    });
    const loggedRow = await moveOf(changeId, logged);
    expect(loggedRow).toMatchObject({
      state: 'due',
      lastError: 'notice_unknown_503',
    });

    // The 503 came after the provider took one email: its log row says so.
    const sentAt = new Date(NOW + SENT_AFTER_MS + 2000);
    await db.insert(emailAuditLogs).values({
      templateName: 'subscription-tier-price-change',
      recipientEmail: await emailOf(logged),
      status: 'success',
      metadata: JSON.stringify({ planName: 'Pro', priceMoveId: loggedRow.id }),
      createdAt: sentAt,
      updatedAt: sentAt,
    });
    // Another's pending marker reached Stripe (a run stopped before
    // recording it).
    const marker = fake.live.get(landed.stripeSubscriptionId);
    if (marker) {
      marker.metadata.codex_pending_price_id = PRICE_NEW;
      marker.metadata.codex_pending_price_from = String(
        Math.floor(NOW / 1000) + 31 * DAY_S
      );
    }
    // Held as unknown, then retried by support: whatever else Retry reset,
    // the held reason says the email may have gone.
    const retriedRow = await moveOf(changeId, retried);
    await db
      .update(subscriptionPriceMoves)
      .set({
        heldReason: 'notice_unknown',
        lastError: null,
        attemptedAt: null,
        attempts: 0,
        retryRequestedAt: new Date(NOW + 30 * 60 * 1000),
        retryRequestedByUserId: retried.userId,
      })
      .where(eq(subscriptionPriceMoves.id, retriedRow.id));
    await db.insert(emailAuditLogs).values({
      templateName: 'subscription-tier-price-change',
      recipientEmail: await emailOf(retried),
      status: 'success',
      metadata: JSON.stringify({ priceMoveId: retriedRow.id }),
      createdAt: sentAt,
      updatedAt: sentAt,
    });
    const send = mailer();

    await run([changeId], { fake, send }, 1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].to).toBe(await emailOf(lost));
    expect(await moveOf(changeId, retried)).toMatchObject({
      state: 'scheduled',
      noticeAt: sentAt,
      resolution: 'retried_ok',
    });
    expect(await moveOf(changeId, logged)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
      noticeAt: sentAt,
    });
    expect(await moveOf(changeId, landed)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
      // Told on the try whose outcome was lost.
      noticeAt: new Date(NOW),
    });
    expect(await moveOf(changeId, lost)).toMatchObject({
      state: 'scheduled',
      noticeAt: new Date(NOW + HOUR_MS + SENT_AFTER_MS),
    });
  });

  // Review C1, F4: a run emailed them and stopped before recording it, so
  // the row still carries an older try's pre-notice error. Every reclaim
  // after an earlier try checks the email log. Owner, 2026-11-09 (replacing
  // F4's "a `pending` row counts"): a `pending` row that run left never got
  // its outcome, so they are told again; one still in flight is told.
  it('a run that stopped after its email, on a row with an older error: found in the log if sent, or in flight; told again if left pending or only test-sent', async () => {
    const { org: o, pro } = await org('pm-reclaim');
    const fake = fakeStripe();
    const sent = await subscriber(o.id, pro);
    const pending = await subscriber(o.id, pro);
    const inFlight = await subscriber(o.id, pro);
    const testSent = await subscriber(o.id, pro);
    const refused = await subscriber(o.id, pro);
    const all = [sent, pending, inFlight, testSent, refused];
    for (const sub of all) onStripe(fake, sub, 10);
    const changeId = await reprice(o.id, pro);
    // Two hours ago: a run claimed them and stopped mid-batch. The row still
    // says what the try before it recorded.
    const stoppedRun = new Date(NOW - 2 * HOUR_MS);
    const loggedAt = new Date(stoppedRun.getTime() + 3000);
    // A run beside this one, sending it now.
    const inFlightAt = new Date(NOW - 2 * 60 * 1000);
    for (const [sub, status, at, testSend] of [
      [sent, 'success', loggedAt, false],
      [pending, 'pending', loggedAt, false],
      [inFlight, 'pending', inFlightAt, false],
      [testSent, 'success', loggedAt, true],
      [refused, 'failed', loggedAt, false],
    ] as const) {
      const row = await moveOf(changeId, sub);
      await db
        .update(subscriptionPriceMoves)
        .set({
          attempts: 2,
          attemptedAt: stoppedRun,
          lastError: 'read_failed_500',
        })
        .where(eq(subscriptionPriceMoves.id, row.id));
      await db.insert(emailAuditLogs).values({
        templateName: 'subscription-tier-price-change',
        recipientEmail: await emailOf(sub),
        status,
        // A test send's marker, here beside the row's key, so the reader's
        // own guard is what keeps it out.
        metadata: JSON.stringify({
          ...(testSend ? TEST_SEND_METADATA : {}),
          priceMoveId: row.id,
        }),
        createdAt: at,
        updatedAt: at,
      });
    }
    const send = mailer();

    await run([changeId], { fake, send });

    // `failed` (every attempt failed), `pending` left by the stopped run and
    // a test send: told now.
    const toldNow = await Promise.all(
      [refused, pending, testSent].map(emailOf)
    );
    expect(send.mock.calls.map((c) => c[0].to).sort()).toEqual(
      [...toldNow].sort()
    );
    for (const sub of [refused, pending, testSent]) {
      expect(await moveOf(changeId, sub)).toMatchObject({
        state: 'scheduled',
        noticeAt: new Date(NOW + SENT_AFTER_MS),
      });
    }
    expect(await moveOf(changeId, sent)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
      noticeAt: loggedAt,
    });
    expect(await moveOf(changeId, inFlight)).toMatchObject({
      state: 'scheduled',
      scheduledKind: 'pending',
      noticeAt: inFlightAt,
    });
  });

  // Review C1, SF-1: a batch's rows are all worked (emailed, written at
  // Stripe) before any is recorded, so a record that throws leaves rows
  // emailed but unrecorded. They keep this run's claim; only the batches
  // never started go back.
  it('a record that throws mid-batch keeps that batch claimed and gives back only the batches never started; nobody is emailed twice', async () => {
    const { org: o, pro } = await org('pm-mid-batch');
    const fake = fakeStripe();
    const subs: Sub[] = [];
    for (let i = 0; i < 4; i++) subs.push(await subscriber(o.id, pro));
    // Renewing within the 30 days: each gets the pending marker, so a row
    // given back would be decided again from scratch and emailed again.
    for (const sub of subs) onStripe(fake, sub, 10);
    const changeId = await reprice(o.id, pro);
    const emailBySub = new Map<string, string>();
    for (const sub of subs) emailBySub.set(sub.id, await emailOf(sub));
    // The first record of the first batch fails, as a dropped connection
    // would; the second row of that batch has been emailed by then.
    const dialect = new PgDialect();
    let scheduledWrites = 0;
    const blipping = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'execute') return Reflect.get(target, prop, receiver);
        return (query: SQL) => {
          const text = dialect.sqlToQuery(query).sql;
          if (text.includes(`SET "state" = 'scheduled'`)) {
            scheduledWrites += 1;
            if (scheduledWrites === 1) {
              return Promise.reject(
                new Error('Connection terminated unexpectedly')
              );
            }
          }
          return target.execute(query);
        };
      },
    });
    const obs = logger();
    const send = mailer();

    const first = await run([changeId], { fake, send, obs, db: blipping }, 0, {
      batchSize: 2,
    });

    expect(first).toMatchObject({ claimed: 4, givenBack: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    const rows = await movesOf(changeId);
    const kept = rows.filter((row) => row.attempts === 1);
    const back = rows.filter((row) => row.attempts === 0);
    expect(kept).toHaveLength(2);
    expect(back).toHaveLength(2);
    // The batch that threw keeps this run's claim, so its reclaim checks.
    for (const row of kept) {
      expect(row).toMatchObject({ state: 'due', attemptedAt: new Date(NOW) });
    }
    for (const row of back) {
      expect(row).toMatchObject({ state: 'due', attemptedAt: null });
    }
    const emailsOf = (list: typeof rows) =>
      new Set(list.map((row) => emailBySub.get(row.subscriptionId ?? '')));
    expect(new Set(send.mock.calls.map(([notice]) => notice.to))).toEqual(
      emailsOf(kept)
    );
    const workAlerts = obs.error.mock.calls.filter(
      ([message, context]) =>
        String(message).includes('a step of the run failed') &&
        context?.stage === 'work'
    );
    expect(workAlerts).toHaveLength(1);
    expect(workAlerts[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      inFlightPriceMoveIds: expect.arrayContaining(kept.map((row) => row.id)),
    });

    // An hour on: the kept rows are found at Stripe (their marker) and not
    // emailed again; the two given back are told now.
    const again = mailer();
    await run([changeId], { fake, send: again }, 1);

    expect(again).toHaveBeenCalledTimes(2);
    expect(new Set(again.mock.calls.map(([notice]) => notice.to))).toEqual(
      emailsOf(back)
    );
    for (const row of await movesOf(changeId)) {
      expect(row.state).toBe('scheduled');
    }
  });

  it("every notice of a change's first batch refused with a 4xx stops it: nobody moved, the claims go back, one alert; Restart sets it going", async () => {
    const { org: o, pro } = await org('pm-stop');
    const fake = fakeStripe();
    const subs = [
      await subscriber(o.id, pro),
      await subscriber(o.id, pro),
      await subscriber(o.id, pro),
    ];
    for (const sub of subs) onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    const obs = logger();
    const refusing = mailer(() => ({ accepted: false, status: 404 }));

    const first = await run([changeId], { fake, send: refusing, obs }, 0, {
      batchSize: 2,
    });

    expect(first).toMatchObject({ claimed: 3, stopped: 1, givenBack: 3 });
    // The first batch only.
    expect(refusing).toHaveBeenCalledTimes(2);
    expect(fake.update).not.toHaveBeenCalled();
    const stopped = await changeOf(changeId);
    expect(stopped).toMatchObject({
      state: 'stopped',
      stoppedReason: 'template_missing',
      stoppedAt: new Date(NOW),
    });
    for (const row of await movesOf(changeId)) {
      expect(row).toMatchObject({
        state: 'due',
        attempts: 0,
        attemptedAt: null,
      });
    }
    const stopAlerts = obs.error.mock.calls.filter(([message]) =>
      String(message).includes('notices refused for everyone')
    );
    expect(stopAlerts).toHaveLength(1);
    expect(stopAlerts[0]?.[1]).toMatchObject({
      errorId: stopped.stoppedErrorId,
      priceChangeId: changeId,
      status: 404,
    });
    // Its own alert is the one: the run's end line repeats nothing (SF-4).
    expect(
      obs.error.mock.calls.filter(([message]) =>
        String(message).includes('run finished with people held')
      )
    ).toEqual([]);

    // A stopped change is left alone until support restarts it.
    const idle = await run([changeId], { fake, send: mailer() }, 1);
    expect(idle.claimed).toBe(0);

    await db
      .update(priceChanges)
      .set({
        restartRequestedAt: new Date(NOW + 90 * 60 * 1000),
        restartRequestedByUserId: takeFirst(subs).userId,
      })
      .where(eq(priceChanges.id, changeId));
    const send = mailer();
    const restarted = await run([changeId], { fake, send }, 2);
    expect(restarted).toMatchObject({ restarted: 1, scheduled: 3, done: 1 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    [422, 'template_missing'],
    [401, 'worker_auth'],
    [403, 'notice_refused'],
  ] as const)('a first batch refused with %i stops the change as %s', async (status, reason) => {
    const { org: o, pro } = await org(`pm-stop-${status}`);
    const fake = fakeStripe();
    const sub = await subscriber(o.id, pro);
    onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);

    await run([changeId], {
      fake,
      send: mailer(() => ({ accepted: false, status })),
    });

    expect(await changeOf(changeId)).toMatchObject({
      state: 'stopped',
      stoppedReason: reason,
    });
  });

  it.each([
    408, 409, 425, 429,
  ])('a first batch refused with %i is tried again, not stopped', async (status) => {
    const { org: o, pro } = await org(`pm-no-stop-${status}`);
    const fake = fakeStripe();
    const sub = await subscriber(o.id, pro);
    onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);

    const result = await run([changeId], {
      fake,
      send: mailer(() => ({ accepted: false, status })),
    });

    expect(result).toMatchObject({ stopped: 0, retrying: 1 });
    expect((await changeOf(changeId)).state).toBe('running');
  });

  it('a refused first batch does not stop a change that already got a notice through', async () => {
    const { org: o, pro } = await org('pm-no-stop');
    const fake = fakeStripe();
    const toldBefore = await subscriber(o.id, pro);
    const refused = await subscriber(o.id, pro);
    onStripe(fake, toldBefore, 40);
    onStripe(fake, refused, 40);
    const changeId = await reprice(o.id, pro);
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'scheduled',
        scheduledKind: 'now',
        noticeAt: new Date(NOW - DAY_MS),
        effectiveAt: new Date(NOW + 40 * DAY_MS),
      })
      .where(eq(subscriptionPriceMoves.subscriptionId, toldBefore.id));

    const result = await run([changeId], {
      fake,
      send: mailer(() => ({ accepted: false, status: 404 })),
    });

    expect(result).toMatchObject({ stopped: 0, retrying: 1 });
    expect((await changeOf(changeId)).state).toBe('running');
    expect(await moveOf(changeId, refused)).toMatchObject({
      state: 'due',
      attempts: 1,
      lastError: 'notice_refused_404',
    });
  });

  it('no batch starts after the time budget: the rest go back as they were', async () => {
    const { org: o, pro } = await org('pm-budget');
    const fake = fakeStripe();
    const subs = [];
    for (let i = 0; i < 4; i++) subs.push(await subscriber(o.id, pro));
    for (const sub of subs) onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    // Each email takes five minutes: the first batch of two uses ten.
    let clock = NOW;
    const send = vi.fn<PriceChangeNoticeMailer>(async () => {
      clock += 5 * 60 * 1000;
      return { accepted: true };
    });

    const result = await run([changeId], { fake, send }, 0, {
      batchSize: 2,
      timeBudgetMs: 8 * 60 * 1000,
      clock: () => clock,
    });

    expect(result).toMatchObject({ claimed: 4, scheduled: 2, givenBack: 2 });
    const rows = await movesOf(changeId);
    expect(rows.filter((r) => r.state === 'scheduled')).toHaveLength(2);
    for (const row of rows.filter((r) => r.state === 'due')) {
      expect(row).toMatchObject({ attempts: 0, attemptedAt: null });
    }
    expect((await changeOf(changeId)).state).toBe('running');
  });

  it('overlapping runs skip each other: a row another run holds, or tried in the last 20 minutes, is not claimed', async () => {
    const { org: o, pro } = await org('pm-overlap');
    const fake = fakeStripe();
    const locked = await subscriber(o.id, pro);
    const recent = await subscriber(o.id, pro);
    const free = await subscriber(o.id, pro);
    for (const sub of [locked, recent, free]) onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    await db
      .update(subscriptionPriceMoves)
      .set({ attemptedAt: new Date(NOW - 10 * 60 * 1000), attempts: 1 })
      .where(eq(subscriptionPriceMoves.subscriptionId, recent.id));

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT 1 FROM ${subscriptionPriceMoves} WHERE ${subscriptionPriceMoves.subscriptionId} = ${locked.id} FOR UPDATE`
      );
      holding();
      await released;
    });
    await held;
    try {
      const result = await run([changeId], { fake, send: mailer() });
      expect(result.claimed).toBe(1);
    } finally {
      release();
      await holder;
    }
    expect((await moveOf(changeId, free)).state).toBe('scheduled');
    expect(await moveOf(changeId, locked)).toMatchObject({
      state: 'due',
      attempts: 0,
    });
    expect(await moveOf(changeId, recent)).toMatchObject({
      state: 'due',
      attempts: 1,
    });
  });

  it('a finished change with a row support queued again is re-opened and worked; never beside a newer live change', async () => {
    const { org: o, pro } = await org('pm-reopen');
    const fake = fakeStripe();
    const sub = await subscriber(o.id, pro);
    onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    // Finished with them held; then support pressed Retry.
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'due',
        heldReason: 'notice_refused',
        lastError: 'notice_refused_422',
        attempts: 0,
        retryRequestedAt: new Date(NOW - HOUR_MS),
        retryRequestedByUserId: sub.userId,
      })
      .where(eq(subscriptionPriceMoves.subscriptionId, sub.id));
    await db
      .update(priceChanges)
      .set({ state: 'done', doneAt: new Date(NOW - DAY_MS) })
      .where(eq(priceChanges.id, changeId));

    const result = await run([changeId], { fake, send: mailer() });

    expect(result).toMatchObject({ reopened: 1, scheduled: 1, done: 1 });
    expect(await moveOf(changeId, sub)).toMatchObject({
      state: 'scheduled',
      resolution: 'retried_ok',
    });

    // A newer change is live for the tier: the old one stays done, even
    // with a row due (one live change per tier and interval).
    const { org: o2, pro: pro2 } = await org('pm-reopen-guard');
    const other = await subscriber(o2.id, pro2);
    onStripe(fake, other, 40);
    const older = await reprice(o2.id, pro2);
    await db
      .update(priceChanges)
      .set({ state: 'done', doneAt: new Date(NOW - DAY_MS) })
      .where(eq(priceChanges.id, older));
    const newer = await reprice(o2.id, pro2);
    await db
      .update(subscriptionPriceMoves)
      .set({ state: 'due' })
      .where(eq(subscriptionPriceMoves.priceChangeId, older));
    const obs = logger();

    const guarded = await run([older, newer], { fake, send: mailer(), obs }, 1);

    expect(guarded.reopened).toBe(0);
    expect((await changeOf(older)).state).toBe('done');
    expect(obs.error).not.toHaveBeenCalled();
  });

  // Support retries a held row on a finished change, then the owner saves a
  // newer price before the run: the person is told the newest price only.
  it('Retry, then a newer save, then the run: only the newest price is sent', async () => {
    const { org: o, pro } = await org('pm-retry-race');
    const fake = fakeStripe();
    const sub = await subscriber(o.id, pro);
    onStripe(fake, sub, 40);
    const first = await reprice(o.id, pro);
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'due',
        heldReason: 'notice_refused',
        lastError: 'notice_refused_422',
        attempts: 0,
        retryRequestedAt: new Date(NOW - 2 * HOUR_MS),
        retryRequestedByUserId: sub.userId,
      })
      .where(eq(subscriptionPriceMoves.priceChangeId, first));
    await db
      .update(priceChanges)
      .set({ state: 'done', doneAt: new Date(NOW - DAY_MS) })
      .where(eq(priceChanges.id, first));
    const { changeId: newest } = await recordTierPriceChange(db, pro.id, {
      organizationId: o.id,
      interval: 'month',
      fromAmountCents: 1200,
      newAmountCents: 1500,
      newStripePriceId: 'price_pm_newest',
      createdByUserId: null,
      now: new Date(NOW - HOUR_MS),
    });
    const send = mailer();

    const result = await run([first, newest], { fake, send });

    expect(result).toMatchObject({ reopened: 0, claimed: 1, scheduled: 1 });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].data).toMatchObject({
      newPriceFormatted: '£15.00',
    });
    expect(fake.live.get(sub.stripeSubscriptionId)?.priceId).toBe(
      'price_pm_newest'
    );
    expect((await moveOf(first, sub)).state).toBe('superseded');
    expect((await changeOf(first)).state).toBe('done');
  });

  // Closing a change locks it, then counts its open rows. Keep current plan
  // takes the change row first and adds a row under it: counted only after
  // the lock, that row keeps the change running.
  it('closing a change waits for its lock, then counts: a row added under the lock keeps it running', async () => {
    const { org: o, basic, pro } = await org('pm-finish-lock');
    const fake = fakeStripe();
    const moved = await subscriber(o.id, pro);
    // Leaving Pro at the save, so not on the change; Keep brings them back.
    const kept = await subscriber(o.id, pro, {
      pendingTierId: basic.id,
      pendingTierFrom: new Date(NOW + 10 * DAY_MS),
      heldAmountCents: 1200,
    });
    const changeId = await reprice(o.id, pro);
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'scheduled',
        scheduledKind: 'now',
        noticeAt: new Date(NOW - DAY_MS),
        effectiveAt: new Date(NOW + 40 * DAY_MS),
      })
      .where(eq(subscriptionPriceMoves.subscriptionId, moved.id));

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: (pid: number) => void = () => {};
    const held = new Promise<number>((resolve) => {
      holding = resolve;
    });
    const keep = db.transaction(async (tx) => {
      const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      await tx.execute(
        sql`SELECT 1 FROM ${priceChanges} WHERE ${priceChanges.id} = ${changeId} FOR UPDATE`
      );
      await tx.insert(subscriptionPriceMoves).values({
        priceChangeId: changeId,
        subscriptionId: kept.id,
        stripeSubscriptionId: kept.stripeSubscriptionId,
        organizationId: o.id,
        userId: kept.userId,
        source: 'keep_current_plan',
      });
      holding(Number((pid.rows[0] as { pid: number }).pid));
      await released;
    });
    const keepPid = await held;

    const running = run([changeId], { fake, send: mailer() });
    // Probe, not a sleep: the run's close is waiting on Keep's lock.
    let blocked = 0;
    for (let tries = 0; tries < 400 && blocked < 1; tries++) {
      const probe = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database()
           AND ${keepPid}::int = ANY(pg_blocking_pids(pid))
      `);
      blocked = Number((probe.rows[0] as { n: number }).n);
      if (blocked < 1) await new Promise((r) => setTimeout(r, 25));
    }
    expect(blocked).toBe(1);
    release();
    await keep;
    const result = await running;

    expect(result.done).toBe(0);
    expect((await changeOf(changeId)).state).toBe('running');
    expect((await moveOf(changeId, kept)).state).toBe('due');
  });

  it('the 08:00 London run does nothing', async () => {
    const { org: o, pro } = await org('pm-eight');
    const fake = fakeStripe();
    const sub = await subscriber(o.id, pro);
    onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    const send = mailer();

    const result = await run([changeId], { fake, send }, -2);

    expect(result).toMatchObject({ ran: false, claimed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await moveOf(changeId, sub)).toMatchObject({
      state: 'due',
      attempts: 0,
    });
  });

  // Review C1, SF-4: one alert per need. Held rows within the cap and a
  // stopped change have their own; the end line is info, not a second alert.
  it('held within the cap: each held row alerts once, and the run ends on an info line', async () => {
    const { org: o, pro } = await org('pm-held-once');
    const fake = fakeStripe();
    const subs = [await subscriber(o.id, pro), await subscriber(o.id, pro)];
    for (const sub of subs) onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    // Their third try: a failure now holds them. One was told already, so
    // the change is not stopped (step 5) for refusing everyone.
    await db
      .update(subscriptionPriceMoves)
      .set({ attempts: 2, lastError: 'notice_refused_422' })
      .where(eq(subscriptionPriceMoves.priceChangeId, changeId));
    await db
      .update(subscriptionPriceMoves)
      .set({ noticeAt: new Date(NOW - DAY_MS), state: 'notified' })
      .where(eq(subscriptionPriceMoves.subscriptionId, takeFirst(subs).id));
    for (const sub of subs) {
      fake.failWrites.set(sub.stripeSubscriptionId, stripeError(400));
    }
    const obs = logger();

    const result = await run(
      [changeId],
      { fake, send: mailer(() => ({ accepted: false, status: 422 })), obs },
      0
    );

    expect(result.held).toBe(2);
    const rows = await movesOf(changeId);
    const lines = obs.error.mock.calls.filter(([, data]) =>
      rows.some((r) => r.id === data?.priceMoveId)
    );
    expect(lines).toHaveLength(2);
    expect(obs.error).toHaveBeenCalledTimes(2);
    expect(obs.info).toHaveBeenCalledWith(
      'Price moves: run finished',
      expect.objectContaining({ held: 2 })
    );
  });

  it("alert lines are capped per run; the rest carry the end alert's id", async () => {
    const { org: o, pro } = await org('pm-cap');
    const fake = fakeStripe();
    const subs = [await subscriber(o.id, pro), await subscriber(o.id, pro)];
    for (const sub of subs) onStripe(fake, sub, 40);
    const changeId = await reprice(o.id, pro);
    // Their third try: a failure now holds them.
    await db
      .update(subscriptionPriceMoves)
      .set({ attempts: 2, lastError: 'notice_refused_422' })
      .where(eq(subscriptionPriceMoves.priceChangeId, changeId));
    await db
      .update(subscriptionPriceMoves)
      .set({ noticeAt: new Date(NOW - DAY_MS), state: 'notified' })
      .where(eq(subscriptionPriceMoves.subscriptionId, takeFirst(subs).id));
    for (const sub of subs) {
      fake.failWrites.set(sub.stripeSubscriptionId, stripeError(400));
    }
    const obs = logger();

    const result = await run(
      [changeId],
      { fake, send: mailer(() => ({ accepted: false, status: 422 })), obs },
      0,
      { alertLines: 1 }
    );

    expect(result.held).toBe(2);
    const rows = await movesOf(changeId);
    const end = obs.error.mock.calls.find(([message]) =>
      String(message).includes('run finished with people held')
    );
    expect(end?.[1]).toMatchObject({ held: 2, heldNotAlertedSeparately: 1 });
    const endId = end?.[1]?.errorId;
    expect(rows.filter((r) => r.alertErrorId === endId)).toHaveLength(1);
    const lines = obs.error.mock.calls.filter(([, data]) =>
      rows.some((r) => r.id === data?.priceMoveId)
    );
    expect(lines).toHaveLength(1);
  });

  it('a course plan change works the same way, named by the course', async () => {
    const { org: o } = await org('pm-course');
    const fake = fakeStripe();
    const creatorId = takeFirst(await seedTestUsers(db, 1));
    userIds.push(creatorId);
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: o.id,
          creatorId,
          slug: createUniqueSlug('pm-course'),
          title: 'Night Swimming',
          status: 'published',
          priceCents: null,
        })
        .returning({ id: courses.id })
    );
    courseIds.push(course.id);
    const plan = takeFirst(
      await db
        .insert(courseSubscriptionPlans)
        .values({
          courseId: course.id,
          priceMonthly: 1200,
          priceAnnual: 12000,
          stripePriceMonthlyId: PRICE_OLD,
        })
        .returning({ id: courseSubscriptionPlans.id })
    );
    const userId = takeFirst(await seedTestUsers(db, 1));
    userIds.push(userId);
    const ns = createUniqueSlug('pm-cs');
    const courseSub = takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId,
          courseId: course.id,
          planId: plan.id,
          organizationId: o.id,
          stripeSubscriptionId: `sub_${ns}`,
          stripeCustomerId: `cus_${ns}`,
          status: 'active',
          billingInterval: 'month',
          currentPeriodStart: new Date(NOW - DAY_MS),
          currentPeriodEnd: new Date(NOW + 40 * DAY_MS),
        })
        .returning()
    );
    onStripe(fake, courseSub, 40);
    const { changeId } = await recordPlanPriceChange(db, plan.id, {
      organizationId: o.id,
      interval: 'month',
      fromAmountCents: 1200,
      newAmountCents: 1400,
      newStripePriceId: PRICE_NEW,
      createdByUserId: null,
      now: new Date(NOW - DAY_MS),
    });
    const send = mailer();

    const result = await run([changeId], { fake, send });

    expect(result).toMatchObject({ claimed: 1, scheduled: 1, done: 1 });
    expect(send.mock.calls[0]?.[0].data).toMatchObject({
      planName: 'Night Swimming',
    });
    const [row] = await movesOf(changeId);
    expect(row).toMatchObject({
      courseSubscriptionId: courseSub.id,
      state: 'scheduled',
      scheduledKind: 'now',
    });
  });

  // Owner: "Wait while disputed" (review C1 cycle 3, D1). Billing is paused
  // for an open chargeback, so the run neither tells them nor writes, and
  // the row waits: due, a day on, not a try. Never a skip (that is for good).
  describe('an open chargeback', () => {
    it('waits: no email, no Stripe call, due a day on and not a try; once it ends, told as anyone with 30 days', async () => {
      const { org: o, pro } = await org('pm-disputed');
      const fake = fakeStripe();
      const disputed = await subscriber(o.id, pro, {
        disputedAt: new Date(NOW - DAY_MS),
      });
      const other = await subscriber(o.id, pro);
      onStripe(fake, disputed, 40);
      onStripe(fake, other, 40);
      const changeId = await reprice(o.id, pro);
      const send = mailer();
      const obs = logger();
      const reads = vi.mocked(fake.stripe.subscriptions.retrieve);

      const first = await run([changeId], { fake, send, obs });

      expect(first).toMatchObject({
        claimed: 2,
        scheduled: 1,
        deferred: 1,
        skipped: 0,
        retrying: 0,
        held: 0,
        done: 0,
      });
      expect(send.mock.calls.map(([params]) => params.to)).toEqual([
        await emailOf(other),
      ]);
      const onDisputed = ([id]: unknown[]) =>
        id === disputed.stripeSubscriptionId;
      expect(reads.mock.calls.filter(onDisputed)).toEqual([]);
      expect(fake.update.mock.calls.filter(onDisputed)).toEqual([]);
      expect(await moveOf(changeId, disputed)).toMatchObject({
        state: 'due',
        attempts: 0,
        attemptedAt: null,
        nextAttemptAt: new Date(NOW + DAY_MS),
        noticeAt: null,
        skipReason: null,
        heldReason: null,
      });
      expect(obs.error).not.toHaveBeenCalled();
      expect((await changeOf(changeId)).state).toBe('running');

      // The next hourly run doesn't claim it again.
      expect(await run([changeId], { fake, send, obs }, 1)).toMatchObject({
        claimed: 0,
      });

      // The dispute won: the run a day on tells them, 30 days from that email.
      await db
        .update(subscriptions)
        .set({ disputedAt: null })
        .where(eq(subscriptions.id, disputed.id));
      const dayOn = await run([changeId], { fake, send, obs }, 24);

      expect(dayOn).toMatchObject({ claimed: 1, scheduled: 1, deferred: 0 });
      const told = await moveOf(changeId, disputed);
      const sentAt = NOW + DAY_MS + SENT_AFTER_MS;
      expect(told).toMatchObject({
        state: 'scheduled',
        noticeAt: new Date(sentAt),
      });
      expect(told.effectiveAt?.getTime()).toBeGreaterThanOrEqual(
        sentAt + 30 * DAY_MS
      );
      expect(send).toHaveBeenCalledTimes(2);
    });

    // Cycle 4: told before the dispute opened, its write still to come.
    it('a row already told waits too: no write while disputed; once it ends, the write runs from the original email, 30 days on', async () => {
      const { org: o, pro } = await org('pm-disputed-told');
      const fake = fakeStripe();
      const sub = await subscriber(o.id, pro);
      onStripe(fake, sub, 40);
      fake.failWrites.set(sub.stripeSubscriptionId, stripeError(500));
      const changeId = await reprice(o.id, pro);
      const send = mailer();
      const told = new Date(NOW + SENT_AFTER_MS);
      await run([changeId], { fake, send });
      expect(await moveOf(changeId, sub)).toMatchObject({
        state: 'notified',
        noticeAt: told,
        attempts: 1,
      });

      // The chargeback opens; Stripe answers again.
      await db
        .update(subscriptions)
        .set({ disputedAt: new Date(NOW + 30 * 60 * 1000) })
        .where(eq(subscriptions.id, sub.id));
      fake.failWrites.delete(sub.stripeSubscriptionId);
      const writes = fake.update.mock.calls.length;

      const disputed = await run([changeId], { fake, send }, 1);

      expect(disputed).toMatchObject({ claimed: 1, deferred: 1, scheduled: 0 });
      expect(fake.update.mock.calls.length).toBe(writes);
      expect(await moveOf(changeId, sub)).toMatchObject({
        state: 'notified',
        noticeAt: told,
        attempts: 1,
        nextAttemptAt: new Date(NOW + HOUR_MS + DAY_MS),
      });

      await db
        .update(subscriptions)
        .set({ disputedAt: null })
        .where(eq(subscriptions.id, sub.id));
      const after = await run([changeId], { fake, send }, 25);

      expect(after).toMatchObject({ claimed: 1, scheduled: 1 });
      const moved = await moveOf(changeId, sub);
      expect(moved).toMatchObject({ state: 'scheduled', noticeAt: told });
      expect(moved.effectiveAt?.getTime()).toBeGreaterThanOrEqual(
        told.getTime() + 30 * DAY_MS
      );
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('waits for a course subscription too', async () => {
      const { org: o } = await org('pm-disputed-course');
      const fake = fakeStripe();
      const creatorId = takeFirst(await seedTestUsers(db, 1));
      userIds.push(creatorId);
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: o.id,
            creatorId,
            slug: createUniqueSlug('pm-disputed-course'),
            title: 'Night Swimming',
            status: 'published',
            priceCents: null,
          })
          .returning({ id: courses.id })
      );
      courseIds.push(course.id);
      const plan = takeFirst(
        await db
          .insert(courseSubscriptionPlans)
          .values({
            courseId: course.id,
            priceMonthly: 1200,
            priceAnnual: 12000,
            stripePriceMonthlyId: PRICE_OLD,
          })
          .returning({ id: courseSubscriptionPlans.id })
      );
      const userId = takeFirst(await seedTestUsers(db, 1));
      userIds.push(userId);
      const ns = createUniqueSlug('pm-cs-disputed');
      const courseSub = takeFirst(
        await db
          .insert(courseSubscriptions)
          .values({
            userId,
            courseId: course.id,
            planId: plan.id,
            organizationId: o.id,
            stripeSubscriptionId: `sub_${ns}`,
            stripeCustomerId: `cus_${ns}`,
            status: 'active',
            billingInterval: 'month',
            currentPeriodStart: new Date(NOW - DAY_MS),
            currentPeriodEnd: new Date(NOW + 40 * DAY_MS),
            disputedAt: new Date(NOW - DAY_MS),
          })
          .returning()
      );
      onStripe(fake, courseSub, 40);
      const { changeId } = await recordPlanPriceChange(db, plan.id, {
        organizationId: o.id,
        interval: 'month',
        fromAmountCents: 1200,
        newAmountCents: 1400,
        newStripePriceId: PRICE_NEW,
        createdByUserId: null,
        now: new Date(NOW - DAY_MS),
      });
      const send = mailer();

      const result = await run([changeId], { fake, send });

      expect(result).toMatchObject({ claimed: 1, deferred: 1, scheduled: 0 });
      expect(send).not.toHaveBeenCalled();
      expect(fake.update).not.toHaveBeenCalled();
      const [row] = await movesOf(changeId);
      expect(row).toMatchObject({
        courseSubscriptionId: courseSub.id,
        state: 'due',
        attempts: 0,
        nextAttemptAt: new Date(NOW + DAY_MS),
      });
    });
  });

  // The Studio note's read (data design §2.6).
  describe('the progress read', () => {
    /** Thu 14 Jan 2027, 07:30 London (GMT): the next run is 09:00. */
    const BEFORE_EIGHT = new Date(Date.UTC(2027, 0, 14, 7, 30));

    it("counts each state for the org's live tiers, newest first; a finished change shows for 14 days", async () => {
      const { org: o, basic, pro } = await org('pm-progress');
      const subs: Sub[] = [];
      for (let i = 0; i < 7; i++) subs.push(await subscriber(o.id, pro));
      const running = await reprice(o.id, pro);
      const [scheduled, heldTold, closed, fresh, retried, notified, skipped] =
        subs as [Sub, Sub, Sub, Sub, Sub, Sub, Sub];
      const told = new Date(NOW - DAY_MS);
      const set = async (
        sub: Sub,
        values: Partial<typeof subscriptionPriceMoves.$inferInsert>
      ) =>
        db
          .update(subscriptionPriceMoves)
          .set(values)
          .where(eq(subscriptionPriceMoves.subscriptionId, sub.id));
      await set(scheduled, {
        state: 'scheduled',
        scheduledKind: 'now',
        noticeAt: told,
        effectiveAt: new Date(NOW + 40 * DAY_MS),
      });
      await set(heldTold, {
        state: 'held',
        heldReason: 'move_refused',
        noticeAt: told,
      });
      await set(closed, {
        state: 'held',
        heldReason: 'no_address',
        resolution: 'not_needed',
        resolvedAt: told,
        resolvedByUserId: closed.userId,
        resolutionNote: 'left the platform',
      });
      await set(retried, { attempts: 1, lastError: 'notice_unknown' });
      await set(notified, {
        state: 'notified',
        noticeAt: told,
        attempts: 1,
      });
      await set(skipped, { state: 'skipped', skipReason: 'moving_away' });
      // `fresh` is left as recorded: due, never tried.
      expect(await moveOf(running, fresh)).toMatchObject({
        state: 'due',
        attempts: 0,
      });

      // Basic: one finished 3 days ago (shown), one 20 days ago (not).
      const recent = await recordTierPriceChange(db, basic.id, {
        organizationId: o.id,
        interval: 'year',
        fromAmountCents: 5000,
        newAmountCents: 6000,
        newStripePriceId: 'price_pm_basic_year',
        createdByUserId: null,
        now: new Date(NOW - 4 * DAY_MS),
      });
      const old = await recordTierPriceChange(db, basic.id, {
        organizationId: o.id,
        interval: 'month',
        fromAmountCents: 500,
        newAmountCents: 600,
        newStripePriceId: 'price_pm_basic_month',
        createdByUserId: null,
        now: new Date(NOW - 30 * DAY_MS),
      });
      await db
        .update(priceChanges)
        .set({ doneAt: new Date(BEFORE_EIGHT.getTime() - 3 * DAY_MS) })
        .where(eq(priceChanges.id, recent.changeId));
      await db
        .update(priceChanges)
        .set({ doneAt: new Date(BEFORE_EIGHT.getTime() - 20 * DAY_MS) })
        .where(eq(priceChanges.id, old.changeId));
      // A deleted tier's change, and another org's, are never shown.
      const gone = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(createTestTierInput(o.id, { name: 'Gone', sortOrder: 3 }))
          .returning()
      );
      const goneChange = await recordTierPriceChange(db, gone.id, {
        organizationId: o.id,
        interval: 'month',
        fromAmountCents: 100,
        newAmountCents: 200,
        newStripePriceId: 'price_pm_gone',
        createdByUserId: null,
        now: new Date(NOW - DAY_MS),
      });
      await db
        .update(subscriptionTiers)
        .set({ deletedAt: new Date(NOW - HOUR_MS) })
        .where(eq(subscriptionTiers.id, gone.id));
      const { org: other, pro: otherPro } = await org('pm-progress-other');
      const otherChange = await reprice(other.id, otherPro);

      const progress = await readPriceChangeProgress(
        db,
        { kind: 'tier', organizationId: o.id },
        BEFORE_EIGHT
      );

      expect(progress.map((p) => p.id)).toEqual([running, recent.changeId]);
      expect(progress.map((p) => p.id)).not.toContain(goneChange.changeId);
      expect(progress.map((p) => p.id)).not.toContain(otherChange);
      expect(progress[0]).toEqual({
        id: running,
        tierId: pro.id,
        courseSubscriptionPlanId: null,
        interval: 'month',
        fromAmountCents: 1200,
        newAmountCents: 1400,
        state: 'running',
        createdAt: new Date(NOW - DAY_MS).toISOString(),
        counts: {
          total: 7,
          // Told: scheduled, held after a refused move, and notified.
          emailed: 3,
          scheduled: 1,
          // The closed one is resolved: not "couldn't be moved yet".
          held: 1,
          due: 2,
          // Of the due, the one already tried.
          retrying: 1,
        },
        lastRunAt: null,
        // 08:00 London is the bank payout's run.
        nextRunAt: new Date(Date.UTC(2027, 0, 14, 9)).toISOString(),
        estimatedDoneAt: new Date(Date.UTC(2027, 0, 14, 9)).toISOString(),
        doneAt: null,
        supersededById: null,
        stoppedAt: null,
      });
      expect(progress[1]).toMatchObject({
        state: 'done',
        interval: 'year',
        counts: { total: 0 },
        nextRunAt: null,
        estimatedDoneAt: null,
      });
    });

    it("a course plan's progress is scoped by the org and the course", async () => {
      const { org: o } = await org('pm-progress-course');
      const { org: other } = await org('pm-progress-course-other');
      const creatorId = takeFirst(await seedTestUsers(db, 1));
      userIds.push(creatorId);
      const course = async (orgId: string, title: string) => {
        const row = takeFirst(
          await db
            .insert(courses)
            .values({
              organizationId: orgId,
              creatorId,
              slug: createUniqueSlug('pm-progress-course'),
              title,
              status: 'published',
              priceCents: null,
            })
            .returning({ id: courses.id })
        );
        courseIds.push(row.id);
        const plan = takeFirst(
          await db
            .insert(courseSubscriptionPlans)
            .values({
              courseId: row.id,
              priceMonthly: 1500,
              priceAnnual: 15000,
            })
            .returning({ id: courseSubscriptionPlans.id })
        );
        const { changeId } = await recordPlanPriceChange(db, plan.id, {
          organizationId: orgId,
          interval: 'month',
          fromAmountCents: 1500,
          newAmountCents: 1800,
          newStripePriceId: 'price_pm_course',
          createdByUserId: null,
          now: new Date(NOW - DAY_MS),
        });
        return { courseId: row.id, planId: plan.id, changeId };
      };
      const mine = await course(o.id, 'Mine');
      const sibling = await course(o.id, 'Sibling');
      const theirs = await course(other.id, 'Theirs');

      const read = (organizationId: string, courseId: string) =>
        readPriceChangeProgress(
          db,
          { kind: 'course_plan', organizationId, courseId },
          BEFORE_EIGHT
        );

      expect((await read(o.id, mine.courseId)).map((p) => p.id)).toEqual([
        mine.changeId,
      ]);
      expect(
        (await read(o.id, mine.courseId))[0]?.courseSubscriptionPlanId
      ).toBe(mine.planId);
      expect(await read(o.id, theirs.courseId)).toEqual([]);
      expect((await read(o.id, sibling.courseId)).map((p) => p.id)).toEqual([
        sibling.changeId,
      ]);
      // The tier read never shows a course plan's change.
      expect(
        await readPriceChangeProgress(
          db,
          { kind: 'tier', organizationId: o.id },
          BEFORE_EIGHT
        )
      ).toEqual([]);
    });

    it('the finish estimate counts 1,125 a run from the next run, skipping 08:00 London', () => {
      const winter = new Date(Date.UTC(2027, 0, 14, 6, 30));
      const at = (n: number) => priceMovesDoneBy(winter, n)?.toISOString();
      expect(PRICE_MOVES_PER_RUN).toBe(1125);
      expect(at(0)).toBeUndefined();
      expect(at(1)).toBe('2027-01-14T07:00:00.000Z');
      expect(at(1125)).toBe('2027-01-14T07:00:00.000Z');
      // The second run is 09:00: 08:00 London is the bank payout's.
      expect(at(1126)).toBe('2027-01-14T09:00:00.000Z');
      expect(at(3376)).toBe('2027-01-14T11:00:00.000Z');
    });
  });

  // Codex-2hxff.97, data design §5.1: a member whose switch to monthly
  // billing waits for the year's end goes to their tier's MONTHLY price.
  describe('a waiting change of billing', () => {
    /** Alex on Pro yearly, switching to Pro monthly at the renewal in 40 days. */
    async function switchingToMonthly(slug: string) {
      const { org: o, pro } = await org(slug);
      const fake = fakeStripe();
      const renewal = Math.floor(NOW / 1000) + 40 * DAY_S;
      const sub = await subscriber(o.id, pro, {
        billingInterval: 'year',
        amountCents: 12000,
        creatorPayoutCents: 12000,
        pendingTierId: pro.id,
        pendingTierFrom: new Date(renewal * 1000),
        heldAmountCents: 12000,
        pendingBillingInterval: 'month',
        pendingAmountCents: 1200,
      });
      onStripe(fake, sub, 40, {
        priceId: 'price_pm_old_y',
        amount: 12000,
        interval: 'year',
        metadata: {
          codex_tier_id: pro.id,
          codex_move_tier_id: pro.id,
          codex_move_at: String(renewal),
          codex_hold_price_id: 'price_pm_old_y',
          codex_hold_amount: '12000',
          codex_move_interval: 'month',
          codex_move_price_id: PRICE_OLD,
          codex_move_amount: '1200',
        },
      });
      return { o, pro, fake, sub, renewal };
    }

    it('a monthly price change reaches them as a mover: told, pending from the renewal after the switch, the year untouched', async () => {
      const { o, pro, fake, sub, renewal } =
        await switchingToMonthly('pm-billing-mover');
      const changeId = await reprice(o.id, pro);
      expect((await movesOf(changeId)).map((m) => m.subscriptionId)).toEqual([
        sub.id,
      ]);
      const send = mailer();

      const result = await run([changeId], { fake, send });

      expect(result).toMatchObject({ claimed: 1, scheduled: 1 });
      expect(send).toHaveBeenCalledOnce();
      expect(await moveOf(changeId, sub)).toMatchObject({
        state: 'scheduled',
        scheduledKind: 'pending',
        effectiveAt: new Date(addMonthsClamped(renewal, 1) * 1000),
      });
      const live = fake.live.get(sub.stripeSubscriptionId);
      // The year's Price stays on the item; only the marker is written.
      expect(live?.priceId).toBe('price_pm_old_y');
      expect(live?.metadata).toMatchObject({
        codex_pending_price_id: PRICE_NEW,
        codex_pending_price_from: String(renewal + 1),
      });
    });

    it("a yearly price change on the tier they are leaving doesn't reach them", async () => {
      const { o, pro, sub } = await switchingToMonthly('pm-billing-leaver');
      const recorded = await recordTierPriceChange(db, pro.id, {
        organizationId: o.id,
        interval: 'year',
        fromAmountCents: 12000,
        newAmountCents: 13000,
        newStripePriceId: 'price_pm_new_y',
        createdByUserId: null,
        now: new Date(NOW - DAY_MS),
      });

      const moves = await movesOf(recorded.changeId);
      expect(moves.map((m) => m.subscriptionId)).not.toContain(sub.id);
    });
  });
});
