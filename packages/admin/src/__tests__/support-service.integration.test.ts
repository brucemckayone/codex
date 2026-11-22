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

import {
  CONTENT_TYPES,
  type DisputeAppealStatus,
  ITEM_UNAVAILABLE_REFUND_REASON,
  PURCHASE_STATUS,
} from '@codex/constants';
import {
  agreementProposals,
  connectBalances,
  contentAccess,
  content as contentTable,
  creatorOrganizationAgreements,
  disputes,
  entitlements,
  organizations,
  type Payout,
  payeeCredits,
  payoutReversals,
  payouts,
  purchases,
  refundReviews,
  refunds,
  stripeConnectAccountHistory,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import {
  type ClawbackDeps,
  loadClawbackPlanInput,
  repayDispute,
  reverseCharge,
} from '@codex/payments';
import {
  FeeConfigService,
  findShortLosses,
  PurchaseService,
} from '@codex/purchase';
import { ServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
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
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AdminAnalyticsService } from '../services/analytics-service';
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
  /**
   * Keys Stripe has seen, with the FIRST answer it saved under each, a
   * refusal or a 500 included: a repeat with other parameters is refused, a
   * repeat with the same ones gets that answer again, for 24 hours.
   */
  const keys = new Map<
    string,
    {
      fingerprint: string;
      refund?: Stripe.Refund;
      error?: Record<string, unknown>;
    }
  >();
  /** The next refunds.create calls fail with these, once the endpoint ran. */
  const refusals: Array<Record<string, unknown>> = [];
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
  /** A PaymentIntent's one charge, as Stripe's `latest_charge` names it. */
  const chargeOfPaymentIntent = (paymentIntentId: string) =>
    [...charges.values()].find(
      (charge) => charge.payment_intent === paymentIntentId
    );
  /** The charge a refund is asked of: its own, or its PaymentIntent's (the blocked refund). */
  const chargeIdOf = (params: Stripe.RefundCreateParams) =>
    typeof params.payment_intent === 'string'
      ? chargeOfPaymentIntent(params.payment_intent)?.id
      : (params.charge as string);
  vi.mocked(stripe.paymentIntents.retrieve).mockImplementation((async (
    id: string
  ) => ({
    id,
    application_fee_amount: null,
    latest_charge: chargeOfPaymentIntent(id)?.id ?? null,
  })) as never);
  vi.mocked(stripe.refunds.create).mockImplementation((async (
    params: Stripe.RefundCreateParams,
    options?: { idempotencyKey?: string }
  ) => {
    const chargeId = chargeIdOf(params) ?? '';
    const charge = charges.get(chargeId);
    if (!charge) throw missing();
    const fingerprint = JSON.stringify([
      chargeId,
      params.amount,
      params.reason,
      params.metadata ?? {},
    ]);
    const key = options?.idempotencyKey;
    const seen = key ? keys.get(key) : undefined;
    if (seen) {
      // Still running under another request, nothing saved yet: Stripe's
      // 409 `idempotency_key_in_use`, whatever the parameters.
      if (!seen.refund && !seen.error) {
        throw Object.assign(new Error('Another request is using this key'), {
          type: 'StripeIdempotencyError',
          statusCode: 409,
          code: 'idempotency_key_in_use',
        });
      }
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
      if (seen.error) {
        throw Object.assign(new Error('Replayed'), seen.error, {
          headers: { 'idempotent-replayed': 'true' },
        });
      }
      return seen.refund;
    }
    const refusal = refusals.shift();
    if (refusal) {
      if (key) keys.set(key, { fingerprint, error: refusal });
      throw Object.assign(new Error('Refused at acct_1Secret'), refusal, {
        requestId: `req_${uid()}`,
        headers: {},
      });
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
    refusals,
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
    agreementIds: [] as string[],
    proposalIds: [] as string[],
    /** Users given a `connect_balances` row (Codex-2hxff.30). */
    balanceUserIds: [] as string[],
    /** Payees given a Connect account (review LOW-8). */
    connectUserIds: [] as string[],
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

  /** The service's own log, watched. */
  let serviceLog: () => {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  // Every refund this test's fake made or listed is removed with the rest:
  // support's syncs record each one of a charge it refunds (review r12),
  // whether the test registered it or not.
  afterEach(() => {
    for (const listed of fake.refundsByCharge.values()) {
      for (const refund of listed) created.stripeRefundIds.push(refund.id);
    }
  });

  beforeEach(() => {
    fake = fakeStripe();
    obs.error.mockClear();
    service = new SupportService({
      db,
      environment: 'test',
      stripe: fake.stripe,
      purchase: new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        fake.stripe
      ),
      feeConfig: new FeeConfigService({ db, environment: 'test' }),
    });
    const log = (
      service as unknown as {
        obs: {
          warn: (...a: unknown[]) => void;
          error: (...a: unknown[]) => void;
        };
      }
    ).obs;
    const watched = {
      warn: vi.spyOn(log, 'warn'),
      error: vi.spyOn(log, 'error'),
    };
    serviceLog = () =>
      watched as unknown as {
        warn: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
      };
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
      // A credit holds its step and its re-pay (restrict): first.
      await db.delete(payeeCredits).where(inArray(payeeCredits.payoutId, ids));
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
      // A duplicate names its original (ON DELETE RESTRICT): unlink first.
      await db
        .update(purchases)
        .set({ duplicateOfPurchaseId: null })
        .where(inArray(purchases.id, created.purchaseIds));
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
    // After the purchases and slices that name them.
    if (created.agreementIds.length > 0) {
      await db
        .delete(creatorOrganizationAgreements)
        .where(inArray(creatorOrganizationAgreements.id, created.agreementIds));
    }
    if (created.proposalIds.length > 0) {
      await db
        .delete(agreementProposals)
        .where(inArray(agreementProposals.id, created.proposalIds));
    }
    if (created.balanceUserIds.length > 0) {
      await db
        .delete(connectBalances)
        .where(inArray(connectBalances.userId, created.balanceUserIds));
    }
    if (created.connectUserIds.length > 0) {
      await db
        .delete(stripeConnectAccounts)
        .where(inArray(stripeConnectAccounts.userId, created.connectUserIds));
      // The delete's trigger keeps a history row of each.
      await db
        .delete(stripeConnectAccountHistory)
        .where(
          inArray(stripeConnectAccountHistory.userId, created.connectUserIds)
        );
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

  /** The dispute's outcome applied: a win's pay-back, or a loss's take. */
  async function applyOutcome(id: string, at = new Date(Date.now() - 60_000)) {
    await db
      .update(disputes)
      .set({ outcomeAppliedAt: at })
      .where(eq(disputes.stripeDisputeId, id));
  }

  /**
   * A chargeback lost (applied on `lostOn`) and then won late
   * (Codex-2hxff.70): `undone` once the undo has applied it.
   */
  async function lateWin(
    chargeId: string,
    purchaseId: string,
    { undone }: { undone: boolean }
  ) {
    const id = await dispute(chargeId, 'won', purchaseId);
    const lostOn = new Date(Date.now() - 20 * DAY * 1000);
    const wonOn = new Date(Date.now() - 2 * 60_000);
    await db
      .update(disputes)
      .set({
        lateWonAt: wonOn,
        lostAppliedAt: lostOn,
        outcomeAppliedAt: undone ? new Date(Date.now() - 60_000) : null,
      })
      .where(eq(disputes.stripeDisputeId, id));
    return { id, lostOn, wonOn };
  }

  /**
   * The creator's accepted agreement at `shareBps`. Ended, so a second one
   * of the same type never meets the one-active-agreement index.
   */
  async function agreement(
    revenueType: 'subscription' | 'content_purchase',
    shareBps: number
  ) {
    const proposal = takeFirst(
      await db
        .insert(agreementProposals)
        .values({
          organizationId: orgId,
          creatorId,
          revenueType,
          roundNumber: 1,
          proposedByUserId: ownerId,
          proposedByRole: 'owner',
          proposedCreatorSharePercent: shareBps,
          proposedEffectiveFrom: new Date(),
          status: 'accepted',
        })
        .returning()
    );
    created.proposalIds.push(proposal.id);
    const row = takeFirst(
      await db
        .insert(creatorOrganizationAgreements)
        .values({
          creatorId,
          organizationId: orgId,
          organizationFeePercentage: 10_000 - shareBps,
          revenueType,
          status: 'terminated',
          terminatedAt: new Date(),
          currentProposalId: proposal.id,
        })
        .returning()
    );
    created.agreementIds.push(row.id);
    return row.id;
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

    it('a key held by a request still in flight, with no refund listed, is REFUND_IN_FLIGHT (409): it may still land, so nothing else is advised (MED-A)', async () => {
      const { chargeId } = await purchaseCharge();
      // Another tab's request with this key is still in flight: Stripe holds
      // the key, saved nothing yet, and no refund is listed.
      const key = `support_refund_${chargeId}_0_500`;
      fake.keys.set(key, { fingerprint: 'another request' });

      const error = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );

      expect(error.statusCode).toBe(409);
      expect(error.context).toEqual({ code: 'REFUND_IN_FLIGHT' });
    });

    it('a refusal Stripe replays for the same submit keeps its code (LOW-E)', async () => {
      const { chargeId } = await purchaseCharge();
      fake.refusals.push({
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'amount_too_large',
      });

      await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );
      const replayed = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );

      expect(replayed.context).toEqual({
        code: 'STRIPE_REFUSED',
        stripeCode: 'amount_too_large',
      });
    });

    it("an approval rule blocking refunds is Stripe's refusal, not our defect (action_blocked, LOW-E)", async () => {
      const { chargeId } = await purchaseCharge();
      fake.refusals.push({
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'action_blocked',
      });

      const error = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );

      expect(error.context).toEqual({
        code: 'STRIPE_REFUSED',
        stripeCode: 'action_blocked',
      });
    });

    it('a held key whose refund is listed by the time it is read again is a replay', async () => {
      const { chargeId } = await purchaseCharge();
      const key = `support_refund_${chargeId}_0_500`;
      const made = stripeRefund(chargeId, 500, {
        metadata: { codex_support_key: key },
      });
      fake.keys.set(key, { fingerprint: 'another tab', refund: made });
      // The first reads of the list (the sync before support reads, and
      // support's own, review r12) predate that refund.
      const empty = { object: 'list', data: [], has_more: false } as never;
      vi.mocked(fake.stripe.refunds.list)
        .mockResolvedValueOnce(empty)
        .mockResolvedValueOnce(empty);

      const result = await service.issueRefund(
        chargeId,
        refundInput(500),
        supportId
      );

      expect(result).toEqual({
        refund: expect.objectContaining({ id: made.id }),
        replayed: true,
      });
    });

    it('a refusal is saved under its key: resubmitting with another reason is REFUND_KEY_SPENT, not "submitted" (F1)', async () => {
      const { chargeId } = await purchaseCharge();
      fake.refusals.push({
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'charge_disputed',
      });

      const refused = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );
      const again = await failureOf(
        service.issueRefund(
          chargeId,
          { ...refundInput(500), reason: 'duplicate' },
          supportId
        )
      );

      expect(refused.context).toEqual({
        code: 'STRIPE_REFUSED',
        stripeCode: 'charge_disputed',
      });
      expect(again.context).toEqual({ code: 'REFUND_KEY_SPENT' });
      // The first refund may still be landing (LOW-G): reload before anything else.
      expect(again.message).toMatch(
        /^Reload the charge first: a refund for this amount may still be landing\./
      );
    });

    it('the same submit after a Stripe 500 gets that 500 replayed: REFUND_KEY_SPENT, not "try again" (F1)', async () => {
      const { chargeId } = await purchaseCharge();
      fake.refusals.push({ type: 'StripeAPIError', statusCode: 500 });

      const outage = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );
      const retry = await failureOf(
        service.issueRefund(chargeId, refundInput(500), supportId)
      );

      expect(outage.statusCode).toBe(500);
      expect(retry.statusCode).toBe(409);
      expect(retry.context).toEqual({ code: 'REFUND_KEY_SPENT' });
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
        const id = await dispute(chargeId, status, purchase.id);
        // A win whose pay-back is applied; one still settling is refused
        // (CHARGEBACK_SETTLING, Codex-2hxff.70).
        if (status === 'won') await applyOutcome(id);
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
      // Logged with ids and Stripe's code, never its message (F2).
      expect(serviceLog().warn).toHaveBeenCalledWith(
        'Stripe refused a support refund',
        {
          chargeId,
          stripeCode: 'charge_disputed',
          stripeRequestId: null,
          statusCode: 400,
          requestedByUserId: supportId,
        }
      );
    });

    it("an invalid request outside Stripe's refusal list is our defect: a 500, alerted at error (F2)", async () => {
      const { chargeId } = await purchaseCharge();
      fake.refusals.push({
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'parameter_unknown',
      });

      const error = await failureOf(
        service.issueRefund(chargeId, refundInput(100), supportId)
      );

      expect(error.statusCode).toBe(500);
      expect(JSON.stringify(error.context ?? {})).not.toContain('acct_');
      expect(serviceLog().error).toHaveBeenCalledWith(
        expect.stringContaining('a defect in the request'),
        expect.objectContaining({
          errorId: expect.any(String),
          chargeId,
          stripeCode: 'parameter_unknown',
          stripeRequestId: expect.stringMatching(/^req_/),
        })
      );
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
      expect(detail.refundable).toEqual({
        maxCents: 700,
        blocked: null,
        refundedOutsideStripeOn: null,
      });
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
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        planName: 'Inner Circle',
        interval: 'month',
        isCurrentPeriodPayment: true,
      });
      expect(detail.slices).toHaveLength(3);
    });
  });

  describe('getChargeDetail: what the approved page shows besides', () => {
    it("carries the split card's totals: what was taken back, and the fee's share in basis points", async () => {
      const untouched = await purchaseCharge();
      const clawed = await purchaseCharge();
      await failedRefund(clawed, 1000);

      const before = await service.getChargeDetail(untouched.chargeId);
      const after = await service.getChargeDetail(clawed.chargeId);

      expect(before.split).toEqual({
        takenTotalCents: 0,
        platformFeeShareBps: 1000,
      });
      // The creator's 765 reversed, the organisation's 135 cancelled, and the
      // fee's own 100 kept back: every slice, as the card's footer sums them.
      expect(after.split.takenTotalCents).toBe(1000);
      expect(after.split.takenTotalCents).toBe(
        after.slices.reduce((sum, slice) => sum + slice.takenCents, 0)
      );
    });

    it('a creator slice carries the share of the agreement that split it; no other slice does', async () => {
      const bought = await purchaseCharge();
      await db
        .update(purchases)
        .set({
          creatorOrgAgreementId: await agreement('content_purchase', 6000),
        })
        .where(eq(purchases.id, bought.purchase.id));
      const invoice = await invoiceCharge();
      await db
        .update(payouts)
        .set({ creatorOrgAgreementId: await agreement('subscription', 4500) })
        .where(
          and(
            eq(payouts.stripeChargeId, invoice.chargeId),
            eq(payouts.payoutType, 'creator_payout')
          )
        );
      const sharesOf = async (chargeId: string) =>
        Object.fromEntries(
          (await service.getChargeDetail(chargeId)).slices.map((row) => [
            row.payoutType,
            row.agreementShareBps,
          ])
        );

      expect(await sharesOf(bought.chargeId)).toEqual({
        creator_payout: 6000,
        organization_fee: null,
        platform_fee: null,
      });
      expect(await sharesOf(invoice.chargeId)).toEqual({
        creator_payout: 4500,
        organization_fee: null,
        platform_fee: null,
      });
    });

    it('a dispute line says when its dispute opened, and when its win was applied; a lost one has no win date', async () => {
      const bought = await purchaseCharge();
      const won = await dispute(bought.chargeId, 'won', bought.purchase.id);
      const wonAt = new Date(Date.now() - 60_000);
      await db
        .update(disputes)
        .set({ outcomeAppliedAt: wonAt })
        .where(eq(disputes.stripeDisputeId, won));
      const open = await dispute(bought.chargeId, 'needs_response');
      const lost = await dispute(bought.chargeId, 'lost');
      await db
        .update(disputes)
        .set({ outcomeAppliedAt: wonAt })
        .where(eq(disputes.stripeDisputeId, lost));
      for (const causeId of [won, open, lost]) {
        await db.insert(payoutReversals).values({
          payoutId: bought.creator.id,
          causeType: 'dispute',
          causeId,
          amountCents: 300,
          kind: 'transfer_reversal',
          status: 'done',
        });
      }
      const openedAt = new Map(
        (
          await db
            .select({
              id: disputes.stripeDisputeId,
              at: disputes.stripeCreatedAt,
            })
            .from(disputes)
            .where(inArray(disputes.stripeDisputeId, [won, open, lost]))
        ).map((row) => [row.id, row.at.toISOString()])
      );

      const detail = await service.getChargeDetail(bought.chargeId);
      const lines = detail.slices.find(
        (row) => row.payoutId === bought.creator.id
      )?.history;

      expect(lines?.find((line) => line.causeId === won)).toMatchObject({
        disputeOpenedAt: openedAt.get(won),
        disputeWonAt: wonAt.toISOString(),
      });
      for (const id of [open, lost]) {
        expect(lines?.find((line) => line.causeId === id)).toMatchObject({
          disputeOpenedAt: openedAt.get(id),
          disputeWonAt: null,
        });
      }
    });
  });

  describe('a won chargeback settling, and one won late (Codex-2hxff.70)', () => {
    it('a won chargeback not yet applied refuses on the detail, the preview and the route alike, with CHARGEBACK_SETTLING; nothing reaches Stripe', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const id = await dispute(chargeId, 'won', purchase.id);

      const detail = await service.getChargeDetail(chargeId);
      const preview = await failureOf(service.previewRefund(chargeId, 100));
      const route = await failureOf(
        service.issueRefund(chargeId, refundInput(100), supportId)
      );

      expect(detail.refundable.blocked).toBe('chargeback_settling');
      expect(detail.chargebacks).toEqual([
        expect.objectContaining({
          id,
          status: 'won',
          settling: true,
          lostOn: null,
          lateWonOn: null,
        }),
      ]);
      for (const error of [preview, route]) {
        expect(error.statusCode).toBe(422);
        expect(error.context).toEqual({ code: 'CHARGEBACK_SETTLING' });
        expect(error.message).toBe(
          "This payment's chargeback was decided for us, and the creators are still being paid back. Refunds wait until that finishes; a step that fails is retried every hour."
        );
      }
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('lifted once the outcome is applied: the detail offers the refund, the preview plans it and the route makes it', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const id = await dispute(chargeId, 'won', purchase.id);
      await applyOutcome(id);

      const detail = await service.getChargeDetail(chargeId);
      const preview = await service.previewRefund(chargeId, 100);
      const made = await service.issueRefund(
        chargeId,
        refundInput(100),
        supportId
      );
      created.stripeRefundIds.push(made.refund.id);

      expect(detail.refundable.blocked).toBeNull();
      expect(detail.chargebacks[0]?.settling).toBe(false);
      expect(preview.amountCents).toBe(100);
      expect(made.replayed).toBe(false);
    });

    it('an open chargeback beside a settling one blocks as a chargeback, on the detail and the route', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      await dispute(chargeId, 'won', purchase.id);
      await dispute(chargeId, 'needs_response', purchase.id);

      const detail = await service.getChargeDetail(chargeId);
      const route = await failureOf(
        service.issueRefund(chargeId, refundInput(100), supportId)
      );

      expect(detail.refundable.blocked).toBe('chargeback');
      expect(route.context).toEqual({
        code: 'CHARGE_HAS_CHARGEBACK',
        disputeStatus: 'needs_response',
      });
    });

    it("a late win's chargeback row says when it was lost and won, and settles until it is undone", async () => {
      const settlingCharge = await purchaseCharge(30 * DAY);
      const undoneCharge = await purchaseCharge(30 * DAY);
      const settling = await lateWin(
        settlingCharge.chargeId,
        settlingCharge.purchase.id,
        { undone: false }
      );
      const undone = await lateWin(
        undoneCharge.chargeId,
        undoneCharge.purchase.id,
        { undone: true }
      );

      const during = await service.getChargeDetail(settlingCharge.chargeId);
      const after = await service.getChargeDetail(undoneCharge.chargeId);

      expect(during.chargebacks).toEqual([
        expect.objectContaining({
          id: settling.id,
          status: 'won',
          lostOn: settling.lostOn.toISOString(),
          lateWonOn: settling.wonOn.toISOString(),
          settling: true,
        }),
      ]);
      expect(after.chargebacks).toEqual([
        expect.objectContaining({
          id: undone.id,
          lostOn: undone.lostOn.toISOString(),
          lateWonOn: undone.wonOn.toISOString(),
          settling: false,
        }),
      ]);
      // Past the 14 days, the late win lifts the window (owner Q7), so the
      // settling block is the one that shows while the undo runs.
      expect(during.refundable.blocked).toBe('chargeback_settling');
      expect(after.refundable.blocked).toBeNull();
    });

    it("an appealed loss's row carries the appeal while it runs, and a plain loss's carries none (owner D34)", async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const appealed = await dispute(chargeId, 'lost', purchase.id);
      const plain = await dispute(chargeId, 'lost', purchase.id);
      await db
        .update(disputes)
        .set({ appealStatus: 'appeal_under_review' })
        .where(eq(disputes.stripeDisputeId, appealed));

      const detail = await service.getChargeDetail(chargeId);

      expect(
        detail.chargebacks.map((row) => [row.id, row.status, row.appealStatus])
      ).toEqual(
        expect.arrayContaining([
          [appealed, 'lost', 'appeal_under_review'],
          [plain, 'lost', null],
        ])
      );
      expect(detail.chargebacks).toHaveLength(2);
    });

    it("an appeal that needs a response shows Stripe's deadline, none when Stripe gives none; one under review is not asked (owner D34)", async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const dated = await dispute(chargeId, 'lost', purchase.id);
      const undated = await dispute(chargeId, 'lost', purchase.id);
      const reviewing = await dispute(chargeId, 'lost', purchase.id);
      const mark = (id: string, appealStatus: DisputeAppealStatus) =>
        db
          .update(disputes)
          .set({ appealStatus })
          .where(eq(disputes.stripeDisputeId, id));
      await mark(dated, 'appeal_needs_response');
      await mark(undated, 'appeal_needs_response');
      await mark(reviewing, 'appeal_under_review');
      const dueBy = nowSeconds() + 5 * DAY;
      fake.disputeDueBy.set(dated, dueBy);
      fake.disputeDueBy.set(reviewing, dueBy);

      const detail = await service.getChargeDetail(chargeId);
      const respondBy = new Map(
        detail.chargebacks.map((row) => [row.id, row.respondBy])
      );

      expect(respondBy.get(dated)).toBe(new Date(dueBy * 1000).toISOString());
      expect(respondBy.get(undated)).toBeNull();
      expect(respondBy.get(reviewing)).toBeNull();
    });

    it('a mark on a row that is not lost is stale (an older late win, after a rollback), so it is not shown', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const id = await dispute(chargeId, 'won', purchase.id);
      await db
        .update(disputes)
        .set({ appealStatus: 'appeal_under_review' })
        .where(eq(disputes.stripeDisputeId, id));

      const detail = await service.getChargeDetail(chargeId);

      expect(detail.chargebacks).toEqual([
        expect.objectContaining({ id, status: 'won', appealStatus: null }),
      ]);
    });

    it("a late win's history lines carry the loss date and the step's kind; a normal win's and a plain loss's do not (S3)", async () => {
      const late = await purchaseCharge(30 * DAY);
      const normal = await purchaseCharge();
      const plainLoss = await purchaseCharge(30 * DAY);
      const lateId = (
        await lateWin(late.chargeId, late.purchase.id, { undone: true })
      ).id;
      const normalId = await dispute(
        normal.chargeId,
        'won',
        normal.purchase.id
      );
      await applyOutcome(normalId);
      // Lost and applied, never won: the web reads lostOn as "being paid
      // back", so a plain loss's lines must not carry it.
      const plainLossId = await dispute(
        plainLoss.chargeId,
        'lost',
        plainLoss.purchase.id
      );
      await applyOutcome(plainLossId);
      const lostOn = takeFirst(
        await db
          .select({ at: disputes.lostAppliedAt })
          .from(disputes)
          .where(eq(disputes.stripeDisputeId, lateId))
      ).at;
      // The loss cancelled the organisation's unpaid share; the creator's
      // paid one was reversed when the chargeback opened.
      await db.insert(payoutReversals).values([
        {
          payoutId: late.org.id,
          causeType: 'dispute',
          causeId: lateId,
          amountCents: 135,
          kind: 'cancellation',
          status: 'done',
        },
        {
          payoutId: late.creator.id,
          causeType: 'dispute',
          causeId: lateId,
          amountCents: 765,
          kind: 'transfer_reversal',
          status: 'done',
        },
        {
          payoutId: normal.creator.id,
          causeType: 'dispute',
          causeId: normalId,
          amountCents: 765,
          kind: 'transfer_reversal',
          status: 'done',
        },
        {
          payoutId: plainLoss.org.id,
          causeType: 'dispute',
          causeId: plainLossId,
          amountCents: 135,
          kind: 'cancellation',
          status: 'done',
        },
        {
          payoutId: plainLoss.creator.id,
          causeType: 'dispute',
          causeId: plainLossId,
          amountCents: 765,
          kind: 'transfer_reversal',
          status: 'done',
        },
      ]);

      const lineOf = async (chargeId: string, payoutId: string) =>
        (await service.getChargeDetail(chargeId)).slices.find(
          (row) => row.payoutId === payoutId
        )?.history[0];

      expect(await lineOf(late.chargeId, late.org.id)).toMatchObject({
        causeId: lateId,
        lostOn: lostOn?.toISOString(),
        stepKind: 'cancellation',
      });
      expect(await lineOf(late.chargeId, late.creator.id)).toMatchObject({
        lostOn: lostOn?.toISOString(),
        stepKind: 'transfer_reversal',
      });
      const normalLine = await lineOf(normal.chargeId, normal.creator.id);
      expect(normalLine?.causeId).toBe(normalId);
      expect(normalLine).not.toHaveProperty('lostOn');
      expect(normalLine).not.toHaveProperty('stepKind');
      for (const payoutId of [plainLoss.org.id, plainLoss.creator.id]) {
        const lossLine = await lineOf(plainLoss.chargeId, payoutId);
        expect(lossLine?.causeId).toBe(plainLossId);
        expect(lossLine).not.toHaveProperty('lostOn');
        expect(lossLine).not.toHaveProperty('stepKind');
      }
    });
  });

  describe('owner Q7: a late-won payment stays refundable past the 14-day window', () => {
    it('the detail, the search and the route treat it as open once undone, and the refund is made', async () => {
      const { chargeId, purchase } = await purchaseCharge(30 * DAY);
      await lateWin(chargeId, purchase.id, { undone: true });

      const detail = await service.getChargeDetail(chargeId);
      const found = await service.searchCharges({
        lookup: purchase.id,
        page: 1,
        limit: 20,
      });
      const preview = await service.previewRefund(chargeId, 1000);
      const made = await service.issueRefund(
        chargeId,
        refundInput(1000),
        supportId
      );
      created.stripeRefundIds.push(made.refund.id);

      // Lifted: open, its 14-day date kept (and passed).
      const closesAt = new Date(
        ((fake.charges.get(chargeId)?.created ?? 0) + 14 * DAY) * 1000
      ).toISOString();
      expect(detail.window).toEqual({
        closesAt,
        isOpen: true,
        liftedByLateWin: true,
      });
      expect(detail.refundable).toEqual({
        maxCents: 1000,
        blocked: null,
        refundedOutsideStripeOn: null,
      });
      expect(found.items).toEqual([
        expect.objectContaining({
          chargeId,
          window: expect.objectContaining({
            isOpen: true,
            liftedByLateWin: true,
          }),
        }),
      ]);
      // Taken back from the creators like any refund: the engine's own plan.
      expect(preview.isFinal).toBe(true);
      expect(preview.payeesGiveBackCents).toBeGreaterThan(0);
      expect(made.refund.amountCents).toBe(1000);
      expect(fake.stripe.refunds.create).toHaveBeenCalledTimes(1);
    });

    it('a late win inside the 14 days lifts nothing: the window is open by itself', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      await lateWin(chargeId, purchase.id, { undone: true });

      const detail = await service.getChargeDetail(chargeId);
      const found = await service.searchCharges({
        lookup: purchase.id,
        page: 1,
        limit: 20,
      });

      expect(detail.window).toMatchObject({
        isOpen: true,
        liftedByLateWin: false,
      });
      expect(found.items[0]?.window).toMatchObject({
        isOpen: true,
        liftedByLateWin: false,
      });
    });

    it('a normal win, or none, past the 14 days is still closed everywhere', async () => {
      const won = await purchaseCharge(30 * DAY);
      const id = await dispute(won.chargeId, 'won', won.purchase.id);
      await applyOutcome(id);
      const plain = await purchaseCharge(30 * DAY);

      for (const { chargeId, purchase } of [won, plain]) {
        const detail = await service.getChargeDetail(chargeId);
        const found = await service.searchCharges({
          lookup: purchase.id,
          page: 1,
          limit: 20,
        });
        const route = await failureOf(
          service.issueRefund(chargeId, refundInput(100), supportId)
        );

        expect(detail.window).toMatchObject({
          isOpen: false,
          liftedByLateWin: false,
        });
        expect(detail.refundable.blocked).toBe('window_closed');
        expect(found.items[0]?.window).toMatchObject({
          isOpen: false,
          liftedByLateWin: false,
        });
        expect(route.context).toMatchObject({ code: 'REFUND_WINDOW_CLOSED' });
      }
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it("an invoice's late win lifts its search window too: the search reads it from the charge", async () => {
      const invoice = await invoiceCharge(30 * DAY);
      // The search dates an invoice from its slices: paid 30 days ago.
      await db
        .update(payouts)
        .set({ createdAt: new Date((nowSeconds() - 30 * DAY) * 1000) })
        .where(eq(payouts.stripeChargeId, invoice.chargeId));
      const search = async () =>
        (
          await service.searchCharges({
            lookup: invoice.subscription.stripeSubscriptionId,
            page: 1,
            limit: 20,
          })
        ).items.find((row) => row.chargeId === invoice.chargeId);
      const id = await dispute(invoice.chargeId, 'won');
      await applyOutcome(id);
      expect((await search())?.window).toMatchObject({
        isOpen: false,
        liftedByLateWin: false,
      });

      await db
        .update(disputes)
        .set({
          subscriptionId: invoice.subscription.id,
          lateWonAt: new Date(Date.now() - 2 * 60_000),
          lostAppliedAt: new Date(Date.now() - 20 * DAY * 1000),
        })
        .where(eq(disputes.stripeDisputeId, id));
      const detail = await service.getChargeDetail(invoice.chargeId);

      expect((await search())?.window).toMatchObject({
        isOpen: true,
        liftedByLateWin: true,
      });
      expect(detail.window.liftedByLateWin).toBe(true);
      expect(detail.refundable.blocked).toBeNull();
    });
  });

  describe('a charge settled by hand and refunded outside Stripe (owner decision 2026-11-08)', () => {
    /**
     * operations.md's settle of a late-win refund Stripe won't make: the
     * late win marked applied, and `refunded_outside_stripe_at` written with
     * it. The buyer is refunded another way, so Stripe never refunds it.
     */
    async function settledByHand(chargeId: string, purchaseId: string) {
      const late = await lateWin(chargeId, purchaseId, { undone: true });
      const at = new Date(Date.now() - 30_000);
      await db
        .update(disputes)
        .set({ refundedOutsideStripeAt: at })
        .where(eq(disputes.stripeDisputeId, late.id));
      return at;
    }

    it('past the 14 days: the late win lifts nothing, and the detail, the preview and the route all refuse it; nothing reaches Stripe', async () => {
      const { chargeId, purchase } = await purchaseCharge(30 * DAY);
      const at = await settledByHand(chargeId, purchase.id);

      const detail = await service.getChargeDetail(chargeId);
      const found = await service.searchCharges({
        lookup: purchase.id,
        page: 1,
        limit: 20,
      });
      const preview = await failureOf(service.previewRefund(chargeId, 100));
      const route = await failureOf(
        service.issueRefund(chargeId, refundInput(100), supportId)
      );

      expect(detail.refundable).toEqual({
        maxCents: 1000,
        blocked: 'refunded_outside_stripe',
        refundedOutsideStripeOn: at.toISOString(),
      });
      expect(detail.window).toMatchObject({
        isOpen: false,
        liftedByLateWin: false,
      });
      expect(found.items[0]?.window).toMatchObject({
        isOpen: false,
        liftedByLateWin: false,
      });
      for (const error of [preview, route]) {
        expect(error.statusCode).toBe(422);
        expect(error.context).toEqual({
          code: 'REFUNDED_OUTSIDE_STRIPE',
          refundedOutsideStripeAt: at.toISOString(),
        });
      }
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('inside the 14 days it still comes first: the open window offers nothing, and the route refuses', async () => {
      const { chargeId, purchase } = await purchaseCharge();
      const at = await settledByHand(chargeId, purchase.id);

      const detail = await service.getChargeDetail(chargeId);
      const route = await failureOf(
        service.issueRefund(chargeId, refundInput(100), supportId)
      );

      expect(detail.window.isOpen).toBe(true);
      expect(detail.refundable.blocked).toBe('refunded_outside_stripe');
      expect(detail.refundable.refundedOutsideStripeOn).toBe(at.toISOString());
      expect(route.context).toMatchObject({ code: 'REFUNDED_OUTSIDE_STRIPE' });
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it("an invoice's late win settled by hand lifts nothing on the search's invoice path either", async () => {
      const invoice = await invoiceCharge(30 * DAY);
      // The search dates an invoice from its slices: paid 30 days ago.
      await db
        .update(payouts)
        .set({ createdAt: new Date((nowSeconds() - 30 * DAY) * 1000) })
        .where(eq(payouts.stripeChargeId, invoice.chargeId));
      const id = await dispute(invoice.chargeId, 'won');
      await applyOutcome(id);
      const at = new Date(Date.now() - 30_000);
      await db
        .update(disputes)
        .set({
          subscriptionId: invoice.subscription.id,
          lateWonAt: new Date(Date.now() - 2 * 60_000),
          lostAppliedAt: new Date(Date.now() - 20 * DAY * 1000),
          refundedOutsideStripeAt: at,
        })
        .where(eq(disputes.stripeDisputeId, id));

      const found = (
        await service.searchCharges({
          lookup: invoice.subscription.stripeSubscriptionId,
          page: 1,
          limit: 20,
        })
      ).items.find((row) => row.chargeId === invoice.chargeId);
      const detail = await service.getChargeDetail(invoice.chargeId);

      expect(found?.window).toMatchObject({
        isOpen: false,
        liftedByLateWin: false,
      });
      expect(detail.window.liftedByLateWin).toBe(false);
      expect(detail.refundable.blocked).toBe('refunded_outside_stripe');
      expect(detail.refundable.refundedOutsideStripeOn).toBe(at.toISOString());
    });
  });

  // Owner D59-D61 (pause-trials/support-short-loss.html): a blocked payment
  // whose chargeback was lost for less than the payment leaves the buyer owed
  // the rest. Stripe won't refund a charged-back payment, so support pays it
  // another way and marks it on the charge page, which writes the charge's
  // `refunded_outside_stripe_at`; the hourly report then leaves it out.
  describe('a short lost chargeback, paid another way (owner D61, D63, D64)', () => {
    const SHORT_REPORT =
      'Blocked payments a lost chargeback refunded only in part: pay the rest another way, then mark it paid on the support charge page';
    const OWED_AGAIN_REPORT =
      'Blocked payments owed again after a late win: pay it another way, then mark it paid on the support charge page';

    // A buyer of their own: the email search further down reads the shared
    // buyer's 50 newest charges, and these are all newer.
    let lossBuyer: string;
    beforeAll(async () => {
      lossBuyer = takeFirst(await seedTestUsers(db, 1));
    });

    const purchaseService = () =>
      new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        fake.stripe
      );

    /**
     * A blocked payment of `kind` (`paidCents`, £10.00 unless given) whose
     * chargeback was lost for `lostCents`, the loss applied as the webhook
     * applies it. `beforeLoss` runs once the payment is blocked.
     */
    async function shortLoss(
      kind: 'unavailable' | 'duplicate' = 'unavailable',
      lostCents = 600,
      {
        paidCents = 1000,
        beforeLoss,
      }: {
        paidCents?: number;
        beforeLoss?: (
          sale: Awaited<ReturnType<typeof purchaseCharge>>
        ) => Promise<unknown>;
      } = {}
    ) {
      const sale = await purchaseCharge(3600, lossBuyer);
      const blocked =
        kind === 'unavailable'
          ? { refundReason: ITEM_UNAVAILABLE_REFUND_REASON }
          : {
              duplicateOfPurchaseId: (await purchaseCharge(3600, lossBuyer))
                .purchase.id,
            };
      await db
        .update(purchases)
        .set({
          status: PURCHASE_STATUS.PENDING,
          amountPaidCents: paidCents,
          // The split still adds up to what was paid (platform 100, org 135).
          creatorPayoutCents: paidCents - 235,
          ...blocked,
        })
        .where(eq(purchases.id, sale.purchase.id));
      const charge = fake.charges.get(sale.chargeId);
      if (charge) charge.amount = paidCents;
      await beforeLoss?.(sale);
      const disputeId = await dispute(sale.chargeId, 'lost', sale.purchase.id);
      await db
        .update(disputes)
        .set({ amountCents: lostCents })
        .where(eq(disputes.stripeDisputeId, disputeId));
      await purchaseService().processLostDispute(
        sale.paymentIntentId,
        lostCents,
        disputeId,
        { chargeId: sale.chargeId }
      );
      return { ...sale, disputeId };
    }

    async function markOf(stripeDisputeId: string) {
      return takeFirst(
        await db
          .select({ at: disputes.refundedOutsideStripeAt })
          .from(disputes)
          .where(eq(disputes.stripeDisputeId, stripeDisputeId))
      ).at;
    }

    /** Both marks: the first's amount, and the second's date. */
    async function marksOf(stripeDisputeId: string) {
      return takeFirst(
        await db
          .select({
            paidCents: disputes.paidAnotherWayCents,
            againAt: disputes.lateWinRefundedOutsideStripeAt,
          })
          .from(disputes)
          .where(eq(disputes.stripeDisputeId, stripeDisputeId))
      );
    }

    /** The mark's body, as the page sends it: what it showed owed, and paid another way so far. */
    const body = (
      stripeDisputeId: string,
      expectedOwedCents: number,
      stage: 'short' | 'owed_again' = 'short',
      expectedPaidAnotherWayCents: number | null = null
    ) => ({
      stripeDisputeId,
      expectedOwedCents,
      expectedPaidAnotherWayCents,
      stage,
    });

    /** A refund on the charge, as the refund webhook records it. */
    async function refundOn(
      sale: { chargeId: string; purchase: { id: string } },
      amountCents: number,
      status: 'succeeded' | 'pending'
    ) {
      const stripeRefundId = `re_sup${uid()}`;
      created.stripeRefundIds.push(stripeRefundId);
      await db.insert(refunds).values({
        stripeRefundId,
        stripeChargeId: sale.chargeId,
        purchaseId: sale.purchase.id,
        amountCents,
        currency: 'gbp',
        status,
        stripeCreatedAt: new Date(),
      });
      return stripeRefundId;
    }

    /**
     * The chargeback won late, as the webhook and the undo apply it: the
     * row moves lost to won, the purchase is restored (a blocked payment
     * stays refunded), and the late win's refund step runs, which makes no
     * refund on a charge marked paid another way (owner D62). Once the step
     * is done or has nothing to do, the outcome is marked, as the webhook
     * marks it (`mark: false` leaves the undo running, as a redelivery
     * before the mark finds it).
     */
    async function wonLate(
      sale: {
        chargeId: string;
        paymentIntentId: string;
        disputeId: string;
      },
      purchase = purchaseService(),
      { mark = true }: { mark?: boolean } = {}
    ) {
      const lost = takeFirst(
        await db
          .select()
          .from(disputes)
          .where(eq(disputes.stripeDisputeId, sale.disputeId))
      );
      await purchase.recordDispute({
        stripeDisputeId: sale.disputeId,
        stripeChargeId: sale.chargeId,
        paymentIntentId: sale.paymentIntentId,
        amountCents: lost.amountCents,
        currency: 'gbp',
        status: 'won',
        reason: lost.reason,
        stripeCreatedAt: lost.stripeCreatedAt,
      });
      await purchase.restoreAfterLateWin(sale.disputeId);
      const amountCents = fake.charges.get(sale.chargeId)?.amount ?? 0;
      const step = await purchase.refundFirstPaymentAfterLateWin(
        sale.disputeId,
        { id: sale.chargeId, amountCents },
        'test'
      );
      if (mark && step !== 'pending') {
        await purchase.markDisputeOutcomeApplied(sale.disputeId, {
          status: 'won',
        });
      }
      return step;
    }

    /** What the hourly report's `line` names after one sweep. */
    async function reportedOwed(
      line: string
    ): Promise<Array<{ stripePaymentIntentId: string; owedCents: number }>> {
      const purchase = purchaseService();
      const errors = vi.spyOn(
        (
          purchase as unknown as {
            obs: { error: (message: string, meta?: object) => void };
          }
        ).obs,
        'error'
      );
      await purchase.settleOwedDuplicates({ olderThanMs: 0, limit: 100_000 });
      return errors.mock.calls
        .filter(([message]) => message === line)
        .flatMap(
          ([, meta]) =>
            (
              meta as {
                owed: Array<{
                  stripePaymentIntentId: string;
                  owedCents: number;
                }>;
              }
            ).owed
        );
    }

    /** What the hourly report names, by PaymentIntent, after one sweep. */
    async function reported(): Promise<string[]> {
      const purchase = purchaseService();
      const errors = vi.spyOn(
        (
          purchase as unknown as {
            obs: { error: (message: string, meta?: object) => void };
          }
        ).obs,
        'error'
      );
      await purchase.settleOwedDuplicates({ olderThanMs: 0, limit: 100_000 });
      return errors.mock.calls
        .filter(([message]) => message === SHORT_REPORT)
        .flatMap(([, meta]) =>
          (meta as { owed: Array<{ stripePaymentIntentId: string }> }).owed.map(
            (entry) => entry.stripePaymentIntentId
          )
        );
    }

    it.each([
      'unavailable',
      'duplicate',
    ] as const)('the charge page learns what is still owed from the charge read (%s)', async (kind) => {
      const { chargeId, disputeId } = await shortLoss(kind);

      const detail = await service.getChargeDetail(chargeId);

      expect(detail.shortLoss).toEqual({
        stage: 'short',
        stripeDisputeId: disputeId,
        kind,
        lostCents: 600,
        refundedThroughStripeCents: 0,
        refundedElsewhereCents: 0,
        paidAnotherWayCents: null,
        paidAnotherWayOn: null,
        owedCents: 400,
      });
      // The lost chargeback still blocks a Stripe refund until it is marked.
      expect(detail.refundable).toMatchObject({
        blocked: 'chargeback',
        refundedOutsideStripeOn: null,
      });
    });

    it('a sale lost short, or a blocked payment lost in full, is no short loss', async () => {
      const sale = await purchaseCharge(3600, lossBuyer);
      const saleDispute = await dispute(
        sale.chargeId,
        'lost',
        sale.purchase.id
      );
      await db
        .update(disputes)
        .set({ amountCents: 600 })
        .where(eq(disputes.stripeDisputeId, saleDispute));
      await purchaseService().processLostDispute(
        sale.paymentIntentId,
        600,
        saleDispute,
        { chargeId: sale.chargeId }
      );
      const full = await shortLoss('unavailable', 1000);

      expect(
        (await service.getChargeDetail(sale.chargeId)).shortLoss
      ).toBeNull();
      expect(
        (await service.getChargeDetail(full.chargeId)).shortLoss
      ).toBeNull();
    });

    it('marks it: the date and what it paid are written, the page shows it paid another way and blocked from Stripe, and who marked it is logged', async () => {
      const { chargeId, disputeId, purchase } = await shortLoss();
      const info = vi.spyOn(
        (service as unknown as { obs: { info: (...a: unknown[]) => void } })
          .obs,
        'info'
      );

      const result = await service.markPaidAnotherWay(
        chargeId,
        body(disputeId, 400),
        supportId
      );

      const at = await markOf(disputeId);
      expect(at).toBeInstanceOf(Date);
      expect(await marksOf(disputeId)).toEqual({
        paidCents: 400,
        againAt: null,
      });
      expect(result).toEqual({
        chargeId,
        stripeDisputeId: disputeId,
        stage: 'short',
        owedCents: 400,
        paidAnotherWayOn: at?.toISOString(),
        alreadyMarked: false,
      });
      // Nothing is owed now, and the page shows what was paid.
      const detail = await service.getChargeDetail(chargeId);
      expect(detail.shortLoss).toEqual({
        stage: 'short',
        stripeDisputeId: disputeId,
        kind: 'unavailable',
        lostCents: 600,
        refundedThroughStripeCents: 0,
        refundedElsewhereCents: 0,
        paidAnotherWayCents: 400,
        paidAnotherWayOn: at?.toISOString(),
        owedCents: 0,
      });
      expect(detail.refundable).toMatchObject({
        blocked: 'refunded_outside_stripe',
        refundedOutsideStripeOn: at?.toISOString(),
      });
      expect(info).toHaveBeenCalledWith(
        'A short lost chargeback was marked paid another way',
        {
          chargeId,
          disputeId,
          purchaseId: purchase.id,
          stage: 'short',
          owedCents: 400,
          paidBeforeCents: null,
          markedByUserId: supportId,
        }
      );
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('a repeat is a success that changes nothing: the first date stands', async () => {
      const { chargeId, disputeId } = await shortLoss();
      const input = body(disputeId, 400);
      const first = await service.markPaidAnotherWay(
        chargeId,
        input,
        supportId
      );
      const at = await markOf(disputeId);

      const again = await service.markPaidAnotherWay(
        chargeId,
        input,
        supportId
      );

      expect(again).toEqual({ ...first, alreadyMarked: true, owedCents: null });
      expect(await markOf(disputeId)).toEqual(at);
      expect((await marksOf(disputeId)).paidCents).toBe(400);
    });

    // Review r5 (nit): a repeat after a refund came to stand found nothing
    // owed and answered 422 not_short, though it had been marked.
    it('a repeat after a refund has since stood is still a success: the mark is read first', async () => {
      const sale = await shortLoss();
      const input = body(sale.disputeId, 400);
      const first = await service.markPaidAnotherWay(
        sale.chargeId,
        input,
        supportId
      );
      await refundOn(sale, 400, 'succeeded');

      const again = await service.markPaidAnotherWay(
        sale.chargeId,
        input,
        supportId
      );

      expect(again).toEqual({ ...first, alreadyMarked: true, owedCents: null });
    });

    it.each([
      ['what is owed moved', (id: string) => body(id, 500)],
      ['another dispute', () => body(`du_sup${uid()}`, 400)],
      ['the stage moved', (id: string) => body(id, 400, 'owed_again')],
    ])('not what the page showed (%s): 412 SHORT_LOSS_CHANGED with what is owed now and its stage, and nothing marked', async (_what, input) => {
      const { chargeId, disputeId } = await shortLoss();

      const error = await failureOf(
        service.markPaidAnotherWay(chargeId, input(disputeId), supportId)
      );

      expect(error.statusCode).toBe(412);
      expect(error.context).toEqual({
        code: 'SHORT_LOSS_CHANGED',
        owedCents: 400,
        stage: 'short',
      });
      expect(await markOf(disputeId)).toBeNull();
      expect(await marksOf(disputeId)).toEqual({
        paidCents: null,
        againAt: null,
      });
    });

    it('nothing owed after a loss: 422 NOT_OWED_AFTER_LOSS with each reason, and nothing marked', async () => {
      // No lost chargeback: an open one.
      const open = await purchaseCharge(3600, lossBuyer);
      const openDispute = await dispute(
        open.chargeId,
        'needs_response',
        open.purchase.id
      );
      // Not a blocked payment: a sale lost short keeps the bank's decision.
      const sale = await purchaseCharge(3600, lossBuyer);
      const saleDispute = await dispute(
        sale.chargeId,
        'lost',
        sale.purchase.id
      );
      await db
        .update(disputes)
        .set({ amountCents: 600 })
        .where(eq(disputes.stripeDisputeId, saleDispute));
      await purchaseService().processLostDispute(
        sale.paymentIntentId,
        600,
        saleDispute,
        { chargeId: sale.chargeId }
      );
      // Not short: a blocked payment lost in full.
      const full = await shortLoss('unavailable', 1000);

      for (const [chargeId, disputeId, reason] of [
        [open.chargeId, openDispute, 'no_lost_dispute'],
        [sale.chargeId, saleDispute, 'not_blocked'],
        [full.chargeId, full.disputeId, 'not_short'],
      ] as const) {
        const error = await failureOf(
          service.markPaidAnotherWay(chargeId, body(disputeId, 400), supportId)
        );
        expect(error.statusCode, reason).toBe(422);
        expect(error.context, reason).toEqual({
          code: 'NOT_OWED_AFTER_LOSS',
          reason,
        });
        expect(await markOf(disputeId), reason).toBeNull();
      }
    });

    it('a charge Stripe holds no record of: 404, and nothing is read or written', async () => {
      const error = await failureOf(
        service.markPaidAnotherWay(
          `ch_sup${uid()}missing`,
          body(`du_sup${uid()}`, 400),
          supportId
        )
      );

      expect(error.statusCode).toBe(404);
    });

    it('a short loss on another charge is untouched by the mark', async () => {
      const marked = await shortLoss();
      const other = await shortLoss();

      await service.markPaidAnotherWay(
        marked.chargeId,
        body(marked.disputeId, 400),
        supportId
      );

      expect(await markOf(marked.disputeId)).toBeInstanceOf(Date);
      expect(await markOf(other.disputeId)).toBeNull();
      expect(
        (await service.getChargeDetail(other.chargeId)).shortLoss
      ).toMatchObject({
        paidAnotherWayOn: null,
      });
    });

    // Review r4 (HIGH): the hourly report could never be cleared. End to end:
    // the support action, then the purchase package's own sweep.
    it('the hourly report names it until support marks it paid another way, and never again after', async () => {
      const { chargeId, disputeId, paymentIntentId } = await shortLoss();
      expect(await reported()).toContain(paymentIntentId);

      await service.markPaidAnotherWay(
        chargeId,
        body(disputeId, 400),
        supportId
      );

      expect(await reported()).not.toContain(paymentIntentId);
      expect(await reported()).not.toContain(paymentIntentId);
    });

    // Owner D63, D64, END TO END: £15.00 paid, the £10.00 chargeback lost,
    // £5.00 paid another way and marked; then the chargeback is won late, so
    // the bank takes the £10.00 back from the buyer and no refund is made
    // (D62). The buyer is owed £10.00 again (1500 - 0 - 500), on the hourly
    // report and the charge page, until support marks it a second time.
    it('owed again after a late win: reported and shown until the second mark, and never again after', async () => {
      const sale = await shortLoss('unavailable', 1000, { paidCents: 1500 });
      expect(
        (await reportedOwed(SHORT_REPORT)).filter(
          (entry) => entry.stripePaymentIntentId === sale.paymentIntentId
        )
      ).toEqual([expect.objectContaining({ owedCents: 500 })]);
      const first = await service.markPaidAnotherWay(
        sale.chargeId,
        body(sale.disputeId, 500),
        supportId
      );

      expect(await wonLate(sale)).toBe('none');
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();

      const mine = async (line: string) =>
        (await reportedOwed(line)).filter(
          (entry) => entry.stripePaymentIntentId === sale.paymentIntentId
        );
      expect(await mine(SHORT_REPORT)).toEqual([]);
      expect(await mine(OWED_AGAIN_REPORT)).toEqual([
        expect.objectContaining({ owedCents: 1000 }),
      ]);
      const owedAgain = (await service.getChargeDetail(sale.chargeId))
        .shortLoss;
      expect(owedAgain).toEqual({
        stage: 'owed_again',
        stripeDisputeId: sale.disputeId,
        kind: 'unavailable',
        lostCents: 1000,
        paidAnotherWayCents: 500,
        paidAnotherWayOn: first.paidAnotherWayOn,
        lateWonOn: expect.any(String),
        refundedThroughStripeCents: 0,
        refundedElsewhereCents: 0,
        owedCents: 1000,
        paidAgainOn: null,
      });

      const second = await service.markPaidAnotherWay(
        sale.chargeId,
        body(sale.disputeId, 1000, 'owed_again', 500),
        supportId
      );

      const { againAt, paidCents } = await marksOf(sale.disputeId);
      expect(againAt).toBeInstanceOf(Date);
      // The second mark adds what it paid (owner D66): everything paid another way.
      expect(paidCents).toBe(1500);
      expect(second).toEqual({
        chargeId: sale.chargeId,
        stripeDisputeId: sale.disputeId,
        stage: 'owed_again',
        owedCents: 1000,
        paidAnotherWayOn: againAt?.toISOString(),
        alreadyMarked: false,
      });
      expect(await mine(OWED_AGAIN_REPORT)).toEqual([]);
      expect(await mine(OWED_AGAIN_REPORT)).toEqual([]);
      expect(await mine(SHORT_REPORT)).toEqual([]);
      expect(
        (await service.getChargeDetail(sale.chargeId)).shortLoss
      ).toMatchObject({
        stage: 'owed_again',
        paidAnotherWayCents: 1500,
        owedCents: 0,
        paidAgainOn: againAt?.toISOString(),
      });
      // The first mark's date stands: the charge stays blocked from Stripe.
      expect(await markOf(sale.disputeId)).toEqual(
        new Date(first.paidAnotherWayOn)
      );

      // A repeat of either mark changes nothing.
      expect(
        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 1000, 'owed_again', 500),
          supportId
        )
      ).toEqual({ ...second, alreadyMarked: true, owedCents: null });
      expect(
        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 500),
          supportId
        )
      ).toEqual({ ...first, alreadyMarked: true, owedCents: null });
      expect(await marksOf(sale.disputeId)).toEqual({
        paidCents: 1500,
        againAt,
      });
    });

    // Owner D64: ONE count, paid - refunded through Stripe - paid another
    // way - the chargeback while it stands lost. A refund that stood at the
    // first mark and then failed stops standing, so what is owed rises by it.
    it.each([
      {
        what: 'a £3.00 refund through Stripe after the first mark',
        before: null,
        after: 'succeeded' as const,
        paid: 500,
        refunded: 300,
        owed: 700,
      },
      {
        what: 'a £3.00 refund before the loss',
        before: 'succeeded' as const,
        after: null,
        paid: 200,
        refunded: 300,
        owed: 1000,
      },
      {
        what: 'a £3.00 refund pending at the first mark, which then fails',
        before: 'pending' as const,
        after: null,
        paid: 200,
        refunded: 0,
        owed: 1300,
      },
    ])('owed again counts every refund standing now ($what): $owed', async ({
      before,
      after,
      paid,
      refunded,
      owed,
    }) => {
      let refundId: string | undefined;
      const sale = await shortLoss('duplicate', 1000, {
        paidCents: 1500,
        beforeLoss: async (charge) => {
          if (before) refundId = await refundOn(charge, 300, before);
        },
      });
      const short = (await service.getChargeDetail(sale.chargeId)).shortLoss;
      expect(short).toMatchObject({ stage: 'short', owedCents: paid });
      await service.markPaidAnotherWay(
        sale.chargeId,
        body(sale.disputeId, paid),
        supportId
      );
      expect((await marksOf(sale.disputeId)).paidCents).toBe(paid);
      if (after) await refundOn(sale, 300, after);
      if (before === 'pending' && refundId) {
        await db
          .update(refunds)
          .set({ status: 'failed' })
          .where(eq(refunds.stripeRefundId, refundId));
      }

      await wonLate(sale);

      expect(
        (await service.getChargeDetail(sale.chargeId)).shortLoss
      ).toMatchObject({
        stage: 'owed_again',
        kind: 'duplicate',
        paidAnotherWayCents: paid,
        refundedThroughStripeCents: refunded,
        owedCents: owed,
        paidAgainOn: null,
      });
      expect(
        (await reportedOwed(OWED_AGAIN_REPORT)).filter(
          (entry) => entry.stripePaymentIntentId === sale.paymentIntentId
        )
      ).toEqual([expect.objectContaining({ owedCents: owed })]);
    });

    it('owed again, then refunded through Stripe in full: nothing is owed, 422 not_short, and nothing marked', async () => {
      const sale = await shortLoss('unavailable', 1000, { paidCents: 1500 });
      await service.markPaidAnotherWay(
        sale.chargeId,
        body(sale.disputeId, 500),
        supportId
      );
      await wonLate(sale);
      await refundOn(sale, 1000, 'succeeded');

      const error = await failureOf(
        service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 1000, 'owed_again', 500),
          supportId
        )
      );

      expect(error.statusCode).toBe(422);
      expect(error.context).toEqual({
        code: 'NOT_OWED_AFTER_LOSS',
        reason: 'not_short',
      });
      expect((await marksOf(sale.disputeId)).againAt).toBeNull();
      expect(
        (await service.getChargeDetail(sale.chargeId)).shortLoss
      ).toBeNull();
    });

    // Owner D66, D67, D72, END TO END: a blocked payment's refund debt shows
    // on ONE surface. While its chargeback is open, its failed refund waits
    // in the queue (counted) with no settle; once the chargeback is lost it
    // leaves the queue and both counts, and what is still owed is the charge
    // page's alone, by the one count (standing, or failed and settled
    // refunded elsewhere, on the charge), where each mark ADDS.
    describe('one debt, one surface (owner D66, D67, D72)', () => {
      /** A failed refund on the sale, as the refund webhook records it. */
      async function failedOn(
        sale: { chargeId: string; purchase: { id: string } },
        amountCents: number
      ) {
        const stripeRefundId = `re_sup${uid()}`;
        created.stripeRefundIds.push(stripeRefundId);
        return takeFirst(
          await db
            .insert(refunds)
            .values({
              stripeRefundId,
              stripeChargeId: sale.chargeId,
              purchaseId: sale.purchase.id,
              amountCents,
              currency: 'gbp',
              status: 'failed',
              failureReason: 'charge_for_pending_refund_disputed',
              stripeCreatedAt: new Date(),
            })
            .returning()
        );
      }

      /** A refund Stripe now reports failed. */
      async function fails(stripeRefundId: string) {
        await db
          .update(refunds)
          .set({ status: 'failed', failureReason: 'expired_or_canceled_card' })
          .where(eq(refunds.stripeRefundId, stripeRefundId));
      }

      /** The queue row of `refundId`, read page by page; undefined if it isn't listed. */
      async function queueRowOf(refundId: string) {
        for (let page = 1; ; page++) {
          const list = await service.listFailedRefunds({ page, limit: 50 });
          const found = list.items.find((item) => item.refundId === refundId);
          if (found || page >= list.pagination.totalPages) return found;
        }
      }

      const failedCount = async () =>
        (await service.getQueueCounts()).failedRefunds;

      const settleElsewhere = (refundId: string) =>
        service.resolveFailedRefund(
          refundId,
          { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
          supportId
        );

      async function resolutionOf(refundId: string) {
        return takeFirst(
          await db
            .select({ resolution: refunds.resolution })
            .from(refunds)
            .where(eq(refunds.id, refundId))
        ).resolution;
      }

      const owedOn = async (paymentIntentId: string, line: string) =>
        (await reportedOwed(line)).filter(
          (entry) => entry.stripePaymentIntentId === paymentIntentId
        );

      /**
       * Ordering a's start: a £15.00 blocked sale refunded in full at once
       * (so `refunded`, as `refundBlockedPayment` leaves it), whose refund
       * failed when the buyer opened a £10.00 chargeback while it was
       * pending. The chargeback is open.
       */
      async function failedThenDisputed() {
        const sale = await purchaseCharge(3600, lossBuyer);
        await db
          .update(purchases)
          .set({
            status: PURCHASE_STATUS.REFUNDED,
            refundedAt: new Date(),
            refundAmountCents: 1500,
            amountPaidCents: 1500,
            creatorPayoutCents: 1500 - 235,
            refundReason: ITEM_UNAVAILABLE_REFUND_REASON,
          })
          .where(eq(purchases.id, sale.purchase.id));
        const charge = fake.charges.get(sale.chargeId);
        if (charge) charge.amount = 1500;
        const refund = await failedOn(sale, 1500);
        const disputeId = await dispute(
          sale.chargeId,
          'needs_response',
          sale.purchase.id
        );
        return { ...sale, refund, disputeId };
      }

      /** The open chargeback decided `status` (`won` in time, or `lost` and applied). */
      async function decide(
        sale: { chargeId: string; paymentIntentId: string; disputeId: string },
        status: 'won' | 'lost'
      ) {
        await db
          .update(disputes)
          .set({ status })
          .where(eq(disputes.stripeDisputeId, sale.disputeId));
        if (status === 'lost') {
          await purchaseService().processLostDispute(
            sale.paymentIntentId,
            1000,
            sale.disputeId,
            { chargeId: sale.chargeId }
          );
        }
      }

      it("a: while the chargeback is open, the failed refund waits in the queue, counted, and can't be settled; once lost it leaves the queue and both counts, and the charge page alone asks for the £5.00", async () => {
        const sale = await failedThenDisputed();

        expect(
          (await queueRowOf(sale.refund.id))?.waitingForChargeback
        ).toEqual({
          stripeDisputeId: sale.disputeId,
          openedOn: expect.any(String),
        });
        const waitingCount = await failedCount();
        // b, while it is open: refused, and nothing settled.
        const open = await failureOf(settleElsewhere(sale.refund.id));
        expect(open.statusCode).toBe(422);
        expect(open.context).toEqual({
          code: 'REFUND_DECIDED_BY_CHARGEBACK',
          reason: 'chargeback_open',
          chargeId: sale.chargeId,
        });
        expect(await resolutionOf(sale.refund.id)).toBeNull();
        // The bank hasn't decided, so the charge page owes nothing yet.
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toBeNull();

        await decide(sale, 'lost');

        expect(await queueRowOf(sale.refund.id)).toBeUndefined();
        expect(await failedCount()).toBe(waitingCount - 1);
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({
          stage: 'short',
          refundedThroughStripeCents: 0,
          refundedElsewhereCents: 0,
          paidAnotherWayCents: null,
          owedCents: 500,
        });
        expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([
          expect.objectContaining({ owedCents: 500 }),
        ]);
        // b, after the loss: refused with the charge, so £15.00 is never
        // recorded against a £5.00 debt.
        const lost = await failureOf(settleElsewhere(sale.refund.id));
        expect(lost.context).toEqual({
          code: 'REFUND_DECIDED_BY_CHARGEBACK',
          reason: 'chargeback_lost',
          chargeId: sale.chargeId,
        });
        expect(await resolutionOf(sale.refund.id)).toBeNull();

        // One mark clears the one debt everywhere.
        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 500),
          supportId
        );
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({ owedCents: 0, paidAnotherWayCents: 500 });
        expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([]);
        expect(await queueRowOf(sale.refund.id)).toBeUndefined();
      });

      it('won in time: the failed refund no longer waits, and is settled as before', async () => {
        const sale = await failedThenDisputed();

        await decide(sale, 'won');

        expect(
          (await queueRowOf(sale.refund.id))?.waitingForChargeback
        ).toBeNull();
        const settled = await settleElsewhere(sale.refund.id);
        expect(settled.settled.resolution).toBe('refunded_elsewhere');
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toBeNull();
      });

      it('c, d: a part refund pending at the loss fails after it, so the charge page asks for it, not the queue; marked, then won late, it is owed again and marked again, each mark adding', async () => {
        let pending = '';
        const sale = await shortLoss('unavailable', 1000, {
          paidCents: 1500,
          beforeLoss: async (charge) => {
            pending = await refundOn(charge, 500, 'pending');
          },
        });
        // The pending £5.00 counts: nothing is owed at the loss.
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toBeNull();

        await fails(pending);

        const failedRow = takeFirst(
          await db
            .select({ id: refunds.id })
            .from(refunds)
            .where(eq(refunds.stripeRefundId, pending))
        );
        expect(await queueRowOf(failedRow.id)).toBeUndefined();
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({ stage: 'short', owedCents: 500 });
        expect(
          (await failureOf(settleElsewhere(failedRow.id))).context
        ).toMatchObject({ reason: 'chargeback_lost' });

        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 500),
          supportId
        );
        expect(await wonLate(sale)).toBe('none');

        // d: the bank took the £10.00 back; £15.00 - £5.00 is owed again.
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({
          stage: 'owed_again',
          paidAnotherWayCents: 500,
          owedCents: 1000,
        });
        expect(await queueRowOf(failedRow.id)).toBeUndefined();
        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 1000, 'owed_again', 500),
          supportId
        );
        expect((await marksOf(sale.disputeId)).paidCents).toBe(1500);
        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({ stage: 'owed_again', owedCents: 0 });
        expect(await owedOn(sale.paymentIntentId, OWED_AGAIN_REPORT)).toEqual(
          []
        );
      });

      // Ordering e (mockup B4): a refund that counted at the first mark
      // fails after it. The short stage shows again, a mark at the same
      // stage adds and keeps the first date (D71), and a retry of a mark
      // whose total has moved never adds twice.
      it('e: a refund that fails after the first mark is owed again at the same stage; each mark adds and keeps the first date, and a stale retry is a 412', async () => {
        let three = '';
        let one = '';
        const sale = await shortLoss('unavailable', 1000, {
          paidCents: 1500,
          beforeLoss: async (charge) => {
            three = await refundOn(charge, 300, 'pending');
            one = await refundOn(charge, 100, 'pending');
          },
        });
        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 100),
          supportId
        );
        const first = await markOf(sale.disputeId);

        await fails(three);

        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({
          stage: 'short',
          paidAnotherWayCents: 100,
          paidAnotherWayOn: first?.toISOString(),
          owedCents: 300,
        });
        expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([
          expect.objectContaining({ owedCents: 300 }),
        ]);
        const adding = body(sale.disputeId, 300, 'short', 100);
        const added = await service.markPaidAnotherWay(
          sale.chargeId,
          adding,
          supportId
        );
        expect(added).toMatchObject({
          alreadyMarked: false,
          owedCents: 300,
          paidAnotherWayOn: first?.toISOString(),
        });
        expect((await marksOf(sale.disputeId)).paidCents).toBe(400);
        expect(await markOf(sale.disputeId)).toEqual(first);
        // A retry after a lost answer, nothing more owed: a repeat.
        expect(
          await service.markPaidAnotherWay(sale.chargeId, adding, supportId)
        ).toMatchObject({ alreadyMarked: true, owedCents: null });

        await fails(one);

        // The same retry now, with £1.00 more owed: its total moved, so 412,
        // and nothing is added.
        const stale = await failureOf(
          service.markPaidAnotherWay(sale.chargeId, adding, supportId)
        );
        expect(stale.statusCode).toBe(412);
        expect(stale.context).toEqual({
          code: 'SHORT_LOSS_CHANGED',
          owedCents: 100,
          stage: 'short',
        });
        expect((await marksOf(sale.disputeId)).paidCents).toBe(400);
        await service.markPaidAnotherWay(
          sale.chargeId,
          body(sale.disputeId, 100, 'short', 400),
          supportId
        );
        expect((await marksOf(sale.disputeId)).paidCents).toBe(500);
        expect(await markOf(sale.disputeId)).toEqual(first);
        expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([]);
      });

      // Mockup B3: a failed refund support settled refunded another way
      // before the chargeback counts, and the page names it.
      it('a refund settled refunded elsewhere before the chargeback counts, and the page names it', async () => {
        const sale = await shortLoss('unavailable', 1000, {
          paidCents: 1500,
          beforeLoss: async (charge) => {
            const refund = await failedOn(charge, 300);
            await db
              .update(refunds)
              .set({
                resolution: 'refunded_elsewhere',
                resolvedAt: new Date(),
                resolvedByUserId: supportId,
              })
              .where(eq(refunds.id, refund.id));
          },
        });

        expect(
          (await service.getChargeDetail(sale.chargeId)).shortLoss
        ).toMatchObject({
          stage: 'short',
          refundedThroughStripeCents: 0,
          refundedElsewhereCents: 300,
          owedCents: 200,
        });
      });

      /** What the charge page shows owed, at its stage; null for none. */
      const stageOf = async (chargeId: string) =>
        (await service.getChargeDetail(chargeId)).shortLoss;

      // Review r7: a failed refund leaves the queue ONLY where a stage
      // carries its debt (`chargebackCarriesRefund`, the rule the stages are
      // built from). After a late win with no mark, or one whose own refund
      // was made, the chargeback no longer overlaps any refund, so a refund
      // that fails after it is owed exactly its own amount, in the queue, and
      // no stage shows: the debt is in exactly one place.
      describe('a refund that fails after a late win (review r7)', () => {
        it('a late win with no mark refunds nothing (the refund counted); once it fails it is back in the queue with its settle, and no stage shows', async () => {
          let counted = '';
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              counted = await refundOn(charge, 1500, 'pending');
            },
          });
          expect(await wonLate(sale)).toBe('none');
          const before = await failedCount();

          await fails(counted);

          const row = takeFirst(
            await db
              .select({ id: refunds.id })
              .from(refunds)
              .where(eq(refunds.stripeRefundId, counted))
          );
          expect((await queueRowOf(row.id))?.waitingForChargeback).toBeNull();
          expect(await failedCount()).toBe(before + 1);
          expect(await stageOf(sale.chargeId)).toBeNull();
          expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([]);
          expect(await owedOn(sale.paymentIntentId, OWED_AGAIN_REPORT)).toEqual(
            []
          );
          const settled = await settleElsewhere(row.id);
          expect(settled.settled.resolution).toBe('refunded_elsewhere');
        });

        it('a late win whose own refund was made: an earlier refund that counted fails, and it is in the queue with its settle, and no stage shows', async () => {
          let earlier = '';
          const sale = await shortLoss('unavailable', 1000, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              earlier = await refundOn(charge, 500, 'succeeded');
            },
          });
          // £15.00 less the £5.00 that counted: the late win refunds £10.00.
          expect(await wonLate(sale)).toBe('done');
          const { lateWinRefundId } = takeFirst(
            await db
              .select({ lateWinRefundId: disputes.lateWinRefundId })
              .from(disputes)
              .where(eq(disputes.stripeDisputeId, sale.disputeId))
          );
          if (!lateWinRefundId) throw new Error('the late win made no refund');
          // Recorded by the late win's sync: cleaned up with the rest.
          created.stripeRefundIds.push(lateWinRefundId);
          expect(
            takeFirst(
              await db
                .select({ amountCents: refunds.amountCents })
                .from(refunds)
                .where(eq(refunds.stripeRefundId, lateWinRefundId))
            ).amountCents
          ).toBe(1000);

          await fails(earlier);

          const row = takeFirst(
            await db
              .select({ id: refunds.id })
              .from(refunds)
              .where(eq(refunds.stripeRefundId, earlier))
          );
          expect((await queueRowOf(row.id))?.waitingForChargeback).toBeNull();
          expect(await stageOf(sale.chargeId)).toBeNull();
          const settled = await settleElsewhere(row.id);
          expect(settled.settled.resolution).toBe('refunded_elsewhere');
        });

        it('a marked late win (owed again) still carries it: hidden from the queue, refused there, and the stage shows it', async () => {
          let pending = '';
          const sale = await shortLoss('unavailable', 1000, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              pending = await refundOn(charge, 300, 'pending');
            },
          });
          await service.markPaidAnotherWay(
            sale.chargeId,
            body(sale.disputeId, 200),
            supportId
          );
          expect(await wonLate(sale)).toBe('none');
          expect(await stageOf(sale.chargeId)).toMatchObject({
            stage: 'owed_again',
            owedCents: 1000,
          });

          await fails(pending);

          const row = takeFirst(
            await db
              .select({ id: refunds.id })
              .from(refunds)
              .where(eq(refunds.stripeRefundId, pending))
          );
          expect(await queueRowOf(row.id)).toBeUndefined();
          expect(
            (await failureOf(settleElsewhere(row.id))).context
          ).toMatchObject({ reason: 'chargeback_lost' });
          expect(await stageOf(sale.chargeId)).toMatchObject({
            stage: 'owed_again',
            owedCents: 1300,
          });
        });
      });

      // Review r8 (owner D73-D75): a refund of everything owed COVERS the
      // failed refunds it included (`covered_by_refund`), so none of them
      // comes back to the queue and a settle can't pay the buyer twice. Only
      // a refund failing AFTER it is owed. Each ordering leaves every pound
      // in exactly one place: the covering refund, a queue row, or a stage.
      describe('a refund of everything owed covers the failed refunds it included (owner D73, review r8)', () => {
        /** A refund that failed at Stripe: listed there, and recorded. */
        async function failedAt(
          sale: { chargeId: string; purchase: { id: string } },
          amountCents: number
        ) {
          const listed = stripeRefund(sale.chargeId, amountCents, {
            status: 'failed',
            failure_reason: 'expired_or_canceled_card',
          });
          return takeFirst(
            await db
              .insert(refunds)
              .values({
                stripeRefundId: listed.id,
                stripeChargeId: sale.chargeId,
                purchaseId: sale.purchase.id,
                amountCents,
                currency: 'gbp',
                status: 'failed',
                failureReason: 'expired_or_canceled_card',
                stripeCreatedAt: new Date(),
              })
              .returning()
          );
        }

        async function coverOf(id: string) {
          return takeFirst(
            await db
              .select({
                resolution: refunds.resolution,
                coveredBy: refunds.coveredByRefundId,
                resolvedBy: refunds.resolvedByUserId,
              })
              .from(refunds)
              .where(eq(refunds.id, id))
          );
        }

        const covered = (by: string) => ({
          resolution: 'covered_by_refund',
          coveredBy: by,
          resolvedBy: null,
        });

        /** The late win's own refund id, recorded by its sync. */
        async function lateWinRefundOf(stripeDisputeId: string) {
          const { lateWinRefundId } = takeFirst(
            await db
              .select({ lateWinRefundId: disputes.lateWinRefundId })
              .from(disputes)
              .where(eq(disputes.stripeDisputeId, stripeDisputeId))
          );
          if (!lateWinRefundId) throw new Error('the late win made no refund');
          created.stripeRefundIds.push(lateWinRefundId);
          return lateWinRefundId;
        }

        const amountOf = async (stripeRefundId: string) =>
          takeFirst(
            await db
              .select({ amountCents: refunds.amountCents })
              .from(refunds)
              .where(eq(refunds.stripeRefundId, stripeRefundId))
          ).amountCents;

        const rowIdOf = async (stripeRefundId: string) =>
          takeFirst(
            await db
              .select({ id: refunds.id })
              .from(refunds)
              .where(eq(refunds.stripeRefundId, stripeRefundId))
          ).id;

        /** The Refunds card's row of the refund, on the charge page. */
        const cardRowOf = async (chargeId: string, stripeRefundId: string) =>
          (await service.getChargeDetail(chargeId)).refunds.find(
            (row) => row.id === stripeRefundId
          );

        /** Owed nowhere: none of the refunds is listed, no stage shows, no report names the payment. */
        async function owedNowhere(
          sale: { chargeId: string; paymentIntentId: string },
          refundIds: string[]
        ) {
          for (const id of refundIds) {
            expect(await queueRowOf(id)).toBeUndefined();
          }
          expect(await stageOf(sale.chargeId)).toBeNull();
          expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([]);
          expect(await owedOn(sale.paymentIntentId, OWED_AGAIN_REPORT)).toEqual(
            []
          );
        }

        /** A purchase service whose error lines are spied on. */
        function spied() {
          const purchase = purchaseService();
          const errors = vi.spyOn(
            (
              purchase as unknown as {
                obs: { error: (message: string, meta?: object) => void };
              }
            ).obs,
            'error'
          );
          return { purchase, errors };
        }

        it('1: a blocked £15.00 whose refund failed, lost in full, won late with no mark: the late win refunds £15.00 and covers it, so it is owed nowhere and the charge page shows it "Covered"', async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          // The loss carries it (D66), and the loss paid it all.
          expect(await queueRowOf(failed.id)).toBeUndefined();
          expect(await stageOf(sale.chargeId)).toBeNull();
          const before = await failedCount();

          expect(await wonLate(sale)).toBe('done');

          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          expect(await amountOf(lateWinRefundId)).toBe(1500);
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          expect(await failedCount()).toBe(before);
          await owedNowhere(sale, [failed.id]);
          expect(
            await cardRowOf(sale.chargeId, failed.stripeRefundId)
          ).toMatchObject({
            status: 'failed',
            resolution: 'covered_by_refund',
            coveredBy: { refundId: lateWinRefundId, amountCents: 1500 },
          });
          // A stale page's settle finds it settled (D75): 409, nothing written.
          expect(
            (await failureOf(settleElsewhere(failed.id))).context
          ).toMatchObject({ code: 'ALREADY_SETTLED' });
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          // The buyer has £15.00 back once: the late win's refund.
          expect(
            (await service.getChargeDetail(sale.chargeId)).charge.refundedCents
          ).toBe(1500);
        });

        it("1, adopted: the late win's refund was made but its answer was lost; the rerun adopts it, and it covers the failed refund", async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          // Made at Stripe by an earlier run, for everything owed then, with
          // the set it included (review r9).
          const own = stripeRefund(sale.chargeId, 1500, {
            created: nowSeconds(),
            metadata: {
              codex_late_win_dispute: sale.disputeId,
              codex_covers: failed.stripeRefundId,
            },
          });
          const { purchase, errors } = spied();

          expect(await wonLate(sale, purchase)).toBe('done');

          expect(await lateWinRefundOf(sale.disputeId)).toBe(own.id);
          expect(await coverOf(failed.id)).toEqual(covered(own.id));
          expect(errors).not.toHaveBeenCalled();
          await owedNowhere(sale, [failed.id]);
        });

        it('2: as 1, lost for £10.00 (the short stage owed £5.00): the late win refunds £15.00 and covers it; no stage is left', async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1000, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          expect(await stageOf(sale.chargeId)).toMatchObject({
            stage: 'short',
            owedCents: 500,
          });
          expect(await queueRowOf(failed.id)).toBeUndefined();

          expect(await wonLate(sale)).toBe('done');

          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          expect(await amountOf(lateWinRefundId)).toBe(1500);
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          await owedNowhere(sale, [failed.id]);
        });

        it('3: F1 £5.00 failed before the late win, F2 £5.00 counted at it and failed after: F1 is covered, F2 alone is in the queue at £5.00, and no stage shows', async () => {
          let f1 = { id: '', stripeRefundId: '' };
          let f2 = '';
          const sale = await shortLoss('unavailable', 1000, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              f1 = await failedAt(charge, 500);
              f2 = await refundOn(charge, 500, 'succeeded');
            },
          });
          expect(await stageOf(sale.chargeId)).toBeNull();

          expect(await wonLate(sale)).toBe('done');
          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          // £15.00 less F2's £5.00, which counted.
          expect(await amountOf(lateWinRefundId)).toBe(1000);
          expect(await coverOf(f1.id)).toEqual(covered(lateWinRefundId));

          await fails(f2);

          const f2Row = await rowIdOf(f2);
          expect(await coverOf(f2Row)).toEqual({
            resolution: null,
            coveredBy: null,
            resolvedBy: null,
          });
          expect(await queueRowOf(f1.id)).toBeUndefined();
          expect(await queueRowOf(f2Row)).toMatchObject({
            amountCents: 500,
            waitingForChargeback: null,
          });
          expect(await stageOf(sale.chargeId)).toBeNull();
          expect((await settleElsewhere(f2Row)).settled.resolution).toBe(
            'refunded_elsewhere'
          );
        });

        /** A blocked £15.00 sale still owed its refund: no chargeback, `pending`. */
        async function blockedPending() {
          const sale = await purchaseCharge(3600, lossBuyer);
          await db
            .update(purchases)
            .set({
              status: PURCHASE_STATUS.PENDING,
              amountPaidCents: 1500,
              creatorPayoutCents: 1500 - 235,
              refundReason: ITEM_UNAVAILABLE_REFUND_REASON,
            })
            .where(eq(purchases.id, sale.purchase.id));
          const charge = fake.charges.get(sale.chargeId);
          if (charge) charge.amount = 1500;
          return sale;
        }

        /** The blocked refund's asks of Stripe for this payment: (amount, key). */
        const blockedAsks = (paymentIntentId: string) =>
          vi
            .mocked(fake.stripe.refunds.create)
            .mock.calls.filter(
              ([params]) =>
                (params as Stripe.RefundCreateParams).payment_intent ===
                paymentIntentId
            )
            .map(([params, options]) => [
              (params as Stripe.RefundCreateParams).amount,
              (options as Stripe.RequestOptions | undefined)?.idempotencyKey,
            ]);

        /** The blocked refund the sweep made: the newest on the charge at Stripe. */
        function blockedRefundOf(chargeId: string) {
          const made = (fake.refundsByCharge.get(chargeId) ?? []).at(-1);
          if (!made) throw new Error('the sweep made no refund');
          created.stripeRefundIds.push(made.id);
          return made;
        }

        const sweepOnce = () =>
          purchaseService().settleOwedDuplicates({
            olderThanMs: 0,
            limit: 100_000,
          });

        it('4: a pending blocked payment whose part refund failed: the sweep refunds the whole £15.00 and covers it, and the purchase names that refund', async () => {
          const sale = await blockedPending();
          const part = await failedAt(sale, 500);
          expect(await queueRowOf(part.id)).toBeDefined();

          await sweepOnce();

          expect(blockedAsks(sale.paymentIntentId)).toEqual([
            [1500, `refund_unavailable_${sale.paymentIntentId}_1500`],
          ]);
          const made = blockedRefundOf(sale.chargeId);
          expect(made.amount).toBe(1500);
          expect(await coverOf(part.id)).toEqual(covered(made.id));
          expect(await queueRowOf(part.id)).toBeUndefined();
          expect(
            takeFirst(
              await db
                .select({
                  status: purchases.status,
                  stripeRefundId: purchases.stripeRefundId,
                })
                .from(purchases)
                .where(eq(purchases.id, sale.purchase.id))
            )
          ).toEqual({
            status: PURCHASE_STATUS.REFUNDED,
            stripeRefundId: made.id,
          });
        });

        it('5: as 4, but the failed part refund was settled refunded elsewhere first: the sweep refunds only the £10.00 left, under a key naming it, and covers nothing', async () => {
          const sale = await blockedPending();
          const part = await failedAt(sale, 500);
          // Settled before this release: a settle now waits for the
          // payment's own refund (REFUND_AWAITS_PAYMENT_REFUND, below).
          await db
            .update(refunds)
            .set({
              resolution: 'refunded_elsewhere',
              resolvedAt: new Date(),
              resolvedByUserId: supportId,
            })
            .where(eq(refunds.id, part.id));

          await sweepOnce();

          expect(blockedAsks(sale.paymentIntentId)).toEqual([
            [1000, `refund_unavailable_${sale.paymentIntentId}_1000`],
          ]);
          expect(blockedRefundOf(sale.chargeId).amount).toBe(1000);
          expect((await coverOf(part.id)).resolution).toBe(
            'refunded_elsewhere'
          );
        });

        it("the blocked refund's key: an answer lost after Stripe made it is found by the next sweep's sync, so nothing more is asked, and it covers the failed part refund", async () => {
          const sale = await blockedPending();
          const part = await failedAt(sale, 500);
          const create = vi.mocked(fake.stripe.refunds.create);
          const make = create.getMockImplementation();
          if (!make) throw new Error('the fake has no create');
          // This payment's first answer is lost after Stripe made it; the
          // sweep's others (any blocked payment still owed) are answered.
          let lost = false;
          create.mockImplementation((async (
            ...args: Parameters<typeof make>
          ) => {
            const made = await make(...args);
            const [params] = args;
            if (!lost && params?.payment_intent === sale.paymentIntentId) {
              lost = true;
              throw Object.assign(new Error('socket hang up'), {
                type: 'StripeConnectionError',
              });
            }
            return made;
          }) as never);

          try {
            await sweepOnce();
            expect((await coverOf(part.id)).resolution).toBeNull();
            await sweepOnce();
          } finally {
            create.mockImplementation(make);
          }

          // Asked once, under the amount's key: the retry found it counted.
          expect(blockedAsks(sale.paymentIntentId)).toEqual([
            [1500, `refund_unavailable_${sale.paymentIntentId}_1500`],
          ]);
          const made = blockedRefundOf(sale.chargeId);
          expect(await coverOf(part.id)).toEqual(covered(made.id));
          expect(
            takeFirst(
              await db
                .select({ status: purchases.status })
                .from(purchases)
                .where(eq(purchases.id, sale.purchase.id))
            ).status
          ).toBe(PURCHASE_STATUS.REFUNDED);
        });

        it('6: an ordinary sale whose refund failed before its chargeback was lost, bought again, won late: the late win refunds it all and covers the failed refund, whose clawback stands, so the creators pay once', async () => {
          const charge = await purchaseCharge(3600, lossBuyer);
          // Clawed back like any failed refund: £4.49 off the org and creator.
          const failed = await failedRefund(charge, 500);
          const disputeId = await dispute(
            charge.chargeId,
            'lost',
            charge.purchase.id
          );
          await purchaseService().processLostDispute(
            charge.paymentIntentId,
            1000,
            disputeId,
            { chargeId: charge.chargeId }
          );
          // Bought again since: the late win owes the first payment back.
          const again = takeFirst(
            await db
              .insert(purchases)
              .values({
                customerId: lossBuyer,
                contentId: charge.item.id,
                organizationId: orgId,
                status: PURCHASE_STATUS.COMPLETED,
                amountPaidCents: 1000,
                platformFeeCents: 100,
                organizationFeeCents: 135,
                creatorPayoutCents: 765,
                stripePaymentIntentId: `pi_sup${uid()}`,
                purchasedAt: new Date(),
              })
              .returning()
          );
          created.purchaseIds.push(again.id);
          const takenBack = async () =>
            (
              await db
                .select({ amountCents: payoutReversals.amountCents })
                .from(payoutReversals)
                .where(
                  inArray(payoutReversals.payoutId, [
                    charge.org.id,
                    charge.creator.id,
                  ])
                )
            ).reduce((sum, row) => sum + row.amountCents, 0);
          const beforeWin = await takenBack();
          expect(beforeWin).toBe(449);

          expect(
            await wonLate({
              chargeId: charge.chargeId,
              paymentIntentId: charge.paymentIntentId,
              disputeId,
            })
          ).toBe('done');

          const lateWinRefundId = await lateWinRefundOf(disputeId);
          expect(await amountOf(lateWinRefundId)).toBe(1000);
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          expect(await queueRowOf(failed.id)).toBeUndefined();
          // Its clawback stands, so the late win's refund takes only the rest
          // of the creators' share: £4.49 and then £4.51, their £9.00 once.
          // Dropped from the clawback's refunds, the covered refund would let
          // the late win's take its whole share again (review r8, b).
          expect(await takenBack()).toBe(900);
        });

        it("7: the late win's 'none': a refund counted for it all after the failed one, so none is made and the newest counted refund covers it", async () => {
          let failed = { id: '', stripeRefundId: '' };
          let full = '';
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 500);
              full = await refundOn(charge, 1500, 'succeeded');
            },
          });

          expect(await wonLate(sale)).toBe('none');

          expect(await coverOf(failed.id)).toEqual(covered(full));
          await owedNowhere(sale, [failed.id]);
          // Recorded only (not on Stripe's list here): its amount is ours.
          expect(
            (await cardRowOf(sale.chargeId, failed.stripeRefundId))?.coveredBy
          ).toEqual({ refundId: full, amountCents: 1500 });
        });

        it('8: the covering refund itself fails later: it is in the queue at its own £15.00, and what it covered stays covered, so the £15.00 owed is in one place', async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          expect(await wonLate(sale)).toBe('done');
          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);

          await fails(lateWinRefundId);
          const listed = (fake.refundsByCharge.get(sale.chargeId) ?? []).find(
            (refund) => refund.id === lateWinRefundId
          );
          if (listed) listed.status = 'failed';

          const ownRow = await rowIdOf(lateWinRefundId);
          expect(await queueRowOf(ownRow)).toMatchObject({
            amountCents: 1500,
            waitingForChargeback: null,
          });
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          expect(await queueRowOf(failed.id)).toBeUndefined();
          expect(await stageOf(sale.chargeId)).toBeNull();
          // Nothing counts now: a covered refund never does, so the charge
          // page and the search both read nothing back, and the charge can
          // be refunded again in full.
          const detail = await service.getChargeDetail(sale.chargeId);
          expect(detail.charge.refundedCents).toBe(0);
          expect(detail.refundable.maxCents).toBe(1500);
          const found = await service.searchCharges({
            lookup: sale.purchase.id,
            page: 1,
            limit: 20,
          });
          expect(
            found.items.find((item) => item.chargeId === sale.chargeId)
              ?.refundedCents
          ).toBe(0);
        });

        it('a refund that counted when the late win worked out its amount, then failed during the Stripe call, is not covered: the late win did not include it, so it stays owed in the queue', async () => {
          let counted = '';
          const sale = await shortLoss('unavailable', 1000, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              counted = await refundOn(charge, 500, 'succeeded');
            },
          });
          const create = vi.mocked(fake.stripe.refunds.create);
          const make = create.getMockImplementation();
          if (!make) throw new Error('the fake has no create');
          create.mockImplementationOnce((async (
            ...args: Parameters<typeof make>
          ) => {
            await fails(counted);
            return make(...args);
          }) as never);

          expect(await wonLate(sale)).toBe('done');

          // £15.00 less the £5.00 that counted when it was asked.
          expect(await amountOf(await lateWinRefundOf(sale.disputeId))).toBe(
            1000
          );
          const row = await rowIdOf(counted);
          expect(await coverOf(row)).toEqual({
            resolution: null,
            coveredBy: null,
            resolvedBy: null,
          });
          expect(await queueRowOf(row)).toMatchObject({
            amountCents: 500,
            waitingForChargeback: null,
          });
        });

        it('a redelivery is harmless: the late win runs again, makes no refund, covers nothing new and alerts nothing', async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          // A redelivery lands before the outcome is marked: once marked,
          // nothing runs the undo again.
          expect(await wonLate(sale, purchaseService(), { mark: false })).toBe(
            'done'
          );
          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          const asked = vi.mocked(fake.stripe.refunds.create).mock.calls.length;
          const { purchase, errors } = spied();

          expect(
            await purchase.refundFirstPaymentAfterLateWin(
              sale.disputeId,
              { id: sale.chargeId, amountCents: 1500 },
              'test'
            )
          ).toBe('done');

          expect(vi.mocked(fake.stripe.refunds.create).mock.calls).toHaveLength(
            asked
          );
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          expect(errors).not.toHaveBeenCalled();
        });

        it("race 2: a settle while the late win asks Stripe for its refund, which includes it, is refused (422 late_win); the late win's refund then covers it", async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          const create = vi.mocked(fake.stripe.refunds.create);
          const make = create.getMockImplementation();
          if (!make) throw new Error('the fake has no create');
          let refusedMidCall: ServiceError | undefined;
          let rowMidCall: Awaited<ReturnType<typeof queueRowOf>>;
          create.mockImplementationOnce((async (
            ...args: Parameters<typeof make>
          ) => {
            rowMidCall = await queueRowOf(failed.id);
            refusedMidCall = await failureOf(settleElsewhere(failed.id));
            return make(...args);
          }) as never);
          const { purchase, errors } = spied();

          expect(await wonLate(sale, purchase)).toBe('done');

          // Only the refusal shows: the row is listed with no badge (D79).
          expect(rowMidCall).toMatchObject({
            waitingForPaymentRefund: false,
          });
          expect(refusedMidCall?.statusCode).toBe(422);
          expect(refusedMidCall?.context).toEqual({
            code: 'REFUND_AWAITS_PAYMENT_REFUND',
            reason: 'late_win',
            chargeId: sale.chargeId,
          });
          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
          expect(errors).not.toHaveBeenCalled();
          // Once its outcome is marked, the late win holds nothing.
          expect(
            (await failureOf(settleElsewhere(failed.id))).context
          ).toMatchObject({ code: 'ALREADY_SETTLED' });
        });

        it("race 2: a pending blocked payment's failed refund waits for the payment's own refund: listed and counted, with no settle, and a settle is refused (422 blocked_refund); the sweep's refund then covers it", async () => {
          const sale = await blockedPending();
          const before = await failedCount();
          const part = await failedAt(sale, 500);
          expect(await queueRowOf(part.id)).toMatchObject({
            waitingForPaymentRefund: true,
            waitingForChargeback: null,
          });
          // Counted in the tab and the badge while it waits, as D72's.
          expect(await failedCount()).toBe(before + 1);

          const refused = await failureOf(settleElsewhere(part.id));
          expect(refused.statusCode).toBe(422);
          expect(refused.context).toEqual({
            code: 'REFUND_AWAITS_PAYMENT_REFUND',
            reason: 'blocked_refund',
            chargeId: sale.chargeId,
          });
          expect((await coverOf(part.id)).resolution).toBeNull();

          await sweepOnce();

          expect((await coverOf(part.id)).resolution).toBe('covered_by_refund');
          expect(await queueRowOf(part.id)).toBeUndefined();
        });

        it("writer 4: support's refund of all that is left on the charge page covers the failed refunds (the late-win runbook: its failed refund is covered, so it needs no settle); a part refund covers nothing", async () => {
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedAt(charge, 1500);
            },
          });
          expect(await wonLate(sale)).toBe('done');
          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          await fails(lateWinRefundId);
          const listed = (fake.refundsByCharge.get(sale.chargeId) ?? []).find(
            (refund) => refund.id === lateWinRefundId
          );
          if (listed) listed.status = 'failed';
          const ownRow = await rowIdOf(lateWinRefundId);
          const count = () =>
            fake.refundsByCharge.get(sale.chargeId)?.length ?? 0;

          // A part refund: the late win's failed refund stays owed.
          const part = await service.issueRefund(
            sale.chargeId,
            refundInput(500, count()),
            supportId
          );
          created.stripeRefundIds.push(part.refund.id);
          expect((await coverOf(ownRow)).resolution).toBeNull();
          // What is left after it: the £10.00.
          const rest = await service.issueRefund(
            sale.chargeId,
            refundInput(1000, count()),
            supportId
          );
          created.stripeRefundIds.push(rest.refund.id);

          expect(await coverOf(ownRow)).toEqual(covered(rest.refund.id));
          expect(await queueRowOf(ownRow)).toBeUndefined();
          expect(
            (await failureOf(settleElsewhere(ownRow))).context
          ).toMatchObject({ code: 'ALREADY_SETTLED' });
          // What the late win covered stays covered by it.
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
        });

        it("the residual: a settle landing while support's refund of all that is left is at Stripe is alerted at error with the ids, since that refund included it", async () => {
          const charge = await purchaseCharge(3600, lossBuyer);
          const failed = await failedRefund(charge, 1000);
          const create = vi.mocked(fake.stripe.refunds.create);
          const make = create.getMockImplementation();
          if (!make) throw new Error('the fake has no create');
          create.mockImplementationOnce((async (
            ...args: Parameters<typeof make>
          ) => {
            await settleElsewhere(failed.id);
            return make(...args);
          }) as never);
          const errors = vi.spyOn(
            (
              service as unknown as {
                obs: { error: (message: string, meta?: object) => void };
              }
            ).obs,
            'error'
          );

          const made = await service.issueRefund(
            charge.chargeId,
            refundInput(1000, 1),
            supportId
          );
          created.stripeRefundIds.push(made.refund.id);

          expect((await coverOf(failed.id)).resolution).toBe(
            'refunded_elsewhere'
          );
          expect(
            errors.mock.calls.filter(([message]) =>
              message.startsWith('A refund of everything owed included')
            )
          ).toEqual([
            [
              'A refund of everything owed included a failed refund that support settled before it was recorded, so the buyer was refunded twice for it, or its creators re-paid: recover it by hand',
              {
                errorId: expect.any(String),
                purchaseId: charge.purchase.id,
                chargeId: charge.chargeId,
                coveringRefundId: made.refund.id,
                refundId: failed.stripeRefundId,
                resolution: 'refunded_elsewhere',
                coveredByRefundId: null,
              },
            ],
          ]);
          errors.mockRestore();
        });

        it('race 1: two settles at once of a charge with one payment owed: one settles, the other is refused (412) with nothing more to pay back', async () => {
          const charge = await purchaseCharge(3600, lossBuyer);
          // The buyer was refunded once, twice failed: £10.00 is owed once.
          const first = await failedRefund(charge, 1000);
          const second = await failedRefund(charge, 1000);

          const outcomes = await Promise.allSettled([
            settleElsewhere(first.id),
            settleElsewhere(second.id),
          ]);

          expect(
            outcomes.filter((outcome) => outcome.status === 'fulfilled')
          ).toHaveLength(1);
          const refused = outcomes.find(
            (outcome): outcome is PromiseRejectedResult =>
              outcome.status === 'rejected'
          );
          expect(refused?.reason).toMatchObject({
            statusCode: 412,
            context: {
              code: 'SETTLE_EXCEEDS_PAID',
              chargeId: charge.chargeId,
              maxCents: 0,
            },
          });
          const resolutions = await Promise.all(
            [first.id, second.id].map(
              async (id) => (await coverOf(id)).resolution
            )
          );
          expect(resolutions.sort()).toEqual([null, 'refunded_elsewhere']);
        });

        it('adopted, with a gap: the refund covers exactly the set it recorded; a refund that counted when it was asked for and failed since was not in it, so it stays owed in the queue at its own amount (review r9)', async () => {
          let f1 = { id: '', stripeRefundId: '' };
          let counted = '';
          const sale = await shortLoss('unavailable', 1000, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              f1 = await failedAt(charge, 500);
              counted = await refundOn(charge, 500, 'succeeded');
            },
          });
          // Made by an earlier run for £15.00 less the £5.00 that counted,
          // with F1 in its set.
          const own = stripeRefund(sale.chargeId, 1000, {
            created: nowSeconds(),
            metadata: {
              codex_late_win_dispute: sale.disputeId,
              codex_covers: f1.stripeRefundId,
            },
          });
          await fails(counted);
          const { purchase, errors } = spied();

          expect(await wonLate(sale, purchase)).toBe('done');

          expect(await lateWinRefundOf(sale.disputeId)).toBe(own.id);
          expect(await coverOf(f1.id)).toEqual(covered(own.id));
          expect((await coverOf(await rowIdOf(counted))).resolution).toBeNull();
          expect(await queueRowOf(await rowIdOf(counted))).toMatchObject({
            amountCents: 500,
          });
          expect(errors).not.toHaveBeenCalled();
        });

        it("locks the payment's refunds before the dispute: a settle holding a refund, then share-locking the dispute, as support's does, never deadlocks with the late win's cover", async () => {
          // Recorded only, so the late win's sync of Stripe's list never
          // touches it: the first lock it waits on is its cover's.
          let failed = { id: '', stripeRefundId: '' };
          const sale = await shortLoss('unavailable', 1500, {
            paidCents: 1500,
            beforeLoss: async (charge) => {
              failed = await failedOn(charge, 1500);
            },
          });
          let locked!: () => void;
          const holding = new Promise<void>((resolve) => {
            locked = resolve;
          });
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          // The settle's order (lockForSettling, then refuseIfChargebackDecides).
          const settle = db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT id FROM refunds WHERE id = ${failed.id} FOR UPDATE`
            );
            locked();
            await gate;
            await tx.execute(
              sql`SELECT 1 FROM disputes WHERE stripe_dispute_id = ${sale.disputeId} FOR SHARE`
            );
          });
          await holding;
          const win = wonLate(sale);
          // Until the late win's cover waits on the settle's lock.
          for (let tries = 0; ; tries++) {
            const [waiting] = (
              await db.execute(
                sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from "refunds"%for update%'`
              )
            ).rows as Array<{ n: number }>;
            if ((waiting?.n ?? 0) > 0) break;
            if (tries > 200) throw new Error('the cover never waited');
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          release();

          await expect(settle).resolves.toBeUndefined();
          await expect(win).resolves.toBe('done');
          const lateWinRefundId = await lateWinRefundOf(sale.disputeId);
          expect(await coverOf(failed.id)).toEqual(covered(lateWinRefundId));
        });

        // Review r9 (owner D81, D82): the set a refund of everything owed
        // includes travels in its Stripe metadata (`codex_covers`), so a
        // replay, the late win's adoption and the refunds sync cover exactly
        // it; a payment that owes nothing has its open failed refunds covered
        // by the newest standing refund, alerted at error; and the one count
        // sums every dispute on the charge.
        describe('review r9: the recorded set, a payment that owes nothing, and the one count', () => {
          /** A refund standing at Stripe and recorded, as its webhook leaves it. */
          async function standingAt(
            sale: { chargeId: string; purchase: { id: string } },
            amountCents: number,
            createdAgoSeconds = 60
          ) {
            const listed = stripeRefund(sale.chargeId, amountCents, {
              created: nowSeconds() - createdAgoSeconds,
            });
            await db.insert(refunds).values({
              stripeRefundId: listed.id,
              stripeChargeId: sale.chargeId,
              purchaseId: sale.purchase.id,
              amountCents,
              currency: 'gbp',
              status: 'succeeded',
              stripeCreatedAt: new Date(listed.created * 1000),
            });
            return listed;
          }

          /** Stripe now reports `stripeRefundId` failed: its listing, then our row. */
          async function failsAtStripe(
            chargeId: string,
            stripeRefundId: string
          ) {
            const listed = (fake.refundsByCharge.get(chargeId) ?? []).find(
              (refund) => refund.id === stripeRefundId
            );
            if (listed) listed.status = 'failed';
            await fails(stripeRefundId);
          }

          /** The error lines of the purchase service support's sync runs in. */
          function syncErrors() {
            return vi.spyOn(
              (
                service as unknown as {
                  purchase: {
                    obs: { error: (message: string, meta?: object) => void };
                  };
                }
              ).purchase.obs,
              'error'
            );
          }

          function supportErrors() {
            return vi.spyOn(
              (
                service as unknown as {
                  obs: { error: (message: string, meta?: object) => void };
                }
              ).obs,
              'error'
            );
          }

          const NOTHING_OWED_COVERED =
            "Failed refunds were open on a payment that owes nothing, so the newest standing refund covered them: a cover was missed, or a refund was made outside our code (such as a full refund in Stripe's Dashboard)";
          const NOTHING_OWED_COVERED_ELSEWHERE =
            'Failed refunds were open on a payment that owes nothing and no refund stands on its charge, so the newest failed refund settled refunded elsewhere covered them: a cover was missed, or a refund was made outside our code';
          const NOTHING_OWED_NO_COVERER =
            'Failed refunds are open on a payment that owes nothing, and no refund on its charge counts to cover them (all it has back was paid another way or by a chargeback), so they stay in Failed refunds: check the charge on the support page';

          const linesOf = (
            spy: ReturnType<typeof syncErrors>,
            message: string,
            purchaseId: string
          ) =>
            spy.mock.calls.filter(
              ([said, meta]) =>
                said === message &&
                (meta as { purchaseId?: string } | undefined)?.purchaseId ===
                  purchaseId
            );

          /**
           * Support on a database whose next transaction, once Stripe has
           * made the refund, fails: the cover after the Stripe call.
           */
          function coverFailsOnce() {
            let failNext = false;
            const flakyDb = new Proxy(db, {
              get(target, property) {
                if (property === 'transaction' && failNext) {
                  failNext = false;
                  return async () => {
                    throw new Error('the connection dropped');
                  };
                }
                const value: unknown = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            const flaky = new SupportService({
              db: flakyDb,
              environment: 'test',
              stripe: fake.stripe,
              purchase: purchaseService(),
              feeConfig: new FeeConfigService({ db, environment: 'test' }),
            });
            const create = vi.mocked(fake.stripe.refunds.create);
            const make = create.getMockImplementation();
            if (!make) throw new Error('the fake has no create');
            create.mockImplementationOnce((async (
              ...args: Parameters<typeof make>
            ) => {
              const made = await make(...args);
              failNext = true;
              return made;
            }) as never);
            return flaky;
          }

          const newestAtStripe = (chargeId: string) => {
            const made = (fake.refundsByCharge.get(chargeId) ?? []).at(-1);
            if (!made) throw new Error('no refund at Stripe');
            created.stripeRefundIds.push(made.id);
            return made;
          };

          it('writer 4: its cover fails after Stripe made the refund; the resubmit replays it, and the sync covers exactly the set it recorded', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const failed = await failedRefund(charge, 1000);
            const flaky = coverFailsOnce();

            await expect(
              flaky.issueRefund(
                charge.chargeId,
                refundInput(1000, 1),
                supportId
              )
            ).rejects.toThrow();
            const made = newestAtStripe(charge.chargeId);
            expect(made.metadata).toMatchObject({
              codex_covers: failed.stripeRefundId,
            });
            expect((await coverOf(failed.id)).resolution).toBeNull();
            const errors = syncErrors();

            const again = await service.issueRefund(
              charge.chargeId,
              refundInput(1000, 1),
              supportId
            );

            expect(again).toMatchObject({
              replayed: true,
              refund: { id: made.id },
            });
            expect(await coverOf(failed.id)).toEqual(covered(made.id));
            expect(await queueRowOf(failed.id)).toBeUndefined();
            expect(errors).not.toHaveBeenCalled();
            errors.mockRestore();
          });

          it('writer 4: Stripe made the refund but the answer was lost; the resubmit finds it by its key and covers from its metadata', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const failed = await failedRefund(charge, 1000);
            const create = vi.mocked(fake.stripe.refunds.create);
            const make = create.getMockImplementation();
            if (!make) throw new Error('the fake has no create');
            create.mockImplementationOnce((async (
              ...args: Parameters<typeof make>
            ) => {
              await make(...args);
              throw Object.assign(new Error('socket hang up'), {
                type: 'StripeConnectionError',
              });
            }) as never);

            await expect(
              service.issueRefund(
                charge.chargeId,
                refundInput(1000, 1),
                supportId
              )
            ).rejects.toThrow();
            const made = newestAtStripe(charge.chargeId);
            expect((await coverOf(failed.id)).resolution).toBeNull();

            const again = await service.issueRefund(
              charge.chargeId,
              refundInput(1000, 1),
              supportId
            );

            expect(again.replayed).toBe(true);
            expect(await coverOf(failed.id)).toEqual(covered(made.id));
          });

          it("writer 4: a resubmit whose set changed (a refund that counted failed since) is refused by Stripe's key; the refund the key made covers only its FIRST set, and the new failure stays owed (D73)", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const f1 = await failedRefund(charge, 500);
            const counted = await standingAt(charge, 500);
            const flaky = coverFailsOnce();
            await expect(
              flaky.issueRefund(charge.chargeId, refundInput(500, 2), supportId)
            ).rejects.toThrow();
            const made = newestAtStripe(charge.chargeId);
            expect(made.metadata).toMatchObject({
              codex_covers: f1.stripeRefundId,
            });
            // The £5.00 that counted fails; the page's next list misses the
            // refund just made, so the resubmit asks again under its key.
            const stale = (fake.refundsByCharge.get(charge.chargeId) ?? [])
              .filter((refund) => refund.id !== made.id)
              .map((refund) => ({ ...refund }));
            await failsAtStripe(charge.chargeId, counted.id);
            // Support's own read (the second: the sync before it reads Stripe
            // as it is, review r12).
            const list = vi.mocked(fake.stripe.refunds.list);
            const real = list.getMockImplementation();
            if (!real) throw new Error('the fake has no list');
            list
              .mockImplementationOnce(real)
              .mockImplementationOnce((async () => ({
                object: 'list',
                data: stale,
                has_more: false,
              })) as never);
            const errors = syncErrors();

            const again = await service.issueRefund(
              charge.chargeId,
              refundInput(500, 2),
              supportId
            );

            expect(again).toMatchObject({
              replayed: true,
              refund: { id: made.id },
            });
            expect(await coverOf(f1.id)).toEqual(covered(made.id));
            const owed = await rowIdOf(counted.id);
            expect((await coverOf(owed)).resolution).toBeNull();
            expect(await queueRowOf(owed)).toMatchObject({ amountCents: 500 });
            // Something is owed, so nothing is covered for it.
            expect(
              linesOf(errors, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toEqual([]);
            errors.mockRestore();
          });

          it('writer 4: Stripe answers charge_already_refunded (the Dashboard refunded the rest during the call): the sync covers the failed refund with that refund, alerted at error, and nothing is left to refund', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const failed = await failedRefund(charge, 1000);
            let dashboard = { id: '' };
            vi.mocked(fake.stripe.refunds.create).mockImplementationOnce(
              (async () => {
                dashboard = stripeRefund(charge.chargeId, 1000, {
                  created: nowSeconds(),
                });
                throw Object.assign(new Error('Charge already refunded'), {
                  type: 'StripeInvalidRequestError',
                  code: 'charge_already_refunded',
                });
              }) as never
            );
            const errors = syncErrors();
            const support = supportErrors();

            const refused = await failureOf(
              service.issueRefund(
                charge.chargeId,
                refundInput(1000, 1),
                supportId
              )
            );

            expect(refused.context).toMatchObject({
              code: 'NOTHING_LEFT_TO_REFUND',
            });
            expect(await coverOf(failed.id)).toEqual(covered(dashboard.id));
            expect(
              linesOf(errors, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toEqual([
              [
                NOTHING_OWED_COVERED,
                {
                  errorId: expect.any(String),
                  purchaseId: charge.purchase.id,
                  chargeId: charge.chargeId,
                  source: 'refunds_sync',
                  coveringRefundId: dashboard.id,
                  coveredRefundIds: [failed.stripeRefundId],
                },
              ],
            ]);
            expect(support).not.toHaveBeenCalled();
            errors.mockRestore();
            support.mockRestore();
          });

          it('writer 4: charge_already_refunded while a refund that counted failed meanwhile: something is owed, so nothing is covered, and support is alerted at error with the ids', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const f1 = await failedRefund(charge, 500);
            const counted = await standingAt(charge, 500);
            vi.mocked(fake.stripe.refunds.create).mockImplementationOnce(
              (async () => {
                stripeRefund(charge.chargeId, 500, { created: nowSeconds() });
                const listed = (
                  fake.refundsByCharge.get(charge.chargeId) ?? []
                ).find((refund) => refund.id === counted.id);
                if (listed) listed.status = 'failed';
                throw Object.assign(new Error('Charge already refunded'), {
                  type: 'StripeInvalidRequestError',
                  code: 'charge_already_refunded',
                });
              }) as never
            );
            const support = supportErrors();

            await failureOf(
              service.issueRefund(
                charge.chargeId,
                refundInput(500, 2),
                supportId
              )
            );

            created.stripeRefundIds.push(newestAtStripe(charge.chargeId).id);
            expect((await coverOf(f1.id)).resolution).toBeNull();
            expect(support.mock.calls).toEqual([
              [
                "A charge was refunded in full while support's refund was asked for, and failed refunds are still open after its refunds were synced, so which ones that refund paid can't be told: check them on the charge page before settling any",
                {
                  errorId: expect.any(String),
                  chargeId: charge.chargeId,
                  purchaseId: charge.purchase.id,
                  failedRefundIds: expect.arrayContaining([
                    f1.stripeRefundId,
                    counted.id,
                  ]),
                },
              ],
            ]);
            support.mockRestore();
          });

          it("D81: a full refund from Stripe's Dashboard (no metadata), seen by the refunds sync: the open failed refund is covered by the newest STANDING refund, never a newer failed one settled elsewhere, and alerted at error", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const standing = await standingAt(charge, 600, 300);
            // Counted, and newer than the standing one, but not standing.
            const elsewhere = await failedOn(charge, 400);
            await db
              .update(refunds)
              .set({
                resolution: 'refunded_elsewhere',
                resolvedAt: new Date(),
                resolvedByUserId: supportId,
                stripeCreatedAt: new Date(),
              })
              .where(eq(refunds.id, elsewhere.id));
            const open = await failedOn(charge, 300);
            const sync = purchaseService();
            const errors = vi.spyOn(
              (
                sync as unknown as {
                  obs: { error: (message: string, meta?: object) => void };
                }
              ).obs,
              'error'
            );

            await sync.recordChargeRefunds({
              id: charge.chargeId,
              paymentIntentId: charge.paymentIntentId,
            });

            expect(await coverOf(open.id)).toEqual(covered(standing.id));
            expect(await queueRowOf(open.id)).toBeUndefined();
            expect(
              linesOf(errors, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toEqual([
              [
                NOTHING_OWED_COVERED,
                {
                  errorId: expect.any(String),
                  purchaseId: charge.purchase.id,
                  chargeId: charge.chargeId,
                  source: 'refunds_sync',
                  coveringRefundId: standing.id,
                  coveredRefundIds: [open.stripeRefundId],
                },
              ],
            ]);
            // A redelivery covers nothing twice and alerts nothing more.
            await sync.recordChargeRefunds({
              id: charge.chargeId,
              paymentIntentId: charge.paymentIntentId,
            });
            expect(
              linesOf(errors, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toHaveLength(1);
          });

          it("D85: a refund of the whole payment made outside our code fails and support settles it refunded elsewhere while an older failure is open: nothing stands, so that counted refund covers it, alerted at error ONCE across a sync, a 'none' and two backstop runs, and the card names it", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const older = await failedAt(charge, 300);
            // The Dashboard's refund of all of it, failed, then settled
            // through support's own settle (the 412 lets it: £10.00 back).
            const whole = await failedAt(charge, 1000);
            expect((await settleElsewhere(whole.id)).settled.resolution).toBe(
              'refunded_elsewhere'
            );
            const sync = purchaseService();
            const errors = vi.spyOn(
              (
                sync as unknown as {
                  obs: { error: (message: string, meta?: object) => void };
                }
              ).obs,
              'error'
            );
            const once = () =>
              sync.recordChargeRefunds({
                id: charge.chargeId,
                paymentIntentId: charge.paymentIntentId,
              });

            await once();

            expect(await coverOf(older.id)).toEqual(
              covered(whole.stripeRefundId)
            );
            expect(await queueRowOf(older.id)).toBeUndefined();
            const lines = () =>
              linesOf(
                errors,
                NOTHING_OWED_COVERED_ELSEWHERE,
                charge.purchase.id
              );
            expect(lines()).toEqual([
              [
                NOTHING_OWED_COVERED_ELSEWHERE,
                {
                  errorId: expect.any(String),
                  purchaseId: charge.purchase.id,
                  chargeId: charge.chargeId,
                  source: 'refunds_sync',
                  coveringRefundId: whole.stripeRefundId,
                  coveredRefundIds: [older.stripeRefundId],
                },
              ],
            ]);
            // The Refunds card's D74 line names the counted refund.
            expect(
              await cardRowOf(charge.chargeId, older.stripeRefundId)
            ).toMatchObject({
              status: 'failed',
              resolution: 'covered_by_refund',
              coveredBy: { refundId: whole.stripeRefundId, amountCents: 1000 },
            });

            // The late win's "none", the next sync, and two hourly runs.
            await (
              sync as unknown as {
                lateWinOwesNothing: (
                  disputeId: string,
                  purchaseId: string,
                  chargeId: string
                ) => Promise<void>;
              }
            ).lateWinOwesNothing(
              'du_none',
              charge.purchase.id,
              charge.chargeId
            );
            await once();
            await sync.settleOwedDuplicates({ olderThanMs: 0, limit: 100_000 });
            await sync.settleOwedDuplicates({ olderThanMs: 0, limit: 100_000 });

            expect(lines()).toHaveLength(1);
            expect(
              errors.mock.calls.filter(
                ([, meta]) =>
                  (meta as { purchaseId?: string } | undefined)?.purchaseId ===
                  charge.purchase.id
              )
            ).toHaveLength(1);
            expect(await coverOf(older.id)).toEqual(
              covered(whole.stripeRefundId)
            );
          });

          it('D81: the hourly backstop covers a failed refund no event reached, alerted at error; its second run is a no-op', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            // Recorded only: the Dashboard's refund whose event was lost.
            const standing = await refundOn(charge, 1000, 'succeeded');
            const open = await failedOn(charge, 300);
            const sweeper = purchaseService();
            const errors = vi.spyOn(
              (
                sweeper as unknown as {
                  obs: { error: (message: string, meta?: object) => void };
                }
              ).obs,
              'error'
            );
            const sweep = () =>
              sweeper.settleOwedDuplicates({ olderThanMs: 0, limit: 100_000 });

            await sweep();

            expect(await coverOf(open.id)).toEqual(covered(standing));
            expect(
              linesOf(errors, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toEqual([
              [
                NOTHING_OWED_COVERED,
                expect.objectContaining({
                  source: 'hourly_backstop',
                  coveringRefundId: standing,
                  coveredRefundIds: [open.stripeRefundId],
                }),
              ],
            ]);

            await sweep();

            expect(
              linesOf(errors, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toHaveLength(1);
            expect(await coverOf(open.id)).toEqual(covered(standing));
          });

          it("D81: the backstop takes the charge's refunds lock first, so a standing refund failing under it (owed again) is seen and nothing is covered", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const standing = await refundOn(charge, 1000, 'succeeded');
            const open = await failedOn(charge, 300);
            let locked!: () => void;
            const holding = new Promise<void>((resolve) => {
              locked = resolve;
            });
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            // The refund webhook failing the standing refund, under the
            // charge's refunds lock.
            const failing = db.transaction(async (tx) => {
              await tx.execute(
                sql`SELECT id FROM refunds WHERE stripe_charge_id = ${charge.chargeId} ORDER BY id FOR UPDATE`
              );
              await tx.execute(
                sql`UPDATE refunds SET status = 'failed' WHERE stripe_refund_id = ${standing}`
              );
              locked();
              await gate;
            });
            await holding;
            const sweep = purchaseService().settleOwedDuplicates({
              olderThanMs: 0,
              limit: 100_000,
            });
            try {
              for (let tries = 0; ; tries++) {
                const [waiting] = (
                  await db.execute(
                    sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from "refunds"%for update%'`
                  )
                ).rows as Array<{ n: number }>;
                if ((waiting?.n ?? 0) > 0) break;
                if (tries > 200) throw new Error('the backstop never waited');
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
            } finally {
              // Never leave the lock held for the tests after this one.
              release();
            }

            await expect(failing).resolves.toBeUndefined();
            await sweep;
            expect((await coverOf(open.id)).resolution).toBeNull();
          });

          it('the late win: under its key with another set (a refund failed between runs), Stripe refuses the new parameters; the run adopts its own refund, which covers its FIRST set, then the payment owes nothing, so the new failure is covered and alerted (D81)', async () => {
            let f1 = { id: '', stripeRefundId: '' };
            const sale = await shortLoss('unavailable', 1500, {
              paidCents: 1500,
              beforeLoss: async (charge) => {
                f1 = await failedAt(charge, 1500);
              },
            });
            const create = vi.mocked(fake.stripe.refunds.create);
            const make = create.getMockImplementation();
            if (!make) throw new Error('the fake has no create');
            create.mockImplementationOnce((async (
              ...args: Parameters<typeof make>
            ) => {
              await make(...args);
              throw Object.assign(new Error('socket hang up'), {
                type: 'StripeConnectionError',
              });
            }) as never);
            await wonLate(sale).catch(() => undefined);
            const own = newestAtStripe(sale.chargeId);
            expect(own.metadata).toMatchObject({
              codex_late_win_dispute: sale.disputeId,
              codex_covers: f1.stripeRefundId,
            });
            // A refund that failed since, and a stale list on the next run.
            const f3 = await failedAt(sale, 300);
            const stale = (fake.refundsByCharge.get(sale.chargeId) ?? [])
              .filter((refund) => refund.id !== own.id)
              .map((refund) => ({ ...refund }));
            vi.mocked(fake.stripe.refunds.list).mockImplementationOnce(
              (async () => ({
                object: 'list',
                data: stale,
                has_more: false,
              })) as never
            );
            const { purchase, errors } = spied();

            expect(await wonLate(sale, purchase)).toBe('done');

            expect(await lateWinRefundOf(sale.disputeId)).toBe(own.id);
            expect(await coverOf(f1.id)).toEqual(covered(own.id));
            expect(await coverOf(f3.id)).toEqual(covered(own.id));
            expect(
              linesOf(errors, NOTHING_OWED_COVERED, sale.purchase.id)
            ).toEqual([
              [
                NOTHING_OWED_COVERED,
                expect.objectContaining({
                  coveringRefundId: own.id,
                  coveredRefundIds: [f3.stripeRefundId],
                }),
              ],
            ]);
          });

          it("the blocked refund: its answer was lost and the refund it made failed, so the next sweep asks the same amount with another set; Stripe refuses the key's new parameters, and the refund the key made is the answer", async () => {
            const sale = await blockedPending();
            const create = vi.mocked(fake.stripe.refunds.create);
            const make = create.getMockImplementation();
            if (!make) throw new Error('the fake has no create');
            // Only this payment's first ask loses its answer: the sweep is
            // global, so another payment's ask must not take the fault.
            let lost = false;
            create.mockImplementation((async (
              ...args: Parameters<typeof make>
            ) => {
              const made = await make(...args);
              if (!lost && args[0]?.payment_intent === sale.paymentIntentId) {
                lost = true;
                throw Object.assign(new Error('socket hang up'), {
                  type: 'StripeConnectionError',
                });
              }
              return made;
            }) as never);
            await sweepOnce();
            create.mockImplementation(make);
            const made = blockedRefundOf(sale.chargeId);
            expect(made.metadata).toMatchObject({
              codex_refund_key: `refund_unavailable_${sale.paymentIntentId}_1500`,
            });
            made.status = 'failed';
            const { purchase, errors } = spied();

            await purchase.settleOwedDuplicates({
              olderThanMs: 0,
              limit: 100_000,
            });

            expect(blockedAsks(sale.paymentIntentId)).toEqual([
              [1500, `refund_unavailable_${sale.paymentIntentId}_1500`],
              [1500, `refund_unavailable_${sale.paymentIntentId}_1500`],
            ]);
            const row = takeFirst(
              await db
                .select({
                  status: purchases.status,
                  stripeRefundId: purchases.stripeRefundId,
                })
                .from(purchases)
                .where(eq(purchases.id, sale.purchase.id))
            );
            expect(row).toEqual({
              status: 'refunded',
              stripeRefundId: made.id,
            });
            expect(
              errors.mock.calls.filter(
                ([message]) =>
                  message ===
                  'Payment for an unavailable item could not be refunded'
              )
            ).toEqual([]);
            // The refund it made failed: owed, in the queue at its amount.
            expect(await queueRowOf(await rowIdOf(made.id))).toMatchObject({
              amountCents: 1500,
            });
          });

          it('the blocked refund asks what the one count leaves: paid another way is not asked again', async () => {
            const sale = await blockedPending();
            const disputeId = await dispute(
              sale.chargeId,
              'won',
              sale.purchase.id
            );
            await db
              .update(disputes)
              .set({
                paidAnotherWayCents: 500,
                refundedOutsideStripeAt: new Date(),
              })
              .where(eq(disputes.stripeDisputeId, disputeId));

            await sweepOnce();

            created.stripeRefundIds.push(blockedRefundOf(sale.chargeId).id);
            expect(blockedAsks(sale.paymentIntentId)).toEqual([
              [1000, `refund_unavailable_${sale.paymentIntentId}_1000`],
            ]);
          });

          it("a blocked payment whose chargeback was lost but not yet applied is the loss's: the sweep never asks Stripe, and the loss writes what the buyer has back", async () => {
            const sale = await blockedPending();
            const disputeId = await dispute(
              sale.chargeId,
              'lost',
              sale.purchase.id
            );

            await sweepOnce();

            expect(blockedAsks(sale.paymentIntentId)).toEqual([]);
            await purchaseService().processLostDispute(
              sale.paymentIntentId,
              1000,
              disputeId,
              { chargeId: sale.chargeId }
            );
            const row = takeFirst(
              await db
                .select({
                  status: purchases.status,
                  refundAmountCents: purchases.refundAmountCents,
                })
                .from(purchases)
                .where(eq(purchases.id, sale.purchase.id))
            );
            expect(row).toEqual({
              status: 'refunded',
              refundAmountCents: 1000,
            });
          });

          it("the 412's most that can be paid back is the charge page's: what is left after the refunds that count", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            await standingAt(charge, 500);
            const failed = await failedOn(charge, 800);

            const refused = await failureOf(settleElsewhere(failed.id));

            const page = await service.getChargeDetail(charge.chargeId);
            expect(refused.context).toMatchObject({
              code: 'SETTLE_EXCEEDS_PAID',
              maxCents: page.refundable.maxCents,
            });
            expect(page.refundable.maxCents).toBe(500);
          });

          it('the one count sums EVERY dispute on the charge (owner D82): two lost chargebacks of £2.00 and £3.00 leave £5.00 to pay back', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const failed = await failedOn(charge, 800);
            for (const amountCents of [200, 300]) {
              const id = await dispute(
                charge.chargeId,
                'lost',
                charge.purchase.id
              );
              await db
                .update(disputes)
                .set({ amountCents })
                .where(eq(disputes.stripeDisputeId, id));
            }

            const refused = await failureOf(settleElsewhere(failed.id));

            expect(refused.context).toMatchObject({
              code: 'SETTLE_EXCEEDS_PAID',
              maxCents: 500,
            });
          });

          it('D82: a blocked payment disputed twice is ONE short loss, on its newest dispute, owing what both leave; a mark goes on that dispute', async () => {
            const sale = await shortLoss('unavailable', 600, {
              paidCents: 1500,
            });
            const newer = await dispute(
              sale.chargeId,
              'lost',
              sale.purchase.id
            );
            await db
              .update(disputes)
              .set({
                amountCents: 400,
                stripeCreatedAt: new Date(Date.now() + 1000),
              })
              .where(eq(disputes.stripeDisputeId, newer));

            const shown = await stageOf(sale.chargeId);
            expect(shown).toMatchObject({
              stage: 'short',
              stripeDisputeId: newer,
              lostCents: 1000,
              owedCents: 500,
            });
            const listed = await findShortLosses(db, {
              chargeId: sale.chargeId,
              includeMarked: false,
              limit: 10,
            });
            expect(listed.rows.map((row) => row.stripeDisputeId)).toEqual([
              newer,
            ]);
            expect(listed.total).toBe(1);
            expect(await owedOn(sale.paymentIntentId, SHORT_REPORT)).toEqual([
              expect.objectContaining({
                stripeDisputeId: newer,
                owedCents: 500,
              }),
            ]);

            await service.markPaidAnotherWay(
              sale.chargeId,
              body(newer, 500),
              supportId
            );

            expect(await marksOf(newer)).toMatchObject({ paidCents: 500 });
            expect(await marksOf(sale.disputeId)).toMatchObject({
              paidCents: null,
            });
            expect(await stageOf(sale.chargeId)).toMatchObject({
              stripeDisputeId: newer,
              paidAnotherWayCents: 500,
              owedCents: 0,
            });
          });

          // Review r10 (owner D85): a payment that owes nothing with no
          // refund standing names the newest COUNTED refund; every alert
          // about the same rows carries one errorId; the backstop is ordered,
          // bounded and never re-selects what it can't cover; the late win
          // asks the one count; "owes nothing" has one implementation.
          const REFUNDED_TWICE =
            'A refund of everything owed included a failed refund that support settled before it was recorded, so the buyer was refunded twice for it, or its creators re-paid: recover it by hand';
          const COVERED_BY_ANOTHER =
            'A refund of everything owed included a failed refund another refund covered first, so nothing was paid twice';
          const NOT_INCLUDED =
            "A refund of everything owed names failed refunds it can't have included (another payment's, or made after it), so they were not covered: check its metadata in Stripe";
          const BACKSTOP_FAILED =
            'Could not cover the failed refunds of payments that owe nothing (a lock held elsewhere, or an error); the next sweep tries them again';

          /**
           * A hand-made state no code path writes (the census): all the
           * buyer has back was paid another way, on a chargeback won late
           * whose own refund was made, so no stage carries it and no refund
           * counts.
           */
          async function paidAnotherWayInFull(sale: {
            chargeId: string;
            purchase: { id: string };
          }) {
            const disputeId = await dispute(
              sale.chargeId,
              'won',
              sale.purchase.id
            );
            await db
              .update(disputes)
              .set({
                paidAnotherWayCents: 1000,
                refundedOutsideStripeAt: new Date(),
                lateWonAt: new Date(),
                lateWinRefundId: `re_gone${uid()}`,
              })
              .where(eq(disputes.stripeDisputeId, disputeId));
          }

          /** Make a refund row's own record as old as `at`: the backstop orders by it. */
          async function recordedAt(id: string, at: string) {
            await db
              .update(refunds)
              .set({ createdAt: new Date(at) })
              .where(eq(refunds.id, id));
          }

          /** A purchase service whose error and info lines are spied on. */
          function watched() {
            const purchase = purchaseService();
            const obs = (
              purchase as unknown as {
                obs: {
                  error: (message: string, meta?: object) => void;
                  info: (message: string, meta?: object) => void;
                };
              }
            ).obs;
            return {
              purchase,
              errors: vi.spyOn(obs, 'error'),
              infos: vi.spyOn(obs, 'info'),
            };
          }

          it('D85: no refund counts at all (a state no code path writes): nothing is covered, it is alerted at error with the SAME errorId each time, and the backstop never selects it', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const open = await failedOn(charge, 300);
            await paidAnotherWayInFull(charge);
            const { purchase, errors } = watched();
            const sync = () =>
              purchase.recordChargeRefunds({
                id: charge.chargeId,
                paymentIntentId: charge.paymentIntentId,
              });

            await sync();
            await sync();
            await purchase.settleOwedDuplicates({
              olderThanMs: 0,
              limit: 100_000,
            });

            expect((await coverOf(open.id)).resolution).toBeNull();
            const lines = linesOf(
              errors,
              NOTHING_OWED_NO_COVERER,
              charge.purchase.id
            );
            expect(lines).toEqual([
              [
                NOTHING_OWED_NO_COVERER,
                {
                  errorId: expect.any(String),
                  purchaseId: charge.purchase.id,
                  chargeId: charge.chargeId,
                  source: 'refunds_sync',
                  failedRefundIds: [open.stripeRefundId],
                },
              ],
              [NOTHING_OWED_NO_COVERER, expect.any(Object)],
            ]);
            const ids = lines.map(
              ([, meta]) => (meta as { errorId: string }).errorId
            );
            expect(ids[1]).toBe(ids[0]);
            expect(ids[0]).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
          });

          it('the backstop takes the payment with the OLDEST open failure first, and never one with no refund that counts to name', async () => {
            const stuck = await purchaseCharge(3600, lossBuyer);
            const stuckOpen = await failedOn(stuck, 300);
            await paidAnotherWayInFull(stuck);
            await recordedAt(stuckOpen.id, '2000-01-01T00:00:00Z');
            // Five payments the Dashboard refunded in full, their events
            // lost, made newest first so creation order is no help.
            const owing: Array<{ open: string; standing: string }> = [];
            for (const day of [6, 5, 4, 3, 2]) {
              const sale = await purchaseCharge(3600, lossBuyer);
              const standing = await refundOn(sale, 1000, 'succeeded');
              const open = await failedOn(sale, 300);
              await recordedAt(open.id, `2000-01-0${day}T00:00:00Z`);
              owing.unshift({ open: open.id, standing });
            }
            const { purchase, errors } = watched();

            // One payment a run, oldest open failure first: any other order
            // passes all four runs one time in 120.
            for (let run = 1; run <= 4; run++) {
              await purchase.settleOwedDuplicates({
                olderThanMs: 0,
                limit: 1,
              });
              for (const [index, { open, standing }] of owing.entries()) {
                expect(await coverOf(open)).toEqual(
                  index < run
                    ? covered(standing)
                    : { resolution: null, coveredBy: null, resolvedBy: null }
                );
              }
            }
            expect((await coverOf(stuckOpen.id)).resolution).toBeNull();
            expect(
              linesOf(errors, NOTHING_OWED_NO_COVERER, stuck.purchase.id)
            ).toEqual([]);
          });

          it('the backstop gives up a payment whose refunds lock is held elsewhere after 5 s, reports the run once with its ids, and covers the rest of the batch', async () => {
            const held = await purchaseCharge(3600, lossBuyer);
            const free = await purchaseCharge(3600, lossBuyer);
            await refundOn(held, 1000, 'succeeded');
            const heldOpen = await failedOn(held, 300);
            const freeStanding = await refundOn(free, 1000, 'succeeded');
            const freeOpen = await failedOn(free, 300);
            await recordedAt(heldOpen.id, '2000-02-01T00:00:00Z');
            await recordedAt(freeOpen.id, '2000-02-02T00:00:00Z');
            let locked!: () => void;
            const holding = new Promise<void>((resolve) => {
              locked = resolve;
            });
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const holder = db.transaction(async (tx) => {
              await tx.execute(
                sql`SELECT id FROM refunds WHERE stripe_charge_id = ${held.chargeId} ORDER BY id FOR UPDATE`
              );
              locked();
              await gate;
            });
            await holding;
            // Never leave the lock held, whatever the sweep does.
            const safety = setTimeout(() => release(), 20_000);
            const { purchase, errors } = watched();
            try {
              await purchase.settleOwedDuplicates({
                olderThanMs: 0,
                limit: 100_000,
              });
            } finally {
              clearTimeout(safety);
              release();
            }
            await holder;

            expect((await coverOf(heldOpen.id)).resolution).toBeNull();
            expect(await coverOf(freeOpen.id)).toEqual(covered(freeStanding));
            const reports = errors.mock.calls.filter(
              ([message]) => message === BACKSTOP_FAILED
            );
            expect(reports).toHaveLength(1);
            expect(reports[0]?.[1]).toMatchObject({
              payments: expect.arrayContaining([
                {
                  purchaseId: held.purchase.id,
                  chargeId: held.chargeId,
                  code: '55P03',
                  lockTimeout: true,
                  reason: expect.any(String),
                },
              ]),
            });
            // Its cause's code, never the failed query's SQL and params.
            const said = JSON.stringify(reports[0]?.[1]);
            expect(said).not.toContain('Failed query');
            expect(said.toLowerCase()).not.toContain('for update');
          });

          it('the residual is ONE incident: the request that made the covering refund and each sync of the charge after it say it at error, whenever it was settled, all under one errorId (review r11)', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const failed = await failedRefund(charge, 1000);
            const create = vi.mocked(fake.stripe.refunds.create);
            const make = create.getMockImplementation();
            if (!make) throw new Error('the fake has no create');
            create.mockImplementationOnce((async (
              ...args: Parameters<typeof make>
            ) => {
              await settleElsewhere(failed.id);
              return make(...args);
            }) as never);
            const said = supportErrors();

            const made = await service.issueRefund(
              charge.chargeId,
              refundInput(1000, 1),
              supportId
            );
            created.stripeRefundIds.push(made.refund.id);
            const { purchase, errors, infos } = watched();
            const sync = () =>
              purchase.recordChargeRefunds({
                id: charge.chargeId,
                paymentIntentId: charge.paymentIntentId,
              });
            // Its own refund event, then another refund event on the charge.
            await sync();
            await sync();

            const first = said.mock.calls.filter(
              ([message]) => message === REFUNDED_TWICE
            );
            expect(first).toHaveLength(1);
            const again = errors.mock.calls.filter(
              ([message]) => message === REFUNDED_TWICE
            );
            expect(again).toHaveLength(2);
            const errorId = (first[0]?.[1] as { errorId: string }).errorId;
            expect(
              again.map(([, meta]) => (meta as { errorId: string }).errorId)
            ).toEqual([errorId, errorId]);
            expect(
              infos.mock.calls.filter(
                ([message]) => message === COVERED_BY_ANOTHER
              )
            ).toEqual([]);
            said.mockRestore();
          });

          it('a refund whose recorded set names a failed refund another refund covered first is no double payment: never alerted "refunded twice"', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const open = await failedAt(charge, 200);
            await db
              .update(refunds)
              .set({ stripeCreatedAt: new Date(Date.now() - 120_000) })
              .where(eq(refunds.id, open.id));
            const older = stripeRefund(charge.chargeId, 100, {
              created: nowSeconds() - 30,
              metadata: { codex_covers: open.stripeRefundId },
            });
            stripeRefund(charge.chargeId, 100, {
              created: nowSeconds() - 20,
              metadata: { codex_covers: open.stripeRefundId },
            });
            const { purchase, errors, infos } = watched();

            await purchase.recordChargeRefunds({
              id: charge.chargeId,
              paymentIntentId: charge.paymentIntentId,
            });

            expect(await coverOf(open.id)).toEqual(covered(older.id));
            expect(
              errors.mock.calls.filter(
                ([message]) => message === REFUNDED_TWICE
              )
            ).toEqual([]);
            expect(
              infos.mock.calls.filter(
                ([message]) => message === COVERED_BY_ANOTHER
              )
            ).toHaveLength(1);
          });

          it("a recorded set naming a failed refund made AFTER its refund, and another payment's refund, covers neither, and says so in ONE error with both lists", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const other = await purchaseCharge(3600, lossBuyer);
            const foreign = await failedOn(other, 200);
            const coverer = stripeRefund(charge.chargeId, 100, {
              created: nowSeconds() - 120,
            });
            const later = await failedOn(charge, 200);
            coverer.metadata = {
              codex_covers: `${later.stripeRefundId},${foreign.stripeRefundId}`,
            };
            const { purchase, errors } = watched();

            await purchase.recordChargeRefunds({
              id: charge.chargeId,
              paymentIntentId: charge.paymentIntentId,
            });

            expect((await coverOf(later.id)).resolution).toBeNull();
            expect((await coverOf(foreign.id)).resolution).toBeNull();
            expect(linesOf(errors, NOT_INCLUDED, charge.purchase.id)).toEqual([
              [
                NOT_INCLUDED,
                {
                  errorId: expect.any(String),
                  purchaseId: charge.purchase.id,
                  chargeId: charge.chargeId,
                  coveringRefundId: coverer.id,
                  unknownRefundIds: [foreign.stripeRefundId],
                  notIncludedRefundIds: [later.stripeRefundId],
                },
              ],
            ]);
          });

          it('the late win asks what the one count leaves: with another chargeback on the charge still lost, never its amount', async () => {
            const sale = await shortLoss('unavailable', 600, {
              paidCents: 1500,
            });
            const other = await dispute(
              sale.chargeId,
              'lost',
              sale.purchase.id
            );
            await db
              .update(disputes)
              .set({ amountCents: 400 })
              .where(eq(disputes.stripeDisputeId, other));

            await wonLate(sale);

            const asks = vi
              .mocked(fake.stripe.refunds.create)
              .mock.calls.filter(([, options]) =>
                (
                  options as Stripe.RequestOptions | undefined
                )?.idempotencyKey?.startsWith(
                  `late_win_refund_${sale.disputeId}_`
                )
              )
              .map(([params]) => (params as Stripe.RefundCreateParams).amount);
            expect(asks).toEqual([1100]);
            await lateWinRefundOf(sale.disputeId);
          });

          it('the blocked refund with nothing to ask: a standing refund that fails between the read and the lock is never named; the purchase names none, and the failure is owed', async () => {
            const sale = await blockedPending();
            const standing = await standingAt(sale, 1500);
            const pending = takeFirst(
              await db
                .select()
                .from(purchases)
                .where(eq(purchases.id, sale.purchase.id))
            );
            // The sync's cover is the first transaction; the cover of a
            // payment that owes nothing is the second: the refund fails
            // just before it locks.
            let transactions = 0;
            const failing = new Proxy(db, {
              get(target, property) {
                if (property === 'transaction') {
                  return async (
                    ...args: Parameters<typeof target.transaction>
                  ) => {
                    transactions++;
                    if (transactions === 2) {
                      await failsAtStripe(sale.chargeId, standing.id);
                    }
                    return target.transaction(...args);
                  };
                }
                const value: unknown = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            const purchase = new PurchaseService(
              { db: failing, environment: 'test', ...createTestMoneyDeps() },
              fake.stripe
            );

            await (
              purchase as unknown as {
                refundBlockedPayment: (
                  row: typeof pending,
                  chargeId: string
                ) => Promise<unknown>;
              }
            ).refundBlockedPayment(pending, sale.chargeId);

            expect(transactions).toBe(2);
            expect(blockedAsks(sale.paymentIntentId)).toEqual([]);
            expect(
              takeFirst(
                await db
                  .select({
                    status: purchases.status,
                    stripeRefundId: purchases.stripeRefundId,
                  })
                  .from(purchases)
                  .where(eq(purchases.id, sale.purchase.id))
              )
            ).toEqual({ status: 'refunded', stripeRefundId: null });
            expect(await queueRowOf(await rowIdOf(standing.id))).toMatchObject({
              amountCents: 1500,
            });
          });

          // Review r11: every writer reads its set together with what its
          // amount subtracts, a residual is always an error under one id,
          // and one double payment is one incident.
          const LATE_WIN_OVERPAID_SEEN =
            'Late win: its refund and the refunds that count pay back more than the payment, by failed refunds its refund included that were settled refunded elsewhere: the one incident to recover is theirs';

          /**
           * Support's own read of Stripe's list (the second list of the
           * charge in its request: the sync before it is the first, review
           * r12), returned as it stood when read, and then `meanwhile` lands
           * before support reads anything else. Our record is never ahead of
           * what Stripe listed, so this is what production can do.
           */
          function rightAfterSupportsList(meanwhile: () => Promise<void>) {
            const list = vi.mocked(fake.stripe.refunds.list);
            const real = list.getMockImplementation();
            if (!real) throw new Error('the fake has no list');
            list.mockImplementationOnce(real).mockImplementationOnce((async (
              ...args: Parameters<typeof real>
            ) => {
              const page = await real(...args);
              const asListed = {
                ...page,
                data: page.data.map((refund: Stripe.Refund) => ({ ...refund })),
              };
              await meanwhile();
              return asListed;
            }) as never);
          }

          const settledElsewhereNow = async (id: string) => {
            await db
              .update(refunds)
              .set({
                resolution: 'refunded_elsewhere',
                resolvedAt: new Date(),
                resolvedByUserId: supportId,
              })
              .where(eq(refunds.id, id));
          };

          it("writer 4 reads its set FIRST: a refund standing when Stripe listed it, which fails (at Stripe and in our record) before support's next read, is owed, never covered unpaid", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const inSet = await failedAt(charge, 100);
            const standing = await standingAt(charge, 400);
            rightAfterSupportsList(() =>
              failsAtStripe(charge.chargeId, standing.id)
            );

            const made = await service.issueRefund(
              charge.chargeId,
              refundInput(600, 2),
              supportId
            );
            created.stripeRefundIds.push(made.refund.id);

            expect(await coverOf(inSet.id)).toEqual(covered(made.refund.id));
            const standingRow = await rowIdOf(standing.id);
            expect((await coverOf(standingRow)).resolution).toBeNull();
            expect(await queueRowOf(standingRow)).toMatchObject({
              amountCents: 400,
            });
          });

          it('writer 4 with a failure AND a settle right after its list: the failed one stays owed, and the one of its set settled elsewhere is alerted as the residual, never paid twice in silence', async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const inSet = await failedAt(charge, 100);
            const standing = await standingAt(charge, 400);
            rightAfterSupportsList(async () => {
              await failsAtStripe(charge.chargeId, standing.id);
              await settledElsewhereNow(inSet.id);
            });
            const said = supportErrors();

            const made = await service.issueRefund(
              charge.chargeId,
              refundInput(600, 2),
              supportId
            );
            created.stripeRefundIds.push(made.refund.id);

            expect(newestAtStripe(charge.chargeId).metadata).toMatchObject({
              codex_covers: inSet.stripeRefundId,
            });
            expect((await coverOf(inSet.id)).resolution).toBe(
              'refunded_elsewhere'
            );
            expect(
              said.mock.calls.filter(([message]) => message === REFUNDED_TWICE)
            ).toEqual([
              [
                REFUNDED_TWICE,
                expect.objectContaining({
                  coveringRefundId: made.refund.id,
                  refundId: inSet.stripeRefundId,
                  resolution: 'refunded_elsewhere',
                }),
              ],
            ]);
            const standingRow = await rowIdOf(standing.id);
            expect((await coverOf(standingRow)).resolution).toBeNull();
            expect(await queueRowOf(standingRow)).toMatchObject({
              amountCents: 400,
            });
            said.mockRestore();
          });

          // Review r12 (the silent reviewer's probe): writer 4 syncs our
          // record before it reads it, and again once its refund is made.
          const SYNC_AFTER_FAILED =
            "Support's refund was made, but our record of the charge's refunds could not be synced after it: the charge.refunded event syncs it again, and until then a failed refund it paid may show in Failed refunds";

          /** Stripe failed `refundId` and our record doesn't know yet: its refund.updated isn't handled. */
          function failedAtStripeOnly(chargeId: string, refundId: string) {
            const listed = (fake.refundsByCharge.get(chargeId) ?? []).find(
              (refund) => refund.id === refundId
            );
            if (!listed) throw new Error('no such refund at Stripe');
            listed.status = 'failed';
          }

          const createsOn = (chargeId: string) =>
            vi
              .mocked(fake.stripe.refunds.create)
              .mock.calls.filter(
                ([params]) =>
                  (params as Stripe.RefundCreateParams).charge === chargeId
              );

          it("the probe: our record lags Stripe (a refund failed there, its event not handled): support's sync first puts it in the set, so the £10.00 refund covers it, and a settle of it is refused: never £14.00 back on £10.00", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const standing = await standingAt(charge, 400);
            failedAtStripeOnly(charge.chargeId, standing.id);
            const said = supportErrors();
            const syncSaid = syncErrors();

            const made = await service.issueRefund(
              charge.chargeId,
              refundInput(1000, 1),
              supportId
            );
            created.stripeRefundIds.push(made.refund.id);
            // The refund.updated event lands now.
            await fails(standing.id);

            expect(made.refund.amountCents).toBe(1000);
            expect(newestAtStripe(charge.chargeId).metadata).toMatchObject({
              codex_covers: standing.id,
            });
            const standingRow = await rowIdOf(standing.id);
            expect(await coverOf(standingRow)).toEqual(covered(made.refund.id));
            expect(await queueRowOf(standingRow)).toBeUndefined();
            expect(
              (await failureOf(settleElsewhere(standingRow))).context
            ).toMatchObject({ code: 'ALREADY_SETTLED' });
            // Covered exactly by its own set: no cover had to be made up.
            expect([...said.mock.calls, ...syncSaid.mock.calls]).toEqual([]);
            said.mockRestore();
            syncSaid.mockRestore();
          });

          it("a refund that fails at Stripe BETWEEN support's sync and its list is paid by the refund and in no set: the sync after it counts the refund, so the cover of a payment that owes nothing covers it, alerted, and a settle of it is refused", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const standing = await standingAt(charge, 400);
            const list = vi.mocked(fake.stripe.refunds.list);
            const real = list.getMockImplementation();
            if (!real) throw new Error('the fake has no list');
            list.mockImplementationOnce(real).mockImplementationOnce((async (
              ...args: Parameters<typeof real>
            ) => {
              failedAtStripeOnly(charge.chargeId, standing.id);
              return real(...args);
            }) as never);
            const syncSaid = syncErrors();

            const made = await service.issueRefund(
              charge.chargeId,
              refundInput(1000, 1),
              supportId
            );
            created.stripeRefundIds.push(made.refund.id);

            const standingRow = await rowIdOf(standing.id);
            expect(await coverOf(standingRow)).toEqual(covered(made.refund.id));
            expect(
              linesOf(syncSaid, NOTHING_OWED_COVERED, charge.purchase.id)
            ).toEqual([
              [
                NOTHING_OWED_COVERED,
                expect.objectContaining({
                  source: 'refunds_sync',
                  coveringRefundId: made.refund.id,
                  coveredRefundIds: [standing.id],
                }),
              ],
            ]);
            expect(
              (await failureOf(settleElsewhere(standingRow))).context
            ).toMatchObject({ code: 'ALREADY_SETTLED' });
            syncSaid.mockRestore();
          });

          it("support's sync before it reads our record fails: no refund is asked of Stripe, and the request fails as a 5xx the page offers to retry", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            await failedAt(charge, 300);
            vi.mocked(fake.stripe.refunds.list).mockImplementationOnce(
              (async () => {
                throw Object.assign(new Error('socket hang up'), {
                  type: 'StripeConnectionError',
                });
              }) as never
            );

            const refused = await failureOf(
              service.issueRefund(
                charge.chargeId,
                refundInput(1000, 1),
                supportId
              )
            );

            expect(refused).toMatchObject({
              statusCode: 500,
              code: 'INTERNAL_ERROR',
            });
            expect(createsOn(charge.chargeId)).toEqual([]);
          });

          it("support's sync after its refund fails: the refund made is the answer, and one error line says so with the ids", async () => {
            const charge = await purchaseCharge(3600, lossBuyer);
            const inSet = await failedAt(charge, 300);
            const list = vi.mocked(fake.stripe.refunds.list);
            const real = list.getMockImplementation();
            if (!real) throw new Error('the fake has no list');
            list
              .mockImplementationOnce(real)
              .mockImplementationOnce(real)
              .mockImplementationOnce((async () => {
                throw Object.assign(new Error('socket hang up'), {
                  type: 'StripeConnectionError',
                });
              }) as never);
            const said = supportErrors();

            const made = await service.issueRefund(
              charge.chargeId,
              refundInput(1000, 1),
              supportId
            );
            created.stripeRefundIds.push(made.refund.id);

            expect(made).toMatchObject({
              replayed: false,
              refund: { amountCents: 1000 },
            });
            expect(await coverOf(inSet.id)).toEqual(covered(made.refund.id));
            expect(
              said.mock.calls.filter(
                ([message]) => message === SYNC_AFTER_FAILED
              )
            ).toEqual([
              [
                SYNC_AFTER_FAILED,
                {
                  errorId: expect.any(String),
                  chargeId: charge.chargeId,
                  refundId: made.refund.id,
                  purchaseId: charge.purchase.id,
                  code: null,
                  lockTimeout: false,
                  reason: 'socket hang up',
                },
              ],
            ]);
            said.mockRestore();
          });

          it("the backstop's search for payments that owe nothing failing logs its code and reason, never the failed query", async () => {
            const failedQuery = Object.assign(
              new Error(
                'Failed query: select "purchase_id" from "refunds" "open_failed"\nparams: ch_secret'
              ),
              {
                cause: Object.assign(
                  new Error('relation "open_failed" does not exist'),
                  { code: '42P01' }
                ),
              }
            );
            const broken = new Proxy(db, {
              get(target, property) {
                if (property === 'select') {
                  return () => {
                    throw failedQuery;
                  };
                }
                const value: unknown = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            const purchase = new PurchaseService(
              { db: broken, environment: 'test', ...createTestMoneyDeps() },
              fake.stripe
            );
            const errors = vi.spyOn(
              (
                purchase as unknown as {
                  obs: { error: (message: string, meta?: object) => void };
                }
              ).obs,
              'error'
            );

            await (
              purchase as unknown as {
                coverPaymentsOwingNothing: (limit: number) => Promise<void>;
              }
            ).coverPaymentsOwingNothing(10);

            const lines = errors.mock.calls.filter(([message]) =>
              message.startsWith('Could not look for failed refunds')
            );
            expect(lines).toEqual([
              [
                expect.any(String),
                {
                  errorId: expect.any(String),
                  code: '42P01',
                  lockTimeout: false,
                  reason: 'relation "open_failed" does not exist',
                },
              ],
            ]);
            expect(JSON.stringify(lines)).not.toContain('Failed query');
            expect(JSON.stringify(lines)).not.toContain('ch_secret');
          });

          it('the late win: one double payment is ONE incident to recover by hand; its overpaid check logs at info under the residual errorId, and a re-run of the adoption adds no new incident', async () => {
            let f1 = { id: '', stripeRefundId: '' };
            const sale = await shortLoss('unavailable', 1500, {
              paidCents: 1500,
              beforeLoss: async (charge) => {
                f1 = await failedAt(charge, 1500);
              },
            });
            const create = vi.mocked(fake.stripe.refunds.create);
            const make = create.getMockImplementation();
            if (!make) throw new Error('the fake has no create');
            create.mockImplementationOnce((async (
              ...args: Parameters<typeof make>
            ) => {
              await make(...args);
              throw Object.assign(new Error('socket hang up'), {
                type: 'StripeConnectionError',
              });
            }) as never);
            await wonLate(sale).catch(() => undefined);
            const own = newestAtStripe(sale.chargeId);
            expect(own.metadata).toMatchObject({
              codex_covers: f1.stripeRefundId,
            });
            // Settled elsewhere before the next run: the buyer has it twice.
            await settledElsewhereNow(f1.id);
            const { purchase, errors, infos } = watched();
            const byHand = () =>
              errors.mock.calls.filter(
                ([message, meta]) =>
                  message.endsWith('recover it by hand') &&
                  (meta as { purchaseId?: string } | undefined)?.purchaseId ===
                    sale.purchase.id
              );
            const incidents = () =>
              new Set(
                byHand().map(
                  ([, meta]) => (meta as { errorId: string }).errorId
                )
              );

            expect(await wonLate(sale, purchase)).toBe('done');

            expect(await lateWinRefundOf(sale.disputeId)).toBe(own.id);
            expect(byHand().length).toBeGreaterThan(0);
            expect(
              byHand().every(([message]) => message === REFUNDED_TWICE)
            ).toBe(true);
            expect(incidents().size).toBe(1);
            const [errorId] = [...incidents()];
            expect(
              infos.mock.calls.filter(
                ([message]) => message === LATE_WIN_OVERPAID_SEEN
              )
            ).toEqual([
              [
                LATE_WIN_OVERPAID_SEEN,
                expect.objectContaining({
                  errorId,
                  refundId: own.id,
                  overpaidCents: 1500,
                  refundedTwiceErrorIds: [errorId],
                }),
              ],
            ]);

            const row = takeFirst(
              await db
                .select()
                .from(purchases)
                .where(eq(purchases.id, sale.purchase.id))
            );
            await (
              purchase as unknown as {
                adoptLateWinRefund: (
                  disputeId: string,
                  purchase: typeof row,
                  chargeId: string,
                  own: Stripe.Refund
                ) => Promise<void>;
              }
            ).adoptLateWinRefund(sale.disputeId, row, sale.chargeId, own);

            expect(incidents()).toEqual(new Set([errorId]));
          });

          it('the blocked refund reads its set and its amount in ONE statement: with a failed, a standing and a settled-elsewhere refund, it asks what is owed and covers exactly the open failure', async () => {
            const sale = await blockedPending();
            const open = await failedAt(sale, 300);
            await standingAt(sale, 400);
            const elsewhere = await failedAt(sale, 200);
            await settledElsewhereNow(elsewhere.id);

            await sweepOnce();

            // £15.00 paid, less the standing £4.00 and the £2.00 paid another way.
            expect(blockedAsks(sale.paymentIntentId)).toEqual([
              [900, `refund_unavailable_${sale.paymentIntentId}_900`],
            ]);
            const made = blockedRefundOf(sale.chargeId);
            expect(made.metadata).toMatchObject({
              codex_covers: open.stripeRefundId,
            });
            expect(await coverOf(open.id)).toEqual(covered(made.id));
            expect((await coverOf(elsewhere.id)).resolution).toBe(
              'refunded_elsewhere'
            );
          });
        });
      });

      // Review r7: the one rule is keyed on the CHARGE. A refund on another
      // charge under the same purchase (no writer makes one: each links a
      // refund by its own PaymentIntent, which has one charge) counts for
      // nothing in this charge's debt, and its chargeback defers nothing.
      it("a refund on another charge under the same purchase counts nowhere in this charge's debt, and is not deferred by its chargeback", async () => {
        let failedElsewhere = '';
        const sale = await shortLoss('unavailable', 1000, {
          paidCents: 1500,
          beforeLoss: async (charge) => {
            const other = {
              chargeId: `ch_other${uid()}`,
              purchase: charge.purchase,
            };
            await refundOn(other, 300, 'succeeded');
            failedElsewhere = (await failedOn(other, 200)).id;
          },
        });

        expect(await stageOf(sale.chargeId)).toMatchObject({
          stage: 'short',
          refundedThroughStripeCents: 0,
          owedCents: 500,
        });
        expect(
          (await queueRowOf(failedElsewhere))?.waitingForChargeback
        ).toBeNull();
      });
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
        lookup: buyerEmail.toUpperCase(),
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
        lookup: bought.purchase.id,
        page: 1,
        limit: 20,
      });
      const byCharge = await service.searchCharges({
        lookup: invoice.chargeId,
        page: 1,
        limit: 20,
      });
      const bySubscription = await service.searchCharges({
        lookup: invoice.subscription.stripeSubscriptionId,
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
        lookup: 'no such thing',
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
    amountCents: number,
    metadata: Record<string, string> = {}
  ) {
    const refund = { id: `re_sup${uid()}`, amountCents, createdAt: 1 };
    created.stripeRefundIds.push(refund.id);
    // Stripe lists it too, failed: the engine's causes come from that list.
    fake.refundsByCharge.set(charge.chargeId, [
      ...(fake.refundsByCharge.get(charge.chargeId) ?? []),
      {
        id: refund.id,
        object: 'refund',
        amount: amountCents,
        charge: charge.chargeId,
        currency: 'gbp',
        status: 'failed',
        reason: 'requested_by_customer',
        failure_reason: 'expired_or_canceled_card',
        created: nowSeconds() - 120,
        metadata,
      } as unknown as Stripe.Refund,
    ]);
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
    it("dates a failed refund's charge from our record: a purchase's payment, an invoice's first slice", async () => {
      const bought = await purchaseCharge(2 * DAY);
      const onPurchase = await failedRefund(bought, 300);
      const invoice = await invoiceCharge();
      const onInvoice = takeFirst(
        await db
          .insert(refunds)
          .values({
            stripeRefundId: `re_sup${uid()}`,
            stripeChargeId: invoice.chargeId,
            amountCents: 300,
            currency: 'gbp',
            status: 'failed',
            failureReason: 'expired_or_canceled_card',
            stripeCreatedAt: new Date(),
          })
          .returning()
      );
      created.stripeRefundIds.push(onInvoice.stripeRefundId);
      const [firstSlice] = await db
        .select({ at: payouts.createdAt })
        .from(payouts)
        .where(
          and(
            eq(payouts.stripeChargeId, invoice.chargeId),
            eq(payouts.payoutType, 'platform_fee')
          )
        );

      const list = await service.listFailedRefunds({ page: 1, limit: 50 });
      const paidAtOf = (refundId: string) =>
        list.items.find((row) => row.refundId === refundId)?.chargePaidAt;

      expect(paidAtOf(onPurchase.id)).toBe(
        bought.purchase.purchasedAt?.toISOString()
      );
      expect(paidAtOf(onInvoice.id)).toBe(firstSlice?.at.toISOString());
    });

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

    it('says isFull is unknown (null), never "partial", for a charge we hold no record of (LOW-F)', async () => {
      const unknown = takeFirst(
        await db
          .insert(refunds)
          .values({
            stripeRefundId: `re_sup${uid()}`,
            stripeChargeId: `ch_sup${uid()}${uid()}`,
            amountCents: 300,
            currency: 'gbp',
            status: 'failed',
            failureReason: 'expired_or_canceled_card',
            stripeCreatedAt: new Date(),
          })
          .returning()
      );
      created.stripeRefundIds.push(unknown.stripeRefundId);

      const list = await service.listFailedRefunds({ page: 1, limit: 50 });

      expect(
        list.items.find((row) => row.refundId === unknown.id)
      ).toMatchObject({ kind: null, isFull: null });
    });

    it('predicts, read only, whether settling it would give access back: null for a failed full refund, else why not', async () => {
      const full = await purchaseCharge();
      const onFull = await failedRefund(full, 1000);
      await endAccess(full);
      const part = await purchaseCharge();
      const onPart = await failedRefund(part, 400);
      const rebought = await purchaseCharge();
      const onRebought = await failedRefund(rebought, 1000);
      await endAccess(rebought);
      // The buyer bought the same item again after it was refunded.
      const again = takeFirst(
        await db
          .insert(purchases)
          .values({
            customerId: buyerId,
            contentId: rebought.item.id,
            organizationId: orgId,
            status: PURCHASE_STATUS.COMPLETED,
            amountPaidCents: 1000,
            platformFeeCents: 100,
            organizationFeeCents: 135,
            creatorPayoutCents: 765,
            stripePaymentIntentId: `pi_sup${uid()}`,
            purchasedAt: new Date(),
          })
          .returning()
      );
      created.purchaseIds.push(again.id);

      const list = await service.listFailedRefunds({ page: 1, limit: 50 });
      const predicted = (refundId: string) =>
        list.items.find((row) => row.refundId === refundId)
          ?.accessRestoreBlockedReason;

      expect(predicted(onFull.id)).toBeNull();
      expect(predicted(onPart.id)).toBe('partial');
      expect(predicted(onRebought.id)).toBe('rebought');
      // Read only: the restore would restate a re-bought purchase; this did not.
      const [old] = await db
        .select({ refundAmountCents: purchases.refundAmountCents })
        .from(purchases)
        .where(eq(purchases.id, rebought.purchase.id));
      expect(old?.refundAmountCents).toBe(1000);
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
      expect(settled.settled.accessNotRestoredReason).toBeNull();
      expect(settled.restoredAccess).toEqual({
        restored: true,
        reason: null,
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
      expect(settled.settled.accessNotRestoredReason).toBe('partial');
      expect(settled.restoredAccess).toBeNull();
    });

    it('creators_repaid is refused (422) when a chargeback was shared against the failed refund, and re-pays nothing (HIGH-1)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await dispute(charge.chargeId, 'lost', charge.purchase.id);

      const error = await failureOf(
        service.resolveFailedRefund(
          failed.id,
          { resolution: 'creators_repaid', note: 'Re-pay' },
          supportId
        )
      );

      expect(error.statusCode).toBe(422);
      expect(error.context).toEqual({
        code: 'REPAY_BLOCKED_BY_LATER_CAUSE',
        reason: 'chargeback',
      });
      expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
      const [row] = await db
        .select({ resolvedAt: refunds.resolvedAt })
        .from(refunds)
        .where(eq(refunds.id, failed.id));
      expect(row?.resolvedAt).toBeNull();
    });

    it('creators_repaid is refused (422) when a later refund used up the charge with this one counted (HIGH-1)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      // Support refunded it again from the screen after the first one failed.
      stripeRefund(charge.chargeId, 1000, { created: nowSeconds() - 60 });

      const error = await failureOf(
        service.resolveFailedRefund(
          failed.id,
          { resolution: 'creators_repaid', note: 'Re-pay' },
          supportId
        )
      );

      expect(error.context).toEqual({
        code: 'REPAY_BLOCKED_BY_LATER_CAUSE',
        reason: 'later_refunds',
      });
      expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
    });

    // Owner D55, widened to duplicates by D57: a blocked payment paid no one
    // and granted nothing, so its failed refund is never "creators re-paid":
    // the buyer is still owed it. A blocked sale (Codex-z1t3c) is a payment
    // for an item its buyer could no longer open; a duplicate is a second
    // payment for one the buyer already has, which they keep.
    describe.each([
      {
        kind: 'unavailable' as const,
        marker: { refundReason: 'item_unavailable' },
        message:
          "There's no access to give back: the item was no longer available. The buyer is still owed this refund. Refund them another way, then settle it as refunded elsewhere.",
      },
      {
        kind: 'duplicate' as const,
        marker: { refundReason: null },
        message:
          "There's no access to give back: this was a second payment for something the buyer already has. The buyer is still owed this refund. Refund them another way, then settle it as refunded elsewhere.",
      },
    ])("a blocked payment's refund, $kind (owner D55, D57)", ({
      kind,
      marker,
      message,
    }) => {
      /**
       * A purchase as completion writes a blocked payment of this kind,
       * refunded after: no slices, no entitlement. A blocked sale's buyer has
       * no access; a duplicate's keeps it through their first purchase.
       */
      async function blockedSaleCharge() {
        const charge = await purchaseCharge();
        await db
          .delete(payouts)
          .where(eq(payouts.purchaseId, charge.purchase.id));
        await db
          .delete(entitlements)
          .where(eq(entitlements.sourceRef, charge.purchase.id));
        const refunded = {
          status: PURCHASE_STATUS.REFUNDED,
          refundedAt: new Date(),
          refundAmountCents: 1000,
        };
        if (kind === 'unavailable') {
          await db
            .delete(contentAccess)
            .where(eq(contentAccess.contentId, charge.item.id));
          await db
            .update(purchases)
            .set({ ...refunded, refundReason: 'item_unavailable' })
            .where(eq(purchases.id, charge.purchase.id));
          return charge;
        }
        // Refunded first, so the first purchase may be the completed one.
        await db
          .update(purchases)
          .set(refunded)
          .where(eq(purchases.id, charge.purchase.id));
        const first = takeFirst(
          await db
            .insert(purchases)
            .values({
              customerId: buyerId,
              contentId: charge.item.id,
              organizationId: orgId,
              status: PURCHASE_STATUS.COMPLETED,
              amountPaidCents: 1000,
              platformFeeCents: 100,
              organizationFeeCents: 135,
              creatorPayoutCents: 765,
              stripePaymentIntentId: `pi_sup_first${uid()}`,
              purchasedAt: new Date((nowSeconds() - 7200) * 1000),
            })
            .returning()
        );
        created.purchaseIds.push(first.id);
        await db
          .update(purchases)
          .set({ duplicateOfPurchaseId: first.id })
          .where(eq(purchases.id, charge.purchase.id));
        return charge;
      }

      const refundRow = async (id: string) =>
        takeFirst(await db.select().from(refunds).where(eq(refunds.id, id)));

      const purchaseRow = async (id: string) =>
        takeFirst(
          await db.select().from(purchases).where(eq(purchases.id, id))
        );

      it('refuses creators_repaid (422) before Stripe is read, writes nothing, and logs it at error', async () => {
        const charge = await blockedSaleCharge();
        const failed = await failedRefund(charge, 1000);
        const row = await refundRow(failed.id);
        const sale = await purchaseRow(charge.purchase.id);
        vi.mocked(fake.stripe.charges.retrieve).mockClear();
        vi.mocked(fake.stripe.refunds.list).mockClear();

        const error = await failureOf(
          service.resolveFailedRefund(
            failed.id,
            { resolution: 'creators_repaid', note: 'Re-pay' },
            supportId
          )
        );

        expect(error.code).toBe('BUSINESS_LOGIC_ERROR');
        expect(error.statusCode).toBe(422);
        expect(error.message).toBe(message);
        expect(error.context).toEqual({
          code: 'BLOCKED_PAYMENT_REFUND_NOT_REPAYABLE',
          purchaseId: charge.purchase.id,
          reason: kind,
        });
        // Refused before the re-pay's own reads of Stripe.
        expect(fake.stripe.charges.retrieve).not.toHaveBeenCalled();
        expect(fake.stripe.refunds.list).not.toHaveBeenCalled();
        expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
        expect(await refundRow(failed.id)).toEqual(row);
        expect(await purchaseRow(charge.purchase.id)).toEqual(sale);
        expect(serviceLog().error).toHaveBeenCalledWith(
          "A creators_repaid settlement of a blocked payment's refund was refused: the buyer is still owed it",
          {
            errorId: expect.any(String),
            stripeRefundId: failed.stripeRefundId,
            purchaseId: charge.purchase.id,
            kind,
          }
        );
      });

      it('still settles it refunded_elsewhere, granting nothing', async () => {
        const charge = await blockedSaleCharge();
        const failed = await failedRefund(charge, 1000);

        const settled = await service.resolveFailedRefund(
          failed.id,
          { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
          supportId
        );

        expect(settled.settled).toMatchObject({
          resolution: 'refunded_elsewhere',
          repaid: [],
          accessRestored: false,
        });
        expect(await refundRow(failed.id)).toMatchObject({
          resolution: 'refunded_elsewhere',
          resolvedByUserId: supportId,
          resolutionNote: 'Bank transfer',
        });
        expect(await purchaseRow(charge.purchase.id)).toMatchObject({
          status: PURCHASE_STATUS.REFUNDED,
          ...marker,
        });
        expect(
          await db
            .select({ id: entitlements.id })
            .from(entitlements)
            .where(eq(entitlements.sourceRef, charge.purchase.id))
        ).toEqual([]);
      });

      it("the queue marks a blocked payment's refund with its kind, and only it, so Re-pay is not offered", async () => {
        const queueRowOf = async (refundId: string) => {
          for (let page = 1; ; page++) {
            const list = await service.listFailedRefunds({ page, limit: 50 });
            const found = list.items.find((item) => item.refundId === refundId);
            if (found || page >= list.pagination.totalPages) return found;
          }
        };
        const blocked = await blockedSaleCharge();
        const onBlocked = await failedRefund(blocked, 1000);
        const ordinary = await purchaseCharge();
        const onOrdinary = await failedRefund(ordinary, 1000);
        await endAccess(ordinary);

        expect((await queueRowOf(onBlocked.id))?.blockedPayment).toBe(kind);
        expect((await queueRowOf(onOrdinary.id))?.blockedPayment).toBeNull();
      });
    });

    describe('a late win\'s own refund (owner decision 6, 2026-11-08, "Block it in code")', () => {
      const NOT_REPAYABLE =
        "This refund pays back a buyer who paid twice, so the creators can't be re-paid for it. Refund the buyer another way, then settle it as refunded elsewhere.";

      /** A late win, undone, whose own refund of the payment is `refundId`. */
      async function lateWinThatRefunded(
        charge: Awaited<ReturnType<typeof purchaseCharge>>,
        refundId: string | null
      ) {
        const won = await lateWin(charge.chargeId, charge.purchase.id, {
          undone: true,
        });
        await db
          .update(disputes)
          .set({ lateWinRefundId: refundId })
          .where(eq(disputes.stripeDisputeId, won.id));
        return won.id;
      }

      /** Every clawback step of the refund, as it stands. */
      const stepsOf = async (stripeRefundId: string) =>
        (
          await db
            .select()
            .from(payoutReversals)
            .where(eq(payoutReversals.causeId, stripeRefundId))
        ).sort((a, b) => a.id.localeCompare(b.id));

      const refundRow = async (id: string) =>
        takeFirst(await db.select().from(refunds).where(eq(refunds.id, id)));

      it('refuses creators_repaid (422) before Stripe is read, and writes nothing', async () => {
        const charge = await purchaseCharge();
        const failed = await failedRefund(charge, 1000);
        const disputeId = await lateWinThatRefunded(
          charge,
          failed.stripeRefundId
        );
        const row = await refundRow(failed.id);
        const steps = await stepsOf(failed.stripeRefundId);
        expect(steps.length).toBeGreaterThan(0);
        vi.mocked(fake.stripe.charges.retrieve).mockClear();
        vi.mocked(fake.stripe.refunds.list).mockClear();

        const error = await failureOf(
          service.resolveFailedRefund(
            failed.id,
            { resolution: 'creators_repaid', note: 'Re-pay' },
            supportId
          )
        );

        expect(error.statusCode).toBe(422);
        expect(error.message).toBe(NOT_REPAYABLE);
        expect(error.context).toEqual({
          code: 'LATE_WIN_REFUND_NOT_REPAYABLE',
          disputeId,
        });
        expect(fake.stripe.charges.retrieve).not.toHaveBeenCalled();
        expect(fake.stripe.refunds.list).not.toHaveBeenCalled();
        expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
        expect(await refundRow(failed.id)).toEqual(row);
        expect(await stepsOf(failed.stripeRefundId)).toEqual(steps);
      });

      it("refuses it by the refund's own metadata at Stripe when our record never got the late win's refund, and writes nothing (review cycle 2, finding 1)", async () => {
        const charge = await purchaseCharge();
        // The late win made the refund, then its write of the id failed.
        const disputeId = await lateWinThatRefunded(charge, null);
        const failed = await failedRefund(charge, 1000, {
          codex_late_win_dispute: disputeId,
        });
        const row = await refundRow(failed.id);
        const steps = await stepsOf(failed.stripeRefundId);
        vi.mocked(fake.stripe.charges.retrieve).mockClear();

        const error = await failureOf(
          service.resolveFailedRefund(
            failed.id,
            { resolution: 'creators_repaid', note: 'Re-pay' },
            supportId
          )
        );

        expect(error.statusCode).toBe(422);
        expect(error.context).toEqual({
          code: 'LATE_WIN_REFUND_NOT_REPAYABLE',
          disputeId,
        });
        // Refused before the re-pay's own reads of Stripe.
        expect(fake.stripe.charges.retrieve).not.toHaveBeenCalled();
        expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
        expect(await refundRow(failed.id)).toEqual(row);
        expect(await stepsOf(failed.stripeRefundId)).toEqual(steps);
      });

      it('refuses it under the lock when the late win records its refund while the settle reads Stripe, and writes nothing', async () => {
        const charge = await purchaseCharge();
        const failed = await failedRefund(charge, 1000);
        const disputeId = await lateWinThatRefunded(charge, null);
        const row = await refundRow(failed.id);
        const steps = await stepsOf(failed.stripeRefundId);
        // The settle's first Stripe read is the charge, after its first
        // check: the late win writes its refund's id meanwhile.
        vi.mocked(fake.stripe.charges.retrieve).mockImplementationOnce((async (
          id: string
        ) => {
          await db
            .update(disputes)
            .set({ lateWinRefundId: failed.stripeRefundId })
            .where(eq(disputes.stripeDisputeId, disputeId));
          return fake.charges.get(id);
        }) as never);

        const error = await failureOf(
          service.resolveFailedRefund(
            failed.id,
            { resolution: 'creators_repaid', note: 'Re-pay' },
            supportId
          )
        );

        expect(fake.stripe.charges.retrieve).toHaveBeenCalled();
        expect(error.statusCode).toBe(422);
        expect(error.context).toEqual({
          code: 'LATE_WIN_REFUND_NOT_REPAYABLE',
          disputeId,
        });
        expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
        expect(await refundRow(failed.id)).toEqual(row);
        expect(await stepsOf(failed.stripeRefundId)).toEqual(steps);
      });

      it('still settles it refunded_elsewhere, and its clawback stands', async () => {
        const charge = await purchaseCharge();
        const failed = await failedRefund(charge, 1000);
        await lateWinThatRefunded(charge, failed.stripeRefundId);
        const steps = await stepsOf(failed.stripeRefundId);

        const settled = await service.resolveFailedRefund(
          failed.id,
          { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
          supportId
        );

        expect(settled.settled).toMatchObject({
          resolution: 'refunded_elsewhere',
          repaid: [],
        });
        expect(await refundRow(failed.id)).toMatchObject({
          resolution: 'refunded_elsewhere',
          resolvedByUserId: supportId,
          resolutionNote: 'Bank transfer',
        });
        expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
        expect(await stepsOf(failed.stripeRefundId)).toEqual(steps);
      });

      it("still re-pays another failed refund of a late-won charge: only the late win's own refund is refused", async () => {
        const charge = await purchaseCharge();
        // Support's own refund of the payment, after the late win's: that one
        // is another, marked at Stripe and in our record.
        const failed = await failedRefund(charge, 1000);
        const disputeId = await lateWinThatRefunded(charge, null);
        const lateWinRefund = stripeRefund(charge.chargeId, 100, {
          created: nowSeconds() - 600,
          reason: 'duplicate',
          metadata: { codex_late_win_dispute: disputeId },
        });
        await db
          .update(disputes)
          .set({ lateWinRefundId: lateWinRefund.id })
          .where(eq(disputes.stripeDisputeId, disputeId));

        const settled = await service.resolveFailedRefund(
          failed.id,
          { resolution: 'creators_repaid', note: 'Re-pay' },
          supportId
        );
        for (const row of settled.settled.repaid) {
          created.payoutIds.push(row.payoutId);
        }

        expect(
          settled.settled.repaid
            .map((row) => row.amountCents)
            .sort((a, b) => a - b)
        ).toEqual([135, 765]);
        expect(await refundRow(failed.id)).toMatchObject({
          resolution: 'creators_repaid',
          resolvedByUserId: supportId,
        });
      });

      it("the queue says which open refund is a late win's own, on a charge not yet marked, by our record only (Codex-ohlcx)", async () => {
        /** The queue's row for the refund, read page by page (oldest first). */
        const queueRowOf = async (refundId: string) => {
          for (let page = 1; ; page++) {
            const list = await service.listFailedRefunds({ page, limit: 50 });
            const row = list.items.find((item) => item.refundId === refundId);
            if (row || page >= list.pagination.totalPages) return row;
          }
        };
        const own = await purchaseCharge(30 * DAY);
        const onOwn = await failedRefund(own, 1000);
        await lateWinThatRefunded(own, onOwn.stripeRefundId);
        // Its charge already marked refunded outside Stripe (by hand): a
        // settle would mark nothing, so there is nothing to warn of.
        const marked = await purchaseCharge(30 * DAY);
        const onMarked = await failedRefund(marked, 1000);
        const markedWin = await lateWinThatRefunded(
          marked,
          onMarked.stripeRefundId
        );
        await db
          .update(disputes)
          .set({ refundedOutsideStripeAt: new Date(Date.now() - 60_000) })
          .where(eq(disputes.stripeDisputeId, markedWin));
        const ordinary = await purchaseCharge(30 * DAY);
        const onOrdinary = await failedRefund(ordinary, 1000);
        // Known only by Stripe's metadata: no warning, by design.
        const byMetadata = await purchaseCharge(30 * DAY);
        const metadataWin = await lateWinThatRefunded(byMetadata, null);
        const onMetadata = await failedRefund(byMetadata, 1000, {
          codex_late_win_dispute: metadataWin,
        });

        expect((await queueRowOf(onOwn.id))?.isLateWinRefund).toBe(true);
        expect((await queueRowOf(onMarked.id))?.isLateWinRefund).toBe(false);
        expect((await queueRowOf(onOrdinary.id))?.isLateWinRefund).toBe(false);
        expect((await queueRowOf(onMetadata.id))?.isLateWinRefund).toBe(false);
      });

      describe('settled refunded elsewhere, the charge is refunded outside Stripe (review cycle 2, finding 2)', () => {
        const markOf = async (stripeDisputeId: string) =>
          takeFirst(
            await db
              .select({ at: disputes.refundedOutsideStripeAt })
              .from(disputes)
              .where(eq(disputes.stripeDisputeId, stripeDisputeId))
          ).at;

        const settleElsewhere = (refundId: string) =>
          service.resolveFailedRefund(
            refundId,
            { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
            supportId
          );

        it('with no new Stripe refund: the mark is written with the resolution, the detail blocks the charge and the route refuses it', async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          const disputeId = await lateWinThatRefunded(
            charge,
            failed.stripeRefundId
          );
          // The gap: Q7 keeps the window open for good, and Stripe doesn't
          // count the failed refund, so all of it is on offer.
          const before = await service.getChargeDetail(charge.chargeId);
          expect(before.refundable).toMatchObject({
            maxCents: 1000,
            blocked: null,
          });

          await settleElsewhere(failed.id);

          const at = await markOf(disputeId);
          expect(at).toBeInstanceOf(Date);
          expect(at).toEqual((await refundRow(failed.id)).resolvedAt);
          const detail = await service.getChargeDetail(charge.chargeId);
          // Settled refunded elsewhere, it counts as refunded (Codex-3xnta),
          // so nothing is left either; the block still comes first.
          expect(detail.refundable).toEqual({
            maxCents: 0,
            blocked: 'refunded_outside_stripe',
            refundedOutsideStripeOn: at?.toISOString(),
          });
          // As the form would send it: the failed refund is listed.
          const route = await failureOf(
            service.issueRefund(
              charge.chargeId,
              refundInput(100, detail.refundCount),
              supportId
            )
          );
          expect(route.statusCode).toBe(422);
          expect(route.context).toMatchObject({
            code: 'REFUNDED_OUTSIDE_STRIPE',
          });
          const preview = await failureOf(
            service.previewRefund(charge.chargeId, 100)
          );
          expect(preview.context).toMatchObject({
            code: 'REFUNDED_OUTSIDE_STRIPE',
          });
          expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
        });

        it("knows the late win's refund by Stripe's metadata when our record never got it", async () => {
          const charge = await purchaseCharge(30 * DAY);
          const disputeId = await lateWinThatRefunded(charge, null);
          const failed = await failedRefund(charge, 1000, {
            codex_late_win_dispute: disputeId,
          });

          await settleElsewhere(failed.id);

          expect(await markOf(disputeId)).toBeInstanceOf(Date);
          expect(
            (await service.getChargeDetail(charge.chargeId)).refundable.blocked
          ).toBe('refunded_outside_stripe');
        });

        it('after support refunded it again through Stripe: nothing is left to refund, so nothing is marked', async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          const disputeId = await lateWinThatRefunded(
            charge,
            failed.stripeRefundId
          );
          stripeRefund(charge.chargeId, 1000);

          await settleElsewhere(failed.id);

          expect(await markOf(disputeId)).toBeNull();
          expect(
            (await service.getChargeDetail(charge.chargeId)).refundable
          ).toMatchObject({ maxCents: 0, blocked: 'nothing_left' });
        });

        it("a re-refund still pending at the settle doesn't cover it: the charge is marked (review cycle 3)", async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          const disputeId = await lateWinThatRefunded(
            charge,
            failed.stripeRefundId
          );
          stripeRefund(charge.chargeId, 1000, { status: 'pending' });

          await settleElsewhere(failed.id);

          expect(await markOf(disputeId)).toBeInstanceOf(Date);
          expect(
            (await service.getChargeDetail(charge.chargeId)).refundable.blocked
          ).toBe('refunded_outside_stripe');
        });

        it('and if that re-refund then fails, the charge stays blocked: the route refuses it', async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          await lateWinThatRefunded(charge, failed.stripeRefundId);
          const reRefund = stripeRefund(charge.chargeId, 1000, {
            status: 'pending',
          });

          await settleElsewhere(failed.id);
          // Stripe fails it after the settle: neither refund stands now.
          (reRefund as unknown as { status: string }).status = 'failed';

          const detail = await service.getChargeDetail(charge.chargeId);
          // The first refund, settled refunded elsewhere, still counts
          // (Codex-3xnta); the failed re-refund doesn't.
          expect(detail.refundable).toMatchObject({
            maxCents: 0,
            blocked: 'refunded_outside_stripe',
          });
          const route = await failureOf(
            service.issueRefund(
              charge.chargeId,
              refundInput(100, detail.refundCount),
              supportId
            )
          );
          expect(route.statusCode).toBe(422);
          expect(route.context).toMatchObject({
            code: 'REFUNDED_OUTSIDE_STRIPE',
          });
          expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
        });

        it("another failed refund of a late-won charge leaves the mark alone: only the late win's own refund writes it", async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          const disputeId = await lateWinThatRefunded(charge, null);
          const lateWinRefund = stripeRefund(charge.chargeId, 100, {
            created: nowSeconds() - 600,
            reason: 'duplicate',
            metadata: { codex_late_win_dispute: disputeId },
          });
          await db
            .update(disputes)
            .set({ lateWinRefundId: lateWinRefund.id })
            .where(eq(disputes.stripeDisputeId, disputeId));

          await settleElsewhere(failed.id);

          expect(await markOf(disputeId)).toBeNull();
          expect(await refundRow(failed.id)).toMatchObject({
            resolution: 'refunded_elsewhere',
          });
        });

        /** Stripe can't be reached: every read the settle could make throws. */
        function stripeUnreachable() {
          const down = Object.assign(new Error('Stripe is unreachable'), {
            type: 'StripeConnectionError',
          });
          for (const read of [
            fake.stripe.refunds.list,
            fake.stripe.charges.retrieve,
          ]) {
            vi.mocked(read).mockRejectedValue(down);
            vi.mocked(read).mockClear();
          }
        }

        it("an ordinary failed refund settles while Stripe is unreachable: its charge has no late win, so Stripe isn't asked", async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          stripeUnreachable();

          const settled = await settleElsewhere(failed.id);

          expect(settled.settled.resolution).toBe('refunded_elsewhere');
          expect(await refundRow(failed.id)).toMatchObject({
            resolution: 'refunded_elsewhere',
            resolvedByUserId: supportId,
          });
          expect(fake.stripe.refunds.list).not.toHaveBeenCalled();
          expect(fake.stripe.charges.retrieve).not.toHaveBeenCalled();
        });

        it("on a late win's charge it fails closed while Stripe is unreachable: the refund stays open and nothing is marked", async () => {
          const charge = await purchaseCharge(30 * DAY);
          const disputeId = await lateWinThatRefunded(charge, null);
          const failed = await failedRefund(charge, 1000, {
            codex_late_win_dispute: disputeId,
          });
          stripeUnreachable();

          const error = await failureOf(settleElsewhere(failed.id));

          expect(error.statusCode).toBe(500);
          expect(fake.stripe.refunds.list).toHaveBeenCalled();
          expect(await refundRow(failed.id)).toMatchObject({
            resolution: null,
            resolvedAt: null,
          });
          expect(await markOf(disputeId)).toBeNull();
        });

        it('keeps a date already set', async () => {
          const charge = await purchaseCharge(30 * DAY);
          const failed = await failedRefund(charge, 1000);
          const disputeId = await lateWinThatRefunded(
            charge,
            failed.stripeRefundId
          );
          const earlier = new Date(Date.now() - 60 * 60_000);
          await db
            .update(disputes)
            .set({ refundedOutsideStripeAt: earlier })
            .where(eq(disputes.stripeDisputeId, disputeId));

          await settleElsewhere(failed.id);

          expect(await markOf(disputeId)).toEqual(earlier);
        });

        it("a late win's dispute not on the refund's charge rolls the settlement back: the refund stays open", async () => {
          const charge = await purchaseCharge(30 * DAY);
          // The charge has a late win of its own, so Stripe is asked, but
          // the refund's metadata names another charge's.
          await lateWinThatRefunded(charge, null);
          const other = await purchaseCharge(30 * DAY);
          const elsewhere = await lateWinThatRefunded(other, null);
          const failed = await failedRefund(charge, 1000, {
            codex_late_win_dispute: elsewhere,
          });

          const error = await failureOf(settleElsewhere(failed.id));

          expect(error.statusCode).toBe(500);
          expect(await refundRow(failed.id)).toMatchObject({
            resolution: null,
            resolvedAt: null,
          });
          expect(await markOf(elsewhere)).toBeNull();
        });
      });
    });

    /** The creator's step of a failed refund, as a dead delivery left it. */
    async function abandonCreatorStep(
      charge: Awaited<ReturnType<typeof purchaseCharge>>,
      stripeRefundId: string
    ) {
      const where = and(
        eq(payoutReversals.causeId, stripeRefundId),
        eq(payoutReversals.payoutId, charge.creator.id)
      );
      // Claimed by a delivery that died two days ago: no retry will run it.
      await db
        .update(payoutReversals)
        .set({
          status: 'pending',
          attemptedAt: new Date(Date.now() - 2 * DAY * 1000),
        })
        .where(where);
      return async () =>
        takeFirst(
          await db
            .select({ status: payoutReversals.status })
            .from(payoutReversals)
            .where(where)
        ).status;
    }

    it('a step a dead delivery left no longer blocks the settlement: its reversal landed, so it is done and re-paid (F3, LOW-4)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      const statusOf = await abandonCreatorStep(charge, failed.stripeRefundId);

      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Re-pay' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      expect(
        settled.settled.repaid
          .map((row) => row.amountCents)
          .sort((a, b) => a - b)
      ).toEqual([135, 765]);
      expect(await statusOf()).toBe('done');
    });

    it('a step a dead delivery left, whose reversal never landed, is cancelled and not re-paid (F3)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      const statusOf = await abandonCreatorStep(charge, failed.stripeRefundId);
      vi.mocked(fake.stripe.transfers.listReversals).mockResolvedValue({
        object: 'list',
        data: [],
        has_more: false,
      } as never);

      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Re-pay' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      // Only the organisation's cancellation took money: it alone is re-paid.
      expect(settled.settled.repaid.map((row) => row.amountCents)).toEqual([
        135,
      ]);
      expect(await statusOf()).toBe('cancelled');
    });

    /**
     * The organisation's unpaid slice was cancelled by the refund; its step is
     * put back to pending, as a delivery that died after the cancel leaves it.
     */
    async function strandOrgStep(
      charge: Awaited<ReturnType<typeof purchaseCharge>>,
      stripeRefundId: string
    ) {
      await db
        .update(payoutReversals)
        .set({
          status: 'pending',
          attemptedAt: new Date(Date.now() - 2 * DAY * 1000),
        })
        .where(
          and(
            eq(payoutReversals.causeId, stripeRefundId),
            eq(payoutReversals.payoutId, charge.org.id)
          )
        );
    }

    it('a stranded cancellation on its own cancelled slice is settled by the system: it took the share, so it is re-paid, and the notice names the payee (Codex-2hxff.71, was LOW-C)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await strandOrgStep(charge, failed.stripeRefundId);

      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Re-pay' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      expect(
        settled.settled.repaid.map((row) => row.amountCents).sort()
      ).toEqual([135, 765]);
      const [owner] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ownerId));
      expect(settled.settled.systemSettled).toEqual([
        {
          payoutId: charge.org.id,
          payeeName: owner?.name ?? null,
          decision: 'took_share',
        },
      ]);
      // The charge page's history says what the system decided.
      const detail = await service.getChargeDetail(charge.chargeId);
      const org = detail.slices.find((row) => row.payoutId === charge.org.id);
      expect(org?.history).toEqual([
        expect.objectContaining({
          outcome: 'paid_back',
          systemDecision: 'took_share',
        }),
      ]);
    });

    it("a stranded cancellation whose payee kept a late transfer: not re-paid, the notice says payee_kept, and the alert is raised with the settlement under its credit's errorId (review LOW-8)", async () => {
      const charge = await purchaseCharge();
      // The organisation's slice goes to a payee with an account, so a drain
      // could still send it a transfer.
      const payeeId = takeFirst(await seedTestUsers(db, 1));
      const accountId = `acct_sup${uid()}`;
      created.connectUserIds.push(payeeId);
      await db.insert(stripeConnectAccounts).values({
        userId: payeeId,
        stripeAccountId: accountId,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });
      await db
        .update(payouts)
        .set({ userId: payeeId })
        .where(eq(payouts.id, charge.org.id));
      const failed = await failedRefund(charge, 1000);
      await strandOrgStep(charge, failed.stripeRefundId);
      // The drain's transfer, sent after the cancel and never reversed.
      const transfer = await fake.stripe.transfers.create({
        amount: 135,
        currency: 'gbp',
        destination: accountId,
        metadata: { payout_id: charge.org.id },
      });

      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Re-pay' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      // Only the creator's reversed share is re-paid: the payee kept theirs.
      expect(settled.settled.repaid.map((row) => row.amountCents)).toEqual([
        765,
      ]);
      const [payee] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, payeeId));
      expect(settled.settled.systemSettled).toEqual([
        {
          payoutId: charge.org.id,
          payeeName: payee?.name ?? null,
          decision: 'payee_kept',
        },
      ]);
      const [credit] = await db
        .select()
        .from(payeeCredits)
        .where(eq(payeeCredits.payoutId, charge.org.id));
      expect(credit).toMatchObject({
        effect: 'transfer_kept',
        resolution: 'not_owed',
      });
      expect(serviceLog().error).toHaveBeenCalledWith(
        expect.stringContaining('the payee kept it'),
        expect.objectContaining({
          errorId: credit?.alertErrorId,
          stripeRefundId: failed.stripeRefundId,
          payoutId: charge.org.id,
          stripeTransferId: transfer.id,
        })
      );
    });

    it('a stranded cancellation the rule cannot decide (another refund cancelled there too) refuses with its own 422, REFUND_CLAWBACK_NEEDS_PERSON, not "try again" (round 2 LOW-C)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await strandOrgStep(charge, failed.stripeRefundId);
      await db.insert(payoutReversals).values({
        payoutId: charge.org.id,
        causeType: 'refund',
        causeId: `re_sup${uid()}`,
        amountCents: 135,
        kind: 'cancellation',
        status: 'pending',
        attemptedAt: new Date(Date.now() - 2 * DAY * 1000),
      });

      const error = await failureOf(
        service.resolveFailedRefund(
          failed.id,
          { resolution: 'creators_repaid', note: 'Re-pay' },
          supportId
        )
      );

      expect(error.statusCode).toBe(422);
      expect(error.context).toEqual({
        code: 'REFUND_CLAWBACK_NEEDS_PERSON',
        steps: 1,
      });
      expect(error.message).not.toContain('Try again later');
      expect(await repayRowsOf(failed.stripeRefundId)).toEqual([]);
    });

    it('a failed refund recorded without its purchase finds it from the charge, and still gives access back (F4)', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await endAccess(charge);
      await db
        .update(refunds)
        .set({ purchaseId: null })
        .where(eq(refunds.id, failed.id));

      const list = await service.listFailedRefunds({ page: 1, limit: 50 });
      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Buyer keeps the item' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      // The queue names it from its charge's purchase slices too.
      expect(
        list.items.find((row) => row.refundId === failed.id)
      ).toMatchObject({
        kind: 'purchase',
        title: charge.item.title,
        isFull: true,
      });
      expect(settled.settled.accessRestored).toBe(true);
    });

    it("predicts by the settle's own routes: a refund naming no purchase, on a charge only Stripe ties to one (D8), would give access back, and does (LOW-H)", async () => {
      const charge = await purchaseCharge();
      // No slice, refund or dispute of ours names the charge's purchase, so
      // only its PaymentIntent does: the slices were never recorded, and the
      // refund was recorded before its purchase.
      await db
        .delete(payouts)
        .where(eq(payouts.purchaseId, charge.purchase.id));
      const failed = takeFirst(
        await db
          .insert(refunds)
          .values({
            stripeRefundId: `re_sup${uid()}`,
            stripeChargeId: charge.chargeId,
            amountCents: 1000,
            currency: 'gbp',
            status: 'failed',
            failureReason: 'expired_or_canceled_card',
            stripeCreatedAt: new Date(),
          })
          .returning()
      );
      created.stripeRefundIds.push(failed.stripeRefundId);
      fake.refundsByCharge.set(charge.chargeId, [
        {
          id: failed.stripeRefundId,
          object: 'refund',
          amount: 1000,
          charge: charge.chargeId,
          currency: 'gbp',
          status: 'failed',
          reason: 'requested_by_customer',
          failure_reason: 'expired_or_canceled_card',
          created: nowSeconds() - 120,
          metadata: {},
        } as unknown as Stripe.Refund,
      ]);
      await endAccess(charge);

      const list = await service.listFailedRefunds({ page: 1, limit: 50 });
      const settled = await service.resolveFailedRefund(
        failed.id,
        { resolution: 'creators_repaid', note: 'Buyer keeps the item' },
        supportId
      );
      for (const row of settled.settled.repaid) {
        created.payoutIds.push(row.payoutId);
      }

      expect(
        list.items.find((row) => row.refundId === failed.id)
      ).toMatchObject({
        kind: 'purchase',
        isFull: true,
        accessRestoreBlockedReason: null,
      });
      expect(settled.settled.accessRestored).toBe(true);
    });

    it("a charge Stripe can't serve makes that row's prediction unknown, never a promise; the page and the other rows are intact", async () => {
      const intact = await purchaseCharge();
      const onIntact = await failedRefund(intact, 1000);
      await endAccess(intact);
      // Only Stripe ties this charge to its purchase, and Stripe is failing.
      const broken = await purchaseCharge();
      await db
        .delete(payouts)
        .where(eq(payouts.purchaseId, broken.purchase.id));
      const onBroken = takeFirst(
        await db
          .insert(refunds)
          .values({
            stripeRefundId: `re_sup${uid()}`,
            stripeChargeId: broken.chargeId,
            amountCents: 1000,
            currency: 'gbp',
            status: 'failed',
            failureReason: 'expired_or_canceled_card',
            stripeCreatedAt: new Date(),
          })
          .returning()
      );
      created.stripeRefundIds.push(onBroken.stripeRefundId);
      await endAccess(broken);
      const retrieve = vi.mocked(fake.stripe.charges.retrieve);
      const served = retrieve.getMockImplementation();
      retrieve.mockImplementation((async (id: string, ...rest: unknown[]) => {
        if (id === broken.chargeId) {
          throw Object.assign(new Error('Stripe is unavailable'), {
            type: 'StripeAPIError',
            statusCode: 500,
            requestId: 'req_supdown',
          });
        }
        return (served as (...a: unknown[]) => unknown)(id, ...rest);
      }) as never);

      const list = await service.listFailedRefunds({ page: 1, limit: 50 });
      const itemOf = (refundId: string) =>
        list.items.find((row) => row.refundId === refundId);

      expect(itemOf(onBroken.id)).toMatchObject({
        accessRestoreBlockedReason: 'unknown',
        isFull: null,
      });
      expect(itemOf(onIntact.id)).toMatchObject({
        kind: 'purchase',
        isFull: true,
        accessRestoreBlockedReason: null,
      });
      expect(serviceLog().warn).toHaveBeenCalledWith(
        "A failed refund's charge could not be read: its access prediction is unknown",
        {
          chargeId: broken.chargeId,
          stripeRequestId: 'req_supdown',
          statusCode: 500,
        }
      );
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

      // One row per person (Codex-2hxff.73, §4.3): the debt is under its payee.
      const list = await service.listCreatorDebts({ page: 1, limit: 50 });
      const person = list.items.find((row) => row.payee.userId === creatorId);
      expect(person).toMatchObject({
        state: 'needs_settling',
        clock: null,
        negativeSince: null,
        stripeHeld: [],
      });
      const item = person?.recordedDebts.find(
        (row) => row.reviewId === review.id
      );
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

    // ── per person, with Stripe's balance (Codex-2hxff.73, .30; §4.3) ──

    /** A `connect_balances` row as the daily job leaves it. */
    async function balance(
      userId: string,
      values: Partial<typeof connectBalances.$inferInsert>
    ) {
      created.balanceUserIds.push(userId);
      const stripeAccountId = `acct_sup${uid()}`;
      await db.insert(connectBalances).values({
        stripeAccountId,
        userId,
        manualPayoutsSince: new Date(Date.now() - 200 * DAY * 1000),
        checkedAt: new Date(Date.now() - 3600_000),
        ...values,
      });
      return stripeAccountId;
    }

    /** Stripe's live balance per account; a missing one fails, as a timeout. */
    function liveBalances(available: Record<string, number>) {
      const retrieve = vi.fn(
        async (_params: unknown, options: { stripeAccount: string }) => {
          const cents = available[options.stripeAccount];
          if (cents === undefined) {
            throw Object.assign(new Error('timed out'), {
              type: 'StripeConnectionError',
            });
          }
          return {
            object: 'balance',
            available: [{ amount: cents, currency: 'gbp' }],
            pending: [{ amount: 0, currency: 'gbp' }],
          };
        }
      );
      (fake.stripe as unknown as { balance: unknown }).balance = { retrieve };
      return retrieve;
    }

    const daysAgo = (days: number) => new Date(Date.now() - days * DAY * 1000);

    it('lists Creator debts one row per person, oldest first: the live balance, back so far and its clock; a refused debt beside it is never double-counted; a failed read shows the snapshot; the badge counts only people who need a person (OQ2)', async () => {
      const [held, both, unread] = await seedTestUsers(db, 3);
      if (!held || !both || !unread) throw new Error('expected 3 users');
      const before = await service.getQueueCounts();

      // Held by Stripe, over £50 for 100 days: To invoice.
      const heldAccount = await balance(held, {
        availableCents: -6240,
        pendingCents: 0,
        negativeAfter: daysAgo(101),
        negativeSince: daysAgo(100),
      });
      const heldSlice = await slice({
        payoutType: 'creator_payout',
        userId: held,
        amountCents: 7400,
        status: 'paid',
        stripeChargeId: `ch_sup${uid()}`,
        stripeTransferId: `tr_sup${uid()}`,
      });
      const takeBack = takeFirst(
        await db
          .insert(payoutReversals)
          .values({
            payoutId: heldSlice.id,
            causeType: 'dispute',
            causeId: `du_sup${uid()}`,
            amountCents: 7400,
            kind: 'transfer_reversal',
            status: 'done',
            stripeReversalId: `trr_sup${uid()}`,
            resolvedAt: new Date(daysAgo(101).getTime() + 3600_000),
          })
          .returning()
      );
      // Below zero for 10 days, and a debt Stripe refused, on another sale.
      const bothAccount = await balance(both, {
        availableCents: -900,
        pendingCents: 0,
        negativeAfter: daysAgo(11),
        negativeSince: daysAgo(10),
      });
      const refusedSlice = await slice({
        payoutType: 'organization_fee',
        userId: both,
        amountCents: 450,
        status: 'paid',
        stripeChargeId: `ch_sup${uid()}`,
        stripeTransferId: `tr_sup${uid()}`,
      });
      const refusedStep = takeFirst(
        await db
          .insert(payoutReversals)
          .values({
            payoutId: refusedSlice.id,
            causeType: 'refund',
            causeId: `re_sup${uid()}`,
            amountCents: 450,
            kind: 'transfer_reversal',
            status: 'debt',
            lastErrorCode: 'insufficient_funds',
          })
          .returning()
      );
      await db.insert(refundReviews).values({
        payoutReversalId: refusedStep.id,
        payoutId: refusedSlice.id,
        creatorUserId: both,
        attemptedReversalCents: 450,
        errorCode: 'insufficient_funds',
      });
      // Below zero 3 days; Stripe can't be read for it now.
      await balance(unread, {
        availableCents: -1200,
        pendingCents: 0,
        negativeSince: daysAgo(3),
      });
      const retrieve = liveBalances({
        [heldAccount]: -5820,
        [bothAccount]: -840,
      });

      const list = await service.listCreatorDebts({ page: 1, limit: 50 });
      const ours = list.items.filter((row) =>
        [held, both, unread].includes(row.payee.userId)
      );

      expect(ours.map((row) => row.payee.userId)).toEqual([held, both, unread]);
      const [heldRow, bothRow, unreadRow] = ours;
      expect(heldRow).toMatchObject({
        payee: { roles: ['creator'] },
        stripe: { availableCents: -5820, live: true },
        stripeOwedCents: 5820,
        totalOwedCents: 5820,
        // 74.00 taken since the last morning at or above zero; 58.20 owed now.
        backCents: 1580,
        recordedDebts: [],
        state: 'to_invoice',
        clock: { kind: 'invoice', daysLeft: 0 },
        negativeSince: expect.any(String),
      });
      expect(heldRow?.stripeHeld).toEqual([
        expect.objectContaining({
          payoutReversalId: takeBack.id,
          amountCents: 7400,
          stripeReversalId: takeBack.stripeReversalId,
          cause: expect.objectContaining({ type: 'dispute' }),
        }),
      ]);
      expect(bothRow).toMatchObject({
        payee: { roles: ['organisation_owner'] },
        stripeOwedCents: 840,
        totalOwedCents: 1290,
        state: 'recovering',
        clock: { kind: 'stripe_writes_off' },
        stripeHeld: [],
      });
      expect(bothRow?.recordedDebts).toEqual([
        expect.objectContaining({ owedCents: 450, owedCreditId: null }),
      ]);
      expect(unreadRow).toMatchObject({
        stripe: { availableCents: -1200, live: false },
        stripeOwedCents: 1200,
        backCents: null,
        state: 'recovering',
      });
      // One live read per listed account; never the acct_ id in the answer.
      expect(retrieve).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ stripeAccount: heldAccount, timeout: 5000 })
      );
      expect(JSON.stringify(ours)).not.toContain('acct_');

      // The badge: the To invoice person and the refused debt; not the rest.
      const after = await service.getQueueCounts();
      expect(after.creatorDebts - before.creatorDebts).toBe(2);
      // Paginated by person.
      const one = await service.listCreatorDebts({ page: 1, limit: 1 });
      expect(one.items).toHaveLength(1);
      expect(one.pagination.total).toBe(list.pagination.total);
    });

    it("a live balance Stripe refuses the key for is an error with an errorId, a configuration fault; a timeout stays a warning; both log Stripe's answer (review MED-6)", async () => {
      const [refused, slow] = await seedTestUsers(db, 2);
      if (!refused || !slow) throw new Error('two users were seeded');
      const refusedAccount = await balance(refused, {
        availableCents: -900,
        pendingCents: 0,
        negativeSince: daysAgo(3),
      });
      await balance(slow, {
        availableCents: -700,
        pendingCents: 0,
        negativeSince: daysAgo(3),
      });
      (fake.stripe as unknown as { balance: unknown }).balance = {
        retrieve: vi.fn(
          async (_params: unknown, options: { stripeAccount: string }) => {
            if (options.stripeAccount === refusedAccount) {
              throw Object.assign(
                new Error(
                  'The provided key does not have the required permissions for this endpoint'
                ),
                {
                  type: 'StripePermissionError',
                  statusCode: 403,
                  requestId: 'req_sup403',
                }
              );
            }
            throw Object.assign(new Error('timed out'), {
              type: 'StripeConnectionError',
            });
          }
        ),
      };

      const list = await service.listCreatorDebts({ page: 1, limit: 50 });
      const ours = list.items.filter((row) =>
        [refused, slow].includes(row.payee.userId)
      );

      // Both show the morning snapshot, and say so.
      expect(ours.map((row) => row.stripe.live)).toEqual([false, false]);
      expect(serviceLog().error).toHaveBeenCalledWith(
        expect.stringContaining('Balance: Read'),
        expect.objectContaining({
          errorId: expect.any(String),
          userId: refused,
          statusCode: 403,
          stripeErrorType: 'StripePermissionError',
          stripeRequestId: 'req_sup403',
          stripeMessage: expect.stringContaining('required permissions'),
        })
      );
      expect(serviceLog().warn).toHaveBeenCalledWith(
        expect.stringContaining('could not be read'),
        expect.objectContaining({
          userId: slow,
          statusCode: null,
          stripeErrorType: 'StripeConnectionError',
          stripeMessage: 'timed out',
        })
      );
      expect(serviceLog().error).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: slow })
      );
    });

    // ── a debt over £50 Stripe collected (design §14; AMENDMENT 2) ──────

    /** The person's row on the tab, if listed. */
    async function debtRowOf(userId: string) {
      const list = await service.listCreatorDebts({ page: 1, limit: 100 });
      return list.items.filter((row) => row.payee.userId === userId);
    }

    it('collected by Stripe over £50, nothing below zero now: still listed To invoice with what was collected, and counted', async () => {
      const userId = takeFirst(await seedTestUsers(db, 1));
      const collectedAt = daysAgo(2);
      const accountId = await balance(userId, {
        availableCents: 300,
        pendingCents: 0,
        negativeSince: null,
        // The episode Stripe collected: below zero from 182 days ago.
        clearedSince: daysAgo(182),
        clearedAt: collectedAt,
        clearedReason: 'stripe_collected',
        clearedOwedCents: 7200,
        collectedOwedCents: 7200,
        collectedAt,
      });
      liveBalances({ [accountId]: 300 });
      const before = await service.getQueueCounts();

      const rows = await debtRowOf(userId);

      expect(rows).toEqual([
        expect.objectContaining({
          state: 'to_invoice',
          collectedCents: 7200,
          collectedAt: collectedAt.toISOString(),
          negativeSince: null,
          stripeOwedCents: 0,
          totalOwedCents: 7200,
          clock: null,
          oldestAt: collectedAt.toISOString(),
        }),
      ]);
      // Counted: remove the collected debt, and the badge drops by one.
      await db
        .update(connectBalances)
        .set({ collectedOwedCents: null, collectedAt: null })
        .where(eq(connectBalances.stripeAccountId, accountId));
      expect((await service.getQueueCounts()).creatorDebts).toBe(
        before.creatorDebts - 1
      );
    });

    it('collected over £50 AND below zero again (over £50, 90 days): ONE row carrying both, counted once', async () => {
      const userId = takeFirst(await seedTestUsers(db, 1));
      const collectedAt = daysAgo(120);
      const accountId = await balance(userId, {
        availableCents: -6000,
        pendingCents: 0,
        negativeSince: daysAgo(95),
        collectedOwedCents: 6500,
        collectedAt,
      });
      liveBalances({ [accountId]: -6000 });
      const counted = await service.getQueueCounts();

      const rows = await debtRowOf(userId);

      expect(rows).toEqual([
        expect.objectContaining({
          state: 'to_invoice',
          collectedCents: 6500,
          collectedAt: collectedAt.toISOString(),
          negativeSince: expect.any(String),
          stripeOwedCents: 6000,
          totalOwedCents: 12_500,
          clock: expect.objectContaining({ kind: 'invoice' }),
          oldestAt: collectedAt.toISOString(),
        }),
      ]);
      // Both reasons, one person: remove the collected debt and the count
      // stays, as the balance alone still needs a person.
      await db
        .update(connectBalances)
        .set({ collectedOwedCents: null, collectedAt: null })
        .where(eq(connectBalances.stripeAccountId, accountId));
      expect((await service.getQueueCounts()).creatorDebts).toBe(
        counted.creatorDebts
      );
      // And with the balance back to zero too, it drops by one.
      await db
        .update(connectBalances)
        .set({ availableCents: 0, negativeSince: null })
        .where(eq(connectBalances.stripeAccountId, accountId));
      expect((await service.getQueueCounts()).creatorDebts).toBe(
        counted.creatorDebts - 1
      );
    });

    it('collected by Stripe at £50 or less: written off, so neither listed nor counted', async () => {
      const userId = takeFirst(await seedTestUsers(db, 1));
      const accountId = await balance(userId, {
        availableCents: 0,
        pendingCents: 0,
        negativeSince: null,
        clearedSince: daysAgo(182),
        clearedAt: daysAgo(2),
        clearedReason: 'stripe_collected',
        clearedOwedCents: 4000,
      });
      liveBalances({ [accountId]: 0 });
      const before = await service.getQueueCounts();

      expect(await debtRowOf(userId)).toEqual([]);
      await db
        .delete(connectBalances)
        .where(eq(connectBalances.stripeAccountId, accountId));
      expect((await service.getQueueCounts()).creatorDebts).toBe(
        before.creatorDebts
      );
    });

    // ── Owed to creators (Codex-2hxff.73; §7) ───────────────────────────

    /** A late take-back on the creator's settled step: its credit, open. */
    async function lateTakeBack(
      charge: Awaited<ReturnType<typeof purchaseCharge>>,
      effect: 'reversal_landed' | 'unverified' = 'reversal_landed'
    ) {
      const step = takeFirst(
        await db
          .insert(payoutReversals)
          .values({
            payoutId: charge.creator.id,
            causeType: 'refund',
            causeId: `re_sup${uid()}`,
            amountCents: 765,
            kind: 'transfer_reversal',
            status: 'cancelled',
            resolvedAt: new Date(),
          })
          .returning()
      );
      const credit = takeFirst(
        await db
          .insert(payeeCredits)
          .values({
            payoutReversalId: step.id,
            payoutId: charge.creator.id,
            payeeUserId: creatorId,
            effect,
            amountCents: effect === 'unverified' ? null : 700,
            stripeReversalId:
              effect === 'unverified' ? null : `trr_sup${uid()}`,
            stripeTransferId: charge.creator.stripeTransferId,
            settledAs: 'cancelled',
            alertErrorId: crypto.randomUUID(),
          })
          .returning()
      );
      return { step, credit };
    }

    it('Owed to creators: lists an open credit with its one action, the charge page reads "taken after it was settled", Re-pay writes the payout and the line turns paid back', async () => {
      const charge = await purchaseCharge();
      const { credit } = await lateTakeBack(charge);
      const before = await service.getQueueCounts();

      const list = await service.listOwedToCreators({ page: 1, limit: 50 });
      expect(list.items.find((row) => row.creditId === credit.id)).toEqual({
        creditId: credit.id,
        payoutId: charge.creator.id,
        payee: expect.objectContaining({ userId: creatorId, role: 'creator' }),
        state: 'owed',
        effect: 'reversal_landed',
        amountCents: 700,
        repayCents: 700,
        stepAmountCents: 765,
        settledAs: 'cancelled',
        stripeReversalId: credit.stripeReversalId,
        chargeId: charge.chargeId,
        title: charge.item.title,
        organizationName: 'Support Org',
        buyerName: expect.any(String),
        cause: expect.objectContaining({ type: 'refund' }),
        debt: null,
        action: 'repay',
        foundAt: credit.foundAt.toISOString(),
        checkedAt: null,
      });
      const detail = await service.getChargeDetail(charge.chargeId);
      const creator = detail.slices.find(
        (row) => row.payoutId === charge.creator.id
      );
      expect(creator?.owedToPayeeCents).toBe(700);
      expect(
        creator?.history.find((line) => line.credit?.creditId === credit.id)
      ).toMatchObject({
        outcome: 'taken_after_settled',
        credit: { state: 'owed', amountCents: 700, action: 'repay' },
      });

      const repaid = await service.resolveOwedToCreator(
        credit.id,
        { action: 'repay', note: '' },
        supportId
      );
      expect(repaid).toMatchObject({
        creditId: credit.id,
        resolution: 'repaid',
        repayPayoutId: expect.any(String),
        amountCents: 700,
      });
      const after = await service.getQueueCounts();
      expect(before.owedToCreators - after.owedToCreators).toBe(1);
      const line = (await service.getChargeDetail(charge.chargeId)).slices
        .find((row) => row.payoutId === charge.creator.id)
        ?.history.find((h) => h.credit?.creditId === credit.id);
      expect(line).toMatchObject({
        outcome: 'paid_back',
        credit: {
          state: 'repaid',
          action: null,
          repayPayout: { id: repaid.repayPayoutId, status: 'pending' },
        },
      });
      // Another answer once settled is a 409.
      const other = await failureOf(
        service.resolveOwedToCreator(
          credit.id,
          { action: 'not_owed', note: 'no' },
          supportId
        )
      );
      expect(other.statusCode).toBe(409);
    });

    it('Check Stripe again: nothing taken closes it as not owed by the system, with that note', async () => {
      const charge = await purchaseCharge();
      const { credit } = await lateTakeBack(charge, 'unverified');
      vi.mocked(fake.stripe.transfers.listReversals).mockResolvedValue({
        object: 'list',
        data: [],
        has_more: false,
      } as never);

      const checked = await service.checkOwedToCreator(credit.id);

      expect(checked).toMatchObject({
        creditId: credit.id,
        outcome: 'not_owed',
        state: 'not_owed',
        note: 'Stripe shows nothing was taken',
        action: null,
      });
      const list = await service.listOwedToCreators({ page: 1, limit: 50 });
      expect(list.items.some((row) => row.creditId === credit.id)).toBe(false);
    });

    it('a cancellation the ledger cannot attribute: listed needs_person with Decide and the share Re-pay pays, a check says so and alerts, and Re-pay needs the note (review MED-3)', async () => {
      const charge = await purchaseCharge();
      // The organisation's unpaid 135 was cancelled by a refund, and two
      // refunds' cancellations are on it: the ledger cannot say which.
      await db
        .update(payouts)
        .set({ status: 'cancelled_by_refund' })
        .where(eq(payouts.id, charge.org.id));
      const cancellation = () =>
        db
          .insert(payoutReversals)
          .values({
            payoutId: charge.org.id,
            causeType: 'refund',
            causeId: `re_sup${uid()}`,
            amountCents: 135,
            kind: 'cancellation',
            status: 'cancelled',
            resolvedAt: new Date(),
          })
          .returning();
      const step = takeFirst(await cancellation());
      await cancellation();
      const credit = takeFirst(
        await db
          .insert(payeeCredits)
          .values({
            payoutReversalId: step.id,
            payoutId: charge.org.id,
            payeeUserId: ownerId,
            effect: 'unverified',
            settledAs: 'cancelled',
            alertErrorId: crypto.randomUUID(),
          })
          .returning()
      );

      const list = await service.listOwedToCreators({ page: 1, limit: 50 });
      expect(
        list.items.find((row) => row.creditId === credit.id)
      ).toMatchObject({
        state: 'needs_person',
        action: 'decide',
        effect: 'unverified',
        amountCents: null,
        repayCents: 135,
      });
      const detail = await service.getChargeDetail(charge.chargeId);
      expect(
        detail.slices
          .find((row) => row.payoutId === charge.org.id)
          ?.history.find((line) => line.credit?.creditId === credit.id)?.credit
      ).toMatchObject({ state: 'needs_person', action: 'decide' });

      const checked = await service.checkOwedToCreator(credit.id);
      expect(checked).toMatchObject({
        outcome: 'needs_person',
        state: 'needs_person',
        action: 'decide',
        amountCents: null,
      });
      expect(serviceLog().error).toHaveBeenCalledWith(
        expect.stringContaining('Check in Stripe'),
        expect.objectContaining({
          errorId: expect.any(String),
          creditId: credit.id,
        })
      );

      const refused = await failureOf(
        service.resolveOwedToCreator(
          credit.id,
          { action: 'repay', note: '' },
          supportId
        )
      );
      expect(refused.statusCode).toBe(422);
      expect(refused.context).toEqual({ code: 'CREDIT_NOTE_REQUIRED' });
      const repaid = await service.resolveOwedToCreator(
        credit.id,
        {
          action: 'repay',
          note: 'Stripe: nothing went out for it; this refund cancelled it',
        },
        supportId
      );
      if (repaid.repayPayoutId) created.payoutIds.push(repaid.repayPayoutId);
      expect(repaid).toMatchObject({
        resolution: 'repaid',
        amountCents: 135,
        repayPayoutId: expect.any(String),
      });
    });

    it("a debt the creator paid, after a credit's re-pay on its step: the won dispute still re-pays it, and neither re-pay is read as a slice of the purchase (review MED-4)", async () => {
      const charge = await purchaseCharge();
      const disputeId = `du_sup${uid()}`;
      created.stripeDisputeIds.push(disputeId);
      await db.insert(disputes).values({
        stripeDisputeId: disputeId,
        stripeChargeId: charge.chargeId,
        amountCents: 1000,
        currency: 'gbp',
        status: 'won',
        stripeCreatedAt: new Date(),
      });
      // The creator's 765 take-back was refused for their balance (a debt),
      // then 400 of it landed late: re-paid, the debt left open (OQ4).
      const step = takeFirst(
        await db
          .insert(payoutReversals)
          .values({
            payoutId: charge.creator.id,
            causeType: 'dispute',
            causeId: disputeId,
            amountCents: 765,
            kind: 'transfer_reversal',
            status: 'debt',
            resolvedAt: new Date(),
          })
          .returning()
      );
      const review = takeFirst(
        await db
          .insert(refundReviews)
          .values({
            payoutReversalId: step.id,
            payoutId: charge.creator.id,
            creatorUserId: creatorId,
            attemptedReversalCents: 765,
            errorCode: 'insufficient_funds',
          })
          .returning()
      );
      const credit = takeFirst(
        await db
          .insert(payeeCredits)
          .values({
            payoutReversalId: step.id,
            payoutId: charge.creator.id,
            payeeUserId: creatorId,
            effect: 'reversal_landed',
            amountCents: 400,
            stripeReversalId: `trr_sup${uid()}`,
            stripeTransferId: charge.creator.stripeTransferId,
            settledAs: 'debt',
            alertErrorId: crypto.randomUUID(),
          })
          .returning()
      );
      const creditRepay = await service.resolveOwedToCreator(
        credit.id,
        { action: 'repay', note: '' },
        supportId
      );
      if (creditRepay.repayPayoutId) {
        created.payoutIds.push(creditRepay.repayPayoutId);
      }
      // The creator pays the debt; then the dispute is won.
      await service.resolveCreatorDebt(
        review.id,
        { resolution: 'creator_absorbed', note: '' },
        supportId
      );

      const won = await repayDispute(
        { db, stripe: fake.stripe, obs, environment: 'test' },
        { disputeId }
      );

      expect(won.repaid).toBe(1);
      const after = takeFirst(
        await db
          .select()
          .from(payoutReversals)
          .where(eq(payoutReversals.id, step.id))
      );
      if (after.repaidByPayoutId)
        created.payoutIds.push(after.repaidByPayoutId);
      expect(after.repaidByPayoutId).not.toBeNull();
      expect(after.repaidByPayoutId).not.toBe(creditRepay.repayPayoutId);
      // A later cause of this purchase sees its three slices only.
      const plan = await loadClawbackPlanInput(db, {
        charge: { id: charge.chargeId, amountCents: 1000 },
        source: { sourceType: 'purchase', purchaseId: charge.purchase.id },
        refunds: [],
      });
      expect(plan.slices.map((row) => row.id).sort()).toEqual(
        [charge.fee.id, charge.org.id, charge.creator.id].sort()
      );
    });
  });

  // ── settled refunded elsewhere counts as refunded (Codex-3xnta) ───────

  describe('a failed refund settled as refunded elsewhere counts as refunded (owner decision 2026-11-09, Codex-3xnta)', () => {
    const settleElsewhere = (refundId: string) =>
      service.resolveFailedRefund(
        refundId,
        { resolution: 'refunded_elsewhere', note: 'Bank transfer' },
        supportId
      );

    /** The search's row for a purchase. */
    const searchRowOf = async (purchaseId: string) =>
      (await service.searchCharges({ lookup: purchaseId, page: 1, limit: 20 }))
        .items[0];

    /**
     * A refund failed at Stripe and in our record, with no clawback of its
     * own, settled as `resolution` or still open.
     */
    async function recordedFailure(
      chargeId: string,
      amountCents: number,
      resolution: 'refunded_elsewhere' | 'creators_repaid' | null,
      purchaseId: string | null
    ) {
      const listed = stripeRefund(chargeId, amountCents, {
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      });
      await db.insert(refunds).values({
        stripeRefundId: listed.id,
        stripeChargeId: chargeId,
        purchaseId,
        amountCents,
        currency: 'gbp',
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
        stripeCreatedAt: new Date(),
        resolution,
        resolvedAt: resolution ? new Date() : null,
      });
    }

    it("in part: the detail, the search, the preview and the route offer only the rest; access stays on Stripe's count", async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 400);
      await settleElsewhere(failed.id);

      const detail = await service.getChargeDetail(charge.chargeId);
      expect(detail.charge.refundedCents).toBe(400);
      expect(detail.refundable).toMatchObject({ maxCents: 600, blocked: null });
      expect(await searchRowOf(charge.purchase.id)).toMatchObject({
        chargeId: charge.chargeId,
        refundedCents: 400,
      });

      const over = await failureOf(service.previewRefund(charge.chargeId, 601));
      expect(over.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 600,
      });
      // The webhook decides access from Stripe's list, where the settled
      // refund is still failed: the rest is not the whole charge there.
      const rest = await service.previewRefund(charge.chargeId, 600);
      expect(rest.access.kind).toBe('keeps');

      const refused = await failureOf(
        service.issueRefund(
          charge.chargeId,
          refundInput(601, detail.refundCount),
          supportId
        )
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 600,
      });
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();

      const made = await service.issueRefund(
        charge.chargeId,
        refundInput(600, detail.refundCount),
        supportId
      );
      expect(made.refund.amountCents).toBe(600);
    });

    it('in full: nothing is left, and the preview and the route refuse any amount', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 1000);
      await settleElsewhere(failed.id);

      const detail = await service.getChargeDetail(charge.chargeId);
      expect(detail.charge.refundedCents).toBe(1000);
      expect(detail.refundable).toMatchObject({
        maxCents: 0,
        blocked: 'nothing_left',
      });
      expect(await searchRowOf(charge.purchase.id)).toMatchObject({
        refundedCents: 1000,
      });
      const preview = await failureOf(
        service.previewRefund(charge.chargeId, 1)
      );
      expect(preview.context).toEqual({ code: 'NOTHING_LEFT_TO_REFUND' });
      const route = await failureOf(
        service.issueRefund(
          charge.chargeId,
          refundInput(1, detail.refundCount),
          supportId
        )
      );
      expect(route.statusCode).toBe(422);
      expect(route.context).toEqual({ code: 'NOTHING_LEFT_TO_REFUND' });
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('a settle after the page loaded is counted: the route reads it again in its re-check', async () => {
      const charge = await purchaseCharge();
      const failed = await failedRefund(charge, 400);
      // Not settled yet: a failed refund doesn't count (Codex-2hxff.28).
      const detail = await service.getChargeDetail(charge.chargeId);
      expect(detail.refundable.maxCents).toBe(1000);
      await service.previewRefund(charge.chargeId, 1000);

      await settleElsewhere(failed.id);

      // The refund count is as the page saw it, so only the cap stops it.
      const route = await failureOf(
        service.issueRefund(
          charge.chargeId,
          refundInput(1000, detail.refundCount),
          supportId
        )
      );
      expect(route.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 600,
      });
      expect(fake.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('only refunded elsewhere counts: an open failed refund and one whose payees were re-paid do not, on a purchase or an invoice', async () => {
      const charge = await purchaseCharge();
      await recordedFailure(charge.chargeId, 100, null, charge.purchase.id);
      await recordedFailure(
        charge.chargeId,
        200,
        'creators_repaid',
        charge.purchase.id
      );
      await recordedFailure(
        charge.chargeId,
        300,
        'refunded_elsewhere',
        charge.purchase.id
      );
      const invoice = await invoiceCharge();
      await recordedFailure(invoice.chargeId, 100, null, null);
      await recordedFailure(invoice.chargeId, 200, 'creators_repaid', null);
      await recordedFailure(invoice.chargeId, 300, 'refunded_elsewhere', null);

      for (const chargeId of [charge.chargeId, invoice.chargeId]) {
        const detail = await service.getChargeDetail(chargeId);
        expect(detail.charge.refundedCents).toBe(300);
        expect(detail.refundable.maxCents).toBe(700);
        // Each refund row says how support settled it, from our record.
        expect(
          detail.refunds
            .map((refund) => [refund.amountCents, refund.resolution])
            .sort((a, b) => Number(a[0]) - Number(b[0]))
        ).toEqual([
          [100, null],
          [200, 'creators_repaid'],
          [300, 'refunded_elsewhere'],
        ]);
        const [row] = (
          await service.searchCharges({ lookup: chargeId, page: 1, limit: 20 })
        ).items;
        expect(row).toMatchObject({ chargeId, refundedCents: 300 });
      }
    });

    it('never counts a refund twice: only a failed refund holds a resolution, and our record never moves a failed one', async () => {
      const charge = await purchaseCharge();
      // The CHECK refuses a resolution on a refund that didn't fail.
      for (const status of ['pending', 'requires_action', 'succeeded']) {
        const error = await db
          .insert(refunds)
          .values({
            stripeRefundId: `re_sup${uid()}`,
            stripeChargeId: charge.chargeId,
            purchaseId: charge.purchase.id,
            amountCents: 100,
            currency: 'gbp',
            status,
            stripeCreatedAt: new Date(),
            resolution: 'refunded_elsewhere',
            resolvedAt: new Date(),
          })
          .then(
            () => null,
            (refused: unknown) => refused
          );
        // The refused statement's SQLSTATE and constraint; drizzle wraps it.
        const e = error as {
          code?: string;
          constraint?: string;
          cause?: { code?: string; constraint?: string };
        } | null;
        expect(e?.code ?? e?.cause?.code).toBe('23514');
        expect(e?.constraint ?? e?.cause?.constraint).toBe(
          'check_refunds_resolution'
        );
      }

      // A stale or wrong event can't turn the settled row into a standing
      // one: `recordRefund` never moves a failed row.
      const failed = await failedRefund(charge, 400);
      await settleElsewhere(failed.id);
      const listed = fake.refundsByCharge
        .get(charge.chargeId)
        ?.find((refund) => refund.id === failed.stripeRefundId);
      (listed as unknown as { status: string }).status = 'succeeded';
      await new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        fake.stripe
      ).recordChargeRefunds({
        id: charge.chargeId,
        paymentIntentId: charge.paymentIntentId,
      });
      const [row] = await db
        .select({ status: refunds.status, resolution: refunds.resolution })
        .from(refunds)
        .where(eq(refunds.id, failed.id));
      expect(row).toEqual({
        status: 'failed',
        resolution: 'refunded_elsewhere',
      });
      expect((await searchRowOf(charge.purchase.id))?.refundedCents).toBe(400);
      // Stripe now lists it standing while our record holds it settled
      // elsewhere: the charge page, the preview and the route count it once.
      const detail = await service.getChargeDetail(charge.chargeId);
      expect(detail.charge.refundedCents).toBe(400);
      expect(detail.refundable.maxCents).toBe(600);
      const preview = await failureOf(
        service.previewRefund(charge.chargeId, 601)
      );
      expect(preview.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 600,
      });
      const route = await failureOf(
        service.issueRefund(
          charge.chargeId,
          refundInput(601, detail.refundCount),
          supportId
        )
      );
      expect(route.context).toEqual({
        code: 'REFUND_AMOUNT_TOO_LARGE',
        maxCents: 600,
      });
    });

    it('is capped at the charge: a refund again through Stripe and the one settled elsewhere read refunded in full, never more (review PAY-001)', async () => {
      const charge = await purchaseCharge();
      const invoice = await invoiceCharge();
      for (const [chargeId, purchaseId] of [
        [charge.chargeId, charge.purchase.id],
        [invoice.chargeId, null],
      ] as const) {
        await recordedFailure(chargeId, 1000, 'refunded_elsewhere', purchaseId);
        // The late-win runbook's re-refund, at Stripe and in our record.
        const again = stripeRefund(chargeId, 1000);
        await db.insert(refunds).values({
          stripeRefundId: again.id,
          stripeChargeId: chargeId,
          purchaseId,
          amountCents: 1000,
          currency: 'gbp',
          status: 'succeeded',
          stripeCreatedAt: new Date(),
        });
      }

      for (const chargeId of [charge.chargeId, invoice.chargeId]) {
        const detail = await service.getChargeDetail(chargeId);
        expect(detail.charge.refundedCents).toBe(1000);
        expect(detail.refundable).toMatchObject({
          maxCents: 0,
          blocked: 'nothing_left',
        });
        const [row] = (
          await service.searchCharges({ lookup: chargeId, page: 1, limit: 20 })
        ).items;
        expect(row).toMatchObject({ chargeId, refundedCents: 1000 });
      }
    });

    it('one figure in all four: an open failed full refund is nothing back in the search, the charge page, revenue and Sales; settled elsewhere it counts, capped; a standing refund and a lost chargeback count once (owner decision 2026-11-09)', async () => {
      const purchaseService = new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        fake.stripe
      );
      const analytics = new AdminAnalyticsService({ db, environment: 'test' });
      const sales = async () =>
        (await purchaseService.getSalesStats(orgId, {})).refundedCents;
      const revenue = async () =>
        (await analytics.getRevenueStats(orgId)).totalRevenueCents;
      const before = { sales: await sales(), revenue: await revenue() };
      const made: Awaited<ReturnType<typeof purchaseCharge>>[] = [];
      const charge = async () => {
        const one = await purchaseCharge();
        made.push(one);
        return one;
      };
      const onPage = async (
        one: Awaited<ReturnType<typeof purchaseCharge>>
      ) => ({
        search: (await searchRowOf(one.purchase.id))?.refundedCents,
        detail: (await service.getChargeDetail(one.chargeId)).charge
          .refundedCents,
      });
      // Each £10 charge made here adds its gross to revenue: what revenue
      // falls short of that is its `taken`.
      const takenBack = async () => ({
        sales: (await sales()) - before.sales,
        revenue: made.length * 1000 - ((await revenue()) - before.revenue),
      });
      /** A standing refund, at Stripe and in our record. */
      const standingRefund = async (
        one: Awaited<ReturnType<typeof purchaseCharge>>,
        amountCents: number
      ) => {
        const listed = stripeRefund(one.chargeId, amountCents);
        await db.insert(refunds).values({
          stripeRefundId: listed.id,
          stripeChargeId: one.chargeId,
          purchaseId: one.purchase.id,
          amountCents,
          currency: 'gbp',
          status: 'succeeded',
          stripeCreatedAt: new Date(),
        });
      };

      // A full refund that failed: `processRefund` ended access and wrote
      // the full amount on the purchase, and nothing restates a refunded one.
      const full = await charge();
      const failed = await failedRefund(full, 1000);
      await endAccess(full);
      expect(await onPage(full)).toEqual({ search: 0, detail: 0 });
      expect(await takenBack()).toEqual({ sales: 0, revenue: 0 });

      await settleElsewhere(failed.id);
      expect(await onPage(full)).toEqual({ search: 1000, detail: 1000 });
      expect(await takenBack()).toEqual({ sales: 1000, revenue: 1000 });

      // Refunded again through Stripe as well: capped at the charge.
      await standingRefund(full, 1000);
      expect(await onPage(full)).toEqual({ search: 1000, detail: 1000 });
      expect(await takenBack()).toEqual({ sales: 1000, revenue: 1000 });

      // A standing part refund counts once.
      const part = await charge();
      await standingRefund(part, 250);
      expect(await onPage(part)).toEqual({ search: 250, detail: 250 });
      expect(await takenBack()).toEqual({ sales: 1250, revenue: 1250 });

      // A lost chargeback: revenue and Sales count it; the search and the
      // charge page count refunds only, and show the chargeback beside.
      const lost = await charge();
      await dispute(lost.chargeId, 'lost', lost.purchase.id);
      await db
        .update(purchases)
        .set({ status: PURCHASE_STATUS.REFUNDED, refundAmountCents: 1000 })
        .where(eq(purchases.id, lost.purchase.id));
      expect(await onPage(lost)).toEqual({ search: 0, detail: 0 });
      expect(await takenBack()).toEqual({ sales: 2250, revenue: 2250 });
    });

    it("ties a refund recorded without its purchase to it by the purchase's charge: the search row, the charge page and Sales count it alike, once, capped (one key)", async () => {
      const charge = await purchaseCharge();
      const purchaseService = new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps() },
        fake.stripe
      );
      const sales = async () =>
        (await purchaseService.getSalesStats(orgId, {})).refundedCents;
      const before = await sales();
      // One linked to the purchase, and two recorded before it was (aa08z).
      await recordedFailure(
        charge.chargeId,
        100,
        'refunded_elsewhere',
        charge.purchase.id
      );
      await recordedFailure(charge.chargeId, 300, 'refunded_elsewhere', null);
      const standing = stripeRefund(charge.chargeId, 200);
      await db.insert(refunds).values({
        stripeRefundId: standing.id,
        stripeChargeId: charge.chargeId,
        purchaseId: null,
        amountCents: 200,
        currency: 'gbp',
        status: 'succeeded',
        stripeCreatedAt: new Date(),
      });
      // What the refund webhook does: Sales reads the standing one from it.
      await purchaseService.restateStandingRefunds(
        charge.paymentIntentId,
        charge.chargeId
      );

      const figures = async () => ({
        search: (await searchRowOf(charge.purchase.id))?.refundedCents,
        detail: (await service.getChargeDetail(charge.chargeId)).charge
          .refundedCents,
        sales: (await sales()) - before,
      });
      expect(await figures()).toEqual({ search: 600, detail: 600, sales: 600 });

      // Still capped at the charge, whichever key found the refunds.
      await recordedFailure(charge.chargeId, 1000, 'refunded_elsewhere', null);
      expect(await figures()).toEqual({
        search: 1000,
        detail: 1000,
        sales: 1000,
      });
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
      { db, environment: 'test', ...createTestMoneyDeps() },
      fake.stripe
    ).recordChargeRefunds({ id: chargeId, paymentIntentId });

    const [row] = await db
      .select({ requestedByUserId: refunds.requestedByUserId })
      .from(refunds)
      .where(eq(refunds.stripeRefundId, made.refund.id));
    expect(row?.requestedByUserId).toBe(supportId);
  });
});
