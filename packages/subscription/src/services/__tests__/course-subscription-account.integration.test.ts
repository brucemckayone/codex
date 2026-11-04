/**
 * Course subscriptions on Account › Subscriptions, and the lifecycle emails
 * and amount their webhooks now carry (Codex-2hxff.52; data design §6.3,
 * C1-C4; owner decisions Q5, Q6).
 *
 * - The list shows the caller's live course subscriptions only, paginated.
 * - Cancel and Reactivate act on one of those, each a Stripe write whose key
 *   changes with the row, so a toggle inside Stripe's 24 hours is not a
 *   replay. Reactivate is refused off sale (COURSE_NOT_ON_SALE), and allowed
 *   when the plan only stopped taking new subscribers (Q6).
 * - Welcome, renewal and cancellation emails; the cancellation is skipped off
 *   sale (the sweep already said so) and on a redelivery.
 * - invoice.payment_failed: the payment-failed email, unless no retry is left
 *   (Q5), the row has ended, or it is a duplicate.
 * - `amount_cents` follows the item's price on created, updated and paid.
 *
 * Real DB, mocked Stripe. Every row hangs off this file's own organisation
 * and users and is deleted in afterAll (the local database is shared).
 */

import { randomUUID } from 'node:crypto';
import * as schema from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createMockStripe,
  createMockStripeInvoice,
  createMockStripeSubscription,
  createTestConnectAccountInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CourseNotOnSaleError } from '../../errors';
import {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  CourseSubscriptionService,
} from '../course-subscription-service';

const DAY = 86_400;

