/**
 * ContentService bulk actions (Codex-a6ofh.3.5, data-design §4.2): each piece
 * goes through its own method in its own transaction and gets a result of its
 * own, in the order sent. A refused piece never undoes the others; a piece
 * people bought is left alone by a delete, and by a move to Followers or Team
 * only (owner D-b4, R1); another creator's piece is refused as not found and
 * never touched. And the studio list's rows carry their buyers (owner R2),
 * which its "sales" sort orders by.
 *
 * Database: a real Postgres (the throwaway e3_scratch locally, the CI branch
 * in CI). Every row it makes is its own, and deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@codex/constants';
import {
  categories,
  content,
  contentCategories,
  courseStages,
  courses,
  entitlements,
  mediaItems,
  organizations,
  purchases,
  stagePractices,
} from '@codex/database/schema';
import type { ContentBulkResult } from '@codex/shared-types';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createTestOrganizationInput,
  type Database,
  joinTeam,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NewContent } from '../../types';
import { CategoriesService } from '../categories-service';
import { ContentService } from '../content-service';

describe('ContentService: bulk actions', () => {
  let db: Database;
  let service: ContentService;
  let categoriesService: CategoriesService;
  let creatorId: string;
  let otherCreatorId: string;
  let buyerId: string;
  let secondBuyerId: string;
  let orgId: string;
  const contentIds: string[] = [];
  const mediaIds: string[] = [];
  const purchaseIds: string[] = [];
  const categoryIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    categoriesService = new CategoriesService({ db, environment: 'test' });
    [creatorId, otherCreatorId, buyerId, secondBuyerId] = await seedTestUsers(
      db,
      4
    );
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    ).id;
    await joinTeam(db, orgId, creatorId);
  });

  afterAll(async () => {
    // Purchases first: a course purchase holds its course (restrict).
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (courseIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.courseId, courseIds));
      // Stages and their practices go with their course (cascade).
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (contentIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.contentId, contentIds));
    }
    if (contentIds.length > 0) {
      await db
        .delete(contentCategories)
        .where(inArray(contentCategories.contentId, contentIds));
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    if (categoryIds.length > 0) {
      await db.delete(categories).where(inArray(categories.id, categoryIds));
    }
    if (mediaIds.length > 0) {
      await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
    }
    await teardownTestDatabase();
  });

  /** A free article draft (it passes every publish rule), the creator's own. */
  async function piece(overrides: Partial<NewContent> = {}, owner = creatorId) {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(owner, {
            contentType: 'written',
            title: `Bulk ${randomUUID().slice(0, 8)}`,
            ...overrides,
          })
        )
        .returning()
    );
    contentIds.push(row.id);
    return row;
  }

  const live = (overrides: Partial<NewContent> = {}) =>
    piece({ status: 'published', publishedAt: new Date(), ...overrides });

  /** A draft whose video is on its way: Publish schedules it (D-b1). */
  async function onItsWay() {
    const media = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            mediaType: 'video',
            status: 'transcoding',
          })
        )
        .returning()
    );
    mediaIds.push(media.id);
    return piece({ contentType: 'video', mediaItemId: media.id });
  }

  /** A completed purchase of the piece. */
  async function bought(contentId: string, customerId = buyerId) {
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
          slug: `bulk-course-${randomUUID().slice(0, 8)}`,
          title: 'Bulk course',
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

  const stored = async (id: string) =>
    takeFirst(await db.select().from(content).where(eq(content.id, id)));

  const outcomes = (results: ContentBulkResult[]) =>
    results.map((result) => result.outcome);

  const refusalCode = (result: ContentBulkResult | undefined) => {
    if (!result || !('error' in result)) return undefined;
    return (result.error.details as { code?: string } | undefined)?.code;
  };

  describe('publishMany', () => {
    it('publishes, schedules, leaves the live alone, and refuses each on its own', async () => {
      const ready = await piece();
      const waiting = await onItsWay();
      const already = await live();
      // A video with no media: MEDIA_REQUIRED, the gate's own code.
      const gap = await piece({ contentType: 'video', contentBody: null });

      const report = await service.publishMany(
        [ready.id, waiting.id, already.id, gap.id],
        creatorId
      );

      expect(report.results.map((result) => result.id)).toEqual([
        ready.id,
        waiting.id,
        already.id,
        gap.id,
      ]);
      expect(outcomes(report.results)).toEqual([
        'done',
        'scheduled',
        'unchanged',
        'refused',
      ]);
      expect(refusalCode(report.results[3])).toBe(ERROR_CODES.MEDIA_REQUIRED);
      expect((await stored(ready.id)).status).toBe('published');
      expect((await stored(waiting.id)).publishRequestedAt).not.toBeNull();
      expect((await stored(gap.id)).status).toBe('draft');
      // Only the piece that went live changed anything public.
      expect(report.touched.map((t) => t.id)).toEqual([ready.id]);
    });

    it("refuses another creator's piece as not found, and never touches it", async () => {
      const theirs = await piece({}, otherCreatorId);
      const mine = await piece();

      const report = await service.publishMany([theirs.id, mine.id], creatorId);

      expect(outcomes(report.results)).toEqual(['refused', 'done']);
      // The class is the top-level code; the piece's own is in details.
      expect(refusalCode(report.results[0])).toBe(
        ERROR_CODES.CONTENT_NOT_FOUND
      );
      expect((await stored(theirs.id)).status).toBe('draft');
    });
  });

  describe('unpublishMany', () => {
    it('a row held elsewhere is its own try-again within seconds, never a fault; the rest go through', async () => {
      const held = await live();
      const free = await live();
      // An editor's save holding the row, until released.
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = () => {};
      const isHeld = new Promise<void>((resolve) => {
        holding = resolve;
      });
      const holder = db.transaction(async (tx) => {
        await tx
          .select({ id: content.id })
          .from(content)
          .where(eq(content.id, held.id))
          .for('update');
        holding();
        await released;
      });
      await isHeld;
      const obs = (
        service as unknown as { obs: { error: () => void; warn: () => void } }
      ).obs;
      const faults = vi.spyOn(obs, 'error');
      const tryAgains = vi.spyOn(obs, 'warn');

      const started = Date.now();
      const report = await service
        .unpublishMany([held.id, free.id], creatorId)
        .finally(release);
      await holder;

      expect(outcomes(report.results)).toEqual(['failed', 'done']);
      // A typed try-again (503), logged once as one, never as a fault, with
      // the action and the table it waited on.
      expect(report.results[0]).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE' },
      });
      expect(faults).not.toHaveBeenCalled();
      expect(tryAgains).toHaveBeenCalledTimes(1);
      expect(tryAgains).toHaveBeenCalledWith(expect.any(String), {
        action: 'unpublish',
        contentId: held.id,
        lockedOn: 'content',
      });
      expect(Date.now() - started).toBeLessThan(5000);
      expect((await stored(held.id)).status).toBe('published');
      faults.mockRestore();
      tryAgains.mockRestore();
    });

    it('past its deadline starts no more pieces: the rest are failed, untried, said once', async () => {
      const first = await live();
      const second = await live();
      const third = await live();
      // The loop's start reads 0; every later read is a minute on.
      let reads = 0;
      const clock = vi
        .spyOn(Date, 'now')
        .mockImplementation(() => (reads++ === 0 ? 0 : 60_000));
      // Every logger's warn, the service's and the error mapper's own: both
      // are one class, so its prototype's.
      const logger = Object.getPrototypeOf(
        (service as unknown as { obs: object }).obs
      ) as { warn: (...args: unknown[]) => void };
      const warns = vi.spyOn(logger, 'warn');

      // Both restored however the run ends: the spy is on every logger. A
      // restore clears the spy's calls, so they are counted first.
      let warned = -1;
      const report = await service
        .unpublishMany([first.id, second.id, third.id], creatorId)
        .finally(() => {
          clock.mockRestore();
          warned = warns.mock.calls.length;
          warns.mockRestore();
        });

      expect(outcomes(report.results)).toEqual(['done', 'failed', 'failed']);
      expect(report.results[1]).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE' },
      });
      expect(warned).toBe(1);
      expect((await stored(second.id)).status).toBe('published');
      expect((await stored(third.id)).status).toBe('published');
    });

    it('takes the live down and leaves a draft unwritten', async () => {
      const shown = await live({ organizationId: orgId });
      const draft = await piece();
      const draftBefore = await stored(draft.id);

      const report = await service.unpublishMany(
        [shown.id, draft.id],
        creatorId
      );

      expect(outcomes(report.results)).toEqual(['done', 'unchanged']);
      expect((await stored(shown.id)).status).toBe('draft');
      expect((await stored(draft.id)).updatedAt).toEqual(draftBefore.updatedAt);
      expect(report.touched).toEqual([{ id: shown.id, organizationId: orgId }]);
    });
  });

  describe('deleteMany', () => {
    it('leaves a piece people bought alone, and deletes the rest', async () => {
      const sold = await live();
      await bought(sold.id);
      await bought(sold.id, secondBuyerId);
      const unsold = await live();

      const report = await service.deleteMany([sold.id, unsold.id], creatorId);

      expect(outcomes(report.results)).toEqual(['refused', 'done']);
      const [refused] = report.results;
      expect(refusalCode(refused)).toBe(ERROR_CODES.CONTENT_HAS_BUYERS);
      expect(
        refused && 'error' in refused
          ? (refused.error.details as { buyers?: number }).buyers
          : null
      ).toBe(2);
      expect((await stored(sold.id)).deletedAt).toBeNull();
      expect((await stored(unsold.id)).deletedAt).not.toBeNull();
      expect(report.touched.map((t) => t.id)).toEqual([unsold.id]);
    });

    it('counts course buyers and grants as buyers; a course subscriber or a revoked grant is not one', async () => {
      const inBoughtCourse = await live({ organizationId: orgId });
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        courseId: await inCourse(inBoughtCourse.id),
        source: 'course_purchase',
      });
      const given = await live({ organizationId: orgId });
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        contentId: given.id,
        source: 'grant',
      });
      const inSubscribedCourse = await live({ organizationId: orgId });
      await db.insert(entitlements).values({
        userId: secondBuyerId,
        organizationId: orgId,
        courseId: await inCourse(inSubscribedCourse.id),
        source: 'course_subscription',
      });
      const revoked = await live({ organizationId: orgId });
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        contentId: revoked.id,
        source: 'grant',
        revokedAt: new Date(),
      });

      const report = await service.deleteMany(
        [inBoughtCourse.id, given.id, inSubscribedCourse.id, revoked.id],
        creatorId
      );

      expect(outcomes(report.results)).toEqual([
        'refused',
        'refused',
        'done',
        'done',
      ]);
      expect(refusalCode(report.results[0])).toBe(
        ERROR_CODES.CONTENT_HAS_BUYERS
      );
    });

    it('counts a course buyer whose purchase is under dispute: a win gives the course back', async () => {
      const lesson = await live({ organizationId: orgId });
      const courseId = await inCourse(lesson.id);
      const row = takeFirst(
        await db
          .insert(purchases)
          .values({
            customerId: buyerId,
            courseId,
            amountPaidCents: 2400,
            currency: 'gbp',
            platformFeeCents: 0,
            organizationFeeCents: 0,
            creatorPayoutCents: 2400,
            stripePaymentIntentId: `pi_${randomUUID()}`,
            status: 'completed',
            purchasedAt: new Date(),
            disputedAt: new Date(),
          })
          .returning({ id: purchases.id })
      );
      purchaseIds.push(row.id);
      // The dispute revoked the course's grant.
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        courseId,
        source: 'course_purchase',
        sourceRef: row.id,
        revokedAt: new Date(),
      });

      const report = await service.deleteMany([lesson.id], creatorId);

      expect(outcomes(report.results)).toEqual(['refused']);
      expect((await stored(lesson.id)).deletedAt).toBeNull();
    });

    it('counts a person once, however many ways they hold it', async () => {
      const sold = await live({ organizationId: orgId });
      await bought(sold.id);
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        contentId: sold.id,
        source: 'content_purchase',
      });

      const report = await service.deleteMany([sold.id], creatorId);

      const [refused] = report.results;
      expect(
        refused && 'error' in refused
          ? (refused.error.details as { buyers?: number }).buyers
          : null
      ).toBe(1);
    });

    it('counts only completed purchases, a refunded one is no buyer', async () => {
      const refunded = await live();
      await bought(refunded.id);
      await db
        .update(purchases)
        .set({ status: 'refunded' })
        .where(eq(purchases.contentId, refunded.id));

      const report = await service.deleteMany([refunded.id], creatorId);

      expect(outcomes(report.results)).toEqual(['done']);
    });

    it('a delete one at a time still deletes a bought piece', async () => {
      const sold = await live();
      await bought(sold.id);

      await service.delete(sold.id, creatorId);

      expect((await stored(sold.id)).deletedAt).not.toBeNull();
    });
  });

  describe('addCategoriesMany', () => {
    it('files each piece once, and a second add is unchanged', async () => {
      const category = await categoriesService.create(
        { name: `Bulk ${randomUUID().slice(0, 6)}` },
        { creatorId, organizationId: orgId }
      );
      categoryIds.push(category.id);
      const shown = await live({ organizationId: orgId });
      const draft = await piece({ organizationId: orgId });

      const first = await service.addCategoriesMany(
        [shown.id, draft.id],
        creatorId,
        [category.id]
      );
      const again = await service.addCategoriesMany(
        [shown.id, draft.id],
        creatorId,
        [category.id]
      );

      expect(outcomes(first.results)).toEqual(['done', 'done']);
      // Only the piece that has been live is on a public list.
      expect(first.touched).toEqual([{ id: shown.id, organizationId: orgId }]);
      expect(outcomes(again.results)).toEqual(['unchanged', 'unchanged']);
      expect(again.touched).toEqual([]);
    });
  });

  describe('accessMany', () => {
    const buyOnce = {
      isFree: false,
      isPurchasable: true,
      priceCents: 1200,
      isFollowerGated: false,
      isTeamOnly: false,
    };
    const followers = {
      isFree: false,
      isPurchasable: false,
      priceCents: null,
      isTierGated: false,
      isFollowerGated: true,
      isTeamOnly: false,
    };

    it('sets one price on each draft, and a second change is unchanged', async () => {
      const a = await piece({ organizationId: orgId });
      const b = await piece({ organizationId: orgId });

      const first = await service.accessMany([a.id, b.id], creatorId, buyOnce);
      const again = await service.accessMany([a.id, b.id], creatorId, buyOnce);

      expect(outcomes(first.results)).toEqual(['done', 'done']);
      expect((await stored(a.id)).priceCents).toBe(1200);
      expect((await stored(a.id)).isPurchasable).toBe(true);
      // Drafts are on no public list.
      expect(first.touched).toEqual([]);
      expect(outcomes(again.results)).toEqual(['unchanged', 'unchanged']);
    });

    it('a move to Followers leaves a bought piece alone (R1)', async () => {
      const sold = await live({ organizationId: orgId });
      await bought(sold.id);
      const unsold = await live({ organizationId: orgId });

      const report = await service.accessMany(
        [sold.id, unsold.id],
        creatorId,
        followers
      );

      expect(outcomes(report.results)).toEqual(['refused', 'done']);
      expect(refusalCode(report.results[0])).toBe(
        ERROR_CODES.CONTENT_HAS_BUYERS
      );
      expect((await stored(sold.id)).isFollowerGated).toBe(false);
      expect((await stored(unsold.id)).isFollowerGated).toBe(true);
      expect(report.touched).toEqual([
        { id: unsold.id, organizationId: orgId },
      ]);
    });

    it('lets a course-only piece move to Followers: its course holders keep it', async () => {
      const lesson = await live({ organizationId: orgId, courseOnly: true });
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        courseId: await inCourse(lesson.id),
        source: 'course_purchase',
      });

      const report = await service.accessMany(
        [lesson.id],
        creatorId,
        followers
      );

      expect(outcomes(report.results)).toEqual(['done']);
      expect((await stored(lesson.id)).isFollowerGated).toBe(true);
    });

    it('a change its own rule refuses is never refused as "people have it"', async () => {
      // A partial group: the Subscribers switch stays on, so the move to
      // Followers breaks the tier rule, whoever has the piece.
      const gated = await piece({
        organizationId: orgId,
        isFree: false,
        isTierGated: true,
      });
      await bought(gated.id);

      const report = await service.accessMany([gated.id], creatorId, {
        isFollowerGated: true,
      });

      expect(outcomes(report.results)).toEqual(['refused']);
      const [refused] = report.results;
      expect(refused && 'error' in refused ? refused.error.code : null).toBe(
        ERROR_CODES.VALIDATION_ERROR
      );
    });

    it('a held piece the payouts gate refuses says the gate, never "people have it"', async () => {
      // Followers with a price: the creator has no payout account, so the
      // gate refuses it, whoever has the piece.
      const shown = await live({ organizationId: orgId });
      await bought(shown.id);

      const report = await service.accessMany([shown.id], creatorId, {
        ...followers,
        isPurchasable: true,
        priceCents: 1200,
      });

      expect(outcomes(report.results)).toEqual(['refused']);
      expect(refusalCode(report.results[0])).toBe(
        ERROR_CODES.CREATOR_CONNECT_REQUIRED
      );
    });

    it("refuses Followers or Team only on a personal piece: both are an org's (R3)", async () => {
      const personal = await piece();

      const report = await service.accessMany(
        [personal.id],
        creatorId,
        followers
      );
      const team = await service.accessMany([personal.id], creatorId, {
        ...followers,
        isFollowerGated: false,
        isTeamOnly: true,
      });

      expect(outcomes(report.results)).toEqual(['refused']);
      expect(outcomes(team.results)).toEqual(['refused']);
      const after = await stored(personal.id);
      expect(after.isFollowerGated).toBe(false);
      expect(after.isTeamOnly).toBe(false);
    });

    it('Buy once keeps a bought piece: its buyers keep their playback', async () => {
      const sold = await piece({ organizationId: orgId });
      await bought(sold.id);

      const report = await service.accessMany([sold.id], creatorId, buyOnce);

      expect(outcomes(report.results)).toEqual(['done']);
    });

    it('holds a live piece to the payouts gate, as an editor save is', async () => {
      // The creator has no payout account, so a price on a live piece is
      // refused with the publish gate's own code.
      const shown = await live({ organizationId: orgId });

      const report = await service.accessMany([shown.id], creatorId, buyOnce);

      expect(outcomes(report.results)).toEqual(['refused']);
      expect(refusalCode(report.results[0])).toBe(
        ERROR_CODES.CREATOR_CONNECT_REQUIRED
      );
      expect((await stored(shown.id)).isPurchasable).toBe(false);
    });
  });

  describe('the studio list', () => {
    it("carries each row's buyers, and the sales sort orders by them", async () => {
      const tag = `buyers-${randomUUID().slice(0, 8)}`;
      const none = await live({ title: `${tag} none` });
      const one = await live({ title: `${tag} one` });
      const two = await live({ title: `${tag} two` });
      await bought(one.id);
      await bought(two.id);
      await bought(two.id, secondBuyerId);

      const page = await service.list(
        creatorId,
        { search: tag, sortBy: 'purchaseCount', sortOrder: 'desc' },
        { page: 1, limit: 10 }
      );

      expect(page.items.map((row) => row.id)).toEqual([
        two.id,
        one.id,
        none.id,
      ]);
      expect(page.items.map((row) => row.buyerCount)).toEqual([2, 1, 0]);
      expect(page.items.map((row) => row.holderCount)).toEqual([2, 1, 0]);
    });

    it('carries the holders a delete would leave alone, beside the buyers', async () => {
      const tag = `holders-${randomUUID().slice(0, 8)}`;
      const given = await live({
        title: `${tag} given`,
        organizationId: orgId,
      });
      await db.insert(entitlements).values({
        userId: buyerId,
        organizationId: orgId,
        contentId: given.id,
        source: 'grant',
      });

      const page = await service.list(
        creatorId,
        { search: tag },
        { page: 1, limit: 10 }
      );

      expect(
        page.items.map((row) => [row.buyerCount, row.holderCount])
      ).toEqual([[0, 1]]);
    });
  });
});
