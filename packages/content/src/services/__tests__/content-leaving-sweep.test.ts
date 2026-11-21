/**
 * The leaving notice's sweep (Codex-a6ofh.6.4, design §5) against a real
 * Postgres, so every CHECK on the notice table judges what it writes: the
 * claim (its try counted first, its lease), the per-kind "still true" rule,
 * each answer's state and reason, the tries running out, the day-27
 * reminders, the library bumps past the delete's 500 and on day 30, a tick
 * that breaks after its claim, and overlapping ticks.
 *
 * The claim is global by design, so every sweep here is scoped to its own
 * pieces (`onlyContentIds`). Database: the throwaway ln4_scratch locally,
 * the CI branch in CI. Every row it makes is its own, deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import type { VersionedCache } from '@codex/cache';
import type { ContentLeavingNoticeKind } from '@codex/constants';
import {
  content,
  contentLeavingNotices,
  organizations,
  purchases,
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
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseTransaction, NewContent } from '../../types';
import { takedownPiece } from '../content-leaving';
import {
  ContentLeavingNoticeService,
  type ContentLeavingNoticeServiceConfig,
  type LeavingNoticeDelivery,
  type LeavingNoticeEmail,
  type LeavingNoticeLinker,
  leaveDateOf,
} from '../content-leaving-sweep';
import { ContentService } from '../content-service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ACCEPTED: LeavingNoticeDelivery = { accepted: true };

type Logged = { warn: (...args: unknown[]) => void } & {
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
};
/** A service's own logger (BaseService builds it), to spy on. */
const obsOf = (service: ContentLeavingNoticeService) =>
  (service as unknown as { obs: Logged }).obs;

/** The real linker's three cases (worker-utils' `leavingNoticeLinkFor`). */
const pageOf: LeavingNoticeLinker = ({
  slug,
  organizationSlug,
  creatorUsername,
}) => {
  if (organizationSlug) {
    return `https://${organizationSlug}.example.test/content/${slug}`;
  }
  if (creatorUsername) {
    return `https://creators.example.test/@${creatorUsername}/content/${slug}`;
  }
  return 'https://example.test/library';
};

/** A cache that records each key bumped. */
function recordingCache() {
  const bumped: string[] = [];
  const cache = {
    invalidate: vi.fn(async (id: string) => {
      bumped.push(id);
    }),
  } as unknown as VersionedCache;
  return { cache, bumped };
}

