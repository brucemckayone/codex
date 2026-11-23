/**
 * What owners keep of a leaving or moved piece (Codex-a6ofh.6.3): access, and
 * the library shelf.
 *
 * Owners keep a piece whose access moves (D2).
 *
 * A piece moved to course-only, team-only or followers-only, or made free and
 * then unpublished, admits no new buyer by its branch's own arms. Someone who
 * already owned it keeps it (design section 3; owner, 2026-11-23: "buyers,
 * gifts, course buyers"), through `ownershipOf`, the owner the leaving
 * download reads too:
 * - a completed purchase not under dispute;
 * - a live stored gift or grant of the piece;
 * - a live purchase or grant of a course one of whose stages holds it.
 * A course subscriber, a stranger and a disputing buyer are not owners.
 *
 * The content-buyer-refusal suite holds a plain buyer to every branch, and
 * content-access-support-grant a gift in the three moved branches. This one
 * holds what neither does: a gift of a free piece once unpublished, the
 * course owner, the non-owners (a stranger, a disputing buyer, a course
 * subscriber), and the order of the arms off offer: a follower who also
 * bought a followers-only piece that is now leaving keeps it, though a follow
 * alone does not outlive unpublication.
 *
 * The shelf (design section 8): a deleted piece leaves its buyers' shelves,
 * and a leaving one stays there with its date (`content.leavesAt`).
 *
 * Real DB. Every row hangs off this file's own users and organisation, and is
 * deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';
import { LEAVING_NOTICE_DAYS } from '@codex/constants';
import {
  content,
  courseStages,
  courses,
  entitlements,
  organizationFollowers,
  organizations,
  purchases,
  stagePractices,
  users,
} from '@codex/database/schema';
import { verifyPurchase } from '@codex/purchase';
import {
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { ListUserLibraryInput } from '@codex/validation';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentAccessService } from '../ContentAccessService';
import { resolveDisputePause } from '../content-access/access-decision';

type Shape = Partial<typeof content.$inferInsert>;

const released = new Date('2026-01-01T00:00:00Z');

/** Deleted with notice, as the delete writes it: archived, off sale. */
const leaving: Shape = {
  status: 'archived',
  publishedAt: released,
  offSaleAt: new Date(),
  leavesAt: new Date(Date.now() + LEAVING_NOTICE_DAYS * 24 * 60 * 60 * 1000),
  leavingByCreator: true,
};

