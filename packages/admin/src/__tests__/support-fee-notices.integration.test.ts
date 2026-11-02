/**
 * Support's Queue › Fee notices (Codex-2hxff.33; batch C1 Part B data design
 * §1.6; owner decisions F4, F8, Q4), against the real database.
 *
 * The fee step is notifications-api's; these build its results directly (a
 * listed rise and its notices) and read them as support does. Every row hangs
 * off this file's own organisations and users, deleted in afterAll; the lists
 * read every change, so assertions find this file's rows by id.
 */

import {
  feeChangeNotices,
  feeChanges,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import { feeRiseStartAfter, nextFeeNoticeRunAfter } from '@codex/payments';
import { PurchaseService } from '@codex/purchase';
import { ServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedFeeLevel,
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

type NoticeValues = Partial<typeof feeChangeNotices.$inferInsert>;

describe('SupportService fee notices (real DB)', () => {
  let db: Database;
  let service: SupportService;
  let supportId: string;
  const orgIds: string[] = [];
  const userIds: string[] = [];

  const FIRST_RUN = new Date('2026-11-03T08:00:00Z');
  const NOW = new Date('2026-11-04T10:42:00Z');

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
    [supportId] = (await seedTestUsers(db, 1)) as [string];
    userIds.push(supportId);
  });

  afterAll(async () => {
    if (orgIds.length > 0) {
      // Versions and notices cascade with their change.
      await db
        .delete(feeChanges)
        .where(inArray(feeChanges.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await db.delete(users).where(inArray(users.id, userIds));
    await teardownTestDatabase();
  });

  async function people(n: number): Promise<string[]> {
    const ids = await seedTestUsers(db, n);
    userIds.push(...ids);
    return ids;
  }

  /**
   * An organisation whose own fee is 10% today, and a rise in it to 15%
   * saved by support. Listed on FIRST_RUN unless `listed` is false.
   */
  async function rise(
    values: Partial<typeof feeChanges.$inferInsert> = {},
    listed = true
  ): Promise<{ organizationId: string; changeId: string }> {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Hollow Oak Films', slug: createUniqueSlug('fee-q') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('org not inserted');
    orgIds.push(org.id);
    await seedFeeLevel(
      db,
      { scope: 'org', organizationId: org.id },
      { orgFeePercent: 1000 }
    );
    const [change] = await db
      .insert(feeChanges)
      .values({
        scope: 'org',
        organizationId: org.id,
        kind: 'rise',
        createdBy: supportId,
        createdAt: new Date('2026-11-02T14:20:00Z'),
        ...(listed ? { firstRunAt: FIRST_RUN, listedCount: 0 } : {}),
        ...values,
      })
      .returning({ id: feeChanges.id });
    if (!change) throw new Error('change not inserted');
    await db.insert(feeConfigVersions).values({
      changeId: change.id,
      scope: 'org',
      orgFeePercent: 1500,
    });
    return { organizationId: org.id, changeId: change.id };
  }

  async function notice(
    changeId: string,
    organizationId: string,
    userId: string,
    values: NoticeValues = {}
  ): Promise<string> {
    const [row] = await db
      .insert(feeChangeNotices)
      .values({
        changeId,
        userId,
        kind: 'announce',
        onList: true,
        roles: [{ organizationId, as: 'creator' }],
        beforeValues: [],
        afterValues: [],
        createdAt: FIRST_RUN,
        ...values,
      })
      .returning({ id: feeChangeNotices.id });
    if (!row) throw new Error('notice not inserted');
    return row.id;
  }

  const SENT = (at: Date): NoticeValues => ({
    state: 'sent',
    acceptedAt: at,
    attempts: 1,
  });
  const FAILED: NoticeValues = {
    state: 'failed',
    lastReason: 'refused',
    lastError: 'HTTP 400',
    attempts: 1,
    attemptedAt: FIRST_RUN,
  };

  it('a waiting rise’s card: what moves at its level, who saved it, who is told and who it waits for, joiners apart', async () => {
    const { organizationId, changeId } = await rise();
    const [ana, ben, cal, dee, eve, fay, gus] = await people(7);
    const toldAt = new Date('2026-11-03T16:00:00Z');
    await notice(changeId, organizationId, ana as string, SENT(FIRST_RUN));
    // 23:30 UTC on 1 July is 00:30 on 2 July in London (BST): the day is
    // London's, not UTC's.
    await notice(
      changeId,
      organizationId,
      gus as string,
      SENT(new Date('2026-07-01T23:30:00Z'))
    );
    await notice(changeId, organizationId, ben as string, {
      state: 'told_another_way',
      toldNote: 'Phoned Ben',
      toldByUserId: supportId,
      toldAt,
    });
    await notice(changeId, organizationId, cal as string, FAILED);
    await notice(changeId, organizationId, fay as string, {
      state: 'not_needed',
    });
    await notice(changeId, organizationId, dee as string, {
      onList: false,
      ...SENT(NOW),
    });
    await notice(changeId, organizationId, eve as string, {
      onList: false,
      ...FAILED,
    });

    const list = await service.listFeeChanges({ page: 1, limit: 50 }, NOW);
    const card = list.items.find((c) => c.changeId === changeId);

    expect(card).toMatchObject({
      scope: 'org',
      organization: { id: organizationId, name: 'Hollow Oak Films' },
      creator: null,
      lines: [
        { value: 'orgFeePercent', context: 'both', from: 1000, to: 1500 },
      ],
      removed: false,
      savedAt: '2026-11-02T14:20:00.000Z',
      savedBy: { userId: supportId },
      firstRunAt: FIRST_RUN.toISOString(),
      firstEmailsAt: null,
      told: { byEmail: 2, anotherWay: 1 },
      // F2: "410 by email on 3 Nov, 1 by email on 4 Nov". Joiners apart.
      toldByDay: [
        { londonDate: '2026-07-02', byEmail: 1, anotherWay: 0 },
        { londonDate: '2026-11-03', byEmail: 1, anotherWay: 1 },
      ],
      waitingFor: 1,
      joiners: { total: 2, told: 1, waiting: 1 },
      lastToldAt: null,
      effectiveFrom: null,
      earliestFrom: feeRiseStartAfter(NOW).toISOString(),
    });
    expect(card?.toldAnotherWay).toEqual([
      {
        person: expect.objectContaining({ userId: ben }),
        by: expect.objectContaining({ userId: supportId }),
        at: toldAt.toISOString(),
        note: 'Phoned Ben',
      },
    ]);
  });

  it('a rise not listed yet says when its first emails go', async () => {
    const { changeId } = await rise({}, false);
    const list = await service.listFeeChanges({ page: 1, limit: 50 }, NOW);
    expect(list.items.find((c) => c.changeId === changeId)).toMatchObject({
      firstRunAt: null,
      listed: null,
      firstEmailsAt: nextFeeNoticeRunAfter(NOW).toISOString(),
    });
  });

  it('lists the people not yet told, joiners flagged; never anyone told, set aside, or on a rise that is off or started; the badge counts the same', async () => {
    const { organizationId, changeId } = await rise();
    const [gil, hal, ivy, jo, kay, lia] = await people(6);
    const gilNotice = await notice(changeId, organizationId, gil as string, {
      ...FAILED,
      state: 'unknown',
      lastReason: 'unknown',
      lastError: 'HTTP 503',
    });
    const halNotice = await notice(changeId, organizationId, hal as string, {
      onList: false,
      ...FAILED,
    });
    await notice(changeId, organizationId, ivy as string, SENT(FIRST_RUN));
    // F7's "joined 12 Nov": Hal joined the organisation after the first
    // announcement. Kay was already a member (a promotion put them on the
    // list later), and Lia is an orgless creator: neither has a join date.
    const halJoined = new Date('2026-11-03T12:00:00Z');
    await db.insert(organizationMemberships).values([
      {
        organizationId,
        userId: hal as string,
        role: 'creator',
        createdAt: halJoined,
      },
      {
        organizationId,
        userId: kay as string,
        role: 'creator',
        createdAt: new Date('2026-10-01T09:00:00Z'),
      },
      // On the first list: never a joiner, whatever its membership's date.
      {
        organizationId,
        userId: gil as string,
        role: 'creator',
        createdAt: halJoined,
      },
    ]);
    const kayNotice = await notice(changeId, organizationId, kay as string, {
      onList: false,
      ...FAILED,
    });
    const liaNotice = await notice(changeId, organizationId, lia as string, {
      onList: false,
      ...FAILED,
      roles: [{ organizationId: null, as: 'creator' }],
    });
    const off = await rise({
      voidedAt: NOW,
      voidReason: 'cancelled',
    });
    const offNotice = await notice(
      off.changeId,
      off.organizationId,
      jo as string,
      FAILED
    );
    const started = await rise({ effectiveFrom: new Date('2026-11-01') });
    const startedNotice = await notice(
      started.changeId,
      started.organizationId,
      jo as string,
      FAILED
    );

    const list = await service.listFeeNotices({ page: 1, limit: 50 }, NOW);
    const ids = list.items.map((n) => n.noticeId);
    expect(ids).toEqual(expect.arrayContaining([gilNotice, halNotice]));
    expect(ids).not.toContain(offNotice);
    expect(ids).not.toContain(startedNotice);
    expect(list.items.filter((n) => n.changeId === changeId)).toHaveLength(4);

    const row = list.items.find((n) => n.noticeId === halNotice);
    expect(row).toMatchObject({
      changeId,
      person: { userId: hal, deleted: false },
      roles: [
        { organizationId, organizationName: 'Hollow Oak Films', as: 'creator' },
      ],
      onList: false,
      // F7: they joined the organisation after the first announcement.
      joinedAt: halJoined.toISOString(),
      state: 'failed',
      reason: 'refused',
      error: 'HTTP 400',
      attempts: 1,
      waitingSince: FIRST_RUN.toISOString(),
      lastTriedAt: FIRST_RUN.toISOString(),
      nextTryAt: nextFeeNoticeRunAfter(NOW).toISOString(),
      changeEffectiveFrom: null,
    });
    expect(typeof row?.person.email).toBe('string');
    expect(list.items.find((n) => n.noticeId === gilNotice)).toMatchObject({
      state: 'unknown',
      onList: true,
      joinedAt: null,
    });
    // A membership from before the announcement, and none at all: null,
    // never the notice's own date (that is waitingSince).
    for (const id of [kayNotice, liaNotice]) {
      expect(list.items.find((n) => n.noticeId === id)).toMatchObject({
        onList: false,
        joinedAt: null,
        waitingSince: FIRST_RUN.toISOString(),
      });
    }

    // The badge: the same people, read now (this rise hasn't started).
    const counts = await service.getQueueCounts();
    const everyone = await service.listFeeNotices({ page: 1, limit: 50 });
    expect(counts.feeNotices).toBe(everyone.pagination.total);
    expect(counts.feeNotices).toBeGreaterThanOrEqual(4);
  });

  it('marking the last person told another way dates the rise from the mark, in the same answer', async () => {
    const { organizationId, changeId } = await rise();
    const [kit, lou] = await people(2);
    await notice(changeId, organizationId, kit as string, SENT(FIRST_RUN));
    const louNotice = await notice(
      changeId,
      organizationId,
      lou as string,
      FAILED
    );

    const { result, level } = await service.markToldAnotherWay(
      louNotice,
      { note: 'Phoned Lou' },
      supportId,
      NOW
    );

    expect(result).toEqual({
      notice: {
        noticeId: louNotice,
        state: 'told_another_way',
        toldAt: NOW.toISOString(),
        toldBy: supportId,
        note: 'Phoned Lou',
      },
      change: {
        changeId,
        effectiveFrom: feeRiseStartAfter(NOW).toISOString(),
        waitingFor: 0,
      },
    });
    expect(feeRiseStartAfter(NOW).toISOString()).toBe(
      '2026-12-05T00:00:00.000Z'
    );
    expect(level).toEqual({ scope: 'org', organizationId });
    const [row] = await db
      .select()
      .from(feeChangeNotices)
      .where(eq(feeChangeNotices.id, louNotice));
    expect(row).toMatchObject({
      state: 'told_another_way',
      toldNote: 'Phoned Lou',
      toldByUserId: supportId,
      toldAt: NOW,
    });
  });

  it('a mark with others still waiting leaves the date unset, and says how many are left', async () => {
    const { organizationId, changeId } = await rise();
    const [max, ned] = await people(2);
    const maxNotice = await notice(
      changeId,
      organizationId,
      max as string,
      FAILED
    );
    await notice(changeId, organizationId, ned as string, FAILED);

    const { result } = await service.markToldAnotherWay(
      maxNotice,
      { note: 'Emailed from my own address' },
      supportId,
      NOW
    );
    expect(result.change).toEqual({
      changeId,
      effectiveFrom: null,
      waitingFor: 1,
    });
  });

  it('refuses with 409 a second mark, a rise that is off, and someone set aside; 404 for a follow-up or no notice', async () => {
    const { organizationId, changeId } = await rise();
    const [oz, pat, quin] = await people(3);
    const ozNotice = await notice(
      changeId,
      organizationId,
      oz as string,
      FAILED
    );
    await notice(changeId, organizationId, quin as string, FAILED);
    const patNotice = await notice(changeId, organizationId, pat as string, {
      state: 'not_needed',
    });
    const followUp = await notice(changeId, organizationId, oz as string, {
      kind: 'smaller',
      onList: false,
    });

    await service.markToldAnotherWay(ozNotice, { note: 'Phoned' }, supportId);
    const again = await failureOf(
      service.markToldAnotherWay(ozNotice, { note: 'Phoned' }, supportId)
    );
    expect([again.statusCode, again.context?.code]).toEqual([
      409,
      'FEE_NOTICE_ALREADY_TOLD',
    ]);
    // F6: "already marked as told by Sam Ortiz at 10:41".
    const [marker] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, supportId));
    expect(marker?.name).toBeTruthy();
    expect(again.context).toMatchObject({
      state: 'told_another_way',
      toldByUserId: supportId,
      toldByName: marker?.name,
      toldAt: expect.any(String),
    });

    const aside = await failureOf(
      service.markToldAnotherWay(patNotice, { note: 'Phoned' }, supportId)
    );
    expect([aside.statusCode, aside.context?.code]).toEqual([
      409,
      'FEE_NOTICE_NOT_NEEDED',
    ]);

    const off = await rise({ voidedAt: NOW, voidReason: 'cancelled' });
    const [ray] = await people(1);
    const offNotice = await notice(
      off.changeId,
      off.organizationId,
      ray as string,
      FAILED
    );
    const cancelled = await failureOf(
      service.markToldAnotherWay(offNotice, { note: 'Phoned' }, supportId)
    );
    expect([cancelled.statusCode, cancelled.context?.code]).toEqual([
      409,
      'FEE_CHANGE_NOT_WAITING',
    ]);
    expect(cancelled.context).toMatchObject({ voidReason: 'cancelled' });

    for (const id of [followUp, crypto.randomUUID()]) {
      const missing = await failureOf(
        service.markToldAnotherWay(id, { note: 'Phoned' }, supportId)
      );
      expect(missing.statusCode).toBe(404);
    }
  });

  it('two marks of one person at once: the second waits for the first, then answers 409, never a second mark', async () => {
    const { organizationId, changeId } = await rise();
    const [sam, tia] = await people(2);
    const samNotice = await notice(
      changeId,
      organizationId,
      sam as string,
      FAILED
    );
    await notice(changeId, organizationId, tia as string, FAILED);

    let blocked = false;
    let second: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      // The "first mark", in flight: the change locked, the notice marked.
      await tx
        .select({ id: feeChanges.id })
        .from(feeChanges)
        .where(eq(feeChanges.id, changeId))
        .for('update');
      const [pidRow] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`))
        .rows as Array<{ pid: number }>;
      await tx
        .update(feeChangeNotices)
        .set({
          state: 'told_another_way',
          toldNote: 'First',
          toldByUserId: supportId,
          toldAt: NOW,
        })
        .where(eq(feeChangeNotices.id, samNotice));

      second = service
        .markToldAnotherWay(samNotice, { note: 'Second' }, supportId)
        .catch((error: unknown) => error);
      // Probe, never sleep: wait until Postgres reports the second mark
      // blocked by this transaction's backend.
      for (let i = 0; i < 100 && !blocked; i++) {
        const probe = await db.execute(
          sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pidRow?.pid ?? 0} = ANY(pg_blocking_pids(pid))`
        );
        blocked = ((probe.rows[0] as { n: number } | undefined)?.n ?? 0) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
    });

    expect(blocked).toBe(true);
    const outcome = (await second) as ServiceError;
    expect(outcome).toBeInstanceOf(ServiceError);
    expect(outcome.context?.code).toBe('FEE_NOTICE_ALREADY_TOLD');
    const [row] = await db
      .select({ note: feeChangeNotices.toldNote })
      .from(feeChangeNotices)
      .where(eq(feeChangeNotices.id, samNotice));
    expect(row?.note).toBe('First');
  });
});
