/**
 * The leaving notice's writes (Codex-a6ofh.6, design §4): a delete of a piece
 * people hold, Keep, the day-30 delete and the publish refusal, against a
 * real Postgres, so every CHECK and the unique on the notice table hold.
 *
 * The sweep (WP-4) is not here: a "tick" is the row update a send makes, the
 * claim's try counted (`attempts + 1`) with the answer it got.
 *
 * Database: a real Postgres (the throwaway ln_scratch locally, the CI branch
 * in CI). Every row it makes is its own, and deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import {
  CONTENT_LEAVING_NOTICE_OPEN_STATES,
  type ContentLeavingNoticeKind,
  LEAVING_NOTICE_DAYS,
  LEAVING_ROUND_GAP_HOURS,
} from '@codex/constants';
import {
  content,
  contentLeavingNotices,
  courseStages,
  courses,
  entitlements,
  organizations,
  purchases,
  stagePractices,
  users,
} from '@codex/database/schema';
import {
  createTestContentInput,
  createTestOrganizationInput,
  type Database,
  joinTeam,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { NewContent } from '../../types';
import { assertWroteEveryHolder, leaveDateFrom } from '../content-leaving';
import { ContentService } from '../content-service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const GAP_MS = LEAVING_ROUND_GAP_HOURS * HOUR_MS;
/** A ServiceError by its code, never `instanceof` (two module copies). */
const INTERNAL = { statusCode: 500, code: 'INTERNAL_ERROR' };
const LEAVING_REFUSED = {
  statusCode: 409,
  context: { code: 'CONTENT_LEAVING' },
};
const TOO_SOON = {
  statusCode: 409,
  context: { code: 'CONTENT_LEAVING_TOO_SOON' },
};
const NOT_YOURS = {
  statusCode: 403,
  context: { code: 'CONTENT_LEAVE_NOT_YOURS' },
};

/** The service's clock to `at` (JS `Date` only; Postgres keeps its own). */
function clockAt(at: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
}

/**
 * The service's clock past the gap a new notice period waits for
 * (`LEAVING_ROUND_GAP_HOURS`), so a delete after a Keep starts one.
 */
function nextDay() {
  clockAt(Date.now() + GAP_MS + HOUR_MS);
}

