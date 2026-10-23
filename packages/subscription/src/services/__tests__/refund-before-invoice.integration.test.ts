/**
 * A refund handled before its invoice is paid out (Codex-2hxff.67): the
 * payouts must end exactly as they would had the refund come after.
 *
 * Stripe does not order a charge's events, and the payment webhook
 * (`charge.refunded`) and the subscription webhook
 * (`invoice.payment_succeeded`) are separate endpoints. When the refund is
 * handled first, its clawback finds no slices and does nothing; the invoice
 * then records them, and `reverseEarlierRefunds` (@codex/payments) claws the
 * refund back from them in the same flow.
 *
 * Every test runs the late order on a second invoice of the same subscription
 * as its oracle: same amount, same split, the refund after the payout.
 *
 * Real DB, mocked Stripe that keeps state: a refund made reads back from
 * `refunds.list` and `charges.retrieve`, and each transfer from
 * `transfers.list`, with its reversals from `listReversals`.
 */

import { randomUUID } from 'node:crypto';
import { stripeEnvMetadata } from '@codex/constants';
import {
  courseSubscriptionPlans,
  courses,
  disputes,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  refunds,
  stripeConnectAccounts,
  subscriptionTiers,
} from '@codex/database/schema';
import { isDrainablePayout, pendingReductionsFor } from '@codex/payments';
import { PurchaseService } from '@codex/purchase';
import { AfterCommitError } from '@codex/service-errors';
import {
  createMockStripe,
  createMockStripeInvoice,
  createMockStripeSubscription,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
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
import {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  CourseSubscriptionService,
} from '../course-subscription-service';
import { SubscriptionService } from '../subscription-service';

const uid = () => randomUUID().slice(0, 8);

/** A slice's share of a refund, as the spec states it: the same fraction, rounded down. */
const afterRefund = (gross: number, refunded: number, charge: number) =>
  gross - Math.floor((gross * refunded) / charge);

describe('A refund handled before its invoice (Codex-2hxff.67)', () => {
  let db: Database;
  let stripe: Stripe;
  let ownerId: string;
  let subscriberId: string;
  let creatorId: string;
  let courseOwnerId: string;
  const orgIds: string[] = [];
  const refundIds: string[] = [];
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [ownerId, subscriberId, creatorId, courseOwnerId] = (await seedTestUsers(
      db,
      4
    )) as [string, string, string, string];
    // The tier org's owner and the course's creator can be paid; the course
    // org's owner cannot, so its slice stays pending in their name.
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(null, ownerId),
        createTestConnectAccountInput(null, creatorId),
      ]);
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  // The payouts sweeps read the ledger globally: leave no rows behind.
  // payout_reversals -> payouts is ON DELETE RESTRICT.
  afterAll(async () => {
    if (orgIds.length > 0) {
      const rows = await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(inArray(payouts.organizationId, orgIds));
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await db
          .delete(payoutReversals)
          .where(inArray(payoutReversals.payoutId, ids));
        await db.delete(payouts).where(inArray(payouts.id, ids));
      }
    }
    if (refundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, refundIds));
    }
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [ownerId, creatorId]));
    await teardownTestDatabase();
  });

  // ── Stripe, keeping state ─────────────────────────────────────────────

  /** Charges and their refunds as Stripe holds them. */
  function stripeCharges() {
    const amounts = new Map<string, number>();
    const refundsOf = new Map<string, Stripe.Refund[]>();
    const base = Math.floor(Date.now() / 1000);
    let clock = 0;
    vi.mocked(stripe.refunds.list).mockImplementation((async (params: {
      charge?: string;
    }) => ({
      object: 'list',
      data: refundsOf.get(params.charge ?? '') ?? [],
      has_more: false,
    })) as never);
    vi.mocked(stripe.charges.retrieve).mockImplementation((async (
      id: string
    ) => {
      const amount = amounts.get(id) ?? 0;
      const refunded = (refundsOf.get(id) ?? []).reduce(
        (sum, refund) => sum + refund.amount,
        0
      );
      return {
        id,
        object: 'charge',
        amount,
        amount_refunded: refunded,
        refunded: amount > 0 && refunded >= amount,
        metadata: {},
      };
    }) as never);
    return {
      charge(amount: number): string {
        const id = `ch_early_${uid()}`;
        amounts.set(id, amount);
        return id;
      },
      amountOf(chargeId: string): number {
        return amounts.get(chargeId) ?? 0;
      },
      refund(chargeId: string, amount: number): void {
        const id = `re_early_${uid()}`;
        refundIds.push(id);
        clock += 1;
        refundsOf.set(chargeId, [
          ...(refundsOf.get(chargeId) ?? []),
          {
            id,
            object: 'refund',
            amount,
            charge: chargeId,
            currency: 'gbp',
            status: 'succeeded',
            created: base + clock,
          } as Stripe.Refund,
        ]);
      },
    };
  }

  /**
   * The money half of `charge.refunded`, in the webhook's order: every
   * refund recorded first, then the subscription clawback.
   */
  async function chargeRefunded(
    service: SubscriptionService,
    charges: ReturnType<typeof stripeCharges>,
    chargeId: string
  ): Promise<void> {
    await new PurchaseService(
      { db, environment: 'test' },
      stripe
    ).recordChargeRefunds({ id: chargeId, paymentIntentId: null });
    await service.reverseSubscriptionPayoutsForCharge({
      id: chargeId,
      amountCents: charges.amountOf(chargeId),
    });
  }

  /**
   * The money half of a chargeback's `charge.dispute.created`, in the
   * webhook's order: the dispute recorded first, then the clawback.
   */
  async function chargeDisputed(
    service: SubscriptionService,
    charges: ReturnType<typeof stripeCharges>,
    chargeId: string
  ): Promise<void> {
    const id = `dp_early_${uid()}`;
    disputeIds.push(id);
    await new PurchaseService(
      { db, environment: 'test' },
      stripe
    ).recordDispute({
      stripeDisputeId: id,
      stripeChargeId: chargeId,
      paymentIntentId: null,
      amountCents: charges.amountOf(chargeId),
      currency: 'gbp',
      status: 'needs_response',
      reason: 'fraudulent',
      stripeCreatedAt: new Date(),
    });
    await service.reverseSubscriptionPayoutsForCharge({
      id: chargeId,
      amountCents: charges.amountOf(chargeId),
    });
  }

  async function drainable(payoutId: string): Promise<boolean> {
    const rows = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), isDrainablePayout()));
    return rows.length === 1;
  }

  // ── what the payees end with ──────────────────────────────────────────

  async function slicesOf(chargeId: string): Promise<Payout[]> {
    return db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, chargeId));
  }

  /**
   * What each payee slice of the charge leaves its payee, by payout type:
   * what Stripe transferred less what it reversed, plus what a drain would
   * still pay an unpaid slice (its gross less its reductions).
   */
  async function netByType(chargeId: string): Promise<Record<string, number>> {
    const rows = (await slicesOf(chargeId)).filter(
      (row) => row.payoutType !== 'platform_fee'
    );
    const reductions = await pendingReductionsFor(
      db,
      rows.map((row) => row.id)
    );
    const { data: transfers } = await stripe.transfers.list({ limit: 100 });
    const net: Record<string, number> = {};
    for (const row of rows) {
      let cents =
        row.status === 'pending' || row.status === 'failed'
          ? row.amountCents - (reductions.get(row.id) ?? 0)
          : 0;
      for (const transfer of transfers) {
        if (transfer.metadata?.payout_id !== row.id) continue;
        cents += transfer.amount;
        const { data: reversals } = await stripe.transfers.listReversals(
          transfer.id,
          { limit: 100 }
        );
        cents -= reversals.reduce((sum, reversal) => sum + reversal.amount, 0);
      }
      net[row.payoutType] = cents;
    }
    return net;
  }

  function grossByType(rows: Payout[]): Record<string, number> {
    return Object.fromEntries(
      rows
        .filter((row) => row.payoutType !== 'platform_fee')
        .map((row) => [row.payoutType, row.amountCents])
    );
  }

  function statusByType(rows: Payout[]): Record<string, string> {
    return Object.fromEntries(rows.map((row) => [row.payoutType, row.status]));
  }

  /** How many times Stripe was asked to move money. */
  function moneyCalls() {
    return {
      transfers: vi.mocked(stripe.transfers.create).mock.calls.length,
      reversals: vi.mocked(stripe.transfers.createReversal).mock.calls.length,
    };
  }

  // ── tier subscriptions ────────────────────────────────────────────────

  describe('a tier subscription, live at Stripe', () => {
    const PRICE = 499;
    let stripeSubId: string;
    let tierSub: Stripe.Subscription;

    beforeAll(async () => {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({
              slug: createUniqueSlug('early-tier'),
            })
          )
          .returning()
      );
      orgIds.push(org.id);
      await setTestOrganisationPayee(db, org.id, ownerId);
      const tier = takeFirst(
        await db
          .insert(subscriptionTiers)
          .values(
            createTestTierInput(org.id, {
              priceMonthly: PRICE,
              priceAnnual: PRICE * 10,
            })
          )
          .returning()
      );
      const now = Math.floor(Date.now() / 1000);
      tierSub = createMockStripeSubscription({
        metadata: {
          codex_user_id: subscriberId,
          codex_organization_id: org.id,
          codex_tier_id: tier.id,
          ...stripeEnvMetadata('test'),
        },
        items: {
          data: [
            {
              id: `si_early_${uid()}`,
              price: {
                id: `price_early_${uid()}`,
                unit_amount: PRICE,
                currency: 'gbp',
                recurring: { interval: 'month' },
              },
              current_period_start: now,
              current_period_end: now + 30 * 24 * 3600,
            },
          ],
        },
      }) as unknown as Stripe.Subscription;
      stripeSubId = tierSub.id;
      await new SubscriptionService(
        { db, environment: 'test' },
        createMockStripe()
      ).handleSubscriptionCreated(tierSub);
    });

    /** The live subscription's service: Stripe reads it back active. */
    function subscribed(): SubscriptionService {
      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
        tierSub as never
      );
      return new SubscriptionService({ db, environment: 'test' }, stripe);
    }

    function invoiceFor(chargeId: string): Stripe.Invoice {
      return createMockStripeInvoice({
        amount_paid: PRICE,
        billing_reason: 'subscription_cycle',
        parent: { subscription_details: { subscription: stripeSubId } },
        payments: {
          data: [{ payment: { payment_intent: null, charge: chargeId } }],
        },
      }) as unknown as Stripe.Invoice;
    }

    it('an invoice whose charge has no refund recorded asks Stripe nothing more', async () => {
      const service = subscribed();
      const charges = stripeCharges();
      const chargeId = charges.charge(PRICE);

      await service.handleInvoicePaymentSucceeded(invoiceFor(chargeId));

      expect(stripe.charges.retrieve).not.toHaveBeenCalled();
      expect(stripe.refunds.list).not.toHaveBeenCalled();
      const rows = await slicesOf(chargeId);
      expect(statusByType(rows)).toEqual({
        platform_fee: 'paid',
        organization_fee: 'paid',
        creator_payout_to_owner: 'paid',
      });
      expect(await netByType(chargeId)).toEqual(grossByType(rows));
    });

    it('a full refund handled first: each slice is transferred, then reversed in full, and the payees net nothing', async () => {
      const service = subscribed();
      const charges = stripeCharges();
      const early = charges.charge(PRICE);
      const late = charges.charge(PRICE);

      charges.refund(early, PRICE);
      await chargeRefunded(service, charges, early);
      // Before the fix, here and below, the refund found nothing to claw back.
      expect(await slicesOf(early)).toHaveLength(0);
      await service.handleInvoicePaymentSucceeded(invoiceFor(early));

      // The oracle: the same invoice, refunded after its payout.
      await service.handleInvoicePaymentSucceeded(invoiceFor(late));
      charges.refund(late, PRICE);
      await chargeRefunded(service, charges, late);

      expect(await netByType(early)).toEqual({
        organization_fee: 0,
        creator_payout_to_owner: 0,
      });
      expect(await netByType(early)).toEqual(await netByType(late));
      const rows = await slicesOf(early);
      expect(statusByType(rows)).toEqual({
        platform_fee: 'reversed',
        organization_fee: 'reversed',
        creator_payout_to_owner: 'reversed',
      });
      expect(statusByType(rows)).toEqual(statusByType(await slicesOf(late)));
      // Pinned: each payee slice went out at its gross and came back whole.
      for (const row of rows.filter((r) => r.payoutType !== 'platform_fee')) {
        expect(row.stripeTransferId).not.toBeNull();
        expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
          row.stripeTransferId,
          expect.objectContaining({ amount: row.amountCents }),
          expect.anything()
        );
      }
    });

    it('a partial refund handled first: each payee nets exactly what the late refund leaves', async () => {
      const service = subscribed();
      const charges = stripeCharges();
      const early = charges.charge(PRICE);
      const late = charges.charge(PRICE);
      const REFUND = 200;

      charges.refund(early, REFUND);
      await chargeRefunded(service, charges, early);
      await service.handleInvoicePaymentSucceeded(invoiceFor(early));

      await service.handleInvoicePaymentSucceeded(invoiceFor(late));
      charges.refund(late, REFUND);
      await chargeRefunded(service, charges, late);

      const gross = grossByType(await slicesOf(early));
      expect(await netByType(early)).toEqual(await netByType(late));
      expect(await netByType(early)).toEqual(
        Object.fromEntries(
          Object.entries(gross).map(([type, cents]) => [
            type,
            afterRefund(cents, REFUND, PRICE),
          ])
        )
      );
      // A partial refund leaves the slices paid, reduced by their shares.
      expect(statusByType(await slicesOf(early))).toEqual({
        platform_fee: 'paid',
        organization_fee: 'paid',
        creator_payout_to_owner: 'paid',
      });
    });

    it('a redelivery of either event, in either order, moves no more money', async () => {
      const service = subscribed();
      const charges = stripeCharges();
      const full = charges.charge(PRICE);
      const partial = charges.charge(PRICE);

      charges.refund(full, PRICE);
      await chargeRefunded(service, charges, full);
      await service.handleInvoicePaymentSucceeded(invoiceFor(full));
      charges.refund(partial, 150);
      await chargeRefunded(service, charges, partial);
      await service.handleInvoicePaymentSucceeded(invoiceFor(partial));
      const settled = {
        full: await netByType(full),
        partial: await netByType(partial),
      };
      const calls = moneyCalls();

      for (const chargeId of [full, partial]) {
        await service.handleInvoicePaymentSucceeded(invoiceFor(chargeId));
        await chargeRefunded(service, charges, chargeId);
        await service.handleInvoicePaymentSucceeded(invoiceFor(chargeId));
      }

      expect(moneyCalls()).toEqual(calls);
      expect(await netByType(full)).toEqual(settled.full);
      expect(await netByType(partial)).toEqual(settled.partial);
      // One record per slice per refund, however many deliveries ran.
      const records = await db
        .select()
        .from(payoutReversals)
        .where(
          inArray(
            payoutReversals.payoutId,
            (await slicesOf(partial)).map((row) => row.id)
          )
        );
      expect(records).toHaveLength(3);
      expect(records.every((record) => record.status === 'done')).toBe(true);
    });

    it('a partial refund first, and a slice whose transfer just failed: the slice is reduced at once, not left "in flight"', async () => {
      const service = subscribed();
      const charges = stripeCharges();
      const chargeId = charges.charge(PRICE);
      const REFUND = 200;
      charges.refund(chargeId, REFUND);
      await chargeRefunded(service, charges, chargeId);
      // The organisation's slice is the first transfer of the split.
      vi.mocked(stripe.transfers.create).mockRejectedValueOnce(
        Object.assign(new Error('Destination cannot receive transfers'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        })
      );

      await expect(
        service.handleInvoicePaymentSucceeded(invoiceFor(chargeId))
      ).resolves.toMatchObject({ userId: subscriberId });

      const rows = await slicesOf(chargeId);
      expect(statusByType(rows)).toMatchObject({
        organization_fee: 'failed',
        creator_payout_to_owner: 'paid',
      });
      // The drains pay the failed slice its reduced amount.
      expect(await netByType(chargeId)).toEqual(
        Object.fromEntries(
          Object.entries(grossByType(rows)).map(([type, cents]) => [
            type,
            afterRefund(cents, REFUND, PRICE),
          ])
        )
      );
    });

    it('a clawback that fails after the payout committed comes back as an AfterCommitError with the renewal result; the redelivery finishes it', async () => {
      const service = subscribed();
      const charges = stripeCharges();
      const chargeId = charges.charge(PRICE);
      charges.refund(chargeId, PRICE);
      await chargeRefunded(service, charges, chargeId);
      const outage = Object.assign(new Error('Stripe is unreachable'), {
        type: 'StripeConnectionError',
      });
      vi.mocked(stripe.charges.retrieve).mockRejectedValueOnce(outage);

      const failure = await service
        .handleInvoicePaymentSucceeded(invoiceFor(chargeId))
        .then(
          () => undefined,
          (error: unknown) => error
        );

      // The payout committed and went out; the webhook still has what it
      // needs to clear access and send the renewal email.
      expect(failure).toBeInstanceOf(AfterCommitError);
      expect(failure).toMatchObject({
        cause: outage,
        completed: { userId: subscriberId },
      });
      expect(statusByType(await slicesOf(chargeId))).toMatchObject({
        organization_fee: 'paid',
        creator_payout_to_owner: 'paid',
      });

      await service.handleInvoicePaymentSucceeded(invoiceFor(chargeId));

      expect(await netByType(chargeId)).toEqual({
        organization_fee: 0,
        creator_payout_to_owner: 0,
      });
    });
  });

  // ── course plans ──────────────────────────────────────────────────────

  describe('a course plan, live at Stripe', () => {
    const PRICE = 5000;
    let courseSub: Stripe.Subscription;

    beforeAll(async () => {
      const org = takeFirst(
        await db
          .insert(organizations)
          .values(
            createTestOrganizationInput({
              slug: createUniqueSlug('early-course'),
            })
          )
          .returning()
      );
      orgIds.push(org.id);
      await setTestOrganisationPayee(db, org.id, courseOwnerId);
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: org.id,
            creatorId,
            slug: createUniqueSlug('early-course'),
            title: 'Refund Order Course',
            status: 'published',
            priceCents: null,
          })
          .returning()
      );
      const plan = takeFirst(
        await db
          .insert(courseSubscriptionPlans)
          .values({
            courseId: course.id,
            priceMonthly: PRICE,
            priceAnnual: PRICE * 10,
            stripeProductId: `prod_${uid()}`,
            stripePriceMonthlyId: `price_m_${uid()}`,
            stripePriceAnnualId: `price_a_${uid()}`,
          })
          .returning()
      );
      courseSub = createMockStripeSubscription({
        customer: `cus_${uid()}`,
        metadata: {
          type: COURSE_SUBSCRIPTION_METADATA_TYPE,
          codex_user_id: subscriberId,
          codex_course_id: course.id,
          codex_plan_id: plan.id,
          codex_organization_id: org.id,
          ...stripeEnvMetadata('test'),
        },
      }) as unknown as Stripe.Subscription;
      await new CourseSubscriptionService(
        { db, environment: 'test' },
        createMockStripe()
      ).handleCourseSubscriptionCreated(courseSub);
    });

    /** The course service, and the tier one for charge.refunded's half. */
    function subscribed() {
      return {
        course: new CourseSubscriptionService(
          { db, environment: 'test' },
          stripe
        ),
        tiers: new SubscriptionService({ db, environment: 'test' }, stripe),
      };
    }

    function invoiceFor(chargeId: string): Stripe.Invoice {
      return createMockStripeInvoice({
        amount_paid: PRICE,
        parent: {
          subscription_details: {
            subscription: courseSub.id,
            metadata: { type: COURSE_SUBSCRIPTION_METADATA_TYPE },
          },
        },
        payments: { data: [{ payment: { charge: chargeId } }] },
      }) as unknown as Stripe.Invoice;
    }

    it('a full refund handled first: the paid slice is reversed in full, the unpaid one cancelled', async () => {
      const { course, tiers } = subscribed();
      const charges = stripeCharges();
      const early = charges.charge(PRICE);
      const late = charges.charge(PRICE);

      charges.refund(early, PRICE);
      await chargeRefunded(tiers, charges, early);
      expect(await slicesOf(early)).toHaveLength(0);
      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(early),
        courseSub
      );

      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(late),
        courseSub
      );
      charges.refund(late, PRICE);
      await chargeRefunded(tiers, charges, late);

      expect(await netByType(early)).toEqual({
        creator_payout: 0,
        organization_fee: 0,
      });
      expect(await netByType(early)).toEqual(await netByType(late));
      const rows = await slicesOf(early);
      expect(statusByType(rows)).toEqual({
        platform_fee: 'reversed',
        creator_payout: 'reversed',
        organization_fee: 'cancelled_by_refund',
      });
      expect(statusByType(rows)).toEqual(statusByType(await slicesOf(late)));
    });

    it('a partial refund handled first: the paid slice is reversed by its share, the unpaid one reduced, as for the late refund', async () => {
      const { course, tiers } = subscribed();
      const charges = stripeCharges();
      const early = charges.charge(PRICE);
      const late = charges.charge(PRICE);
      const REFUND = 1234;

      charges.refund(early, REFUND);
      await chargeRefunded(tiers, charges, early);
      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(early),
        courseSub
      );

      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(late),
        courseSub
      );
      charges.refund(late, REFUND);
      await chargeRefunded(tiers, charges, late);

      const rows = await slicesOf(early);
      expect(statusByType(rows)).toEqual({
        platform_fee: 'paid',
        creator_payout: 'paid',
        organization_fee: 'pending',
      });
      expect(await netByType(early)).toEqual(await netByType(late));
      expect(await netByType(early)).toEqual(
        Object.fromEntries(
          Object.entries(grossByType(rows)).map(([type, cents]) => [
            type,
            afterRefund(cents, REFUND, PRICE),
          ])
        )
      );
    });

    it('a redelivery of either event moves no more money', async () => {
      const { course, tiers } = subscribed();
      const charges = stripeCharges();
      const chargeId = charges.charge(PRICE);
      charges.refund(chargeId, 900);
      await chargeRefunded(tiers, charges, chargeId);
      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(chargeId),
        courseSub
      );
      const settled = await netByType(chargeId);
      const calls = moneyCalls();

      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(chargeId),
        courseSub
      );
      await chargeRefunded(tiers, charges, chargeId);

      expect(moneyCalls()).toEqual(calls);
      expect(await netByType(chargeId)).toEqual(settled);
    });

    it('a chargeback handled first, with no refund: the paid slice is reversed by its share and the unpaid one held, as for the late chargeback', async () => {
      const { course, tiers } = subscribed();
      const charges = stripeCharges();
      const early = charges.charge(PRICE);
      const late = charges.charge(PRICE);

      await chargeDisputed(tiers, charges, early);
      expect(await slicesOf(early)).toHaveLength(0);
      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(early),
        courseSub
      );

      await course.handleCourseInvoicePaymentSucceeded(
        invoiceFor(late),
        courseSub
      );
      await chargeDisputed(tiers, charges, late);

      // A chargeback of the whole charge takes the paid slice back whole.
      expect(await netByType(early)).toMatchObject({ creator_payout: 0 });
      expect(await netByType(early)).toEqual(await netByType(late));
      for (const chargeId of [early, late]) {
        const rows = await slicesOf(chargeId);
        expect(statusByType(rows)).toEqual({
          platform_fee: 'reversed',
          creator_payout: 'reversed',
          organization_fee: 'pending',
        });
        // An open chargeback holds the unpaid slice: no drain pays it.
        const unpaid = rows.find(
          (row) => row.payoutType === 'organization_fee'
        );
        if (!unpaid) throw new Error('no organization slice');
        expect(await drainable(unpaid.id)).toBe(false);
      }
    });
  });
});
