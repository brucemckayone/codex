/**
 * Recording who is due when a tier's price changes (Codex-2hxff.85, .86;
 * batch C1 Part B data design §2.3).
 *
 * The Studio save writes one `price_changes` row per interval that changed
 * and one `subscription_price_moves` row per subscriber, in the save's own
 * transaction. Latest wins over a change still going out. Part A's rules for
 * waiting moves (Codex-2hxff.16): someone moving AWAY from the tier is left
 * out; someone moving TO it is in, with a floor one second after their move.
 * Keep current plan's rejoin (Part A rule 3) is pinned here at the record
 * level, and end to end in tier-move.integration.test.ts.
 *
 * Real DB, mocked Stripe (the save makes Prices; it reads no subscription).
 * Every row hangs off this file's own organisations and users, deleted in
 * afterAll, children first: the new foreign keys all RESTRICT.
 */

import { isUniqueViolation } from '@codex/database';
import {
  organizations,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
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
import { and, eq, inArray, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  recordTierPriceChange,
  rejoinTierPriceChange,
} from '../pending-price-change';
import { TierService } from '../tier-service';

type Tier = typeof subscriptionTiers.$inferSelect;
type Sub = typeof subscriptions.$inferSelect;

const DAY_MS = 86_400_000;

describe('recording a tier price change (Codex-2hxff.86)', () => {
  let db: Database;
  let stripe: Stripe;
  let service: TierService;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    db = setupTestDatabase();
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new TierService({ db, dbWs: db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
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
      // Duplicates point at the subscription they repeat.
      await db
        .update(subscriptions)
        .set({ duplicateOfSubscriptionId: null })
        .where(inArray(subscriptions.userId, userIds));
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.userId, userIds));
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
    const amount = tier.priceMonthly;
    return takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tier.id, {
            amountCents: amount,
            platformFeeCents: 0,
            organizationFeeCents: 0,
            creatorPayoutCents: amount,
            ...overrides,
          })
        )
        .returning()
    );
  }

  const movesOf = (changeId: string) =>
    db
      .select()
      .from(subscriptionPriceMoves)
      .where(eq(subscriptionPriceMoves.priceChangeId, changeId));

  const changesOf = (tierId: string) =>
    db.select().from(priceChanges).where(eq(priceChanges.tierId, tierId));

  it("reaches the tier's live subscribers on the interval, movers onto it with a floor, and nobody leaving", async () => {
    const { org: o, basic, pro } = await org('record-who');
    const moveAt = new Date(Date.now() + 12 * DAY_MS);
    const member = await subscriber(o.id, pro);
    const paused = await subscriber(o.id, pro, { status: 'paused' });
    const cancelling = await subscriber(o.id, pro, { status: 'cancelling' });
    // Waiting to move TO Pro from Basic (Part A rule 2).
    const mover = await subscriber(o.id, basic, {
      pendingTierId: pro.id,
      pendingTierFrom: moveAt,
      heldAmountCents: 500,
    });
    // Not reached:
    const annual = await subscriber(o.id, pro, { billingInterval: 'year' });
    const leaver = await subscriber(o.id, pro, {
      pendingTierId: basic.id,
      pendingTierFrom: moveAt,
      heldAmountCents: 1200,
    });
    const cancelled = await subscriber(o.id, pro, { status: 'cancelled' });
    const ended = await subscriber(o.id, pro, {
      status: 'past_due',
      endedAt: new Date(),
    });
    const duplicate = await subscriber(o.id, pro, {
      status: 'paused',
      duplicateOfSubscriptionId: member.id,
    });
    const onBasic = await subscriber(o.id, basic);

    await service.updateTier(pro.id, o.id, { priceMonthly: 1400 });

    const [change] = await changesOf(pro.id);
    expect(change).toMatchObject({
      interval: 'month',
      fromAmountCents: 1200,
      newAmountCents: 1400,
      state: 'running',
      totalCount: 4,
    });
    const rows = await movesOf(change?.id ?? '');
    const bySubscription = new Map(rows.map((r) => [r.subscriptionId, r]));
    expect([...bySubscription.keys()].sort()).toEqual(
      [member.id, paused.id, cancelling.id, mover.id].sort()
    );
    for (const sub of [annual, leaver, cancelled, ended, duplicate, onBasic]) {
      expect(bySubscription.has(sub.id)).toBe(false);
    }
    for (const row of rows) {
      expect(row).toMatchObject({
        state: 'due',
        source: 'price_change',
        attempts: 0,
        organizationId: o.id,
      });
    }
    expect(bySubscription.get(member.id)?.floorFrom).toBeNull();
    expect(bySubscription.get(mover.id)?.floorFrom).toEqual(
      new Date(moveAt.getTime() + 1000)
    );
    expect(bySubscription.get(mover.id)).toMatchObject({
      userId: mover.userId,
      stripeSubscriptionId: mover.stripeSubscriptionId,
    });
  });

  it('both intervals changed: one change each, each reaching its own interval', async () => {
    const { org: o, pro } = await org('record-both');
    const monthly = await subscriber(o.id, pro);
    const annual = await subscriber(o.id, pro, { billingInterval: 'year' });

    await service.updateTier(pro.id, o.id, {
      priceMonthly: 1400,
      priceAnnual: 14000,
    });

    const changes = await changesOf(pro.id);
    const month = takeFirst(changes.filter((c) => c.interval === 'month'));
    const year = takeFirst(changes.filter((c) => c.interval === 'year'));
    expect((await movesOf(month.id)).map((r) => r.subscriptionId)).toEqual([
      monthly.id,
    ]);
    expect((await movesOf(year.id)).map((r) => r.subscriptionId)).toEqual([
      annual.id,
    ]);
    expect(year).toMatchObject({
      fromAmountCents: 12000,
      newAmountCents: 14000,
    });
  });

  // Two saves of one tier at once: the tier row is written first in each
  // transaction, so the second waits for the first to commit and then sees
  // its change to supersede. Recording first would race the partial unique
  // index and fail the second save (23505).
  it('two saves at once: the second waits on the tier row, then supersedes the first', async () => {
    const { org: o, pro } = await org('record-race');
    await subscriber(o.id, pro);

    // Hold the tier row so both saves queue behind it.
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holderPid = 0;
    const holder = db.transaction(async (tx) => {
      const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      holderPid = Number((pid.rows[0] as { pid: number }).pid);
      await tx.execute(
        sql`SELECT 1 FROM ${subscriptionTiers} WHERE ${subscriptionTiers.id} = ${pro.id} FOR UPDATE`
      );
      await released;
    });

    const saves = [
      service.updateTier(pro.id, o.id, { priceMonthly: 1400 }),
      service.updateTier(pro.id, o.id, { priceMonthly: 1500 }),
    ];
    // Probe, not a sleep: both saves are waiting on a lock.
    let blocked = 0;
    for (let tries = 0; tries < 400 && blocked < 2; tries++) {
      const probe = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND cardinality(pg_blocking_pids(pid)) > 0
      `);
      blocked = Number((probe.rows[0] as { n: number }).n);
      if (blocked < 2) await new Promise((r) => setTimeout(r, 25));
    }
    expect(holderPid).toBeGreaterThan(0);
    expect(blocked).toBe(2);
    release();
    await holder;

    const outcomes = await Promise.allSettled(saves);
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled']);
    const changes = await changesOf(pro.id);
    expect(changes).toHaveLength(2);
    const live = takeFirst(changes.filter((c) => c.state === 'running'));
    const replaced = takeFirst(changes.filter((c) => c.state === 'superseded'));
    expect(replaced.supersededById).toBe(live.id);
    // The live change is the tier's current Price: the last save to commit.
    const [tierNow] = await db
      .select()
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.id, pro.id));
    expect(live.newStripePriceId).toBe(tierNow?.stripePriceMonthlyId);
    expect(live.newAmountCents).toBe(tierNow?.priceMonthly);
    expect((await movesOf(replaced.id)).map((r) => r.state)).toEqual([
      'superseded',
    ]);
    expect((await movesOf(live.id)).map((r) => r.state)).toEqual(['due']);
  });

  // Latest wins reaches a change that already finished: it stays `done`, but
  // its held people leave support's list, and a row support queued with
  // Retry never tells the replaced price.
  it('a newer price supersedes the open rows of an earlier change that finished', async () => {
    const { org: o, pro } = await org('record-after-done');
    const subs = await Promise.all(
      Array.from({ length: 5 }, () => subscriber(o.id, pro))
    );
    await service.updateTier(pro.id, o.id, { priceMonthly: 1400 });
    const first = takeFirst(await changesOf(pro.id));
    const told = new Date(Date.now() - 40 * DAY_MS);
    const rowOf = (sub: Sub) =>
      and(
        eq(subscriptionPriceMoves.priceChangeId, first.id),
        eq(subscriptionPriceMoves.subscriptionId, sub.id)
      );
    const [held, closed, scheduled, retried, retriedMove] = subs as [
      Sub,
      Sub,
      Sub,
      Sub,
      Sub,
    ];
    await db
      .update(subscriptionPriceMoves)
      .set({ state: 'held', heldReason: 'no_address' })
      .where(rowOf(held));
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'held',
        heldReason: 'no_address',
        resolution: 'not_needed',
        resolvedAt: told,
        resolvedByUserId: closed.userId,
        resolutionNote: 'closed by hand',
      })
      .where(rowOf(closed));
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'scheduled',
        scheduledKind: 'pending',
        noticeAt: told,
        effectiveAt: new Date(),
      })
      .where(rowOf(scheduled));
    // Queued by support's Retry, not yet taken by the step.
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'due',
        heldReason: 'notice_unknown',
        retryRequestedAt: told,
        retryRequestedByUserId: retried.userId,
      })
      .where(rowOf(retried));
    await db
      .update(subscriptionPriceMoves)
      .set({
        state: 'notified',
        heldReason: 'move_refused',
        noticeAt: told,
        retryRequestedAt: told,
        retryRequestedByUserId: retriedMove.userId,
      })
      .where(rowOf(retriedMove));
    await db
      .update(priceChanges)
      .set({ state: 'done', doneAt: told })
      .where(eq(priceChanges.id, first.id));

    await service.updateTier(pro.id, o.id, { priceMonthly: 1500 });

    const changes = await changesOf(pro.id);
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.id === first.id)?.state).toBe('done');
    const second = takeFirst(changes.filter((c) => c.id !== first.id));
    expect(second).toMatchObject({ state: 'running', totalCount: 5 });
    const stateOf = new Map(
      (await movesOf(first.id)).map((r) => [r.subscriptionId, r.state])
    );
    expect(stateOf.get(held.id)).toBe('superseded');
    expect(stateOf.get(retried.id)).toBe('superseded');
    expect(stateOf.get(retriedMove.id)).toBe('superseded');
    // History stays: closed by hand, or already moved.
    expect(stateOf.get(closed.id)).toBe('held');
    expect(stateOf.get(scheduled.id)).toBe('scheduled');
  });

  // Latest wins over a change still going out: told-but-not-yet-written
  // people are superseded too (the new change reaches them), while a row
  // support closed by hand, or one already moved, is history.
  it('a newer price supersedes the live change: its due, notified and unresolved held rows', async () => {
    const { org: o, pro } = await org('record-supersede-live');
    const subs = await Promise.all(
      Array.from({ length: 5 }, () => subscriber(o.id, pro))
    );
    await service.updateTier(pro.id, o.id, { priceMonthly: 1400 });
    const first = takeFirst(await changesOf(pro.id));
    const told = new Date(Date.now() - DAY_MS);
    const [fresh, notified, held, closed, scheduled] = subs as [
      Sub,
      Sub,
      Sub,
      Sub,
      Sub,
    ];
    const set = (
      sub: Sub,
      values: Partial<typeof subscriptionPriceMoves.$inferInsert>
    ) =>
      db
        .update(subscriptionPriceMoves)
        .set(values)
        .where(
          and(
            eq(subscriptionPriceMoves.priceChangeId, first.id),
            eq(subscriptionPriceMoves.subscriptionId, sub.id)
          )
        );
    await set(notified, {
      state: 'notified',
      noticeAt: told,
      lastError: 'move_unknown',
    });
    await set(held, { state: 'held', heldReason: 'notice_refused' });
    await set(closed, {
      state: 'held',
      heldReason: 'no_address',
      resolution: 'moved_by_hand',
      resolvedAt: told,
      resolvedByUserId: closed.userId,
      resolutionNote: 'moved at Stripe by hand',
    });
    await set(scheduled, {
      state: 'scheduled',
      scheduledKind: 'pending',
      noticeAt: told,
      effectiveAt: new Date(Date.now() + 30 * DAY_MS),
    });

    await service.updateTier(pro.id, o.id, { priceMonthly: 1500 });

    const changes = await changesOf(pro.id);
    const replaced = takeFirst(changes.filter((c) => c.id === first.id));
    const live = takeFirst(changes.filter((c) => c.id !== first.id));
    expect(replaced).toMatchObject({
      state: 'superseded',
      supersededById: live.id,
    });
    const stateOf = new Map(
      (await movesOf(first.id)).map((r) => [r.subscriptionId, r.state])
    );
    expect(stateOf.get(fresh.id)).toBe('superseded');
    expect(stateOf.get(notified.id)).toBe('superseded');
    expect(stateOf.get(held.id)).toBe('superseded');
    expect(stateOf.get(closed.id)).toBe('held');
    expect(stateOf.get(scheduled.id)).toBe('scheduled');
    expect(live).toMatchObject({ state: 'running', totalCount: 5 });
  });

  // One transaction: a recording that fails fails the save, and the Stripe
  // Prices are put back, so nobody is lost between the save and the step.
  it('a recording that fails leaves the tier as it was and archives the new Price', async () => {
    const { org: o, pro } = await org('record-rollback');
    await subscriber(o.id, pro);
    const minted = vi.mocked(stripe.prices.create);
    const archived = vi.mocked(stripe.prices.update);

    // An owner id with no user row: the change's foreign key refuses it.
    await expect(
      service.updateTier(pro.id, o.id, { priceMonthly: 1400 }, 'no-such-user')
    ).rejects.toThrow();

    const newPrice = (await minted.mock.results[0]?.value) as { id: string };
    const ours = { codex_platform_write: expect.any(String) };
    expect(archived).toHaveBeenCalledWith(newPrice.id, {
      active: false,
      metadata: ours,
    });
    expect(archived).toHaveBeenCalledWith(pro.stripePriceMonthlyId, {
      active: true,
      metadata: ours,
    });
    const [tierNow] = await db
      .select()
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.id, pro.id));
    expect(tierNow).toMatchObject({
      priceMonthly: 1200,
      stripePriceMonthlyId: pro.stripePriceMonthlyId,
    });
    expect(await changesOf(pro.id)).toEqual([]);
  });

  // Keep current plan's row (Part A rule 3), at the record level.
  describe('rejoinTierPriceChange', () => {
    /**
     * A Pro member back at the price they paid (Keep has run), while Pro was
     * repriced 1200 → 1400: the tier row carries the new Price, and change X
     * records it.
     */
    async function keptMember(slug: string) {
      const { org: o, basic, pro } = await org(slug);
      const sub = await subscriber(o.id, pro);
      const heldPriceId = pro.stripePriceMonthlyId ?? 'price_pro_1200';
      await db
        .update(subscriptionTiers)
        .set({ priceMonthly: 1400, stripePriceMonthlyId: 'price_pro_1400' })
        .where(eq(subscriptionTiers.id, pro.id));
      const change = takeFirst(
        await db
          .insert(priceChanges)
          .values({
            organizationId: o.id,
            kind: 'tier',
            tierId: pro.id,
            interval: 'month',
            fromAmountCents: 1200,
            newAmountCents: 1400,
            newStripePriceId: 'price_pro_1400',
            state: 'running',
            totalCount: 1,
          })
          .returning()
      );
      const input = {
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        organizationId: o.id,
        userId: sub.userId,
        tierId: pro.id,
        interval: 'month' as const,
        heldPriceId,
        heldAmountCents: 1200,
        parkedPendingPriceId: null,
        now: new Date(),
      };
      return { o, basic, pro, sub, change, input };
    }

    type RejoinInput = Parameters<typeof rejoinTierPriceChange>[1];
    const rejoin = (input: RejoinInput) =>
      db.transaction((tx) => rejoinTierPriceChange(tx, input));

    it('re-opens a row the step closed as moving away, without counting them twice', async () => {
      const { sub, change, input } = await keptMember('rejoin-skipped');
      await db.insert(subscriptionPriceMoves).values({
        priceChangeId: change.id,
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        organizationId: input.organizationId,
        userId: sub.userId,
        state: 'skipped',
        skipReason: 'moving_away',
        attempts: 1,
        lastError: 'moving_away',
      });

      const result = await rejoin(input);

      expect(result).toMatchObject({ outcome: 'due', changeId: change.id });
      expect(await movesOf(change.id)).toEqual([
        expect.objectContaining({
          state: 'due',
          skipReason: null,
          source: 'keep_current_plan',
          attempts: 0,
          lastError: null,
        }),
      ]);
      const [after] = await changesOf(input.tierId);
      expect(after?.totalCount).toBe(1);
    });

    // Told, then they started leaving before the write landed: the step
    // closed them as moving away. Back on the tier, the write is all that is
    // left; a second email would break M1.
    it('re-opens a row they were told about as notified: the write only, from that email', async () => {
      const { sub, change, input } = await keptMember('rejoin-told');
      const toldAt = new Date(Date.now() - 5 * DAY_MS);
      await db.insert(subscriptionPriceMoves).values({
        priceChangeId: change.id,
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        organizationId: input.organizationId,
        userId: sub.userId,
        state: 'skipped',
        skipReason: 'moving_away',
        noticeAt: toldAt,
        effectiveAt: new Date(Date.now() + 30 * DAY_MS),
        attempts: 2,
        lastError: 'move_unknown_500',
      });

      const result = await rejoin(input);

      expect(result).toMatchObject({ outcome: 'due', changeId: change.id });
      expect(await movesOf(change.id)).toEqual([
        expect.objectContaining({
          state: 'notified',
          noticeAt: toldAt,
          skipReason: null,
          attempts: 0,
        }),
      ]);
    });

    it.each([
      ['scheduled', { scheduledKind: 'pending' }],
      ['notified', {}],
      ['held', { heldReason: 'notice_refused' }],
    ] as const)('leaves a %s row alone: already on it, nothing re-opened', async (state, extra) => {
      const { sub, change, input } = await keptMember(`rejoin-${state}`);
      await db
        .update(priceChanges)
        .set({ state: 'done', doneAt: new Date() })
        .where(eq(priceChanges.id, change.id));
      await db.insert(subscriptionPriceMoves).values({
        priceChangeId: change.id,
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        organizationId: input.organizationId,
        userId: sub.userId,
        state,
        noticeAt: new Date(),
        effectiveAt: new Date(Date.now() + 40 * DAY_MS),
        ...extra,
      });

      const result = await rejoin(input);

      expect(result).toEqual({ outcome: 'already_on_it', changeId: change.id });
      expect((await movesOf(change.id)).map((r) => r.state)).toEqual([state]);
      const [after] = await changesOf(input.tierId);
      expect(after).toMatchObject({ state: 'done', totalCount: 1 });
    });

    it('a live change for another Price: nothing written, the caller alerts', async () => {
      const { pro, change, input } = await keptMember('rejoin-mismatch');
      await db
        .update(subscriptionTiers)
        .set({ stripePriceMonthlyId: 'price_other' })
        .where(eq(subscriptionTiers.id, pro.id));

      const result = await rejoin(input);

      expect(result).toEqual({
        outcome: 'live_change_mismatch',
        changeId: change.id,
      });
      expect(await movesOf(change.id)).toEqual([]);
      expect(await changesOf(input.tierId)).toHaveLength(1);
    });

    it.each([
      [
        'the tier is on the Price put back',
        (input: RejoinInput): RejoinInput => ({
          ...input,
          heldPriceId: 'price_pro_1400',
        }),
        'not_repriced',
      ],
      [
        'the change Keep made live again is to the current Price',
        (input: RejoinInput): RejoinInput => ({
          ...input,
          parkedPendingPriceId: 'price_pro_1400',
        }),
        'already_told',
      ],
    ] as const)('nothing to tell when %s', async (_label, adjust, outcome) => {
      const { change, input } = await keptMember(`rejoin-${outcome}`);

      const result = await rejoin(adjust(input));

      expect(result).toEqual({ outcome });
      expect(await movesOf(change.id)).toEqual([]);
    });

    // Review C1, F3: a save of the tier in flight. Under READ COMMITTED the
    // latest-change read used to block on the change the save holds, then
    // drop it or keep a stale one, while the save's new change was not in
    // its snapshot; and the tier's current Price was read before it.
    it.each([
      ['running (someone else to tell)', true],
      ['done at once (nobody else to tell)', false],
    ])("Keep during a save: it waits for the save, then joins the save's change, %s", async (_label, othersOnTier) => {
      const { o, basic, pro, sub, change, input } = await keptMember(
        `rejoin-race-${othersOnTier}`
      );
      await db
        .update(priceChanges)
        .set({ state: 'done', doneAt: new Date() })
        .where(eq(priceChanges.id, change.id));
      if (othersOnTier) await subscriber(o.id, pro);
      // Still moving away to Basic when the save records who is due, so the
      // save leaves them out; Keep clears it before its rejoin.
      await db
        .update(subscriptions)
        .set({
          pendingTierId: basic.id,
          pendingTierFrom: new Date(Date.now() + 5 * DAY_MS),
          heldAmountCents: 1200,
        })
        .where(eq(subscriptions.id, sub.id));

      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding: (pid: number) => void = () => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });
      // The save: the tier row first, then latest wins and its rows.
      const save = db.transaction(async (tx) => {
        const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        await tx
          .update(subscriptionTiers)
          .set({ priceMonthly: 1600, stripePriceMonthlyId: 'price_pro_1600' })
          .where(eq(subscriptionTiers.id, pro.id));
        await recordTierPriceChange(tx, pro.id, {
          organizationId: o.id,
          interval: 'month',
          fromAmountCents: 1400,
          newAmountCents: 1600,
          newStripePriceId: 'price_pro_1600',
          createdByUserId: null,
          now: new Date(),
        });
        holding(Number((pid.rows[0] as { pid: number }).pid));
        await released;
      });
      const savePid = await held;
      await db
        .update(subscriptions)
        .set({
          pendingTierId: null,
          pendingTierFrom: null,
          heldAmountCents: null,
        })
        .where(eq(subscriptions.id, sub.id));

      const keeping = rejoin(input);
      // Probe, not a sleep: Keep is waiting on the save's lock.
      let blocked = 0;
      for (let tries = 0; tries < 400 && blocked < 1; tries++) {
        const probe = await db.execute(sql`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database()
             AND ${savePid}::int = ANY(pg_blocking_pids(pid))
        `);
        blocked = Number((probe.rows[0] as { n: number }).n);
        if (blocked < 1) await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(1);
      release();
      await save;
      const result = await keeping;

      const changes = await changesOf(pro.id);
      const newest = changes.find(
        (c) => c.newStripePriceId === 'price_pro_1600'
      );
      expect(result).toMatchObject({ outcome: 'due', changeId: newest?.id });
      expect(newest?.state).toBe('running');
      expect(changes.filter((c) => c.state === 'running')).toHaveLength(1);
      expect(changes).toHaveLength(2);
      expect(
        (await movesOf(newest?.id ?? '')).find(
          (m) => m.subscriptionId === sub.id
        )
      ).toMatchObject({ state: 'due', source: 'keep_current_plan' });
    });

    // Two Keeps on one tier with no change for its Price yet: both write a
    // change of their own. The second waits on the first's insert, then hits
    // the live-change index; run again, it joins the first's change.
    it("a second Keep's own change hits the live-change index; run again, it joins the first's", async () => {
      const { o, pro, input } = await keptMember('rejoin-two-keeps');
      await db.delete(priceChanges).where(eq(priceChanges.tierId, pro.id));
      const other = await subscriber(o.id, pro);
      const otherInput = {
        ...input,
        subscriptionId: other.id,
        stripeSubscriptionId: other.stripeSubscriptionId,
        userId: other.userId,
      };

      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding: (pid: number) => void = () => {};
      const held = new Promise<number>((resolve) => {
        holding = resolve;
      });
      const first = db.transaction(async (tx) => {
        const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        const result = await rejoinTierPriceChange(tx, input);
        holding(Number((pid.rows[0] as { pid: number }).pid));
        await released;
        return result;
      });
      const firstPid = await held;
      const second = rejoin(otherInput).catch((error: unknown) => error);
      let blocked = 0;
      for (let tries = 0; tries < 400 && blocked < 1; tries++) {
        const probe = await db.execute(sql`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database()
             AND ${firstPid}::int = ANY(pg_blocking_pids(pid))
        `);
        blocked = Number((probe.rows[0] as { n: number }).n);
        if (blocked < 1) await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(1);
      release();
      const firstResult = await first;
      expect(isUniqueViolation(await second)).toBe(true);

      const again = await rejoin(otherInput);

      expect(firstResult).toMatchObject({ outcome: 'due' });
      expect(again).toMatchObject({
        outcome: 'due',
        changeId: 'changeId' in firstResult ? firstResult.changeId : '',
      });
      expect(await changesOf(pro.id)).toEqual([
        expect.objectContaining({ state: 'running', totalCount: 2 }),
      ]);
    });
  });
});
