/**
 * When does a course refuse its BUYER? (Codex-z1t3c, D54)
 *
 * A buyer here holds exactly what `completeCoursePurchase` writes, a
 * completed `purchases` row and its `course_purchase` entitlement, and
 * nothing else. The entitlement admits them (`canEnterCourse`), but the
 * dashboard and the in-course player read the course through
 * `loadCourseSummaryById`, which finds nothing for a deleted course, a course
 * of a deleted organisation, or one never released. Each case states whether
 * the real dashboard opens for them.
 *
 * Purchase completion blocks and refunds a course sale exactly when the
 * dashboard would refuse its buyer ("match access exactly", owner
 * 2026-11-15): `courseRefusesBuyers` in @codex/constants is that rule, and
 * each case holds the predicate to the real read on the same row.
 *
 * Real DB. Every row hangs off this file's own users and organisations, and is
 * deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';
import { courseRefusesBuyers } from '@codex/constants';
import {
  courseEnrollments,
  courses,
  entitlements,
  organizations,
  purchases,
  users,
} from '@codex/database/schema';
import { verifyPurchase } from '@codex/purchase';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentAccessService } from '../ContentAccessService';
import { CourseJourneyService } from '../course-journey-service';

const uid = () => randomUUID().slice(0, 8);

type Shape = Partial<typeof courses.$inferInsert>;

/** How the course is changed after the sale, beyond its own columns. */
type After = 'none' | 'delete' | 'delete_org';

describe('when a course refuses a buyer of it (Codex-z1t3c)', () => {
  let db: Database;
  let accessService: ContentAccessService;
  let journey: CourseJourneyService;
  let creatorId: string;
  const buyerIds: string[] = [];
  const orgIds: string[] = [];

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
    journey = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    if (buyerIds.length > 0) {
      await db
        .delete(courseEnrollments)
        .where(inArray(courseEnrollments.userId, buyerIds));
      await db
        .delete(entitlements)
        .where(inArray(entitlements.userId, buyerIds));
      await db.delete(purchases).where(inArray(purchases.customerId, buyerIds));
    }
    await db.delete(courses).where(eq(courses.creatorId, creatorId));
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
    await db.delete(users).where(inArray(users.id, [...buyerIds, creatorId]));
    await teardownTestDatabase();
  });

  /**
   * A released £49.99 course in an org of its own, bought by a buyer of its
   * own; then the shape and the change applied after the sale.
   */
  async function soldCourse(shape: Shape, after: After) {
    const orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: `Course ${uid()}`, slug: createUniqueSlug('course') })
        .returning()
    ).id;
    orgIds.push(orgId);
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug('bought-course'),
          title: `Bought ${uid()}`,
          status: 'published',
          publishedAt: new Date('2026-01-01T00:00:00Z'),
          priceCents: 4999,
        })
        .returning()
    );
    const [buyerId] = await seedTestUsers(db, 1);
    buyerIds.push(buyerId);
    // What `completeCoursePurchase` writes for the sale.
    const sale = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          courseId: course.id,
          organizationId: orgId,
          amountPaidCents: 4999,
          currency: 'gbp',
          stripePaymentIntentId: `pi_course_buyer_${uid()}`,
          status: 'completed',
          purchasedAt: new Date(),
          platformFeeCents: 500,
          organizationFeeCents: 0,
          creatorPayoutCents: 4499,
        })
        .returning()
    );
    await db.insert(entitlements).values({
      userId: buyerId,
      organizationId: orgId,
      courseId: course.id,
      source: 'course_purchase',
      sourceRef: sale.id,
    });

    if (Object.keys(shape).length > 0) {
      await db.update(courses).set(shape).where(eq(courses.id, course.id));
    }
    if (after === 'delete') {
      await db
        .update(courses)
        .set({ deletedAt: new Date() })
        .where(eq(courses.id, course.id));
    }
    if (after === 'delete_org') {
      // As `OrganizationService.delete` writes it: its courses stay.
      await db
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }
    return { buyerId, courseId: course.id };
  }

  /** The facts `courseRefusesBuyers` reads, as completion reads them. */
  async function buyerFacts(courseId: string) {
    const row = takeFirst(
      await db.select().from(courses).where(eq(courses.id, courseId))
    );
    const org = takeFirst(
      await db
        .select({ deletedAt: organizations.deletedAt })
        .from(organizations)
        .where(eq(organizations.id, row.organizationId))
    );
    return { ...row, organizationDeleted: org.deletedAt != null };
  }

  const cases: Array<[string, Shape, After, boolean]> = [
    // name, shape after the sale, change after the sale, opens
    ['published', {}, 'none', true],
    [
      'a legacy published row with no date',
      { publishedAt: null },
      'none',
      true,
    ],
    ['unpublished after release', { status: 'draft' }, 'none', true],
    [
      'archived, taken off sale after release',
      { status: 'archived', offSaleAt: new Date() },
      'none',
      true,
    ],
    ['its organisation deleted', {}, 'delete_org', false],
    ['deleted', {}, 'delete', false],
    [
      'a draft never released',
      { status: 'draft', publishedAt: null },
      'none',
      false,
    ],
    [
      'archived, never released',
      { status: 'archived', publishedAt: null },
      'none',
      false,
    ],
  ];

  it.each(
    cases.map(([name, shape, after, opens]) => ({ name, shape, after, opens }))
  )('$name: the dashboard opens for a buyer = $opens', async ({
    shape,
    after,
    opens,
  }) => {
    const { buyerId, courseId } = await soldCourse(shape, after);

    // The entitlement admits them in every case; the dashboard decides.
    expect(await accessService.canEnterCourse(buyerId, courseId)).toBe(true);
    const dashboard = await journey.getCourseDashboard(buyerId, courseId);
    expect(dashboard !== null).toBe(opens);
    // The shared predicate agrees with the real read on the same row.
    expect(courseRefusesBuyers(await buyerFacts(courseId))).toBe(!opens);
  });
});
