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
} from '@codex/database';
import {
  emailAuditLogs,
  feeChangeNotices,
  feeChanges,
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
  readFeeVersionsByLevel,
  resolveFeesAt,
} from '@codex/payments';
import type { Bindings } from '@codex/shared-types';
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
  FEE_SENDS_TIME_BUDGET_MS,
  type FeeMailerParams,
  type FeeNoticeDelivery,
  runFeeNoticesSweep,
} from '../fee-notices-sweep';

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
        clockMs = FEE_SENDS_TIME_BUDGET_MS;
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
      wakeStartedAt: now - FEE_SENDS_TIME_BUDGET_MS,
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

  it('a send still pending in the email log counts as told: it may have gone', async () => {
    const pam = await person('Pam Pending');
    const changeId = await rise(await organisation(pam.id));
    await run(
      changeId,
      NOV_3,
      mailerAnswering({ [pam.id]: { accepted: false, status: 503 } })
    );
    const notice = await noticeOf(changeId, pam.id);
    const loggedAt = new Date(NOV_3.getTime() + 60 * 1000);
    await logged(notice?.id as string, pam.email, 'pending', loggedAt);

    const mailer = mailerAnswering();
    expect(await run(changeId, NOV_4, mailer)).toMatchObject({
      foundInLog: 1,
      sent: 0,
    });
    expect(mailFor(mailer, pam.id)).toEqual([]);
    expect(await noticeOf(changeId, pam.id)).toMatchObject({
      state: 'sent',
      acceptedAt: loggedAt,
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
});