describe('course subscriptions on the account page (Codex-2hxff.52)', () => {
  let db: Database;
  let stripe: Stripe;
  let service: CourseSubscriptionService;
  let creatorId: string;
  let orgId: string;
  let orgSlug: string;
  const userIds: string[] = [];
  const courseIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    userIds.push(creatorId);
    await db
      .insert(schema.stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId));
    orgSlug = createUniqueSlug('cs-acct');
    orgId = takeFirst(
      await db
        .insert(schema.organizations)
        .values({ name: 'Course Account', slug: orgSlug })
        .returning({ id: schema.organizations.id })
    ).id;
    await db.insert(schema.organizationMemberships).values({
      organizationId: orgId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
    });
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new CourseSubscriptionService(
      {
        db,
        environment: 'test',
        ...createTestMoneyDeps(),
        webAppUrl: 'https://app.test',
      },
      stripe
    );
  });

  afterAll(async () => {
    const subs = await db
      .select({ id: schema.courseSubscriptions.id })
      .from(schema.courseSubscriptions)
      .where(inArray(schema.courseSubscriptions.userId, userIds));
    if (subs.length > 0) {
      await db.delete(schema.payouts).where(
        inArray(
          schema.payouts.courseSubscriptionId,
          subs.map((s) => s.id)
        )
      );
    }
    await db
      .delete(schema.entitlements)
      .where(inArray(schema.entitlements.userId, userIds));
    await db
      .delete(schema.courseEnrollments)
      .where(inArray(schema.courseEnrollments.userId, userIds));
    await db
      .delete(schema.courseSubscriptions)
      .where(inArray(schema.courseSubscriptions.userId, userIds));
    if (courseIds.length > 0) {
      await db
        .delete(schema.courseSubscriptionPlans)
        .where(inArray(schema.courseSubscriptionPlans.courseId, courseIds));
      await db
        .delete(schema.courses)
        .where(inArray(schema.courses.id, courseIds));
    }
    await db
      .delete(schema.stripeConnectAccounts)
      .where(inArray(schema.stripeConnectAccounts.userId, userIds));
    await db
      .delete(schema.stripeConnectAccountHistory)
      .where(inArray(schema.stripeConnectAccountHistory.userId, userIds));
    await db
      .delete(schema.organizationMemberships)
      .where(eq(schema.organizationMemberships.organizationId, orgId));
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await teardownTestDatabase();
  });

  async function subscriber(): Promise<string> {
    const userId = takeFirst(await seedTestUsers(db, 1), 'subscriber');
    userIds.push(userId);
    return userId;
  }

  /** A published course with a £50/month plan, by this file's creator. */
  async function course(title = 'Hollow Oak Breathwork') {
    const row = takeFirst(
      await db
        .insert(schema.courses)
        .values({
          organizationId: orgId,
          creatorId,
          slug: createUniqueSlug('cs-acct-course'),
          title,
          status: 'published',
          priceCents: null,
        })
        .returning()
    );
    courseIds.push(row.id);
    const plan = takeFirst(
      await db
        .insert(schema.courseSubscriptionPlans)
        .values({
          courseId: row.id,
          priceMonthly: 5000,
          priceAnnual: 50000,
          stripeProductId: `prod_${randomUUID().slice(0, 8)}`,
          stripePriceMonthlyId: `price_m_${randomUUID().slice(0, 8)}`,
          stripePriceAnnualId: `price_a_${randomUUID().slice(0, 8)}`,
        })
        .returning()
    );
    return { course: row, plan };
  }

  /** A Stripe course subscription for `userId`, as the webhook receives it. */
  function stripeSub(
    userId: string,
    target: Awaited<ReturnType<typeof course>>,
    overrides: Record<string, unknown> = {},
    unitAmount = 5000
  ): Stripe.Subscription {
    const now = Math.floor(Date.now() / 1000);
    return createMockStripeSubscription({
      id: `sub_${randomUUID().slice(0, 8)}`,
      customer: `cus_${randomUUID().slice(0, 8)}`,
      metadata: {
        type: COURSE_SUBSCRIPTION_METADATA_TYPE,
        codex_user_id: userId,
        codex_course_id: target.course.id,
        codex_plan_id: target.plan.id,
        codex_organization_id: orgId,
      },
      items: {
        data: [
          {
            id: `si_${randomUUID().slice(0, 8)}`,
            price: {
              id: target.plan.stripePriceMonthlyId,
              unit_amount: unitAmount,
              currency: 'gbp',
              recurring: { interval: 'month' },
            },
            current_period_start: now - 10 * DAY,
            current_period_end: now + 20 * DAY,
          },
        ],
      },
      ...overrides,
    }) as unknown as Stripe.Subscription;
  }

  async function created(sub: Stripe.Subscription) {
    const result = await service.handleCourseSubscriptionCreated(sub);
    const row = takeFirst(
      await db
        .select()
        .from(schema.courseSubscriptions)
        .where(eq(schema.courseSubscriptions.stripeSubscriptionId, sub.id))
    );
    return { result, row };
  }

  const rowOf = async (id: string) =>
    takeFirst(
      await db
        .select()
        .from(schema.courseSubscriptions)
        .where(eq(schema.courseSubscriptions.id, id))
    );

  const failedInvoice = (
    sub: Stripe.Subscription,
    nextAttempt: number | null
  ) =>
    createMockStripeInvoice({
      amount_due: 5000,
      next_payment_attempt: nextAttempt,
      parent: {
        subscription_details: {
          subscription: sub.id,
          metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
        },
      },
    }) as unknown as Stripe.Invoice;

  // ─── The list (C1) ──────────────────────────────────────────────────────

  describe('listForUser', () => {
    it("lists the caller's live course subscriptions with their course and organisation, newest first", async () => {
      const me = await subscriber();
      const someoneElse = await subscriber();
      const a = await course('Course A');
      const b = await course('Course B');
      const c = await course('Course C');
      const d = await course('Course D');
      const { row: active } = await created(stripeSub(me, a));
      const { row: cancelling } = await created(
        stripeSub(me, b, { cancel_at_period_end: true })
      );
      const { row: pastDue } = await created(
        stripeSub(me, c, { status: 'past_due' })
      );
      // Not listed: one that never started, one that ended, and another
      // user's.
      await created(stripeSub(me, d, { status: 'incomplete' }));
      const ended = stripeSub(me, d);
      await created(ended);
      await service.handleCourseSubscriptionDeleted({
        ...ended,
        status: 'canceled',
      } as Stripe.Subscription);
      await created(stripeSub(someoneElse, a));

      const listed = await service.listForUser(me, { page: 1, limit: 20 });

      expect(listed.items.map((item) => item.id)).toEqual([
        pastDue.id,
        cancelling.id,
        active.id,
      ]);
      expect(listed.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
      expect(listed.items.at(-1)).toMatchObject({
        status: 'active',
        billingInterval: 'month',
        amountCents: 5000,
        cancelAtPeriodEnd: false,
        canReactivate: false,
        course: { id: a.course.id, title: 'Course A', offSale: false },
        organization: { id: orgId, slug: orgSlug },
      });
      expect(listed.items[1]).toMatchObject({
        status: 'cancelling',
        canReactivate: true,
      });
    });

    it('pages: limit 2, page 2 is the oldest one, the total counts all three', async () => {
      const me = await subscriber();
      const ids: string[] = [];
      for (const title of ['P1', 'P2', 'P3']) {
        ids.push((await created(stripeSub(me, await course(title)))).row.id);
      }

      const second = await service.listForUser(me, { page: 2, limit: 2 });

      expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
      expect(second.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });
  });

  // ─── Cancel and Reactivate (C2, C3) ─────────────────────────────────────

  describe('cancelForUser and reactivateForUser', () => {
    it('cancel: Stripe set to cancel at the period end, the row cancelling at once', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course());
      const { row } = await created(sub);

      const card = await service.cancelForUser(me, row.id);

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        { cancel_at_period_end: true },
        {
          idempotencyKey: `course-cancel:${row.id}:${Math.floor(row.currentPeriodEnd.getTime() / 1000)}:${row.updatedAt.getTime()}`,
        }
      );
      expect(card).toMatchObject({
        id: row.id,
        status: 'cancelling',
        cancelAtPeriodEnd: true,
        canReactivate: true,
      });
      expect((await rowOf(row.id)).status).toBe('cancelling');
    });

    it('cancel twice: the second changes nothing', async () => {
      const me = await subscriber();
      const { row } = await created(
        stripeSub(me, await course(), { cancel_at_period_end: true })
      );

      await service.cancelForUser(me, row.id);

      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('cancel, reactivate, cancel inside 24 hours: three writes under three keys', async () => {
      const me = await subscriber();
      const { row } = await created(stripeSub(me, await course()));

      await service.cancelForUser(me, row.id);
      await service.reactivateForUser(me, row.id);
      await service.cancelForUser(me, row.id);

      const keys = vi
        .mocked(stripe.subscriptions.update)
        .mock.calls.map(
          (call) => (call[2] as { idempotencyKey: string }).idempotencyKey
        );
      expect(keys).toHaveLength(3);
      expect(new Set(keys).size).toBe(3);
      expect((await rowOf(row.id)).status).toBe('cancelling');
    });

    it('reactivate: Stripe undoes the cancel, the row active again', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course(), { cancel_at_period_end: true });
      const { row } = await created(sub);

      const card = await service.reactivateForUser(me, row.id);

      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        { cancel_at_period_end: false },
        { idempotencyKey: expect.stringMatching(/^course-reactivate:/) }
      );
      expect(card).toMatchObject({
        status: 'active',
        cancelAtPeriodEnd: false,
      });
    });

    it('reactivate after the plan stopped taking new subscribers: allowed (Q6)', async () => {
      const me = await subscriber();
      const target = await course();
      const { row } = await created(
        stripeSub(me, target, { cancel_at_period_end: true })
      );
      await db
        .update(schema.courseSubscriptionPlans)
        .set({ isActive: false })
        .where(eq(schema.courseSubscriptionPlans.id, target.plan.id));

      const card = await service.reactivateForUser(me, row.id);

      expect(card.status).toBe('active');
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    });

    it('reactivate once the course is off sale: COURSE_NOT_ON_SALE (409), Stripe untouched', async () => {
      const me = await subscriber();
      const target = await course();
      const { row } = await created(
        stripeSub(me, target, { cancel_at_period_end: true })
      );
      await db
        .update(schema.courses)
        .set({ offSaleAt: new Date() })
        .where(eq(schema.courses.id, target.course.id));
      const listed = await service.listForUser(me, { page: 1, limit: 20 });
      expect(listed.items[0]).toMatchObject({
        canReactivate: false,
        course: { offSale: true },
      });

      const refused = await service
        .reactivateForUser(me, row.id)
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(CourseNotOnSaleError);
      expect((refused as CourseNotOnSaleError).statusCode).toBe(409);
      expect((refused as CourseNotOnSaleError).context).toMatchObject({
        code: 'COURSE_NOT_ON_SALE',
      });
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("another user's, or an ended one: not found, the same answer either way", async () => {
      const me = await subscriber();
      const thief = await subscriber();
      const ended = stripeSub(me, await course());
      const { row } = await created(ended);
      const live = (await created(stripeSub(me, await course()))).row;
      await service.handleCourseSubscriptionDeleted({
        ...ended,
        status: 'canceled',
      } as Stripe.Subscription);

      for (const attempt of [
        () => service.cancelForUser(thief, live.id),
        () => service.reactivateForUser(thief, live.id),
        () => service.cancelForUser(me, row.id),
      ]) {
        const refused = await attempt().catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(NotFoundError);
        expect((refused as NotFoundError).context).toMatchObject({
          code: 'COURSE_SUBSCRIPTION_NOT_FOUND',
        });
      }
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  // ─── Lifecycle emails (C4) ──────────────────────────────────────────────

  describe('lifecycle emails', () => {
    it('created: the welcome, naming the course', async () => {
      const me = await subscriber();

      const { result } = await created(
        stripeSub(me, await course('Welcome Course'))
      );

      expect(result?.email).toMatchObject({
        templateName: 'subscription-created',
        userId: me,
        data: {
          planName: 'Welcome Course',
          priceFormatted: '£50.00',
          manageUrl: 'https://app.test/account/subscriptions',
        },
      });
    });

    it('a cycle renewal: the receipt; the first invoice: none', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course('Renewing Course'));
      await created(sub);
      const invoice = (billing_reason: string) =>
        createMockStripeInvoice({
          amount_paid: 5000,
          currency: 'gbp',
          billing_reason,
          parent: {
            subscription_details: {
              subscription: sub.id,
              metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
            },
          },
        }) as unknown as Stripe.Invoice;

      const first = await service.handleCourseInvoicePaymentSucceeded(
        invoice('subscription_create'),
        sub
      );
      const renewal = await service.handleCourseInvoicePaymentSucceeded(
        invoice('subscription_cycle'),
        sub
      );

      expect(first?.email).toBeUndefined();
      expect(renewal?.email).toMatchObject({
        templateName: 'subscription-renewed',
        data: { planName: 'Renewing Course', priceFormatted: '£50.00' },
      });
    });

    // Review C1 cycle 2, L5: credit paid the renewal in full. The receipt
    // names the bill, not the £0.00 the card paid.
    it('a cycle renewal that credit paid in full: the receipt names the bill', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course('Credit Course'));
      await created(sub);

      const renewal = await service.handleCourseInvoicePaymentSucceeded(
        createMockStripeInvoice({
          amount_paid: 0,
          total: 5000,
          starting_balance: -5000,
          currency: 'gbp',
          billing_reason: 'subscription_cycle',
          payments: { data: [] },
          parent: {
            subscription_details: {
              subscription: sub.id,
              metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
            },
          },
        }) as unknown as Stripe.Invoice,
        sub
      );

      expect(renewal?.email).toMatchObject({
        templateName: 'subscription-renewed',
        data: { planName: 'Credit Course', priceFormatted: '£50.00' },
      });
    });

    it('ended: the cancellation once, with Resubscribe on the course page; a redelivery sends none', async () => {
      const me = await subscriber();
      const target = await course('Ending Course');
      const sub = stripeSub(me, target);
      await created(sub);
      const deleted = { ...sub, status: 'canceled' } as Stripe.Subscription;

      const first = await service.handleCourseSubscriptionDeleted(deleted);
      const again = await service.handleCourseSubscriptionDeleted(deleted);

      expect(first?.email).toMatchObject({
        templateName: 'subscription-cancelled',
        data: { planName: 'Ending Course' },
      });
      expect(
        (first?.email?.data as { resubscribeUrl: string }).resubscribeUrl
      ).toContain(`/journeys/${target.course.slug}`);
      expect(again?.email).toBeUndefined();
    });

    it('ended off sale: no cancellation email (the off-sale notice already went)', async () => {
      const me = await subscriber();
      const target = await course();
      const sub = stripeSub(me, target);
      await created(sub);
      await db
        .update(schema.courses)
        .set({ offSaleAt: new Date() })
        .where(eq(schema.courses.id, target.course.id));

      const result = await service.handleCourseSubscriptionDeleted({
        ...sub,
        status: 'canceled',
      } as Stripe.Subscription);

      expect(result?.email).toBeUndefined();
      expect(result?.userId).toBe(me);
    });
  });

  // ─── invoice.payment_failed (C4, Q5) ────────────────────────────────────

  describe('handleCourseInvoicePaymentFailed', () => {
    it('a retry is scheduled: the payment-failed email, naming the course and the retry', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course('Failing Course'));
      await created(sub);
      const retry = Math.floor(Date.now() / 1000) + 3 * DAY;

      const result = await service.handleCourseInvoicePaymentFailed(
        failedInvoice(sub, retry),
        sub.id
      );

      expect(result?.email).toMatchObject({
        templateName: 'payment-failed',
        userId: me,
        data: {
          planName: 'Failing Course',
          priceFormatted: '£50.00',
          retryDate: new Date(retry * 1000).toLocaleDateString('en-GB'),
          updatePaymentUrl: 'https://app.test/account/subscriptions',
        },
      });
    });

    it('no retry left: no email (Q5), the ids still returned for the caches', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course());
      await created(sub);

      const result = await service.handleCourseInvoicePaymentFailed(
        failedInvoice(sub, null),
        sub.id
      );

      expect(result).toEqual({ userId: me, organizationId: orgId });
    });

    it('ended: no email', async () => {
      const me = await subscriber();
      const sub = stripeSub(me, await course());
      await created(sub);
      await service.handleCourseSubscriptionDeleted({
        ...sub,
        status: 'canceled',
      } as Stripe.Subscription);

      const result = await service.handleCourseInvoicePaymentFailed(
        failedInvoice(sub, Math.floor(Date.now() / 1000) + DAY),
        sub.id
      );

      expect(result?.email).toBeUndefined();
    });

    it('not recorded: nothing', async () => {
      const result = await service.handleCourseInvoicePaymentFailed(
        failedInvoice(
          { id: 'sub_never_recorded' } as Stripe.Subscription,
          Math.floor(Date.now() / 1000) + DAY
        ),
        'sub_never_recorded'
      );

      expect(result).toBeUndefined();
    });
  });

  // ─── amount_cents (§6.3) ────────────────────────────────────────────────

  it('amount_cents follows the item price on created, updated and paid', async () => {
    const me = await subscriber();
    const target = await course();
    const sub = stripeSub(me, target, {}, 5000);
    const { row } = await created(sub);
    expect(row.amountCents).toBe(5000);

    const repriced = stripeSub(me, target, { id: sub.id }, 6000);
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
      repriced as unknown as Awaited<
        ReturnType<typeof stripe.subscriptions.retrieve>
      >
    );
    await service.handleCourseSubscriptionUpdated(repriced);
    expect((await rowOf(row.id)).amountCents).toBe(6000);

    const renewed = stripeSub(me, target, { id: sub.id }, 7000);
    await service.handleCourseInvoicePaymentSucceeded(
      createMockStripeInvoice({
        amount_paid: 7000,
        currency: 'gbp',
        billing_reason: 'subscription_cycle',
        parent: {
          subscription_details: {
            subscription: sub.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
      }) as unknown as Stripe.Invoice,
      renewed
    );
    expect((await rowOf(row.id)).amountCents).toBe(7000);
  });
});
