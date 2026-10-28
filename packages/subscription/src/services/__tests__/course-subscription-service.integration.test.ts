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
  agreementProposals,
  type CourseSubscriptionPlan,
  courseEnrollments,
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  creatorOrganizationAgreements,
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
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  paidByCard,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ConnectAccountNotReadyError,
  SubscriptionCheckoutError,
} from '../../errors';
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
      { db, environment: 'test', ...createTestMoneyDeps() },
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

  // Codex-2hxff.10 (owner decision P-3): a failed renewal keeps access while
  // Stripe retries. Only a PAID renewal used to move the stored grant on, so a
  // past_due course plan lost access at the old period end.
  it('a past_due update moves the course grant to the new period end; a paused one does not', async () => {
    const { cId, pId } = await makeCourseWithPlan();
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const created = courseSubStripeObject(stripeSubId, cId, pId);
    await service.handleCourseSubscriptionCreated(created);
    const grantExpiry = async () => {
      const [grant] = await db
        .select({ expiresAt: entitlements.expiresAt })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, subscriberId),
            eq(entitlements.courseId, cId),
            eq(entitlements.source, 'course_subscription')
          )
        );
      return grant?.expiresAt?.getTime();
    };
    const renewedTo = (seconds: number, status: string) =>
      ({
        ...created,
        status,
        items: {
          ...created.items,
          data: created.items.data.map((item) => ({
            ...item,
            current_period_end: seconds,
          })),
        },
      }) as Stripe.Subscription;

    const nextPeriodEnd = Math.floor(Date.now() / 1000) + 62 * 24 * 3600;
    await service.handleCourseSubscriptionUpdated(
      renewedTo(nextPeriodEnd, 'past_due')
    );
    expect(await grantExpiry()).toBe(nextPeriodEnd * 1000);

    await service.handleCourseSubscriptionUpdated(
      renewedTo(nextPeriodEnd + 30 * 24 * 3600, 'paused')
    );
    expect(await grantExpiry()).toBe(nextPeriodEnd * 1000);
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
      payments: paidByCard(chargeId),
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
    // Every slice is keyed on the charge the PaymentIntent resolved to.
    expect(payoutRows.every((r) => r.stripeChargeId === chargeId)).toBe(true);
    // Split sums exactly to the charge amount.
    expect(payoutRows.reduce((s, r) => s + r.amountCents, 0)).toBe(5000);

    // Redeliver the SAME invoice → every slice is already in the ledger.
    await service.handleCourseInvoicePaymentSucceeded(invoice, sub);
    const payoutRowsAfter = await db
      .select()
      .from(payouts)
      .where(eq(payouts.courseSubscriptionId, courseSubscriptionId as string));
    expect(payoutRowsAfter).toHaveLength(payoutRows.length);
  });

  // Owner decision AGR-01 "Keeps paying" (Codex-2hxff.17): the course
  // creator's subscription agreement applies past its review date.
  it("an invoice pays the course creator their agreed share past the agreement's review date", async () => {
    // A fresh creator, so the agreement cannot reach the file's other tests.
    const [agreedCreatorId] = await seedTestUsers(db, 1);
    if (!agreedCreatorId) throw new Error('creator not seeded');
    const [c] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId: agreedCreatorId,
        slug: createUniqueSlug('cs-agreed'),
        title: 'Agreed Course',
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
    const day = 86_400_000;
    const [proposal] = await db
      .insert(agreementProposals)
      .values({
        organizationId: orgId,
        creatorId: agreedCreatorId,
        revenueType: 'subscription',
        roundNumber: 1,
        proposedByUserId: creatorId,
        proposedByRole: 'owner',
        proposedCreatorSharePercent: 7000,
        proposedEffectiveFrom: new Date(Date.now() - 60 * day),
        status: 'accepted',
      })
      .returning({ id: agreementProposals.id });
    if (!proposal) throw new Error('proposal not inserted');
    await db.insert(creatorOrganizationAgreements).values({
      organizationId: orgId,
      creatorId: agreedCreatorId,
      organizationFeePercentage: 3000,
      revenueType: 'subscription',
      status: 'active',
      effectiveFrom: new Date(Date.now() - 60 * day),
      effectiveUntil: new Date(Date.now() - day), // review date passed
      currentProposalId: proposal.id,
    });

    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const sub = courseSubStripeObject(stripeSubId, c.id, p.id);
    await service.handleCourseSubscriptionCreated(sub);
    const [row] = await db
      .select({ id: courseSubscriptions.id })
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
    if (!row) throw new Error('course subscription not written');

    const invoice = createMockStripeInvoice({
      amount_paid: 5000,
      currency: 'gbp',
      parent: {
        subscription_details: {
          subscription: stripeSubId,
          metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
        },
      },
      payments: paidByCard(`ch_${randomUUID().slice(0, 8)}`),
    }) as unknown as Stripe.Invoice;
    await service.handleCourseInvoicePaymentSucceeded(invoice, sub);

    const rows = await db
      .select({
        payoutType: payouts.payoutType,
        amountCents: payouts.amountCents,
      })
      .from(payouts)
      .where(eq(payouts.courseSubscriptionId, row.id));
    const amountOf = (type: string) =>
      rows.find((r) => r.payoutType === type)?.amountCents;
    // 10% platform; the creator takes 70% of the 4500 left, not the default.
    expect(amountOf('platform_fee')).toBe(500);
    expect(amountOf('organization_fee')).toBe(1350);
    expect(amountOf('creator_payout')).toBe(3150);
  });

  // Codex-2hxff.50, the production shape end to end: the webhook's invoice
  // carries no payments (Stripe omits them unless expanded), and the expanded
  // payment names only the PaymentIntent. The course path read `charge` from
  // both and recorded nothing.
  it('a webhook invoice with no inline payments: the slices come from the expanded PaymentIntent', async () => {
    const { cId, pId } = await makeCourseWithPlan();
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const sub = courseSubStripeObject(stripeSubId, cId, pId);
    await service.handleCourseSubscriptionCreated(sub);
    const [row] = await db
      .select({ id: courseSubscriptions.id })
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
    if (!row) throw new Error('course sub not recorded');

    const chargeId = `ch_${randomUUID().slice(0, 8)}`;
    const stripe = createMockStripe();
    vi.mocked(stripe.invoices.retrieve).mockImplementation((async (
      id: string
    ) => ({ id, payments: paidByCard(chargeId) })) as never);
    const webhookService = new CourseSubscriptionService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
    const invoice = createMockStripeInvoice({
      amount_paid: 5000,
      currency: 'gbp',
      parent: {
        subscription_details: {
          subscription: stripeSubId,
          metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
        },
      },
      payments: { data: [] },
    }) as unknown as Stripe.Invoice;

    await webhookService.handleCourseInvoicePaymentSucceeded(invoice, sub);

    expect(stripe.invoices.retrieve).toHaveBeenCalledWith(invoice.id, {
      expand: ['payments'],
    });
    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.courseSubscriptionId, row.id));
    expect(rows.map((r) => r.payoutType).sort()).toEqual([
      'creator_payout',
      'organization_fee',
      'platform_fee',
    ]);
    expect(rows.every((r) => r.stripeChargeId === chargeId)).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(5000);
  });

  /** A course sub row + the invoice that pays it. */
  async function paidCourseInvoice(cId: string, pId: string) {
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const sub = courseSubStripeObject(stripeSubId, cId, pId);
    await service.handleCourseSubscriptionCreated(sub);
    const [row] = await db
      .select({ id: courseSubscriptions.id })
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
    if (!row) throw new Error('course sub not recorded');
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
      payments: paidByCard(chargeId),
    }) as unknown as Stripe.Invoice;
    const slices = () =>
      db.select().from(payouts).where(eq(payouts.courseSubscriptionId, row.id));
    return { sub, invoice, slices };
  }

  // Codex-2hxff.11: a per-charge SELECT pre-check used to skip the WHOLE
  // fan-out when any row existed for the charge — so a delivery that died
  // after writing the platform fee lost the creator and org slices for good.
  it('a delivery that died after the platform fee: the redelivery adds the missing slices', async () => {
    const { cId, pId } = await makeCourseWithPlan();
    const { sub, invoice, slices } = await paidCourseInvoice(cId, pId);

    // First delivery: the database drops while the creator slice is reserved,
    // inside the split's transaction (recordSplitOnce, Codex-2hxff.49).
    const dropsOnCreatorSlice = (client: Database): Database =>
      new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === 'transaction') {
            return (run: (tx: Database) => Promise<unknown>) =>
              target.transaction((tx) =>
                run(dropsOnCreatorSlice(tx as unknown as Database))
              );
          }
          if (prop === 'insert') {
            // biome-ignore lint/suspicious/noExplicitAny: Drizzle builder shape
            return (table: any) => {
              const builder = target.insert(table);
              const realValues = builder.values.bind(builder);
              // biome-ignore lint/suspicious/noExplicitAny: row payload
              (builder as any).values = (rows: any) => {
                const row = Array.isArray(rows) ? rows[0] : rows;
                if (row?.payoutType === 'creator_payout') {
                  throw new Error('Connection terminated unexpectedly');
                }
                return realValues(rows);
              };
              return builder;
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const failing = dropsOnCreatorSlice(db);
    const dying = new CourseSubscriptionService(
      { db: failing, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
    await expect(
      dying.handleCourseInvoicePaymentSucceeded(invoice, sub)
    ).rejects.toThrow();
    expect((await slices()).map((r) => r.payoutType)).toEqual(['platform_fee']);

    // The redelivery adds the creator and org slices.
    await service.handleCourseInvoicePaymentSucceeded(invoice, sub);
    const rows = await slices();
    expect(rows.map((r) => r.payoutType).sort()).toEqual([
      'creator_payout',
      'organization_fee',
      'platform_fee',
    ]);
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(5000);
  });

  // Codex-2hxff.37 — owner decision 2026-10-18: an organisation with no owner
  // at the invoice's time has its slice held as `no_owner` (it was logged and
  // dropped).
  it('an organisation with no owner: the org fee is held as no_owner', async () => {
    const [ownerless] = await db
      .insert(organizations)
      .values({
        name: 'Ownerless Course Org',
        slug: createUniqueSlug('cs-no-owner'),
      })
      .returning({ id: organizations.id });
    if (!ownerless) throw new Error('failed org');
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: ownerless.id,
        creatorId,
        slug: createUniqueSlug('cs-no-owner-course'),
        title: 'Ownerless Course',
        status: 'published',
        priceCents: null,
      })
      .returning({ id: courses.id });
    if (!course) throw new Error('failed course');
    const [ownerlessPlan] = await db
      .insert(courseSubscriptionPlans)
      .values({
        courseId: course.id,
        priceMonthly: 5000,
        priceAnnual: 50000,
        stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
        stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
        stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
      })
      .returning();
    if (!ownerlessPlan) throw new Error('failed plan');
    const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
    const sub = createMockStripeSubscription({
      id: stripeSubId,
      customer: `cus_${randomUUID().slice(0, 8)}`,
      metadata: {
        type: COURSE_SUBSCRIPTION_METADATA_TYPE,
        codex_user_id: subscriberId,
        codex_course_id: course.id,
        codex_plan_id: ownerlessPlan.id,
        codex_organization_id: ownerless.id,
      },
    }) as unknown as Stripe.Subscription;
    await service.handleCourseSubscriptionCreated(sub);
    const [subRow] = await db
      .select({ id: courseSubscriptions.id })
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
    if (!subRow) throw new Error('course sub not recorded');
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
      payments: paidByCard(chargeId),
    }) as unknown as Stripe.Invoice;

    await service.handleCourseInvoicePaymentSucceeded(invoice, sub);

    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.courseSubscriptionId, subRow.id));
    expect(rows.find((r) => r.payoutType === 'organization_fee')).toMatchObject(
      { status: 'pending', reason: 'no_owner', userId: null }
    );
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(5000);
  });

  // Codex-2hxff.12: a course-plan checkout requires the organisation owner
  // to be payable, as a tier checkout does — every invoice carries an org
  // slice. It used to open without the check.
  describe('checkout requires a payable owner', () => {
    it('a payable owner: the checkout opens', async () => {
      const { cId } = await makeCourseWithPlan();
      const stripe = createMockStripe();
      // createMockStripe ships no customers stubs; checkout resolves the
      // buyer's Stripe Customer first (as in subscription-service.test.ts).
      (stripe as unknown as { customers: unknown }).customers = {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
        create: vi.fn().mockImplementation(async () => ({
          id: `cus_${randomUUID().slice(0, 8)}`,
          created: Math.floor(Date.now() / 1000),
          metadata: {},
        })),
      };
      const checkout = new CourseSubscriptionService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        stripe
      );
      const result = await checkout.createCheckoutSession(subscriberId, {
        courseId: cId,
        billingInterval: 'month',
        successUrl: 'http://lvh.me:3000/ok',
        cancelUrl: 'http://lvh.me:3000/cancel',
      });
      expect(result.sessionUrl).toBeTruthy();
    });

    it('an owner who cannot be paid: refused before Stripe is asked', async () => {
      const [ownerWithoutPayouts] = await seedTestUsers(db, 1);
      if (!ownerWithoutPayouts) throw new Error('seed failed');
      const [org] = await db
        .insert(organizations)
        .values({ name: 'Unpayable Org', slug: createUniqueSlug('cs-unpay') })
        .returning({ id: organizations.id });
      if (!org) throw new Error('failed org');
      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: ownerWithoutPayouts,
        role: 'owner',
        status: 'active',
      });
      const [course] = await db
        .insert(courses)
        .values({
          organizationId: org.id,
          creatorId,
          slug: createUniqueSlug('cs-unpay-course'),
          title: 'Unpayable Course',
          status: 'published',
          priceCents: null,
        })
        .returning({ id: courses.id });
      if (!course) throw new Error('failed course');
      await db.insert(courseSubscriptionPlans).values({
        courseId: course.id,
        priceMonthly: 5000,
        priceAnnual: 50000,
        stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
        stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
        stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
      });
      const stripe = createMockStripe();
      const gated = new CourseSubscriptionService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        stripe
      );

      await expect(
        gated.createCheckoutSession(subscriberId, {
          courseId: course.id,
          billingInterval: 'month',
          successUrl: 'http://lvh.me:3000/ok',
          cancelUrl: 'http://lvh.me:3000/cancel',
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    // Codex-2hxff.64: a creator's removal archives their courses, and only
    // this status gate stops a new subscription to one.
    it('a course taken off sale on a departure: refused before Stripe is asked', async () => {
      const { cId } = await makeCourseWithPlan();
      await db
        .update(courses)
        .set({ status: 'archived', offSaleAt: new Date() })
        .where(eq(courses.id, cId));
      const stripe = createMockStripe();
      const checkout = new CourseSubscriptionService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        stripe
      );

      await expect(
        checkout.createCheckoutSession(subscriberId, {
          courseId: cId,
          billingInterval: 'month',
          successUrl: 'http://lvh.me:3000/ok',
          cancelUrl: 'http://lvh.me:3000/cancel',
        })
      ).rejects.toThrow(SubscriptionCheckoutError);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });
  });

  // Owner decision 2026-10-21 (Codex-2hxff.64): a course taken off sale when
  // its creator left has its live subscriptions cancelled at period end,
  // 50 at once and the rest hourly. These pass `courseIds` (the removal's own
  // call): the sweep's no-`courseIds` form is global, and a shared DB holds
  // other runs' rows.
  describe('cancelForCoursesOffSale', () => {
    async function subscribedCourse(offSale: boolean) {
      const { cId, pId } = await makeCourseWithPlan();
      const stripeSubId = `sub_${randomUUID().slice(0, 8)}`;
      await service.handleCourseSubscriptionCreated(
        courseSubStripeObject(stripeSubId, cId, pId)
      );
      if (offSale) {
        await db
          .update(courses)
          .set({ status: 'archived', offSaleAt: new Date() })
          .where(eq(courses.id, cId));
      }
      const [row] = await db
        .select()
        .from(courseSubscriptions)
        .where(eq(courseSubscriptions.stripeSubscriptionId, stripeSubId));
      if (!row) throw new Error('course subscription not written');
      return { courseId: cId, sub: row };
    }

    function serviceWithMailer() {
      const stripe = createMockStripe();
      const mailer = vi.fn();
      const svc = new CourseSubscriptionService(
        {
          db,
          environment: 'test',
          ...createTestMoneyDeps(),
          offSaleMailer: mailer,
          webAppUrl: 'https://app.example.test',
        },
        stripe
      );
      return { svc, stripe, mailer };
    }

    it('cancels a live subscription to an off-sale course at period end, once, and tells the subscriber', async () => {
      const offSale = await subscribedCourse(true);
      const onSale = await subscribedCourse(false);
      const { svc, stripe, mailer } = serviceWithMailer();

      const result = await svc.cancelForCoursesOffSale({
        courseIds: [offSale.courseId, onSale.courseId],
        limit: 50,
      });

      expect(result).toEqual({ cancelled: 1, failed: 0, remaining: 0 });
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        offSale.sub.stripeSubscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey: `course_off_sale_cancel_${offSale.sub.id}` }
      );
      const [after] = await db
        .select()
        .from(courseSubscriptions)
        .where(eq(courseSubscriptions.id, offSale.sub.id));
      expect(after?.cancelAtPeriodEnd).toBe(true);
      expect(after?.status).toBe('cancelling');
      expect(mailer).toHaveBeenCalledTimes(1);
      expect(mailer.mock.calls[0]?.[0]).toMatchObject({
        templateName: 'course-no-longer-offered',
        userId: subscriberId,
      });

      // A second run finds nothing: already cancelling.
      const again = await svc.cancelForCoursesOffSale({
        courseIds: [offSale.courseId],
        limit: 50,
      });
      expect(again).toEqual({ cancelled: 0, failed: 0, remaining: 0 });
    });

    // A paused (or past_due) row keeps its status when cancelled, so only
    // `cancel_at_period_end` stops the next run re-sending it to Stripe.
    it('cancels a paused subscription once: it stays paused, and the next run leaves it', async () => {
      const offSale = await subscribedCourse(true);
      await db
        .update(courseSubscriptions)
        .set({ status: 'paused' })
        .where(eq(courseSubscriptions.id, offSale.sub.id));
      const { svc, stripe } = serviceWithMailer();

      const first = await svc.cancelForCoursesOffSale({
        courseIds: [offSale.courseId],
        limit: 50,
      });
      const [after] = await db
        .select()
        .from(courseSubscriptions)
        .where(eq(courseSubscriptions.id, offSale.sub.id));
      const again = await svc.cancelForCoursesOffSale({
        courseIds: [offSale.courseId],
        limit: 50,
      });

      expect(first).toEqual({ cancelled: 1, failed: 0, remaining: 0 });
      expect(after).toMatchObject({
        status: 'paused',
        cancelAtPeriodEnd: true,
      });
      expect(again).toEqual({ cancelled: 0, failed: 0, remaining: 0 });
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    });

    it('stops at the limit and reports what is left for the hourly sweep', async () => {
      const first = await subscribedCourse(true);
      const second = await subscribedCourse(true);
      const { svc } = serviceWithMailer();

      const result = await svc.cancelForCoursesOffSale({
        courseIds: [first.courseId, second.courseId],
        limit: 1,
      });

      expect(result).toEqual({ cancelled: 1, failed: 0, remaining: 1 });
    });

    it('a Stripe failure is counted, logged, and left for the next run', async () => {
      const offSale = await subscribedCourse(true);
      const { svc, stripe, mailer } = serviceWithMailer();
      vi.mocked(stripe.subscriptions.update).mockRejectedValueOnce(
        new Error('Stripe is down')
      );

      const result = await svc.cancelForCoursesOffSale({
        courseIds: [offSale.courseId],
        limit: 50,
      });

      expect(result).toEqual({ cancelled: 0, failed: 1, remaining: 1 });
      const [after] = await db
        .select()
        .from(courseSubscriptions)
        .where(eq(courseSubscriptions.id, offSale.sub.id));
      expect(after?.cancelAtPeriodEnd).toBe(false);
      expect(after?.status).toBe('active');
      expect(mailer).not.toHaveBeenCalled();
    });

    it('the hourly sweep (no courseIds) cancels what the removal left', async () => {
      const offSale = await subscribedCourse(true);
      const { svc } = serviceWithMailer();

      await svc.cancelForCoursesOffSale({ limit: 50 });

      const [after] = await db
        .select()
        .from(courseSubscriptions)
        .where(eq(courseSubscriptions.id, offSale.sub.id));
      expect(after?.cancelAtPeriodEnd).toBe(true);
    });
  });
});
