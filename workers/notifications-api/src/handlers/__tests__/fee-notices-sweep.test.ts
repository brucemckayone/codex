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
  and,
  createPerRequestDbClient,
  type DatabaseWs,
  eq,
  inArray,
  type SQL,
  sql,
  TEST_SEND_METADATA,
} from '@codex/database';
import {
  emailAuditLogs,
  feeChangeNotices,
  feeChanges,
  feeConfigAuditLog,
  feeConfigOrg,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import {
  affectedPayees,
  dbFeeVersionReader,
  feeRiseStartAfter,
  lockFeeLevel,
  lockFeeNotices,
  queueSmallerFeeNotices,
  readFeeVersionsByLevel,
  resolveFeesAt,
} from '@codex/payments';
import type { Bindings } from '@codex/shared-types';
import { createServiceRegistry } from '@codex/worker-utils';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FEE_RULE_SENTENCE, formatPercent } from '../fee-notice-copy';
import {
  type FeeMailerParams,
  type FeeNoticeDelivery,
  runFeeNoticesSweep,
} from '../fee-notices-sweep';
import { SENDS_TIME_BUDGET_MS } from '../send-limits';

// Who a rise affects, and the fee levels a batch reads: real unless a test
// makes one read fail.
vi.mock('@codex/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/payments')>();
  return {
    ...actual,
    affectedPayees: vi.fn(actual.affectedPayees),
    readFeeVersionsByLevel: vi.fn(actual.readFeeVersionsByLevel),
  };
});
const {
  affectedPayees: realAffectedPayees,
  readFeeVersionsByLevel: realReadFeeVersionsByLevel,
} = await vi.importActual<typeof import('@codex/payments')>('@codex/payments');

