/**
 * Round-D read-side integration tests (Codex-2pryk · Round-D · Codex-776gg).
 *
 * REAL Neon coverage for the two new @codex/access read services whose SQL
 * scoping was previously asserted only at the route boundary (mocked service):
 *
 *   • CourseInsightsService — the STUDIO money-scoping surface (WP-7), the
 *     highest-risk seam: it SUMS revenue for one course, so a scoping bug leaks
 *     another org's money. Seeds real purchases / payouts / course-subscriptions
 *     / enrollments and asserts cross-org isolation, no-double-count, window
 *     math, and per-timestamp engagement windowing against live Postgres.
 *
 *   • CourseJourneyService — the MEMBER read side (WP-11): org-scoped,
 *     published-only course reads; the course-scoped practice-slug IDOR guard;
 *     and idempotent completion writes.
 *
 * Runs against live Postgres (LOCAL_PROXY) so every FK, CHECK, and partial-
 * unique index is exercised for real, not stubbed. Every assertion is
 * UNCONDITIONAL and every isolation test seeds a real foreign row and asserts
 * its ABSENCE, so each test can fail if the service's scoping regresses (bd
 * memory implement/tests-must-be-able-to-fail). Data is scoped to freshly-
 * created, unique course ids per test (matching the course-monetization
 * precedent), so a shared branch needs no inter-test cleanup.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  courseEnrollments,
  courseStages,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  payouts,
  practiceCompletions,
  purchases,
  stagePractices,
} from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseInsightsService } from '../course-insights-service';
import { CourseJourneyService } from '../course-journey-service';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

async function createCourse(
  db: Database,
  orgId: string,
  creatorId: string,
  overrides: {
    slug?: string;
    status?: string;
    priceCents?: number | null;
    deletedAt?: Date | null;
  } = {}
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(courses)
    .values({
      organizationId: orgId,
      creatorId,
      slug: overrides.slug ?? createUniqueSlug('course'),
      title: 'Test Course',
      status: overrides.status ?? 'published',
      priceCents: overrides.priceCents ?? 5000,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: courses.id, slug: courses.slug });
  if (!row) throw new Error('failed to create course');
  return row;
}

/** A completed one-off COURSE purchase (`purchases.courseId`), fee-split == gross. */
async function insertCoursePurchase(
  db: Database,
  opts: {
    customerId: string;
    courseId: string;
    organizationId?: string | null;
    amountPaidCents: number;
    createdAt: Date;
    status?: string;
  }
): Promise<string> {
  const [row] = await db
    .insert(purchases)
    .values({
      customerId: opts.customerId,
      courseId: opts.courseId,
      organizationId: opts.organizationId ?? null,
      amountPaidCents: opts.amountPaidCents,
      currency: 'gbp',
      // check_revenue_split_equals_total: gross = platform + org + creator.
      platformFeeCents: 0,
      organizationFeeCents: 0,
      creatorPayoutCents: opts.amountPaidCents,
      stripePaymentIntentId: `pi_${randomUUID()}`,
      status: opts.status ?? 'completed',
      purchasedAt: opts.createdAt,
      createdAt: opts.createdAt,
    })
    .returning({ id: purchases.id });
  if (!row) throw new Error('failed to create purchase');
  return row.id;
}

async function createCoursePlan(
  db: Database,
  courseId: string
): Promise<string> {
  const [row] = await db
    .insert(courseSubscriptionPlans)
    .values({ courseId, priceMonthly: 500, priceAnnual: 5000 })
    .returning({ id: courseSubscriptionPlans.id });
  if (!row) throw new Error('failed to create course plan');
  return row.id;
}

async function createCourseSubscription(
  db: Database,
  opts: {
    planId: string;
    courseId: string;
    organizationId?: string | null;
    userId: string;
    createdAt: Date;
    status?: string;
  }
): Promise<string> {
  const [row] = await db
    .insert(courseSubscriptions)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      planId: opts.planId,
      organizationId: opts.organizationId ?? null,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      stripeCustomerId: `cus_${randomUUID()}`,
      status: opts.status ?? 'active',
      billingInterval: 'month',
      currentPeriodStart: opts.createdAt,
      currentPeriodEnd: new Date(opts.createdAt.getTime() + 30 * DAY),
      createdAt: opts.createdAt,
    })
    .returning({ id: courseSubscriptions.id });
  if (!row) throw new Error('failed to create course subscription');
  return row.id;
}

