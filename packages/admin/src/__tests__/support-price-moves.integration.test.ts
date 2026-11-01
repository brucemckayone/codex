/**
 * Support's Queue › Price moves (Codex-2hxff.85, .86; batch C1 Part B data
 * design §2.5; owner decisions M1, Q5, Q6), against the real database.
 *
 * The hourly step is ecom-api's; these build its results directly (a price
 * change and its moves: held, queued again, or stopped) and read and act on
 * them as support does. Every row hangs off this file's own organisations
 * and users, deleted in afterAll; the lists read every row, so assertions
 * find this file's rows by id, and the badge is read as a difference.
 */

import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { PurchaseService } from '@codex/purchase';
import { ServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestMoneyDeps,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupportService } from '../services/support-service';

async function failureOf(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

type ChangeValues = Partial<typeof priceChanges.$inferInsert>;
type MoveValues = Partial<typeof subscriptionPriceMoves.$inferInsert>;

interface Plan {
  organizationId: string;
  tierId: string;
}

interface Subscriber {
  userId: string;
  subscriptionId: string;
  stripeSubscriptionId: string;
}

describe('SupportService price moves (real DB)', () => {
  let db: Database;
  let service: SupportService;
  let supportId: string;
  let ownerId: string;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const tierIds: string[] = [];
  const subscriptionIds: string[] = [];
  const changeIds: string[] = [];
  const courseIds: string[] = [];
  const planIds: string[] = [];
  const courseSubscriptionIds: string[] = [];

  const SAVED = new Date('2026-10-30T13:20:00Z');
  const LAST_TRY = new Date('2026-10-30T17:00:00Z');
  const NOW = new Date('2026-11-04T10:41:00Z');
  const NEXT_RUN = '2026-11-04T11:00:00.000Z';

  beforeAll(async () => {
    db = setupTestDatabase();
    const stripe = createMockStripe();
    service = new SupportService({
      db,
      environment: 'test',
      stripe,
      purchase: new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        stripe
      ),
    });
    [supportId, ownerId] = (await seedTestUsers(db, 2)) as [string, string];
    userIds.push(supportId, ownerId);
  });

  afterAll(async () => {
    if (changeIds.length > 0) {
      await db
        .delete(subscriptionPriceMoves)
        .where(inArray(subscriptionPriceMoves.priceChangeId, changeIds));
      await db.delete(priceChanges).where(inArray(priceChanges.id, changeIds));
    }
    if (courseSubscriptionIds.length > 0) {
      await db
        .delete(courseSubscriptions)
        .where(inArray(courseSubscriptions.id, courseSubscriptionIds));
    }
    if (planIds.length > 0) {
      await db
        .delete(courseSubscriptionPlans)
        .where(inArray(courseSubscriptionPlans.id, planIds));
    }
    if (courseIds.length > 0) {
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (subscriptionIds.length > 0) {
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.id, subscriptionIds));
    }
    if (tierIds.length > 0) {
      await db
        .delete(subscriptionTiers)
        .where(inArray(subscriptionTiers.id, tierIds));
    }
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await db.delete(users).where(inArray(users.id, userIds));
    await teardownTestDatabase();
  });

  /** Hollow Oak Films and its Pro tier. */
  async function proTier(): Promise<Plan> {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Hollow Oak Films', slug: createUniqueSlug('moves-q') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('org not inserted');
    orgIds.push(org.id);
    const [tier] = await db
      .insert(subscriptionTiers)
      .values(createTestTierInput(org.id, { name: 'Pro' }))
      .returning({ id: subscriptionTiers.id });
    if (!tier) throw new Error('tier not inserted');
    tierIds.push(tier.id);
    return { organizationId: org.id, tierId: tier.id };
  }

  /** A price change for the tier, monthly, £12.00 → £14.00, saved by the owner. */
  async function change(plan: Plan, values: ChangeValues = {}) {
    const [row] = await db
      .insert(priceChanges)
      .values({
        organizationId: plan.organizationId,
        kind: 'tier',
        tierId: plan.tierId,
        interval: 'month',
        fromAmountCents: 1200,
        newAmountCents: 1400,
        newStripePriceId: `price_new_${crypto.randomUUID().slice(0, 8)}`,
        state: 'done',
        doneAt: LAST_TRY,
        createdByUserId: ownerId,
        createdAt: SAVED,
        ...values,
      })
      .returning();
    if (!row) throw new Error('change not inserted');
    changeIds.push(row.id);
    return row;
  }

  async function subscriber(
    plan: Plan,
    status = 'active'
  ): Promise<Subscriber> {
    const [userId] = (await seedTestUsers(db, 1)) as [string];
    userIds.push(userId);
    const [row] = await db
      .insert(subscriptions)
      .values(
        createTestSubscriptionInput(userId, plan.organizationId, plan.tierId, {
          status,
        })
      )
      .returning({
        id: subscriptions.id,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      });
    if (!row) throw new Error('subscription not inserted');
    subscriptionIds.push(row.id);
    return {
      userId,
      subscriptionId: row.id,
      stripeSubscriptionId: row.stripeSubscriptionId,
    };
  }

  async function move(
    priceChange: { id: string; organizationId: string },
    who: Subscriber,
    values: MoveValues = {}
  ): Promise<string> {
    const [row] = await db
      .insert(subscriptionPriceMoves)
      .values({
        priceChangeId: priceChange.id,
        subscriptionId: who.subscriptionId,
        stripeSubscriptionId: who.stripeSubscriptionId,
        organizationId: priceChange.organizationId,
        userId: who.userId,
        createdAt: SAVED,
        ...values,
      })
      .returning({ id: subscriptionPriceMoves.id });
    if (!row) throw new Error('move not inserted');
    return row.id;
  }

  async function moveRow(id: string) {
    const [row] = await db
      .select()
      .from(subscriptionPriceMoves)
      .where(eq(subscriptionPriceMoves.id, id));
    return row;
  }

  async function changeRow(id: string) {
    const [row] = await db
      .select()
      .from(priceChanges)
      .where(eq(priceChanges.id, id));
    return row;
  }

  const badge = async () => (await service.getQueueCounts()).priceMoves;

  /** Never accepted: three refused emails. */
  const HELD_NOTICE: MoveValues = {
    state: 'held',
    heldReason: 'notice_refused',
    attempts: 3,
    attemptedAt: LAST_TRY,
    lastError: 'HTTP 422',
    alertErrorId: 'e7f1c2a4',
  };
  /** Told on 30 Oct about a move on 14 Dec, then Stripe refused it three times. */
  const HELD_MOVE: MoveValues = {
    state: 'held',
    heldReason: 'move_refused',
    attempts: 3,
    attemptedAt: LAST_TRY,
    lastError: 'invalid_request_error',
    noticeAt: new Date('2026-10-30T14:02:00Z'),
    effectiveAt: new Date('2026-12-14T00:00:00Z'),
  };
  const QUEUED = (values: MoveValues = {}): MoveValues => ({
    state: 'due',
    heldReason: 'notice_unknown',
    attempts: 0,
    attemptedAt: LAST_TRY,
    retryRequestedAt: new Date('2026-11-04T09:12:00Z'),
    retryRequestedByUserId: supportId,
    ...values,
  });
  // A function, as QUEUED is: supportId is set in beforeAll, after this
  // block is collected.
  const CLOSED = (): MoveValues => ({
    ...HELD_NOTICE,
    resolution: 'not_needed',
    resolvedAt: new Date('2026-11-03T12:00:00Z'),
    resolvedByUserId: supportId,
    resolutionNote: 'Cancelled instead',
  });

  it('lists held people with their plan, price and why, and queued retries; never a closed, moved, superseded or running row; the badge counts the held only', async () => {
    const before = await badge();
    const plan = await proTier();
    const c = await change(plan);
    const [leah, owen, ellen, finn, gus, hal, ivy, jo] = await Promise.all(
      Array.from({ length: 8 }, () => subscriber(plan))
    );
    const leahMove = await move(c, leah as Subscriber, HELD_NOTICE);
    const owenMove = await move(c, owen as Subscriber, HELD_MOVE);
    const ellenMove = await move(c, ellen as Subscriber, QUEUED());
    // Queued, and the run set its next try after the 08:00 London skip.
    const finnMove = await move(
      c,
      finn as Subscriber,
      QUEUED({
        state: 'notified',
        heldReason: 'move_unknown',
        noticeAt: HELD_MOVE.noticeAt,
        effectiveAt: HELD_MOVE.effectiveAt,
        attempts: 1,
        nextAttemptAt: new Date('2026-11-04T12:00:00Z'),
      })
    );
    await move(c, gus as Subscriber, CLOSED());
    await move(c, hal as Subscriber, {
      state: 'scheduled',
      scheduledKind: 'pending',
      noticeAt: HELD_MOVE.noticeAt,
      effectiveAt: HELD_MOVE.effectiveAt,
    });
    await move(c, ivy as Subscriber, { state: 'superseded' });
    await move(c, jo as Subscriber, { state: 'due', attempts: 1 });

    const list = await service.listHeldPriceMoves({ page: 1, limit: 50 }, NOW);
    const mine = list.items.filter((m) => m.priceChangeId === c.id);
    expect(mine.map((m) => m.moveId).sort()).toEqual(
      [leahMove, owenMove, ellenMove, finnMove].sort()
    );

    expect(mine.find((m) => m.moveId === leahMove)).toEqual({
      moveId: leahMove,
      priceChangeId: c.id,
      status: 'held',
      action: 'retry',
      subscriber: expect.objectContaining({
        userId: leah?.userId,
        deleted: false,
      }),
      organization: {
        id: plan.organizationId,
        name: 'Hollow Oak Films',
        deleted: false,
      },
      plan: { kind: 'tier', id: plan.tierId, name: 'Pro', interval: 'month' },
      fromAmountCents: 1200,
      newAmountCents: 1400,
      heldReason: 'notice_refused',
      lastError: 'HTTP 422',
      alertErrorId: 'e7f1c2a4',
      attempts: 3,
      lastTriedAt: LAST_TRY.toISOString(),
      noticeAt: null,
      effectiveAt: null,
      subscriptionEnded: false,
      retry: null,
      queuedFor: null,
      resolution: null,
      createdAt: SAVED.toISOString(),
    });
    expect(
      typeof mine.find((m) => m.moveId === leahMove)?.subscriber.email
    ).toBe('string');
    expect(mine.find((m) => m.moveId === owenMove)).toMatchObject({
      status: 'held',
      action: 'retry_move',
      heldReason: 'move_refused',
      noticeAt: '2026-10-30T14:02:00.000Z',
      effectiveAt: '2026-12-14T00:00:00.000Z',
    });
    expect(mine.find((m) => m.moveId === ellenMove)).toMatchObject({
      status: 'queued',
      action: null,
      heldReason: 'notice_unknown',
      retry: {
        requestedAt: '2026-11-04T09:12:00.000Z',
        by: expect.objectContaining({ userId: supportId }),
      },
      queuedFor: NEXT_RUN,
    });
    expect(mine.find((m) => m.moveId === finnMove)?.queuedFor).toBe(
      '2026-11-04T12:00:00.000Z'
    );

    // Leah and Owen: a queued retry is off the badge, as is a closed row.
    expect((await badge()) - before).toBe(2);
  });

  it('Retry with no accepted email: back to due, three fresh tries, its reason kept, who asked; a finished change runs again; the answer names the next run', async () => {
    const plan = await proTier();
    const c = await change(plan);
    const leah = await subscriber(plan);
    const leahMove = await move(c, leah, HELD_NOTICE);
    const before = await badge();

    const result = await service.retryPriceMove(leahMove, supportId, NOW);

    expect(result.nextRunAt).toBe(NEXT_RUN);
    expect(result.move).toMatchObject({
      moveId: leahMove,
      status: 'queued',
      action: null,
      heldReason: 'notice_refused',
      attempts: 0,
      noticeAt: null,
      retry: {
        requestedAt: NOW.toISOString(),
        by: expect.objectContaining({ userId: supportId }),
      },
      queuedFor: NEXT_RUN,
    });
    expect(await moveRow(leahMove)).toMatchObject({
      state: 'due',
      attempts: 0,
      nextAttemptAt: null,
      heldReason: 'notice_refused',
      lastError: 'HTTP 422',
      noticeAt: null,
      retryRequestedAt: NOW,
      retryRequestedByUserId: supportId,
      resolvedAt: null,
    });
    // The run claims only a running change's rows.
    expect(await changeRow(c.id)).toMatchObject({
      state: 'running',
      doneAt: null,
    });
    const list = await service.listHeldPriceMoves({ page: 1, limit: 50 }, NOW);
    expect(list.items.find((m) => m.moveId === leahMove)?.status).toBe(
      'queued'
    );
    expect((await badge()) - before).toBe(-1);
  });

  it('Retry the move after an accepted email: notified, so no second email, with the dates they were told kept (Q5)', async () => {
    const plan = await proTier();
    const c = await change(plan, { state: 'running', doneAt: null });
    const owen = await subscriber(plan);
    const owenMove = await move(c, owen, HELD_MOVE);

    const result = await service.retryPriceMove(owenMove, supportId, NOW);

    expect(result.move).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await moveRow(owenMove)).toMatchObject({
      state: 'notified',
      attempts: 0,
      nextAttemptAt: null,
      heldReason: 'move_refused',
      noticeAt: HELD_MOVE.noticeAt,
      effectiveAt: HELD_MOVE.effectiveAt,
      retryRequestedByUserId: supportId,
    });
    expect((await changeRow(c.id))?.state).toBe('running');
  });

  it('Retry refuses with 409 PRICE_MOVE_NOT_HELD, saying why: moved, set aside, still with the run, already queued, closed, or ended; 404 for no move', async () => {
    const plan = await proTier();
    const c = await change(plan);
    const people = await Promise.all(
      Array.from({ length: 6 }, () => subscriber(plan))
    );
    const ended = await subscriber(plan, 'cancelled');
    const cases: Array<[MoveValues, string, string]> = [
      [
        {
          state: 'scheduled',
          scheduledKind: 'now',
          noticeAt: HELD_MOVE.noticeAt,
          effectiveAt: HELD_MOVE.effectiveAt,
        },
        'moved',
        'Their move is already scheduled: the hourly run got there first.',
      ],
      [{ state: 'unchanged' }, 'moved', 'They are already on the new price.'],
      [
        { state: 'skipped', skipReason: 'moving_away' },
        'skipped',
        'They are moving to another plan, so this price no longer applies to them.',
      ],
      [
        { state: 'due', attempts: 1 },
        'in_progress',
        "The hourly run is still working on this one: it isn't held.",
      ],
      [QUEUED(), 'queued', 'This one is already queued for the next run.'],
      [CLOSED(), 'resolved', 'This one is already closed: no move needed.'],
    ];
    for (const [index, [values, reason, message]] of cases.entries()) {
      const id = await move(c, people[index] as Subscriber, values);
      const refused = await failureOf(
        service.retryPriceMove(id, supportId, NOW)
      );
      expect([refused.statusCode, refused.context?.code]).toEqual([
        409,
        'PRICE_MOVE_NOT_HELD',
      ]);
      expect(refused.context?.reason).toBe(reason);
      expect(refused.message).toBe(message);
    }

    const endedMove = await move(c, ended, HELD_NOTICE);
    const refused = await failureOf(
      service.retryPriceMove(endedMove, supportId, NOW)
    );
    expect(refused.context?.reason).toBe('subscription_ended');
    expect(refused.message).toBe(
      'Their subscription has ended, so there is nothing to move. Close it as not needed.'
    );
    // Nothing written, and the list offers Close only.
    expect(await moveRow(endedMove)).toMatchObject({
      state: 'held',
      attempts: 3,
      retryRequestedAt: null,
    });
    expect((await changeRow(c.id))?.state).toBe('done');
    const list = await service.listHeldPriceMoves({ page: 1, limit: 50 }, NOW);
    expect(list.items.find((m) => m.moveId === endedMove)).toMatchObject({
      status: 'held',
      action: null,
      subscriptionEnded: true,
    });

    const missing = await failureOf(
      service.retryPriceMove(crypto.randomUUID(), supportId, NOW)
    );
    expect(missing.statusCode).toBe(404);
  });

  it('latest wins: Retry on a move a newer price for the plan replaced is refused, naming it, and writes nothing; a newer price for the other interval is no bar', async () => {
    const plan = await proTier();
    const old = await change(plan);
    const [leah, ivy] = [await subscriber(plan), await subscriber(plan)];
    const leahMove = await move(old, leah, HELD_NOTICE);
    const ivyMove = await move(old, ivy, { state: 'superseded' });
    const newer = await change(plan, {
      state: 'running',
      doneAt: null,
      fromAmountCents: 1400,
      newAmountCents: 1500,
      createdAt: new Date('2026-11-04T10:30:00Z'),
    });

    const refused = await failureOf(
      service.retryPriceMove(leahMove, supportId, NOW)
    );
    expect([refused.statusCode, refused.context?.code]).toEqual([
      409,
      'PRICE_MOVE_NOT_HELD',
    ]);
    expect(refused.context).toMatchObject({
      reason: 'superseded',
      supersededById: newer.id,
      supersededAt: '2026-11-04T10:30:00.000Z',
      newAmountCents: 1500,
    });
    expect(refused.message).toBe(
      'A newer price for Pro replaced this one at 10:30 on 4 Nov 2026, so they are emailed about that instead.'
    );
    expect(await moveRow(leahMove)).toMatchObject({
      state: 'held',
      retryRequestedAt: null,
    });
    expect((await changeRow(old.id))?.state).toBe('done');
    expect(
      (await failureOf(service.retryPriceMove(ivyMove, supportId, NOW))).context
        ?.reason
    ).toBe('superseded');

    // Another tier: its yearly price changed later, its monthly move retries.
    const other = await proTier();
    const monthly = await change(other);
    await change(other, {
      interval: 'year',
      state: 'running',
      doneAt: null,
      createdAt: new Date('2026-11-04T10:30:00Z'),
    });
    const kit = await subscriber(other);
    const kitMove = await move(monthly, kit, HELD_NOTICE);
    await service.retryPriceMove(kitMove, supportId, NOW);
    expect((await moveRow(kitMove))?.state).toBe('due');
  });

  it('Close: a reason and a note; it moves nobody, stays held and leaves the Queue and the badge; closed or queued rows are refused; an ended or overtaken one can be closed', async () => {
    const plan = await proTier();
    const c = await change(plan);
    const [leah, ellen] = [await subscriber(plan), await subscriber(plan)];
    const nia = await subscriber(plan, 'cancelled');
    const leahMove = await move(c, leah, HELD_NOTICE);
    const ellenMove = await move(c, ellen, QUEUED());
    const niaMove = await move(c, nia, HELD_NOTICE);
    const before = await badge();
    const note = 'Phoned Leah on 4 Nov; Leah has cancelled Pro';

    const closed = await service.closePriceMove(
      leahMove,
      { resolution: 'not_needed', note },
      supportId,
      NOW
    );

    expect(closed).toMatchObject({
      moveId: leahMove,
      status: 'closed',
      action: null,
      resolution: {
        kind: 'not_needed',
        note,
        resolvedAt: NOW.toISOString(),
        by: expect.objectContaining({ userId: supportId }),
      },
    });
    expect(await moveRow(leahMove)).toMatchObject({
      state: 'held',
      resolution: 'not_needed',
      resolvedAt: NOW,
      resolvedByUserId: supportId,
      resolutionNote: note,
      retryRequestedAt: null,
    });
    const list = await service.listHeldPriceMoves({ page: 1, limit: 50 }, NOW);
    expect(list.items.map((m) => m.moveId)).not.toContain(leahMove);
    expect((await badge()) - before).toBe(-1);

    const again = await failureOf(
      service.closePriceMove(
        leahMove,
        { resolution: 'moved_by_hand', note: 'Moved' },
        supportId
      )
    );
    expect(again.context).toMatchObject({
      code: 'PRICE_MOVE_NOT_HELD',
      reason: 'resolved',
      resolution: 'not_needed',
      resolvedByUserId: supportId,
    });
    const queued = await failureOf(
      service.closePriceMove(
        ellenMove,
        { resolution: 'not_needed', note: 'n/a' },
        supportId
      )
    );
    expect(queued.context?.reason).toBe('queued');
    expect(queued.message).toBe(
      'This one is queued for the next run. If the run holds it again, close it then.'
    );

    await service.closePriceMove(
      niaMove,
      { resolution: 'not_needed', note: 'Cancelled' },
      supportId,
      NOW
    );
    expect((await moveRow(niaMove))?.resolution).toBe('not_needed');

    await change(plan, {
      state: 'running',
      doneAt: null,
      createdAt: new Date('2026-11-04T10:30:00Z'),
    });
    const owen = await subscriber(plan);
    const owenMove = await move(c, owen, HELD_MOVE);
    await service.closePriceMove(
      owenMove,
      { resolution: 'moved_by_hand', note: 'Moved in Stripe' },
      supportId,
      NOW
    );
    expect((await moveRow(owenMove))?.resolution).toBe('moved_by_hand');
  });

  it('a stopped change is one card, with the cause, the error id, who saved it and how many wait; Restart asks the next run and leaves the badge; a repeat answers as it stands', async () => {
    const before = await badge();
    const plan = await proTier();
    const stopped = await change(plan, {
      state: 'stopped',
      doneAt: null,
      stoppedAt: new Date('2026-10-30T14:00:30Z'),
      stoppedReason: 'notice_refused_404',
      stoppedErrorId: 'e7f1c2a4',
      totalCount: 3,
    });
    const people = await Promise.all(
      Array.from({ length: 3 }, () => subscriber(plan))
    );
    await move(stopped, people[0] as Subscriber, { state: 'due' });
    await move(stopped, people[1] as Subscriber, { state: 'due' });
    await move(stopped, people[2] as Subscriber, {
      state: 'skipped',
      skipReason: 'ended',
    });
    // Restarted once, then stopped again: that press is history.
    const other = await proTier();
    const again = await change(other, {
      state: 'stopped',
      doneAt: null,
      stoppedAt: new Date('2026-11-02T09:00:20Z'),
      stoppedReason: 'notice_refused_401',
      stoppedErrorId: 'b0c1d2e3',
      restartRequestedAt: new Date('2026-11-01T13:12:00Z'),
      restartRequestedByUserId: supportId,
    });

    const list = await service.listStoppedPriceChanges(
      { page: 1, limit: 50 },
      NOW
    );
    expect(list.items.find((card) => card.changeId === stopped.id)).toEqual({
      changeId: stopped.id,
      organization: {
        id: plan.organizationId,
        name: 'Hollow Oak Films',
        deleted: false,
      },
      plan: { kind: 'tier', id: plan.tierId, name: 'Pro', interval: 'month' },
      fromAmountCents: 1200,
      newAmountCents: 1400,
      savedAt: SAVED.toISOString(),
      savedBy: expect.objectContaining({ userId: ownerId }),
      stoppedAt: '2026-10-30T14:00:30.000Z',
      stoppedReason: 'notice_refused_404',
      stoppedErrorId: 'e7f1c2a4',
      waiting: 2,
      total: 3,
      restart: null,
    });
    expect(
      list.items.find((card) => card.changeId === again.id)?.restart
    ).toBeNull();
    expect((await badge()) - before).toBe(2);

    const result = await service.restartPriceChange(stopped.id, supportId, NOW);
    expect(result.nextRunAt).toBe(NEXT_RUN);
    expect(result.change.restart).toEqual({
      requestedAt: NOW.toISOString(),
      by: expect.objectContaining({ userId: supportId }),
      at: NEXT_RUN,
    });
    expect(await changeRow(stopped.id)).toMatchObject({
      state: 'stopped',
      restartRequestedAt: NOW,
      restartRequestedByUserId: supportId,
    });
    expect((await badge()) - before).toBe(1);

    // A repeat (a lost answer, another tab) changes nothing.
    const repeat = await service.restartPriceChange(
      stopped.id,
      ownerId,
      new Date('2026-11-04T10:45:00Z')
    );
    expect(repeat.change.restart?.requestedAt).toBe(NOW.toISOString());
    expect((await changeRow(stopped.id))?.restartRequestedByUserId).toBe(
      supportId
    );

    // The press from before the later stop doesn't count: this one does.
    await service.restartPriceChange(again.id, supportId, NOW);
    expect((await changeRow(again.id))?.restartRequestedAt).toEqual(NOW);
    expect((await badge()) - before).toBe(0);
  });

  it('Restart refuses a change that isn’t stopped with 409 PRICE_CHANGE_NOT_STOPPED; 404 for no change', async () => {
    const plan = await proTier();
    const running = await change(plan, { state: 'running', doneAt: null });
    const done = await change(plan, { interval: 'year' });
    for (const [c, state, message] of [
      [
        running,
        'running',
        'This price change is running: the hourly run is already emailing its subscribers.',
      ],
      [
        done,
        'done',
        'This price change has finished: there is nothing to restart.',
      ],
    ] as const) {
      const refused = await failureOf(
        service.restartPriceChange(c.id, supportId, NOW)
      );
      expect([refused.statusCode, refused.context?.code]).toEqual([
        409,
        'PRICE_CHANGE_NOT_STOPPED',
      ]);
      expect(refused.context?.state).toBe(state);
      expect(refused.message).toBe(message);
      expect((await changeRow(c.id))?.restartRequestedAt).toBeNull();
    }
    const missing = await failureOf(
      service.restartPriceChange(crypto.randomUUID(), supportId, NOW)
    );
    expect(missing.statusCode).toBe(404);
  });

  it('a course plan’s move names the course and reads its course subscription’s status', async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Northlight Collective',
        slug: createUniqueSlug('moves-c'),
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error('org not inserted');
    orgIds.push(org.id);
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: org.id,
        creatorId: ownerId,
        slug: createUniqueSlug('night'),
        title: 'Night Photography',
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('course not inserted');
    courseIds.push(course.id);
    const [coursePlan] = await db
      .insert(courseSubscriptionPlans)
      .values({ courseId: course.id, priceMonthly: 800, priceAnnual: 8000 })
      .returning({ id: courseSubscriptionPlans.id });
    if (!coursePlan) throw new Error('plan not inserted');
    planIds.push(coursePlan.id);
    const [userId] = (await seedTestUsers(db, 1)) as [string];
    userIds.push(userId);
    const stripeSubscriptionId = `sub_test_${crypto.randomUUID().slice(0, 8)}`;
    const [courseSub] = await db
      .insert(courseSubscriptions)
      .values({
        userId,
        courseId: course.id,
        planId: coursePlan.id,
        organizationId: org.id,
        stripeSubscriptionId,
        stripeCustomerId: 'cus_test_night',
        status: 'active',
        billingInterval: 'year',
        currentPeriodStart: SAVED,
        currentPeriodEnd: new Date('2027-10-30T13:20:00Z'),
      })
      .returning({ id: courseSubscriptions.id });
    if (!courseSub) throw new Error('course subscription not inserted');
    courseSubscriptionIds.push(courseSub.id);
    const [c] = await db
      .insert(priceChanges)
      .values({
        organizationId: org.id,
        kind: 'course_plan',
        courseSubscriptionPlanId: coursePlan.id,
        interval: 'year',
        fromAmountCents: 8000,
        newAmountCents: 9000,
        newStripePriceId: 'price_night_year',
        state: 'done',
        doneAt: LAST_TRY,
        createdAt: SAVED,
      })
      .returning();
    if (!c) throw new Error('change not inserted');
    changeIds.push(c.id);
    const [m] = await db
      .insert(subscriptionPriceMoves)
      .values({
        priceChangeId: c.id,
        courseSubscriptionId: courseSub.id,
        stripeSubscriptionId,
        organizationId: org.id,
        userId,
        ...HELD_NOTICE,
      })
      .returning({ id: subscriptionPriceMoves.id });
    if (!m) throw new Error('move not inserted');

    const list = await service.listHeldPriceMoves({ page: 1, limit: 50 }, NOW);
    expect(list.items.find((row) => row.moveId === m.id)).toMatchObject({
      plan: {
        kind: 'course_plan',
        id: coursePlan.id,
        name: 'Night Photography',
        interval: 'year',
      },
      organization: { name: 'Northlight Collective' },
      subscriptionEnded: false,
      action: 'retry',
    });

    await db
      .update(courseSubscriptions)
      .set({ status: 'cancelled', cancelledAt: NOW })
      .where(eq(courseSubscriptions.id, courseSub.id));
    const refused = await failureOf(
      service.retryPriceMove(m.id, supportId, NOW)
    );
    expect(refused.context?.reason).toBe('subscription_ended');
  });

  it('Retry while the run marks the change done: Retry waits for the change, then runs it again, so the row is claimed', async () => {
    const plan = await proTier();
    const c = await change(plan, { state: 'running', doneAt: null });
    const leah = await subscriber(plan);
    const leahMove = await move(c, leah, HELD_NOTICE);

    let blocked = false;
    let retry: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      // The run, finishing the change: nothing due or notified is left.
      await tx
        .select({ id: priceChanges.id })
        .from(priceChanges)
        .where(eq(priceChanges.id, c.id))
        .for('update');
      const [pidRow] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`))
        .rows as Array<{ pid: number }>;
      await tx
        .update(priceChanges)
        .set({ state: 'done', doneAt: NOW })
        .where(eq(priceChanges.id, c.id));

      retry = service
        .retryPriceMove(leahMove, supportId, NOW)
        .catch((error: unknown) => error);
      // Probe, never sleep: wait until Postgres reports the Retry blocked by
      // this transaction's backend.
      for (let i = 0; i < 100 && !blocked; i++) {
        const probe = await db.execute(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pidRow?.pid ?? 0} = ANY(pg_blocking_pids(pid))`
        );
        blocked = ((probe.rows[0] as { n: number } | undefined)?.n ?? 0) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
    });

    expect(blocked).toBe(true);
    expect(await retry).toMatchObject({ nextRunAt: NEXT_RUN });
    expect(await changeRow(c.id)).toMatchObject({
      state: 'running',
      doneAt: null,
    });
    expect((await moveRow(leahMove))?.state).toBe('due');
  });
});
