/**
 * A refunded subscription payment (Codex-2hxff.10; owner decision P-4,
 * docs/payments/subscriptions.md#refunds): a FULL refund of the LATEST
 * payment cancels the subscription at Stripe, at once and without proration;
 * a partial refund, a refund of an earlier payment, or a subscription already
 * ended cancels nothing. Tier and course subscriptions alike.
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
   * Stripe as it would answer for a charge that paid `invoiceId` of
   * `stripeSubscriptionId`, whose latest invoice is `latestInvoice`.
   */
  function stripeKnows(args: {
    stripeSubscriptionId: string;
    invoiceId: string;
    latestInvoice: string | { id: string } | null;
    status?: Stripe.Subscription.Status;
  }) {
    vi.mocked(stripe.invoicePayments.list).mockResolvedValue({
      object: 'list',
      data: [{ invoice: args.invoiceId }],
      has_more: false,
    } as never);
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue({
      id: args.invoiceId,
      parent: {
        subscription_details: { subscription: args.stripeSubscriptionId },
      },
    } as never);
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
      id: args.stripeSubscriptionId,
      status: args.status ?? 'active',
      latest_invoice: args.latestInvoice,
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

  it('a full refund of the latest payment cancels a tier subscription at Stripe, at once and without proration', async () => {
    const sub = await tierSubscription();
    const stripeId = sub.stripeSubscriptionId ?? '';
    stripeKnows({
      stripeSubscriptionId: stripeId,
      invoiceId: 'in_latest',
      latestInvoice: 'in_latest',
    });
    const charge = fullRefund();

    const ended = await service.cancelForFullRefund(charge);

    expect(ended?.subscription).toMatchObject({ kind: 'tier', id: sub.id });
    expect(ended?.cancelled.status).toBe('canceled');
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      stripeId,
      {
        prorate: false,
        cancellation_details: { comment: 'Latest payment refunded in full' },
      },
      { idempotencyKey: `${charge.chargeId}_refund_cancel` }
    );
  });

  it('a course subscription plan is cancelled alike', async () => {
    const sub = await courseSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId,
      invoiceId: 'in_course_latest',
      // An expanded latest invoice matches as well as an id.
      latestInvoice: { id: 'in_course_latest' },
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
      latestInvoice: 'in_this_month',
    });

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('a subscription already cancelled at Stripe is not cancelled again', async () => {
    const sub = await tierSubscription();
    stripeKnows({
      stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      invoiceId: 'in_latest',
      latestInvoice: 'in_latest',
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
      invoiceId: 'in_latest',
      latestInvoice: 'in_latest',
    });

    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});