describe('what owners keep of a leaving or moved piece (Codex-a6ofh.6.3)', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let creatorId: string;
  let organizationId: string;
  const userIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    accessService = new ContentAccessService({
      db,
      environment: 'test',
      r2: createR2SigningClientFromEnv(),
      purchaseService: {
        verifyPurchase: (contentId: string, customerId: string) =>
          verifyPurchase(db, contentId, customerId),
      },
      contentApiBaseUrl: 'https://api.revelations.studio',
      hlsTokenSecret: 'test-worker-shared-secret',
    });
    [creatorId] = await seedTestUsers(db, 1);
    organizationId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Moved access', slug: createUniqueSlug('moved') })
        .returning()
    ).id;
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.userId, userIds));
      await db.delete(purchases).where(inArray(purchases.customerId, userIds));
      await db
        .delete(organizationFollowers)
        .where(inArray(organizationFollowers.userId, userIds));
    }
    if (courseIds.length > 0) {
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    await db.delete(content).where(eq(content.creatorId, creatorId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await db.delete(users).where(inArray(users.id, [...userIds, creatorId]));
    await teardownTestDatabase();
  });

  async function newUser(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    userIds.push(id);
    return id;
  }

  /** A published £15 piece in the org, then the shape it moved to. */
  async function piece(shape: Shape): Promise<string> {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId,
            contentType: 'written',
            slug: createUniqueSlug('moved-item'),
            status: 'published',
            publishedAt: released,
            isFree: false,
            isPurchasable: true,
            priceCents: 1500,
          })
        )
        .returning()
    );
    if (Object.keys(shape).length > 0) {
      await db.update(content).set(shape).where(eq(content.id, item.id));
    }
    return item.id;
  }

  /** What `completePurchase` writes: a completed purchase and its grant. */
  async function bought(
    userId: string,
    contentId: string,
    disputed = false
  ): Promise<void> {
    const sale = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: userId,
          contentId,
          organizationId,
          amountPaidCents: 1500,
          currency: 'gbp',
          stripePaymentIntentId: `pi_moved_${randomUUID()}`,
          status: 'completed',
          purchasedAt: new Date(),
          platformFeeCents: 150,
          organizationFeeCents: 0,
          creatorPayoutCents: 1350,
          disputedAt: disputed ? new Date() : null,
        })
        .returning()
    );
    await db.insert(entitlements).values({
      userId,
      organizationId,
      contentId,
      source: 'content_purchase',
      sourceRef: sale.id,
      // A chargeback revokes the grant (`processDispute`).
      revokedAt: disputed ? new Date() : null,
    });
  }

  /** A support gift of the piece. */
  async function given(userId: string, contentId: string): Promise<void> {
    await db
      .insert(entitlements)
      .values({ userId, organizationId, contentId, source: 'grant' });
  }

  /** A course whose one stage holds the piece, and the user's grant to it. */
  async function viaCourse(
    userId: string,
    contentId: string,
    source: 'course_purchase' | 'course_subscription'
  ): Promise<void> {
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId,
          creatorId,
          slug: createUniqueSlug('moved-course'),
          title: 'Moved Course',
          status: 'published',
        })
        .returning({ id: courses.id })
    );
    courseIds.push(course.id);
    const stage = takeFirst(
      await db
        .insert(courseStages)
        .values({ courseId: course.id, name: 'Stage One', sortOrder: 1 })
        .returning({ id: courseStages.id })
    );
    await db
      .insert(stagePractices)
      .values({ stageId: stage.id, contentId, sortOrder: 0 });
    await db.insert(entitlements).values({
      userId,
      organizationId,
      courseId: course.id,
      source,
    });
  }

  async function follows(userId: string): Promise<void> {
    await db.insert(organizationFollowers).values({ userId, organizationId });
  }

  const opens = (userId: string, contentId: string) =>
    accessService.canView(userId, contentId);

  describe.each([
    ['team-only', { isTeamOnly: true }],
    ['followers-only', { isFollowerGated: true }],
    ['course-only', { courseOnly: true }],
    [
      'free, unpublished after release',
      {
        isFree: true,
        isPurchasable: false,
        priceCents: 0,
        status: 'draft',
        publishedAt: released,
      },
    ],
  ] as Array<[string, Shape]>)('%s', (_name, shape) => {
    it('a stranger is refused', async () => {
      const [stranger, contentId] = [await newUser(), await piece(shape)];
      expect(await opens(stranger, contentId)).toBe(false);
    });

    it('a buyer under dispute is refused', async () => {
      const [owner, contentId] = [await newUser(), await piece(shape)];
      await bought(owner, contentId, true);
      expect(await opens(owner, contentId)).toBe(false);
    });
  });

  it('free, unpublished after release: someone given it keeps it', async () => {
    const [owner, contentId] = [
      await newUser(),
      await piece({
        isFree: true,
        isPurchasable: false,
        priceCents: 0,
        status: 'draft',
        publishedAt: released,
      }),
    ];
    await given(owner, contentId);
    expect(await opens(owner, contentId)).toBe(true);
  });

  // Course-only already admits a course's holders by its own arm, so the
  // course OWNER is proved in every other moved branch, none of whose own
  // arms read a course.
  describe.each([
    ['team-only', { isTeamOnly: true }],
    ['followers-only', { isFollowerGated: true }],
    [
      'free, unpublished after release',
      {
        isFree: true,
        isPurchasable: false,
        priceCents: 0,
        status: 'draft',
        publishedAt: released,
      },
    ],
  ] as Array<[string, Shape]>)('%s, through a course', (_name, shape) => {
    it('a buyer of a course that holds it keeps it', async () => {
      const [owner, contentId] = [await newUser(), await piece(shape)];
      await viaCourse(owner, contentId, 'course_purchase');
      expect(await opens(owner, contentId)).toBe(true);
    });

    it("a course's subscriber is not an owner, and is refused", async () => {
      const [subscriber, contentId] = [await newUser(), await piece(shape)];
      await viaCourse(subscriber, contentId, 'course_subscription');
      expect(await opens(subscriber, contentId)).toBe(false);
    });
  });

  describe('off offer, the owner is asked before the relationship', () => {
    it('a follower who also bought a followers-only piece now leaving keeps it', async () => {
      const [owner, contentId] = [
        await newUser(),
        await piece({ isFollowerGated: true, ...leaving }),
      ];
      await follows(owner);
      await bought(owner, contentId);
      expect(await opens(owner, contentId)).toBe(true);
    });

    it('a follower who never bought it is refused once it is leaving', async () => {
      const [follower, contentId] = [
        await newUser(),
        await piece({ isFollowerGated: true, ...leaving }),
      ];
      await follows(follower);
      expect(await opens(follower, contentId)).toBe(false);
    });

    it('while it is on offer, the follow alone still opens it', async () => {
      const [follower, contentId] = [
        await newUser(),
        await piece({ isFollowerGated: true }),
      ];
      await follows(follower);
      expect(await opens(follower, contentId)).toBe(true);
    });
  });
  // The orgless tier gate (owner refused) is held by content-buyer-refusal,
  // on a row created orgless: detaching one here would make it a draft never
  // released (migration 0004), refused for another reason.

  // Validation refuses an orgless team-only or followers-only piece, so this
  // row is written directly. The decision refuses it before any owner arm
  // (`*_requires_org`), so a win would give nothing back and no dispute may
  // be named.
  it.each([
    ['team-only', { isTeamOnly: true }],
    ['followers-only', { isFollowerGated: true }],
  ] as Array<
    [string, Shape]
  >)('an orgless %s piece names no dispute hold for its disputing buyer', async (_name, shape) => {
    const owner = await newUser();
    const contentId = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: null,
            contentType: 'written',
            slug: createUniqueSlug('moved-orgless'),
            status: 'published',
            publishedAt: released,
            isFree: false,
            isPurchasable: true,
            priceCents: 1500,
            ...shape,
          })
        )
        .returning()
    ).id;
    await bought(owner, contentId, true);

    expect(await opens(owner, contentId)).toBe(false);
    expect(
      await resolveDisputePause(
        {
          db,
          purchaseService: {
            verifyPurchase: (id: string, customerId: string) =>
              verifyPurchase(db, id, customerId),
          },
        },
        owner,
        contentId
      )
    ).toBeNull();
  });

  describe('the library shelf (design section 8)', () => {
    const input: ListUserLibraryInput = {
      page: 1,
      limit: 50,
      filter: 'all',
      sortBy: 'recent',
      contentType: 'all',
      accessType: 'purchased',
      search: '',
    };

    async function shelved(userId: string, contentId: string) {
      const { items } = await accessService.listUserLibrary(userId, input);
      return items.filter((i) => i.content.id === contentId);
    }

    it("a deleted piece leaves its buyer's shelf", async () => {
      const [owner, contentId] = [await newUser(), await piece({})];
      await bought(owner, contentId);
      expect(await shelved(owner, contentId)).toHaveLength(1);

      await db
        .update(content)
        .set({ deletedAt: new Date() })
        .where(eq(content.id, contentId));
      expect(await shelved(owner, contentId)).toEqual([]);
    });

    it('a leaving piece stays on the shelf, with the day it leaves', async () => {
      const [owner, contentId] = [await newUser(), await piece(leaving)];
      await bought(owner, contentId);

      const [row] = await shelved(owner, contentId);
      expect(row?.content.leavesAt).toBe(
        (leaving.leavesAt as Date).toISOString()
      );
    });

    it('a piece that is not leaving says so', async () => {
      const [owner, contentId] = [await newUser(), await piece({})];
      await given(owner, contentId);

      const [row] = await shelved(owner, contentId);
      expect(row?.content.leavesAt).toBeNull();
    });
  });
});