describe('ContentLeavingNoticeService: the leaving sweep', () => {
  let db: Database;
  let contentService: ContentService;
  let creatorId: string;
  let orgId: string;
  let orgName: string;
  const contentIds: string[] = [];
  const purchaseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    contentService = new ContentService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    orgId = org.id;
    orgName = org.name;
    await joinTeam(db, orgId, creatorId);
  });

  afterAll(async () => {
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (contentIds.length > 0) {
      // The notices hold the content row (restrict), so they go first.
      await db
        .delete(contentLeavingNotices)
        .where(inArray(contentLeavingNotices.contentId, contentIds));
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ────────────────────────────────────────────────────────────

  /** A live org article (download on), so its email reads "Save it as a PDF". */
  async function piece(overrides: Partial<NewContent> = {}) {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            contentType: 'written',
            title: `Sweep ${randomUUID().slice(0, 8)}`,
            status: 'published',
            publishedAt: new Date(),
            organizationId: orgId,
            ...overrides,
          })
        )
        .returning()
    );
    contentIds.push(row.id);
    return row;
  }

  async function bought(contentId: string, customerIds: string[]) {
    const rows = await db
      .insert(purchases)
      .values(
        customerIds.map((customerId) => ({
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
        }))
      )
      .returning({ id: purchases.id });
    purchaseIds.push(...rows.map((row) => row.id));
  }

  /** A piece `holders` people bought, deleted by its creator: leaving. */
  async function leaving(holders = 1, overrides: Partial<NewContent> = {}) {
    const people = await seedTestUsers(db, holders);
    const row = await piece(overrides);
    await bought(row.id, people);
    const { result } = await contentService.delete(row.id, creatorId);
    expect(result.outcome).toBe('leaving');
    const [holder] = people;
    if (!holder) throw new Error('no holder seeded');
    return { row, people, holder, leavesAt: result.leavesAt };
  }

  const noticesOf = (contentId: string) =>
    db
      .select()
      .from(contentLeavingNotices)
      .where(eq(contentLeavingNotices.contentId, contentId));

  const noticeOf = async (
    contentId: string,
    userId: string,
    kind: ContentLeavingNoticeKind = 'leaving'
  ) =>
    takeFirst(
      await db
        .select()
        .from(contentLeavingNotices)
        .where(
          and(
            eq(contentLeavingNotices.contentId, contentId),
            eq(contentLeavingNotices.userId, userId),
            eq(contentLeavingNotices.kind, kind)
          )
        )
    );

  const setNotice = (
    id: string,
    values: Partial<typeof contentLeavingNotices.$inferInsert>
  ) =>
    db
      .update(contentLeavingNotices)
      .set(values)
      .where(eq(contentLeavingNotices.id, id));

  /**
   * A sweep over `ids` alone, accepting every email unless told. `mailer` is
   * the default one, called only when no other is given.
   */
  function sweepOf(
    ids: string[],
    overrides: Partial<ContentLeavingNoticeServiceConfig> = {}
  ) {
    const mailer = vi.fn(
      async (_email: LeavingNoticeEmail): Promise<LeavingNoticeDelivery> =>
        ACCEPTED
    );
    const service = new ContentLeavingNoticeService({
      db,
      environment: 'test',
      mailer,
      contentUrlFor: pageOf,
      onlyContentIds: ids,
      ...overrides,
    });
    return { service, mailer };
  }

  // ── the claim ───────────────────────────────────────────────────────────

  describe('the claim', () => {
    it('counts the try at claim time, before the email goes', async () => {
      const { row, holder, leavesAt } = await leaving(1);
      const inFlight: Array<{ state: string; attempts: number }> = [];
      const { service } = sweepOf([row.id], {
        mailer: async () => {
          const notice = await noticeOf(row.id, holder);
          expect(notice.attemptedAt).toBeInstanceOf(Date);
          inFlight.push({ state: notice.state, attempts: notice.attempts });
          return ACCEPTED;
        },
      });

      const tally = await service.sendDue();

      expect(inFlight).toEqual([{ state: 'due', attempts: 1 }]);
      expect(tally).toMatchObject({ claimed: 1, sent: 1, more: false });
      const sent = await noticeOf(row.id, holder);
      expect(sent).toMatchObject({ state: 'sent', attempts: 1 });
      expect(sent.sentAt).not.toBeNull();
      expect(leavesAt).not.toBeNull();
    });

    it('writes the leaving email from the piece and its owner', async () => {
      const { row, holder, leavesAt } = await leaving(1);
      const { service, mailer } = sweepOf([row.id]);

      await service.sendDue();

      const [person] = await db
        .select()
        .from(users)
        .where(eq(users.id, holder));
      expect(mailer).toHaveBeenCalledTimes(1);
      expect(mailer.mock.calls[0]?.[0]).toEqual({
        to: person?.email,
        toName: person?.name,
        templateName: 'content-leaving',
        category: 'transactional',
        userId: holder,
        organizationId: orgId,
        data: {
          userName: person?.name,
          contentTitle: row.title,
          creatorName: orgName,
          contentUrl: expect.stringContaining(`/content/${row.slug}`),
          leaveDate: leavesAt ? leaveDateOf(leavesAt) : '',
          actionLabel: 'Save it as a PDF',
        },
      });
    });

    it('leaves a notice claimed under 6 hours ago alone, and takes it after', async () => {
      const { row, holder } = await leaving(1);
      const notice = await noticeOf(row.id, holder);
      await setNotice(notice.id, {
        state: 'unknown',
        lastReason: 'unknown',
        attempts: 1,
        attemptedAt: new Date(Date.now() - HOUR_MS),
      });
      const { service, mailer } = sweepOf([row.id]);

      expect(await service.sendDue()).toMatchObject({ claimed: 0 });
      expect(mailer).not.toHaveBeenCalled();

      await setNotice(notice.id, {
        attemptedAt: new Date(Date.now() - 7 * HOUR_MS),
      });
      expect(await service.sendDue()).toMatchObject({ claimed: 1, sent: 1 });
      expect(await noticeOf(row.id, holder)).toMatchObject({
        state: 'sent',
        attempts: 2,
        lastReason: null,
      });
    });

    it('gives back the claims left when the send budget runs out, untried', async () => {
      const { row, people } = await leaving(5);
      const start = Date.now();
      // The tick's start and its first batch inside the budget; after that,
      // past it.
      const times = [start, start];
      const { service, mailer } = sweepOf([row.id], {
        clock: () => times.shift() ?? start + 10 * 60 * 1000,
        limits: { batch: 2 },
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      const tally = await service.sendDue();

      expect(tally).toMatchObject({ claimed: 5, sent: 2, givenBack: 3 });
      expect(mailer).toHaveBeenCalledTimes(2);
      const rows = await noticesOf(row.id);
      const unsent = rows.filter((notice) => notice.state === 'due');
      expect(unsent).toHaveLength(3);
      for (const notice of unsent) {
        expect(notice).toMatchObject({ attempts: 0, attemptedAt: null });
      }
      expect(people).toHaveLength(5);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('send budget ran out'),
        expect.objectContaining({ givenBack: 3 })
      );
    });

    it('gives back a notice it has no link to write, untried, with one error', async () => {
      const { row, people } = await leaving(1);
      const { service, mailer } = sweepOf([row.id], {
        contentUrlFor: () => null,
      });
      const error = vi.spyOn(obsOf(service), 'error');

      const tally = await service.sendDue();

      expect(tally).toMatchObject({ claimed: 1, givenBack: 1, errors: 1 });
      expect(mailer).not.toHaveBeenCalled();
      expect(await noticeOf(row.id, people[0] ?? '')).toMatchObject({
        state: 'due',
        attempts: 0,
        attemptedAt: null,
      });
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('a tick that breaks after its claim gives back every notice not yet sending', async () => {
      const { row, people } = await leaving(2);
      // The libraries' cache fails between the claim and the first send.
      const cache = {
        invalidate: vi.fn(async () => {
          throw new Error('KV unavailable');
        }),
      } as unknown as VersionedCache;
      const { service, mailer } = sweepOf([row.id], { cache });
      const error = vi.spyOn(obsOf(service), 'error');

      const tally = await service.sendDue();

      expect(tally).toMatchObject({
        claimed: 2,
        givenBack: 2,
        errors: 1,
        sent: 0,
      });
      expect(mailer).not.toHaveBeenCalled();
      for (const holder of people) {
        expect(await noticeOf(row.id, holder)).toMatchObject({
          state: 'due',
          attempts: 0,
          attemptedAt: null,
        });
      }
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('broke after its claim'),
        expect.objectContaining({
          claimed: 2,
          sendsStarted: 0,
          givenBack: 2,
          stack: expect.stringContaining('KV unavailable'),
        })
      );
    });

    it('a tick that breaks mid-send never gives back a notice whose send started', async () => {
      const { row, people } = await leaving(2);
      const mailed: string[] = [];
      const { service } = sweepOf([row.id], {
        limits: { batch: 1 },
        mailer: async (email) => {
          mailed.push(email.userId);
          return ACCEPTED;
        },
      });
      const internals = service as unknown as {
        record: () => Promise<boolean>;
        recipientsOf: (userIds: string[]) => Promise<unknown>;
      };
      // Batch 1's email goes, but its answer can't be written: it stays
      // open, its try counted, and it may have been told.
      vi.spyOn(internals, 'record').mockRejectedValueOnce(
        new Error('write failed')
      );
      // Batch 2's people can't be read: the tick breaks before its send.
      const recipientsOf = internals.recipientsOf.bind(service);
      let reads = 0;
      vi.spyOn(internals, 'recipientsOf').mockImplementation(
        async (userIds) => {
          reads += 1;
          if (reads === 2) throw new Error('database unavailable');
          return recipientsOf(userIds);
        }
      );

      const tally = await service.sendDue();

      expect(tally).toMatchObject({ claimed: 2, givenBack: 1, errors: 2 });
      expect(mailed).toHaveLength(1);
      const told = mailed[0] ?? '';
      const untold = people.find((id) => id !== told) ?? '';
      expect(await noticeOf(row.id, told)).toMatchObject({
        state: 'due',
        attempts: 1,
      });
      expect(await noticeOf(row.id, untold)).toMatchObject({
        state: 'due',
        attempts: 0,
        attemptedAt: null,
      });
    });
  });

  // ── the per-kind rule ───────────────────────────────────────────────────

  describe('a notice no longer true', () => {
    it('is cancelled with a warn, per kind, never sent; a removed one always goes', async () => {
      // leaving: the piece now leaves on another day (its round is stale).
      const moved = await leaving(1);
      await db
        .update(content)
        .set({
          leavesAt: new Date((moved.leavesAt?.getTime() ?? 0) + DAY_MS),
        })
        .where(eq(content.id, moved.row.id));
      // leaving: the piece was deleted on its day before the email went.
      const gone = await leaving(1);
      await db
        .update(content)
        .set({ deletedAt: new Date() })
        .where(eq(content.id, gone.row.id));
      // staying: the piece is leaving again (a race past the delete's cancel).
      const again = await leaving(1);
      const againHolder = again.holder;
      await db.insert(contentLeavingNotices).values({
        contentId: again.row.id,
        userId: againHolder,
        kind: 'staying',
        round: new Date(Date.now() - DAY_MS),
      });
      // removed: always true, on a piece deleted at once.
      const takenDown = await piece();
      const [owner] = await seedTestUsers(db, 1);
      await db.insert(contentLeavingNotices).values({
        contentId: takenDown.id,
        userId: owner,
        kind: 'removed',
        round: new Date(),
      });
      await db
        .update(content)
        .set({ deletedAt: new Date() })
        .where(eq(content.id, takenDown.id));

      const { service, mailer } = sweepOf([
        moved.row.id,
        gone.row.id,
        again.row.id,
        takenDown.id,
      ]);
      const warn = vi.spyOn(obsOf(service), 'warn');

      const tally = await service.sendDue();

      // The staying row is cancelled; the piece's own leaving row still goes.
      expect(tally).toMatchObject({ cancelled: 3, claimed: 2, sent: 2 });
      expect(
        mailer.mock.calls.map(([email]) => email.templateName).sort()
      ).toEqual(['content-leaving', 'content-removed']);
      expect((await noticeOf(moved.row.id, moved.holder)).state).toBe(
        'cancelled'
      );
      expect((await noticeOf(gone.row.id, gone.holder)).state).toBe(
        'cancelled'
      );
      const staying = await noticeOf(again.row.id, againHolder, 'staying');
      expect(staying.state).toBe('cancelled');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('cancelled'),
        expect.objectContaining({
          noticeId: staying.id,
          contentId: again.row.id,
          kind: 'staying',
          attempts: 0,
          lastReason: null,
        })
      );
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('a takedown cancels its own notices, so the next tick only sends "removed", with no warn', async () => {
      const { row, people } = await leaving(2);
      await db.transaction((tx) =>
        takedownPiece(tx as unknown as DatabaseTransaction, row.id, {
          error: () => undefined,
        })
      );
      const { service, mailer } = sweepOf([row.id]);
      const warn = vi.spyOn(obsOf(service), 'warn');

      const tally = await service.sendDue();

      expect(tally).toMatchObject({ cancelled: 0, claimed: 2, sent: 2 });
      expect(warn).not.toHaveBeenCalled();
      const [first] = mailer.mock.calls;
      // The platform's own words, never the org's template of that name.
      expect(first?.[0]).toMatchObject({
        templateName: 'content-removed',
        platformTemplate: true,
        organizationId: orgId,
        data: { contentTitle: row.title },
      });
      expect(Object.keys(first?.[0].data ?? {}).sort()).toEqual([
        'contentTitle',
        'userName',
      ]);
      for (const holder of people) {
        expect((await noticeOf(row.id, holder)).state).toBe('cancelled');
        expect((await noticeOf(row.id, holder, 'removed')).state).toBe('sent');
      }
    });

    it('past the first 50, one line keeps every id and counts them by kind, try and reason', async () => {
      const moved = await leaving(52);
      await db
        .update(content)
        .set({
          leavesAt: new Date((moved.leavesAt?.getTime() ?? 0) + DAY_MS),
        })
        .where(eq(content.id, moved.row.id));
      const { service } = sweepOf([moved.row.id]);
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(await service.sendDue()).toMatchObject({ cancelled: 52 });

      const folded = warn.mock.calls.find(([message]) =>
        String(message).includes('more notices were cancelled')
      )?.[1] as { noticeIds: string[] } | undefined;
      expect(folded).toMatchObject({
        notices: 2,
        contentIds: [moved.row.id],
        counts: { 'leaving/untried/none': 2 },
      });
      expect(folded?.noticeIds).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(51);
    }, 30_000);

    it('a Keep sends "staying" to whoever was told it leaves', async () => {
      const { row, holder } = await leaving(1);
      const { service, mailer } = sweepOf([row.id]);
      await service.sendDue();
      await contentService.keep(row.id, creatorId);

      expect(await service.sendDue()).toMatchObject({ claimed: 1, sent: 1 });

      expect(mailer.mock.calls[1]?.[0]).toMatchObject({
        templateName: 'content-staying',
        userId: holder,
        data: {
          contentTitle: row.title,
          creatorName: orgName,
          contentUrl: expect.stringContaining(`/content/${row.slug}`),
        },
      });
      expect(Object.keys(mailer.mock.calls[1]?.[0].data ?? {}).sort()).toEqual([
        'contentTitle',
        'contentUrl',
        'creatorName',
        'userName',
      ]);
    });
  });

  // ── the answers ─────────────────────────────────────────────────────────

  describe('the answers', () => {
    it('writes every answer as its state and reason', async () => {
      const { row, people } = await leaving(5);
      const answers: LeavingNoticeDelivery[] = [
        { accepted: true },
        { accepted: false, status: 422 },
        { accepted: false, skipped: 'opted_out' },
        { accepted: false, status: 503 },
        { accepted: false, error: 'The operation timed out' },
      ];
      const answerFor = new Map(people.map((id, i) => [id, answers[i]]));
      const { service } = sweepOf([row.id], {
        mailer: async (email) => answerFor.get(email.userId) ?? ACCEPTED,
      });

      const tally = await service.sendDue();

      expect(tally).toMatchObject({
        claimed: 5,
        sent: 1,
        failed: 2,
        unknown: 2,
      });
      const outcome = async (i: number) => {
        const notice = await noticeOf(row.id, people[i] ?? '');
        return [notice.state, notice.lastReason, notice.attempts];
      };
      expect(await outcome(0)).toEqual(['sent', null, 1]);
      expect(await outcome(1)).toEqual(['failed', 'refused', 1]);
      expect(await outcome(2)).toEqual(['failed', 'skipped', 1]);
      expect(await outcome(3)).toEqual(['unknown', 'unknown', 1]);
      expect(await outcome(4)).toEqual(['unknown', 'unknown', 1]);
    });

    it('a mailer that throws counts as no answer, its error text never logged', async () => {
      const { row, people } = await leaving(1);
      const { service } = sweepOf([row.id], {
        mailer: async () => {
          throw new Error('socket hang up');
        },
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(await service.sendDue()).toMatchObject({ unknown: 1 });
      expect(await noticeOf(row.id, people[0] ?? '')).toMatchObject({
        state: 'unknown',
        lastReason: 'unknown',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('socket hang up');
    });

    it('logs what the answer was: a 404 with its template name', async () => {
      const { row } = await leaving(1);
      const { service } = sweepOf([row.id], {
        mailer: async () => ({ accepted: false, status: 404 }),
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(await service.sendDue()).toMatchObject({ failed: 1 });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not accepted'),
        expect.objectContaining({
          status: 404,
          templateName: 'content-leaving',
          reason: 'refused',
        })
      );
    });

    it('abandons an erased account at once, never mailing it', async () => {
      const { row, holder } = await leaving(1);
      await db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, holder));
      const { service, mailer } = sweepOf([row.id]);

      expect(await service.sendDue()).toMatchObject({
        claimed: 1,
        abandoned: 1,
      });
      expect(mailer).not.toHaveBeenCalled();
      expect(await noticeOf(row.id, holder)).toMatchObject({
        state: 'abandoned',
        lastReason: 'no_address',
        attempts: 1,
      });
    });

    it('an account erased while the tick sends is not mailed: each batch reads its people again', async () => {
      const { row, people } = await leaving(2);
      const mailed: string[] = [];
      const { service } = sweepOf([row.id], {
        limits: { batch: 1 },
        mailer: async (email) => {
          mailed.push(email.userId);
          // The other owner erases their account between the two batches.
          const other = people.find((id) => id !== email.userId) ?? '';
          await db
            .update(users)
            .set({ deletedAt: new Date() })
            .where(eq(users.id, other));
          return ACCEPTED;
        },
      });

      expect(await service.sendDue()).toMatchObject({
        claimed: 2,
        sent: 1,
        abandoned: 1,
      });
      expect(mailed).toHaveLength(1);
      const erased = people.find((id) => id !== mailed[0]) ?? '';
      expect(await noticeOf(row.id, erased)).toMatchObject({
        state: 'abandoned',
        lastReason: 'no_address',
      });
    });

    it('the fifth try ends the notice with its own answer', async () => {
      const { row, holder } = await leaving(1);
      const notice = await noticeOf(row.id, holder);
      await setNotice(notice.id, {
        state: 'unknown',
        lastReason: 'unknown',
        attempts: 4,
        attemptedAt: new Date(Date.now() - 7 * HOUR_MS),
      });
      const { service } = sweepOf([row.id], {
        mailer: async () => ({ accepted: false, status: 422 }),
      });
      const error = vi.spyOn(obsOf(service), 'error');

      expect(await service.sendDue()).toMatchObject({ abandoned: 1 });
      expect(await noticeOf(row.id, holder)).toMatchObject({
        state: 'abandoned',
        lastReason: 'refused',
        attempts: 5,
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('abandoned after its tries'),
        expect.objectContaining({ noticeId: notice.id, reason: 'refused' })
      );
    });

    it('a fifth try with no answer is logged as maybe gone, never as not told', async () => {
      const { row, holder } = await leaving(1);
      const notice = await noticeOf(row.id, holder);
      await setNotice(notice.id, {
        state: 'unknown',
        lastReason: 'unknown',
        attempts: 4,
        attemptedAt: new Date(Date.now() - 7 * HOUR_MS),
      });
      const { service } = sweepOf([row.id], {
        mailer: async () => ({ accepted: false, status: 503 }),
      });
      const error = vi.spyOn(obsOf(service), 'error');

      expect(await service.sendDue()).toMatchObject({ abandoned: 1 });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('it may have gone'),
        expect.objectContaining({ noticeId: notice.id, reason: 'unknown' })
      );
      expect(error).not.toHaveBeenCalledWith(
        expect.stringContaining('was not told'),
        expect.anything()
      );
    });

    it('abandons one found open after five tries as unknown, never its older reason', async () => {
      const { row, holder } = await leaving(1);
      const notice = await noticeOf(row.id, holder);
      // Its fifth try was cut off before an answer: it may have gone.
      await setNotice(notice.id, {
        state: 'failed',
        lastReason: 'refused',
        attempts: 5,
        attemptedAt: new Date(Date.now() - 7 * HOUR_MS),
      });
      const { service, mailer } = sweepOf([row.id]);
      const error = vi.spyOn(obsOf(service), 'error');

      expect(await service.sendDue()).toMatchObject({
        abandoned: 1,
        claimed: 0,
      });
      expect(mailer).not.toHaveBeenCalled();
      expect(await noticeOf(row.id, holder)).toMatchObject({
        state: 'abandoned',
        lastReason: 'unknown',
        attempts: 5,
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('the last one cut off'),
        expect.objectContaining({ noticeId: notice.id })
      );
    });

    it('does not write an answer over a notice that closed in flight', async () => {
      const { row, holder } = await leaving(1);
      const { service } = sweepOf([row.id], {
        mailer: async () => {
          await db
            .update(contentLeavingNotices)
            .set({ state: 'cancelled' })
            .where(
              and(
                eq(contentLeavingNotices.contentId, row.id),
                eq(contentLeavingNotices.userId, holder)
              )
            );
          return ACCEPTED;
        },
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(await service.sendDue()).toMatchObject({
        claimed: 1,
        sent: 0,
        notRecorded: 1,
      });
      expect(await noticeOf(row.id, holder)).toMatchObject({
        state: 'cancelled',
        attempts: 1,
        sentAt: null,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not written'),
        expect.objectContaining({ answered: 'sent' })
      );
    });
  });

  // ── the reminders ───────────────────────────────────────────────────────

  describe('the day-27 reminders', () => {
    /** The piece now leaves at `at`: its date and its leaving rows' round. */
    async function leavesOn(contentId: string, at: Date) {
      await db
        .update(contentLeavingNotices)
        .set({ round: at })
        .where(eq(contentLeavingNotices.contentId, contentId));
      await db
        .update(content)
        .set({ leavesAt: at })
        .where(eq(content.id, contentId));
    }

    it('go to whoever holds it now, once per piece and round, never an erased account', async () => {
      const soon = await leaving(2);
      await leavesOn(soon.row.id, new Date(Date.now() + 2 * DAY_MS));
      const [kept, erased] = soon.people;
      await db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, erased ?? ''));
      const [lateJoiner, laterStill] = await seedTestUsers(db, 2);
      await bought(soon.row.id, [lateJoiner]);
      const notYet = await leaving(1);
      const { service } = sweepOf([soon.row.id, notYet.row.id]);

      expect(await service.addReminders()).toBe(2);

      const reminders = (await noticesOf(soon.row.id)).filter(
        (notice) => notice.kind === 'reminder'
      );
      expect(reminders.map((notice) => notice.userId).sort()).toEqual(
        [kept, lateJoiner].sort()
      );
      for (const reminder of reminders) {
        expect(reminder.round.getTime()).toBe(
          (await noticeOf(soon.row.id, kept ?? '')).round.getTime()
        );
      }
      expect(
        (await noticesOf(notYet.row.id)).filter((n) => n.kind === 'reminder')
      ).toEqual([]);

      // Someone who comes to own it after the reminders went out is not added.
      await bought(soon.row.id, [laterStill]);
      expect(await service.addReminders()).toBe(0);
    });

    it('two overlapping adds write each person once and refuse neither', async () => {
      const soon = await leaving(3);
      await leavesOn(soon.row.id, new Date(Date.now() + DAY_MS));
      const first = sweepOf([soon.row.id]).service;
      const second = sweepOf([soon.row.id]).service;

      const added = await Promise.all([
        first.addReminders(),
        second.addReminders(),
      ]);

      expect(added[0] + added[1]).toBe(3);
      const reminders = (await noticesOf(soon.row.id)).filter(
        (notice) => notice.kind === 'reminder'
      );
      expect(reminders).toHaveLength(3);
    });

    it('a reminder goes as the leaving email does, its own template', async () => {
      const soon = await leaving(1);
      const at = new Date(Date.now() + 2 * DAY_MS);
      await leavesOn(soon.row.id, at);
      const { service, mailer } = sweepOf([soon.row.id]);
      await service.sendDue();
      await service.addReminders();

      expect(await service.sendDue()).toMatchObject({ claimed: 1, sent: 1 });
      expect(mailer.mock.calls[1]?.[0]).toMatchObject({
        templateName: 'content-leaving-reminder',
        data: { leaveDate: leaveDateOf(at), actionLabel: 'Save it as a PDF' },
      });
    });

    it("a deleted org's piece is sent with no org: it links the owner's library and names its creator, once another org takes its slug", async () => {
      const gone = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, gone.id, creatorId);
      const soon = await leaving(1, { organizationId: gone.id });
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, gone.id));
      // Slugs are unique among live orgs only.
      const taker = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput({ slug: gone.slug }))
          .returning()
      );
      await leavesOn(soon.row.id, new Date(Date.now() + 2 * DAY_MS));
      const { service, mailer } = sweepOf([soon.row.id]);
      await service.sendDue();
      await service.addReminders();

      expect(await service.sendDue()).toMatchObject({ claimed: 1, sent: 1 });

      const [creator] = await db
        .select()
        .from(users)
        .where(eq(users.id, creatorId));
      expect(taker.slug).toBe(gone.slug);
      // Never represented (owner 2026-11-21): no id, so the platform's brand
      // and wording, never the dead org's (or the new tenant's).
      expect(mailer.mock.calls[1]?.[0]).toMatchObject({
        templateName: 'content-leaving-reminder',
        organizationId: null,
        data: {
          contentUrl: 'https://example.test/library',
          creatorName: creator?.name,
        },
      });
      expect(mailer.mock.calls[0]?.[0]).toMatchObject({
        templateName: 'content-leaving',
        organizationId: null,
      });
    });

    it('an org deleted while the tick sends is not represented in the batches after', async () => {
      const going = takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );
      await joinTeam(db, going.id, creatorId);
      const { row } = await leaving(2, { organizationId: going.id });
      const mailer = vi.fn(
        async (_email: LeavingNoticeEmail): Promise<LeavingNoticeDelivery> => {
          // The org is deleted between the first batch and the second.
          await db
            .update(organizations)
            .set({ deletedAt: new Date() })
            .where(eq(organizations.id, going.id));
          return ACCEPTED;
        }
      );
      const { service } = sweepOf([row.id], { limits: { batch: 1 }, mailer });

      expect(await service.sendDue()).toMatchObject({ claimed: 2, sent: 2 });

      const [creator] = await db
        .select()
        .from(users)
        .where(eq(users.id, creatorId));
      const [first, second] = mailer.mock.calls.map(([email]) => email);
      expect(first).toMatchObject({
        organizationId: going.id,
        data: {
          creatorName: going.name,
          contentUrl: `https://${going.slug}.example.test/content/${row.slug}`,
        },
      });
      expect(second).toMatchObject({
        organizationId: null,
        data: {
          creatorName: creator?.name,
          contentUrl: 'https://example.test/library',
        },
      });
    });
  });

  // ── the libraries ───────────────────────────────────────────────────────

  describe("the owners' libraries", () => {
    it('bumps every owner of a piece over the delete’s 500 once, a capped batch a tick', async () => {
      const { row, people } = await leaving(505);
      const { cache, bumped } = recordingCache();
      const cap = 250;
      const { service, mailer } = sweepOf([row.id], {
        cache,
        limits: { libraryBumps: cap },
      });

      const ticks = [];
      for (let tick = 0; tick < 5; tick++) {
        const tally = await service.sendDue();
        ticks.push(tally.librariesBumped);
        if (tally.claimed === 0) break;
      }

      expect(ticks[0]).toBe(cap);
      expect(Math.max(...ticks)).toBeLessThanOrEqual(cap);
      expect(bumped).toHaveLength(505);
      expect(new Set(bumped)).toEqual(
        new Set(people.map((id) => `user:${id}:library`))
      );
      expect(mailer).toHaveBeenCalledTimes(505);
      const states = (await noticesOf(row.id)).map((notice) => notice.state);
      expect(new Set(states)).toEqual(new Set(['sent']));
    }, 60_000);

    it('counts only the bumps that landed', async () => {
      const { row, people } = await leaving(3);
      const refused = `user:${people[0]}:library`;
      const cache = {
        invalidate: vi.fn(
          async (id: string, options?: { onError?: (e: unknown) => void }) => {
            // As VersionedCache does with a failed put: logs, then tells.
            if (id === refused) options?.onError?.(new Error('KV 429'));
          }
        ),
      } as unknown as VersionedCache;
      const { service } = sweepOf([row.id], { cache });

      expect(await service.sendDue()).toMatchObject({
        claimed: 3,
        librariesBumped: 2,
      });
    });

    it('day 30 bumps every owner, read in pages, with no 500 cap', async () => {
      const { row, people } = await leaving(5);
      const { cache, bumped } = recordingCache();
      // Pages of 2 stand in for the real 500: five owners take three pages.
      const { service } = sweepOf([row.id], {
        cache,
        limits: { holdersPage: 2 },
      });

      expect(await service.bumpOwnersOf([row.id])).toBe(5);
      expect(bumped.sort()).toEqual(
        people.map((id) => `user:${id}:library`).sort()
      );
    });

    it("day 30 past the tick's bumps: one warn names the pieces and how many were not bumped", async () => {
      const big = await leaving(5);
      const small = await leaving(1);
      const ids = [big.row.id, small.row.id];
      const { cache, bumped } = recordingCache();
      const { service } = sweepOf(ids, {
        cache,
        limits: { holdersPage: 2, completionBumps: 3 },
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(await service.bumpOwnersOf(ids)).toBe(3);

      expect(new Set(bumped).size).toBe(3);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not all bumped'),
        { contentIds: ids, bumped: 3, notBumped: 3, ranOut: 'bumps' }
      );
    });

    it('day 30 out of time: no page starts after the deadline, and one warn says how many were not bumped', async () => {
      const { row } = await leaving(5);
      const { cache, bumped } = recordingCache();
      const start = Date.now();
      // The first page starts in time; by the second, the deadline is past.
      const times = [start];
      const { service } = sweepOf([row.id], {
        cache,
        limits: { holdersPage: 2 },
        clock: () => times.shift() ?? start + 60_000,
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(
        await service.bumpOwnersOf([row.id], { until: start + 1_000 })
      ).toBe(2);

      expect(bumped).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not all bumped'),
        { contentIds: [row.id], bumped: 2, notBumped: 3, ranOut: 'time' }
      );
    });

    it('day 30 out of time inside a page: the deadline is checked between chunks of 50', async () => {
      const { row } = await leaving(60);
      const { cache, bumped } = recordingCache();
      const start = Date.now();
      // The page starts in time; by the end of its first chunk, it is past.
      const times = [start];
      const { service } = sweepOf([row.id], {
        cache,
        clock: () => times.shift() ?? start + 60_000,
      });
      const warn = vi.spyOn(obsOf(service), 'warn');

      expect(
        await service.bumpOwnersOf([row.id], { until: start + 1_000 })
      ).toBe(50);

      expect(bumped).toHaveLength(50);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not all bumped'),
        { contentIds: [row.id], bumped: 50, notBumped: 10, ranOut: 'time' }
      );
    }, 30_000);
  });

  // ── overlapping ticks ───────────────────────────────────────────────────

  describe('overlapping ticks', () => {
    it('mail each notice once when they run at the same time', async () => {
      const { row, people } = await leaving(6);
      const mailed: string[] = [];
      const slowMailer = async (email: LeavingNoticeEmail) => {
        mailed.push(email.userId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return ACCEPTED;
      };
      const first = sweepOf([row.id], { mailer: slowMailer }).service;
      const second = sweepOf([row.id], { mailer: slowMailer }).service;

      const [a, b] = await Promise.all([first.sendDue(), second.sendDue()]);

      expect(a.claimed + b.claimed).toBe(6);
      expect(mailed.sort()).toEqual([...people].sort());
    });

    it('a tick started while emails are in flight claims none of them', async () => {
      const { row, people } = await leaving(3);
      const second = sweepOf([row.id]);
      let secondTally: Awaited<
        ReturnType<ContentLeavingNoticeService['sendDue']>
      > | null = null;
      // The first tick's first email waits for a whole second tick.
      const barrier = async () => {
        if (!secondTally) secondTally = await second.service.sendDue();
        return ACCEPTED;
      };
      const first = sweepOf([row.id], { mailer: barrier });

      const tally = await first.service.sendDue();

      expect(tally).toMatchObject({ claimed: 3, sent: 3 });
      expect(secondTally).toMatchObject({ claimed: 0, sent: 0 });
      expect(second.mailer).not.toHaveBeenCalled();
      expect(people).toHaveLength(3);
    });

    it('two day-30 runs at once delete each due piece once', async () => {
      const due = [await leaving(1), await leaving(1), await leaving(1)];
      for (const { row } of due) {
        await db
          .update(content)
          .set({ leavesAt: new Date(Date.now() - HOUR_MS) })
          .where(eq(content.id, row.id));
      }
      const ours = new Set(due.map(({ row }) => row.id));

      const [a, b] = await Promise.all([
        contentService.completeLeaving(),
        contentService.completeLeaving(),
      ]);

      const done = [...a, ...b]
        .map((piece) => piece.id)
        .filter((id) => ours.has(id));
      expect(done.sort()).toEqual([...ours].sort());
    });
  });
});
