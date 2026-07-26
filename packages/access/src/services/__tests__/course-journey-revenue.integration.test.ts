/**
 * CourseInsightsService.getOrgJourneyRevenue integration tests (Codex-9p47t).
 *
 * The studio-index revenue badge reads an AUTHORITATIVE batch figure that
 * `listJourneysForOrg` deliberately omits (revenueCents null, to avoid a per-row
 * money join drifting from the per-journey Insights read). This suite proves the
 * batch read against LIVE Postgres:
 *   - gross = completed one-off purchases + SUM over course-subscription payout
 *     split rows (same definition as `aggregateFinancials` → no drift);
 *   - the 30d window excludes older revenue;
 *   - the result is keyed by LANDING-PAGE id (what the index row carries);
 *   - journeys with no revenue are OMITTED (the badge hides falsy values);
 *   - cross-org isolation — a foreign org's revenue is never summed or exposed;
 *   - non-course landing pages are ignored.
 *
 * Every isolation assertion seeds a real foreign/zero row and asserts its
 * ABSENCE, so the test fails if scoping regresses. Data is scoped to freshly
 * created, unique orgs per run, so a shared branch needs no inter-test cleanup.
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  landingPages,
  organizations,
  payouts,
  purchases,
} from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseInsightsService } from '../course-insights-service';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

async function createCourse(
  db: Database,
  orgId: string,
  creatorId: string
): Promise<string> {
  const [row] = await db
    .insert(courses)
    .values({
      organizationId: orgId,
      creatorId,
      slug: createUniqueSlug('course'),
      title: 'Test Course',
      status: 'published',
      priceCents: 5000,
    })
    .returning({ id: courses.id });
  if (!row) throw new Error('failed to create course');
  return row.id;
}

/** A course-type journey page pointing at `courseId` (subjectType 'course'). */
async function createCourseLandingPage(
  db: Database,
  orgId: string,
  creatorId: string,
  courseId: string,
  overrides: {
    pageType?: string;
    subjectType?: string | null;
    subjectId?: string | null;
    deletedAt?: Date | null;
  } = {}
): Promise<string> {
  const [row] = await db
    .insert(landingPages)
    .values({
      organizationId: orgId,
      creatorId,
      pageType: overrides.pageType ?? 'course',
      slug: createUniqueSlug('page'),
      title: 'Test Journey',
      status: 'published',
      subjectType:
        overrides.subjectType === undefined ? 'course' : overrides.subjectType,
      subjectId:
        overrides.subjectId === undefined ? courseId : overrides.subjectId,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: landingPages.id });
  if (!row) throw new Error('failed to create landing page');
  return row.id;
}

/** A completed one-off COURSE purchase (`purchases.courseId`); gross == amount. */
async function insertCoursePurchase(
  db: Database,
  opts: {
    customerId: string;
    courseId: string;
    amountPaidCents: number;
    createdAt: Date;
    status?: string;
  }
): Promise<void> {
  await db.insert(purchases).values({
    customerId: opts.customerId,
    courseId: opts.courseId,
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
  });
}

async function createCourseSubscription(
  db: Database,
  opts: { courseId: string; userId: string; createdAt: Date }
): Promise<string> {
  const [plan] = await db
    .insert(courseSubscriptionPlans)
    .values({ courseId: opts.courseId, priceMonthly: 500, priceAnnual: 5000 })
    .returning({ id: courseSubscriptionPlans.id });
  if (!plan) throw new Error('failed to create plan');
  const [sub] = await db
    .insert(courseSubscriptions)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      planId: plan.id,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      stripeCustomerId: `cus_${randomUUID()}`,
      status: 'active',
      billingInterval: 'month',
      currentPeriodStart: opts.createdAt,
      currentPeriodEnd: new Date(opts.createdAt.getTime() + 30 * DAY),
      createdAt: opts.createdAt,
    })
    .returning({ id: courseSubscriptions.id });
  if (!sub) throw new Error('failed to create subscription');
  return sub.id;
}

/**
 * One payout split row (paid) tied to a course subscription. `userId` is
 * required by `check_payouts_user_required` for every type except
 * `platform_fee` (the platform isn't a user).
 */
async function insertSubscriptionPayout(
  db: Database,
  opts: {
    courseSubscriptionId: string;
    amountCents: number;
    payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
    userId?: string | null;
    createdAt: Date;
  }
): Promise<void> {
  await db.insert(payouts).values({
    courseSubscriptionId: opts.courseSubscriptionId,
    userId: opts.userId ?? null,
    amountCents: opts.amountCents,
    currency: 'gbp',
    payoutType: opts.payoutType,
    status: 'paid',
    sourceType: 'subscription',
    stripeChargeId: `ch_${randomUUID()}`,
    resolvedAt: opts.createdAt,
    createdAt: opts.createdAt,
  });
}

