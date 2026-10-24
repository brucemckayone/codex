/**
 * A course subscription's dispute pauses the buyer's grant to that course,
 * whichever of their subscriptions the grant was written for (Codex-2hxff.59
 * item 4; docs/payments/subscription-disputes.md §5 and §8).
 *
 * A grant that outlived its subscription can be carried on by the next one
 * without its `source_ref` changing, so the pause is keyed on the buyer and
 * the course, and only a subscription that has not ended pauses it: an ended
 * row keeps `disputed_at` after a lost dispute.
 *
 * Runs against live Postgres. Every row it writes is deleted in afterAll: the
 * local database is shared with other sessions.
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  entitlements,
  organizations,
  users,
} from '@codex/database/schema';
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
import {
  hasCourseEntitlement,
  resolveCourseEntitlementsBatch,
} from '../content-access/entitlements-resolver';
import { EntitlementsService } from '../entitlements-service';

describe('a course grant is paused by a dispute on the buyer’s live course subscription (Codex-2hxff.59)', () => {
  let db: Database;
  let creatorId: string;
  let orgId: string;
  const userIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    userIds.push(creatorId);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Pause Org', slug: createUniqueSlug('pause') })
        .returning()
    ).id;
  });

  afterAll(async () => {
    if (courseIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.courseId, courseIds));
      await db
        .delete(courseSubscriptions)
        .where(inArray(courseSubscriptions.courseId, courseIds));
      await db
        .delete(courseSubscriptionPlans)
        .where(inArray(courseSubscriptionPlans.courseId, courseIds));
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    if (orgId)
      await db.delete(organizations).where(eq(organizations.id, orgId));
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  const now = () => new Date();
  const inDays = (days: number) =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  /** A buyer, a course with a subscription plan. */
  async function buyerAndCourse() {
    const [buyerId] = await seedTestUsers(db, 1);
    userIds.push(buyerId);
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug('pause-course'),
          title: 'Paused Course',
          status: 'published',
          priceCents: null,
        })
        .returning({ id: courses.id })
    );
    courseIds.push(course.id);
    const plan = takeFirst(
      await db
        .insert(courseSubscriptionPlans)
        .values({
          courseId: course.id,
          priceMonthly: 5000,
          priceAnnual: 50000,
          stripeProductId: `prod_${randomUUID()}`,
          stripePriceMonthlyId: `price_m_${randomUUID()}`,
          stripePriceAnnualId: `price_a_${randomUUID()}`,
        })
        .returning()
    );
    return { buyerId, courseId: course.id, planId: plan.id };
  }

  async function courseSub(
    target: { buyerId: string; courseId: string; planId: string },
    spec: {
      status: string;
      endedAt?: Date | null;
      disputedAt?: Date | null;
      duplicateOf?: string;
    }
  ): Promise<string> {
    return takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId: target.buyerId,
          courseId: target.courseId,
          planId: target.planId,
          organizationId: orgId,
          stripeSubscriptionId: `sub_course_${randomUUID()}`,
          stripeCustomerId: `cus_${randomUUID()}`,
          status: spec.status,
          billingInterval: 'month',
          currentPeriodStart: now(),
          currentPeriodEnd: inDays(30),
          endedAt: spec.endedAt ?? null,
          disputedAt: spec.disputedAt ?? null,
          duplicateOfCourseSubscriptionId: spec.duplicateOf ?? null,
        })
        .returning({ id: courseSubscriptions.id })
    ).id;
  }

  /** A live course-subscription grant, written for `sourceRef`. */
  async function grant(
    target: { buyerId: string; courseId: string },
    sourceRef: string
  ): Promise<string> {
    return takeFirst(
      await db
        .insert(entitlements)
        .values({
          userId: target.buyerId,
          organizationId: orgId,
          courseId: target.courseId,
          source: 'course_subscription',
          sourceRef,
          expiresAt: inDays(30),
        })
        .returning({ id: entitlements.id })
    ).id;
  }

  async function setDisputed(courseSubscriptionId: string, at: Date | null) {
    await db
      .update(courseSubscriptions)
      .set({ disputedAt: at })
      .where(eq(courseSubscriptions.id, courseSubscriptionId));
  }

  /** Every read that honours the pause agrees. */
  async function granted(target: { buyerId: string; courseId: string }) {
    const single = await hasCourseEntitlement(
      db,
      target.buyerId,
      target.courseId
    );
    const batch = (
      await resolveCourseEntitlementsBatch(db, target.buyerId, [
        target.courseId,
      ])
    ).has(target.courseId);
    const listed = (
      await new EntitlementsService({
        db,
        environment: 'test',
      }).getUserEntitlements(target.buyerId)
    ).some((row) => row.resourceId === target.courseId);
    expect(new Set([single, batch, listed]).size).toBe(1);
    return single;
  }

  // ── the pause ─────────────────────────────────────────────────────────

  it('an inherited grant is paused by a dispute on the new subscription, and released when it clears', async () => {
    const target = await buyerAndCourse();
    const ended = await courseSub(target, {
      status: 'cancelled',
      endedAt: now(),
    });
    const live = await courseSub(target, { status: 'active' });
    // The grant still names the ended subscription: the new one carried it on.
    await grant(target, ended);
    expect(await granted(target)).toBe(true);

    await setDisputed(live, now());
    expect(await granted(target)).toBe(false);

    await setDisputed(live, null);
    expect(await granted(target)).toBe(true);
  });

  it('a re-subscription after a lost dispute is not paused: the ended row keeps disputed_at', async () => {
    const target = await buyerAndCourse();
    // Lost: cancelled at Stripe and ended, disputed_at left set.
    const lost = await courseSub(target, {
      status: 'cancelled',
      endedAt: now(),
      disputedAt: now(),
    });
    const resubscribed = await courseSub(target, { status: 'active' });
    const grantId = await grant(target, lost);
    expect(await granted(target)).toBe(true);

    // Written for the new subscription instead: the same answer.
    await db
      .update(entitlements)
      .set({ sourceRef: resubscribed })
      .where(eq(entitlements.id, grantId));
    expect(await granted(target)).toBe(true);
  });

  it('a dispute on a duplicate subscription, which grants nothing, does not pause the real one', async () => {
    const target = await buyerAndCourse();
    const real = await courseSub(target, { status: 'active' });
    await courseSub(target, {
      status: 'incomplete',
      disputedAt: now(),
      duplicateOf: real,
    });
    await grant(target, real);

    expect(await granted(target)).toBe(true);
  });
});
