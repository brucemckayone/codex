/**
 * Course-plan subscription drift (Codex-2hxff.15). Real DB, mocked Stripe,
 * seeded as in course-subscription-service.integration.test.ts. Proves:
 *   1. SUB-07: a second subscription to a course the buyer holds live is
 *      recorded as a duplicate, cancelled and refunded once, grants nothing,
 *      and every later event for it is inert (owner decision 2026-10-22,
 *      "Keep the first").
 *   2. SUB-09: a deletion leaves a tombstone no late or replayed event
 *      changes, and revokes only that subscription's grant.
 *   3. An `unpaid` plan whose open invoice is paid gets its access back
 *      (owner decision 2026-10-22, "Yes, like tiers").
 *   4. One open checkout per buyer and course plan (owner decision
 *      2026-10-22, "Block early, same as purchases").
 *
 * Every test uses its own course: the one-live-subscription and one-live-grant
 * indexes are per buyer and course.
 */

import { randomUUID } from 'node:crypto';
import { stripeEnvMetadata } from '@codex/constants';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  entitlements,
  organizationMemberships,
  organizations,
  payouts,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
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
import { and, eq, gt, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  CourseSubscriptionService,
} from '../course-subscription-service';

const DAY_SECONDS = 24 * 3600;

/**
 * createMockStripe's paymentIntents.retrieve mints a fresh `latest_charge` on
 * every call. Real Stripe returns the same one: pi_<x> → ch_<x>.
 */
function stripeWithStableCharges(): Stripe {
  const stripe = createMockStripe();
  vi.mocked(stripe.paymentIntents.retrieve).mockImplementation((async (
    id: string
  ) => ({ id, latest_charge: id.replace(/^pi_/, 'ch_') })) as never);
  return stripe;
}

/** The duplicate's one paid invoice, paid by card as Stripe sends it. */
function duplicatePaidInvoice(stripe: Stripe) {
  const invoiceId = `in_${randomUUID().slice(0, 8)}`;
  const piId = `pi_${randomUUID().slice(0, 8)}`;
  vi.mocked(stripe.invoices.list).mockResolvedValue({
    object: 'list',
    data: [
      {
        id: invoiceId,
        amount_paid: 5000,
        payments: {
          data: [{ payment: { type: 'payment_intent', payment_intent: piId } }],
        },
      },
    ],
    has_more: false,
  } as never);
  return { invoiceId, chargeId: piId.replace(/^pi_/, 'ch_') };
}