describe('CourseInsightsService.getOrgJourneyRevenue (Codex-9p47t)', () => {
  let db: Database;
  let creatorId: string;
  let buyer: string;
  let subscriber: string;
  let orgAId: string;
  let orgBId: string;

  // Org A journeys.
  let lpWithRevenue: string; // course A1 — £50 purchase + £20 sub payouts
  let lpNoRevenue: string; // course A2 — nothing
  let lpNonCourse: string; // a plain landing page (no course subject)
  // Org B journey (foreign).
  let lpForeign: string; // course B — £100 purchase

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, buyer, subscriber] = await seedTestUsers(db, 3);

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Rev Org A', slug: createUniqueSlug('rev-org-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Rev Org B', slug: createUniqueSlug('rev-org-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;

    // ── Org A / course A1 — £50 one-off + £20 subscription (two split rows),
    //    all within 30d, PLUS a £99 purchase 40 days ago that must be excluded.
    const courseA1 = await createCourse(db, orgAId, creatorId);
    lpWithRevenue = await createCourseLandingPage(
      db,
      orgAId,
      creatorId,
      courseA1
    );
    await insertCoursePurchase(db, {
      customerId: buyer,
      courseId: courseA1,
      amountPaidCents: 5000,
      createdAt: daysAgo(3),
    });
    await insertCoursePurchase(db, {
      customerId: buyer,
      courseId: courseA1,
      amountPaidCents: 9900,
      createdAt: daysAgo(40), // outside the 30d window → excluded
    });
    const subA1 = await createCourseSubscription(db, {
      courseId: courseA1,
      userId: subscriber,
      createdAt: daysAgo(3),
    });
    // Split rows sum to the £20 gross charge (proves SUM-over-splits).
    await insertSubscriptionPayout(db, {
      courseSubscriptionId: subA1,
      amountCents: 500,
      payoutType: 'platform_fee',
      createdAt: daysAgo(3),
    });
    await insertSubscriptionPayout(db, {
      courseSubscriptionId: subA1,
      amountCents: 1500,
      payoutType: 'creator_payout',
      userId: creatorId, // non-platform_fee rows require a user
      createdAt: daysAgo(3),
    });

    // ── Org A / course A2 — no revenue at all.
    const courseA2 = await createCourse(db, orgAId, creatorId);
    lpNoRevenue = await createCourseLandingPage(
      db,
      orgAId,
      creatorId,
      courseA2
    );

    // ── Org A / a non-course landing page (must be ignored).
    lpNonCourse = await createCourseLandingPage(
      db,
      orgAId,
      creatorId,
      courseA2,
      {
        pageType: 'landing',
        subjectType: null,
        subjectId: null,
      }
    );

    // ── Org B / course B — £100 one-off (foreign org).
    const courseB = await createCourse(db, orgBId, creatorId);
    lpForeign = await createCourseLandingPage(db, orgBId, creatorId, courseB);
    await insertCoursePurchase(db, {
      customerId: buyer,
      courseId: courseB,
      amountPaidCents: 10000,
      createdAt: daysAgo(3),
    });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('sums purchases + subscription payout splits within 30d, keyed by landing-page id', async () => {
    const svc = new CourseInsightsService({ db, environment: 'test' });
    const result = await svc.getOrgJourneyRevenue(orgAId);
    // 5000 (purchase) + 500 + 1500 (payout splits) = 7000; the £99 40-days-ago
    // purchase is outside the 30d window and must NOT be counted.
    expect(result[lpWithRevenue]).toBe(7000);
  });

  it('omits journeys with no revenue (badge hides falsy values)', async () => {
    const svc = new CourseInsightsService({ db, environment: 'test' });
    const result = await svc.getOrgJourneyRevenue(orgAId);
    expect(result[lpNoRevenue]).toBeUndefined();
  });

  it('ignores non-course landing pages', async () => {
    const svc = new CourseInsightsService({ db, environment: 'test' });
    const result = await svc.getOrgJourneyRevenue(orgAId);
    expect(result[lpNonCourse]).toBeUndefined();
  });

  it("never sums or exposes another org's revenue (cross-org isolation)", async () => {
    const svc = new CourseInsightsService({ db, environment: 'test' });
    const resultA = await svc.getOrgJourneyRevenue(orgAId);
    // Org B's journey never appears in org A's map…
    expect(resultA[lpForeign]).toBeUndefined();
    // …and org A's total is exactly its own revenue (no foreign bleed).
    expect(Object.values(resultA).reduce((a, b) => a + b, 0)).toBe(7000);

    // Org B sees only its own £100.
    const resultB = await svc.getOrgJourneyRevenue(orgBId);
    expect(resultB[lpForeign]).toBe(10000);
    expect(resultB[lpWithRevenue]).toBeUndefined();
  });

  it('respects the period window (7d excludes the 3-day-old-only totals correctly)', async () => {
    const svc = new CourseInsightsService({ db, environment: 'test' });
    // All org-A revenue is 3 days old, so a 7d window still includes it.
    const sevenDay = await svc.getOrgJourneyRevenue(orgAId, '7d');
    expect(sevenDay[lpWithRevenue]).toBe(7000);
  });
});
