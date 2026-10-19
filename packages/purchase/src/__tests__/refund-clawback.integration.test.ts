/**
 * The purchase refund clawback, as `PurchaseService.processRefund` wires it to
 * the @codex/payments engine (Codex-2hxff.8; design in
 * docs/payments/refund-reversal-record.md).
 *
 * The engine's behaviour (shares, records, keys, retries, debts, leases) is
 * specified in packages/payments/src/__tests__/clawback.integration.test.ts.
 * This file covers what the purchase source adds: which rows are a purchase's,
 * the purchase metadata on a reversal, the debt row's purchase id, that an
 * already-refunded purchase still runs its clawback, and how a step that must
 * be retried reaches the webhook.
 *
 * It replaces refund-reversal.characterisation.test.ts, which pinned the old
 * copy, defects included, so that the extraction (WP3b-2) could be proven to
 * change nothing. The defects it pinned are the behaviour this PR changes.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  failedRefunds,
  organizations,
  type Payout,
  type Purchase,
  payoutReversals,
  payouts,
  purchases,
  refundReviews,
} from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestContentInput,
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
import { PurchaseService } from '../services/purchase-service';

const uid = () => randomUUID().slice(0, 8);

describe('PurchaseService refund clawback (Codex-2hxff.8)', () => {
  let db: Database;
  let stripe: Stripe;
  let buyerId: string;
  let creatorA: string;
  let orgId: string;
  const createdPayoutIds: string[] = [];
  const createdFailedRefundIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorA] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Purchase Clawback Org',
          slug: createUniqueSlug('purchase-clawback'),
        })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  // Payout rows feed global drains: never leave them behind.
  // refund_reviews -> payout_reversals -> payouts are ON DELETE RESTRICT.
  afterAll(async () => {
    if (createdPayoutIds.length > 0) {
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, createdPayoutIds));
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, createdPayoutIds));
      await db.delete(payouts).where(inArray(payouts.id, createdPayoutIds));
    }
    if (createdFailedRefundIds.length > 0) {
      await db
        .delete(failedRefunds)
        .where(inArray(failedRefunds.stripeRefundId, createdFailedRefundIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function makeService(): PurchaseService {
    return new PurchaseService({ db, environment: 'test' }, stripe);
  }

  /** A completed purchase (content target) with no payouts rows yet. */
  async function seedPurchase(amountPaidCents = 1000) {
    const tag = uid();
    const platformFeeCents = Math.floor(amountPaidCents / 10);
    const organizationFeeCents = Math.floor(
      ((amountPaidCents - platformFeeCents) * 15) / 100
    );
    const contentRow = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorA, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('purchase-clawback'),
          })
        )
        .returning()
    );
    const purchase: Purchase = takeFirst(
      await db
        .insert(purchases)
        .values({
          customerId: buyerId,
          contentId: contentRow.id,
          organizationId: orgId,
          amountPaidCents,
          platformFeeCents,
          organizationFeeCents,
          creatorPayoutCents:
            amountPaidCents - platformFeeCents - organizationFeeCents,
          stripePaymentIntentId: `pi_pclaw_${tag}`,
          status: 'completed',
          purchasedAt: new Date(),
        })
        .returning()
    );
    return {
      purchase,
      paymentIntentId: `pi_pclaw_${tag}`,
      charge: { id: `ch_pclaw_${tag}`, amountCents: amountPaidCents },
      tag,
    };
  }

  type Seeded = Awaited<ReturnType<typeof seedPurchase>>;

  async function insertPayout(spec: {
    purchaseId: string | null;
    payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
    amountCents: number;
    stripeChargeId: string | null;
    stripeTransferId?: string | null;
    sourceType?: 'purchase' | 'subscription';
  }): Promise<Payout> {
    const isFee = spec.payoutType === 'platform_fee';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          purchaseId: spec.purchaseId,
          organizationId: orgId,
          userId: isFee ? null : creatorA,
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status: 'paid',
          sourceType: spec.sourceType ?? 'purchase',
          stripeChargeId: spec.stripeChargeId,
          stripeTransferId: spec.stripeTransferId ?? null,
          resolvedAt: new Date(),
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /** platform 100 + org 135 + creator 765 on the purchase's charge, all paid. */
  async function paidSplit(seeded: Seeded) {
    const base = {
      purchaseId: seeded.purchase.id,
      stripeChargeId: seeded.charge.id,
    };
    return {
      platform: await insertPayout({
        ...base,
        payoutType: 'platform_fee',
        amountCents: 100,
      }),
      org: await insertPayout({
        ...base,
        payoutType: 'organization_fee',
        amountCents: 135,
        stripeTransferId: `tr_org_${seeded.tag}`,
      }),
      creator: await insertPayout({
        ...base,
        payoutType: 'creator_payout',
        amountCents: 765,
        stripeTransferId: `tr_creator_${seeded.tag}`,
      }),
    };
  }

  /** What Stripe lists as the charge's refunds. */
  function stripeRefunds(
    refunds: Array<{
      id: string;
      amount: number;
      status?: string;
      created?: number;
    }>
  ) {
    vi.mocked(stripe.refunds.list).mockResolvedValue({
      object: 'list',
      data: refunds.map((r, i) => ({
        status: 'succeeded',
        created: i + 1,
        ...r,
      })),
      has_more: false,
    } as never);
  }

  function refundEvent(seeded: Seeded, refundId: string, amount: number) {
    return makeService().processRefund(seeded.paymentIntentId, {
      charge: seeded.charge,
      stripeRefundId: refundId,
      refundAmountCents: amount,
    });
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function readPurchase(id: string): Promise<Purchase> {
    return takeFirst(
      await db.select().from(purchases).where(eq(purchases.id, id))
    );
  }

  function reversedAmount(transferId: string | null): number {
    return vi
      .mocked(stripe.transfers.createReversal)
      .mock.calls.filter(([id]) => id === transferId)
      .reduce(
        (sum, [, params]) =>
          sum + ((params as { amount?: number } | undefined)?.amount ?? 0),
        0
      );
  }

  // ── tests ─────────────────────────────────────────────────────────────

  it("claws back the refund's share of each of the purchase's slices, the charge amount the denominator", async () => {
    const seeded = await seedPurchase(1000);
    const { platform, org, creator } = await paidSplit(seeded);
    stripeRefunds([{ id: `re_part_${seeded.tag}`, amount: 300 }]);

    const result = await refundEvent(seeded, `re_part_${seeded.tag}`, 300);

    expect(result).toEqual({ userId: buyerId });
    expect(stripe.refunds.list).toHaveBeenCalledWith(
      expect.objectContaining({ charge: seeded.charge.id })
    );
    expect(reversedAmount(org.stripeTransferId)).toBe(40);
    expect(reversedAmount(creator.stripeTransferId)).toBe(229);
    for (const row of [platform, org, creator]) {
      expect((await readRow(row.id)).status).toBe('paid');
    }
    expect((await readPurchase(seeded.purchase.id)).status).toBe('refunded');
  });

  it('an already-refunded purchase still runs its clawback: a later partial refund of the charge is clawed back (the record, not the purchase, is the gate)', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    const re1 = `re_first_${seeded.tag}`;
    const re2 = `re_second_${seeded.tag}`;
    stripeRefunds([{ id: re1, amount: 300 }]);
    await refundEvent(seeded, re1, 300);
    const recorded = await readPurchase(seeded.purchase.id);

    stripeRefunds([
      { id: re1, amount: 300 },
      { id: re2, amount: 700 },
    ]);
    await refundEvent(seeded, re2, 1000);

    expect(reversedAmount(creator.stripeTransferId)).toBe(765);
    expect((await readRow(creator.id)).status).toBe('reversed');
    // The purchase row itself is not rewritten by the redelivery.
    const after = await readPurchase(seeded.purchase.id);
    expect(after.refundedAt?.getTime()).toBe(recorded.refundedAt?.getTime());
    expect(after.stripeRefundId).toBe(re1);
  });

  it('a step that must be retried makes processRefund reject AFTER the purchase is recorded refunded; the redelivery completes it', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    const re = `re_retry_${seeded.tag}`;
    stripeRefunds([{ id: re, amount: 1000 }]);
    const outage = Object.assign(new Error('socket hang up'), {
      type: 'StripeConnectionError',
    });
    const real = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation();
    vi.mocked(stripe.transfers.createReversal).mockImplementationOnce(() =>
      Promise.reject(outage)
    );

    const failure = await refundEvent(seeded, re, 1000).then(
      () => undefined,
      (error: unknown) => error
    );

    // The service wraps nothing it does not know: the engine's error, whose
    // cause the webhook classifies as transient, reaches the caller.
    expect(failure).toBeInstanceOf(InternalServiceError);
    expect((await readPurchase(seeded.purchase.id)).status).toBe('refunded');

    if (real)
      vi.mocked(stripe.transfers.createReversal).mockImplementation(real);
    await refundEvent(seeded, re, 1000);
    expect((await readRow(creator.id)).status).toBe('reversed');
  });

  it('a step Stripe refused does not make processRefund reject (the webhook goes on to the refund email)', async () => {
    const seeded = await seedPurchase(1000);
    await paidSplit(seeded);
    stripeRefunds([{ id: `re_refused_${seeded.tag}`, amount: 1000 }]);
    vi.mocked(stripe.transfers.createReversal).mockRejectedValue(
      Object.assign(new Error('already reversed'), {
        code: 'transfer_reversed',
        statusCode: 400,
      })
    );

    await expect(
      refundEvent(seeded, `re_refused_${seeded.tag}`, 1000)
    ).resolves.toEqual({ userId: buyerId });
  });

  it("a debt's refund_reviews row carries the purchase id and the reversal it is for", async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    stripeRefunds([{ id: `re_debt_${seeded.tag}`, amount: 1000 }]);
    vi.mocked(stripe.transfers.createReversal).mockRejectedValue(
      Object.assign(new Error('balance too low'), {
        code: 'insufficient_funds',
        statusCode: 400,
      })
    );

    await refundEvent(seeded, `re_debt_${seeded.tag}`, 1000);

    const [record] = await db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, creator.id));
    const [review] = await db
      .select()
      .from(refundReviews)
      .where(eq(refundReviews.payoutId, creator.id));
    expect(review).toEqual(
      expect.objectContaining({
        purchaseId: seeded.purchase.id,
        payoutReversalId: record?.id,
        attemptedReversalCents: 765,
      })
    );
  });

  it("a purchase's rows are selected by its id: one with no charge id is included, another purchase's on the same charge is not", async () => {
    const seeded = await seedPurchase(1000);
    const other = await seedPurchase(1000);
    const noChargeId = await insertPayout({
      purchaseId: seeded.purchase.id,
      payoutType: 'creator_payout',
      amountCents: 765,
      stripeChargeId: null,
      stripeTransferId: `tr_nocharge_${seeded.tag}`,
    });
    const otherPurchase = await insertPayout({
      purchaseId: other.purchase.id,
      payoutType: 'creator_payout',
      amountCents: 765,
      stripeChargeId: seeded.charge.id,
      stripeTransferId: `tr_other_${other.tag}`,
    });
    stripeRefunds([{ id: `re_scope_${seeded.tag}`, amount: 1000 }]);

    await refundEvent(seeded, `re_scope_${seeded.tag}`, 1000);

    expect(reversedAmount(noChargeId.stripeTransferId)).toBe(765);
    expect(reversedAmount(otherPurchase.stripeTransferId)).toBe(0);
  });

  it('the reversal carries the purchase id and the purchase source in its Stripe metadata', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    stripeRefunds([{ id: `re_meta_${seeded.tag}`, amount: 1000 }]);

    await refundEvent(seeded, `re_meta_${seeded.tag}`, 1000);

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      creator.stripeTransferId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          source_type: 'purchase',
          purchase_id: seeded.purchase.id,
          charge_id: seeded.charge.id,
          refund_id: `re_meta_${seeded.tag}`,
        }),
      }),
      expect.anything()
    );
  });

  it('a refund still pending at Stripe is not clawed back yet (owner decision Q1): the purchase is recorded, nothing is reversed', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    stripeRefunds([
      { id: `re_pend_${seeded.tag}`, amount: 1000, status: 'pending' },
    ]);

    await refundEvent(seeded, `re_pend_${seeded.tag}`, 1000);

    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect((await readRow(creator.id)).status).toBe('paid');
    expect((await readPurchase(seeded.purchase.id)).status).toBe('refunded');
  });

  // ── a refund that fails (owner decision 2026-10-19, "Hold it for support")

  it('a refund that failed at Stripe is clawed back like a succeeded one: the customer must still be refunded another way', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    stripeRefunds([
      { id: `re_fail_${seeded.tag}`, amount: 1000, status: 'failed' },
    ]);

    await refundEvent(seeded, `re_fail_${seeded.tag}`, 1000);

    expect(reversedAmount(creator.stripeTransferId)).toBe(765);
    expect((await readRow(creator.id)).status).toBe('reversed');
  });

  it("recordFailedRefund records a failed refund once, with the charge's purchase; a redelivery records nothing", async () => {
    const seeded = await seedPurchase(1000);
    const refundId = `re_rec_${seeded.tag}`;
    createdFailedRefundIds.push(refundId);
    const failed = {
      stripeRefundId: refundId,
      stripeChargeId: seeded.charge.id,
      paymentIntentId: seeded.paymentIntentId,
      amountCents: 400,
      currency: 'gbp',
      failureReason: 'expired_or_canceled_card',
    };

    expect(await makeService().recordFailedRefund(failed)).toBe(true);
    expect(await makeService().recordFailedRefund(failed)).toBe(false);

    const rows = await db
      .select()
      .from(failedRefunds)
      .where(eq(failedRefunds.stripeRefundId, refundId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purchaseId: seeded.purchase.id,
      stripeChargeId: seeded.charge.id,
      amountCents: 400,
      failureReason: 'expired_or_canceled_card',
      resolution: null,
      resolvedAt: null,
    });
  });

  it("recordFailedRefund records a subscription charge's failed refund with no purchase", async () => {
    const refundId = `re_sub_${uid()}`;
    createdFailedRefundIds.push(refundId);

    await makeService().recordFailedRefund({
      stripeRefundId: refundId,
      stripeChargeId: `ch_sub_${uid()}`,
      paymentIntentId: `pi_not_a_purchase_${uid()}`,
      amountCents: 500,
      currency: 'gbp',
      failureReason: null,
    });

    const [row] = await db
      .select()
      .from(failedRefunds)
      .where(eq(failedRefunds.stripeRefundId, refundId));
    expect(row?.purchaseId).toBeNull();
  });
});