/**
 * A ledger row. `status: 'paid'` satisfies check_payouts_paid_invariant via a
 * stripe_charge_id + resolved_at; source_ref_one is respected because callers
 * set at most one of purchaseId / courseSubscriptionId.
 */
async function insertPayout(
  db: Database,
  opts: {
    organizationId?: string | null;
    userId?: string | null;
    purchaseId?: string | null;
    courseSubscriptionId?: string | null;
    amountCents: number;
    payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
    sourceType: 'purchase' | 'subscription';
    createdAt: Date;
    status?: string;
  }
): Promise<void> {
  await db.insert(payouts).values({
    organizationId: opts.organizationId ?? null,
    userId: opts.userId ?? null,
    purchaseId: opts.purchaseId ?? null,
    courseSubscriptionId: opts.courseSubscriptionId ?? null,
    amountCents: opts.amountCents,
    currency: 'gbp',
    payoutType: opts.payoutType,
    status: opts.status ?? 'paid',
    sourceType: opts.sourceType,
    stripeChargeId: `ch_${randomUUID()}`,
    resolvedAt: opts.createdAt,
    createdAt: opts.createdAt,
  });
}

async function insertEnrollment(
  db: Database,
  opts: {
    userId: string;
    courseId: string;
    enrolledAt: Date;
    lastActivityAt?: Date | null;
    completedAt?: Date | null;
    source?: string;
  }
): Promise<void> {
  await db.insert(courseEnrollments).values({
    userId: opts.userId,
    courseId: opts.courseId,
    enrolledAt: opts.enrolledAt,
    lastActivityAt: opts.lastActivityAt ?? null,
    completedAt: opts.completedAt ?? null,
    source: opts.source ?? 'course_purchase',
  });
}

async function createStage(
  db: Database,
  courseId: string,
  sortOrder: number
): Promise<string> {
  const [row] = await db
    .insert(courseStages)
    .values({ courseId, name: `Stage ${sortOrder}`, sortOrder })
    .returning({ id: courseStages.id });
  if (!row) throw new Error('failed to create stage');
  return row.id;
}

/** Create a `content` practice and join it to a stage. Returns id + slug. */
async function addPractice(
  db: Database,
  opts: {
    creatorId: string;
    organizationId: string;
    stageId: string;
    sortOrder: number;
    status?: string;
    deletedAt?: Date | null;
  }
): Promise<{ contentId: string; slug: string }> {
  const [row] = await db
    .insert(content)
    .values(
      createTestContentInput(opts.creatorId, {
        organizationId: opts.organizationId,
        status: opts.status ?? 'published',
        deletedAt: opts.deletedAt ?? null,
      })
    )
    .returning({ id: content.id, slug: content.slug });
  if (!row) throw new Error('failed to create practice content');
  await db.insert(stagePractices).values({
    stageId: opts.stageId,
    contentId: row.id,
    sortOrder: opts.sortOrder,
  });
  return { contentId: row.id, slug: row.slug };
}