// 3, 4 and 5 Nov 2026, 08:00 London (GMT): the mornings' runs.
const NOV_3 = new Date('2026-11-03T08:00:00Z');
const NOV_4 = new Date('2026-11-04T08:00:00Z');
const NOV_5 = new Date('2026-11-05T08:00:00Z');

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

  afterEach(() => {
    vi.mocked(affectedPayees).mockImplementation(realAffectedPayees);
    vi.mocked(readFeeVersionsByLevel).mockImplementation(
      realReadFeeVersionsByLevel
    );
  });

  /** The next by-level fee read made on the step's own client fails. */
  function failOneLevelRead() {
    let failed = false;
    vi.mocked(readFeeVersionsByLevel).mockImplementation((client, ...rest) => {
      if (!failed && client === db) {
        failed = true;
        return Promise.reject(new Error('version read timed out'));
      }
      return realReadFeeVersionsByLevel(client, ...rest);
    });
  }

  /**
   * The next read of who a rise affects made on the step's own client fails
   * (a list is made in a transaction, so it reads on another).
   */
  function failOnePayeeRead() {
    let failed = false;
    vi.mocked(affectedPayees).mockImplementation((client, ...rest) => {
      if (!failed && client === db) {
        failed = true;
        return Promise.reject(new Error('payee read timed out'));
      }
      return realAffectedPayees(client, ...rest);
    });
  }

  const errorsFor = (changeId: string, startsWith: string) =>
    obsLog.error.mock.calls.filter(
      ([message, context]) =>
        String(message).startsWith(startsWith) &&
        (context as { changeId?: string }).changeId === changeId
    );

  /** Every warning logged about one notice, in order. */
  const warningsFor = (feeNoticeId: string | undefined) =>
    obsLog.warn.mock.calls
      .filter(
        ([, context]) =>
          (context as { feeNoticeId?: string }).feeNoticeId === feeNoticeId
      )
      .map(([message]) => message);

  afterAll(async () => {
    if (logIds.length > 0) {
      await db.delete(emailAuditLogs).where(inArray(emailAuditLogs.id, logIds));
    }
    if (orgIds.length > 0) {
      // The fee writes' audit rows: an org's removal would null their scope,
      // which their CHECK refuses, and they name the writer.
      await db
        .delete(feeConfigAuditLog)
        .where(inArray(feeConfigAuditLog.scopeOrgId, orgIds));
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

    // A person is needed: one alert a run, naming the rise that waits.
    const alerts = () =>
      obsLog.error.mock.calls.filter(
        ([message, context]) =>
          String(message).startsWith('fee step: template missing') &&
          (context as { changeIds: string[] }).changeIds.includes(changeId)
      );
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      templateName: 'fee-change-notice',
    });
    await run(
      changeId,
      NOV_4,
      mailer,
      async (name) => name !== 'fee-change-notice'
    );
    expect(alerts()).toHaveLength(2);
  });

  it('reads every recipient in one query, however many it sends', async () => {
    const ada = await person('Ada Moss');
    const ben = await person('Ben Cole');
    const cy = await person('Cy Park');
    const changeId = await rise(await organisation(ada.id, ben.id, cy.id));
    // The client, counting reads of people's addresses.
    let addressReads = 0;
    const counting = new Proxy(db, {
      get(target, prop) {
        if (prop === 'select') {
          return (fields?: Record<string, unknown>) => {
            if (fields?.email === users.email) addressReads += 1;
            return (target.select as (f?: unknown) => unknown).call(
              target,
              fields
            );
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const mailer = mailerAnswering();

    const result = await runFeeNoticesSweep({
      db: counting,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_3,
      mailer,
      templateExists: async () => true,
      onlyChanges: [changeId],
    });

    expect(result).toMatchObject({ listed: 3, sent: 3 });
    expect(mailer.mock.calls.map(([params]) => params.to).sort()).toEqual(
      [ada.email, ben.email, cy.email].sort()
    );
    expect(addressReads).toBe(1);
  });

  it('starts no send batch once the budget is spent: the rest go back untouched, go the next morning, and the alert still runs', async () => {
    // Nine people: a batch of eight, then one.
    const everyone: Array<{ id: string; email: string }> = [];
    for (const name of ['Ann', 'Bo', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus']) {
      everyone.push(await person(`${name} Budget`));
    }
    everyone.push(await person('Hal Budget'), await person('Ivy Budget'));
    const changeId = await rise(
      await organisation(...everyone.map((p) => p.id))
    );
    // The budget is spent during the first batch, whose first email fails.
    let clockMs = 0;
    let refused: string | undefined;
    const mailer = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        clockMs = SENDS_TIME_BUDGET_MS;
        if (refused) return { accepted: true };
        refused = params.userId;
        return { accepted: false, status: 400 };
      }
    );

    const day1 = await runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_3,
      mailer,
      templateExists: async () => true,
      clock: () => clockMs,
      onlyChanges: [changeId],
    });

    expect(day1).toMatchObject({
      listed: 9,
      sent: 7,
      failed: 1,
      givenBack: 1,
      dated: 0,
    });
    expect(mailer).toHaveBeenCalledTimes(8);
    const mailed = new Set(mailer.mock.calls.map(([p]) => p.userId));
    const [unsent, ...others] = everyone.filter((p) => !mailed.has(p.id));
    expect(others).toEqual([]);
    // Their claim is undone: no try spent, no time stamped.
    expect(await noticeOf(changeId, unsent?.id as string)).toMatchObject({
      state: 'due',
      attempts: 0,
      attemptedAt: null,
    });
    // The parts after the sends still ran: the alert names the refused one.
    expect(alertsNaming(refused as string)).toHaveLength(1);

    const day2 = await run(changeId, NOV_4, mailerAnswering());
    expect(day2).toMatchObject({ sent: 2, givenBack: 0, dated: 1 });
    expect(await noticeOf(changeId, unsent?.id as string)).toMatchObject({
      state: 'sent',
      attempts: 1,
      acceptedAt: NOV_4,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(NOV_4)
    );
  });

  it('one cause failing many notices names the first few and folds the rest into one alert', async () => {
    const ids: string[] = [];
    for (const name of ['Ann Roe', 'Bo Lee', 'Cal Fox', 'Dee Ash']) {
      ids.push((await person(name)).id);
    }
    const changeId = await rise(await organisation(...ids));
    // Thrown before its promise exists, so the send's own catch never sees
    // it: each notice fails as a database blip inside its send would.
    const mailer = vi.fn((): Promise<FeeNoticeDelivery> => {
      throw new Error('the send broke');
    });

    const result = await runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_3,
      mailer,
      templateExists: async () => true,
      onlyChanges: [changeId],
      alertNamed: 2,
    });

    expect(result).toMatchObject({ listed: 4, sent: 0, errors: 4 });
    expect(errorsFor(changeId, 'fee step: one notice failed')).toHaveLength(2);
    const folded = obsLog.error.mock.calls.filter(
      ([message, context]) =>
        String(message).startsWith('fee step: more notices failed') &&
        (context as { changeIds: string[] }).changeIds.includes(changeId)
    );
    expect(folded).toHaveLength(1);
    expect(folded[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      failed: 4,
      notNamed: 2,
    });
  });

  /** How a notice can fail, as the end alert counts the ones not named. */
  const FAILURE_KINDS = [
    'failed',
    'went',
    'mayHaveGone',
    'figuresUnread',
  ] as const;
  type FailureKind = (typeof FAILURE_KINDS)[number];
  type FoldedKind = { notices: number; changes: number; changeIds: string[] };

  it('past the named fifty, the end alert counts the rest by how they failed, each kind with its changes, so support knows which to check by hand (review final silent-delta2)', async () => {
    // Two rises, 29 people each: 58 notices, each failing once. The first
    // 50 failures are named one by one, and the last 8 fold.
    const changeOf = new Map<string, string>();
    for (const org of ['A', 'B']) {
      const ids: string[] = [];
      for (let i = 0; i < 29; i += 1) {
        ids.push((await person(`Fold ${org}${i}`)).id);
      }
      const changeId = await rise(await organisation(...ids));
      for (const id of ids) changeOf.set(id, changeId);
    }
    const changeIds = [...new Set(changeOf.values())];

    // Each send fails as its turn says: a refusal whose record fails ("one
    // notice failed"), an accepted or an unanswered send whose record fails,
    // or an accepted send whose figure read fails. The sends go one at a
    // time, a turn ending once its record has settled, so each fault is met
    // by its own notice and the failures come in turn order.
    const answers: Record<FailureKind, FeeNoticeDelivery> = {
      failed: { accepted: false, status: 422 },
      went: { accepted: true },
      mayHaveGone: { accepted: false, error: 'the send timed out' },
      figuresUnread: { accepted: true },
    };
    const faults = faultyClient();
    let endTurn: (() => void) | undefined;
    const client = new Proxy(faults.client, {
      get(inner, key) {
        const value = Reflect.get(inner, key, inner);
        if (key !== 'transaction') return value;
        const transaction: DatabaseWs['transaction'] = async (work, config) => {
          try {
            return await (value as DatabaseWs['transaction'])(work, config);
          } finally {
            // Once the failure it ends in is logged.
            const end = endTurn;
            endTurn = undefined;
            if (end) setTimeout(end, 0);
          }
        };
        return transaction;
      },
    });
    let turns = 0;
    let lastTurn: Promise<void> = Promise.resolve();
    const caused = new Map<FailureKind, Set<string>>();
    const mailer = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        const before = lastTurn;
        let end = () => {};
        lastTurn = new Promise((resolve) => {
          end = resolve;
        });
        await before;
        const kind = FAILURE_KINDS[turns % FAILURE_KINDS.length]!;
        turns += 1;
        if (turns > 50) {
          const ids = caused.get(kind) ?? new Set<string>();
          ids.add(changeOf.get(params.userId) ?? 'unknown change');
          caused.set(kind, ids);
        }
        endTurn = end;
        faults.arm(kind === 'figuresUnread' ? 'select' : 'transaction');
        return answers[kind];
      }
    );

    const result = await runFeeNoticesSweep({
      db: client,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_3,
      mailer,
      templateExists: async () => true,
      onlyChanges: changeIds,
    });

    expect(turns).toBe(58);
    expect(result).toMatchObject({ listed: 58, errors: 58 });
    const named = changeIds.flatMap((id) => [
      ...errorsFor(id, 'fee step: one notice failed'),
      ...errorsFor(id, 'fee step: a fee email went, or may have'),
    ]);
    expect(named).toHaveLength(50);
    const alerts = obsLog.error.mock.calls.filter(
      ([message, context]) =>
        String(message).startsWith('fee step: more notices failed') &&
        changeIds.some((id) =>
          (context as { changeIds: string[] }).changeIds.includes(id)
        )
    );
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]?.[1] as {
      failed: number;
      notNamed: number;
      byKind?: Record<string, FoldedKind>;
    };
    expect(alert).toMatchObject({ failed: 58, notNamed: 8 });
    // Turns 51 to 58 fold: two of each kind, each named with its changes.
    const sortedIds = (byKind: Record<string, FoldedKind>) =>
      Object.fromEntries(
        Object.entries(byKind).map(([kind, folded]) => [
          kind,
          { ...folded, changeIds: [...folded.changeIds].sort() },
        ])
      );
    expect(sortedIds(alert.byKind ?? {})).toEqual(
      Object.fromEntries(
        FAILURE_KINDS.map((kind) => {
          const ids = [...(caused.get(kind) ?? [])].sort();
          return [kind, { notices: 2, changes: ids.length, changeIds: ids }];
        })
      )
    );
  });

  /**
   * A rise cancelled after its email: each person was told on 3 November,
   * and their cancellation email is due.
   */
  async function cancelledFor(
    organizationId: string,
    ...people: string[]
  ): Promise<string> {
    const changeId = await rise(organizationId);
    await db
      .update(feeChanges)
      .set({
        firstRunAt: NOV_3,
        listedCount: people.length,
        voidedAt: NOV_3,
        voidReason: 'cancelled',
      })
      .where(eq(feeChanges.id, changeId));
    const read = dbFeeVersionReader(db);
    const at = { organizationId, creatorId: people[0], at: NOV_4 };
    const role = { organizationId, as: 'creator' as const };
    const now = {
      ...role,
      oneOff: await resolveFeesAt(read, { ...at, ctx: 'one_off' }),
      subscription: await resolveFeesAt(read, { ...at, ctx: 'subscription' }),
    };
    const told = {
      changeId,
      onList: true,
      roles: [role],
      beforeValues: [now],
      afterValues: [
        {
          ...now,
          oneOff: {
            ...now.oneOff,
            orgFeePercent: now.oneOff.orgFeePercent + 500,
          },
        },
      ],
      quotedFrom: '2026-12-04',
    };
    await db.insert(feeChangeNotices).values(
      people.flatMap((userId) => [
        {
          ...told,
          userId,
          kind: 'announce' as const,
          state: 'sent' as const,
          acceptedAt: NOV_3,
        },
        { ...told, userId, kind: 'cancelled' as const },
      ])
    );
    return changeId;
  }

  it('reads what the follow-ups need once for the batch, however many it sends', async () => {
    const ids: string[] = [];
    for (const name of ['Eve Hart', 'Finn Shaw', 'Gus Lane']) {
      ids.push((await person(name)).id);
    }
    const changeId = await cancelledFor(await organisation(...ids), ...ids);
    // The client, counting announcement reads and fee-version reads.
    let announceReads = 0;
    let versionReads = 0;
    const counting = new Proxy(db, {
      get(target, prop) {
        if (prop === 'select') {
          return (fields?: Record<string, unknown>) => {
            if (
              fields?.acceptedAt === feeChangeNotices.acceptedAt &&
              fields?.toldAt === feeChangeNotices.toldAt
            ) {
              announceReads += 1;
            }
            if (
              fields?.platformFeePercent ===
              feeConfigVersions.platformFeePercent
            ) {
              versionReads += 1;
            }
            return (target.select as (f?: unknown) => unknown).call(
              target,
              fields
            );
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const mailer = mailerAnswering();

    const result = await runFeeNoticesSweep({
      db: counting,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_4,
      mailer,
      templateExists: async () => true,
      onlyChanges: [changeId],
    });

    expect(result).toMatchObject({ sent: 3 });
    expect(announceReads).toBe(1);
    // The platform, the organisation and the creators' overrides: one each.
    expect(versionReads).toBe(3);
    for (const id of ids) {
      expect(mailFor(mailer, id)[0]?.data.announcedOn).toMatch(/3 November/);
    }
  });

  it('a failed read of what the follow-ups need gives them back untried, with one alert; announcements still go', async () => {
    const hal = await person('Hal Webb');
    const ida = await person('Ida Rae');
    const cancelledId = await cancelledFor(await organisation(hal.id), hal.id);
    const riseId = await rise(await organisation(ida.id));
    failOneLevelRead();
    const mailer = mailerAnswering();

    const result = await runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_4,
      mailer,
      templateExists: async () => true,
      onlyChanges: [cancelledId, riseId],
    });

    expect(result).toMatchObject({ sent: 1, givenBack: 1 });
    expect(mailFor(mailer, ida.id)).toHaveLength(1);
    expect(mailFor(mailer, hal.id)).toEqual([]);
    const [cancellation] = await db
      .select()
      .from(feeChangeNotices)
      .where(
        and(
          eq(feeChangeNotices.changeId, cancelledId),
          eq(feeChangeNotices.kind, 'cancelled')
        )
      );
    expect(cancellation).toMatchObject({
      state: 'due',
      attempts: 0,
      attemptedAt: null,
    });
    const alerts = obsLog.error.mock.calls.filter(
      ([message, context]) =>
        String(message).startsWith(
          'fee step: could not read what the follow-up emails need'
        ) &&
        (context as { changeIds: string[] }).changeIds.includes(cancelledId)
    );
    expect(alerts).toHaveLength(1);
  });

  it('a send that outlasts its timeout is unknown, so the next run checks the email log first', async () => {
    const kim = await person('Kim Slow');
    const changeId = await rise(await organisation(kim.id));
    // notifications-api answering after 2 s, unless the request is aborted.
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        if (!String(input).startsWith('http://notifications.test/')) {
          return realFetch(input, init);
        }
        return new Promise<Response>((resolve, reject) => {
          const answered = setTimeout(
            () => resolve(Response.json({ data: { success: true } })),
            2_000
          );
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(answered);
            reject(init.signal?.reason);
          });
        });
      });
    try {
      const result = await runFeeNoticesSweep({
        db,
        obs,
        environment: 'development',
        workerSecret: 'test-secret',
        notificationsUrl: 'http://notifications.test',
        now: NOV_3,
        sendTimeoutMs: 50,
        templateExists: async () => true,
        onlyChanges: [changeId],
      });

      expect(result).toMatchObject({ sent: 0, unknown: 1 });
      expect(
        fetchSpy.mock.calls.filter(([input]) =>
          String(input).startsWith('http://notifications.test/')
        )
      ).toHaveLength(1);
      expect(await noticeOf(changeId, kim.id)).toMatchObject({
        state: 'unknown',
        lastReason: 'unknown',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('a rise whose date has come goes into the old fee row, once; one dated tomorrow waits for its morning', async () => {
    const SAVED = new Date('2026-09-01T10:00:00Z');
    /**
     * An organisation at 10% since 1970, its old row saying so (written when
     * the rise was saved), and a rise to 15% dated `from`.
     */
    async function datedRise(from: Date) {
      const organizationId = await organisation();
      const [cut] = await db
        .insert(feeChanges)
        .values({
          scope: 'org',
          organizationId,
          kind: 'cut',
          effectiveFrom: new Date(0),
        })
        .returning({ id: feeChanges.id });
      await db.insert(feeConfigVersions).values({
        changeId: cut?.id as string,
        scope: 'org',
        orgFeePercent: 1000,
      });
      const [rise] = await db
        .insert(feeChanges)
        .values({
          scope: 'org',
          organizationId,
          kind: 'rise',
          firstRunAt: SAVED,
          listedCount: 0,
          effectiveFrom: from,
        })
        .returning({ id: feeChanges.id });
      await db.insert(feeConfigVersions).values({
        changeId: rise?.id as string,
        scope: 'org',
        orgFeePercent: 1500,
      });
      await db.insert(feeConfigOrg).values({
        organizationId,
        orgFeePercent: 1000,
        version: 1,
        updatedAt: SAVED,
      });
      return { organizationId, changeId: rise?.id as string };
    }
    const oldRow = async (organizationId: string) => {
      const [row] = await db
        .select()
        .from(feeConfigOrg)
        .where(eq(feeConfigOrg.organizationId, organizationId));
      return row;
    };
    // NOV_3 is 08:00 on 3 November: one rise started at midnight, one starts
    // at the next.
    const begun = await datedRise(new Date('2026-11-03T00:00:00Z'));
    const coming = await datedRise(new Date('2026-11-04T00:00:00Z'));
    const both = (now: Date) =>
      runFeeNoticesSweep({
        db,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now,
        mailer: mailerAnswering(),
        templateExists: async () => true,
        onlyChanges: [begun.changeId, coming.changeId],
      });

    expect(await both(NOV_3)).toMatchObject({ mirrored: 1, errors: 0 });
    expect(await oldRow(begun.organizationId)).toMatchObject({
      orgFeePercent: 1500,
      version: 2,
      updatedAt: NOV_3,
      updatedBy: null,
    });
    expect(await oldRow(coming.organizationId)).toMatchObject({
      orgFeePercent: 1000,
      version: 1,
      updatedAt: SAVED,
    });

    // Again the same morning: nothing to do.
    expect(await both(NOV_3)).toMatchObject({ mirrored: 0, errors: 0 });
    expect((await oldRow(begun.organizationId))?.version).toBe(2);

    // The next morning the other has begun.
    expect(await both(NOV_4)).toMatchObject({ mirrored: 1, errors: 0 });
    expect(await oldRow(coming.organizationId)).toMatchObject({
      orgFeePercent: 1500,
      version: 2,
      updatedAt: NOV_4,
    });
    expect((await oldRow(begun.organizationId))?.version).toBe(2);
  });

  it('one failed read of who a rise affects is one alert, and its claims go back untried', async () => {
    const una = await person('Una Read');
    const vic = await person('Vic Read');
    const changeId = await rise(await organisation(una.id, vic.id));
    failOnePayeeRead();
    const mailer = mailerAnswering();

    const day1 = await run(changeId, NOV_3, mailer);

    expect(day1).toMatchObject({ listed: 2, sent: 0, givenBack: 2 });
    expect(mailer).not.toHaveBeenCalled();
    expect(
      errorsFor(changeId, 'fee step: could not read who a fee rise affects')
    ).toHaveLength(1);
    expect(errorsFor(changeId, 'fee step: one notice failed')).toEqual([]);
    for (const who of [una, vic]) {
      expect(await noticeOf(changeId, who.id)).toMatchObject({
        state: 'due',
        attempts: 0,
        attemptedAt: null,
      });
    }

    // The next morning they go.
    expect(await run(changeId, NOV_4, mailerAnswering())).toMatchObject({
      sent: 2,
      givenBack: 0,
    });
  });

  it('a failed read is not kept: after the joiners step misses it, the sends read again', async () => {
    const wes = await person('Wes Read');
    const xia = await person('Xia Read');
    const changeId = await rise(await organisation(wes.id, xia.id));
    await run(
      changeId,
      NOV_3,
      mailerAnswering({
        [wes.id]: { accepted: false, status: 400 },
        [xia.id]: { accepted: false, status: 400 },
      })
    );
    failOnePayeeRead();

    const day2 = await run(changeId, NOV_4, mailerAnswering());

    expect(
      errorsFor(changeId, 'fee step: joiners could not be added')
    ).toHaveLength(1);
    expect(day2).toMatchObject({ sent: 2, givenBack: 0 });
    expect(
      errorsFor(changeId, 'fee step: could not read who a fee rise affects')
    ).toEqual([]);
  });

  it('a send with no answer is not alerted while the mornings can mend it; its third morning is', async () => {
    const kit = await person('Kit Quiet');
    const changeId = await rise(await organisation(kit.id));
    const noAnswer = mailerAnswering({
      [kit.id]: { accepted: false, status: 503 },
    });

    await run(changeId, NOV_3, noAnswer);
    expect(await noticeOf(changeId, kit.id)).toMatchObject({
      state: 'unknown',
      attempts: 1,
    });
    expect(alertsNaming(kit.id)).toEqual([]);

    await run(changeId, NOV_4, noAnswer);
    expect(alertsNaming(kit.id)).toEqual([]);

    await run(changeId, new Date('2026-11-05T08:00:00Z'), noAnswer);
    expect(await noticeOf(changeId, kit.id)).toMatchObject({
      state: 'unknown',
      attempts: 3,
    });
    expect(alertsNaming(kit.id)).toHaveLength(1);
  });

  it('a joiner with no answer is alerted at once when the rise starts too soon for more mornings', async () => {
    const lia = await person('Lia Dated');
    const org = await organisation(lia.id);
    const changeId = await rise(org);
    // Lia is told on 3 November: the rise starts on 4 December.
    await run(changeId, NOV_3, mailerAnswering());
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      new Date('2026-12-04T00:00:00Z')
    );
    const noAnswer = (userId: string) =>
      mailerAnswering({ [userId]: { accepted: false, status: 503 } });

    // A joiner a fortnight before: their mornings can still mend it.
    const early = await person('Mo Early');
    await join(org, early.id);
    await run(changeId, new Date('2026-11-20T08:00:00Z'), noAnswer(early.id));
    expect(await noticeOf(changeId, early.id)).toMatchObject({
      state: 'unknown',
      attempts: 1,
    });
    expect(alertsNaming(early.id)).toEqual([]);

    // A joiner two days before: a person is needed now.
    const late = await person('Nia Late');
    await join(org, late.id);
    await run(changeId, new Date('2026-12-02T08:00:00Z'), noAnswer(late.id));
    expect(await noticeOf(changeId, late.id)).toMatchObject({
      state: 'unknown',
      attempts: 1,
    });
    expect(alertsNaming(late.id)).toHaveLength(1);
  });

  it('the send budget counts from the wake: spent by the sweeps before, the claims go back and the alert still runs', async () => {
    const ora = await person('Ora Wake');
    const changeId = await rise(await organisation(ora.id));
    await run(
      changeId,
      NOV_3,
      mailerAnswering({ [ora.id]: { accepted: false, status: 400 } })
    );
    expect(alertsNaming(ora.id)).toHaveLength(1);
    const mailer = mailerAnswering();
    const now = Date.now();

    const day2 = await runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_4,
      mailer,
      templateExists: async () => true,
      clock: () => now,
      // The agreement and money sweeps took the whole budget.
      wakeStartedAt: now - SENDS_TIME_BUDGET_MS,
      onlyChanges: [changeId],
    });

    expect(day2).toMatchObject({ sent: 0, givenBack: 1 });
    expect(mailer).not.toHaveBeenCalled();
    expect(await noticeOf(changeId, ora.id)).toMatchObject({
      state: 'failed',
      attempts: 1,
      attemptedAt: NOV_3,
    });
    expect(alertsNaming(ora.id)).toHaveLength(2);
  });

  /** The email log's line for a notice's send, `at`. */
  async function logged(
    noticeId: string,
    email: string,
    status: 'success' | 'pending',
    at: Date
  ) {
    const [log] = await db
      .insert(emailAuditLogs)
      .values({
        templateName: 'fee-change-notice',
        recipientEmail: email,
        status,
        metadata: JSON.stringify({ feeNoticeId: noticeId }),
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: emailAuditLogs.id });
    if (log) logIds.push(log.id);
  }

  // Owner, 2026-11-09 (replacing review C1's F4, "a `pending` row counts"):
  // a send cut short leaves its log row `pending` for good, so one an
  // earlier run left is not told, and the email goes again. One still in
  // flight is told.
  it('the email log: a pending row an earlier run left goes again, one still in flight does not, and a test send never counts', async () => {
    const pam = await person('Pam Pending');
    const pia = await person('Pia Inflight');
    const tess = await person('Tess Testsend');
    const changeId = await rise(await organisation(pam.id, pia.id, tess.id));
    await run(
      changeId,
      NOV_3,
      mailerAnswering({
        [pam.id]: { accepted: false, status: 503 },
        [pia.id]: { accepted: false, status: 503 },
        [tess.id]: { accepted: false, status: 503 },
      })
    );
    const noticeId = async (userId: string) =>
      (await noticeOf(changeId, userId))?.id as string;
    // Morning one's send, left pending: its outcome never came.
    await logged(
      await noticeId(pam.id),
      pam.email,
      'pending',
      new Date(NOV_3.getTime() + 60 * 1000)
    );
    // A run beside morning two's, sending it now.
    const inFlightAt = new Date(NOV_4.getTime() - 2 * 60 * 1000);
    await logged(await noticeId(pia.id), pia.email, 'pending', inFlightAt);
    // A test send carrying the notice's id, as its marker sits in the log.
    const testSentAt = new Date(NOV_3.getTime() + 60 * 1000);
    const [forged] = await db
      .insert(emailAuditLogs)
      .values({
        templateName: 'fee-change-notice',
        recipientEmail: tess.email,
        status: 'success',
        metadata: JSON.stringify({
          ...TEST_SEND_METADATA,
          feeNoticeId: await noticeId(tess.id),
        }),
        createdAt: testSentAt,
        updatedAt: testSentAt,
      })
      .returning({ id: emailAuditLogs.id });
    if (forged) logIds.push(forged.id);

    const mailer = mailerAnswering();
    expect(await run(changeId, NOV_4, mailer)).toMatchObject({
      foundInLog: 1,
      sent: 2,
    });
    expect(mailFor(mailer, pam.id)).toHaveLength(1);
    expect(mailFor(mailer, tess.id)).toHaveLength(1);
    expect(mailFor(mailer, pia.id)).toEqual([]);
    expect(await noticeOf(changeId, pia.id)).toMatchObject({
      state: 'sent',
      acceptedAt: inFlightAt,
    });
    expect(await noticeOf(changeId, pam.id)).toMatchObject({
      state: 'sent',
      acceptedAt: NOV_4,
    });
  });

  it('a run cut off after sending leaves the notice due, and the next one checks the log before sending again', async () => {
    const ray = await person('Ray Cutoff');
    const changeId = await rise(await organisation(ray.id));
    // The list is made; then a run claims Ray, sends, and dies before
    // recording: the notice is still `due`, with its try stamped.
    await run(
      changeId,
      NOV_3,
      mailerAnswering(),
      async (name) => name !== 'fee-change-notice'
    );
    const notice = await noticeOf(changeId, ray.id);
    await db
      .update(feeChangeNotices)
      .set({ attemptedAt: NOV_3, attempts: 1 })
      .where(eq(feeChangeNotices.id, notice?.id as string));
    const loggedAt = new Date(NOV_3.getTime() + 60 * 1000);
    await logged(notice?.id as string, ray.email, 'success', loggedAt);

    const mailer = mailerAnswering();
    expect(await run(changeId, NOV_4, mailer)).toMatchObject({
      foundInLog: 1,
      sent: 0,
    });
    expect(mailFor(mailer, ray.id)).toEqual([]);
    expect(await noticeOf(changeId, ray.id)).toMatchObject({
      state: 'sent',
      acceptedAt: loggedAt,
    });
  });

  it('two failed mornings in a row still find the first one’s send in the log: it is never sent twice', async () => {
    const sid = await person('Sid Twice');
    const changeId = await rise(await organisation(sid.id));
    // Morning one: the send goes, but its answer is lost.
    await run(
      changeId,
      NOV_3,
      mailerAnswering({ [sid.id]: { accepted: false, status: 503 } })
    );
    const notice = await noticeOf(changeId, sid.id);
    const sentAt = new Date(NOV_3.getTime() + 60 * 1000);
    await logged(notice?.id as string, sid.email, 'success', sentAt);
    // Morning two: a run claims it, then fails inside its log check, so
    // only that try is stamped.
    await db
      .update(feeChangeNotices)
      .set({ attemptedAt: NOV_4, attempts: 2 })
      .where(eq(feeChangeNotices.id, notice?.id as string));

    const mailer = mailerAnswering();
    expect(await run(changeId, NOV_5, mailer)).toMatchObject({
      foundInLog: 1,
      sent: 0,
    });
    expect(mailFor(mailer, sid.id)).toEqual([]);
    expect(await noticeOf(changeId, sid.id)).toMatchObject({
      state: 'sent',
      acceptedAt: sentAt,
    });
  });

  it('a rise made smaller twice: the second round’s timed-out email still goes, never taken for the first round’s', async () => {
    const tia = await person('Tia Round');
    const admin = await person('Abe Admin');
    const org = await organisation(tia.id);
    const changeId = await rise(org);
    const smallerOf = async () => {
      const [row] = await db
        .select()
        .from(feeChangeNotices)
        .where(
          and(
            eq(feeChangeNotices.changeId, changeId),
            eq(feeChangeNotices.userId, tia.id),
            eq(feeChangeNotices.kind, 'smaller')
          )
        );
      if (!row) throw new Error('no smaller notice');
      return row;
    };
    // The writes stamp the real clock, so the mornings here are set from it.
    const hour = 60 * 60 * 1000;
    const t0 = Date.now();
    await run(changeId, new Date(t0 - 3 * hour), mailerAnswering());
    // The fee writes as a route makes them, through the registry.
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    try {
      // Round one: made smaller, queued and told two hours ago.
      await registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1300 },
        admin.id
      );
      const roundOne = new Date(t0 - 2 * hour);
      const first = await smallerOf();
      await db
        .update(feeChangeNotices)
        .set({
          state: 'sent',
          attempts: 1,
          attemptedAt: roundOne,
          acceptedAt: roundOne,
          createdAt: roundOne,
        })
        .where(eq(feeChangeNotices.id, first.id));
      await logged(
        first.id,
        tia.email,
        'success',
        new Date(roundOne.getTime() + 60 * 1000)
      );
      // Round two: smaller again, the same row told again.
      await registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1200 },
        admin.id
      );
    } finally {
      await closeRegistry();
    }
    const firstTry = new Date();
    await run(
      changeId,
      firstTry,
      mailerAnswering({ [tia.id]: { accepted: false, status: 503 } })
    );
    expect(await smallerOf()).toMatchObject({ state: 'unknown' });

    const mailer = mailerAnswering();
    expect(
      await run(changeId, new Date(firstTry.getTime() + 13 * hour), mailer)
    ).toMatchObject({ foundInLog: 0, sent: 1 });
    expect(mailFor(mailer, tia.id).map((p) => p.templateName)).toEqual([
      'fee-change-notice',
    ]);
    expect(await smallerOf()).toMatchObject({ state: 'sent' });
  });

  it('a rise made smaller while its smaller email is in flight: that email never counts for the new round, which goes the next morning', async () => {
    const uma = await person('Uma Inflight');
    const admin = await person('Ali Admin');
    const org = await organisation(uma.id);
    const changeId = await rise(org);
    const smallerOf = async () => {
      const [row] = await db
        .select()
        .from(feeChangeNotices)
        .where(
          and(
            eq(feeChangeNotices.changeId, changeId),
            eq(feeChangeNotices.userId, uma.id),
            eq(feeChangeNotices.kind, 'smaller')
          )
        );
      if (!row) throw new Error('no smaller notice');
      return row;
    };
    // The writes stamp the real clock, so the mornings here are set from it.
    const hour = 60 * 60 * 1000;
    await run(changeId, new Date(Date.now() - 3 * hour), mailerAnswering());
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    let roundOne: Awaited<ReturnType<typeof smallerOf>>;
    let mid: Awaited<ReturnType<typeof run>> | undefined;
    const mailer = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        // Uma's email is accepted, but only once the rise was made smaller
        // again while it was on its way.
        if (params.userId === uma.id) {
          await registry.feeConfig.updateOrgFees(
            org,
            { orgFeePercent: 1200 },
            admin.id
          );
        }
        return { accepted: true };
      }
    );
    try {
      await registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1300 },
        admin.id
      );
      roundOne = await smallerOf();
      mid = await run(changeId, new Date(), mailer);
    } finally {
      await closeRegistry();
    }

    // The email that went names the figure before the second cut.
    const [inFlight, ...more] = mailFor(mailer, uma.id);
    expect(more).toEqual([]);
    expect(inFlight?.data.feeNoticeId).toBe(roundOne.id);
    expect(JSON.stringify(inFlight?.data)).toContain(formatPercent(1300));
    // So the row is the second cut's round, untried, not marked told.
    const roundTwo = await smallerOf();
    expect(roundTwo).toMatchObject({
      state: 'due',
      attempts: 0,
      attemptedAt: null,
      acceptedAt: null,
    });
    expect(roundTwo.createdAt.getTime()).toBeGreaterThan(
      roundOne.createdAt.getTime()
    );
    // Not written, so not counted sent: a warning, and the run says so (S5).
    expect(mid).toMatchObject({ notRecorded: 1, sent: 0 });
    expect(warningsFor(roundOne.id)).toEqual([
      'fee step: a notice changed while this run held it; this outcome is not recorded on it',
    ]);

    // The next morning Uma is told the second cut's figure.
    const next = mailerAnswering();
    await run(changeId, new Date(Date.now() + 13 * hour), next);
    const [told] = mailFor(next, uma.id);
    expect(JSON.stringify(told?.data)).toContain(formatPercent(1200));
    expect(await smallerOf()).toMatchObject({ state: 'sent' });
  });

  it('a round made at the database clock, to the microsecond, is still marked when its email goes', async () => {
    const mo = await person('Mo Micro');
    const changeId = await rise(await organisation(mo.id));
    // The list is made with its template held, so nothing goes yet.
    await run(
      changeId,
      NOV_3,
      mailerAnswering(),
      async (name) => name !== 'fee-change-notice'
    );
    const notice = await noticeOf(changeId, mo.id);
    // As the column's now() default writes it: finer than a JS Date.
    await db.execute(
      sql`UPDATE ${feeChangeNotices} SET created_at = '2026-11-03 07:30:00.123456+00' WHERE id = ${notice?.id}`
    );

    const mailer = mailerAnswering();
    expect(await run(changeId, NOV_4, mailer)).toMatchObject({ sent: 1 });
    expect(mailFor(mailer, mo.id)).toHaveLength(1);
    expect(await noticeOf(changeId, mo.id)).toMatchObject({
      state: 'sent',
      acceptedAt: NOV_4,
    });
  });

  /**
   * A rise cancelled by the owner (the real route's write, through the
   * registry) while the step's email to `who` is in flight; the email then
   * gets `answer`.
   */
  async function cancelledInFlight(
    who: { id: string },
    answer: FeeNoticeDelivery
  ) {
    const admin = await person('Ari Admin');
    const changeId = await rise(await organisation(who.id));
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    try {
      await run(
        changeId,
        NOV_3,
        vi.fn(async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
          if (params.userId === who.id) {
            await registry.feeConfig.cancelChange(changeId, admin.id);
          }
          return answer;
        })
      );
    } finally {
      await closeRegistry();
    }
    expect((await changeOf(changeId))?.voidReason).toBe('cancelled');
    const rows = await db
      .select()
      .from(feeChangeNotices)
      .where(
        and(
          eq(feeChangeNotices.changeId, changeId),
          eq(feeChangeNotices.userId, who.id)
        )
      );
    return {
      changeId,
      announce: rows.find((n) => n.kind === 'announce'),
      cancelled: rows.find((n) => n.kind === 'cancelled'),
    };
  }

  it('a rise cancelled while its email is in flight: the email counts as told, and that person is emailed it is off', async () => {
    const pia = await person('Pia Inflight');
    const { changeId, announce, cancelled } = await cancelledInFlight(pia, {
      accepted: true,
    });

    // As if it was sent before the cancel: told, with what they were told.
    expect(announce).toMatchObject({ state: 'sent', acceptedAt: NOV_3 });
    expect(announce?.afterValues).not.toEqual([]);
    // And so emailed that it's off, with those same figures and date.
    expect(cancelled).toMatchObject({
      state: 'due',
      onList: false,
      roles: announce?.roles,
      beforeValues: announce?.beforeValues,
      afterValues: announce?.afterValues,
      quotedFrom: announce?.quotedFrom,
    });
    expect(obsLog.info).toHaveBeenCalledWith(
      'fee step: a fee rise was voided while its email was in flight; the cancellation email is owed',
      {
        feeNoticeId: announce?.id,
        changeId,
        outcome: 'sent',
        cancelledNoticeQueued: true,
      }
    );

    const nextMorning = mailerAnswering();
    await run(changeId, NOV_4, nextMorning);
    expect(mailFor(nextMorning, pia.id).map((p) => p.templateName)).toEqual([
      'fee-change-cancelled',
    ]);
  });

  it('a rise cancelled while its email gets no answer: it may have gone, so that person is emailed it is off too (owner, 2026-11-09)', async () => {
    const una = await person('Una Unknown');
    const { changeId, announce, cancelled } = await cancelledInFlight(una, {
      accepted: false,
      status: 503,
    });

    // As voidPending leaves a row that was `unknown`: set aside, keeping
    // what the email may have told them.
    expect(announce).toMatchObject({
      state: 'not_needed',
      lastReason: 'unknown',
      acceptedAt: null,
    });
    expect(announce?.quotedFrom).not.toBeNull();
    expect(cancelled).toMatchObject({
      state: 'due',
      roles: announce?.roles,
      afterValues: announce?.afterValues,
      quotedFrom: announce?.quotedFrom,
    });
    expect(obsLog.info).toHaveBeenCalledWith(
      'fee step: a fee rise was voided while its email was in flight; the cancellation email is owed',
      {
        feeNoticeId: announce?.id,
        changeId,
        outcome: 'unknown',
        cancelledNoticeQueued: true,
      }
    );
    // Closed by the void, it is never tried again, and the log says so (S6).
    expect(warningsFor(announce?.id)).toEqual([
      'fee step: a fee email was not accepted, and its rise was voided meanwhile; it is not tried again',
    ]);

    const nextMorning = mailerAnswering();
    await run(changeId, NOV_4, nextMorning);
    expect(mailFor(nextMorning, una.id).map((p) => p.templateName)).toEqual([
      'fee-change-cancelled',
    ]);
  });

  it('a rise cancelled while its email is in flight, then refused: in flight it may have told them, so "it’s off" is queued (the one rule); the refusal is not told', async () => {
    const rob = await person('Rob Refused');
    const { announce, cancelled } = await cancelledInFlight(rob, {
      accepted: false,
      status: 400,
    });
    expect(announce).toMatchObject({ state: 'not_needed', acceptedAt: null });
    expect(cancelled).toMatchObject({ state: 'due' });
    // A refusal told nothing: it is not written on the closed row (S6).
    expect(warningsFor(announce?.id)).toEqual([
      'fee step: a notice changed while this run held it; this outcome is not recorded on it',
    ]);
  });

  // ── Review final M1-M3 ────────────────────────────────────────────────────

  const HOUR = 60 * 60 * 1000;

  async function kindOf(
    changeId: string,
    userId: string,
    kind: (typeof feeChangeNotices.$inferSelect)['kind']
  ) {
    const [row] = await db
      .select()
      .from(feeChangeNotices)
      .where(
        and(
          eq(feeChangeNotices.changeId, changeId),
          eq(feeChangeNotices.userId, userId),
          eq(feeChangeNotices.kind, kind)
        )
      );
    return row;
  }

  /**
   * The mailer, writing the email log as notifications-api's sender does:
   * one line per send, its metadata the data exactly as sent.
   */
  function loggingMailer(answers: Record<string, FeeNoticeDelivery> = {}) {
    return vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        const answer = answers[params.userId] ?? { accepted: true };
        const [log] = await db
          .insert(emailAuditLogs)
          .values({
            templateName: params.templateName,
            recipientEmail: params.to,
            status: answer.accepted ? 'success' : 'failed',
            metadata: JSON.stringify(params.data),
          })
          .returning({ id: emailAuditLogs.id });
        if (log) logIds.push(log.id);
        return answer;
      }
    );
  }

  it('a rise made smaller while a FAILED smaller email is being retried: the retry never counts for the new round (M1)', async () => {
    const fay = await person('Fay Retry');
    const admin = await person('Al Admin');
    const org = await organisation(fay.id);
    const changeId = await rise(org);
    // The writes stamp the real clock, so the mornings here are set from it.
    await run(changeId, new Date(Date.now() - 3 * HOUR), mailerAnswering());
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    const retryAt = new Date(Date.now() + 13 * HOUR);
    const retry = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        // Fay's retry is accepted, but only once the rise was made smaller
        // again while it was on its way.
        if (params.userId === fay.id) {
          await registry.feeConfig.updateOrgFees(
            org,
            { orgFeePercent: 1200 },
            admin.id
          );
        }
        return { accepted: true };
      }
    );
    try {
      await registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1300 },
        admin.id
      );
      // Morning one: the smaller email is refused.
      await run(
        changeId,
        new Date(),
        mailerAnswering({ [fay.id]: { accepted: false, status: 400 } })
      );
      expect(await kindOf(changeId, fay.id, 'smaller')).toMatchObject({
        state: 'failed',
        attempts: 1,
      });
      // Morning two retries it: the claim leaves it `failed`.
      await run(changeId, retryAt, retry);
    } finally {
      await closeRegistry();
    }

    expect(JSON.stringify(mailFor(retry, fay.id)[0]?.data)).toContain(
      formatPercent(1300)
    );
    expect(await kindOf(changeId, fay.id, 'smaller')).toMatchObject({
      state: 'due',
      attempts: 0,
      acceptedAt: null,
    });
    const next = mailerAnswering();
    await run(changeId, new Date(retryAt.getTime() + 13 * HOUR), next);
    expect(JSON.stringify(mailFor(next, fay.id)[0]?.data)).toContain(
      formatPercent(1200)
    );
  });

  it('a round told again never takes the last round’s logged email for its own, however close in time (M2)', async () => {
    const vic = await person('Vic Rounds');
    const admin = await person('Ada Admin');
    const org = await organisation(vic.id);
    const changeId = await rise(org);
    await run(changeId, new Date(Date.now() - 3 * HOUR), mailerAnswering());
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    try {
      await registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1300 },
        admin.id
      );
      // Round one goes, and the email log keeps its line.
      await run(changeId, new Date(), loggingMailer());
      expect(await kindOf(changeId, vic.id, 'smaller')).toMatchObject({
        state: 'sent',
      });
      // Seconds later the rise is made smaller again: the same row, round two.
      await registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1200 },
        admin.id
      );
    } finally {
      await closeRegistry();
    }
    // Round two's first send gets no answer.
    const second = new Date();
    await run(
      changeId,
      second,
      loggingMailer({ [vic.id]: { accepted: false, status: 503 } })
    );
    expect(await kindOf(changeId, vic.id, 'smaller')).toMatchObject({
      state: 'unknown',
    });

    // Round one's line has this row's id and is seconds older than round
    // two, but it is round one's: round two is sent.
    const third = loggingMailer();
    expect(
      await run(changeId, new Date(second.getTime() + 13 * HOUR), third)
    ).toMatchObject({ foundInLog: 0, sent: 1 });
    expect(JSON.stringify(mailFor(third, vic.id)[0]?.data)).toContain(
      formatPercent(1200)
    );
  });

  /** Waits until a query matching `pattern` is waiting on a lock. */
  async function waitingOnLock(pattern: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const found = await db.execute(
        sql`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE ${pattern}`
      );
      if ((found.rows[0] as { n: number }).n > 0) return;
      await new Promise((wake) => setTimeout(wake, 50));
    }
    throw new Error(`no query like ${pattern} waited on a lock`);
  }

  it('a cancel locks its notices before reading them: a run in its middle sends nothing it can miss (M3)', async () => {
    const yan = await person('Yan Untold');
    const zoe = await person('Zoe Told');
    const admin = await person('Ari Admin');
    const changeId = await rise(await organisation(yan.id, zoe.id));
    // The list is made with its template held; then Zoe is told.
    await run(
      changeId,
      NOV_3,
      mailerAnswering(),
      async (name) => name !== 'fee-change-notice'
    );
    const told = await kindOf(changeId, zoe.id, 'announce');
    await db
      .update(feeChangeNotices)
      .set({
        state: 'sent',
        attempts: 1,
        attemptedAt: NOV_3,
        acceptedAt: NOV_3,
      })
      .where(eq(feeChangeNotices.id, told?.id as string));

    // A second connection holds Zoe's "it's off" row, uncommitted: the
    // cancel's insert waits on it, inside its own transaction.
    let release = () => {};
    const released = new Promise<void>((go) => {
      release = go;
    });
    let holding = () => {};
    const held = new Promise<void>((go) => {
      holding = go;
    });
    const holder = db
      .transaction(async (tx) => {
        await tx.insert(feeChangeNotices).values({
          changeId,
          userId: zoe.id,
          kind: 'cancelled',
          onList: false,
          roles: told?.roles ?? [],
          beforeValues: [],
          afterValues: [],
        });
        holding();
        await released;
        tx.rollback();
      })
      .catch(() => {});
    await held;

    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    const mailer = mailerAnswering();
    try {
      const cancel = registry.feeConfig.cancelChange(changeId, admin.id);
      await waitingOnLock('%INSERT INTO "fee_change_notices"%cancelled%');
      // A run starts in the middle of the cancel and ends inside it: its
      // joiners wait past the bound and are put off, so the change is not
      // dated this run either (commerce delta4), and nothing waits on it.
      expect(await run(changeId, NOV_4, mailer)).toMatchObject({
        sent: 0,
        deferred: 1,
      });
      release();
      await holder;
      await cancel;
    } finally {
      release();
      await closeRegistry();
    }

    // Yan was never sent the rise email, so owes no "it's off" email.
    expect(mailFor(mailer, yan.id)).toEqual([]);
    expect(await kindOf(changeId, yan.id, 'announce')).toMatchObject({
      state: 'not_needed',
      acceptedAt: null,
    });
    expect(await kindOf(changeId, yan.id, 'cancelled')).toBeUndefined();
    // Zoe, told, has exactly one.
    const zoes = await db
      .select()
      .from(feeChangeNotices)
      .where(
        and(
          eq(feeChangeNotices.changeId, changeId),
          eq(feeChangeNotices.userId, zoe.id),
          eq(feeChangeNotices.kind, 'cancelled')
        )
      );
    expect(zoes).toHaveLength(1);
  });

  // ── Review final S2, S3 ───────────────────────────────────────────────────

  /**
   * The step's own client with faults to arm: once armed, the next
   * `execute`, `select` or `transaction` it is asked for, on the client or
   * inside a transaction, fails.
   */
  function faultyClient() {
    const armed = new Set<string>();
    const wrap = <T extends object>(target: T): T =>
      new Proxy(target, {
        get(inner, key) {
          if (typeof key === 'string' && armed.delete(key)) {
            return () => {
              throw new Error(`the ${key} failed`);
            };
          }
          if (key === 'transaction') {
            const transaction: DatabaseWs['transaction'] = (work, config) =>
              (inner as unknown as DatabaseWs).transaction(
                (tx) => work(wrap(tx)),
                config
              );
            return transaction;
          }
          const value = Reflect.get(inner, key, inner);
          return typeof value === 'function' ? value.bind(inner) : value;
        },
      });
    return {
      client: wrap(db),
      arm: (key: 'execute' | 'select' | 'transaction') => armed.add(key),
    };
  }

  /** A rise one creator was told of, and a creator who joined after. */
  async function toldThenJoined(told: string, joiner: string) {
    const admin = await person('Ada Admin');
    const org = await organisation(told);
    const changeId = await rise(org);
    await run(changeId, new Date(Date.now() - 3 * HOUR), mailerAnswering());
    await join(org, joiner);
    return { admin, org, changeId };
  }

  /** The step's own client, running `then` once just before its claim. */
  function beforeClaim(then: () => Promise<void>): DatabaseWs {
    const dialect = new PgDialect();
    let fired = false;
    return new Proxy(db, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key !== 'execute') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        const execute = async (query: SQL) => {
          if (!fired && dialect.sqlToQuery(query).sql.includes('SKIP LOCKED')) {
            fired = true;
            await then();
          }
          return target.execute(query);
        };
        return execute;
      },
    });
  }

  /** The step's next read of who a rise affects runs `then` once it has read. */
  function afterNextPayeeRead(then: () => Promise<void>) {
    let fired = false;
    vi.mocked(affectedPayees).mockImplementation(async (client, ...rest) => {
      const read = await realAffectedPayees(client, ...rest);
      if (!fired && client === db) {
        fired = true;
        await then();
      }
      return read;
    });
  }

  it('a rise made smaller while its email is in flight: that email named the earlier figure, so the next morning names the new one (S2)', async () => {
    const pat = await person('Pat Inflight');
    const admin = await person('Ari Admin');
    const org = await organisation(pat.id);
    const changeId = await rise(org);
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    const mailer = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        if (params.userId === pat.id) {
          await registry.feeConfig.updateOrgFees(
            org,
            { orgFeePercent: 1300 },
            admin.id
          );
        }
        return { accepted: true };
      }
    );
    try {
      await run(changeId, new Date(), mailer);
    } finally {
      await closeRegistry();
    }

    expect(JSON.stringify(mailFor(mailer, pat.id)[0]?.data)).not.toContain(
      formatPercent(1300)
    );
    expect(await kindOf(changeId, pat.id, 'announce')).toMatchObject({
      state: 'sent',
    });
    expect(await kindOf(changeId, pat.id, 'smaller')).toMatchObject({
      state: 'due',
      attempts: 0,
    });
    const next = mailerAnswering();
    await run(changeId, new Date(Date.now() + 13 * HOUR), next);
    expect(JSON.stringify(mailFor(next, pat.id)[0]?.data)).toContain(
      formatPercent(1300)
    );
    expect(await kindOf(changeId, pat.id, 'smaller')).toMatchObject({
      state: 'sent',
    });
  });

  it('a rise made smaller after the run read its figures but before it claimed: its emails name the new figure, and nobody is owed another (S2)', async () => {
    const uma = await person('Uma Told');
    const jo = await person('Jo Joiner');
    const { admin, org, changeId } = await toldThenJoined(uma.id, jo.id);
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    // The joiners step reads the figures and adds Jo; the rise is made
    // smaller; then the claim, and the sends. (The joiners step holds the
    // level's lock while it reads, so the cut lands after it.)
    const morning = mailerAnswering();
    try {
      await runFeeNoticesSweep({
        db: beforeClaim(async () => {
          await registry.feeConfig.updateOrgFees(
            org,
            { orgFeePercent: 1300 },
            admin.id
          );
        }),
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now: new Date(),
        mailer: morning,
        templateExists: async () => true,
        onlyChanges: [changeId],
      });
    } finally {
      await closeRegistry();
    }

    // Jo's first email and Uma's smaller one both name the new figure.
    const [joFirst, ...joMore] = mailFor(morning, jo.id);
    expect(joMore).toEqual([]);
    expect(joFirst?.data.feeNoticeId).toBe(
      (await kindOf(changeId, jo.id, 'announce'))?.id
    );
    expect(JSON.stringify(joFirst?.data)).toContain(formatPercent(1300));
    const [umaSmaller, ...umaMore] = mailFor(morning, uma.id);
    expect(umaMore).toEqual([]);
    expect(umaSmaller?.data.feeNoticeId).toBe(
      (await kindOf(changeId, uma.id, 'smaller'))?.id
    );
    expect(JSON.stringify(umaSmaller?.data)).toContain(formatPercent(1300));
    // Jo was told the new figure first, so is owed no smaller email.
    expect(await kindOf(changeId, jo.id, 'smaller')).toBeUndefined();
  });

  it('the post-send check, as a backstop: a joiner added while an edit that skipped the level’s lock was open is still told the new figure the next morning (S2)', async () => {
    const uma = await person('Uma Told');
    const jo = await person('Jo Joiner');
    const { changeId } = await toldThenJoined(uma.id, jo.id);
    let release = () => {};
    const released = new Promise<void>((go) => {
      release = go;
    });
    let holding = () => {};
    const held = new Promise<void>((go) => {
      holding = go;
    });
    let holder: Promise<void> = Promise.resolve();
    // A cut as the purchase service makes one (the version superseded, a
    // new one, the notices locked, the smaller emails queued), but WITHOUT
    // the level's lock a real cut takes first, on another connection, held
    // open from just after the joiners step's read: so Jo joins after its
    // lock and its queue, the case only the post-send check catches.
    afterNextPayeeRead(async () => {
      holder = db.transaction(async (tx) => {
        try {
          const cutAt = new Date();
          const versions = await tx
            .select()
            .from(feeConfigVersions)
            .where(eq(feeConfigVersions.changeId, changeId));
          const live = versions.find((v) => v.supersededAt === null);
          if (!live) throw new Error('no live version');
          await tx
            .update(feeConfigVersions)
            .set({ supersededAt: cutAt })
            .where(eq(feeConfigVersions.id, live.id));
          await tx.insert(feeConfigVersions).values({
            changeId,
            scope: 'org',
            orgFeePercent: 1300,
          });
          await lockFeeNotices(tx, { changeId });
          await queueSmallerFeeNotices(tx, { changeId, now: cutAt });
        } finally {
          holding();
        }
        await released;
      });
      await held;
    });
    // It commits while Jo's first email is on its way.
    const morning = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        if (params.userId === jo.id) {
          release();
          await holder;
        }
        return { accepted: true };
      }
    );
    try {
      await run(changeId, new Date(), morning);
    } finally {
      release();
      await holder;
    }

    // Jo's first email was read before the cut could be seen.
    const joAnnounce = await kindOf(changeId, jo.id, 'announce');
    expect(joAnnounce).toMatchObject({ state: 'sent' });
    expect(JSON.stringify(mailFor(morning, jo.id)[0]?.data)).not.toContain(
      formatPercent(1300)
    );
    // So Jo is owed the smaller email, queued with that send's record.
    expect(await kindOf(changeId, jo.id, 'smaller')).toMatchObject({
      state: 'due',
      attempts: 0,
    });
    expect(obsLog.info).toHaveBeenCalledWith(
      'fee step: a fee email named a figure the rise was cut from since; the smaller email is owed',
      { feeNoticeId: joAnnounce?.id, changeId }
    );
    const next = mailerAnswering();
    await run(changeId, new Date(Date.now() + 13 * HOUR), next);
    expect(JSON.stringify(mailFor(next, jo.id)[0]?.data)).toContain(
      formatPercent(1300)
    );
    expect(JSON.stringify(mailFor(next, uma.id)[0]?.data)).toContain(
      formatPercent(1300)
    );
  });

  it('a void’s write and its "it’s off" refresh are one transaction: when the refresh fails neither lands, and the cancel’s own "it’s off" email still goes (S3)', async () => {
    const sam = await person('Sam Rollback');
    const admin = await person('Ari Admin');
    const changeId = await rise(await organisation(sam.id));
    // Once armed, the next raw statement the step sends (tellOfVoid's
    // insert) fails.
    const faults = faultyClient();
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    try {
      await runFeeNoticesSweep({
        db: faults.client,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now: NOV_3,
        mailer: vi.fn(
          async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
            if (params.userId === sam.id) {
              await registry.feeConfig.cancelChange(changeId, admin.id);
              faults.arm('execute');
            }
            return { accepted: true };
          }
        ),
        templateExists: async () => true,
        onlyChanges: [changeId],
      });
    } finally {
      await closeRegistry();
    }

    // Logged as an email that went, whose record failed (silent L2).
    expect(
      errorsFor(
        changeId,
        'fee step: a fee email went, or may have, but its record failed'
      )
    ).toHaveLength(1);
    expect(errorsFor(changeId, 'fee step: one notice failed')).toEqual([]);
    // The send's write went with the insert: the row is as the cancel left it.
    const announce = await kindOf(changeId, sam.id, 'announce');
    expect(announce).toMatchObject({ state: 'not_needed', acceptedAt: null });
    expect(
      obsLog.info.mock.calls.filter(
        ([message, context]) =>
          String(message).startsWith('fee step: a fee rise was voided') &&
          (context as { feeNoticeId?: string }).feeNoticeId === announce?.id
      )
    ).toEqual([]);
    // The cancel queued its own "it's off" email for the notice in flight.
    expect(await kindOf(changeId, sam.id, 'cancelled')).toMatchObject({
      state: 'due',
    });
    const nextMorning = mailerAnswering();
    await run(changeId, NOV_4, nextMorning);
    expect(mailFor(nextMorning, sam.id).map((p) => p.templateName)).toEqual([
      'fee-change-cancelled',
    ]);
  });

  // ── Review final silent L1-L3 ─────────────────────────────────────────────

  it('a cut locks its notices before it queues: a run in its middle claims none of them, so nobody is sent the bigger figure unseen (silent L1)', async () => {
    const yan = await person('Yan Waiting');
    const zoe = await person('Zoe Told');
    const admin = await person('Ari Admin');
    const org = await organisation(yan.id, zoe.id);
    const changeId = await rise(org);
    // The list is made with its template held; then Zoe is told.
    await run(
      changeId,
      new Date(Date.now() - 3 * HOUR),
      mailerAnswering(),
      async (name) => name !== 'fee-change-notice'
    );
    const told = await kindOf(changeId, zoe.id, 'announce');
    await db
      .update(feeChangeNotices)
      .set({ state: 'sent', attempts: 1, acceptedAt: new Date() })
      .where(eq(feeChangeNotices.id, told?.id as string));

    // A second connection holds Zoe's smaller row, uncommitted: the cut's
    // queue waits on it, inside its own transaction, after its lock.
    let release = () => {};
    const released = new Promise<void>((go) => {
      release = go;
    });
    let holding = () => {};
    const held = new Promise<void>((go) => {
      holding = go;
    });
    const holder = db
      .transaction(async (tx) => {
        await tx.insert(feeChangeNotices).values({
          changeId,
          userId: zoe.id,
          kind: 'smaller',
          onList: false,
          roles: told?.roles ?? [],
          beforeValues: [],
          afterValues: [],
        });
        holding();
        await released;
        tx.rollback();
      })
      .catch(() => {});
    await held;

    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    const during = mailerAnswering();
    try {
      const cut = registry.feeConfig.updateOrgFees(
        org,
        { orgFeePercent: 1300 },
        admin.id
      );
      await waitingOnLock('%INSERT INTO "fee_change_notices"%smaller%');
      // A run in the middle of the cut: Yan's notice is locked, so passed by.
      // It ends inside the cut: its joiners wait past the bound and are put
      // off, so the change is not dated this run either (commerce delta4).
      expect(await run(changeId, new Date(), during)).toMatchObject({
        sent: 0,
        deferred: 1,
      });
      release();
      await holder;
      await cut;
    } finally {
      release();
      await closeRegistry();
    }
    expect(mailFor(during, yan.id)).toEqual([]);
    expect(await kindOf(changeId, yan.id, 'announce')).toMatchObject({
      state: 'due',
      attempts: 0,
    });

    // The next morning Yan is told the cut's figure, first time.
    const next = mailerAnswering();
    await run(changeId, new Date(Date.now() + 13 * HOUR), next);
    const [first, ...more] = mailFor(next, yan.id);
    expect(more).toEqual([]);
    expect(JSON.stringify(first?.data)).toContain(formatPercent(1300));
    expect(await kindOf(changeId, yan.id, 'smaller')).toBeUndefined();
  });

  it('a fee email that went, whose record then fails, is logged as gone, and the next run finds it in the email log (silent L2)', async () => {
    const lou = await person('Lou Lostrecord');
    const changeId = await rise(await organisation(lou.id));
    // Once Lou's email is accepted, the record's transaction fails.
    const faults = faultyClient();
    const accepted = loggingMailer();
    await runFeeNoticesSweep({
      db: faults.client,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_3,
      mailer: vi.fn(async (params: FeeMailerParams) => {
        const answer = await accepted(params);
        if (params.userId === lou.id) faults.arm('transaction');
        return answer;
      }),
      templateExists: async () => true,
      onlyChanges: [changeId],
    });

    const [gone, ...more] = errorsFor(
      changeId,
      'fee step: a fee email went, or may have, but its record failed'
    );
    expect(more).toEqual([]);
    expect(gone?.[1]).toMatchObject({ outcome: 'sent' });
    expect(errorsFor(changeId, 'fee step: one notice failed')).toEqual([]);
    expect(await noticeOf(changeId, lou.id)).toMatchObject({
      state: 'due',
      attempts: 1,
    });

    const mailer = mailerAnswering();
    expect(await run(changeId, NOV_4, mailer)).toMatchObject({
      foundInLog: 1,
      sent: 0,
    });
    expect(mailFor(mailer, lou.id)).toEqual([]);
    expect(await noticeOf(changeId, lou.id)).toMatchObject({ state: 'sent' });
  });

  it('when whether the rise was cut since cannot be read, the email’s outcome is still recorded, and the change is named to check by hand (silent L2)', async () => {
    const mo = await person('Mo Unread');
    const changeId = await rise(await organisation(mo.id));
    // Once Mo's email is accepted, the next read (the live version) fails.
    const faults = faultyClient();
    const result = await runFeeNoticesSweep({
      db: faults.client,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: NOV_3,
      mailer: vi.fn(
        async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
          if (params.userId === mo.id) faults.arm('select');
          return { accepted: true };
        }
      ),
      templateExists: async () => true,
      onlyChanges: [changeId],
    });

    const [unread, ...more] = errorsFor(
      changeId,
      'fee step: a fee email went, or may have, but whether its rise was cut since could not be read'
    );
    expect(more).toEqual([]);
    expect(unread?.[1]).toMatchObject({ outcome: 'sent' });
    expect(result).toMatchObject({ sent: 1 });
    expect(await noticeOf(changeId, mo.id)).toMatchObject({
      state: 'sent',
      acceptedAt: NOV_3,
    });
  });

  it('figures that did not move are not "moved" because two roles came back the other way round (silent L3)', async () => {
    const pat = await person('Pat Tworoles');
    const changeId = await rise(await organisation(pat.id));
    const other = await organisation(pat.id);
    // Pat in two roles, read first one way round, then, once the version
    // has moved, the other.
    let reversed = false;
    let readReversed = 0;
    vi.mocked(affectedPayees).mockImplementation(async (client, ...rest) => {
      const read = await realAffectedPayees(client, ...rest);
      return read.map((p) => {
        if (p.userId !== pat.id) return p;
        const twice = <T extends { organizationId: string | null }>(
          list: T[]
        ): T[] => {
          const both = [
            ...list,
            ...list.map((v) => ({ ...v, organizationId: other })),
          ];
          return reversed ? both.reverse() : both;
        };
        if (reversed) readReversed += 1;
        return {
          ...p,
          roles: twice(p.roles),
          before: twice(p.before),
          after: twice(p.after),
        };
      });
    });
    // While Pat's email is on its way, the rise is saved again with the same
    // figures: its live version moves, its figures don't.
    const mailer = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        if (params.userId === pat.id) {
          await db.transaction(async (tx) => {
            const versions = await tx
              .select()
              .from(feeConfigVersions)
              .where(eq(feeConfigVersions.changeId, changeId));
            const live = versions.find((v) => v.supersededAt === null);
            if (!live) throw new Error('no live version');
            await tx
              .update(feeConfigVersions)
              .set({ supersededAt: new Date() })
              .where(eq(feeConfigVersions.id, live.id));
            await tx.insert(feeConfigVersions).values({
              changeId,
              scope: 'org',
              orgFeePercent: live.orgFeePercent,
            });
          });
          reversed = true;
        }
        return { accepted: true };
      }
    );
    await run(changeId, NOV_3, mailer);

    // The check read them again, the other way round, and found no move.
    expect(readReversed).toBeGreaterThan(0);
    const announce = await kindOf(changeId, pat.id, 'announce');
    expect(announce).toMatchObject({ state: 'sent' });
    expect(announce?.afterValues).toHaveLength(2);
    expect(await kindOf(changeId, pat.id, 'smaller')).toBeUndefined();
  });

  // ── Review final, commerce confirm NIT: joiners wait for an open cut ─────

  /**
   * A cut through the real purchase path, held open after its locks: a
   * second connection holds Uma's smaller row, uncommitted, so the cut's
   * queue waits on it. Returns the release and the cut's end.
   */
  async function cutHeldOpen(
    changeId: string,
    org: string,
    admin: string,
    told: string
  ) {
    const announce = await kindOf(changeId, told, 'announce');
    let release = () => {};
    const released = new Promise<void>((go) => {
      release = go;
    });
    let holding = () => {};
    const held = new Promise<void>((go) => {
      holding = go;
    });
    const holder = db
      .transaction(async (tx) => {
        await tx.insert(feeChangeNotices).values({
          changeId,
          userId: told,
          kind: 'smaller',
          onList: false,
          roles: announce?.roles ?? [],
          beforeValues: [],
          afterValues: [],
        });
        holding();
        await released;
        tx.rollback();
      })
      .catch(() => {});
    await held;
    const { registry, cleanup } = await createServiceRegistry(
      env as unknown as Bindings
    );
    const cut = registry.feeConfig.updateOrgFees(
      org,
      { orgFeePercent: 1300 },
      admin
    );
    await waitingOnLock('%INSERT INTO "fee_change_notices"%smaller%');
    // Ends once, however many times it is asked.
    let ended: Promise<void> | undefined;
    return {
      done: () => {
        ended ??= (async () => {
          release();
          await holder;
          await cut.finally(cleanup);
        })();
        return ended;
      },
    };
  }

  /**
   * 'waiting' once a query matching `pattern` waits on a lock, or 'settled'
   * when `settled` ends first.
   */
  async function lockWaitOr(
    pattern: string,
    settled: Promise<unknown>
  ): Promise<'waiting' | 'settled'> {
    let done = false;
    settled.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      }
    );
    for (let i = 0; i < 400 && !done; i++) {
      const found = await db.execute(
        sql`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE ${pattern}`
      );
      if ((found.rows[0] as { n: number }).n > 0) return 'waiting';
      await new Promise((wake) => setTimeout(wake, 50));
    }
    if (done) return 'settled';
    throw new Error(`no query like ${pattern} waited on a lock`);
  }

  const JOINERS_WAIT = '%pg_advisory_xact_lock%';

  it('a joiner waits for an open cut, then is told its figure: never the one before it (commerce confirm NIT)', async () => {
    const uma = await person('Uma Told');
    const jo = await person('Jo Joiner');
    const { admin, org, changeId } = await toldThenJoined(uma.id, jo.id);
    const cut = await cutHeldOpen(changeId, org, admin.id, uma.id);
    const morning = mailerAnswering();
    let result: Awaited<ReturnType<typeof run>> | undefined;
    let joinersWaited: 'waiting' | 'settled' | undefined;
    try {
      const running = run(changeId, new Date(), morning);
      // The joiners step waits for the cut (without its lock, the run just
      // ends, the cut still open).
      joinersWaited = await lockWaitOr(JOINERS_WAIT, running);
      await cut.done();
      result = await running;
    } finally {
      await cut.done();
    }

    expect(result).toMatchObject({ joinersAdded: 1 });
    const [first, ...more] = mailFor(morning, jo.id);
    expect(more).toEqual([]);
    expect(first?.data.feeNoticeId).toBe(
      (await kindOf(changeId, jo.id, 'announce'))?.id
    );
    expect(JSON.stringify(first?.data)).toContain(formatPercent(1300));
    // Told the new figure first, so owed no smaller email.
    expect(await kindOf(changeId, jo.id, 'smaller')).toBeUndefined();
    expect(joinersWaited).toBe('waiting');
  });

  it('a cut held past the wait puts that rise’s joiners off to the next morning, and the run goes on (commerce confirm NIT)', async () => {
    const uma = await person('Uma Told');
    const jo = await person('Jo Joiner');
    const { admin, org, changeId } = await toldThenJoined(uma.id, jo.id);
    const cut = await cutHeldOpen(changeId, org, admin.id, uma.id);
    const morning = mailerAnswering();
    try {
      // Past the joiners step's bounded wait, the run goes on and ends, the
      // cut still open (this rise is dated, so nothing after waits on it).
      expect(await run(changeId, new Date(), morning)).toMatchObject({
        joinersAdded: 0,
        errors: 0,
      });
    } finally {
      await cut.done();
    }

    expect(obsLog.warn).toHaveBeenCalledWith(
      'fee step: a fee rise was being edited past the wait; its joiners are added the next morning',
      { changeId, waitedMs: 5_000 }
    );
    expect(mailFor(morning, jo.id)).toEqual([]);
    expect(await kindOf(changeId, jo.id, 'announce')).toBeUndefined();

    // The next morning Jo joins, and is told the cut's figure.
    const next = mailerAnswering();
    await run(changeId, new Date(Date.now() + 13 * HOUR), next);
    expect(JSON.stringify(mailFor(next, jo.id)[0]?.data)).toContain(
      formatPercent(1300)
    );
  });

  // ── Review final, commerce delta4 + silent delta3: no date past a skipped
  // joiners step, and every lock a part waits for bounded ─────────────────

  /** The tests' own bound on a run: one that hangs fails, never stalls. */
  const RUN_BOUND_MS = 30_000;

  /** `running`'s result, or a failure once RUN_BOUND_MS pass without one. */
  async function within<T>(running: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        running,
        new Promise<never>((_, fail) => {
          timer = setTimeout(
            () => fail(new Error(`${what} did not end in ${RUN_BOUND_MS} ms`)),
            RUN_BOUND_MS
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  type HeldTx = Parameters<Parameters<DatabaseWs['transaction']>[0]>[0];

  /**
   * A second connection that takes `lock` and holds it, uncommitted, as an
   * edit stuck open would; `done` lets go (rolls back), once.
   */
  async function heldOpen(lock: (tx: HeldTx) => Promise<unknown>) {
    let release = () => {};
    const released = new Promise<void>((go) => {
      release = go;
    });
    let holding = () => {};
    const held = new Promise<void>((go) => {
      holding = go;
    });
    const holder = db
      .transaction(async (tx) => {
        await lock(tx);
        holding();
        await released;
        tx.rollback();
      })
      .catch(() => {});
    await Promise.race([held, holder]);
    let ended: Promise<void> | undefined;
    return {
      done: () => {
        ended ??= (async () => {
          release();
          await holder;
        })();
        return ended;
      },
    };
  }

  it('a rise whose joiners step was put off is not dated that run: the set-aside person affected again is back the next morning, and the 30 days count from them (commerce delta4)', async () => {
    const quin = await person('Quin Told');
    const pia = await person('Pia Back');
    const rae = await person('Rae Late');
    const admin = await person('Ari Admin');
    const org = await organisation(quin.id, pia.id, rae.id);
    const changeId = await rise(org);
    const today = Date.now();
    const refused: FeeNoticeDelivery = { accepted: false, status: 422 };
    // Two mornings ago Quin was told; Pia's and Rae's emails were refused.
    await run(
      changeId,
      new Date(today - 50 * HOUR),
      mailerAnswering({ [pia.id]: refused, [rae.id]: refused })
    );
    // Yesterday Pia had left, so she was set aside; Rae was refused again.
    await db
      .delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, org),
          eq(organizationMemberships.userId, pia.id)
        )
      );
    await run(
      changeId,
      new Date(today - 26 * HOUR),
      mailerAnswering({ [rae.id]: refused })
    );
    expect(await kindOf(changeId, pia.id, 'announce')).toMatchObject({
      state: 'not_needed',
    });
    // Pia is back: the rise affects her again.
    await join(org, pia.id);

    // This morning a cut is held open past the joiners' wait, then ends
    // just before the claim; Rae is told, so the rise is otherwise ready.
    const cut = await cutHeldOpen(changeId, org, admin.id, quin.id);
    let morning: Awaited<ReturnType<typeof runFeeNoticesSweep>> | undefined;
    try {
      morning = await within(
        runFeeNoticesSweep({
          db: beforeClaim(() => cut.done()),
          obs,
          environment: 'development',
          workerSecret: 'unused',
          notificationsUrl: 'http://unused.test',
          now: new Date(today),
          mailer: mailerAnswering(),
          templateExists: async () => true,
          onlyChanges: [changeId],
        }),
        'the morning with the cut'
      );
    } finally {
      await cut.done();
    }
    expect(morning).toMatchObject({ dated: 0, deferred: 1, errors: 0 });
    expect(await kindOf(changeId, rae.id, 'announce')).toMatchObject({
      state: 'sent',
    });
    expect(await kindOf(changeId, pia.id, 'announce')).toMatchObject({
      state: 'not_needed',
    });
    expect((await changeOf(changeId))?.effectiveFrom).toBeNull();
    expect(obsLog.info).toHaveBeenCalledWith(
      'fee step: a rise is dated no sooner than the next morning: its joiners step was put off or failed',
      { changeId }
    );

    // The next morning Pia is back on the list and told, and the 30 days
    // count from her.
    const nextMorning = new Date(today + 22 * HOUR);
    const next = mailerAnswering();
    expect(await run(changeId, nextMorning, next)).toMatchObject({
      dated: 1,
      deferred: 0,
    });
    expect(mailFor(next, pia.id)).toHaveLength(1);
    expect(await kindOf(changeId, pia.id, 'announce')).toMatchObject({
      state: 'sent',
      acceptedAt: nextMorning,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(nextMorning)
    );
  });

  it('joiners put off on a rise that starts before the next run are an error, to tell them by hand (commerce delta4)', async () => {
    const uma = await person('Uma Told');
    const jo = await person('Jo Joiner');
    const { org, changeId } = await toldThenJoined(uma.id, jo.id);
    // Dated to start before the next morning's run.
    const now = new Date();
    const startsOn = new Date(now.getTime() + 12 * HOUR);
    await db
      .update(feeChanges)
      .set({ effectiveFrom: startsOn })
      .where(eq(feeChanges.id, changeId));
    // A save at the level stuck open past the joiners' wait.
    const level = await heldOpen((tx) =>
      lockFeeLevel(tx, { scope: 'org', organizationId: org })
    );
    try {
      expect(
        await within(run(changeId, now, mailerAnswering()), 'the run')
      ).toMatchObject({ joinersAdded: 0, deferred: 1, errors: 0 });
    } finally {
      await level.done();
    }

    const errors = obsLog.error.mock.calls.filter(
      ([message, context]) =>
        String(message).startsWith(
          'fee step: a fee rise that starts before the next run was being edited past the wait'
        ) && (context as { changeId?: string }).changeId === changeId
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[1]).toEqual({
      errorId: expect.any(String),
      changeId,
      effectiveFrom: startsOn.toISOString(),
      waitedMs: 5_000,
    });
    expect(obsLog.warn).not.toHaveBeenCalledWith(
      'fee step: a fee rise was being edited past the wait; its joiners are added the next morning',
      { changeId, waitedMs: 5_000 }
    );
    expect(await kindOf(changeId, jo.id, 'announce')).toBeUndefined();
  });

  it('every lock a later part waits for is bounded: a list, a date and an old row each held past the wait are put off, and the run still reaches its alert and its summary (silent delta3)', async () => {
    // A rise not yet listed, its row held as an edit's first lock holds it.
    const wen = await person('Wen Unlisted');
    const unlisted = await rise(await organisation(wen.id));
    // A waiting rise: Quin told, Val refused, so the alert names Val.
    const quin = await person('Quin Told');
    const val = await person('Val Refused');
    const admin = await person('Ari Admin');
    const org = await organisation(quin.id, val.id);
    const waiting = await rise(org);
    await run(
      waiting,
      new Date(Date.now() - 26 * HOUR),
      mailerAnswering({ [val.id]: { accepted: false, status: 422 } })
    );
    // A rise started elsewhere, its old fee row not yet written.
    const startedOrg = await organisation();
    const [began] = await db
      .insert(feeChanges)
      .values({
        scope: 'org',
        organizationId: startedOrg,
        kind: 'rise',
        firstRunAt: new Date(Date.now() - 40 * 24 * HOUR),
        listedCount: 0,
        effectiveFrom: new Date(Date.now() - HOUR),
      })
      .returning({ id: feeChanges.id });
    if (!began) throw new Error('started rise not inserted');
    await db.insert(feeConfigVersions).values({
      changeId: began.id,
      scope: 'org',
      orgFeePercent: 1500,
    });
    const onlyChanges = [unlisted, waiting, began.id];
    const alertsBefore = alertsNaming(val.id).length;

    const list = await heldOpen((tx) =>
      lockFeeNotices(tx, { changeId: unlisted })
    );
    const level = await heldOpen((tx) =>
      lockFeeLevel(tx, { scope: 'org', organizationId: startedOrg })
    );
    // The waiting rise's cut starts once its joiners are done, and sticks.
    let cut: { done: () => Promise<void> } | undefined;
    const running = runFeeNoticesSweep({
      db: beforeClaim(async () => {
        cut = await cutHeldOpen(waiting, org, admin.id, quin.id);
      }),
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      mailer: mailerAnswering(),
      templateExists: async () => true,
      onlyChanges,
    });
    let result: Awaited<typeof running> | undefined;
    try {
      result = await within(running, 'the run with three parts held');
    } finally {
      // A run that hung ends once they let go, before the next test; a cut
      // it only reaches on the way is let go after.
      await list.done();
      await level.done();
      await cut?.done();
      await running;
      await cut?.done();
    }

    expect(result).toMatchObject({
      listsMade: 0,
      dated: 0,
      mirrored: 0,
      deferred: 3,
      errors: 0,
    });
    for (const [message, context] of [
      [
        'fee step: a fee rise was being edited past the wait; its list is made the next morning',
        { changeId: unlisted },
      ],
      [
        'fee step: a fee rise was being edited past the wait; it is dated the next morning at the earliest',
        { changeId: waiting },
      ],
      [
        'fee step: a fee level was being edited past the wait; its old fee row is written the next morning',
        { scope: 'org', organizationId: startedOrg },
      ],
    ] as const) {
      expect(obsLog.warn).toHaveBeenCalledWith(message, {
        ...context,
        waitedMs: 5_000,
      });
    }
    // The alert ran, and so did the summary, with what was put off.
    expect(alertsNaming(val.id).length).toBe(alertsBefore + 1);
    expect(obsLog.info).toHaveBeenCalledWith('fee step completed', result);

    // Nothing is left half-done: the next morning does all three.
    expect(
      await runFeeNoticesSweep({
        db,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now: new Date(Date.now() + 22 * HOUR),
        mailer: mailerAnswering(),
        templateExists: async () => true,
        onlyChanges,
      })
    ).toMatchObject({ listsMade: 1, mirrored: 1, deferred: 0, errors: 0 });
  });

  // ── Task r2: the same two defects by other paths ─────────────────────────

  /** The step's own client, running `then` once just after its claim. */
  function afterClaim(then: () => Promise<void>): DatabaseWs {
    const dialect = new PgDialect();
    let fired = false;
    return new Proxy(db, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key !== 'execute') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        const execute = async (query: SQL) => {
          const result = await target.execute(query);
          if (!fired && dialect.sqlToQuery(query).sql.includes('SKIP LOCKED')) {
            fired = true;
            await then();
          }
          return result;
        };
        return execute;
      },
    });
  }

  /** Rises in their own organisations, one person each, refused once. */
  async function refusedOnce(...names: string[]) {
    const made: Array<{ userId: string; org: string; changeId: string }> = [];
    for (const name of names) {
      const { id } = await person(name);
      const org = await organisation(id);
      made.push({ userId: id, org, changeId: await rise(org) });
    }
    await runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      now: new Date(Date.now() - 26 * HOUR),
      mailer: vi.fn(
        async (): Promise<FeeNoticeDelivery> => ({
          accepted: false,
          status: 422,
        })
      ),
      templateExists: async () => true,
      onlyChanges: made.map((m) => m.changeId),
    });
    return made;
  }

  it('support’s "told another way" never dates the rise: a set-aside person who rejoined since the last run is back the next morning, and the 30 days count from her (commerce delta4)', async () => {
    const quin = await person('Quin Told');
    const pia = await person('Pia Back');
    const rae = await person('Rae Phoned');
    const sam = await person('Sam Support');
    const org = await organisation(quin.id, pia.id, rae.id);
    const changeId = await rise(org);
    const today = Date.now();
    const refused: FeeNoticeDelivery = { accepted: false, status: 422 };
    // Two mornings ago Quin was told; Pia's and Rae's emails were refused.
    await run(
      changeId,
      new Date(today - 50 * HOUR),
      mailerAnswering({ [pia.id]: refused, [rae.id]: refused })
    );
    // Yesterday Pia had left, so she was set aside; Rae was refused again.
    await db
      .delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, org),
          eq(organizationMemberships.userId, pia.id)
        )
      );
    await run(
      changeId,
      new Date(today - 26 * HOUR),
      mailerAnswering({ [rae.id]: refused })
    );
    // Since then Pia is back, and support phones Rae, the last one waiting.
    await join(org, pia.id);
    const raeNotice = await kindOf(changeId, rae.id, 'announce');
    const { registry, cleanup: closeRegistry } = await createServiceRegistry(
      env as unknown as Bindings
    );
    let marked: Awaited<ReturnType<typeof registry.support.markToldAnotherWay>>;
    try {
      marked = await registry.support.markToldAnotherWay(
        raeNotice?.id as string,
        { note: 'Phoned Rae' },
        sam.id,
        new Date(today - 2 * HOUR)
      );
    } finally {
      await closeRegistry();
    }
    expect(marked.change).toEqual({
      changeId,
      effectiveFrom: null,
      waitingFor: 0,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toBeNull();

    // The next morning Pia is back on the list and told, and the 30 days
    // count from her.
    const nextMorning = new Date(today);
    const next = mailerAnswering();
    expect(await run(changeId, nextMorning, next)).toMatchObject({
      dated: 1,
    });
    expect(mailFor(next, pia.id)).toHaveLength(1);
    expect(await kindOf(changeId, pia.id, 'announce')).toMatchObject({
      state: 'sent',
      acceptedAt: nextMorning,
    });
    expect((await changeOf(changeId))?.effectiveFrom).toEqual(
      feeRiseStartAfter(nextMorning)
    );
  });

  it('a cut begun mid-send holds the notice past the wait: its record fails the L2 way, the run still reaches its alert and its summary, and the next run finds the email in the log (silent delta3)', async () => {
    const [ada, kit] = await refusedOnce('Ada Inflight', 'Kit Refused');
    if (!ada || !kit) throw new Error('rises not made');
    const admin = await person('Ari Admin');
    const alertsBefore = alertsNaming(kit.userId).length;
    // Ada's email goes this time, and while it is in flight a cut of her
    // rise takes its notices, and sticks; Kit's is refused again.
    const logged = loggingMailer({
      [kit.userId]: { accepted: false, status: 422 },
    });
    let cut: { done: () => Promise<void> } | undefined;
    const mailer = vi.fn(async (params: FeeMailerParams) => {
      if (params.userId === ada.userId) {
        cut = await cutHeldOpen(ada.changeId, ada.org, admin.id, ada.userId);
      }
      return logged(params);
    });
    const running = runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      mailer,
      templateExists: async () => true,
      onlyChanges: [ada.changeId, kit.changeId],
    });
    let result: Awaited<typeof running> | undefined;
    try {
      result = await within(running, 'the run with a cut across a send');
    } finally {
      await cut?.done();
      await running;
    }

    // Her record and her rise's date both met the cut, and were put off.
    expect(result).toMatchObject({ sent: 0, deferred: 2, errors: 1 });
    const [gone, ...more] = errorsFor(
      ada.changeId,
      'fee step: a fee email went, or may have, but its record failed'
    );
    expect(more).toEqual([]);
    expect(gone?.[1]).toMatchObject({ outcome: 'sent' });
    expect(alertsNaming(kit.userId).length).toBe(alertsBefore + 1);
    expect(obsLog.info).toHaveBeenCalledWith('fee step completed', result);

    // The next morning finds her email in the log, and sends nothing again.
    const next = mailerAnswering();
    expect(
      await runFeeNoticesSweep({
        db,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now: new Date(Date.now() + 13 * HOUR),
        mailer: next,
        templateExists: async () => true,
        onlyChanges: [ada.changeId],
      })
    ).toMatchObject({ foundInLog: 1 });
    expect(
      mailFor(next, ada.userId).filter(
        (p) => p.data.feeNoticeId === gone?.[1]?.feeNoticeId
      )
    ).toEqual([]);
  });

  it('claims given back while a cut begun since the claim holds them wait no longer than the bound: they stay claimed for the next morning, and the run still reaches its alert and its summary (silent delta3)', async () => {
    const [ada] = await refusedOnce('Ada Givenback');
    if (!ada) throw new Error('rise not made');
    const admin = await person('Ari Admin');
    const alertsBefore = alertsNaming(ada.userId).length;
    // The budget is spent before the first batch, so every claim goes back;
    // just after the claim, a cut of the rise takes its notices, and sticks.
    let cut: { done: () => Promise<void> } | undefined;
    const running = runFeeNoticesSweep({
      db: afterClaim(async () => {
        cut = await cutHeldOpen(ada.changeId, ada.org, admin.id, ada.userId);
      }),
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      mailer: mailerAnswering(),
      templateExists: async () => true,
      wakeStartedAt: Date.now() - SENDS_TIME_BUDGET_MS - 1_000,
      onlyChanges: [ada.changeId],
    });
    let result: Awaited<typeof running> | undefined;
    try {
      result = await within(running, 'the run giving back under a cut');
    } finally {
      await cut?.done();
      await running;
    }

    expect(result).toMatchObject({
      sent: 0,
      givenBack: 0,
      deferred: 2,
      errors: 0,
    });
    expect(obsLog.warn).toHaveBeenCalledWith(
      'fee step: unsent claims were being edited past the wait, so they were not given back; they are claimed again the next morning, this try counted',
      { notices: 1, changeIds: [ada.changeId], waitedMs: 5_000 }
    );
    // Still claimed, this run's try counted.
    expect(await kindOf(ada.changeId, ada.userId, 'announce')).toMatchObject({
      state: 'failed',
      attempts: 2,
    });
    expect(alertsNaming(ada.userId).length).toBe(alertsBefore + 1);
    expect(obsLog.info).toHaveBeenCalledWith('fee step completed', result);

    // The next morning claims it again, and it goes.
    const next = mailerAnswering();
    expect(
      await runFeeNoticesSweep({
        db,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now: new Date(Date.now() + 13 * HOUR),
        mailer: next,
        templateExists: async () => true,
        onlyChanges: [ada.changeId],
      })
    ).toMatchObject({ deferred: 0 });
    expect(mailFor(next, ada.userId).length).toBeGreaterThan(0);
  });

  it('when the joiners step fails before its changes, no rise is dated that run, and the alert still runs; the next morning dates it from the last person told (silent delta3)', async () => {
    const [kit] = await refusedOnce('Kit Refused');
    if (!kit) throw new Error('rise not made');
    const cal = await person('Cal Told');
    const listed = await rise(await organisation(cal.id));
    const alertsBefore = alertsNaming(kit.userId).length;
    // Once the new rise's list has read who it affects, the step's next
    // select fails: the joiners step's own read of the changes.
    const faults = faultyClient();
    let armed = false;
    vi.mocked(affectedPayees).mockImplementation(async (client, ...rest) => {
      const read = await realAffectedPayees(client, ...rest);
      if (!armed && rest[0].id === listed) {
        armed = true;
        faults.arm('select');
      }
      return read;
    });
    const morning = new Date();
    const result = await within(
      runFeeNoticesSweep({
        db: faults.client,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now: morning,
        mailer: mailerAnswering({
          [kit.userId]: { accepted: false, status: 422 },
        }),
        templateExists: async () => true,
        onlyChanges: [kit.changeId, listed],
      }),
      'the run whose joiners step fails'
    );

    // Cal was listed and told, so the rise was ready; it is not dated.
    expect(result).toMatchObject({ listsMade: 1, sent: 1, dated: 0 });
    expect(obsLog.error).toHaveBeenCalledWith('fee step part failed', {
      errorId: expect.any(String),
      part: 'joiners',
      error: expect.stringContaining('the select failed'),
    });
    expect(obsLog.warn).toHaveBeenCalledWith(
      'fee step: the joiners step did not finish, so no rise is dated this run; the next morning dates them'
    );
    expect((await changeOf(listed))?.effectiveFrom).toBeNull();
    expect(alertsNaming(kit.userId).length).toBe(alertsBefore + 1);
    expect(obsLog.info).toHaveBeenCalledWith('fee step completed', result);

    // The next morning dates it, from Cal's email: the same date.
    expect(
      await run(
        listed,
        new Date(morning.getTime() + 22 * HOUR),
        mailerAnswering()
      )
    ).toMatchObject({ dated: 1 });
    expect((await changeOf(listed))?.effectiveFrom).toEqual(
      feeRiseStartAfter(morning)
    );
  });

  it('a joiners step that fails on a rise starting before the next run is the urgent error, with its start; one starting later stays the generic one (silent, 3a00722eb confirm)', async () => {
    const URGENT =
      'fee step: joiners could not be added for a fee rise that starts before the next run; tell anyone it now affects by hand. See Admin › Queue › Fee notices';
    const GENERIC = 'fee step: joiners could not be added for a change';
    const now = new Date();
    // A rise dated to start before the next morning's run, and one dated
    // the usual 30 days out, each with a joiner.
    const soon = await toldThenJoined(
      (await person('Uma Soon')).id,
      (await person('Jo Soon')).id
    );
    const startsOn = new Date(now.getTime() + 12 * HOUR);
    await db
      .update(feeChanges)
      .set({ effectiveFrom: startsOn })
      .where(eq(feeChanges.id, soon.changeId));
    const later = await toldThenJoined(
      (await person('Uma Later')).id,
      (await person('Jo Later')).id
    );

    // Each morning, the joiners step's read of who the rise affects fails.
    for (const { changeId } of [soon, later]) {
      failOnePayeeRead();
      expect(await run(changeId, now, mailerAnswering())).toMatchObject({
        joinersAdded: 0,
        deferred: 0,
        errors: 1,
      });
    }

    const urgent = errorsFor(soon.changeId, URGENT);
    expect(urgent).toHaveLength(1);
    expect(urgent[0]?.[1]).toEqual({
      errorId: expect.any(String),
      changeId: soon.changeId,
      effectiveFrom: startsOn.toISOString(),
      error: expect.stringContaining('payee read timed out'),
    });
    expect(errorsFor(soon.changeId, GENERIC)).toEqual([]);

    const generic = errorsFor(later.changeId, GENERIC);
    expect(generic).toHaveLength(1);
    expect(generic[0]?.[1]).toEqual({
      errorId: expect.any(String),
      changeId: later.changeId,
      error: expect.stringContaining('payee read timed out'),
    });
    expect(errorsFor(later.changeId, URGENT)).toEqual([]);
  });

  // ── Task t: the final confirms' silent LOW and commerce nit ──────────────

  it('a refused send whose record meets a cut begun mid-send still says so that day, with its reason and the mail service’s answer, counted as failed and put off (silent, final confirm)', async () => {
    const [ada] = await refusedOnce('Ada Refusedagain');
    if (!ada) throw new Error('rise not made');
    const admin = await person('Ari Admin');
    const announce = await kindOf(ada.changeId, ada.userId, 'announce');
    // Ada's email is refused again, and while it is in flight a cut of her
    // rise takes its notices, and sticks.
    let cut: { done: () => Promise<void> } | undefined;
    const mailer = vi.fn(
      async (params: FeeMailerParams): Promise<FeeNoticeDelivery> => {
        if (params.userId === ada.userId) {
          cut = await cutHeldOpen(ada.changeId, ada.org, admin.id, ada.userId);
        }
        return { accepted: false, status: 422 };
      }
    );
    const running = runFeeNoticesSweep({
      db,
      obs,
      environment: 'development',
      workerSecret: 'unused',
      notificationsUrl: 'http://unused.test',
      mailer,
      templateExists: async () => true,
      onlyChanges: [ada.changeId],
    });
    let result: Awaited<typeof running> | undefined;
    try {
      result = await within(running, 'the run refused under a cut');
    } finally {
      await cut?.done();
      await running;
    }

    // Her record and her rise's date met the cut, and were put off; the
    // refusal is told today all the same, with what the row would keep.
    expect(result).toMatchObject({ failed: 1, deferred: 2, errors: 0 });
    expect(obsLog.warn).toHaveBeenCalledWith(
      'fee step: a fee email was not accepted; it is tried again tomorrow',
      {
        errorId: expect.any(String),
        feeNoticeId: announce?.id,
        changeId: ada.changeId,
        kind: 'announce',
        reason: 'refused',
        lastError: 'HTTP 422',
        recorded: false,
        waitedMs: 5_000,
      }
    );
    expect(obsLog.warn).not.toHaveBeenCalledWith(
      'fee step: a notice was being edited past the wait; it is taken up again the next morning',
      { feeNoticeId: announce?.id, changeId: ada.changeId, waitedMs: 5_000 }
    );
  });

  it('when the joiners step fails before its changes, each rise that starts before the next run still gets the urgent error, after the part’s own; when that read fails too, the part’s next error carries the instruction (commerce, final confirm)', async () => {
    const URGENT =
      'fee step: joiners could not be added for a fee rise that starts before the next run; tell anyone it now affects by hand. See Admin › Queue › Fee notices';
    const READ_FAILED =
      'fee step part failed, and the rises that start before the next run could not be read: for each of them, tell anyone it now affects by hand. See Admin › Queue › Fee notices';
    const now = new Date();
    // A rise dated to start before the next morning's run, and one dated
    // the usual 30 days out, each with a joiner.
    const soon = await toldThenJoined(
      (await person('Uma Soon')).id,
      (await person('Jo Soon')).id
    );
    const startsOn = new Date(now.getTime() + 12 * HOUR);
    await db
      .update(feeChanges)
      .set({ effectiveFrom: startsOn })
      .where(eq(feeChanges.id, soon.changeId));
    const later = await toldThenJoined(
      (await person('Uma Later')).id,
      (await person('Jo Later')).id
    );
    // Each morning a new rise is listed. Once its list has read who it
    // affects, the step's next `failing` selects fail: the joiners step's
    // own read, and on the second morning the read after it too.
    const fresh: string[] = [];
    for (const name of ['Cal One', 'Cal Two']) {
      fresh.push(await rise(await organisation((await person(name)).id)));
    }
    let failing = 0;
    let armNext = 0;
    const client = new Proxy(db, {
      get(target, key) {
        if (key === 'select' && failing > 0) {
          failing -= 1;
          return () => {
            throw new Error('the select failed');
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    vi.mocked(affectedPayees).mockImplementation(async (reader, ...rest) => {
      const read = await realAffectedPayees(reader, ...rest);
      if (armNext > 0 && fresh.includes(rest[0].id)) {
        failing = armNext;
        armNext = 0;
      }
      return read;
    });
    const morning = async (listed: string, selectsFailing: number) => {
      const before = obsLog.error.mock.calls.length;
      armNext = selectsFailing;
      await within(
        runFeeNoticesSweep({
          db: client,
          obs,
          environment: 'development',
          workerSecret: 'unused',
          notificationsUrl: 'http://unused.test',
          now,
          mailer: mailerAnswering(),
          templateExists: async () => true,
          onlyChanges: [soon.changeId, later.changeId, listed],
        }),
        'the morning whose joiners step fails'
      );
      return obsLog.error.mock.calls.slice(before);
    };
    const at = (
      calls: Array<unknown[]>,
      message: string,
      key: 'part' | 'changeId',
      value: string
    ) =>
      calls.findIndex(
        ([m, c]) =>
          m === message && (c as Record<string, unknown>)[key] === value
      );

    // The read of the rises that start soon works: the urgent error for
    // the one that does, after the part's own, unchanged.
    const first = await morning(fresh[0] as string, 1);
    const partFailed = at(first, 'fee step part failed', 'part', 'joiners');
    expect(first[partFailed]?.[1]).toEqual({
      errorId: expect.any(String),
      part: 'joiners',
      error: expect.stringContaining('the select failed'),
    });
    const urgent = at(first, URGENT, 'changeId', soon.changeId);
    expect(urgent).toBeGreaterThan(partFailed);
    expect(first[urgent]?.[1]).toEqual({
      errorId: expect.any(String),
      changeId: soon.changeId,
      effectiveFrom: startsOn.toISOString(),
      error: expect.stringContaining('the select failed'),
    });
    expect(at(first, URGENT, 'changeId', later.changeId)).toBe(-1);
    expect(at(first, READ_FAILED, 'part', 'joiners')).toBe(-1);

    // That read fails too: the part's next error carries the instruction.
    const second = await morning(fresh[1] as string, 2);
    const partFailedAgain = at(
      second,
      'fee step part failed',
      'part',
      'joiners'
    );
    const readFailed = at(second, READ_FAILED, 'part', 'joiners');
    expect(readFailed).toBeGreaterThan(partFailedAgain);
    expect(partFailedAgain).toBeGreaterThanOrEqual(0);
    expect(second[readFailed]?.[1]).toEqual({
      errorId: expect.any(String),
      part: 'joiners',
      error: expect.stringContaining('the select failed'),
      readError: expect.stringContaining('the select failed'),
    });
    expect(at(second, URGENT, 'changeId', soon.changeId)).toBe(-1);
  });

  it('a part’s failure follow-up that throws is logged and counted, and every part after it still runs, to the summary (silent, final confirm)', async () => {
    const URGENT =
      'fee step: joiners could not be added for a fee rise that starts before the next run';
    const now = new Date();
    // A rise starting before the next run, so the joiners part's follow-up
    // has an urgent error to raise.
    const soon = await toldThenJoined(
      (await person('Uma Soon')).id,
      (await person('Jo Soon')).id
    );
    await db
      .update(feeChanges)
      .set({ effectiveFrom: new Date(now.getTime() + 12 * HOUR) })
      .where(eq(feeChanges.id, soon.changeId));
    // A new rise, listed this morning: once its list has read who it
    // affects, the step's next select (the joiners step's own) fails.
    const cal = await person('Cal Sent');
    const listed = await rise(await organisation(cal.id));
    const faults = faultyClient();
    let armed = false;
    vi.mocked(affectedPayees).mockImplementation(async (reader, ...rest) => {
      const read = await realAffectedPayees(reader, ...rest);
      if (!armed && rest[0].id === listed) {
        armed = true;
        faults.arm('select');
      }
      return read;
    });
    // The follow-up throws: raising its urgent error fails (the logger is
    // the seam; nothing in the step changes).
    obsLog.error.mockImplementation((message: unknown) => {
      if (String(message).startsWith(URGENT)) {
        throw new Error('the alert could not be raised');
      }
    });
    const before = obsLog.error.mock.calls.length;
    const mailer = mailerAnswering();
    let result: Awaited<ReturnType<typeof runFeeNoticesSweep>> | undefined;
    try {
      result = await runFeeNoticesSweep({
        db: faults.client,
        obs,
        environment: 'development',
        workerSecret: 'unused',
        notificationsUrl: 'http://unused.test',
        now,
        mailer,
        templateExists: async () => true,
        onlyChanges: [soon.changeId, listed],
      });
    } finally {
      obsLog.error.mockImplementation(() => undefined);
    }
    const errors = obsLog.error.mock.calls.slice(before);

    expect(errors).toContainEqual([
      'fee step part failure follow-up failed',
      {
        errorId: expect.any(String),
        part: 'joiners',
        error: expect.stringContaining('the alert could not be raised'),
      },
    ]);
    expect(
      errors.filter(([message]) => message === 'fee step failed at top level')
    ).toEqual([]);
    // The parts after it ran: Cal's email went, and the summary was logged,
    // counting the part's failure and its follow-up's.
    expect(mailFor(mailer, cal.id)).toHaveLength(1);
    expect(result).toMatchObject({ listsMade: 1, sent: 1, errors: 2 });
    expect(obsLog.info).toHaveBeenCalledWith('fee step completed', result);
  });
});
