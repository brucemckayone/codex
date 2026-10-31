/**
 * The daily fee step (Codex-2hxff.33; batch C1 Part B data design §1.5;
 * owner decisions F4, F8, Q1, Q4).
 *
 * Database-backed (this worker's `.dev.vars.test` database) over a
 * WebSocket client, as the step runs: making a list and dating a rise are
 * transactions, and the claim is FOR UPDATE SKIP LOCKED, so a mocked
 * database would prove nothing. The mailer is injected. Each test makes its
 * own organisation and rise and runs the step on that change alone
 * (`onlyChanges`): the step otherwise reads every change in a database other
 * suites share. Everything is deleted in afterAll.
 */

import { env } from 'cloudflare:test';
import {
  createPerRequestDbClient,
  type DatabaseWs,
  eq,
  inArray,
} from '@codex/database';
import {
  emailAuditLogs,
  feeChangeNotices,
  feeChanges,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import {
  dbFeeVersionReader,
  feeRiseStartAfter,
  resolveFeesAt,
} from '@codex/payments';
import type { Bindings } from '@codex/shared-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FEE_RULE_SENTENCE, formatPercent } from '../fee-notice-copy';
import {
  type FeeMailerParams,
  type FeeNoticeDelivery,
  runFeeNoticesSweep,
} from '../fee-notices-sweep';

// 3 and 4 Nov 2026, 08:00 London (GMT): two mornings' runs.
const NOV_3 = new Date('2026-11-03T08:00:00Z');
const NOV_4 = new Date('2026-11-04T08:00:00Z');

describe('runFeeNoticesSweep', { timeout: 60_000 }, () => {
  let db: DatabaseWs;
  let cleanup: () => Promise<void>;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const logIds: string[] = [];

  const obsLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const obs = obsLog as unknown as ObservabilityClient;

  beforeAll(() => {
    ({ db, cleanup } = createPerRequestDbClient(env as unknown as Bindings));
  });

  afterAll(async () => {
    if (logIds.length > 0) {
      await db.delete(emailAuditLogs).where(inArray(emailAuditLogs.id, logIds));
    }
    if (orgIds.length > 0) {
      // Versions and notices cascade with their change.
      await db
        .delete(feeChanges)
        .where(inArray(feeChanges.organizationId, orgIds));
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await cleanup();
  });

  async function person(name: string): Promise<{ id: string; email: string }> {
    const id = `feestep-${suffix}-${userIds.length}`;
    const email = `${id}@example.test`;
    await db.insert(users).values({ id, name, email });
    userIds.push(id);
    return { id, email };
  }

  /** An organisation and its creators. */
  async function organisation(...creators: string[]): Promise<string> {
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'Hollow Oak Films',
        slug: `feestep-${suffix}-${orgIds.length}`,
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error('org not inserted');
    orgIds.push(org.id);
    await join(org.id, ...creators);
    return org.id;
  }

  async function join(organizationId: string, ...creators: string[]) {
    if (creators.length === 0) return;
    await db.insert(organizationMemberships).values(
      creators.map((userId) => ({
        organizationId,
        userId,
        role: 'creator' as const,
      }))
    );
  }

  /**
   * A waiting rise in the organisation's fee to 15%: a rise on one-off sales
   * (10% by default), where subscriptions are 15% already.
   */
  async function rise(organizationId: string): Promise<string> {
    const [change] = await db
      .insert(feeChanges)
      .values({ scope: 'org', organizationId, kind: 'rise' })
      .returning({ id: feeChanges.id });
    if (!change) throw new Error('change not inserted');
    await db.insert(feeConfigVersions).values({
      changeId: change.id,
      scope: 'org',
      orgFeePercent: 1500,
    });
    return change.id;
  }

  /** The mailer, answering per person; everyone else is accepted. */
  function mailerAnswering(answers: Record<string, FeeNoticeDelivery> = {}) {
    return vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> =>
        answers[params.userId] ?? { accepted: true }
    );
  }

  function run(
    changeId: string,
    now: Date,
    mailer: ReturnType<typeof mailerAnswering>,
    templateExists: (name: string) => Promise<boolean> = async () => true
  ) {
    return runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now,
      mailer,
      templateExists,
      onlyChanges: [changeId],
    });
  }

  const mailFor = (
    mailer: ReturnType<typeof mailerAnswering>,
    userId: string
  ) =>
    mailer.mock.calls
      .map((c) => c[0] as FeeMailerParams)
      .filter((p) => p.userId === userId);

  const noticeOf = async (changeId: string, userId: string) => {
    const rows = await db
      .select()
      .from(feeChangeNotices)
      .where(eq(feeChangeNotices.changeId, changeId));
    return rows.find((n) => n.userId === userId);
  };

  const changeOf = async (changeId: string) => {
    const [row] = await db
      .select()
      .from(feeChanges)
      .where(eq(feeChanges.id, changeId));
    return row;
  };

  const alertsNaming = (userId: string) =>
    obsLog.error.mock.calls.filter(
      ([message, context]) =>
        String(message).startsWith('fee step: people not yet told') &&
        (context as { named: Array<{ userId: string }> }).named.some(
          (n) => n.userId === userId
        )
    );

  it('lists everyone the rise pays less, and starts the 30 days only once every email is accepted (F4)', async () => {
    const maya = await person('Maya Okafor');
    const tom = await person('Tom Hale');
    const changeId = await rise(await organisation(maya.id, tom.id));

    const first = mailerAnswering({
      [tom.id]: { accepted: false, status: 400 },
    });
    const day1 = await run(changeId, NOV_3, first);

    expect(day1).toMatchObject({ listsMade: 1, listed: 2, sent: 1, failed: 1 });
    expect(await changeOf(changeId)).toMatchObject({
      firstRunAt: NOV_3,
      listedCount: 2,
      effectiveFrom: null,
    });
    const mayaNotice = await noticeOf(changeId, maya.id);
    expect(mayaNotice).toMatchObject({
      onList: true,
      state: 'sent',
      acceptedAt: NOV_3,
      quotedFrom: '2026-12-04',
    });
    const [mail, ...more] = mailFor(first, maya.id);
    expect(more).toEqual([]);
    // Q1: the earliest date it can start, and the rule that it only moves later.
    expect(mail).toMatchObject({
      to: maya.email,
      templateName: 'fee-change-notice',
      category: 'transactional',
      data: {
        userName: 'Maya Okafor',
        subjectLine: 'The fees on your sales are changing from 4 December 2026',
        effectiveDate: '4 December 2026',
        ruleSentence: FEE_RULE_SENTENCE,
        feeNoticeId: mayaNotice?.id,
      },
    });
    expect(await noticeOf(changeId, tom.id)).toMatchObject({
      state: 'failed',
      lastReason: 'refused',
      attempts: 1,
    });
    expect(alertsNaming(tom.id)).toHaveLength(1);

    // The next morning Tom's email goes: the rise is dated from it.
    const second = mailerAnswering();
    const day2 = await run(changeId, NOV_4, second);
    expect(day2).toMatchObject({ listsMade: 0, sent: 1, dated: 1 });
    expect(mailFor(second, maya.id)).toEqual([]);
    expect(await noticeOf(changeId, tom.id)).toMatchObject({
      state: 'sent',
      acceptedAt: NOV_4,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(NOV_4)
    );
    expect(feeRiseStartAfter(NOV_4).toISOString()).toBe(
      '2026-12-05T00:00:00.000Z'
    );
  });

  it('a joiner is told the same date, and their failed email never holds it (F8, Q4)', async () => {
    const ana = await person('Ana Ruiz');
    const org = await organisation(ana.id);
    const changeId = await rise(org);
    await run(
      changeId,
      NOV_3,
      mailerAnswering({ [ana.id]: { accepted: false, status: 422 } })
    );

    const joiner = await person('Joe Park');
    await join(org, joiner.id);
    const mailer = mailerAnswering({
      [joiner.id]: { accepted: false, skipped: 'unsubscribed' },
    });
    const day2 = await run(changeId, NOV_4, mailer);

    expect(day2).toMatchObject({
      joinersAdded: 1,
      sent: 1,
      failed: 1,
      dated: 1,
    });
    expect(await noticeOf(changeId, joiner.id)).toMatchObject({
      onList: false,
      state: 'failed',
      lastReason: 'skipped',
    });
    const [welcome] = mailFor(mailer, joiner.id);
    expect(welcome?.data.leadSentence).toMatch(/^You’ve joined while a rise/);
    // Dated by Ana alone: the joiner's failure moved nothing.
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(NOV_4)
    );
    // Q4: a joiner whose email failed is still named for support.
    expect(alertsNaming(joiner.id).length).toBeGreaterThan(0);
  });

  it('an unknown send found in the email log counts as told then, and is not resent', async () => {
    const lee = await person('Lee Chan');
    const changeId = await rise(await organisation(lee.id));
    await run(
      changeId,
      NOV_3,
      mailerAnswering({ [lee.id]: { accepted: false, status: 503 } })
    );
    const notice = await noticeOf(changeId, lee.id);
    expect(notice).toMatchObject({ state: 'unknown', lastReason: 'unknown' });

    // It went after all: the send's own log line, minutes later.
    const loggedAt = new Date(NOV_3.getTime() + 2 * 60 * 1000);
    const [log] = await db
      .insert(emailAuditLogs)
      .values({
        templateName: 'fee-change-notice',
        recipientEmail: lee.email,
        status: 'success',
        metadata: JSON.stringify({ feeNoticeId: notice?.id }),
        createdAt: loggedAt,
        updatedAt: loggedAt,
      })
      .returning({ id: emailAuditLogs.id });
    if (log) logIds.push(log.id);

    const mailer = mailerAnswering();
    const day2 = await run(changeId, NOV_4, mailer);
    expect(day2).toMatchObject({ foundInLog: 1, sent: 0, dated: 1 });
    expect(mailFor(mailer, lee.id)).toEqual([]);
    expect(await noticeOf(changeId, lee.id)).toMatchObject({
      state: 'sent',
      acceptedAt: loggedAt,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(loggedAt)
    );
  });

  it('someone no longer paid less before they are told is set aside, and the rise goes ahead without them', async () => {
    const sam = await person('Sam Ito');
    const kim = await person('Kim Roe');
    const org = await organisation(sam.id, kim.id);
    const changeId = await rise(org);
    await run(
      changeId,
      NOV_3,
      mailerAnswering({ [kim.id]: { accepted: false, status: 400 } })
    );

    // Kim's own organisation fee, set before she was told: 0%.
    const [own] = await db
      .insert(feeChanges)
      .values({
        scope: 'creator',
        organizationId: org,
        creatorId: kim.id,
        kind: 'cut',
        effectiveFrom: new Date(0),
      })
      .returning({ id: feeChanges.id });
    if (!own) throw new Error('override not inserted');
    await db.insert(feeConfigVersions).values({
      changeId: own.id,
      scope: 'creator',
      orgFeePercent: 0,
    });

    const mailer = mailerAnswering();
    const day2 = await run(changeId, NOV_4, mailer);
    expect(day2).toMatchObject({ notNeeded: 1, sent: 0, dated: 1 });
    expect(mailFor(mailer, kim.id)).toEqual([]);
    // Set aside before the send step tries her again (one try, day 1's).
    expect(await noticeOf(changeId, kim.id)).toMatchObject({
      state: 'not_needed',
      attempts: 1,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(NOV_3)
    );
  });

  it('a cancellation email goes, and after three failed mornings it is dropped, never held', async () => {
    const ivy = await person('Ivy Moss');
    const rob = await person('Rob Dunn');
    const org = await organisation(ivy.id, rob.id);
    const changeId = await rise(org);
    await db
      .update(feeChanges)
      .set({
        firstRunAt: NOV_3,
        listedCount: 2,
        voidedAt: NOV_3,
        voidReason: 'cancelled',
      })
      .where(eq(feeChanges.id, changeId));
    const read = dbFeeVersionReader(db);
    const role = { organizationId: org, as: 'creator' as const };
    const now = {
      ...role,
      oneOff: await resolveFeesAt(read, {
        organizationId: org,
        creatorId: ivy.id,
        ctx: 'one_off',
        at: NOV_4,
      }),
      subscription: await resolveFeesAt(read, {
        organizationId: org,
        creatorId: ivy.id,
        ctx: 'subscription',
        at: NOV_4,
      }),
    };
    const toldAfter = {
      ...now,
      oneOff: { ...now.oneOff, orgFeePercent: now.oneOff.orgFeePercent + 500 },
    };
    const cancelled = {
      changeId,
      kind: 'cancelled' as const,
      onList: true,
      roles: [role],
      beforeValues: [now],
      afterValues: [toldAfter],
      quotedFrom: '2026-12-04',
    };
    await db.insert(feeChangeNotices).values([
      { ...cancelled, userId: ivy.id },
      { ...cancelled, userId: rob.id, state: 'failed', attempts: 3 },
    ]);

    const mailer = mailerAnswering();
    const result = await run(changeId, NOV_4, mailer);
    expect(result).toMatchObject({ sent: 1, dropped: 1 });

    const [mail, ...more] = mailFor(mailer, ivy.id);
    expect(more).toEqual([]);
    expect(mail?.templateName).toBe('fee-change-cancelled');
    expect(mail?.data).toMatchObject({
      changeSentence:
        'the fees on your sales would rise from 4 December 2026. We’ve cancelled that rise.',
      keptLines: `Hollow Oak Films’ share of your sales on sales and courses: stays at ${formatPercent(now.oneOff.orgFeePercent)}.`,
    });
    expect(mailFor(mailer, rob.id)).toEqual([]);
    expect(
      await db
        .select({ state: feeChangeNotices.state })
        .from(feeChangeNotices)
        .where(eq(feeChangeNotices.userId, rob.id))
    ).toEqual([{ state: 'not_needed' }]);
    // A follow-up is never support's to chase.
    expect(alertsNaming(rob.id)).toEqual([]);
  });

  it('a missing template holds its emails, untried, and the rise keeps waiting', async () => {
    const zoe = await person('Zoe Lane');
    const changeId = await rise(await organisation(zoe.id));
    const mailer = mailerAnswering();
    const result = await run(
      changeId,
      NOV_3,
      mailer,
      async (name) => name !== 'fee-change-notice'
    );

    expect(result).toMatchObject({ listsMade: 1, sent: 0, dated: 0 });
    expect(result.skippedTemplates).toEqual(['fee-change-notice']);
    expect(mailer).not.toHaveBeenCalled();
    expect(await noticeOf(changeId, zoe.id)).toMatchObject({
      state: 'due',
      attempts: 0,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toBeNull();
  });
});