describe('Round-D read services (Codex-776gg)', () => {
  let db: Database;
  let creatorId: string;
  let u1: string;
  let u2: string;
  let u3: string;
  let u4: string;
  let u5: string;
  let u6: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, u1, u2, u3, u4, u5, u6] = await seedTestUsers(db, 7);

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Org A', slug: createUniqueSlug('org-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Org B', slug: createUniqueSlug('org-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('CourseInsightsService money-scoping (WP-7)', () => {
    it('cross-org isolation: refuses a foreign-org course and never sums its money', async () => {
      const insights = new CourseInsightsService({ db, environment: 'test' });
      const inWindow = daysAgo(3);

      // Org A course with exactly £50 of one-off revenue.
      const courseA = await createCourse(db, orgAId, creatorId, {
        priceCents: 5000,
      });
      await insertCoursePurchase(db, {
        customerId: u1,
        courseId: courseA.id,
        organizationId: orgAId,
        amountPaidCents: 5000,
        createdAt: inWindow,
      });

      // Org B course with DIFFERENT revenue (a purchase AND a sub payout) — the
      // foreign money that must NEVER leak into org A's numbers.
      const courseB = await createCourse(db, orgBId, creatorId, {
        priceCents: 9999,
      });
      await insertCoursePurchase(db, {
        customerId: u2,
        courseId: courseB.id,
        organizationId: orgBId,
        amountPaidCents: 9999,
        createdAt: inWindow,
      });
      const planB = await createCoursePlan(db, courseB.id);
      const subB = await createCourseSubscription(db, {
        planId: planB,
        courseId: courseB.id,
        organizationId: orgBId,
        userId: u2,
        createdAt: inWindow,
      });
      await insertPayout(db, {
        organizationId: orgBId,
        userId: creatorId,
        courseSubscriptionId: subB,
        amountCents: 7777,
        payoutType: 'creator_payout',
        sourceType: 'subscription',
        createdAt: inWindow,
      });

      // Guard: org A cannot resolve org B's course → NotFoundError (the 404 the
      // route surfaces). The course∈org guard runs BEFORE any money is summed.
      await expect(
        insights.getInsights(orgAId, courseB.id, '30d')
      ).rejects.toBeInstanceOf(NotFoundError);

      // Org A sees ONLY its own £50 — none of org B's £99.99 + £77.77.
      const a = await insights.getInsights(orgAId, courseA.id, '30d');
      expect(a.financials.revenueCents.value).toBe(5000);
      expect(a.financials.purchaseCount.value).toBe(1);
      expect(a.financials.subscriptionCount.value).toBe(0);
    });

    it('no double-count: revenue = purchase gross + sub-payout gross, each counted once', async () => {
      const insights = new CourseInsightsService({ db, environment: 'test' });
      const inWindow = daysAgo(4);

      const course = await createCourse(db, orgAId, creatorId, {
        priceCents: 5000,
      });

      // A completed one-off purchase (£50) ...
      const purchaseId = await insertCoursePurchase(db, {
        customerId: u3,
        courseId: course.id,
        organizationId: orgAId,
        amountPaidCents: 5000,
        createdAt: inWindow,
      });
      // ... whose OWN payout leg (£45) is attributed to the course via purchaseId,
      // NOT courseSubscriptionId. The sub-revenue query joins on
      // courseSubscriptionId, so this leg must NEVER be added on top of the
      // purchase gross (it would give 12500 if double-summed).
      await insertPayout(db, {
        organizationId: orgAId,
        userId: creatorId,
        purchaseId,
        amountCents: 4500,
        payoutType: 'creator_payout',
        sourceType: 'purchase',
        createdAt: inWindow,
      });

      // A course subscription whose recurring payout (£30) IS course revenue.
      const plan = await createCoursePlan(db, course.id);
      const sub = await createCourseSubscription(db, {
        planId: plan,
        courseId: course.id,
        organizationId: orgAId,
        userId: u3,
        createdAt: inWindow,
      });
      await insertPayout(db, {
        organizationId: orgAId,
        userId: creatorId,
        courseSubscriptionId: sub,
        amountCents: 3000,
        payoutType: 'creator_payout',
        sourceType: 'subscription',
        createdAt: inWindow,
      });

      const r = await insights.getInsights(orgAId, course.id, '30d');
      // 5000 (purchase gross via purchases.amountPaidCents) + 3000 (sub payout).
      expect(r.financials.revenueCents.value).toBe(8000);
      expect(r.financials.purchaseCount.value).toBe(1);
      expect(r.financials.subscriptionCount.value).toBe(1);
    });

    it("window math ('30d'): only in-window rows count; previous window drives previousValue", async () => {
      const insights = new CourseInsightsService({ db, environment: 'test' });
      const course = await createCourse(db, orgAId, creatorId, {
        priceCents: null,
      });

      // current window [now-30d, now)
      await insertCoursePurchase(db, {
        customerId: u4,
        courseId: course.id,
        organizationId: orgAId,
        amountPaidCents: 2000,
        createdAt: daysAgo(5),
      });
      // previous window [now-60d, now-30d)
      await insertCoursePurchase(db, {
        customerId: u4,
        courseId: course.id,
        organizationId: orgAId,
        amountPaidCents: 1000,
        createdAt: daysAgo(45),
      });
      // outside both windows — must never count
      await insertCoursePurchase(db, {
        customerId: u4,
        courseId: course.id,
        organizationId: orgAId,
        amountPaidCents: 9999,
        createdAt: daysAgo(100),
      });

      const r = await insights.getInsights(orgAId, course.id, '30d');
      expect(r.financials.revenueCents.value).toBe(2000);
      expect(r.financials.revenueCents.previousValue).toBe(1000);
      expect(r.financials.purchaseCount.value).toBe(1);
      expect(r.financials.purchaseCount.previousValue).toBe(1);
    });

    it("period 'all' spans all history and has a null previousValue", async () => {
      const insights = new CourseInsightsService({ db, environment: 'test' });
      const course = await createCourse(db, orgAId, creatorId, {
        priceCents: null,
      });
      await insertCoursePurchase(db, {
        customerId: u5,
        courseId: course.id,
        organizationId: orgAId,
        amountPaidCents: 1234,
        createdAt: daysAgo(200),
      });

      const r = await insights.getInsights(orgAId, course.id, 'all');
      expect(r.financials.revenueCents.value).toBe(1234);
      expect(r.financials.revenueCents.previousValue).toBeNull();
      expect(r.financials.purchaseCount.previousValue).toBeNull();
    });

    it('engagement windows each metric on its OWN timestamp (enrolled/active/completed)', async () => {
      const insights = new CourseInsightsService({ db, environment: 'test' });
      const course = await createCourse(db, orgAId, creatorId, {
        priceCents: null,
      });

      // E1: enrolled + active + completed all in the CURRENT window.
      await insertEnrollment(db, {
        userId: u1,
        courseId: course.id,
        enrolledAt: daysAgo(5),
        lastActivityAt: daysAgo(4),
        completedAt: daysAgo(3),
      });
      // E2: enrolled in the PREVIOUS window; never active; never completed (nulls
      // are excluded by the gte/lt on a nullable column — no IS NOT NULL needed).
      await insertEnrollment(db, {
        userId: u2,
        courseId: course.id,
        enrolledAt: daysAgo(45),
        lastActivityAt: null,
        completedAt: null,
      });
      // E3: enrolled long ago (outside both windows) but active + completed in the
      // CURRENT window — proves active/completed window on THEIR OWN timestamps,
      // not enrolledAt.
      await insertEnrollment(db, {
        userId: u3,
        courseId: course.id,
        enrolledAt: daysAgo(100),
        lastActivityAt: daysAgo(2),
        completedAt: daysAgo(2),
      });

      const { engagement } = await insights.getInsights(
        orgAId,
        course.id,
        '30d'
      );
      expect(engagement.enrolledCount.value).toBe(1); // E1
      expect(engagement.enrolledCount.previousValue).toBe(1); // E2
      expect(engagement.activeCount.value).toBe(2); // E1 + E3
      expect(engagement.activeCount.previousValue).toBe(0); // E2 lastActivity null
      expect(engagement.completedCount.value).toBe(2); // E1 + E3
      expect(engagement.completedCount.previousValue).toBe(0);
    });
  });

  describe('CourseJourneyService member reads (WP-11)', () => {
    it('getCourseBySlug: org-scoped, published-only, non-deleted', async () => {
      const journey = new CourseJourneyService({ db, environment: 'test' });
      const sharedSlug = `xorg-${randomUUID()}`;

      // SAME slug in two orgs → two different courses (org-scoped uniqueness).
      const a = await createCourse(db, orgAId, creatorId, {
        slug: sharedSlug,
        status: 'published',
      });
      const b = await createCourse(db, orgBId, creatorId, {
        slug: sharedSlug,
        status: 'published',
      });

      const fromA = await journey.getCourseBySlug(orgAId, sharedSlug);
      const fromB = await journey.getCourseBySlug(orgBId, sharedSlug);
      expect(fromA?.id).toBe(a.id);
      expect(fromB?.id).toBe(b.id);
      // The org A read must resolve org A's row, never org B's collision.
      expect(fromA?.id).not.toBe(b.id);

      // A draft and a soft-deleted course in org A are both invisible.
      const draft = await createCourse(db, orgAId, creatorId, {
        status: 'draft',
      });
      const deleted = await createCourse(db, orgAId, creatorId, {
        status: 'published',
        deletedAt: new Date(),
      });
      expect(await journey.getCourseBySlug(orgAId, draft.slug)).toBeNull();
      expect(await journey.getCourseBySlug(orgAId, deleted.slug)).toBeNull();
    });

    it('getCourseDashboard: published-only; draft/deleted → null; synthesises a transient enrollment', async () => {
      const journey = new CourseJourneyService({ db, environment: 'test' });
      const course = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const stageId = await createStage(db, course.id, 1);
      await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId,
        sortOrder: 1,
      });

      const dash = await journey.getCourseDashboard(u1, course.id);
      expect(dash).not.toBeNull();
      expect(dash?.course.id).toBe(course.id);
      expect(dash?.stages).toHaveLength(1);
      expect(dash?.stages[0]?.practices).toHaveLength(1);
      // No enrollment row seeded → a transient first-access enrollment is made.
      expect(dash?.enrollment.courseId).toBe(course.id);

      const draft = await createCourse(db, orgAId, creatorId, {
        status: 'draft',
      });
      const deleted = await createCourse(db, orgAId, creatorId, {
        status: 'published',
        deletedAt: new Date(),
      });
      expect(await journey.getCourseDashboard(u1, draft.id)).toBeNull();
      expect(await journey.getCourseDashboard(u1, deleted.id)).toBeNull();
    });

    it('getInCoursePractice: resolves a slug ONLY within the given course (IDOR guard)', async () => {
      const journey = new CourseJourneyService({ db, environment: 'test' });

      const c1 = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const s1 = await createStage(db, c1.id, 1);
      const p1 = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: s1,
        sortOrder: 1,
      });

      const c2 = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const s2 = await createStage(db, c2.id, 1);
      const p2 = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: s2,
        sortOrder: 1,
      });

      // The course's own practice slug resolves.
      const ok = await journey.getInCoursePractice(u1, c1.id, p1.slug);
      expect(ok).not.toBeNull();
      expect(ok?.practice.slug).toBe(p1.slug);
      expect(ok?.practice.contentId).toBe(p1.contentId);

      // A REAL, published practice slug from a DIFFERENT course → null: the slug
      // is resolved within c1's stages only, so c2's practice never leaks.
      expect(await journey.getInCoursePractice(u1, c1.id, p2.slug)).toBeNull();

      // An unpublished practice of THIS course is invisible too.
      const draftPractice = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: s1,
        sortOrder: 2,
        status: 'draft',
      });
      expect(
        await journey.getInCoursePractice(u1, c1.id, draftPractice.slug)
      ).toBeNull();
    });

    it('listEnrolledCourses: strictly scoped to the caller — user A never sees user B enrollments (IDOR)', async () => {
      const journey = new CourseJourneyService({ db, environment: 'test' });
      const courseX = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const courseY = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const sx = await createStage(db, courseX.id, 1);
      await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: sx,
        sortOrder: 1,
      });
      await insertEnrollment(db, {
        userId: u3,
        courseId: courseX.id,
        enrolledAt: daysAgo(2),
        source: 'course_purchase',
      });
      // A foreign user's enrollment in a DIFFERENT course — must never surface.
      await insertEnrollment(db, {
        userId: u4,
        courseId: courseY.id,
        enrolledAt: daysAgo(1),
        source: 'tier_subscription',
      });

      const forU3 = await journey.listEnrolledCourses(u3, orgAId);
      const ids = forU3.map((e) => e.course.id);
      expect(ids).toContain(courseX.id);
      expect(ids).not.toContain(courseY.id);
    });

    it('listEnrolledCourses: org-scoped, published-only, with a per-course progress rollup', async () => {
      const journey = new CourseJourneyService({ db, environment: 'test' });
      const course = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const stage = await createStage(db, course.id, 1);
      const p1 = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: stage,
        sortOrder: 1,
      });
      const p2 = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: stage,
        sortOrder: 2,
      });

      // Enrollments that MUST be excluded: a draft course (org A) and a
      // published course in ORG B — seeded as real foreign rows so the test
      // fails if either scope regresses.
      const draft = await createCourse(db, orgAId, creatorId, {
        status: 'draft',
      });
      const foreign = await createCourse(db, orgBId, creatorId, {
        status: 'published',
      });
      await insertEnrollment(db, {
        userId: u5,
        courseId: course.id,
        enrolledAt: daysAgo(3),
        source: 'course_purchase',
      });
      await insertEnrollment(db, {
        userId: u5,
        courseId: draft.id,
        enrolledAt: daysAgo(2),
        source: 'course_purchase',
      });
      await insertEnrollment(db, {
        userId: u5,
        courseId: foreign.id,
        enrolledAt: daysAgo(1),
        source: 'course_purchase',
      });
      // One of two practices complete → 50%, in-progress, next = p2.
      await db
        .insert(practiceCompletions)
        .values({ userId: u5, contentId: p1.contentId, source: 'manual' });

      const list = await journey.listEnrolledCourses(u5, orgAId);
      const ids = list.map((e) => e.course.id);
      expect(ids).toContain(course.id);
      expect(ids).not.toContain(draft.id); // draft excluded (published-only)
      expect(ids).not.toContain(foreign.id); // org B excluded (org scope)

      const entry = list.find((e) => e.course.id === course.id);
      expect(entry).toBeDefined();
      expect(entry?.progress.done).toBe(1);
      expect(entry?.progress.total).toBe(2);
      expect(entry?.progress.percent).toBe(50);
      expect(entry?.progress.status).toBe('in-progress');
      expect(entry?.progress.nextPracticeSlug).toBe(p2.slug);
      expect(entry?.enrollmentSource).toBe('course_purchase');
    });

    it("listEnrolledCourses: batched loader keeps each course's curriculum and completion date its own (Codex-kgrdp.23)", async () => {
      // The shelf now loads every enrolled course's stages in ONE pair of
      // queries and every completion in ONE more, instead of 3 round trips per
      // course. Two failure modes that batching can introduce, both asserted:
      //   1. stages cross-assigned between courses  -> wrong `total`
      //   2. completions not narrowed per course    -> `lastCompletedAt` bleeds
      //      across cards, because rollUpEnrollment reduces over everything it
      //      is handed.
      const journey = new CourseJourneyService({ db, environment: 'test' });

      // Deliberately DIFFERENT practice counts so a grouping mix-up cannot
      // produce a coincidentally-correct total.
      const courseM = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const stageM = await createStage(db, courseM.id, 1);
      const m1 = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: stageM,
        sortOrder: 1,
      });
      await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: stageM,
        sortOrder: 2,
      });
      await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: stageM,
        sortOrder: 3,
      });

      const courseN = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const stageN = await createStage(db, courseN.id, 1);
      const n1 = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId: stageN,
        sortOrder: 1,
      });

      await insertEnrollment(db, {
        userId: u6,
        courseId: courseM.id,
        enrolledAt: daysAgo(20),
      });
      await insertEnrollment(db, {
        userId: u6,
        courseId: courseN.id,
        enrolledAt: daysAgo(19),
      });

      // Distinct completion dates, far enough apart to be unambiguous.
      const oldCompletion = daysAgo(10);
      const recentCompletion = daysAgo(1);
      await db.insert(practiceCompletions).values({
        userId: u6,
        contentId: m1.contentId,
        source: 'manual',
        completedAt: oldCompletion,
      });
      await db.insert(practiceCompletions).values({
        userId: u6,
        contentId: n1.contentId,
        source: 'manual',
        completedAt: recentCompletion,
      });

      const list = await journey.listEnrolledCourses(u6, orgAId);
      const entryM = list.find((e) => e.course.id === courseM.id);
      const entryN = list.find((e) => e.course.id === courseN.id);
      expect(entryM).toBeDefined();
      expect(entryN).toBeDefined();

      // Curriculum stayed with its own course.
      expect(entryM?.progress.total).toBe(3);
      expect(entryM?.progress.done).toBe(1);
      expect(entryN?.progress.total).toBe(1);
      expect(entryN?.progress.done).toBe(1);
      expect(entryN?.progress.status).toBe('completed');
      expect(entryM?.progress.status).toBe('in-progress');

      // Completion dates stayed with their own course — courseM must NOT
      // inherit courseN's newer completion.
      expect(entryM?.progress.lastCompletedAt).toBe(
        oldCompletion.toISOString()
      );
      expect(entryN?.progress.lastCompletedAt).toBe(
        recentCompletion.toISOString()
      );
    });

    it('recordPracticeCompletion is idempotent (repeat is a no-op returning the canonical row)', async () => {
      const journey = new CourseJourneyService({ db, environment: 'test' });
      const course = await createCourse(db, orgAId, creatorId, {
        status: 'published',
      });
      const stageId = await createStage(db, course.id, 1);
      const practice = await addPractice(db, {
        creatorId,
        organizationId: orgAId,
        stageId,
        sortOrder: 1,
      });

      const first = await journey.recordPracticeCompletion(
        u2,
        practice.contentId,
        'manual'
      );
      expect(first.contentId).toBe(practice.contentId);
      expect(first.source).toBe('manual');

      // A second call with a DIFFERENT source must NOT insert a new row NOR
      // overwrite — it reads back the canonical first write.
      const second = await journey.recordPracticeCompletion(
        u2,
        practice.contentId,
        'auto'
      );
      expect(second.contentId).toBe(practice.contentId);
      expect(second.source).toBe('manual');
      expect(second.completedAt).toBe(first.completedAt);

      // Exactly one row exists for (user, practice).
      const rows = await db
        .select()
        .from(practiceCompletions)
        .where(
          and(
            eq(practiceCompletions.userId, u2),
            eq(practiceCompletions.contentId, practice.contentId)
          )
        );
      expect(rows).toHaveLength(1);
    });
  });
});
