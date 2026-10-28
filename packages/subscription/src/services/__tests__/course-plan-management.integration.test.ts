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
  courseSubscriptions,
  courses,
  organizationMemberships,
  organizations,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import StripeSdk from 'stripe';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import {
  ConnectAccountNotReadyError,
  CourseSubscriptionPlanExistsError,
  CreatorConnectRequiredError,
} from '../../errors';
import { CourseSubscriptionService } from '../course-subscription-service';
import { PRICE_FAN_OUT_BUDGET_MS } from '../pending-price-change';

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
  /** Every course this file makes, so afterAll can take them and their plans. */
  const courseIds: string[] = [];

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
    courseIds.push(course.id);
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
      { db, environment: 'test', ...createTestMoneyDeps() },
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
    // The superseded monthly Price is archived, not deleted: an archived Price
    // still bills whoever is on it until their 30-day move (Codex-2hxff.3).
    expect(spies.prices.update).toHaveBeenCalledWith(
      first.stripePriceMonthlyId,
      { active: false }
    );
    expect(await planRows(courseId)).toHaveLength(1);
  });

  // Owner decision P-6, "Same rule as tiers" (Codex-2hxff.3): a plan's price
  // change reaches its existing subscribers on THAT interval, at their first
  // renewal ≥ 30 days after the email. Course plans used to grandfather forever.
  it("3b. a price change moves that interval's subscribers under the 30-day rule, and emails them", async () => {
    const courseId = await newCourse();
    await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1500,
      priceAnnual: 15000,
    });
    const plan = takeFirst(await planRows(courseId));

    const ns = createUniqueSlug('cps');
    const [monthlyUser, annualUser] = await seedTestUsers(db, 2);
    const seeded = await db
      .insert(courseSubscriptions)
      .values(
        (
          [
            [monthlyUser, 'month', `sub_${ns}_m`],
            [annualUser, 'year', `sub_${ns}_y`],
          ] as const
        ).map(([userId, billingInterval, stripeSubscriptionId]) => ({
          userId: userId as string,
          courseId,
          planId: plan.id,
          organizationId: orgId,
          stripeSubscriptionId,
          stripeCustomerId: `cus_${ns}`,
          status: 'active',
          billingInterval,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
        }))
      )
      .returning({ id: courseSubscriptions.id });

    const fanOutStripe = createMockStripe();
    const renewal = Math.floor(Date.now() / 1000) + 10 * 86_400;
    const retrieve = vi.fn().mockImplementation(async (id: string) => ({
      id,
      status: 'active',
      billing_cycle_anchor: renewal,
      metadata: {},
      items: {
        data: [
          {
            id: `si_${id}`,
            current_period_end: renewal,
            price: {
              id: 'price_old_m',
              unit_amount: 1500,
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    }));
    const update = vi.fn().mockResolvedValue({});
    Object.assign(fanOutStripe.subscriptions, { retrieve, update });
    const mailer = vi.fn().mockResolvedValue({ accepted: true });
    const fanOutService = new CourseSubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        mailer,
        webAppUrl: 'https://app.test',
      },
      fanOutStripe
    );

    try {
      // Monthly changes; annual stays the same.
      await fanOutService.upsertPlan(orgId, courseId, {
        priceMonthly: 1800,
        priceAnnual: 15000,
      });

      // Only the monthly subscriber is read — the annual one is never touched.
      expect(retrieve).toHaveBeenCalledTimes(1);
      expect(retrieve).toHaveBeenCalledWith(`sub_${ns}_m`);
      // Renews in 10 days: too soon, so marked pending (no item swap yet).
      const [, params] = update.mock.calls[0] ?? [];
      expect(params).not.toHaveProperty('items');
      expect(params).toMatchObject({
        metadata: { codex_pending_price_id: expect.any(String) },
      });
      expect(mailer).toHaveBeenCalledTimes(1);
      expect(mailer.mock.calls[0]?.[0]).toMatchObject({
        templateName: 'subscription-tier-price-change',
        to: expect.any(String),
        data: {
          planName: 'Plan Course',
          oldPriceFormatted: '£15.00',
          newPriceFormatted: '£18.00',
          billingInterval: 'month',
        },
      });
    } finally {
      await db.delete(courseSubscriptions).where(
        inArray(
          courseSubscriptions.id,
          seeded.map((row) => row.id)
        )
      );
    }
  });

  // Codex-2hxff.40: subscribers grandfathered before #589 pay something other
  // than the plan's previous list price. The notice's "from" figure is what
  // the subscriber is billed today, read off their live Stripe item.
  it.each([
    ['their own live amount, not the list price', 1200, '£12.00', 0],
    [
      'the list price, with an error logged, when the live price has no amount',
      null,
      '£15.00',
      1,
    ],
  ] as const)('3c. a grandfathered subscriber is quoted %s', async (_label, unitAmount, quoted, errors) => {
    const courseId = await newCourse();
    const plan = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1500,
      priceAnnual: 15000,
    });
    const [subscriber] = await seedTestUsers(db, 1);
    const ns = createUniqueSlug('cpg');
    const seeded = await db
      .insert(courseSubscriptions)
      .values({
        userId: subscriber as string,
        courseId,
        planId: plan.id,
        organizationId: orgId,
        stripeSubscriptionId: `sub_${ns}`,
        stripeCustomerId: `cus_${ns}`,
        status: 'active',
        billingInterval: 'month',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
      })
      .returning({ id: courseSubscriptions.id });

    const fanOutStripe = createMockStripe();
    const renewal = Math.floor(Date.now() / 1000) + 10 * 86_400;
    Object.assign(fanOutStripe.subscriptions, {
      retrieve: vi.fn().mockImplementation(async (id: string) => ({
        id,
        status: 'active',
        billing_cycle_anchor: renewal,
        metadata: {},
        items: {
          data: [
            {
              id: `si_${id}`,
              current_period_end: renewal,
              price: {
                id: 'price_grandfathered',
                unit_amount: unitAmount,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      })),
      update: vi.fn().mockResolvedValue({}),
    });
    const mailer = vi.fn().mockResolvedValue({ accepted: true });
    const fanOutService = new CourseSubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        mailer,
        webAppUrl: 'https://app.test',
      },
      fanOutStripe
    );
    const logError = vi.spyOn(
      (
        fanOutService as unknown as {
          obs: { error: (message: string, data?: unknown) => void };
        }
      ).obs,
      'error'
    );

    try {
      await fanOutService.upsertPlan(orgId, courseId, {
        priceMonthly: 1800,
        priceAnnual: 15000,
      });

      expect(mailer).toHaveBeenCalledTimes(1);
      expect(mailer.mock.calls[0]?.[0]).toMatchObject({
        data: { oldPriceFormatted: quoted, newPriceFormatted: '£18.00' },
      });
      // An error, with an errorId: the email may quote a figure this
      // subscriber is not billed (LOW-7).
      const fallbacks = logError.mock.calls.filter(([message]) =>
        String(message).includes('live price has no unit amount')
      );
      expect(fallbacks).toHaveLength(errors);
      for (const [, data] of fallbacks) {
        expect(data).toMatchObject({ errorId: expect.any(String) });
      }
    } finally {
      await db.delete(courseSubscriptions).where(
        inArray(
          courseSubscriptions.id,
          seeded.map((row) => row.id)
        )
      );
    }
  });

  // Owner decision D-P3 (Codex-2hxff.43), "Notice first, then move": a
  // subscriber moves only once notifications-api accepts their notice. A
  // notice not accepted, or a move that fails after it, keeps them on today's
  // price with an error alert for support.
  it('3d. notice first, then move: a refused notice and a failed move are each alerted', async () => {
    const courseId = await newCourse();
    const plan = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1500,
      priceAnnual: 15000,
    });
    const userIds = (await seedTestUsers(db, 3)) as [string, string, string];
    const [movedUser, refusedUser, failedUser] = userIds;
    const ns = createUniqueSlug('cpn');
    const seeded = await db
      .insert(courseSubscriptions)
      .values(
        (
          [
            [movedUser, `sub_${ns}_moved`],
            [refusedUser, `sub_${ns}_refused`],
            [failedUser, `sub_${ns}_failed`],
          ] as const
        ).map(([userId, stripeSubscriptionId]) => ({
          userId,
          courseId,
          planId: plan.id,
          organizationId: orgId,
          stripeSubscriptionId,
          stripeCustomerId: `cus_${stripeSubscriptionId}`,
          status: 'active',
          billingInterval: 'month',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
        }))
      )
      .returning({
        id: courseSubscriptions.id,
        userId: courseSubscriptions.userId,
      });
    const rowOf = (userId: string) =>
      takeFirst(seeded.filter((row) => row.userId === userId));

    const fanOutStripe = createMockStripe();
    const renewal = Math.floor(Date.now() / 1000) + 10 * 86_400;
    const update = vi.fn().mockImplementation(async (id: string) => {
      if (id === `sub_${ns}_failed`) throw new Error('stripe 500');
      return {};
    });
    Object.assign(fanOutStripe.subscriptions, {
      retrieve: vi.fn().mockImplementation(async (id: string) => ({
        id,
        status: 'active',
        billing_cycle_anchor: renewal,
        metadata: {},
        items: {
          data: [
            {
              id: `si_${id}`,
              current_period_end: renewal,
              price: {
                id: 'price_old_m',
                unit_amount: 1500,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      })),
      update,
    });
    const mailer = vi.fn(async (params: { userId?: string }) =>
      params.userId === refusedUser
        ? { accepted: false as const, status: 422 }
        : { accepted: true as const }
    );
    const fanOutService = new CourseSubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        mailer,
        webAppUrl: 'https://app.test',
      },
      fanOutStripe
    );
    const logError = vi.spyOn(
      (
        fanOutService as unknown as {
          obs: { error: (message: string, data?: unknown) => void };
        }
      ).obs,
      'error'
    );

    try {
      await fanOutService.upsertPlan(orgId, courseId, {
        priceMonthly: 1800,
        priceAnnual: 15000,
      });

      // Every subscriber is told first; only the refused one is never moved.
      expect(mailer).toHaveBeenCalledTimes(3);
      const movedIds = update.mock.calls.map(([id]) => id);
      expect(movedIds).toContain(`sub_${ns}_moved`);
      expect(movedIds).not.toContain(`sub_${ns}_refused`);

      const notSent = logError.mock.calls.filter(([message]) =>
        String(message).includes('price-change notice not sent')
      );
      expect(notSent).toHaveLength(1);
      expect(notSent[0]?.[1]).toMatchObject({
        errorId: expect.any(String),
        reason: 'refused',
        status: 422,
        planId: plan.id,
        courseSubscriptionId: rowOf(refusedUser).id,
        stripeSubscriptionId: `sub_${ns}_refused`,
        userId: refusedUser,
      });

      // A plain Error is no definite refusal: the move's outcome is unknown,
      // and the alert keeps what the notice said (silent #7, #8).
      const moveFailed = logError.mock.calls.filter(([message]) =>
        String(message).includes("notice sent; the move's outcome is unknown")
      );
      expect(moveFailed).toHaveLength(1);
      expect(moveFailed[0]?.[1]).toMatchObject({
        errorId: expect.any(String),
        outcome: 'move_unknown',
        notified: true,
        kind: 'pending',
        noticeAt: expect.any(String),
        effectiveAt: expect.any(String),
        planId: plan.id,
        courseSubscriptionId: rowOf(failedUser).id,
        userId: failedUser,
      });
      // The end summary is an alert with an errorId (silent #10).
      expect(
        logError.mock.calls.find(([message]) =>
          String(message).includes('completed with failures')
        )?.[1]
      ).toMatchObject({
        errorId: expect.any(String),
        planId: plan.id,
        total: 3,
        updated: 1,
        unnotified: 1,
        failed: 1,
        unhandled: 0,
      });
    } finally {
      await db.delete(courseSubscriptions).where(
        inArray(
          courseSubscriptions.id,
          seeded.map((row) => row.id)
        )
      );
    }
  });

  // Review A, silent #1: the fan-out runs on waitUntil, which the runtime
  // cancels 30 s after the response. No batch starts after
  // PRICE_FAN_OUT_BUDGET_MS, across both intervals, and every subscriber not
  // reached is named in one alert.
  it('3e. a plan fan-out past its deadline names the rest in one alert, and notifies nobody it does not try to move', async () => {
    const courseId = await newCourse();
    const plan = await service.upsertPlan(orgId, courseId, {
      priceMonthly: 1500,
      priceAnnual: 15000,
    });
    const [monthlyUser, annualUser] = (await seedTestUsers(db, 2)) as [
      string,
      string,
    ];
    const ns = createUniqueSlug('cpdl');
    const seeded = await db
      .insert(courseSubscriptions)
      .values(
        (
          [
            [monthlyUser, 'month', `sub_${ns}_m`],
            [annualUser, 'year', `sub_${ns}_y`],
          ] as const
        ).map(([userId, billingInterval, stripeSubscriptionId]) => ({
          userId,
          courseId,
          planId: plan.id,
          organizationId: orgId,
          stripeSubscriptionId,
          stripeCustomerId: `cus_${stripeSubscriptionId}`,
          status: 'active',
          billingInterval,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
        }))
      )
      .returning({
        id: courseSubscriptions.id,
        userId: courseSubscriptions.userId,
      });

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
      const fanOutStripe = createMockStripe();
      const renewal = Math.floor(Date.now() / 1000) + 10 * 86_400;
      const retrieve = vi.fn().mockImplementation(async (id: string) => {
        // The monthly batch runs past the deadline: the annual one never starts.
        vi.setSystemTime(Date.now() + PRICE_FAN_OUT_BUDGET_MS + 1_000);
        const interval = id.endsWith('_y') ? 'year' : 'month';
        return {
          id,
          status: 'active',
          billing_cycle_anchor: renewal,
          metadata: {},
          items: {
            data: [
              {
                id: `si_${id}`,
                current_period_end: renewal,
                price: {
                  id: `price_old_${interval}`,
                  unit_amount: interval === 'year' ? 15000 : 1500,
                  recurring: { interval },
                },
              },
            ],
          },
        };
      });
      const update = vi.fn().mockResolvedValue({});
      Object.assign(fanOutStripe.subscriptions, { retrieve, update });
      const mailer = vi.fn(async (_params: { userId?: string }) => ({
        accepted: true as const,
      }));
      const fanOutService = new CourseSubscriptionService(
        {
          db,
          environment: 'test',
          ...createTestMoneyDeps(),
          mailer,
          webAppUrl: 'https://app.test',
        },
        fanOutStripe
      );
      const obs = (
        fanOutService as unknown as {
          obs: {
            error: (message: string, data?: unknown) => void;
            info: (message: string, data?: unknown) => void;
          };
        }
      ).obs;
      const logError = vi.spyOn(obs, 'error');
      const logInfo = vi.spyOn(obs, 'info');

      try {
        // Both intervals change.
        await fanOutService.upsertPlan(orgId, courseId, {
          priceMonthly: 1800,
          priceAnnual: 18000,
        });

        expect(
          logInfo.mock.calls.find(([message]) =>
            String(message).includes('fan-out: starting')
          )?.[1]
        ).toMatchObject({ planId: plan.id, total: 2 });
        // Only the monthly subscriber was reached: notified, then moved.
        expect(retrieve.mock.calls.map(([id]) => id)).toEqual([`sub_${ns}_m`]);
        expect(mailer.mock.calls.map(([params]) => params.userId)).toEqual([
          monthlyUser,
        ]);
        expect(update.mock.calls.map(([id]) => id)).toEqual([`sub_${ns}_m`]);
        const annual = takeFirst(seeded.filter((r) => r.userId === annualUser));
        const outOfTime = logError.mock.calls.filter(([message]) =>
          String(message).includes('ran out of time')
        );
        expect(outOfTime).toHaveLength(1);
        expect(outOfTime[0]?.[1]).toMatchObject({
          errorId: expect.any(String),
          planId: plan.id,
          interval: 'year',
          newPriceId: expect.any(String),
          noticeAt: '2026-11-02T10:00:00.000Z',
          unhandled: 1,
          subscribers: [
            {
              courseSubscriptionId: annual.id,
              stripeSubscriptionId: `sub_${ns}_y`,
              userId: annualUser,
              organizationId: orgId,
            },
          ],
        });
        expect(
          logError.mock.calls.find(([message]) =>
            String(message).includes('completed with failures')
          )?.[1]
        ).toMatchObject({
          errorId: expect.any(String),
          total: 2,
          updated: 1,
          unhandled: 1,
        });
      } finally {
        await db.delete(courseSubscriptions).where(
          inArray(
            courseSubscriptions.id,
            seeded.map((row) => row.id)
          )
        );
      }
    } finally {
      vi.useRealTimers();
    }
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
    const strandedOwner = takeFirst(await seedTestUsers(db, 1), 'user id');
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

  // A live course takes a new way to pay only if its CREATOR can be paid, as
  // publishing a priced course does (Codex-2hxff.14, "Yes, same rule"). The
  // org's account is ready in all three; the creator has none.
  describe('9. a live course whose creator cannot be paid', () => {
    it('is refused a plan, and nothing is created at Stripe', async () => {
      const [unpaidCreator] = await seedTestUsers(db, 1);
      const courseId = await newCourse(orgId, unpaidCreator);
      spies.products.create.mockClear();

      await expect(
        service.upsertPlan(orgId, courseId, {
          priceMonthly: 800,
          priceAnnual: 8000,
        })
      ).rejects.toBeInstanceOf(CreatorConnectRequiredError);
      expect(spies.products.create).not.toHaveBeenCalled();
      expect(await planRows(courseId)).toHaveLength(0);
    });

    it('a draft may take one: publishing is checked when it goes live', async () => {
      const [unpaidCreator] = await seedTestUsers(db, 1);
      const courseId = await newCourse(orgId, unpaidCreator);
      await db
        .update(courses)
        .set({ status: 'draft' })
        .where(eq(courses.id, courseId));

      const plan = await service.upsertPlan(orgId, courseId, {
        priceMonthly: 800,
        priceAnnual: 8000,
      });
      expect(plan.isActive).toBe(true);
    });

    it('a withdrawn plan is not put back on sale', async () => {
      const [unpaidCreator] = await seedTestUsers(db, 1);
      const courseId = await newCourse(orgId, unpaidCreator);
      await db
        .update(courses)
        .set({ status: 'draft' })
        .where(eq(courses.id, courseId));
      await service.upsertPlan(orgId, courseId, {
        priceMonthly: 800,
        priceAnnual: 8000,
      });
      await service.deactivatePlan(orgId, courseId);
      await db
        .update(courses)
        .set({ status: 'published' })
        .where(eq(courses.id, courseId));

      await expect(
        service.upsertPlan(orgId, courseId, {
          priceMonthly: 800,
          priceAnnual: 8000,
        })
      ).rejects.toBeInstanceOf(CreatorConnectRequiredError);
      expect(await service.getPlanForCourse(courseId)).toBeNull();
    });
  });

  // Codex-2hxff.66 (owner decisions 2026-10-25 and 2026-10-26): a repeat
  // create quietly returns the plan the first attempt made. The keys are the
  // course, its plan generation and the UTC hour; clean-up never archives a
  // Product a live plan uses.
  describe('10. a repeated create', () => {
    // Mid-hour, so no test's keys straddle an hour by accident. Only Date is
    // faked: the database driver's timers stay real.
    const HOUR = '2026-10-26T14';
    const UNTIL_THE_HOUR =
      "Stripe couldn't save this plan, and nothing was saved. You can try again after the top of the hour.";
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${HOUR}:30:00Z`));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * A Stripe mock that answers as Stripe does under an idempotency key: the
     * same key returns the first response, also to a request made while the
     * first is in flight (the SDK retries Stripe's 409 until it can replay).
     * The same key with other parameters is refused with Stripe's own error.
     */
    function keyHonouringStripe() {
      const keyed = createMockStripe();
      const keyedSpies = keyed as unknown as StripeSpies;
      for (const create of [
        keyedSpies.products.create,
        keyedSpies.prices.create,
      ]) {
        const first = create.getMockImplementation();
        const responses = new Map<
          string,
          { params: string; response: Promise<unknown> }
        >();
        create.mockImplementation(
          (params: unknown, options?: { idempotencyKey?: string }) => {
            const key = options?.idempotencyKey;
            if (!key) return first?.(params, options);
            const seen = responses.get(key);
            if (seen && seen.params !== JSON.stringify(params)) {
              return Promise.reject(
                new StripeSdk.errors.StripeIdempotencyError({
                  message:
                    'Keys for idempotent requests can only be used with the same parameters they were first used with.',
                  type: 'idempotency_error',
                })
              );
            }
            if (seen) return seen.response;
            const response = Promise.resolve(first?.(params, options));
            responses.set(key, { params: JSON.stringify(params), response });
            return response;
          }
        );
      }
      return {
        keyedSpies,
        keyedService: new CourseSubscriptionService(
          { db, environment: 'test', ...createTestMoneyDeps() },
          keyed
        ),
      };
    }

    const archiveCalls = (s: StripeSpies) =>
      s.products.update.mock.calls.filter(
        ([, params]) => params?.active === false
      );

    /**
     * Hold each products.create until `count` have arrived, so racing saves
     * all pass their checks before any inserts: the race, every run.
     */
    function meetAtProductCreate(s: StripeSpies, count: number) {
      const proceed = s.products.create.getMockImplementation();
      let arrived = 0;
      let release: () => void = () => {};
      const allIn = new Promise<void>((resolve) => {
        release = resolve;
      });
      s.products.create.mockImplementation(async (...args: unknown[]) => {
        arrived += 1;
        if (arrived === count) release();
        await allIn;
        return proceed?.(...args);
      });
    }

    it('two saves racing on a fresh course make one Product and one plan, and archive nothing', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      meetAtProductCreate(keyedSpies, 2);
      const courseId = await newCourse();
      const prices = { priceMonthly: 1100, priceAnnual: 11000 };

      const [a, b] = await Promise.all([
        keyedService.upsertPlan(orgId, courseId, prices),
        keyedService.upsertPlan(orgId, courseId, prices),
      ]);

      expect(b.id).toBe(a.id);
      expect(await planRows(courseId)).toHaveLength(1);
      const productKeys = keyedSpies.products.create.mock.calls.map(
        ([, options]) => options?.idempotencyKey
      );
      // The environment is in the key: production, dev and CI share one
      // Stripe sandbox, and seeded course ids repeat across them.
      expect(productKeys).toEqual([
        `course-plan-product-test-${courseId}-0-${HOUR}`,
        `course-plan-product-test-${courseId}-0-${HOUR}`,
      ]);
      expect(archiveCalls(keyedSpies)).toHaveLength(0);
    });

    // The owner accepted this race for the hour bucket: two Products, one
    // plan, and the spare archived.
    it('two saves racing across an hour boundary make one plan, both get it, and the spare Product is archived', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const prices = { priceMonthly: 1100, priceAnnual: 11000 };
      // Hold the first at Stripe until the second, made past the hour,
      // arrives: both pass their checks before either inserts.
      const proceed = keyedSpies.products.create.getMockImplementation();
      let arrived = 0;
      let firstIn: () => void = () => {};
      let release: () => void = () => {};
      const firstArrived = new Promise<void>((resolve) => {
        firstIn = resolve;
      });
      const bothIn = new Promise<void>((resolve) => {
        release = resolve;
      });
      keyedSpies.products.create.mockImplementation(
        async (...args: unknown[]) => {
          arrived += 1;
          if (arrived === 1) firstIn();
          if (arrived === 2) release();
          await bothIn;
          return proceed?.(...args);
        }
      );

      vi.setSystemTime(new Date('2026-10-26T13:59:59Z'));
      const early = keyedService.upsertPlan(orgId, courseId, prices);
      await firstArrived;
      vi.setSystemTime(new Date('2026-10-26T14:00:01Z'));
      const late = keyedService.upsertPlan(orgId, courseId, prices);
      const [a, b] = await Promise.all([early, late]);

      expect(b.id).toBe(a.id);
      const rows = await planRows(courseId);
      expect(rows).toHaveLength(1);
      const productKeys = keyedSpies.products.create.mock.calls.map(
        ([, options]) => options?.idempotencyKey
      );
      expect(productKeys).toEqual([
        `course-plan-product-test-${courseId}-0-2026-10-26T13`,
        `course-plan-product-test-${courseId}-0-2026-10-26T14`,
      ]);
      // Exactly one Product archived: the one the plan does not use.
      const archived = archiveCalls(keyedSpies).map(([id]) => id);
      expect(archived).toHaveLength(1);
      expect(archived[0]).toBeDefined();
      expect(archived[0]).not.toBe(rows[0]?.stripeProductId);
    });

    it('a retry at new prices after a failed create reuses the Product, on sale again, with new Prices', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();

      // The insert fails (a negative price breaks the row's CHECK), after
      // Stripe made the Product: clean-up archives it, and no row is left.
      await expect(
        keyedService.upsertPlan(orgId, courseId, {
          priceMonthly: -1,
          priceAnnual: 11000,
        })
      ).rejects.toThrow();
      expect(await planRows(courseId)).toHaveLength(0);
      const [failedProductId] = archiveCalls(keyedSpies)[0] ?? [];
      expect(failedProductId).toBeDefined();

      const plan = await keyedService.upsertPlan(orgId, courseId, {
        priceMonthly: 1100,
        priceAnnual: 11000,
      });

      // Same generation, so the same Product; the Price keys carry the
      // amounts, so the new monthly price is a new Price.
      expect(plan.stripeProductId).toBe(failedProductId);
      const monthlyKeys = keyedSpies.prices.create.mock.calls
        .map(([, options]) => options?.idempotencyKey as string)
        .filter((key) => key.includes('-monthly-'));
      expect(monthlyKeys).toEqual([
        `course-plan-price-monthly-test-${courseId}-0-${HOUR}--1`,
        `course-plan-price-monthly-test-${courseId}-0-${HOUR}-1100`,
      ]);
      // Archived by the failed attempt, then put back on sale by the retry,
      // before its insert and again once the row commits.
      const updates = keyedSpies.products.update.mock.calls
        .filter(([id]) => id === failedProductId)
        .map(([, params]) => params);
      expect(updates).toEqual([
        { active: true },
        { active: false },
        { active: true },
        { active: true },
      ]);
    });

    // Review L1: two saves in one hour share a Product, and the loser's
    // insert fails for its own reason. Its look-up runs before the twin
    // commits, so it archives; the twin's row then lands. Whichever side acts
    // last must leave the Product on sale, so each re-lists once it sees, or
    // makes, a live row.
    it("a twin's plan that lands after the clean-up archived is returned, and its Product put back on sale", async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const proceed = keyedSpies.products.update.getMockImplementation();
      // The archive: the twin's insert commits as it lands.
      let twinId: string | undefined;
      keyedSpies.products.update.mockImplementation(
        async (productId: string, params: { active?: boolean }) => {
          if (params.active === false) {
            const twin = takeFirst(
              await db
                .insert(courseSubscriptionPlans)
                .values({
                  courseId,
                  priceMonthly: 1100,
                  priceAnnual: 11000,
                  stripeProductId: productId,
                  stripePriceMonthlyId: 'price_twin_month',
                  stripePriceAnnualId: 'price_twin_year',
                })
                .returning()
            );
            twinId = twin.id;
          }
          return proceed?.(productId, params);
        }
      );

      // A negative price breaks the row's CHECK: a failure of its own.
      const plan = await keyedService.createPlan(orgId, courseId, {
        priceMonthly: -1,
        priceAnnual: 11000,
      });

      expect(twinId).toBeDefined();
      expect(plan.id).toBe(twinId);
      const updates = keyedSpies.products.update.mock.calls
        .filter(([id]) => id === plan.stripeProductId)
        .map(([, params]) => params);
      expect(updates).toEqual([
        { active: true },
        { active: false },
        { active: true },
      ]);
    });

    // The winner's half of the same race: a twin can archive the Product
    // between this save's put-on-sale and its insert, so it re-lists once its
    // own row has committed.
    it('a create puts its Product on sale again once its row has committed', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const proceed = keyedSpies.products.update.getMockImplementation();
      const rowCommitted: boolean[] = [];
      keyedSpies.products.update.mockImplementation(
        async (productId: string, params: unknown) => {
          const rows = await planRows(courseId);
          rowCommitted.push(rows.some((r) => r.stripeProductId === productId));
          return proceed?.(productId, params);
        }
      );

      const plan = await keyedService.createPlan(orgId, courseId, {
        priceMonthly: 1100,
        priceAnnual: 11000,
      });

      const updates = keyedSpies.products.update.mock.calls
        .filter(([id]) => id === plan.stripeProductId)
        .map(([, params]) => params);
      expect(updates).toEqual([{ active: true }, { active: true }]);
      expect(rowCommitted).toEqual([false, true]);
    });

    // LOW-6: the look-up after the archive decides whether a live plan's
    // Product goes back on sale, so its failure is never silent.
    it("a failed look-up after the clean-up archived is logged, and the insert's own error stands", async () => {
      const { keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const logError = vi.spyOn(
        (
          keyedService as unknown as {
            obs: { error: (...a: unknown[]) => void };
          }
        ).obs,
        'error'
      );
      const lookUp = vi
        .spyOn(
          keyedService as unknown as { findPlanRow: () => Promise<unknown> },
          'findPlanRow'
        )
        .mockRejectedValueOnce(new Error('connection reset'));

      const error = await keyedService
        .createPlan(orgId, courseId, { priceMonthly: -1, priceAnnual: 11000 })
        .catch((e: unknown) => e)
        .finally(() => lookUp.mockRestore());

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(CourseSubscriptionPlanExistsError);
      expect(logError).toHaveBeenCalledWith(
        'Archived a course plan product, then could not check for a live plan',
        expect.objectContaining({
          errorId: expect.any(String),
          courseId,
          error: 'connection reset',
        })
      );
      expect(await planRows(courseId)).toHaveLength(0);
    });

    it("a save that misses the plan a racing save just made saves onto it, rather than failing 'exists'", async () => {
      const courseId = await newCourse();
      const made = await service.upsertPlan(orgId, courseId, {
        priceMonthly: 1100,
        priceAnnual: 11000,
      });
      // Its look-up ran before the racing save inserted; the create's own
      // check then finds the plan.
      const lookUp = vi
        .spyOn(
          service as unknown as { findPlanRow: () => Promise<unknown> },
          'findPlanRow'
        )
        .mockResolvedValueOnce(null);

      const repeat = await service
        .upsertPlan(orgId, courseId, { priceMonthly: 1100, priceAnnual: 11000 })
        .finally(() => lookUp.mockRestore());

      expect(repeat.id).toBe(made.id);
      expect(await planRows(courseId)).toHaveLength(1);
    });

    // Never a 500. The generation and the amounts are in the keys, so other
    // values under one key means the Product's name: a course retitled
    // between a failed create and its retry.
    it('a retry after the course was retitled is a 409 COURSE_PLAN_KEY_REUSED, with ids only', async () => {
      const { keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      await expect(
        keyedService.upsertPlan(orgId, courseId, {
          priceMonthly: -1,
          priceAnnual: 11000,
        })
      ).rejects.toThrow();
      await db
        .update(courses)
        .set({ title: 'Plan Course, retitled' })
        .where(eq(courses.id, courseId));

      const error = await keyedService
        .upsertPlan(orgId, courseId, { priceMonthly: 1100, priceAnnual: 11000 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      // A refresh changes nothing in the key, so the copy says when it
      // changes: the top of the key's hour (owner decision 2026-10-26).
      expect(error).toMatchObject({
        statusCode: 409,
        message: UNTIL_THE_HOUR,
        context: {
          code: 'COURSE_PLAN_KEY_REUSED',
          courseId,
          retryAfter: '2026-10-26T15:00:00.000Z',
        },
      });
      expect(
        Object.keys((error as ConflictError).context ?? {}).sort()
      ).toEqual(['code', 'courseId', 'retryAfter']);
      expect(await planRows(courseId)).toHaveLength(0);
    });

    // Stripe saves a failure under the key and replays it until the hour
    // turns, so the copy says when to try again (owner decision 2026-10-26).
    it("Stripe failing is a 503 that keeps Stripe's error and says when to try again", async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const stripeError = new StripeSdk.errors.StripeAPIError({
        message: 'An unknown error occurred',
        type: 'api_error',
        requestId: 'req_plan_down',
        statusCode: 500,
      });
      // Stripe answers once the hour has turned: retryAfter comes from the
      // hour in the key, never the clock at the refusal.
      keyedSpies.products.create.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date('2026-10-26T15:00:05Z'));
        throw stripeError;
      });
      const logError = vi.spyOn(
        (
          keyedService as unknown as {
            obs: { error: (...a: unknown[]) => void };
          }
        ).obs,
        'error'
      );

      const error = await keyedService
        .upsertPlan(orgId, courseId, { priceMonthly: 1100, priceAnnual: 11000 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(error).toMatchObject({
        statusCode: 503,
        message: UNTIL_THE_HOUR,
        context: {
          code: 'STRIPE_UNAVAILABLE',
          courseId,
          retryAfter: '2026-10-26T15:00:00.000Z',
        },
      });
      // Stripe's error is kept as the cause. The context, which is sent to
      // the client, holds ids and retryAfter only.
      expect((error as Error).cause).toBe(stripeError);
      expect(
        Object.keys((error as ServiceUnavailableError).context ?? {}).sort()
      ).toEqual(['code', 'courseId', 'retryAfter']);
      // The one line logged carries what Stripe's request log is searched by.
      expect(logError).toHaveBeenCalledWith(
        'Stripe refused a course plan create',
        expect.objectContaining({
          errorId: expect.any(String),
          courseId,
          code: 'STRIPE_UNAVAILABLE',
          stripeType: 'StripeAPIError',
          stripeMessage: 'An unknown error occurred',
          stripeRequestId: 'req_plan_down',
          statusCode: 500,
        })
      );
      expect(await planRows(courseId)).toHaveLength(0);
    });

    it('a create whose key is still in flight at Stripe is a 409 COURSE_PLAN_IN_PROGRESS', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      keyedSpies.products.create.mockRejectedValueOnce(
        new StripeSdk.errors.StripeInvalidRequestError({
          message:
            'There is currently another in-progress request using this Stripe API Idempotency Key.',
          type: 'invalid_request_error',
          code: 'idempotency_key_in_use',
        })
      );

      await expect(
        keyedService.upsertPlan(orgId, courseId, {
          priceMonthly: 1100,
          priceAnnual: 11000,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        context: { code: 'COURSE_PLAN_IN_PROGRESS', courseId },
      });
    });

    it('a plan made after one was deleted gets fresh keys', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const first = await keyedService.upsertPlan(orgId, courseId, {
        priceMonthly: 1100,
        priceAnnual: 11000,
      });
      await db
        .update(courseSubscriptionPlans)
        .set({ deletedAt: new Date() })
        .where(eq(courseSubscriptionPlans.id, first.id));

      const second = await keyedService.upsertPlan(orgId, courseId, {
        priceMonthly: 1100,
        priceAnnual: 11000,
      });

      expect(second.id).not.toBe(first.id);
      expect(second.stripeProductId).not.toBe(first.stripeProductId);
      expect(
        keyedSpies.products.create.mock.calls.at(-1)?.[1]?.idempotencyKey
      ).toBe(`course-plan-product-test-${courseId}-1-${HOUR}`);
    });

    it('a retry in the next hour gets fresh keys, so a failure Stripe stored blocks saves for at most the hour', async () => {
      const { keyedSpies, keyedService } = keyHonouringStripe();
      const courseId = await newCourse();
      const prices = { priceMonthly: 1100, priceAnnual: 11000 };
      // Stripe failed mid-create and stores that answer under the key: as
      // the real API does, every repeat of the key gets it back.
      const proceed = keyedSpies.products.create.getMockImplementation();
      const stored = new StripeSdk.errors.StripeAPIError({
        message: 'An unknown error occurred',
        type: 'api_error',
      });
      keyedSpies.products.create.mockImplementation(
        async (params: unknown, options?: { idempotencyKey?: string }) => {
          if (options?.idempotencyKey?.endsWith(`-${HOUR}`)) throw stored;
          return proceed?.(params, options);
        }
      );

      for (const attempt of [1, 2]) {
        await expect(
          keyedService.upsertPlan(orgId, courseId, prices),
          `attempt ${attempt} in the same hour`
        ).rejects.toMatchObject({
          statusCode: 503,
          context: { code: 'STRIPE_UNAVAILABLE' },
        });
      }

      vi.setSystemTime(new Date('2026-10-26T15:00:05Z'));
      const plan = await keyedService.upsertPlan(orgId, courseId, prices);

      expect(plan.courseId).toBe(courseId);
      expect(
        keyedSpies.products.create.mock.calls.at(-1)?.[1]?.idempotencyKey
      ).toBe(`course-plan-product-test-${courseId}-0-2026-10-26T15`);
    });
  });

  afterAll(async () => {
    if (courseIds.length > 0) {
      await db
        .delete(courseSubscriptionPlans)
        .where(inArray(courseSubscriptionPlans.courseId, courseIds));
      await db.delete(courses).where(inArray(courses.id, courseIds));
    }
    await teardownTestDatabase();
  });
});
