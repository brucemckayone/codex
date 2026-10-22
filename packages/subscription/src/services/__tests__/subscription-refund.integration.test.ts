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
  let orgName: string;
  let tierId: string;
  let tierName: string;
  let otherTierId: string;
  let otherTierName: string;
  let planId: string;
  let courseId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [creatorId] = await seedTestUsers(db, 1);
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('sub-refund') })
        )
        .returning()
    );
    orgId = org.id;
    orgName = org.name;
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId, { name: `Gold ${uid()}` }))
        .returning()
    );
    tierId = tier.id;
    tierName = tier.name;
    const otherTier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(
          createTestTierInput(orgId, {
            name: `Platinum ${uid()}`,
            sortOrder: 2,
          })
        )
        .returning()
    );
    otherTierId = otherTier.id;
    otherTierName = otherTier.name;
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
    expect(ended?.cancelled?.status).toBe('canceled');
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

    expect(ended?.subscription?.id).toBe(sub.id);
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

  // ── a duplicate subscription (Codex-2hxff.15) ─────────────────────────
  // A second subscription the user already had is recorded `cancelled` and
  // marked a duplicate, then cancelled at Stripe and every payment it took
  // refunded. Each refund's charge.refunded lands here: nothing more to
  // cancel, no "by hand" alert, and what the buyer's one email says.

  function spyOnObs() {
    const obs = (
      service as unknown as { obs: { error: (...a: unknown[]) => void } }
    ).obs;
    return { error: vi.spyOn(obs, 'error') };
  }

  async function tierDuplicate(duplicateTierId: string) {
    const kept = await tierSubscription();
    const duplicate = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(kept.userId, orgId, duplicateTierId, {
            status: 'cancelled',
            duplicateOfSubscriptionId: kept.id,
          })
        )
        .returning()
    );
    return { kept, duplicate };
  }

  function stripeKnowsEnded(stripeSubscriptionId: string, invoiceId: string) {
    stripeKnows({
      stripeSubscriptionId,
      invoiceId,
      billingReason: 'subscription_create',
      paidInvoices: [{ id: invoiceId, billing_reason: 'subscription_create' }],
      status: 'canceled',
    });
  }

  it("a duplicate's refund cancels nothing, raises no alert, and says the user was already subscribed", async () => {
    const { duplicate } = await tierDuplicate(tierId);
    stripeKnowsEnded(duplicate.stripeSubscriptionId, 'in_dup_first');
    const obs = spyOnObs();

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended).toEqual({
      duplicate: {
        kind: 'tier',
        organizationName: orgName,
        tierName,
        survivingTierName: tierName,
        otherTier: false,
      },
    });
    expect(ended?.subscription).toBeUndefined();
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.invoices.list).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('a duplicate for another tier names both tiers, so the email can offer Change plan', async () => {
    const { duplicate } = await tierDuplicate(otherTierId);
    stripeKnowsEnded(duplicate.stripeSubscriptionId, 'in_dup_other');

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended?.duplicate).toEqual({
      kind: 'tier',
      organizationName: orgName,
      tierName: otherTierName,
      survivingTierName: tierName,
      otherTier: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("a duplicate's renewal, refunded as an earlier period's payment would be, is still a duplicate's", async () => {
    // One that slipped through before this fix may have renewed; every paid
    // invoice it raised is refunded.
    const { duplicate } = await tierDuplicate(tierId);
    stripeKnows({
      stripeSubscriptionId: duplicate.stripeSubscriptionId,
      invoiceId: 'in_dup_first',
      paidInvoices: [
        { id: 'in_dup_renewal', billing_reason: 'subscription_cycle' },
        { id: 'in_dup_first', billing_reason: 'subscription_create' },
      ],
      status: 'canceled',
    });

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended?.duplicate?.kind).toBe('tier');
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("a course plan duplicate's refund cancels nothing and names the course", async () => {
    const kept = await courseSubscription();
    const now = new Date();
    const duplicate = takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId: kept.userId,
          courseId,
          planId,
          organizationId: orgId,
          stripeSubscriptionId: `sub_course_dup_${uid()}`,
          stripeCustomerId: kept.stripeCustomerId,
          status: 'cancelled',
          billingInterval: 'month',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
          duplicateOfCourseSubscriptionId: kept.id,
        })
        .returning()
    );
    stripeKnowsEnded(duplicate.stripeSubscriptionId, 'in_course_dup');
    const obs = spyOnObs();

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended).toEqual({
      duplicate: { kind: 'course', courseTitle: 'Refunded Course' },
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('the subscription a duplicate duplicated is cancelled as any other', async () => {
    const { kept } = await tierDuplicate(tierId);
    stripeKnows({
      stripeSubscriptionId: kept.stripeSubscriptionId,
      invoiceId: 'in_kept_cycle',
      paidInvoices: [
        { id: 'in_kept_cycle', billing_reason: 'subscription_cycle' },
      ],
    });

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended?.subscription?.id).toBe(kept.id);
    expect(ended?.duplicate).toBeUndefined();
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  // ── an old subscription revived beside a newer one (owner decision 7) ──
  // Old A went unpaid, the buyer took B, then paid A's open invoice. A was
  // cancelled and ended, and only that payment refunded. Its charge.refunded
  // lands here: A is ended while B is live, so nothing to cancel, no alert.

  async function endedBesideLive() {
    const [subscriberId] = await seedTestUsers(db, 1);
    const userId = subscriberId ?? '';
    const old = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, otherTierId, {
            status: 'cancelled',
            endedAt: new Date(),
          })
        )
        .returning()
    );
    const live = takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(userId, orgId, tierId))
        .returning()
    );
    return { old, live };
  }

  it('the refund of an ended subscription beside a live one cancels nothing, raises no alert, and says the buyer still subscribes', async () => {
    const { old } = await endedBesideLive();
    stripeKnows({
      stripeSubscriptionId: old.stripeSubscriptionId,
      invoiceId: 'in_revived',
      paidInvoices: [
        { id: 'in_revived', billing_reason: 'subscription_cycle' },
      ],
      status: 'canceled',
    });
    const obs = spyOnObs();

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended).toEqual({
      superseded: {
        kind: 'tier',
        organizationName: orgName,
        tierName: otherTierName,
      },
    });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('an ended subscription with no live one beside it is not superseded', async () => {
    const [subscriberId] = await seedTestUsers(db, 1);
    const old = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriberId ?? '', orgId, tierId, {
            status: 'cancelled',
            endedAt: new Date(),
          })
        )
        .returning()
    );
    stripeKnows({
      stripeSubscriptionId: old.stripeSubscriptionId,
      invoiceId: 'in_old_cycle',
      paidInvoices: [
        { id: 'in_old_cycle', billing_reason: 'subscription_cycle' },
      ],
      status: 'canceled',
    });

    // Ended at Stripe: its customer.subscription.deleted ended it here.
    expect(await service.cancelForFullRefund(fullRefund())).toBeUndefined();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('a course plan ended beside a live one names the course', async () => {
    const live = await courseSubscription();
    const now = new Date();
    const old = takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId: live.userId,
          courseId,
          planId,
          organizationId: orgId,
          stripeSubscriptionId: `sub_course_old_${uid()}`,
          stripeCustomerId: live.stripeCustomerId,
          status: 'cancelled',
          billingInterval: 'month',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
          endedAt: now,
        })
        .returning()
    );
    stripeKnowsEnded(old.stripeSubscriptionId, 'in_course_revived');
    const obs = spyOnObs();

    const ended = await service.cancelForFullRefund(fullRefund());

    expect(ended).toEqual({
      superseded: { kind: 'course', courseTitle: 'Refunded Course' },
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(obs.error).not.toHaveBeenCalled();
  });
});
