/**
 * A refunded subscription payment (Codex-2hxff.10; owner decision P-4,
 * docs/payments/subscriptions.md#refunds): a FULL refund of the CURRENT
 * PERIOD's payment cancels the subscription at Stripe, at once and without
 * proration; a partial refund, a refund of an earlier period's payment or of
 * an upgrade's proration invoice, or a subscription already ended cancels
 * nothing (owner decision 2026-10-20, "Current period's payment"). Tier and
 * course subscriptions alike.
 *
 * The money is specified in subscription-refund-clawback.integration.test.ts;
 * the webhook applying the cancellation in
 * workers/ecom-api/src/handlers/__tests__/payment-webhook-refund.test.ts.
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
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
import { isFullRefund } from '../subscription-refund';
import { SubscriptionService } from '../subscription-service';

const uid = () => randomUUID().slice(0, 8);

describe('isFullRefund', () => {
  it('is full once everything charged has been refunded', () => {
    expect(isFullRefund({ amountCents: 1999, amountRefundedCents: 1999 })).toBe(
      true
    );
    expect(isFullRefund({ amountCents: 1999, amountRefundedCents: 2000 })).toBe(
      true
    );
  });

  it('is partial below the charged amount, and never full for a zero charge', () => {
    expect(isFullRefund({ amountCents: 1999, amountRefundedCents: 1998 })).toBe(
      false
    );
    expect(isFullRefund({ amountCents: 0, amountRefundedCents: 0 })).toBe(
      false
    );
  });
});

describe('SubscriptionService.cancelForFullRefund (Codex-2hxff.10)', () => {
  let db: Database;
  let stripe: Stripe;
  let service: SubscriptionService;
  let orgId: string;
  let tierId: string;
  let planId: string;
  let courseId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creatorId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('sub-refund') })
        )
        .returning()
    ).id;
    tierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning()
    ).id;
    courseId = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId: creatorId ?? '',
          slug: createUniqueSlug('sub-refund-course'),
          title: 'Refunded Course',
          status: 'published',
          priceCents: null,
        })
        .returning()
    ).id;
    planId = takeFirst(
      await db
        .insert(courseSubscriptionPlans)
        .values({
          courseId,
          priceMonthly: 5000,
          priceAnnual: 50000,
          stripeProductId: `prod_${uid()}`,
          stripePriceMonthlyId: `price_m_${uid()}`,
          stripePriceAnnualId: `price_a_${uid()}`,
        })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new SubscriptionService({ db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  async function tierSubscription() {
    const [subscriberId] = await seedTestUsers(db, 1);
    return takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(subscriberId ?? '', orgId, tierId))
        .returning()
    );
  }

  async function courseSubscription() {
    const [subscriberId] = await seedTestUsers(db, 1);
    const now = new Date();
    return takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId: subscriberId ?? '',
          courseId,
          planId,
          organizationId: orgId,
          stripeSubscriptionId: `sub_course_${uid()}`,
          stripeCustomerId: `cus_course_${uid()}`,
          status: 'active',
          billingInterval: 'month',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
        })
        .returning()
    );
  }

  /**
   * Stripe as it would answer for a charge that paid `invoiceId` (raised for
   * `billingReason`) of `stripeSubscriptionId`, whose paid invoices, newest
   * first, are `paidInvoices`.
   */
  function stripeKnows(args: {
    stripeSubscriptionId: string;
    invoiceId: string;
    billingReason?: string;
    paidInvoices: Array<{ id: string; billing_reason: string }>;
    status?: Stripe.Subscription.Status;
  }) {
    vi.mocked(stripe.invoicePayments.list).mockResolvedValue({
      object: 'list',
      data: [{ invoice: args.invoiceId }],
      has_more: false,
    } as never);
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue({
      id: args.invoiceId,
      billing_reason: args.billingReason ?? 'subscription_cycle',
      parent: {
        subscription_details: { subscription: args.stripeSubscriptionId },
      },
    } as never);
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
      id: args.stripeSubscriptionId,
      status: args.status ?? 'active',
    } as never);
    vi.mocked(stripe.invoices.list).mockResolvedValue({
      object: 'list',
      data: args.paidInvoices,
      has_more: false,
    } as never);
  }

  function fullRefund(chargeId = `ch_ref_${uid()}`) {
    return {
      chargeId,
      paymentIntentId: `pi_${uid()}`,
      amountCents: 1999,
      amountRefundedCents: 1999,
    };
  }

  // ── cancels ───────────────────────────────────────────────────────────

  it("a full refund of the current period's payment cancels a tier subscription at Stripe, at once and without proration", async () => {
    const sub = await tierSubscription();
    const stripeId = sub.stripeSubscriptionId ?? '';
    stripeKnows({
      stripeSubscriptionId: stripeId,
      invoiceId: 'in_cycle',
      paidInvoices: [
        { id: 'in_cycle', billing_reason: 'subscription_cycle' },
        { id: 'in_first', billing_reason: 'subscription_create' },
      ],
    });
    const charge = fullRefund();

    const ended = await service.cancelForFullRefund(charge);

    expect(ended?.subscription).toMatchObject({ kind: 'tier', id: sub.id });
    expect(ended?.cancelled.status).toBe('canceled');
    expect(stripe.invoices.list).toHaveBeenCalledWith({
      subscription: stripeId,
      status: 'paid',
      limit: 20,
    });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      stripeId,
      {
        prorate: false,
        cancellation_details: {
          comment: "Current period's payment refunded in full",
        },
      },
      { idempotencyKey: `${charge.chargeId}_refund_cancel` }
    );
  });

  it('a course subscription plan is cancelled alike', async () => {
    const sub = await courseSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId,
      invoiceId: 'in_course_first',
      billingReason: 'subscription_create',
      paidInvoices: [
        { id: 'in_course_first', billing_reason: 'subscription_create' },
      ],
    });

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended?.subscription).toMatchObject({ kind: 'course', id: sub.id });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  // ── cancels nothing ───────────────────────────────────────────────────

  it('a partial refund cancels nothing, and asks Stripe nothing', async () => {
    const ended = await service.cancelForFullRefund({
      ...fullRefund(),
      amountRefundedCents: 1000,
    });

    expect(ended).toBeUndefined();
    expect(stripe.invoicePayments.list).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('a full refund of an EARLIER payment leaves the subscription running', async () => {
    const sub = await tierSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      invoiceId: 'in_last_month',
      paidInvoices: [
        { id: 'in_this_month', billing_reason: 'subscription_cycle' },
        { id: 'in_last_month', billing_reason: 'subscription_cycle' },
      ],
    });

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("a full refund of an upgrade's proration invoice leaves the subscription running, and asks Stripe no more", async () => {
    const sub = await tierSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      invoiceId: 'in_proration',
      billingReason: 'subscription_update',
      paidInvoices: [
        { id: 'in_proration', billing_reason: 'subscription_update' },
        { id: 'in_cycle', billing_reason: 'subscription_cycle' },
      ],
    });

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.invoices.list).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("the current period's payment still cancels when an upgrade's proration invoice is newer", async () => {
    const sub = await tierSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      invoiceId: 'in_cycle',
      paidInvoices: [
        { id: 'in_proration', billing_reason: 'subscription_update' },
        { id: 'in_cycle', billing_reason: 'subscription_cycle' },
      ],
    });

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended?.subscription.id).toBe(sub.id);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it('a subscription already cancelled at Stripe is not cancelled again', async () => {
    const sub = await tierSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      invoiceId: 'in_cycle',
      paidInvoices: [{ id: 'in_cycle', billing_reason: 'subscription_cycle' }],
      status: 'canceled',
    });

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('a one-off purchase (its payment intent paid no invoice) cancels nothing', async () => {
    vi.mocked(stripe.invoicePayments.list).mockResolvedValue({
      object: 'list',
      data: [],
      has_more: false,
    } as never);

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('an invoice for a subscription we hold no row for cancels nothing', async () => {
    stripeKnows({
      stripeSubscriptionId: `sub_unknown_${uid()}`,
      invoiceId: 'in_cycle',
      paidInvoices: [{ id: 'in_cycle', billing_reason: 'subscription_cycle' }],
    });

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});
