/**
 * A disputed subscription invoice (Codex-2hxff.9; design in
 * docs/payments/subscription-disputes.md): the subscription it belongs to is
 * found and linked, its access and billing paused while the chargeback is
 * open, both restored on a win unless another chargeback is open, and the
 * subscription cancelled at Stripe on a loss.
 *
 * The money (reversal, hold, re-pay) is specified in
 * packages/payments/src/__tests__/dispute-clawback.integration.test.ts.
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  disputes,
  organizations,
  payouts,
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
import { SubscriptionService } from '../subscription-service';

const uid = () => randomUUID().slice(0, 8);

describe('SubscriptionService disputes (Codex-2hxff.9)', () => {
  let db: Database;
  let stripe: Stripe;
  let service: SubscriptionService;
  let creatorId: string;
  let orgId: string;
  let tierId: string;
  let planId: string;
  let courseId: string;
  const createdPayoutIds: string[] = [];
  const createdDisputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('sub-dispute') })
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
          creatorId,
          slug: createUniqueSlug('sub-dispute-course'),
          title: 'Disputed Course',
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

  // Payout rows feed global drains and sweeps; disputes hold them. Neither
  // may outlive the file.
  afterAll(async () => {
    if (createdDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, createdDisputeIds));
    }
    if (createdPayoutIds.length > 0) {
      await db.delete(payouts).where(inArray(payouts.id, createdPayoutIds));
    }
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

  /** The invoice's platform-fee row: what links a charge to its subscription. */
  async function invoiceCharge(link: {
    subscriptionId?: string;
    courseSubscriptionId?: string;
  }): Promise<string> {
    const chargeId = `ch_sdisp_${uid()}`;
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          subscriptionId: link.subscriptionId ?? null,
          courseSubscriptionId: link.courseSubscriptionId ?? null,
          payoutType: 'platform_fee',
          amountCents: 100,
          status: 'paid',
          sourceType: 'subscription',
          stripeChargeId: chargeId,
          resolvedAt: new Date(),
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return chargeId;
  }

  async function dispute(chargeId: string, status = 'needs_response') {
    const id = `dp_${uid()}`;
    createdDisputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: chargeId,
      amountCents: 1000,
      currency: 'gbp',
      status,
      stripeCreatedAt: new Date('2026-10-19T12:00:00Z'),
    });
    return { stripeDisputeId: id, chargeId, paymentIntentId: null };
  }

  async function setStatus(stripeDisputeId: string, status: string) {
    await db
      .update(disputes)
      .set({ status })
      .where(eq(disputes.stripeDisputeId, stripeDisputeId));
  }

  async function readDispute(stripeDisputeId: string) {
    return takeFirst(
      await db
        .select()
        .from(disputes)
        .where(eq(disputes.stripeDisputeId, stripeDisputeId))
    );
  }

  async function disputedAt(id: string): Promise<Date | null> {
    return takeFirst(
      await db
        .select({ at: subscriptions.disputedAt })
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
    ).at;
  }

  // ── chargeback opened ─────────────────────────────────────────────────

  it('a chargeback pauses the subscription its invoice belongs to, links it, and then pauses its billing at Stripe', async () => {
    const sub = await tierSubscription();
    const input = await dispute(
      await invoiceCharge({ subscriptionId: sub.id })
    );

    const paused = await service.pauseForDispute(input);

    expect(paused).toMatchObject({ kind: 'tier', id: sub.id });
    expect(await disputedAt(sub.id)).not.toBeNull();
    expect((await readDispute(input.stripeDisputeId)).subscriptionId).toBe(
      sub.id
    );
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();

    await service.pauseBillingForDispute(
      paused as NonNullable<typeof paused>,
      input.stripeDisputeId
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      sub.stripeSubscriptionId,
      { pause_collection: { behavior: 'void' } },
      { idempotencyKey: `${input.stripeDisputeId}_pause_collection` }
    );
  });

  it('a redelivery keeps the first pause time', async () => {
    const sub = await tierSubscription();
    const input = await dispute(
      await invoiceCharge({ subscriptionId: sub.id })
    );
    await service.pauseForDispute(input);
    const first = await disputedAt(sub.id);

    await service.pauseForDispute(input);

    expect(await disputedAt(sub.id)).toEqual(first);
  });

  it('a charge with no payout rows is traced through Stripe: the invoice its payment intent paid names the subscription', async () => {
    const sub = await tierSubscription();
    const input = {
      ...(await dispute(`ch_sdisp_${uid()}`)),
      paymentIntentId: `pi_${uid()}`,
    };
    vi.mocked(stripe.invoicePayments.list).mockResolvedValue({
      object: 'list',
      data: [{ invoice: 'in_disputed' }],
      has_more: false,
    } as never);
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue({
      id: 'in_disputed',
      parent: {
        subscription_details: { subscription: sub.stripeSubscriptionId },
      },
    } as never);

    const paused = await service.pauseForDispute(input);

    expect(paused?.id).toBe(sub.id);
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({
      payment: {
        type: 'payment_intent',
        payment_intent: input.paymentIntentId,
      },
      limit: 1,
    });
  });

  it('a charge that is not a subscription invoice pauses nothing', async () => {
    const input = await dispute(`ch_sdisp_${uid()}`);

    expect(await service.pauseForDispute(input)).toBeUndefined();
    expect(
      (await readDispute(input.stripeDisputeId)).subscriptionId
    ).toBeNull();
  });

  it('a course subscription is paused the same way', async () => {
    const sub = await courseSubscription();
    const input = await dispute(
      await invoiceCharge({ courseSubscriptionId: sub.id })
    );

    const paused = await service.pauseForDispute(input);

    expect(paused).toMatchObject({ kind: 'course', id: sub.id });
    const [row] = await db
      .select({ at: courseSubscriptions.disputedAt })
      .from(courseSubscriptions)
      .where(eq(courseSubscriptions.id, sub.id));
    expect(row?.at).not.toBeNull();
    expect(
      (await readDispute(input.stripeDisputeId)).courseSubscriptionId
    ).toBe(sub.id);
  });

  // ── won ───────────────────────────────────────────────────────────────

  it('won: access is restored and billing resumed', async () => {
    const sub = await tierSubscription();
    const input = await dispute(
      await invoiceCharge({ subscriptionId: sub.id })
    );
    await service.pauseForDispute(input);
    await setStatus(input.stripeDisputeId, 'won');

    const result = await service.restoreAfterDispute(input);

    expect(result?.restored).toBe(true);
    expect(await disputedAt(sub.id)).toBeNull();
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      sub.stripeSubscriptionId,
      { pause_collection: '' },
      { idempotencyKey: `${input.stripeDisputeId}_resume_collection` }
    );
  });

  it('won while another chargeback on the same subscription is open: it stays paused, and billing too', async () => {
    const sub = await tierSubscription();
    const first = await dispute(
      await invoiceCharge({ subscriptionId: sub.id })
    );
    const second = await dispute(
      await invoiceCharge({ subscriptionId: sub.id })
    );
    await service.pauseForDispute(first);
    await service.pauseForDispute(second);
    await setStatus(first.stripeDisputeId, 'won');

    const result = await service.restoreAfterDispute(first);

    expect(result?.restored).toBe(false);
    expect(await disputedAt(sub.id)).not.toBeNull();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('won after a Stripe failure: the redelivery resumes billing though the pause is already cleared', async () => {
    const sub = await tierSubscription();
    const input = await dispute(
      await invoiceCharge({ subscriptionId: sub.id })
    );
    await service.pauseForDispute(input);
    await setStatus(input.stripeDisputeId, 'won');
    vi.mocked(stripe.subscriptions.update).mockRejectedValueOnce(
      Object.assign(new Error('Stripe down'), { statusCode: 500 })
    );
    await expect(service.restoreAfterDispute(input)).rejects.toThrow(
      'Stripe down'
    );

    await service.restoreAfterDispute(input);

    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(2);
    expect(await disputedAt(sub.id)).toBeNull();
  });

  // ── lost ──────────────────────────────────────────────────────────────

  it('lost: the subscription is cancelled at Stripe at once, without proration', async () => {
    const sub = await tierSubscription();
    const input = await dispute(
      await invoiceCharge({ subscriptionId: sub.id }),
      'lost'
    );

    const ended = await service.cancelForLostDispute(input);

    expect(ended?.id).toBe(sub.id);
    expect(await disputedAt(sub.id)).not.toBeNull();
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      sub.stripeSubscriptionId,
      {
        prorate: false,
        cancellation_details: { comment: 'Payment dispute lost' },
      },
      { idempotencyKey: `${input.stripeDisputeId}_cancel` }
    );
  });

  it('a subscription Stripe has already cancelled gets no Stripe call', async () => {
    const sub = await tierSubscription();
    const input = await dispute(
      await invoiceCharge({ subscriptionId: sub.id }),
      'lost'
    );
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
      id: sub.stripeSubscriptionId,
      status: 'canceled',
    } as never);

    await service.cancelForLostDispute(input);
    await service.pauseBillingForDispute(
      {
        kind: 'tier',
        id: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        userId: sub.userId,
        organizationId: orgId,
        status: 'active',
      },
      input.stripeDisputeId
    );

    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(await disputedAt(sub.id)).not.toBeNull();
  });
});
