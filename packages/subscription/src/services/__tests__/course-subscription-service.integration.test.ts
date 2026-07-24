/**
 * CourseSubscriptionService lifecycle (Codex-2pryk · WP-6 · SPEC §7 path 3).
 *
 * Real DB, mocked Stripe (same shape as the parent subscription suite). Proves:
 *   1. activation writes the course_subscriptions row + the course_subscription
 *      entitlement (the WP-2 resolver's READ target) + the auto-enrollment.
 *   2. an invoice.paid fan-out writes each payout ledger row (attributed by
 *      courseSubscriptionId) exactly once — a redelivered invoice is idempotent.
 *   3. the `isCourseSubscription` discriminator the webhook dispatcher relies on.
 */

import { randomUUID } from 'node:crypto';
import {
  type CourseSubscriptionPlan,
  courseEnrollments,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  entitlements,
  organizationMemberships,
  organizations,
  payouts,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  createMockStripe,
  createMockStripeInvoice,
  createMockStripeSubscription,
  createTestConnectAccountInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  CourseSubscriptionService,
} from '../course-subscription-service';

describe('CourseSubscriptionService lifecycle (WP-6)', () => {
  let db: Database;
  let subscriberId: string;
  let creatorId: string;
  let orgId: string;
  let courseId: string;
  let plan: CourseSubscriptionPlan;
  let service: CourseSubscriptionService;

  beforeAll(async () => {
    db = setupTestDatabase();
    [subscriberId, creatorId] = await seedTestUsers(db, 2);

    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId))
      .onConflictDoNothing();

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Course Sub Org', slug: createUniqueSlug('cs-org') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed org');
    orgId = org.id;
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
    });

    const [course] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('cs-course'),
        title: 'Subscribable Course',
        status: 'published',
        priceCents: null,
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('failed course');
    courseId = course.id;

    const [planRow] = await db
      .insert(courseSubscriptionPlans)
      .values({
        courseId,
        priceMonthly: 5000,
        priceAnnual: 50000,
        stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
        stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
        stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
      })
      .returning();
    if (!planRow) throw new Error('failed plan');
    plan = planRow;

    service = new CourseSubscriptionService(
      { db, environment: 'test' },
      createMockStripe()
    );
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  function courseSubStripeObject(
    id: string,
    cId: string = courseId,
    pId: string = plan.id
  ): Stripe.Subscription {
    return createMockStripeSubscription({
      id,
      customer: `cus_${randomUUID().slice(0, 8)}`,
      metadata: {
        type: COURSE_SUBSCRIPTION_METADATA_TYPE,
        codex_user_id: subscriberId,
        codex_course_id: cId,
        codex_plan_id: pId,
        codex_organization_id: orgId,
      },
    }) as unknown as Stripe.Subscription;
  }

  /** A fresh course + plan so per-(user,course) unique constraints don't collide. */
  async function makeCourseWithPlan(): Promise<{ cId: string; pId: string }> {
    const [c] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('cs-course'),
        title: 'Subscribable Course',
        status: 'published',
        priceCents: null,
      })
      .returning({ id: courses.id });
    if (!c) throw new Error('failed course');
    const [p] = await db
      .insert(courseSubscriptionPlans)
      .values({
        courseId: c.id,
        priceMonthly: 5000,
        priceAnnual: 50000,
        stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
        stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
        stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: courseSubscriptionPlans.id });
    if (!p) throw new Error('failed plan');
    return { cId: c.id, pId: p.id };
  }

  it('isCourseSubscription discriminates course subs from org subs', () => {
    expect(
      CourseSubscriptionService.isCourseSubscription(
        courseSubStripeObject('sub_x')
      )
    ).toBe(true);
    expect(
      CourseSubscriptionService.isCourseSubscription(
        createMockStripeSubscription() as unknown as Stripe.Subscription
      )
    ).toBe(false);
  });

  it('activation writes course_subscriptions row + entitlement + enrollment', async () => {
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    await service.handleCourseSubscriptionCreated(
      courseSubStripeObject(stripeSubId)
    );

    const [row] = await db
      .select()
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
    expect(row?.courseId).toBe(courseId);
    expect(row?.planId).toBe(plan.id);

    const grants = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, subscriberId),
          eq(entitlements.courseId, courseId),
          eq(entitlements.source, 'course_subscription')
        )
      );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.revokedAt).toBeNull();
    expect(grants[0]?.expiresAt).not.toBeNull();
    expect(grants[0]?.sourceRef).toBe(row?.id);

    const enrolls = await db
      .select()
      .from(courseEnrollments)
      .where(
        and(
          eq(courseEnrollments.userId, subscriberId),
          eq(courseEnrollments.courseId, courseId)
        )
      );
    expect(enrolls).toHaveLength(1);
  });

  it('invoice payment fans out payouts once; redelivery is idempotent', async () => {
    const { cId, pId } = await makeCourseWithPlan();
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const sub = courseSubStripeObject(stripeSubId, cId, pId);
    await service.handleCourseSubscriptionCreated(sub);
    const [row] = await db
      .select({ id: courseSubscriptions.id })
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
    const courseSubscriptionId = row?.id;
    expect(courseSubscriptionId).toBeDefined();

    const chargeId = `ch_${randomUUID().slice(0, 8)}`;
    const invoice = createMockStripeInvoice({
      amount_paid: 5000,
      currency: 'gbp',
      parent: {
        subscription_details: {
          subscription: stripeSubId,
          metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
        },
      },
      payments: {
        data: [
          { payment: { payment_intent: `pi_${chargeId}`, charge: chargeId } },
        ],
      },
    }) as unknown as Stripe.Invoice;

    await service.handleCourseInvoicePaymentSucceeded(invoice, sub);

    const payoutRows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.courseSubscriptionId, courseSubscriptionId as string));
    const byType = payoutRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.payoutType] = (acc[r.payoutType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType.platform_fee).toBe(1);
    expect(byType.creator_payout).toBe(1);
    expect(byType.organization_fee).toBe(1);
    // Every row is attributed by courseSubscriptionId + sourceType='subscription'.
    expect(payoutRows.every((r) => r.sourceType === 'subscription')).toBe(true);
    // Split sums exactly to the charge amount.
    expect(payoutRows.reduce((s, r) => s + r.amountCents, 0)).toBe(5000);

    // Redeliver the SAME invoice → the per-charge guard skips the fan-out.
    await service.handleCourseInvoicePaymentSucceeded(invoice, sub);
    const payoutRowsAfter = await db
      .select()
      .from(payouts)
      .where(eq(payouts.courseSubscriptionId, courseSubscriptionId as string));
    expect(payoutRowsAfter).toHaveLength(payoutRows.length);
  });
});
