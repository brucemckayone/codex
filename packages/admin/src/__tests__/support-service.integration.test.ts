/**
 * SupportService against the real schema (Codex-2hxff.28; data design §10).
 *
 * Stripe is faked at the client boundary by a small stateful Stripe: it keeps
 * each charge, the refunds made on it and the idempotency keys it has seen, as
 * Stripe does, so a repeated submit is answered the way Stripe answers it.
 * Every row is created here and tagged by its ids; afterAll deletes them all,
 * payout rows first among them (they feed global drains). The local neondb is
 * shared with other sessions, so nothing here ever cleans a whole table.
 */

import { CONTENT_TYPES, PURCHASE_STATUS } from '@codex/constants';
import {
  contentAccess,
  content as contentTable,
  disputes,
  entitlements,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  purchases,
  refundReviews,
  refunds,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { type ClawbackDeps, reverseCharge } from '@codex/payments';
import { PurchaseService } from '@codex/purchase';
import { ServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestContentInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { supportResolveFailedRefundSchema } from '@codex/validation';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
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
import { SupportService } from '../services/support-service';

const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const DAY = 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The error a promise rejects with, typed for the assertions below. */
async function failureOf(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

interface FakeCharge {
  id: string;
  object: 'charge';
  amount: number;
  created: number;
  currency: 'gbp';
  payment_intent: string | null;
  payment_method_details: { card: { brand: string; last4: string } };
  balance_transaction: { id: string; fee: number };
  metadata: Record<string, string>;
}

/** A Stripe that remembers charges, refunds and keys, like the real one. */
function fakeStripe() {
  const stripe = createMockStripe();
  const charges = new Map<string, FakeCharge>();
  const refundsByCharge = new Map<string, Stripe.Refund[]>();
  /** Keys Stripe has seen: a repeat with other parameters is refused. */
  const keys = new Map<
    string,
    { fingerprint: string; refund: Stripe.Refund }
  >();
  const invoiceByPaymentIntent = new Map<string, string>();
  const invoices = new Map<
    string,
    { id: string; billing_reason: string; subscription: string }
  >();
  /** A subscription's paid invoices, newest first. */
  const paidInvoices = new Map<string, string[]>();
  const disputeDueBy = new Map<string, number>();

  const missing = () =>
    Object.assign(new Error('No such object'), {
      type: 'StripeInvalidRequestError',
      statusCode: 404,
      code: 'resource_missing',
    });

  vi.mocked(stripe.charges.retrieve).mockImplementation((async (id: string) => {
    const charge = charges.get(id);
    if (!charge) throw missing();
    return charge;
  }) as never);
  vi.mocked(stripe.refunds.list).mockImplementation((async (params: {
    charge: string;
  }) => ({
    object: 'list',
    data: refundsByCharge.get(params.charge) ?? [],
    has_more: false,
  })) as never);
  vi.mocked(stripe.refunds.create).mockImplementation((async (
    params: Stripe.RefundCreateParams,
    options?: { idempotencyKey?: string }
  ) => {
    const chargeId = params.charge as string;
    const charge = charges.get(chargeId);
    if (!charge) throw missing();
    const fingerprint = JSON.stringify([
      chargeId,
      params.amount,
      params.reason,
    ]);
    const key = options?.idempotencyKey;
    const seen = key ? keys.get(key) : undefined;
    if (seen) {
      if (seen.fingerprint !== fingerprint) {
        throw Object.assign(
          new Error(
            'Keys for idempotent requests can only be used with the same parameters'
          ),
          {
            type: 'StripeIdempotencyError',
            rawType: 'idempotency_error',
            statusCode: 400,
          }
        );
      }
      return seen.refund;
    }
    const refund = {
      id: `re_sup${uid()}`,
      object: 'refund',
      amount: params.amount ?? charge.amount,
      charge: chargeId,
      currency: 'gbp',
      status: 'succeeded',
      reason: params.reason ?? null,
      failure_reason: null,
      created: nowSeconds(),
      metadata: params.metadata ?? {},
    } as unknown as Stripe.Refund;
    refundsByCharge.set(chargeId, [
      ...(refundsByCharge.get(chargeId) ?? []),
      refund,
    ]);
    if (key) keys.set(key, { fingerprint, refund });
    return refund;
  }) as never);
  vi.mocked(stripe.invoicePayments.list).mockImplementation((async (params: {
    payment: { payment_intent: string };
  }) => {
    const invoice = invoiceByPaymentIntent.get(params.payment.payment_intent);
    return {
      object: 'list',
      data: invoice ? [{ invoice }] : [],
      has_more: false,
    };
  }) as never);
  vi.mocked(stripe.invoices.retrieve).mockImplementation((async (
    id: string
  ) => {
    const invoice = invoices.get(id);
    if (!invoice) throw missing();
    return {
      id,
      billing_reason: invoice.billing_reason,
      parent: { subscription_details: { subscription: invoice.subscription } },
    };
  }) as never);
  vi.mocked(stripe.invoices.list).mockImplementation((async (params: {
    subscription: string;
  }) => ({
    object: 'list',
    data: (paidInvoices.get(params.subscription) ?? []).map((id) => ({
      id,
      billing_reason: invoices.get(id)?.billing_reason ?? null,
    })),
    has_more: false,
  })) as never);
  (stripe as unknown as { disputes: unknown }).disputes = {
    retrieve: vi.fn(async (id: string) => ({
      id,
      evidence_details: { due_by: disputeDueBy.get(id) ?? null },
    })),
  };

  return {
    stripe,
    charges,
    refundsByCharge,
    keys,
    invoiceByPaymentIntent,
    invoices,
    paidInvoices,
    disputeDueBy,
  };
}

describe('SupportService (real DB, Stripe faked at the client)', () => {
  let db: Database;
  let fake: ReturnType<typeof fakeStripe>;
  let service: SupportService;
  let buyerId: string;
  let buyerEmail: string;
  let creatorId: string;
  let ownerId: string;
  let supportId: string;
  let orgId: string;
  let tierId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

  const created = {
    payoutIds: [] as string[],
    purchaseIds: [] as string[],
    contentIds: [] as string[],
    subscriptionIds: [] as string[],
    stripeRefundIds: [] as string[],
    stripeDisputeIds: [] as string[],
  };

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorId, ownerId, supportId] = await seedTestUsers(db, 4);
    buyerEmail = takeFirst(
      await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, buyerId))
    ).email;
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Support Org', slug: createUniqueSlug('support') })
        .returning()
    ).id;
    tierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId, { name: 'Inner Circle' }))
        .returning()
    ).id;
  });

  beforeEach(() => {
    fake = fakeStripe();
    obs.error.mockClear();
    service = new SupportService({
      db,
      environment: 'test',
      stripe: fake.stripe,
      purchase: new PurchaseService({ db, environment: 'test' }, fake.stripe),
    });
  });

  // Payout rows feed global drains and sweeps: never leave them behind.
  // Re-pay rows hang off their steps (restrict), so the closure is followed
  // down before anything is deleted.
  afterAll(async () => {
    const all = new Set(created.payoutIds);
    for (let frontier = [...all]; frontier.length > 0; ) {
      const linked = await db
        .select({ id: payoutReversals.repaidByPayoutId })
        .from(payoutReversals)
        .where(
          and(
            inArray(payoutReversals.payoutId, frontier),
            isNotNull(payoutReversals.repaidByPayoutId)
          )
        );
      frontier = linked.flatMap((row) =>
        row.id && !all.has(row.id) ? [row.id] : []
      );
      for (const id of frontier) all.add(id);
    }
    if (all.size > 0) {
      const ids = [...all];
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, ids));
      await db
        .update(payoutReversals)
        .set({ repaidByPayoutId: null })
        .where(inArray(payoutReversals.payoutId, ids));
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, ids));
      await db.delete(payouts).where(inArray(payouts.id, ids));
    }
    if (created.stripeRefundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, created.stripeRefundIds));
    }
    if (created.stripeDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, created.stripeDisputeIds));
    }
    if (created.purchaseIds.length > 0) {
      await db
        .delete(entitlements)
        .where(inArray(entitlements.sourceRef, created.purchaseIds));
      await db
        .delete(purchases)
        .where(inArray(purchases.id, created.purchaseIds));
    }
    if (created.contentIds.length > 0) {
      await db
        .delete(contentAccess)
        .where(inArray(contentAccess.contentId, created.contentIds));
      await db
        .delete(contentTable)
        .where(inArray(contentTable.id, created.contentIds));
    }
    if (created.subscriptionIds.length > 0) {
      await db
        .delete(subscriptions)
        .where(inArray(subscriptions.id, created.subscriptionIds));
    }
    await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tierId));
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  async function slice(
    values: Partial<typeof payouts.$inferInsert> & {
      payoutType: Payout['payoutType'];
      amountCents: number;
      status: Payout['status'];
    }
  ): Promise<Payout> {
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          resolvedAt: values.status === 'paid' ? new Date() : null,
          ...values,
        })
        .returning()
    );
    created.payoutIds.push(row.id);
    return row;
  }

  /**
   * A purchase of its own item (a buyer holds one completed purchase per
   * item), paid `agoSeconds` ago: 1000p split as platform 100, organisation
   * 135 (unpaid), creator 765 (paid), with its entitlement and access row.
   */
  async function purchaseCharge(agoSeconds = 3600, buyer = buyerId) {
    const item = takeFirst(
      await db
        .insert(contentTable)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: CONTENT_TYPES.WRITTEN,
            title: `Sleep Reset ${uid()}`,
            isFree: false,
            isPurchasable: true,
            priceCents: 1000,
          })
        )
        .returning()
    );
    created.contentIds.push(item.id);
    const chargeId = `ch_sup${uid()}${uid()}`;
    const paymentIntentId = `pi_sup${uid()}`;
    const paidAt = nowSeconds() - agoSeconds;
    const purchase = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyer,
          contentId: item.id,
          organizationId: orgId,
          status: PURCHASE_STATUS.COMPLETED,
          amountPaidCents: 1000,
          platformFeeCents: 100,
          organizationFeeCents: 135,
          creatorPayoutCents: 765,
          stripePaymentIntentId: paymentIntentId,
          purchasedAt: new Date(paidAt * 1000),
        })
        .returning()
    );
    created.purchaseIds.push(purchase.id);
    await db.insert(entitlements).values({
      userId: buyer,
      organizationId: orgId,
      contentId: item.id,
      source: 'content_purchase',
      sourceRef: purchase.id,
    });
    await db.insert(contentAccess).values({
      userId: buyer,
      contentId: item.id,
      organizationId: orgId,
      accessType: 'purchased',
    });
    const source = {
      purchaseId: purchase.id,
      sourceType: 'purchase' as const,
      stripeChargeId: chargeId,
    };
    const fee = await slice({
      ...source,
      payoutType: 'platform_fee',
      amountCents: 100,
      status: 'paid',
    });
    const org = await slice({
      ...source,
      payoutType: 'organization_fee',
      userId: ownerId,
      amountCents: 135,
      status: 'pending',
      reason: 'connect_not_ready',
    });
    const creator = await slice({
      ...source,
      payoutType: 'creator_payout',
      userId: creatorId,
      amountCents: 765,
      status: 'paid',
      stripeTransferId: `tr_sup${uid()}`,
    });
    fake.charges.set(chargeId, {
      id: chargeId,
      object: 'charge',
      amount: 1000,
      created: paidAt,
      currency: 'gbp',
      payment_intent: paymentIntentId,
      payment_method_details: { card: { brand: 'visa', last4: '4242' } },
      balance_transaction: { id: `txn_${uid()}`, fee: 45 },
      metadata: {},
    });
    return { chargeId, paymentIntentId, purchase, item, fee, org, creator };
  }

  /**
   * A paid invoice of an Inner Circle subscription, `agoSeconds` ago, and
   * Stripe's record of it: `current` says whether it paid for the period now
   * running. A subscriber of its own unless one is given: a user holds one
   * live subscription per organisation.
   */
  async function invoiceCharge(
    agoSeconds = DAY,
    current = true,
    subscriber?: string
  ) {
    const userId = subscriber ?? takeFirst(await seedTestUsers(db, 1));
    const stripeSubscriptionId = `sub_sup${uid()}`;
    const subscription = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(userId, orgId, tierId, {
            stripeSubscriptionId,
            // Billing began long before this payment: a renewal.
            currentPeriodStart: new Date((nowSeconds() - agoSeconds) * 1000),
          })
        )
        .returning()
    );
    created.subscriptionIds.push(subscription.id);
    const chargeId = `ch_sup${uid()}${uid()}`;
    const paymentIntentId = `pi_sup${uid()}`;
    const source = {
      subscriptionId: subscription.id,
      sourceType: 'subscription' as const,
      stripeChargeId: chargeId,
    };
    await slice({
      ...source,
      payoutType: 'platform_fee',
      amountCents: 100,
      status: 'paid',
    });
    await slice({
      ...source,
      payoutType: 'organization_fee',
      userId: ownerId,
      amountCents: 135,
      status: 'pending',
    });
    await slice({
      ...source,
      payoutType: 'creator_payout',
      userId: creatorId,
      amountCents: 765,
      status: 'paid',
      stripeTransferId: `tr_sup${uid()}`,
    });
    fake.charges.set(chargeId, {
      id: chargeId,
      object: 'charge',
      amount: 1000,
      created: nowSeconds() - agoSeconds,
      currency: 'gbp',
      payment_intent: paymentIntentId,
      payment_method_details: { card: { brand: 'mastercard', last4: '4444' } },
      balance_transaction: { id: `txn_${uid()}`, fee: 45 },
      metadata: {},
    });
    const invoiceId = `in_sup${uid()}`;
    fake.invoiceByPaymentIntent.set(paymentIntentId, invoiceId);
    fake.invoices.set(invoiceId, {
      id: invoiceId,
      billing_reason: 'subscription_cycle',
      subscription: stripeSubscriptionId,
    });
    if (current) {
      fake.paidInvoices.set(stripeSubscriptionId, [invoiceId]);
    } else {
      const newer = `in_sup${uid()}`;
      fake.invoices.set(newer, {
        id: newer,
        billing_reason: 'subscription_cycle',
        subscription: stripeSubscriptionId,
      });
      fake.paidInvoices.set(stripeSubscriptionId, [newer, invoiceId]);
    }
    return { chargeId, subscription };
  }

  /** A refund already on the charge at Stripe (no support key on it). */
  function stripeRefund(
    chargeId: string,
    amount: number,
    overrides: Partial<Stripe.Refund> = {}
  ): Stripe.Refund {
    const refund = {
      id: `re_sup${uid()}`,
      object: 'refund',
      amount,
      charge: chargeId,
      currency: 'gbp',
      status: 'succeeded',
      reason: 'requested_by_customer',
      failure_reason: null,
      created: nowSeconds() - 60,
      metadata: {},
      ...overrides,
    } as unknown as Stripe.Refund;
    fake.refundsByCharge.set(chargeId, [
      ...(fake.refundsByCharge.get(chargeId) ?? []),
      refund,
    ]);
    created.stripeRefundIds.push(refund.id);
    return refund;
  }

  async function dispute(
    chargeId: string,
    status: string,
    purchaseId?: string
  ) {
    const id = `du_sup${uid()}`;
    created.stripeDisputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: chargeId,
      purchaseId: purchaseId ?? null,
      amountCents: 1000,
      currency: 'gbp',
      status,
      reason: 'product_not_received',
      stripeCreatedAt: new Date(),
    });
    return id;
  }

  const refundInput = (amountCents: number, expectedRefundCount = 0) => ({
    amountCents,
    reason: 'requested_by_customer' as const,
    expectedRefundCount,
  });

  // ── the refund route (§5, §6) ─────────────────────────────────────────

  describe('issueRefund', () => {
    it('refunds in part with the deterministic key, who asked, and the env tag', async () => {
      const { chargeId } = await purchaseCharge();

      const result = await service.issueRefund(
        chargeId,
        refundInput(400),
        supportId
      );

      expect(result.replayed).toBe(false);
      expect(result.refund).toMatchObject({
        amountCents: 400,
        status: 'succeeded',
      });
      created.stripeRefundIds.push(result.refund.id);
      const key = `support_refund_${chargeId}_0_400`;
      expect(fake.stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(fake.stripe.refunds.create).toHaveBeenCalledWith(
        {
          charge: chargeId,
          amount: 400,
          reason: 'requested_by_customer',
          metadata: {
            codex_support_key: key,
            codex_requested_by: supportId,
            codex_env: 'test',
          },
        },
        { idempotencyKey: key }
      );
    });

    it('a repeat of the same submit makes one Stripe refund and answers replayed', async () => {
      const { chargeId } = await purchaseCharge();

      const first = await service.issueRefund(
        chargeId,
        refundInput(1000),
        supportId
      );
      const second = await service.issueRefund(
        chargeId,
        refundInput(1000),
        supportId
      );

      created.stripeRefundIds.push(first.refund.id);
      expect(fake.stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(second).toEqual({ refund: first.refund, replayed: true });
    });

    it('a moved refund count is CHARGE_CHANGED (412), before Stripe is asked', async () => {
      const { chargeId } = await purchaseCharge();
      stripeRefund(chargeId, 200);

      const error = await failureOf(
        service.issueRefund(chargeId, refundInput(300, 0), supportId)
      );

      expect(error.statusCode).toBe(412);
      expect(error.context).toEqual({ code: 'CHARGE_CHANGED', refundCount: 1 });
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('the same key with another reason is REFUND_ALREADY_SUBMITTED (409)', async () => {
      const { chargeId } = await purchaseCharge();
      // Another tab's request with this key is still in flight: Stripe holds
      // the key, and the refund is not listed yet.
      const key = `support_refund_${chargeId}_0_500`;
      fake.keys.set(key, {
        fingerprint: JSON.stringify([chargeId, 500, 'duplicate']),
        refund: {} as Stripe.Refund,
      });

      const error = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );

      expect(error.statusCode).toBe(409);
      expect(error.context).toEqual({ code: 'REFUND_ALREADY_SUBMITTED' });
      expect(JSON.stringify(error.context)).not.toContain('idempotent');
    });

    it('is open for 13 d 23 h 59 min after the charge, and closed at exactly 14 days', async () => {
      const open = await purchaseCharge(14 * DAY - 60);
      const closed = await purchaseCharge(14 * DAY);

      const made = await service.issueRefund(
        open.chargeId,
        refundInput(100),
        supportId
      );
      created.stripeRefundIds.push(made.refund.id);
      const error = await failureOf(
        service.issueRefund(closed.chargeId, refundInput(100), supportId)
      );

      expect(error.statusCode).toBe(422);
      expect(error.context).toMatchObject({ code: 'REFUND_WINDOW_CLOSED' });
      const charge = fake.charges.get(closed.chargeId);
      expect(error.context?.closesAt).toBe(
        new Date(((charge?.created ?? 0) + 14 * DAY) * 1000).toISOString()
      );
      expect(fake.stripe.refunds.create).toHaveBeenCalledTimes(1);
    });

    it("measures a renewal's window from its own charge", async () => {
      // The subscription began 40 days ago; this renewal was paid yesterday.
      const renewal = await invoiceCharge(DAY);
      await db
        .update(subscriptions)
        .set({ createdAt: new Date((nowSeconds() - 40 * DAY) * 1000) })
        .where(eq(subscriptions.id, renewal.subscription.id));

      const made = await service.issueRefund(
        renewal.chargeId,
        refundInput(500),
        supportId
      );
      created.stripeRefundIds.push(made.refund.id);
      expect(made.replayed).toBe(false);
    });

    it('an open or a lost chargeback blocks it with its current status; an inquiry or a won one does not', async () => {
      for (const status of ['needs_response', 'under_review', 'lost']) {
        const { chargeId, purchase } = await purchaseCharge();
        await dispute(chargeId, status, purchase.id);
        const error = await failureOf(
          service.issueRefund(chargeId, refundInput(100), supportId)
        );
        expect(error.context).toEqual({
          code: 'CHARGE_HAS_CHARGEBACK',
          disputeStatus: status,
        });
      }
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();

      for (const status of ['warning_needs_response', 'won']) {
        const { chargeId, purchase } = await purchaseCharge();
        await dispute(chargeId, status, purchase.id);
        const made = await service.issueRefund(
          chargeId,
          refundInput(100),
          supportId
        );
        created.stripeRefundIds.push(made.refund.id);
      }
      expect(fake.stripe.refunds.create).toHaveBeenCalledTimes(2);
    });

    it('refuses when nothing is left, and an amount over what is left is a 400 naming the most', async () => {
      const full = await purchaseCharge();
      stripeRefund(full.chargeId, 1000);
      const partly = await purchaseCharge();
      stripeRefund(partly.chargeId, 300);
      // A failed refund gave nothing back: it does not count against the charge.
      stripeRefund(partly.chargeId, 200, { status: 'failed' });

      const nothing = await failureOf(
        service.issueRefund(full.chargeId, refundInput(1, 1), supportId)
      );
      const over = await failureOf(
        service.issueRefund(partly.chargeId, refundInput(701, 2), supportId)
      );

      expect(nothing.context).toEqual({ code: 'NOTHING_LEFT_TO_REFUND' });
      expect(over.statusCode).toBe(400);
      expect(over.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 700,
      });
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it("maps Stripe's refusal to its code, never its message", async () => {
      const { chargeId } = await purchaseCharge();
      vi.mocked(fake.stripe.refunds.create).mockRejectedValueOnce(
        Object.assign(new Error('Charge ch_x on acct_1Secret was disputed'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
          code: 'charge_disputed',
        })
      );

      const error = await failureOf(
        service.issueRefund(chargeId, refundInput(100), supportId)
      );

      expect(error.context).toEqual({
        code: 'STRIPE_REFUSED',
        stripeCode: 'charge_disputed',
      });
      expect(error.message).not.toContain('acct_');
    });

    it('a charge we hold no record of is a 404, and nothing is refunded', async () => {
      const error = await failureOf(
        service.issueRefund(`ch_sup${uid()}none`, refundInput(100), supportId)
      );
      expect(error.statusCode).toBe(404);
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });
  });

  // ── detail and preview (§1, §3) ───────────────────────────────────────

  describe('getChargeDetail', () => {
    it('returns the charge, its split payees first, and who made each refund', async () => {
      const { chargeId, purchase, item } = await purchaseCharge();
      const support = stripeRefund(chargeId, 200, {
        created: nowSeconds() - 120,
        metadata: { codex_requested_by: supportId, codex_env: 'test' },
      });
      stripeRefund(chargeId, 100, { created: nowSeconds() - 60 });

      const detail = await service.getChargeDetail(chargeId);

      expect(detail.charge).toMatchObject({
        id: chargeId,
        amountCents: 1000,
        refundedCents: 300,
        card: { brand: 'visa', last4: '4242' },
        stripeFeeCents: 45,
      });
      expect(detail.source).toMatchObject({
        type: 'purchase',
        purchaseId: purchase.id,
        item: { kind: 'content', id: item.id, deleted: false },
      });
      expect(detail.buyer.userId).toBe(buyerId);
      expect(detail.refundable).toEqual({ maxCents: 700, blocked: null });
      expect(detail.refundCount).toBe(2);
      expect(detail.window.isOpen).toBe(true);
      expect(detail.slices.map((row) => row.payoutType)).toEqual([
        'creator_payout',
        'organization_fee',
        'platform_fee',
      ]);
      expect(detail.slices[0]?.payee?.userId).toBe(creatorId);
      expect(detail.refunds.map((row) => row.requestedBy)).toEqual([
        { userId: supportId, name: expect.any(String), deleted: false },
        'dashboard',
      ]);
      expect(detail.refunds[0]?.id).toBe(support.id);
      // Never an account id or a debt's Stripe message.
      expect(JSON.stringify(detail)).not.toContain('acct_');
    });

    it('says a chargeback blocks the refund, with the deadline Stripe gives', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const id = await dispute(chargeId, 'needs_response', purchase.id);
      const dueBy = nowSeconds() + 7 * DAY;
      fake.disputeDueBy.set(id, dueBy);

      const detail = await service.getChargeDetail(chargeId);

      expect(detail.refundable.blocked).toBe('chargeback');
      expect(detail.chargebacks).toEqual([
        expect.objectContaining({
          id,
          status: 'needs_response',
          respondBy: new Date(dueBy * 1000).toISOString(),
        }),
      ]);
    });

    it("names a subscription invoice's plan and whether it paid the current period", async () => {
      const { chargeId, subscription } = await invoiceCharge(DAY, true);

      const detail = await service.getChargeDetail(chargeId);

      expect(detail.source).toMatchObject({
        type: 'subscription',
        subscriptionId: subscription.id,
        planName: 'Inner Circle',
        interval: 'month',
        isCurrentPeriodPayment: true,
      });
      expect(detail.slices).toHaveLength(3);
    });
  });

  describe('previewRefund', () => {
    it("plans a part refund by the engine's own rules; the buyer keeps access", async () => {
      const { chargeId, creator, org, fee } = await purchaseCharge();

      const preview = await service.previewRefund(chargeId, 500);

      expect(preview.isFinal).toBe(false);
      expect(
        preview.lines.map((line) => [
          line.payoutId,
          line.method,
          line.amountCents,
        ])
      ).toEqual(
        expect.arrayContaining([
          [creator.id, 'transfer_reversal', 382],
          [org.id, 'reduce_unpaid', 67],
          [fee.id, 'platform_bears', 50],
          [null, 'rounding', 1],
        ])
      );
      expect(preview.payeesGiveBackCents).toBe(449);
      expect(preview.platformBearsCents).toBe(51);
      expect(preview.stripeFeeCents).toBe(45);
      expect(preview.access.kind).toBe('keeps');
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('a full refund of a purchase loses access, and unpaid slices are cancelled', async () => {
      const { chargeId, org } = await purchaseCharge();

      const preview = await service.previewRefund(chargeId, 1000);

      expect(preview.isFinal).toBe(true);
      expect(preview.access.kind).toBe('loses');
      expect(preview.lines).toContainEqual(
        expect.objectContaining({ payoutId: org.id, method: 'cancel_unpaid' })
      );
    });

    it("a full refund of the current period's payment cancels the subscription; an earlier period's leaves it running", async () => {
      const current = await invoiceCharge(DAY, true);
      const earlier = await invoiceCharge(DAY, false);

      const cancels = await service.previewRefund(current.chargeId, 1000);
      const runs = await service.previewRefund(earlier.chargeId, 1000);
      const part = await service.previewRefund(current.chargeId, 999);

      expect(cancels.access).toEqual({
        kind: 'subscription_cancelled',
        title: 'Inner Circle',
      });
      expect(runs.access.kind).toBe('subscription_runs');
      expect(part.access.kind).toBe('subscription_runs');
    });

    it('an amount over what is left is a 400', async () => {
      const { chargeId } = await purchaseCharge();
      stripeRefund(chargeId, 900);
      const error = await failureOf(service.previewRefund(chargeId, 101));
      expect(error.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 100,
      });
    });
  });

  // ── search (§2) ───────────────────────────────────────────────────────

  describe('searchCharges', () => {
    it("finds a buyer's purchases and invoices by email, newest first", async () => {
      const older = await purchaseCharge(3 * DAY);
      const invoice = await invoiceCharge(DAY, true, buyerId);
      stripeRefund(older.chargeId, 250);
      await db.insert(refunds).values({
        stripeRefundId: fake.refundsByCharge.get(older.chargeId)?.[0]?.id ?? '',
        stripeChargeId: older.chargeId,
        purchaseId: older.purchase.id,
        amountCents: 250,
        currency: 'gbp',
        status: 'succeeded',
        stripeCreatedAt: new Date(),
      });

      const result = await service.searchCharges({
        q: buyerEmail.toUpperCase(),
        page: 1,
        limit: 50,
      });

      const ids = result.items.map((row) => row.chargeId);
      expect(ids).toContain(older.chargeId);
      expect(ids).toContain(invoice.chargeId);
      expect(ids.indexOf(invoice.chargeId)).toBeLessThan(
        ids.indexOf(older.chargeId)
      );
      const row = result.items.find((item) => item.chargeId === older.chargeId);
      expect(row).toMatchObject({
        kind: 'purchase',
        amountCents: 1000,
        refundedCents: 250,
        buyer: { userId: buyerId, email: buyerEmail },
        chargeback: null,
      });
      const invoiceRow = result.items.find(
        (item) => item.chargeId === invoice.chargeId
      );
      expect(invoiceRow).toMatchObject({
        kind: 'subscription_invoice',
        title: 'Inner Circle',
        interval: 'month',
        amountCents: 1000,
      });
    });

    it('finds one charge by purchase id, by charge id and by Stripe subscription id', async () => {
      const bought = await purchaseCharge();
      const invoice = await invoiceCharge();

      const byPurchase = await service.searchCharges({
        q: bought.purchase.id,
        page: 1,
        limit: 20,
      });
      const byCharge = await service.searchCharges({
        q: invoice.chargeId,
        page: 1,
        limit: 20,
      });
      const bySubscription = await service.searchCharges({
        q: invoice.subscription.stripeSubscriptionId,
        page: 1,
        limit: 20,
      });

      expect(byPurchase.items.map((row) => row.chargeId)).toEqual([
        bought.chargeId,
      ]);
      expect(byCharge.items.map((row) => row.chargeId)).toEqual([
        invoice.chargeId,
      ]);
      expect(bySubscription.items.map((row) => row.chargeId)).toEqual([
        invoice.chargeId,
      ]);
    });

    it('anything else finds nothing, and asks Stripe nothing', async () => {
      const result = await service.searchCharges({
        q: 'no such thing',
        page: 1,
        limit: 20,
      });
      expect(result).toEqual({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
      expect(fake.stripe.charges.retrieve).not.toHaveBeenCalled();
    });
  });

  // ── the queue (§8) ────────────────────────────────────────────────────

  /**
   * A refund the engine clawed back when it succeeded, that has since failed
   * at Stripe, as the refund webhook records it.
   */
  async function failedRefund(
    charge: Awaited<ReturnType<typeof purchaseCharge>>,
    amountCents: number
  ) {
    const refund = { id: `re_sup${uid()}`, amountCents, createdAt: 1 };
    created.stripeRefundIds.push(refund.id);
    const deps: ClawbackDeps = {
      db,
      stripe: fake.stripe,
      obs,
      environment: 'test',
    };
    await reverseCharge(deps, {
      charge: { id: charge.chargeId, amountCents: 1000 },
      source: { sourceType: 'purchase', purchaseId: charge.purchase.id },
      refunds: [refund],
    });
    return takeFirst(
      await db
        .insert(refunds)
        .values({
          stripeRefundId: refund.id,
          stripeChargeId: charge.chargeId,
          purchaseId: charge.purchase.id,
          amountCents,
          currency: 'gbp',
          status: 'failed',
          failureReason: 'expired_or_canceled_card',
          requestedByUserId: supportId,
          stripeCreatedAt: new Date(),
        })
        .returning()
    );
  }

  /** What `processRefund` does to a purchase refunded in full. */
  async function endAccess(charge: Awaited<ReturnType<typeof purchaseCharge>>) {
    const at = new Date();
    await db
      .update(purchases)
      .set({
        status: PURCHASE_STATUS.REFUNDED,
        refundedAt: at,
        refundAmountCents: 1000,
      })
      .where(eq(purchases.id, charge.purchase.id));
    await db
      .update(entitlements)
      .set({ revokedAt: at })
      .where(eq(entitlements.sourceRef, charge.purchase.id));
    await db
      .update(contentAccess)
      .set({ deletedAt: at })
      .where(eq(contentAccess.contentId, charge.item.id));
  }

  const repayRowsOf = async (stripeRefundId: string) =>
    db
      .select({ repaid: payoutReversals.repaidByPayoutId })
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.causeId, stripeRefundId),
          isNotNull(payoutReversals.repaidByPayoutId)
        )
      );

  describe('the queue', () => {
    it("counts and lists a failed refund, with what its clawback took from payees but not the fee's share", async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);

      const counts = await service.getQueueCounts();
      const list = await service.listFailedRefunds({ page: 1, limit: 50 });
      const item = list.items.find((row) => row.refundId === failed.id);

      expect(counts.failedRefunds).toBeGreaterThanOrEqual(1);
      expect(item).toMatchObject({
        stripeRefundId: failed.stripeRefundId,
        chargeId: charge.chargeId,
        kind: 'purchase',
        title: charge.item.title,
        chargeAmountCents: 1000,
        amountCents: 1000,
        isFull: true,
        requestedBy: { userId: supportId },
        failureReason: 'expired_or_canceled_card',
        failureLabel: 'The card has expired or been cancelled',
        // Creator 765 reversed + organisation 135 cancelled; not the fee's 100.
        takenFromPayeesCents: 900,
      });
    });

    it('settling refunded_elsewhere twice writes once; another resolution is a 409; a refund that did not fail is a 404', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 400);

      const first = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
        supportId
      );
      const again = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
        supportId
      );
      const other = await failureOf(
        service.resolveFailedRefund(
          failed.id,
          { resolution: 'creators_repaid', note: 'No' },
          supportId
        )
      );

      expect(again.settled.resolvedAt).toBe(first.settled.resolvedAt);
      expect(other.statusCode).toBe(409);
      expect(other.context).toEqual({
        code: 'ALREADY_SETTLED',
        resolution: 'refunded_elsewhere',
      });
      const [row] = await db
        .select()
        .from(refunds)
        .where(eq(refunds.id, failed.id));
      expect(row).toMatchObject({
        resolution: 'refunded_elsewhere',
        resolvedByUserId: supportId,
        resolutionNote: 'Bank transfer',
      });

      const succeeded = takeFirst(
        await db
          .insert(refunds)
          .values({
            stripeRefundId: `re_sup${uid()}`,
            stripeChargeId: charge.chargeId,
            purchaseId: charge.purchase.id,
            amountCents: 100,
            currency: 'gbp',
            status: 'succeeded',
            stripeCreatedAt: new Date(),
          })
          .returning()
      );
      created.stripeRefundIds.push(succeeded.stripeRefundId);
      const notFailed = await failureOf(
        service.resolveFailedRefund(
          succeeded.id,
          { resolution: 'refunded_elsewhere', note: '' },
          supportId
        )
      );
      expect(notFailed.statusCode).toBe(404);
      const [untouched] = await db
        .select({ resolvedAt: refunds.resolvedAt })
        .from(refunds)
        .where(eq(refunds.id, succeeded.id));
      expect(untouched?.resolvedAt).toBeNull();
    });

    it('creators_repaid writes one re-pay row per payee step, never two, and a failed full refund gives access back', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await endAccess(charge);

      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Buyer keeps the item' },
        supportId
      );
      const again = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Buyer keeps the item' },
        supportId
      );

      // The creator's reversal and the organisation's cancellation; not the fee.
      expect(
        settled.settled.repaid
          .map((row) => row.amountCents)
          .sort((a, b) => a - b)
      ).toEqual([135, 765]);
      expect((await repayRowsOf(failed.stripeRefundId)).length).toBe(2);
      expect(again.settled.repaid).toHaveLength(2);
      expect(again.restoredAccess).toBeNull();
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      expect(settled.settled.accessRestored).toBe(true);
      expect(settled.restoredAccess).toEqual({
        restored: true,
        userId: buyerId,
        organizationId: orgId,
      });
      const [purchase] = await db
        .select()
        .from(purchases)
        .where(eq(purchases.id, charge.purchase.id));
      expect(purchase).toMatchObject({
        status: PURCHASE_STATUS.COMPLETED,
        refundedAt: null,
        refundAmountCents: null,
      });
      const [entitlement] = await db
        .select({ revokedAt: entitlements.revokedAt })
        .from(entitlements)
        .where(eq(entitlements.sourceRef, charge.purchase.id));
      expect(entitlement?.revokedAt).toBeNull();
      const [access] = await db
        .select({ deletedAt: contentAccess.deletedAt })
        .from(contentAccess)
        .where(eq(contentAccess.contentId, charge.item.id));
      expect(access?.deletedAt).toBeNull();
    });

    it('creators_repaid on a refund that did not fail is a 404, and re-pays nothing', async () => {
      // The customer has the money: paying the creators back too would pay
      // the refund twice.
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await db
        .update(refunds)
        .set({ status: 'succeeded', failureReason: null })
        .where(eq(refunds.id, failed.id));

      const error = await failureOf(
        service.resolveFailedRefund(
          failed.id,
          { resolution: 'creators_repaid', note: 'Re-pay' },
          supportId
        )
      );

      expect(error.statusCode).toBe(404);
      expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
    });

    it('a failed part refund re-pays the payees and leaves access as it was', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 400);

      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Re-pay' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      expect(settled.settled.accessRestored).toBe(false);
      expect(settled.restoredAccess).toBeNull();
    });

    it('a note is required to re-pay the payees', () => {
      expect(
        supportResolveFailedRefundSchema.safeParse({
          resolution: 'creators_repaid',
          note: '   ',
        }).success
      ).toBe(false);
      expect(
        supportResolveFailedRefundSchema.safeParse({
          resolution: 'refunded_elsewhere',
        }).success
      ).toBe(true);
    });

    it('lists an open creator debt and settles it once', async () => {
      const charge = await purchaseCharge();
      // The creator's balance could not cover the reversal.
      vi.mocked(fake.stripe.transfers.createReversal).mockRejectedValueOnce(
        Object.assign(new Error('Insufficient funds on acct_1Secret'), {
          code: 'insufficient_funds',
          statusCode: 400,
        })
      );
      await failedRefund(charge, 1000);
      const [review] = await db
        .select()
        .from(refundReviews)
        .where(eq(refundReviews.payoutId, charge.creator.id));
      if (!review) throw new Error('expected a creator debt');

      const list = await service.listCreatorDebts({ page: 1, limit: 50 });
      const item = list.items.find((row) => row.reviewId === review.id);
      expect(item).toMatchObject({
        payoutId: charge.creator.id,
        payee: { userId: creatorId, role: 'creator' },
        owedCents: 765,
        chargeId: charge.chargeId,
        title: charge.item.title,
        cause: { type: 'refund', amountCents: 1000, disputeStatus: null },
        errorCode: 'insufficient_funds',
      });
      expect(item?.errorLabel).toContain('Stripe balance was too low');
      expect(item?.history).toEqual([
        expect.objectContaining({ outcome: 'owed', amountCents: 765 }),
      ]);
      expect(JSON.stringify(list.items)).not.toContain('acct_');

      const first = await service.resolveCreatorDebt(
        review.id,
        { resolution: 'creator_absorbed', note: '' },
        supportId
      );
      const again = await service.resolveCreatorDebt(
        review.id,
        { resolution: 'creator_absorbed', note: '' },
        supportId
      );
      const other = await failureOf(
        service.resolveCreatorDebt(
          review.id,
          { resolution: 'platform_absorbed', note: '' },
          supportId
        )
      );
      expect(again.resolvedAt).toBe(first.resolvedAt);
      expect(other.statusCode).toBe(409);
      const missing = await failureOf(
        service.resolveCreatorDebt(
          crypto.randomUUID(),
          { resolution: 'creator_absorbed', note: '' },
          supportId
        )
      );
      expect(missing.statusCode).toBe(404);
    });
  });

  // ── the requester round trip (Q3) ─────────────────────────────────────

  it("the webhook's recordChargeRefunds copies who asked onto the refunds row", async () => {
    const { chargeId, paymentIntentId } = await purchaseCharge();
    const made = await service.issueRefund(
      chargeId,
      refundInput(300),
      supportId
    );
    created.stripeRefundIds.push(made.refund.id);

    await new PurchaseService(
      { db, environment: 'test' },
      fake.stripe
    ).recordChargeRefunds({ id: chargeId, paymentIntentId });

    const [row] = await db
      .select({ requestedByUserId: refunds.requestedByUserId })
      .from(refunds)
      .where(eq(refunds.stripeRefundId, made.refund.id));
    expect(row?.requestedByUserId).toBe(supportId);
  });
});