describe('ContentService: the leaving notice', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let otherCreatorId: string;
  let orgId: string;
  const contentIds: string[] = [];
  const purchaseIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId, otherCreatorId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    ).id;
    await joinTeam(db, orgId, creatorId);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (courseIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.courseId, courseIds));
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (contentIds.length > 0) {
      // The notices hold the content row (restrict), so they go first.
      await db
        .delete(contentLeavingNotices)
        .where(inArray(contentLeavingNotices.contentId, contentIds));
      await db
        .delete(entitlements)
        .where(inArray(entitlements.contentId, contentIds));
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await teardownTestDatabase();
  });

  /** A free article (it passes every publish rule), live unless told. */
  async function piece(overrides: Partial<NewContent> = {}, owner = creatorId) {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(owner, {
            contentType: 'written',
            title: `Leaving ${randomUUID().slice(0, 8)}`,
            status: 'published',
            publishedAt: new Date(),
            ...overrides,
          })
        )
        .returning()
    );
    contentIds.push(row.id);
    return row;
  }

  /** A completed purchase of the piece. */
  async function bought(contentId: string, customerId: string) {
    const row = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId,
          contentId,
          amountPaidCents: 900,
          currency: 'gbp',
          platformFeeCents: 0,
          organizationFeeCents: 0,
          creatorPayoutCents: 900,
          stripePaymentIntentId: `pi_${randomUUID()}`,
          status: 'completed',
          purchasedAt: new Date(),
        })
        .returning({ id: purchases.id })
    );
    purchaseIds.push(row.id);
  }

  /** A course in the org whose one live stage holds the piece. */
  async function inCourse(contentId: string) {
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: `leaving-course-${randomUUID().slice(0, 8)}`,
          title: 'Leaving course',
          status: 'published',
        })
        .returning()
    );
    courseIds.push(course.id);
    const stage = takeFirst(
      await db
        .insert(courseStages)
        .values({ courseId: course.id, name: 'Stage', sortOrder: 1 })
        .returning()
    );
    await db
      .insert(stagePractices)
      .values({ stageId: stage.id, contentId, sortOrder: 0 });
    return course.id;
  }

  const erase = (userId: string) =>
    db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));

  const stored = async (id: string) =>
    takeFirst(await db.select().from(content).where(eq(content.id, id)));

  const noticesOf = (contentId: string) =>
    db
      .select()
      .from(contentLeavingNotices)
      .where(eq(contentLeavingNotices.contentId, contentId))
      .orderBy(contentLeavingNotices.round, contentLeavingNotices.createdAt);

  /** One person's rows of one kind, newest round first. */
  const rowsOf = async (
    contentId: string,
    userId: string,
    kind: ContentLeavingNoticeKind
  ) =>
    db
      .select()
      .from(contentLeavingNotices)
      .where(
        and(
          eq(contentLeavingNotices.contentId, contentId),
          eq(contentLeavingNotices.userId, userId),
          eq(contentLeavingNotices.kind, kind)
        )
      )
      .orderBy(desc(contentLeavingNotices.round));

  /**
   * The sweep's send of a person's open row of `kind`, newest round: its try
   * counted, then the answer. `sent` is a delivered email; `refused` one the
   * sender answered without sending (`failed`, retried).
   */
  async function tick(
    contentId: string,
    userId: string,
    kind: ContentLeavingNoticeKind,
    answer: 'sent' | 'refused' | 'in-flight' = 'sent'
  ) {
    const open = (await rowsOf(contentId, userId, kind)).find(isOpen);
    expect(open, `an open ${kind} row to send`).toBeDefined();
    if (!open) return;
    const now = new Date();
    const tried = { attempts: open.attempts + 1, attemptedAt: now };
    await db
      .update(contentLeavingNotices)
      .set(
        answer === 'sent'
          ? { ...tried, state: 'sent', sentAt: now }
          : answer === 'refused'
            ? { ...tried, state: 'failed', lastReason: 'refused' }
            : tried
      )
      .where(eq(contentLeavingNotices.id, open.id));
  }

  /** A row the sweep would still claim. */
  const isOpen = (row: { state: string }) =>
    (CONTENT_LEAVING_NOTICE_OPEN_STATES as readonly string[]).includes(
      row.state
    );

  /** How many staying rows the piece has, and how many of them were sent. */
  async function stayingOf(contentId: string, userId: string) {
    const rows = await rowsOf(contentId, userId, 'staying');
    return {
      all: rows.length,
      sent: rows.filter((row) => row.state === 'sent').length,
      open: rows.filter(isOpen).length,
    };
  }

  /** The leave as an org admin's delete alone would leave it. */
  const orgOnly = (contentId: string) =>
    db
      .update(content)
      .set({ leavingByCreator: false, leavingByOrg: true })
      .where(eq(content.id, contentId));

  // ── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a piece nobody holds at once, writing no notice', async () => {
      const row = await piece();

      const { result } = await service.delete(row.id, creatorId);

      expect(result).toEqual({
        outcome: 'deleted',
        leavesAt: null,
        holders: 0,
      });
      const after = await stored(row.id);
      expect(after.deletedAt).not.toBeNull();
      expect(after.leavesAt).toBeNull();
      expect(await noticesOf(row.id)).toEqual([]);
    });

    it('takes a held piece off sale with a date, and writes each holder a leaving row', async () => {
      const [a, b] = await seedTestUsers(db, 2);
      const row = await piece();
      await bought(row.id, a);
      await bought(row.id, b);
      const before = Date.now();

      const { result } = await service.delete(row.id, creatorId);

      expect(result.outcome).toBe('leaving');
      expect(result.holders).toBe(2);
      const after = await stored(row.id);
      expect(after.deletedAt).toBeNull();
      expect(after.status).toBe('archived');
      expect(after.offSaleAt).not.toBeNull();
      expect(after.publishRequestedAt).toBeNull();
      // The creator's own delete: the leave holds the creator's side only.
      expect(after.leavingByCreator).toBe(true);
      expect(after.leavingByOrg).toBe(false);
      const leavesAt = after.leavesAt?.getTime() ?? 0;
      expect(leavesAt).toBe(result.leavesAt?.getTime());
      expect(leavesAt - before).toBeGreaterThanOrEqual(
        LEAVING_NOTICE_DAYS * DAY_MS
      );
      expect(leavesAt - before).toBeLessThan(
        LEAVING_NOTICE_DAYS * DAY_MS + 60_000
      );

      const notices = await noticesOf(row.id);
      expect(notices.map((n) => n.userId).sort()).toEqual([a, b].sort());
      for (const notice of notices) {
        expect(notice).toMatchObject({
          kind: 'leaving',
          state: 'due',
          attempts: 0,
        });
        // The round matches the date read back, to the millisecond.
        expect(notice.round.getTime()).toBe(leavesAt);
      }
    });

    it('keeps a once-live draft a draft, and an earlier off-sale date', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const offSaleAt = new Date(Date.now() - DAY_MS);
      const row = await piece({ status: 'draft', offSaleAt });
      await bought(row.id, holder);

      await service.delete(row.id, creatorId);

      const after = await stored(row.id);
      expect(after.status).toBe('draft');
      expect(after.offSaleAt?.getTime()).toBe(offSaleAt.getTime());
    });

    it('clears a publish-when-ready schedule, which the leaving CHECK refuses', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece({
        status: 'draft',
        publishedAt: null,
        publishRequestedAt: new Date(),
      });
      await db.insert(entitlements).values({
        userId: holder,
        contentId: row.id,
        source: 'grant',
      });

      const { result } = await service.delete(row.id, creatorId);

      expect(result.outcome).toBe('leaving');
      expect((await stored(row.id)).publishRequestedAt).toBeNull();
    });

    it('writes ONE row for a buyer who also bought a course holding the piece', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece({ organizationId: orgId });
      await bought(row.id, holder);
      // A course purchase is a purchases row and the course's grant: each is
      // its own way to hold the piece, and the person is still one holder.
      const courseId = await inCourse(row.id);
      const coursePurchase = takeFirst(
        await db
          .insert(purchases)
          .values({
            customerId: holder,
            courseId,
            amountPaidCents: 2400,
            currency: 'gbp',
            platformFeeCents: 0,
            organizationFeeCents: 0,
            creatorPayoutCents: 2400,
            stripePaymentIntentId: `pi_${randomUUID()}`,
            status: 'completed',
            purchasedAt: new Date(),
          })
          .returning({ id: purchases.id })
      );
      purchaseIds.push(coursePurchase.id);
      await db.insert(entitlements).values({
        userId: holder,
        organizationId: orgId,
        courseId,
        source: 'course_purchase',
        sourceRef: coursePurchase.id,
      });

      const { result } = await service.delete(row.id, creatorId);

      expect(result.holders).toBe(1);
      expect((await noticesOf(row.id)).map((n) => n.userId)).toEqual([holder]);
    });

    it('deletes at once a piece whose only holder is an erased account', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await erase(holder);

      const { result } = await service.delete(row.id, creatorId);

      expect(result.outcome).toBe('deleted');
      expect(await noticesOf(row.id)).toEqual([]);
    });

    it('writes no row for an erased holder among live ones', async () => {
      const [kept, erased] = await seedTestUsers(db, 2);
      const row = await piece();
      await bought(row.id, kept);
      await bought(row.id, erased);
      await erase(erased);

      const { result } = await service.delete(row.id, creatorId);

      expect(result.holders).toBe(1);
      expect((await noticesOf(row.id)).map((n) => n.userId)).toEqual([kept]);
    });

    it('a second delete of a leaving piece changes nothing', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      const { result: first } = await service.delete(row.id, creatorId);

      const { result: again } = await service.delete(row.id, creatorId);

      expect(again).toEqual(first);
      expect(await noticesOf(row.id)).toHaveLength(1);
    });

    // Owner, review round 3: a delete of a piece already leaving adds its
    // side, so the other side's Keep cannot undo it.
    it('a creator’s delete of a leave an org admin started adds the creator’s side, no new round', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      await orgOnly(row.id);

      await service.delete(row.id, creatorId);

      const after = await stored(row.id);
      expect([after.leavingByCreator, after.leavingByOrg]).toEqual([
        true,
        true,
      ]);
      expect(await noticesOf(row.id)).toHaveLength(1);
    });

    it("refuses another creator's piece as not found", async () => {
      const row = await piece({}, otherCreatorId);

      await expect(service.delete(row.id, creatorId)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect((await stored(row.id)).deletedAt).toBeNull();
    });

    it('cancels a kept piece’s open staying rows', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      expect((await stayingOf(row.id, holder)).open).toBe(1);
      nextDay();

      await service.delete(row.id, creatorId);

      const [staying] = await rowsOf(row.id, holder, 'staying');
      expect(staying?.state).toBe('cancelled');
    });

    // The gap between notice periods (owner 2026-11-19): a delete, a Keep
    // and a delete again inside it would email every owner twice in an hour.
    it('refuses a new notice period inside the gap, writing nothing, and starts it at the gap', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      const start = Date.UTC(2031, 2, 1, 12);
      clockAt(start);
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      clockAt(start + HOUR_MS);
      await service.keep(row.id, creatorId);
      clockAt(start + 2 * HOUR_MS);

      await expect(service.delete(row.id, creatorId)).rejects.toMatchObject({
        ...TOO_SOON,
        context: {
          ...TOO_SOON.context,
          retryAt: new Date(start + GAP_MS).toISOString(),
        },
      });
      // Rolled back whole: still kept, its staying email still open (every
      // delete cancels those), and no second round.
      expect((await stored(row.id)).leavesAt).toBeNull();
      expect((await stayingOf(row.id, holder)).open).toBe(1);
      expect(await rowsOf(row.id, holder, 'leaving')).toHaveLength(1);

      clockAt(start + GAP_MS);
      const { result } = await service.delete(row.id, creatorId);

      expect(result.outcome).toBe('leaving');
      expect(await rowsOf(row.id, holder, 'leaving')).toHaveLength(2);
    });

    // A period kept before any email was tried emailed nobody (owner,
    // review round 2): it starts no gap, so a silent delete and Keep cannot
    // hold off the next delete, the other side's included.
    // `attempts > 0` is "may have been told" (§2), whatever the answer: a
    // try still in flight, or one the sender refused, starts the gap too.
    it.each([
      'in-flight',
      'refused',
    ] as const)('starts the gap from a period whose email was tried (%s)', async (answer) => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving', answer);
      await service.keep(row.id, creatorId);

      await expect(service.delete(row.id, creatorId)).rejects.toMatchObject(
        TOO_SOON
      );
    });

    // The gap runs from the LAST period that emailed anyone, never the first.
    it('measures the gap from the latest emailed period', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      const start = Date.UTC(2031, 4, 1, 12);
      clockAt(start);
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      const second = start + 2 * DAY_MS;
      clockAt(second);
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      clockAt(second + HOUR_MS);

      await expect(service.delete(row.id, creatorId)).rejects.toMatchObject({
        ...TOO_SOON,
        context: {
          ...TOO_SOON.context,
          retryAt: new Date(second + GAP_MS).toISOString(),
        },
      });
    });

    it('starts no gap from a period that emailed nobody', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      await service.keep(row.id, creatorId);

      const { result } = await service.delete(row.id, creatorId);

      expect(result.outcome).toBe('leaving');
      const rounds = await rowsOf(row.id, holder, 'leaving');
      expect(rounds.map((r) => r.state)).toEqual(['due', 'cancelled']);
    });

    it('deletes at once inside the gap when nobody holds it any more: no email to space out', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      await service.keep(row.id, creatorId);
      await erase(holder);

      const { result } = await service.delete(row.id, creatorId);

      expect(result.outcome).toBe('deleted');
      expect((await stored(row.id)).deletedAt).not.toBeNull();
    });

    // Guard (a): a round that ties an earlier one would make DO NOTHING skip
    // every holder that round wrote a row for, so it is refused, and the
    // whole delete with it.
    it.each([
      ['equal to', 0],
      ['later than', 1],
    ])('refuses a leave date %s an earlier round, writing nothing', async (_, after) => {
      const [holder, earlier] = await seedTestUsers(db, 2);
      const row = await piece();
      await bought(row.id, holder);
      const now = new Date('2031-03-01T12:00:00.000Z');
      await db.insert(contentLeavingNotices).values({
        contentId: row.id,
        userId: earlier,
        kind: 'leaving',
        round: new Date(leaveDateFrom(now).getTime() + after),
        state: 'cancelled',
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);

      // Guard (a) by name: guard (b) would refuse it too, as a skipped holder.
      await expect(service.delete(row.id, creatorId)).rejects.toMatchObject({
        ...INTERNAL,
        context: { lastRound: expect.any(String) },
      });

      vi.useRealTimers();
      const stays = await stored(row.id);
      expect(stays.leavesAt).toBeNull();
      expect(stays.status).toBe('published');
      expect(await noticesOf(row.id)).toHaveLength(1);
    });
  });

  describe('assertWroteEveryHolder (guard b)', () => {
    const context = { contentId: randomUUID(), kind: 'leaving' as const };

    it('passes when every holder has a row', () => {
      const log = { error: vi.fn() };
      expect(() => assertWroteEveryHolder(log, context, 3, 3)).not.toThrow();
      expect(log.error).not.toHaveBeenCalled();
    });

    it('logs the counts and throws when a holder was skipped', () => {
      const log = { error: vi.fn() };
      let thrown: unknown;
      try {
        assertWroteEveryHolder(log, context, 3, 2);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject(INTERNAL);
      expect(log.error).toHaveBeenCalledWith(expect.any(String), {
        ...context,
        holders: 3,
        inserted: 2,
      });
    });
  });

  // ── Keep ────────────────────────────────────────────────────────────────

  describe('keep', () => {
    /** A live piece one fresh person bought. */
    async function heldBy() {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      return { row, holder };
    }

    it('clears the date, keeps it off sale and cancels the open leaving rows', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);

      const { result } = await service.keep(row.id, creatorId);

      expect(result).toEqual({ kept: true, staying: 0, stillLeavingBy: null });
      const after = await stored(row.id);
      expect(after.leavesAt).toBeNull();
      expect(after.status).toBe('archived');
      expect(after.offSaleAt).not.toBeNull();
      const [leaving] = await rowsOf(row.id, holder, 'leaving');
      expect(leaving?.state).toBe('cancelled');
    });

    it('writes no staying row when nothing was tried', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);

      await service.keep(row.id, creatorId);

      expect((await stayingOf(row.id, holder)).all).toBe(0);
    });

    it('tells a person whose leaving email is in flight: the cancel lands first', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving', 'in-flight');

      const { result } = await service.keep(row.id, creatorId);

      expect(result.staying).toBe(1);
      const [leaving] = await rowsOf(row.id, holder, 'leaving');
      expect(leaving).toMatchObject({ state: 'cancelled', attempts: 1 });
      expect((await stayingOf(row.id, holder)).open).toBe(1);
    });

    it('writes ONE staying row for a tried leaving AND a tried reminder', async () => {
      const { row, holder } = await heldBy();
      const {
        result: { leavesAt },
      } = await service.delete(row.id, creatorId);
      if (!leavesAt) throw new Error('expected a leave date');
      await db.insert(contentLeavingNotices).values({
        contentId: row.id,
        userId: holder,
        kind: 'reminder',
        round: leavesAt,
      });
      await tick(row.id, holder, 'leaving');
      await tick(row.id, holder, 'reminder', 'in-flight');

      const { result } = await service.keep(row.id, creatorId);

      expect(result.staying).toBe(1);
      expect((await stayingOf(row.id, holder)).all).toBe(1);
    });

    it('writes no staying row for an account erased after its email was tried', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await erase(holder);

      const { result } = await service.keep(row.id, creatorId);

      expect(result.staying).toBe(0);
    });

    // r6 test 1: a refused staying email is not "told it stays".
    it('delete, tick, Keep, staying refused, delete, Keep: tells them again', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      await tick(row.id, holder, 'staying', 'refused');
      nextDay();
      await service.delete(row.id, creatorId);

      const { result } = await service.keep(row.id, creatorId);

      expect(result.staying).toBe(1);
      const staying = await rowsOf(row.id, holder, 'staying');
      expect(staying.map((s) => s.state)).toEqual(['due', 'cancelled']);
    });

    // r6 test 2: a staying email a second delete cancelled is told again.
    it('delete, tick, Keep, delete, Keep, tick: exactly one staying email goes', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      nextDay();
      await service.delete(row.id, creatorId);
      await service.keep(row.id, creatorId);
      await tick(row.id, holder, 'staying');

      const staying = await stayingOf(row.id, holder);
      expect(staying).toEqual({ all: 2, sent: 1, open: 0 });
    });

    // r6 test 3: someone already told it stays is not told twice.
    it('writes none for a person whose newest counting email is a sent staying', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      await tick(row.id, holder, 'staying');
      nextDay();
      await service.delete(row.id, creatorId);

      const { result } = await service.keep(row.id, creatorId);

      expect(result.staying).toBe(0);
    });

    // r7 test 4: the only one where round is compared BEFORE kind. A sent
    // staying email of round 1 must lose to a sent leaving email of round 2.
    it('delete, tick, Keep, tick, delete, tick, Keep: one new staying row', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await service.keep(row.id, creatorId);
      await tick(row.id, holder, 'staying');
      nextDay();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');

      const { result } = await service.keep(row.id, creatorId);

      expect(result.staying).toBe(1);
      expect(await stayingOf(row.id, holder)).toEqual({
        all: 2,
        sent: 1,
        open: 1,
      });
    });

    // Whose delete it is (owners 2026-11-19 and -20): an org admin's is not
    // the creator's to undo. @codex/admin's tests make one through its delete.
    it('refuses to keep a leave holding only an org admin’s delete, writing nothing', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      await orgOnly(row.id);

      await expect(service.keep(row.id, creatorId)).rejects.toMatchObject({
        ...NOT_YOURS,
        context: { ...NOT_YOURS.context, startedBy: 'org' },
      });
      const after = await stored(row.id);
      expect(after.leavesAt).not.toBeNull();
      expect(after.leavingByOrg).toBe(true);
      const [leaving] = await rowsOf(row.id, holder, 'leaving');
      expect(leaving?.state).toBe('sent');
      expect((await stayingOf(row.id, holder)).all).toBe(0);
    });

    it('withdraws only the creator’s delete when an org admin deleted it too: it still leaves', async () => {
      const { row, holder } = await heldBy();
      await service.delete(row.id, creatorId);
      await tick(row.id, holder, 'leaving');
      // Both sides, as an org admin's delete of it while leaving leaves it.
      await db
        .update(content)
        .set({ leavingByOrg: true })
        .where(eq(content.id, row.id));

      const { result } = await service.keep(row.id, creatorId);

      expect(result).toEqual({
        kept: false,
        staying: 0,
        stillLeavingBy: 'org',
      });
      const after = await stored(row.id);
      expect(after.leavesAt).not.toBeNull();
      expect([after.leavingByCreator, after.leavingByOrg]).toEqual([
        false,
        true,
      ]);
      // Its owners were told it leaves, and it does: nothing is cancelled.
      const [leaving] = await rowsOf(row.id, holder, 'leaving');
      expect(leaving?.state).toBe('sent');
      expect((await stayingOf(row.id, holder)).all).toBe(0);
    });

    it('comes back unchanged for a piece that is not leaving', async () => {
      const row = await piece();

      const { result } = await service.keep(row.id, creatorId);

      expect(result).toEqual({ kept: false, staying: 0, stillLeavingBy: null });
      expect((await stored(row.id)).status).toBe('published');
    });

    it("refuses another creator's piece as not found", async () => {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece({}, otherCreatorId);
      await bought(row.id, holder);
      await service.delete(row.id, otherCreatorId);

      await expect(service.keep(row.id, creatorId)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect((await stored(row.id)).leavesAt).not.toBeNull();
    });
  });

  // ── moving a leaving piece ──────────────────────────────────────────────

  // A leave belongs to its org (owner, review round 2): moved to another
  // org, an org admin's leave could be kept by that org's admins and the
  // piece put back on sale; moved to personal, by nobody.
  describe('moving a leaving piece', () => {
    it('refuses a move to another org, or to personal, until it is kept', async () => {
      const otherOrg = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      ).id;
      // On both teams, so only the leave can refuse the move.
      await joinTeam(db, otherOrg, creatorId);
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece({ organizationId: orgId });
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);

      for (const organizationId of [otherOrg, null]) {
        await expect(
          service.update(row.id, { organizationId }, creatorId)
        ).rejects.toMatchObject(LEAVING_REFUSED);
      }
      expect((await stored(row.id)).organizationId).toBe(orgId);

      // A save naming its own org is no move, nor one naming none, nor a
      // bulk access change, whose fields never include the org.
      const saved = await service.update(
        row.id,
        { organizationId: orgId, title: 'Still leaving' },
        creatorId
      );
      expect(saved.title).toBe('Still leaving');
      const retitled = await service.update(
        row.id,
        { title: 'Still leaving, again' },
        creatorId
      );
      expect(retitled.title).toBe('Still leaving, again');
      const access = await service.accessMany([row.id], creatorId, {
        isFree: true,
        isPurchasable: false,
        priceCents: 0,
        isFollowerGated: false,
        isTeamOnly: false,
      });
      expect(access.results.map((r) => r.outcome)).toEqual(['unchanged']);

      await service.keep(row.id, creatorId);
      const moved = await service.update(
        row.id,
        { organizationId: otherOrg },
        creatorId
      );
      expect(moved.organizationId).toBe(otherOrg);
    });
  });

  // ── the day-30 delete ───────────────────────────────────────────────────

  describe('completeLeaving', () => {
    /** A held piece deleted, its date moved to `daysFromNow`. */
    async function leavingIn(daysFromNow: number) {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      const leavesAt = new Date(Date.now() + daysFromNow * DAY_MS);
      await db.update(content).set({ leavesAt }).where(eq(content.id, row.id));
      return { row, leavesAt };
    }

    it('deletes a piece whose day has come, keeping its date; a second run does nothing', async () => {
      const due = await leavingIn(-1);
      const later = await leavingIn(3);
      const kept = await leavingIn(-1);
      await service.keep(kept.row.id, creatorId);

      const first = await service.completeLeaving();
      const again = await service.completeLeaving();

      const ours = [due.row.id, later.row.id, kept.row.id];
      expect(first.filter((p) => ours.includes(p.id))).toEqual([
        { id: due.row.id, organizationId: null, creatorId },
      ]);
      expect(again.filter((p) => ours.includes(p.id))).toEqual([]);
      const gone = await stored(due.row.id);
      expect(gone.deletedAt).not.toBeNull();
      expect(gone.leavesAt?.getTime()).toBe(due.leavesAt.getTime());
      expect((await stored(later.row.id)).deletedAt).toBeNull();
      expect((await stored(kept.row.id)).deletedAt).toBeNull();
    });
  });

  // ── publishing ──────────────────────────────────────────────────────────

  describe('publish', () => {
    async function leaving() {
      const [holder] = await seedTestUsers(db, 1);
      const row = await piece();
      await bought(row.id, holder);
      await service.delete(row.id, creatorId);
      return row;
    }

    it('refuses a leaving piece: Keep it first', async () => {
      const row = await leaving();

      await expect(service.publish(row.id, creatorId)).rejects.toMatchObject(
        LEAVING_REFUSED
      );
      expect((await stored(row.id)).status).toBe('archived');
    });

    it('refuses a publish when ready too, never scheduling it', async () => {
      const row = await leaving();

      await expect(
        service.publish(row.id, creatorId, { whenReady: true })
      ).rejects.toMatchObject(LEAVING_REFUSED);
      expect((await stored(row.id)).publishRequestedAt).toBeNull();
    });

    it('publishes once it is kept', async () => {
      const row = await leaving();
      await service.keep(row.id, creatorId);

      const live = await service.publish(row.id, creatorId);

      expect(live.status).toBe('published');
    });
  });

  describe('"Needs you"', () => {
    it('never lists a leaving draft as ready to publish', async () => {
      const [holder] = await seedTestUsers(db, 1);
      const tag = `ready-${randomUUID().slice(0, 8)}`;
      const row = await piece({
        title: `${tag} draft`,
        status: 'draft',
        publishedAt: null,
      });
      await db.insert(entitlements).values({
        userId: holder,
        contentId: row.id,
        source: 'grant',
      });
      const ready = () =>
        service.list(
          creatorId,
          { needs: 'ready', search: tag },
          { page: 1, limit: 10 }
        );
      expect((await ready()).items.map((r) => r.id)).toEqual([row.id]);

      await service.delete(row.id, creatorId);

      expect((await ready()).items).toEqual([]);
    });
  });
});
