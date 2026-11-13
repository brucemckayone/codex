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
  mediaItems,
  organizations,
  purchases,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
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
    });
  });
});
