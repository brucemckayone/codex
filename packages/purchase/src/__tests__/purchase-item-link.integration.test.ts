/**
 * Where a purchase's item lives, for an email's link (Codex-0u7kb).
 *
 * The receipt linked `/content/{id}` on the platform host, a 404 for every
 * buyer. `findItemLink` reads what the item's own page is found by: the real
 * slug, its org's slug, or for personal content its creator's username. Real
 * Postgres, because the answer is three joins keyed by the purchase, and a
 * deleted row on any of them is the difference between a page and a 404.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courses,
  organizations,
  purchases,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

describe('PurchaseService.findItemLink (Codex-0u7kb)', () => {
  const token = randomUUID().slice(0, 8);
  const username = `link-${token}`;
  let db: Database;
  let service: PurchaseService;
  let buyerId: string;
  /** Has a username: their personal content has a page. */
  let creatorId: string;
  /** Has none: their personal content has no page to link to. */
  let anonymousCreatorId: string;
  /** Has one, and is deleted: no profile, so no page either. */
  let deletedCreatorId: string;
  const orgIds: string[] = [];
  const contentIds: string[] = [];
  const courseIds: string[] = [];
  const purchaseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorId, anonymousCreatorId, deletedCreatorId] =
      await seedTestUsers(db, 4);
    await db.update(users).set({ username }).where(eq(users.id, creatorId));
    await db
      .update(users)
      .set({ username: `gone-${token}`, deletedAt: new Date() })
      .where(eq(users.id, deletedCreatorId));
    service = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
  });

  afterAll(async () => {
    if (purchaseIds.length > 0) {
      await db.delete(purchases).where(inArray(purchases.id, purchaseIds));
    }
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    if (courseIds.length > 0) {
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await teardownTestDatabase();
  });

  async function seedOrg(
    fields: Partial<typeof organizations.$inferInsert> = {}
  ) {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: `Item Link Org ${token}`,
          slug: createUniqueSlug(`item-link-${token}`),
          ...fields,
        })
        .returning()
    );
    orgIds.push(org.id);
    return org;
  }

  async function seedContent(
    organizationId: string | null,
    fields: Partial<typeof content.$inferInsert> = {}
  ) {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId,
            contentType: 'written',
            slug: createUniqueSlug(`item-link-${token}`),
            ...fields,
          })
        )
        .returning()
    );
    contentIds.push(item.id);
    return item;
  }

  async function seedCourse(
    organizationId: string,
    fields: Partial<typeof courses.$inferInsert> = {}
  ) {
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId,
          creatorId,
          slug: createUniqueSlug(`item-link-course-${token}`),
          title: 'Item link course',
          status: 'published',
          priceCents: 1000,
          ...fields,
        })
        .returning()
    );
    courseIds.push(course.id);
    return course;
  }

  async function seedPurchase(
    item: { contentId: string } | { courseId: string },
    organizationId: string | null
  ) {
    const purchase = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          ...item,
          organizationId,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 135,
          creatorPayoutCents: 765,
          stripePaymentIntentId: `pi_item_link_${token}_${randomUUID().slice(0, 8)}`,
          status: 'completed',
          purchasedAt: new Date(),
        })
        .returning()
    );
    purchaseIds.push(purchase.id);
    return purchase;
  }

  it("org content: its real slug and its org's slug", async () => {
    const org = await seedOrg();
    const item = await seedContent(org.id);
    const purchase = await seedPurchase({ contentId: item.id }, org.id);

    expect(await service.findItemLink(purchase.id)).toEqual({
      kind: 'org_content',
      contentId: item.id,
      slug: item.slug,
      organizationSlug: org.slug,
    });
  });

  it('org content moved to another org since the sale: the org it is in now, where its page is', async () => {
    const soldIn = await seedOrg();
    const nowIn = await seedOrg();
    const item = await seedContent(nowIn.id);
    const purchase = await seedPurchase({ contentId: item.id }, soldIn.id);

    expect(await service.findItemLink(purchase.id)).toMatchObject({
      kind: 'org_content',
      organizationSlug: nowIn.slug,
    });
  });

  it("personal content: its real slug and its creator's username", async () => {
    const item = await seedContent(null);
    const purchase = await seedPurchase({ contentId: item.id }, null);

    expect(await service.findItemLink(purchase.id)).toEqual({
      kind: 'personal_content',
      contentId: item.id,
      slug: item.slug,
      creatorUsername: username,
    });
  });

  it("a course: its real slug and its org's slug", async () => {
    const org = await seedOrg();
    const course = await seedCourse(org.id);
    const purchase = await seedPurchase({ courseId: course.id }, org.id);

    expect(await service.findItemLink(purchase.id)).toEqual({
      kind: 'course',
      courseId: course.id,
      slug: course.slug,
      organizationSlug: org.slug,
    });
  });

  describe('no page to link to: null', () => {
    it('an unknown purchase', async () => {
      expect(await service.findItemLink(randomUUID())).toBeNull();
    });

    it('deleted content', async () => {
      const org = await seedOrg();
      const item = await seedContent(org.id, { deletedAt: new Date() });
      const purchase = await seedPurchase({ contentId: item.id }, org.id);

      expect(await service.findItemLink(purchase.id)).toBeNull();
    });

    it('content whose org is deleted', async () => {
      const org = await seedOrg({ deletedAt: new Date() });
      const item = await seedContent(org.id);
      const purchase = await seedPurchase({ contentId: item.id }, org.id);

      expect(await service.findItemLink(purchase.id)).toBeNull();
    });

    it('personal content whose creator has no username', async () => {
      const item = await seedContent(null, { creatorId: anonymousCreatorId });
      const purchase = await seedPurchase({ contentId: item.id }, null);

      expect(await service.findItemLink(purchase.id)).toBeNull();
    });

    it('personal content whose creator is deleted', async () => {
      const item = await seedContent(null, { creatorId: deletedCreatorId });
      const purchase = await seedPurchase({ contentId: item.id }, null);

      expect(await service.findItemLink(purchase.id)).toBeNull();
    });

    it('a deleted course', async () => {
      const org = await seedOrg();
      const course = await seedCourse(org.id, { deletedAt: new Date() });
      const purchase = await seedPurchase({ courseId: course.id }, org.id);

      expect(await service.findItemLink(purchase.id)).toBeNull();
    });

    it('a course whose org is deleted', async () => {
      const org = await seedOrg({ deletedAt: new Date() });
      const course = await seedCourse(org.id);
      const purchase = await seedPurchase({ courseId: course.id }, org.id);

      expect(await service.findItemLink(purchase.id)).toBeNull();
    });
  });
});
