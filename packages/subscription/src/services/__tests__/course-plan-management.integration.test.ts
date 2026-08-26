/**
 * Course subscription PLAN MANAGEMENT (Codex-2pryk.2.4.1 · WP-6 · SPEC §7 path 3).
 *
 * The write side that made `getCourseOffer` able to return `paths: ['subscription']`
 * at all. Real Postgres + mocked Stripe, so the partial-unique
 * `uq_course_sub_plans_course` index and the org-scoping guard are exercised for
 * real rather than stubbed.
 *
 * Covered:
 *   1. upsertPlan creates the Stripe Product + both Prices + the row.
 *   2. Re-saving IDENTICAL prices is a true no-op — no Stripe Price churn.
 *   3. Re-saving CHANGED prices re-prices in place: new Price created, old
 *      archived, plan id (and therefore every subscriber's FK) preserved.
 *   4. createPlan twice conflicts — which is exactly why upsertPlan exists.
 *   5. A course in ANOTHER org is rejected and writes nothing (IDOR).
 *   6. Connect not ready → 422, and no half-built plan is left behind.
 *   7. deactivatePlan withdraws the offer, KEEPS the row, and is idempotent.
 */

import {
  courseSubscriptionPlans,
  courses,
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, type Mock } from 'vitest';
import {
  ConnectAccountNotReadyError,
  CourseSubscriptionPlanExistsError,
} from '../../errors';
import { CourseSubscriptionService } from '../course-subscription-service';

/**
 * Inspectable handle on the Stripe mock's product/price calls.
 *
 * `createMockStripe()` is DECLARED as returning `Stripe`, so the vi.fn() spies it
 * actually installs are invisible to the type system. This package's tsconfig
 * excludes test files, so a wrong shape here would NOT fail `pnpm typecheck` —
 * it would fail at runtime as "not a function". Narrowing once, here, keeps that
 * risk in one place instead of at every assertion.
 */
type StripeSpies = {
  products: { create: Mock; update: Mock };
  prices: { create: Mock; update: Mock };
};