describe('Course-plan subscription drift (Codex-2hxff.15)', () => {
  let db: Database;
  let subscriberId: string;
  let creatorId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [subscriberId, creatorId] = await seedTestUsers(db, 2);

    await db
      .insert(stripeConnectAccounts)
      .values(createTestConnectAccountInput(null, creatorId))
      .onConflictDoNothing();

    const [org] = await db
      .insert(organizations)
      .values({ name: 'Course Drift Org', slug: createUniqueSlug('cd-org') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed org');
    orgId = org.id;
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
    });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A fresh course + plan. */
  async function makeCourseWithPlan(): Promise<{ cId: string; pId: string }> {
    const [c] = await db
      .insert(courses)
      .values({
        organizationId: orgId,
        creatorId,
        slug: createUniqueSlug('cd-course'),
        title: 'Drift Course',
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

  /** A course-plan Stripe subscription, tagged with this environment. */
  function courseSub(
    cId: string,
    pId: string,
    id = `sub_${randomUUID().slice(0, 8)}`
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
        ...stripeEnvMetadata('test'),
      },
    }) as unknown as Stripe.Subscription;
  }

  /** The same subscription as Stripe reports it later. */
  function as(
    sub: Stripe.Subscription,
    status: Stripe.Subscription.Status,
    periodEndSeconds?: number
  ): Stripe.Subscription {
    return {
      ...sub,
      status,
      items: {
        ...sub.items,
        data: sub.items.data.map((item) => ({
          ...item,
          current_period_end: periodEndSeconds ?? item.current_period_end,
        })),
      },
    } as Stripe.Subscription;
  }

  /**
   * A service whose first transaction waits for `first` (another event,
   * handled by another service) to commit: the interleaving is fixed rather
   * than left to timing.
   */
  function serviceRacing(
    first: () => Promise<unknown>,
    stripe: Stripe = stripeWithStableCharges()
  ) {
    let raced = false;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return async (fn: Parameters<Database['transaction']>[0]) => {
            if (!raced) {
              raced = true;
              await first();
            }
            return target.transaction(fn);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const service = new CourseSubscriptionService(
      { db: racing, environment: 'test' },
      stripe
    );
    return { service, raced: () => raced };
  }

  function serviceWith(stripe: Stripe = stripeWithStableCharges()) {
    return {
      stripe,
      service: new CourseSubscriptionService(
        { db, environment: 'test' },
        stripe
      ),
    };
  }

  async function rowFor(stripeSubscriptionId: string) {
    const [row] = await db
      .select()
      .from(courseSubscriptions)
      .where(
        eq(courseSubscriptions.stripeSubscriptionId, stripeSubscriptionId)
      );
    return row;
  }

  /** Every course_subscription grant the subscriber holds on the course. */
  function grantsOn(cId: string) {
    return db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, subscriberId),
          eq(entitlements.courseId, cId),
          eq(entitlements.source, 'course_subscription')
        )
      );
  }

  /** The grant the resolver would honour now: live and unexpired. */
  async function liveGrant(cId: string) {
    const [grant] = await db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, subscriberId),
          eq(entitlements.courseId, cId),
          eq(entitlements.source, 'course_subscription'),
          isNull(entitlements.revokedAt),
          gt(entitlements.expiresAt, new Date())
        )
      );
    return grant;
  }

  describe('a second subscription to a course already held (SUB-07)', () => {
    async function liveThenDuplicate() {
      const { cId, pId } = await makeCourseWithPlan();
      const { stripe, service } = serviceWith();
      const first = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(first);
      const firstRow = await rowFor(first.id);
      if (!firstRow) throw new Error('first subscription not recorded');
      const paid = duplicatePaidInvoice(stripe);
      return { cId, pId, stripe, service, first, firstRow, paid };
    }

    it('is recorded as a duplicate, cancelled and refunded once, and grants nothing', async () => {
      const { cId, pId, stripe, service, firstRow, paid } =
        await liveThenDuplicate();
      const second = courseSub(cId, pId);

      const result = await service.handleCourseSubscriptionCreated(second);

      expect(result).toBeUndefined();
      const dup = await rowFor(second.id);
      expect(dup).toMatchObject({
        status: 'cancelled',
        duplicateOfCourseSubscriptionId: firstRow.id,
      });
      expect(dup?.duplicateSettledAt).not.toBeNull();
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
        second.id,
        expect.objectContaining({ prorate: false }),
        { idempotencyKey: `dup_cancel_${second.id}` }
      );
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: paid.chargeId, reason: 'duplicate' }),
        { idempotencyKey: `refund_duplicate_${paid.invoiceId}` }
      );
      const grants = await grantsOn(cId);
      expect(grants).toHaveLength(1);
      expect(grants[0]?.sourceRef).toBe(firstRow.id);
      expect(grants[0]?.revokedAt).toBeNull();
      expect((await rowFor(firstRow.stripeSubscriptionId))?.status).toBe(
        'active'
      );
    });

    it('a redelivery and its updates ask Stripe nothing more and change nothing', async () => {
      const { cId, pId, stripe, service, firstRow } = await liveThenDuplicate();
      const second = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(second);
      const settled = await rowFor(second.id);
      const retrieves = vi.mocked(stripe.subscriptions.retrieve).mock.calls
        .length;

      const results = [
        await service.handleCourseSubscriptionCreated(second),
        await service.handleCourseSubscriptionUpdated(as(second, 'active')),
      ];

      expect(results).toEqual([undefined, undefined]);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(vi.mocked(stripe.subscriptions.retrieve).mock.calls).toHaveLength(
        retrieves
      );
      expect(await rowFor(second.id)).toEqual(settled);
      expect((await grantsOn(cId)).map((g) => g.sourceRef)).toEqual([
        firstRow.id,
      ]);
    });

    // A delayed payment method (Bacs Direct Debit and others) can be paid
    // after the settle found nothing paid to refund.
    it('paid after it was settled: that invoice is refunded by its charge, and pays no one', async () => {
      const { cId, pId } = await makeCourseWithPlan();
      const { stripe, service } = serviceWith();
      await service.handleCourseSubscriptionCreated(courseSub(cId, pId));
      const second = courseSub(cId, pId);
      // Settled while its first payment was still pending: nothing to refund.
      await service.handleCourseSubscriptionCreated(second);
      const settled = await rowFor(second.id);
      expect(settled?.duplicateSettledAt).not.toBeNull();
      expect(stripe.refunds.create).not.toHaveBeenCalled();

      const piId = `pi_${randomUUID().slice(0, 8)}`;
      const invoice = createMockStripeInvoice({
        amount_paid: 5000,
        currency: 'gbp',
        parent: {
          subscription_details: {
            subscription: second.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
        payments: {
          data: [{ payment: { type: 'payment_intent', payment_intent: piId } }],
        },
      }) as unknown as Stripe.Invoice;
      const result = await service.handleCourseInvoicePaymentSucceeded(
        invoice,
        as(second, 'canceled')
      );

      expect(result).toBeUndefined();
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          charge: piId.replace(/^pi_/, 'ch_'),
          reason: 'duplicate',
        }),
        { idempotencyKey: `refund_duplicate_${invoice.id}` }
      );
      const dupPayouts = await db
        .select()
        .from(payouts)
        .where(eq(payouts.courseSubscriptionId, settled?.id ?? ''));
      expect(dupPayouts).toHaveLength(0);
      expect(await rowFor(second.id)).toEqual(settled);
    });

    it('a refused refund is retryable and leaves the duplicate owed; the retry settles it', async () => {
      const { cId, pId, stripe, service, paid } = await liveThenDuplicate();
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
        Object.assign(new Error('Insufficient funds in your Stripe balance'), {
          type: 'StripeInvalidRequestError',
          code: 'balance_insufficient',
        })
      );
      const second = courseSub(cId, pId);

      await expect(
        service.handleCourseSubscriptionCreated(second)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      const owed = await rowFor(second.id);
      expect(owed?.duplicateOfCourseSubscriptionId).not.toBeNull();
      expect(owed?.duplicateSettledAt).toBeNull();

      // Stripe redelivers the event.
      await expect(
        service.handleCourseSubscriptionCreated(second)
      ).resolves.toBeUndefined();
      expect((await rowFor(second.id))?.duplicateSettledAt).not.toBeNull();
      expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
      for (const nth of [1, 2]) {
        expect(stripe.refunds.create).toHaveBeenNthCalledWith(
          nth,
          expect.objectContaining({ charge: paid.chargeId }),
          { idempotencyKey: `refund_duplicate_${paid.invoiceId}` }
        );
      }
      expect(await grantsOn(cId)).toHaveLength(1);
    });

    it("its deletion leaves the first subscription and that subscription's grant alone", async () => {
      const { cId, pId, service, firstRow } = await liveThenDuplicate();
      const second = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(second);

      const result = await service.handleCourseSubscriptionDeleted(
        as(second, 'canceled')
      );

      expect(result).toBeUndefined();
      expect(await rowFor(firstRow.stripeSubscriptionId)).toMatchObject({
        status: 'active',
        endedAt: null,
      });
      expect((await liveGrant(cId))?.sourceRef).toBe(firstRow.id);
    });
  });

  describe('a deletion is final (SUB-09)', () => {
    it('a checkout.session.completed redelivered after the deletion writes no new grant', async () => {
      const { cId, pId } = await makeCourseWithPlan();
      const { service } = serviceWith();
      const sub = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(sub);
      await service.handleCourseSubscriptionDeleted(as(sub, 'canceled'));
      expect(await liveGrant(cId)).toBeUndefined();

      const result = await service.handleCourseSubscriptionCreated(sub);

      expect(result).toBeUndefined();
      expect(await liveGrant(cId)).toBeUndefined();
      const grants = await grantsOn(cId);
      expect(grants).toHaveLength(1);
      expect(grants[0]?.revokedAt).not.toBeNull();
      expect((await rowFor(sub.id))?.endedAt).not.toBeNull();
    });

    it('deleted before any row: a tombstone, which a stale update and a late checkout leave cancelled', async () => {
      const { cId, pId } = await makeCourseWithPlan();
      const { service } = serviceWith();
      const sub = courseSub(cId, pId);

      await service.handleCourseSubscriptionDeleted(as(sub, 'canceled'));
      const tombstone = await rowFor(sub.id);
      expect(tombstone).toMatchObject({
        status: 'cancelled',
        duplicateOfCourseSubscriptionId: null,
      });
      expect(tombstone?.endedAt).not.toBeNull();

      // The stale payload still says active.
      expect(
        await service.handleCourseSubscriptionUpdated(as(sub, 'active'))
      ).toBeUndefined();
      expect(
        await service.handleCourseSubscriptionCreated(sub)
      ).toBeUndefined();

      expect(await rowFor(sub.id)).toMatchObject({
        status: 'cancelled',
        endedAt: tombstone?.endedAt,
      });
      expect(await grantsOn(cId)).toHaveLength(0);
    });

    it('deleted before any row and not tagged with this environment: no tombstone', async () => {
      const { cId, pId } = await makeCourseWithPlan();
      const { service } = serviceWith();
      const sub = courseSub(cId, pId);
      const untagged = {
        ...as(sub, 'canceled'),
        metadata: { ...sub.metadata, codex_env: '' },
      } as Stripe.Subscription;

      expect(
        await service.handleCourseSubscriptionDeleted(untagged)
      ).toBeUndefined();
      expect(await rowFor(sub.id)).toBeUndefined();
    });

    it("a late deletion of an old subscription leaves the new subscription's grant", async () => {
      const { cId, pId } = await makeCourseWithPlan();
      const { service } = serviceWith();
      const old = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(old);
      // Stripe gave up on the old one's renewal: access ended.
      await service.handleCourseSubscriptionUpdated(as(old, 'unpaid'));
      const renewed = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(renewed);
      const renewedRow = await rowFor(renewed.id);

      await service.handleCourseSubscriptionDeleted(as(old, 'canceled'));

      expect((await liveGrant(cId))?.sourceRef).toBe(renewedRow?.id);
      expect((await rowFor(old.id))?.endedAt).not.toBeNull();
    });

    it("a live grant an ended subscription left behind gives way to the new one's", async () => {
      const { cId, pId } = await makeCourseWithPlan();
      const { service } = serviceWith();
      const old = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(old);
      const oldRow = await rowFor(old.id);
      // Cancelled without its grant being revoked (before Codex-2hxff.15,
      // an `updated` to `canceled` did that).
      await db
        .update(courseSubscriptions)
        .set({ status: 'cancelled' })
        .where(eq(courseSubscriptions.stripeSubscriptionId, old.id));
      const renewed = courseSub(cId, pId);

      await service.handleCourseSubscriptionCreated(renewed);
      const renewedRow = await rowFor(renewed.id);
      await service.handleCourseSubscriptionDeleted(as(old, 'canceled'));

      expect((await liveGrant(cId))?.sourceRef).toBe(renewedRow?.id);
      const oldGrant = (await grantsOn(cId)).find(
        (g) => g.sourceRef === oldRow?.id
      );
      expect(oldGrant?.revokedAt).not.toBeNull();
    });
  });

  // The deletion commits after a handler has read the row as live, and
  // before it writes the grant: the interleaving the lock closes. The
  // handler's first transaction (the lock) waits for the deletion, so the
  // order is fixed rather than left to timing.
  describe('a deletion that lands while a grant is being written', () => {
    /** A live row whose checkout has not written its grant yet. */
    async function recordedWithoutGrant() {
      const { cId, pId } = await makeCourseWithPlan();
      const sub = courseSub(cId, pId);
      const item = sub.items.data[0];
      await db.insert(courseSubscriptions).values({
        userId: subscriberId,
        courseId: cId,
        planId: pId,
        organizationId: orgId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: `cus_${randomUUID().slice(0, 8)}`,
        status: 'active',
        billingInterval: 'month',
        currentPeriodStart: new Date((item?.current_period_start ?? 0) * 1000),
        currentPeriodEnd: new Date((item?.current_period_end ?? 0) * 1000),
      });
      return { cId, sub };
    }

    it('checkout completion: no grant for the subscription the deletion ended', async () => {
      const { cId, sub } = await recordedWithoutGrant();
      const { service: deleting } = serviceWith();
      const racing = serviceRacing(() =>
        deleting.handleCourseSubscriptionDeleted(as(sub, 'canceled'))
      );

      const result = await racing.service.handleCourseSubscriptionCreated(sub);

      expect(racing.raced()).toBe(true);
      expect(result).toBeUndefined();
      expect((await rowFor(sub.id))?.endedAt).not.toBeNull();
      expect(await grantsOn(cId)).toHaveLength(0);
    });

    it('a paid invoice: the row stays ended and nothing is granted', async () => {
      const { cId, sub } = await recordedWithoutGrant();
      const { service: deleting } = serviceWith();
      const racing = serviceRacing(() =>
        deleting.handleCourseSubscriptionDeleted(as(sub, 'canceled'))
      );
      const invoice = createMockStripeInvoice({
        amount_paid: 5000,
        currency: 'gbp',
        parent: {
          subscription_details: {
            subscription: sub.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
        payments: { data: [] },
      }) as unknown as Stripe.Invoice;

      await racing.service.handleCourseInvoicePaymentSucceeded(
        invoice,
        as(sub, 'active')
      );

      expect(racing.raced()).toBe(true);
      const row = await rowFor(sub.id);
      expect(row?.status).toBe('cancelled');
      expect(row?.endedAt).not.toBeNull();
      expect(await grantsOn(cId)).toHaveLength(0);
    });
  });

  describe('unpaid, then the open invoice is paid (owner decision: "Yes, like tiers")', () => {
    async function unpaidSubscription() {
      const { cId, pId } = await makeCourseWithPlan();
      const ctx = serviceWith();
      const sub = courseSub(cId, pId);
      await ctx.service.handleCourseSubscriptionCreated(sub);
      expect(await liveGrant(cId)).toBeDefined();
      await ctx.service.handleCourseSubscriptionUpdated(as(sub, 'unpaid'));
      expect((await rowFor(sub.id))?.status).toBe('cancelled');
      expect(await liveGrant(cId)).toBeUndefined();
      const nextPeriodEnd = Math.floor(Date.now() / 1000) + 40 * DAY_SECONDS;
      return { cId, sub, nextPeriodEnd, ...ctx };
    }

    it('invoice paid with the subscription active again: access back until the new period end', async () => {
      const { cId, sub, nextPeriodEnd, service } = await unpaidSubscription();
      // No inline payments, and none on retrieve: no payout slices, which are
      // not what this test is about.
      const invoice = createMockStripeInvoice({
        amount_paid: 5000,
        currency: 'gbp',
        parent: {
          subscription_details: {
            subscription: sub.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
        payments: { data: [] },
      }) as unknown as Stripe.Invoice;

      await service.handleCourseInvoicePaymentSucceeded(
        invoice,
        as(sub, 'active', nextPeriodEnd)
      );

      const row = await rowFor(sub.id);
      expect(row).toMatchObject({ status: 'active', endedAt: null });
      const grant = await liveGrant(cId);
      expect(grant?.sourceRef).toBe(row?.id);
      expect(grant?.expiresAt?.getTime()).toBe(nextPeriodEnd * 1000);
    });

    it('an update to active, confirmed by the live subscription: access back until the new period end', async () => {
      const { cId, sub, nextPeriodEnd, stripe, service } =
        await unpaidSubscription();
      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce(
        as(sub, 'active', nextPeriodEnd) as never
      );

      await service.handleCourseSubscriptionUpdated(
        as(sub, 'active', nextPeriodEnd)
      );

      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith(sub.id);
      const row = await rowFor(sub.id);
      expect(row?.status).toBe('active');
      const grant = await liveGrant(cId);
      expect(grant?.sourceRef).toBe(row?.id);
      expect(grant?.expiresAt?.getTime()).toBe(nextPeriodEnd * 1000);
    });

    it('a stale update to active while Stripe still says unpaid: access stays off', async () => {
      const { cId, sub, nextPeriodEnd, stripe, service } =
        await unpaidSubscription();
      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce(
        as(sub, 'unpaid') as never
      );

      await service.handleCourseSubscriptionUpdated(
        as(sub, 'active', nextPeriodEnd)
      );

      expect((await rowFor(sub.id))?.status).toBe('cancelled');
      expect(await liveGrant(cId)).toBeUndefined();
    });
  });

  // Owner decision 7, "Cancel old, refund it": an `unpaid` subscription whose
  // open invoice is paid after the buyer took a newer one. The newer one
  // stays; the old one is cancelled and only the reviving invoice refunded.
  describe('an old subscription paid back to life next to a newer one', () => {
    /** A paid invoice for `sub`, paid by card: pi_<x> resolves to ch_<x>. */
    function paidInvoiceFor(sub: Stripe.Subscription) {
      const invoiceId = `in_${randomUUID().slice(0, 8)}`;
      const piId = `pi_${randomUUID().slice(0, 8)}`;
      const invoice = createMockStripeInvoice({
        id: invoiceId,
        status: 'paid',
        amount_paid: 5000,
        currency: 'gbp',
        parent: {
          subscription_details: {
            subscription: sub.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
        payments: {
          data: [{ payment: { type: 'payment_intent', payment_intent: piId } }],
        },
      }) as unknown as Stripe.Invoice;
      return { invoice, chargeId: piId.replace(/^pi_/, 'ch_') };
    }

    /**
     * A Stripe that keeps state, so a retry sees what the first attempt did:
     * a cancelled subscription stays cancelled, a refunded charge stays
     * refunded, and a refund replayed under its key is the same refund.
     */
    function statefulStripe() {
      const stripe = stripeWithStableCharges();
      const subs = new Map<string, Stripe.Subscription>();
      const invoices = new Map<string, Stripe.Invoice>();
      const refundsByKey = new Map<string, { id: string; charge: string }>();
      const refunded = new Set<string>();
      vi.mocked(stripe.subscriptions.retrieve).mockImplementation((async (
        id: string
      ) => subs.get(id)) as never);
      vi.mocked(stripe.subscriptions.cancel).mockImplementation((async (
        id: string
      ) => {
        const ended = { ...subs.get(id), status: 'canceled' };
        subs.set(id, ended as Stripe.Subscription);
        return ended;
      }) as never);
      vi.mocked(stripe.invoices.retrieve).mockImplementation(
        (async (id: string) =>
          invoices.get(id) ?? { id, payments: { data: [] } }) as never
      );
      vi.mocked(stripe.refunds.create).mockImplementation((async (
        params: { charge: string },
        options?: { idempotencyKey?: string }
      ) => {
        const key = options?.idempotencyKey ?? '';
        const replay = refundsByKey.get(key);
        if (replay) return replay;
        if (refunded.has(params.charge)) {
          throw Object.assign(new Error('Charge has already been refunded.'), {
            type: 'StripeInvalidRequestError',
            code: 'charge_already_refunded',
          });
        }
        const refund = { id: `re_${randomUUID().slice(0, 8)}`, ...params };
        refunded.add(params.charge);
        refundsByKey.set(key, refund);
        return refund;
      }) as never);
      vi.mocked(stripe.charges.retrieve).mockImplementation((async (
        id: string
      ) => ({
        id,
        object: 'charge',
        amount: 5000,
        amount_refunded: refunded.has(id) ? 5000 : 0,
        refunded: refunded.has(id),
      })) as never);
      return { stripe, subs, invoices, refunded };
    }

    /**
     * A unpaid (its access ended), then B live; then A's open invoice is
     * paid and Stripe makes A active again, with that invoice its latest.
     */
    async function revivedNextToNewer() {
      const { cId, pId } = await makeCourseWithPlan();
      const state = statefulStripe();
      const { service } = serviceWith(state.stripe);
      const old = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(old);
      await service.handleCourseSubscriptionUpdated(as(old, 'unpaid'));
      const newer = courseSub(cId, pId);
      await service.handleCourseSubscriptionCreated(newer);
      const oldRow = await rowFor(old.id);
      const newerRow = await rowFor(newer.id);
      if (!oldRow || !newerRow) throw new Error('subscriptions not recorded');
      expect(oldRow).toMatchObject({ status: 'cancelled', endedAt: null });

      const nextPeriodEnd = Math.floor(Date.now() / 1000) + 40 * DAY_SECONDS;
      const { invoice, chargeId } = paidInvoiceFor(old);
      state.invoices.set(invoice.id, invoice);
      state.subs.set(old.id, {
        ...as(old, 'active', nextPeriodEnd),
        latest_invoice: invoice.id,
      } as Stripe.Subscription);
      /** The subscription as the webhook retrieves it now. */
      const atStripe = async () =>
        (await state.stripe.subscriptions.retrieve(
          old.id
        )) as Stripe.Subscription;
      return {
        cId,
        old,
        oldRow,
        newerRow,
        nextPeriodEnd,
        invoice,
        chargeId,
        atStripe,
        service,
        ...state,
      };
    }

    /** The newer subscription and its access, untouched; the old one ended. */
    async function expectNewerKeptOldEnded(
      cId: string,
      old: Stripe.Subscription,
      newerRow: { id: string; stripeSubscriptionId: string }
    ) {
      expect(await rowFor(old.id)).toMatchObject({ status: 'cancelled' });
      expect((await rowFor(old.id))?.endedAt).not.toBeNull();
      expect(await rowFor(newerRow.stripeSubscriptionId)).toMatchObject({
        status: 'active',
        endedAt: null,
      });
      expect((await liveGrant(cId))?.sourceRef).toBe(newerRow.id);
    }

    function payoutsFor(courseSubscriptionId: string) {
      return db
        .select()
        .from(payouts)
        .where(eq(payouts.courseSubscriptionId, courseSubscriptionId));
    }

    it("its paid invoice: refunded, then cancelled, once each; no payout; the newer one's access kept", async () => {
      const ctx = await revivedNextToNewer();
      const { stripe, old, invoice } = ctx;

      const result = await ctx.service.handleCourseInvoicePaymentSucceeded(
        invoice,
        await ctx.atStripe()
      );

      expect(result).toBeUndefined();
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          charge: ctx.chargeId,
          reason: 'requested_by_customer',
        }),
        { idempotencyKey: `refund_revived_${invoice.id}` }
      );
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
        old.id,
        expect.objectContaining({ prorate: false }),
        { idempotencyKey: `revived_cancel_${old.id}` }
      );
      const [refundedAt] = vi.mocked(stripe.refunds.create).mock
        .invocationCallOrder;
      const [cancelledAt] = vi.mocked(stripe.subscriptions.cancel).mock
        .invocationCallOrder;
      expect(refundedAt).toBeLessThan(cancelledAt ?? 0);
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);
      expect(await payoutsFor(ctx.oldRow.id)).toHaveLength(0);
    });

    it('an update first, then its invoice: the update refunds and cancels; the invoice changes nothing and pays no one', async () => {
      const ctx = await revivedNextToNewer();
      const { stripe, old, invoice } = ctx;

      const updated = await ctx.service.handleCourseSubscriptionUpdated(
        as(old, 'active', ctx.nextPeriodEnd)
      );

      expect(updated).toBeUndefined();
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: ctx.chargeId }),
        { idempotencyKey: `refund_revived_${invoice.id}` }
      );
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);

      // The invoice lands next: Stripe has it cancelled, its charge refunded.
      const paid = await ctx.service.handleCourseInvoicePaymentSucceeded(
        invoice,
        await ctx.atStripe()
      );

      // Only the buyer's library cache is bumped; nothing else changes.
      expect(paid).toEqual({ userId: subscriberId, organizationId: orgId });
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(await payoutsFor(ctx.oldRow.id)).toHaveLength(0);
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);
    });

    // Cancelled first, a refused refund left it ended at Stripe; the
    // redelivery then saw no revival and paid the invoice out instead.
    it('a refused refund leaves Stripe and the row unchanged; the retry refunds once, cancels, and pays no one', async () => {
      const ctx = await revivedNextToNewer();
      const { stripe, old, invoice } = ctx;
      vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
        Object.assign(new Error('Insufficient funds in your Stripe balance'), {
          type: 'StripeInvalidRequestError',
          code: 'balance_insufficient',
        })
      );

      await expect(
        ctx.service.handleCourseInvoicePaymentSucceeded(
          invoice,
          await ctx.atStripe()
        )
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect((await ctx.atStripe()).status).toBe('active');
      expect(await rowFor(old.id)).toMatchObject({
        status: 'cancelled',
        endedAt: null,
      });

      // Stripe redelivers; the webhook retrieves the subscription again.
      await expect(
        ctx.service.handleCourseInvoicePaymentSucceeded(
          invoice,
          await ctx.atStripe()
        )
      ).resolves.toBeUndefined();

      expect([...ctx.refunded]).toEqual([ctx.chargeId]);
      for (const nth of [1, 2]) {
        expect(stripe.refunds.create).toHaveBeenNthCalledWith(
          nth,
          expect.anything(),
          { idempotencyKey: `refund_revived_${invoice.id}` }
        );
      }
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect((await ctx.atStripe()).status).toBe('canceled');
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);
      expect(await payoutsFor(ctx.oldRow.id)).toHaveLength(0);
    });

    it('a refused cancel after a good refund: the retry refunds nothing more and completes', async () => {
      const ctx = await revivedNextToNewer();
      const { stripe, old, invoice } = ctx;
      vi.mocked(stripe.subscriptions.cancel).mockRejectedValueOnce(
        Object.assign(new Error('An error occurred with our connection'), {
          type: 'StripeConnectionError',
        })
      );

      await expect(
        ctx.service.handleCourseInvoicePaymentSucceeded(
          invoice,
          await ctx.atStripe()
        )
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect([...ctx.refunded]).toEqual([ctx.chargeId]);
      expect(await rowFor(old.id)).toMatchObject({
        status: 'cancelled',
        endedAt: null,
      });

      await expect(
        ctx.service.handleCourseInvoicePaymentSucceeded(
          invoice,
          await ctx.atStripe()
        )
      ).resolves.toBeUndefined();

      expect([...ctx.refunded]).toEqual([ctx.chargeId]);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
      for (const nth of [1, 2]) {
        expect(stripe.subscriptions.cancel).toHaveBeenNthCalledWith(
          nth,
          old.id,
          expect.anything(),
          { idempotencyKey: `revived_cancel_${old.id}` }
        );
      }
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);
      expect(await payoutsFor(ctx.oldRow.id)).toHaveLength(0);
    });

    // As tiers: the earlier invoice retires the revival too, refunding the
    // latest invoice; it bought real access itself, so it pays out.
    it('a redelivered earlier invoice retires the revival (the latest invoice refunded) and is itself paid out', async () => {
      const ctx = await revivedNextToNewer();
      const { stripe, old } = ctx;
      const earlier = paidInvoiceFor(old);

      await ctx.service.handleCourseInvoicePaymentSucceeded(
        earlier.invoice,
        await ctx.atStripe()
      );

      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: ctx.chargeId }),
        { idempotencyKey: `refund_revived_${ctx.invoice.id}` }
      );
      expect([...ctx.refunded]).toEqual([ctx.chargeId]);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);
      const slices = await payoutsFor(ctx.oldRow.id);
      expect(slices.map((r) => r.payoutType).sort()).toEqual([
        'creator_payout',
        'organization_fee',
        'platform_fee',
      ]);
      expect(slices.every((r) => r.stripeChargeId === earlier.chargeId)).toBe(
        true
      );
    });

    // The update's revival refunds and tombstones while the invoice is being
    // handled: the invoice read the row live, and the webhook retrieved the
    // subscription after the cancel. The charge it holds is being refunded.
    it('the invoice handled while the update retires it: no slices', async () => {
      const ctx = await revivedNextToNewer();
      const { old, invoice } = ctx;
      const updating = serviceWith(ctx.stripe).service;
      const racing = serviceRacing(
        () =>
          updating.handleCourseSubscriptionUpdated(
            as(old, 'active', ctx.nextPeriodEnd)
          ),
        ctx.stripe
      );

      await racing.service.handleCourseInvoicePaymentSucceeded(invoice, {
        ...as(old, 'canceled'),
        latest_invoice: invoice.id,
      } as Stripe.Subscription);

      expect(racing.raced()).toBe(true);
      expect([...ctx.refunded]).toEqual([ctx.chargeId]);
      expect(await payoutsFor(ctx.oldRow.id)).toHaveLength(0);
      await expectNewerKeptOldEnded(ctx.cId, old, ctx.newerRow);
    });
  });

  // K5: the hourly sweep. Its query is global, so these rows are dated 1990
  // and it is asked only for rows recorded before 2000: no other run's rows.
  describe('settleOwedDuplicates', () => {
    it('settles the owed duplicates Stripe accepts and returns the ones it still refuses', async () => {
      const { stripe, service } = serviceWith();
      const owedDuplicate = async () => {
        const { cId, pId } = await makeCourseWithPlan();
        const live = courseSub(cId, pId);
        await service.handleCourseSubscriptionCreated(live);
        const liveRow = await rowFor(live.id);
        const item = live.items.data[0];
        const stripeSubscriptionId = `sub_${randomUUID().slice(0, 8)}`;
        await db.insert(courseSubscriptions).values({
          userId: subscriberId,
          courseId: cId,
          planId: pId,
          organizationId: orgId,
          stripeSubscriptionId,
          stripeCustomerId: `cus_${randomUUID().slice(0, 8)}`,
          status: 'cancelled',
          billingInterval: 'month',
          currentPeriodStart: new Date(
            (item?.current_period_start ?? 0) * 1000
          ),
          currentPeriodEnd: new Date((item?.current_period_end ?? 0) * 1000),
          duplicateOfCourseSubscriptionId: liveRow?.id,
          createdAt: new Date('1990-01-01T00:00:00Z'),
        });
        const owed = await rowFor(stripeSubscriptionId);
        if (!owed) throw new Error('duplicate not recorded');
        return owed;
      };
      const refused = await owedDuplicate();
      const accepted = await owedDuplicate();
      vi.mocked(stripe.subscriptions.retrieve).mockImplementation((async (
        id: string
      ) => {
        if (id === refused.stripeSubscriptionId) {
          throw Object.assign(new Error('Stripe is unavailable'), {
            type: 'StripeAPIError',
          });
        }
        return { id, status: 'active' };
      }) as never);
      const olderThanMs = Date.now() - Date.parse('2000-01-01T00:00:00Z');

      const first = await service.settleOwedDuplicates({
        olderThanMs,
        limit: 50,
      });

      expect(first.settled).toBeGreaterThanOrEqual(1);
      expect(first.stillOwed).toContainEqual({
        id: refused.id,
        stripeSubscriptionId: refused.stripeSubscriptionId,
      });
      expect(first.stillOwed.map((r) => r.id)).not.toContain(accepted.id);
      expect(
        (await rowFor(accepted.stripeSubscriptionId))?.duplicateSettledAt
      ).not.toBeNull();
      expect(
        (await rowFor(refused.stripeSubscriptionId))?.duplicateSettledAt
      ).toBeNull();

      // Stripe recovers: the next sweep settles it.
      vi.mocked(stripe.subscriptions.retrieve).mockImplementation((async (
        id: string
      ) => ({ id, status: 'canceled' })) as never);
      const second = await service.settleOwedDuplicates({
        olderThanMs,
        limit: 50,
      });
      expect(second.stillOwed.map((r) => r.id)).not.toContain(refused.id);
      expect(
        (await rowFor(refused.stripeSubscriptionId))?.duplicateSettledAt
      ).not.toBeNull();
    });
  });

  // A late invoice on a subscription Stripe has ended: its charge is real, so
  // it pays out, unless it was refunded in full (the refund's clawback ran
  // before these slices existed and would never reverse them).
  describe('a late invoice on an ended subscription', () => {
    async function endedWithInvoice() {
      const { cId, pId } = await makeCourseWithPlan();
      const ctx = serviceWith();
      const sub = courseSub(cId, pId);
      await ctx.service.handleCourseSubscriptionCreated(sub);
      await ctx.service.handleCourseSubscriptionDeleted(as(sub, 'canceled'));
      const row = await rowFor(sub.id);
      if (!row) throw new Error('course subscription not recorded');
      const piId = `pi_${randomUUID().slice(0, 8)}`;
      const invoice = createMockStripeInvoice({
        amount_paid: 5000,
        currency: 'gbp',
        parent: {
          subscription_details: {
            subscription: sub.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
        payments: {
          data: [{ payment: { type: 'payment_intent', payment_intent: piId } }],
        },
      }) as unknown as Stripe.Invoice;
      const slices = () =>
        db
          .select()
          .from(payouts)
          .where(eq(payouts.courseSubscriptionId, row.id));
      return { sub, row, invoice, slices, ...ctx };
    }

    it('pays out a charge that was not refunded, and leaves the row as it is', async () => {
      const { sub, row, invoice, slices, service } = await endedWithInvoice();

      const result = await service.handleCourseInvoicePaymentSucceeded(
        invoice,
        as(sub, 'canceled')
      );

      expect(result).toEqual({ userId: subscriberId, organizationId: orgId });
      expect((await slices()).map((r) => r.payoutType).sort()).toEqual([
        'creator_payout',
        'organization_fee',
        'platform_fee',
      ]);
      expect(await rowFor(sub.id)).toEqual(row);
    });

    it('pays no one for a charge refunded in full', async () => {
      const { sub, invoice, slices, stripe, service } =
        await endedWithInvoice();
      vi.mocked(stripe.charges.retrieve).mockImplementation((async (
        id: string
      ) => ({
        id,
        object: 'charge',
        amount: 5000,
        amount_refunded: 5000,
        refunded: true,
      })) as never);

      await service.handleCourseInvoicePaymentSucceeded(
        invoice,
        as(sub, 'canceled')
      );

      expect(await slices()).toHaveLength(0);
    });
  });

  // Owner decision 2026-10-22, "Block early, same as purchases".
  describe('one open checkout per buyer and course plan', () => {
    function checkoutService() {
      const stripe = createMockStripe();
      // createMockStripe ships no customers stubs; checkout resolves the
      // buyer's Stripe Customer first.
      (stripe as unknown as { customers: unknown }).customers = {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
        create: vi.fn().mockImplementation(async () => ({
          id: `cus_${randomUUID().slice(0, 8)}`,
          created: Math.floor(Date.now() / 1000),
          metadata: {},
        })),
      };
      return serviceWith(stripe);
    }

    const input = (courseId: string, billingInterval: 'month' | 'year') => ({
      courseId,
      billingInterval,
      successUrl: 'http://lvh.me:3000/ok',
      cancelUrl: 'http://lvh.me:3000/cancel',
    });

    it('a second tab gets the same Stripe page; the other interval replaces it', async () => {
      const { cId } = await makeCourseWithPlan();
      const { stripe, service } = checkoutService();

      const first = await service.createCheckoutSession(
        subscriberId,
        input(cId, 'month')
      );
      const secondTab = await service.createCheckoutSession(
        subscriberId,
        input(cId, 'month')
      );

      expect(secondTab).toEqual(first);
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      // `create` is overloaded; its mock's call tuple types as the last one.
      const [params, options] = (vi.mocked(stripe.checkout.sessions.create).mock
        .calls[0] ?? []) as unknown as [
        Stripe.Checkout.SessionCreateParams?,
        Stripe.RequestOptions?,
      ];
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(params?.expires_at).toBeGreaterThanOrEqual(nowSeconds + 30 * 60);
      expect(params?.expires_at).toBeLessThanOrEqual(nowSeconds + 32 * 60);
      expect(options?.idempotencyKey).toMatch(/^checkout_/);

      const annual = await service.createCheckoutSession(
        subscriberId,
        input(cId, 'year')
      );

      expect(annual.sessionId).not.toBe(first.sessionId);
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
      expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
        first.sessionId
      );
    });
  });
});