describe('CourseSubscriptionService plan management (Codex-2pryk.2.4.1)', () => {
  let db: Database;
  let creatorId: string;
  let otherCreatorId: string;
  /** The org the caller manages. */
  let orgId: string;
  /** A DIFFERENT org, with its own ready Connect account — the IDOR target. */
  let foreignOrgId: string;
  let foreignCourseId: string;
  let stripe: Stripe;
  let spies: StripeSpies;
  let service: CourseSubscriptionService;

  /** A fresh published course in `orgId`, sold by no path yet. */
  async function newCourse(orgOverride?: string, creatorOverride?: string) {
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgOverride ?? orgId,
        creatorId: creatorOverride ?? creatorId,
        slug: createUniqueSlug('plan-course'),
        title: 'Plan Course',
        status: 'published',
        priceCents: null,
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('failed to seed course');
    return course.id;
  }

  /** Every plan row for a course, including deactivated ones. */
  async function planRows(courseId: string) {
    return db
      .select()
      .from(courseSubscriptionPlans)
      .where(
        and(
          eq(courseSubscriptionPlans.courseId, courseId),
          isNull(courseSubscriptionPlans.deletedAt)
        )
      );
  }

  async function seedOrg(name: string, ownerId: string, connectReady: boolean) {
    const [org] = await db
      .insert(organizations)
      .values({ name, slug: createUniqueSlug('plan-org') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to seed org');
    await db.insert(organizationMemberships).values({
      organizationId: org.id,
      userId: ownerId,
      role: 'owner',
      status: 'active',
    });
    if (connectReady) {
      await db
        .insert(stripeConnectAccounts)
        .values(createTestConnectAccountInput(null, ownerId))
        .onConflictDoNothing();
    }
    return org.id;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId, otherCreatorId] = await seedTestUsers(db, 2);

    orgId = await seedOrg('Plan Mgmt Org', creatorId, true);
    foreignOrgId = await seedOrg('Foreign Org', otherCreatorId, true);
    foreignCourseId = await newCourse(foreignOrgId, otherCreatorId);

    stripe = createMockStripe();
    spies = stripe as unknown as StripeSpies;
    service = new CourseSubscriptionService(
      { db, environment: 'test' },
      stripe
    );
  });

  it('1. upsertPlan creates the Stripe product + both prices + the row', async () => {
    const courseId = await newCourse();

    const plan = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1200,
      priceAnnual: 12000,
    });

    expect(plan.courseId).toBe(courseId);
    expect(plan.priceMonthly).toBe(1200);
    expect(plan.priceAnnual).toBe(12000);
    expect(plan.isActive).toBe(true);
    // All three Stripe refs must be populated — a row without them is the
    // corrupt state savePlanPrices refuses to re-price.
    expect(plan.stripeProductId).toBeTruthy();
    expect(plan.stripePriceMonthlyId).toBeTruthy();
    expect(plan.stripePriceAnnualId).toBeTruthy();

    // And it is readable as THE live plan (what getCourseOffer joins on).
    const live = await service.getPlanForCourse(courseId);
    expect(live?.id).toBe(plan.id);
  });

  it('2. re-saving identical prices creates no new Stripe price (no churn)', async () => {
    const courseId = await newCourse();
    const first = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 2000,
      priceAnnual: 20000,
    });

    const pricesBefore = spies.prices.create.mock.calls.length;
    const second = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 2000,
      priceAnnual: 20000,
    });

    expect(spies.prices.create.mock.calls.length).toBe(pricesBefore);
    expect(second.id).toBe(first.id);
    expect(second.stripePriceMonthlyId).toBe(first.stripePriceMonthlyId);
    expect(second.stripePriceAnnualId).toBe(first.stripePriceAnnualId);
    expect(await planRows(courseId)).toHaveLength(1);
  });

  it('3. re-saving a changed price swaps the Stripe price but keeps the plan id', async () => {
    const courseId = await newCourse();
    const first = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 3000,
      priceAnnual: 30000,
    });

    const updated = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 3500,
      priceAnnual: 30000,
    });

    // Same row — every course_subscriptions.planId FK stays valid.
    expect(updated.id).toBe(first.id);
    expect(updated.priceMonthly).toBe(3500);
    // Monthly swapped to a NEW immutable Price; annual was unchanged so kept.
    expect(updated.stripePriceMonthlyId).not.toBe(first.stripePriceMonthlyId);
    expect(updated.stripePriceAnnualId).toBe(first.stripePriceAnnualId);
    // The superseded monthly Price is archived, not deleted (grandfathering).
    expect(spies.prices.update).toHaveBeenCalledWith(
      first.stripePriceMonthlyId,
      { active: false }
    );
    expect(await planRows(courseId)).toHaveLength(1);
  });

  it('4. createPlan twice conflicts — the reason upsertPlan exists', async () => {
    const courseId = await newCourse();
    await service.createPlan(orgId, courseId, {
      priceMonthly: 900,
      priceAnnual: 9000,
    });

    await expect(
      service.createPlan(orgId, courseId, {
        priceMonthly: 900,
        priceAnnual: 9000,
      })
    ).rejects.toBeInstanceOf(CourseSubscriptionPlanExistsError);

    expect(await planRows(courseId)).toHaveLength(1);
  });

  it('5. a course in another org is rejected and nothing is written (IDOR)', async () => {
    // The caller manages `orgId`; the course id belongs to `foreignOrgId`.
    await expect(
      service.upsertPlan(orgId, foreignCourseId, {
        priceMonthly: 4000,
        priceAnnual: 40000,
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    // The foreign course must be untouched — no plan attached to it.
    expect(await planRows(foreignCourseId)).toHaveLength(0);

    // Deactivation and re-pricing are guarded on the same axis.
    await expect(
      service.deactivatePlan(orgId, foreignCourseId)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.savePlanPrices(orgId, foreignCourseId, {
        priceMonthly: 1,
        priceAnnual: 1,
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    // Sanity: the same course IS reachable from the org that owns it, so test 5
    // proves scoping rather than a course that was simply broken.
    const ok = await service.upsertPlan(foreignOrgId, foreignCourseId, {
      priceMonthly: 4000,
      priceAnnual: 40000,
    });
    expect(ok.courseId).toBe(foreignCourseId);
  });

  it('6. Connect not ready → 422, and no half-built plan is left behind', async () => {
    const [strandedOwner] = await seedTestUsers(db, 1);
    if (!strandedOwner) throw new Error('failed to seed user');
    const noConnectOrgId = await seedOrg(
      'No Connect Org',
      strandedOwner,
      false
    );
    const courseId = await newCourse(noConnectOrgId, strandedOwner);

    const err = await service
      .upsertPlan(noConnectOrgId, courseId, {
        priceMonthly: 500,
        priceAnnual: 5000,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ConnectAccountNotReadyError);
    // 422 (not 500) so the panel can render an actionable "connect a payout
    // account" message instead of a generic failure.
    expect(err.statusCode).toBe(422);
    expect(err.context?.code).toBe('CONNECT_ACCOUNT_NOT_READY');
    // The readiness gate runs BEFORE any Stripe object is created.
    expect(await planRows(courseId)).toHaveLength(0);
  });

  it('7. deactivatePlan withdraws the offer, keeps the row, and is idempotent', async () => {
    const courseId = await newCourse();
    const plan = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1500,
      priceAnnual: 15000,
    });

    await service.deactivatePlan(orgId, courseId);

    // No longer the live plan → getCourseOffer stops offering 'subscription'.
    expect(await service.getPlanForCourse(courseId)).toBeNull();
    // But the ROW SURVIVES: live course_subscriptions.planId FKs point at it and
    // existing subscribers must keep renewing.
    const rows = await planRows(courseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(plan.id);
    expect(rows[0]?.isActive).toBe(false);
    expect(rows[0]?.deletedAt).toBeNull();
    expect(spies.products.update).toHaveBeenCalledWith(plan.stripeProductId, {
      active: false,
    });

    // Idempotent — the panel's toggle can be pressed twice without a 404.
    await expect(
      service.deactivatePlan(orgId, courseId)
    ).resolves.toBeUndefined();

    // A withdrawal must be REVERSIBLE. `courseId` is unique among non-deleted
    // plan rows, so re-listing has to reuse this row — routing it to createPlan
    // would raise CourseSubscriptionPlanExistsError and strand the creator with a
    // subscription they can never put back on sale.
    const relisted = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1600,
      priceAnnual: 16000,
    });
    expect(relisted.id).toBe(plan.id);
    expect(relisted.isActive).toBe(true);
    expect(relisted.priceMonthly).toBe(1600);
    expect(await service.getPlanForCourse(courseId)).not.toBeNull();
    // The Stripe Product is un-archived too — Stripe will not bill a subscription
    // against an inactive Product, so a DB-only flip would sell a broken offer.
    expect(spies.products.update).toHaveBeenCalledWith(plan.stripeProductId, {
      active: true,
    });
    expect(await planRows(courseId)).toHaveLength(1);
  });

  it('8. re-listing at UNCHANGED prices still reactivates (no-op guard respects isActive)', async () => {
    const courseId = await newCourse();
    const plan = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 800,
      priceAnnual: 8000,
    });
    await service.deactivatePlan(orgId, courseId);
    expect(await service.getPlanForCourse(courseId)).toBeNull();

    // Same numbers as before. The unchanged-price fast path must NOT short-circuit
    // here, or the offer stays withdrawn while the panel reports a successful save.
    const relisted = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 800,
      priceAnnual: 8000,
    });

    expect(relisted.id).toBe(plan.id);
    expect(relisted.isActive).toBe(true);
    expect(await service.getPlanForCourse(courseId)).not.toBeNull();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });
});
