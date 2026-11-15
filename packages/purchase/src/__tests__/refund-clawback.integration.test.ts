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
  contentAccess,
  type Dispute,
  disputes,
  organizations,
  type Payout,
  type Purchase,
  payoutReversals,
  payouts,
  purchases,
  refundReviews,
  refunds,
} from '@codex/database/schema';
import { isDrainablePayout } from '@codex/payments';
import { InternalServiceError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
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
  const createdRefundIds: string[] = [];
  const createdDisputeIds: string[] = [];

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
      // A won dispute's re-pay rows are live pending payouts: delete them too.
      // A reversal references a payout twice (payout_id, and
      // repaid_by_payout_id), and a later refund records its own step ON a
      // re-pay row (Codex-2hxff.59 item 1a), so every reversal touching any of
      // these rows goes before the rows.
      const repays = await db
        .select({ id: payoutReversals.repaidByPayoutId })
        .from(payoutReversals)
        .where(
          and(
            inArray(payoutReversals.payoutId, createdPayoutIds),
            isNotNull(payoutReversals.repaidByPayoutId)
          )
        );
      const all = [
        ...createdPayoutIds,
        ...repays.flatMap((r) => (r.id ? [r.id] : [])),
      ];
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, all));
      await db
        .delete(payoutReversals)
        .where(
          or(
            inArray(payoutReversals.payoutId, all),
            inArray(payoutReversals.repaidByPayoutId, all)
          )
        );
      await db.delete(payouts).where(inArray(payouts.id, all));
    }
    if (createdDisputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, createdDisputeIds));
    }
    if (createdRefundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, createdRefundIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function makeService(): PurchaseService {
    return new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
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
        currency: 'gbp',
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

    expect(result).toEqual({
      userId: buyerId,
      accessEnded: false,
      duplicatePayment: false,
      itemTitle: expect.any(String),
      lateWinKeptThrough: null,
    });
    expect(stripe.refunds.list).toHaveBeenCalledWith(
      expect.objectContaining({ charge: seeded.charge.id })
    );
    expect(reversedAmount(org.stripeTransferId)).toBe(40);
    expect(reversedAmount(creator.stripeTransferId)).toBe(229);
    for (const row of [platform, org, creator]) {
      expect((await readRow(row.id)).status).toBe('paid');
    }
    // A partial refund keeps the purchase, and access, as they were (P-1).
    expect(await readPurchase(seeded.purchase.id)).toMatchObject({
      status: 'completed',
      refundAmountCents: 300,
      refundedAt: null,
    });
  });

  it('a partial refund keeps access (P-1); the refund that completes the charge ends it, and each refund is clawed back', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    const contentId = seeded.purchase.contentId;
    if (!contentId) throw new Error('the seeded purchase is for content');
    await db.insert(contentAccess).values({
      userId: buyerId,
      contentId,
      organizationId: orgId,
      accessType: 'purchased',
    });
    const access = async () =>
      takeFirst(
        await db
          .select()
          .from(contentAccess)
          .where(eq(contentAccess.contentId, contentId))
      );
    const re1 = `re_first_${seeded.tag}`;
    const re2 = `re_second_${seeded.tag}`;

    stripeRefunds([{ id: re1, amount: 300 }]);
    const first = await refundEvent(seeded, re1, 300);
    expect(first?.accessEnded).toBe(false);
    expect((await access()).deletedAt).toBeNull();
    expect((await readPurchase(seeded.purchase.id)).status).toBe('completed');

    // refundAmountCents is the charge's cumulative amount refunded.
    stripeRefunds([
      { id: re1, amount: 300 },
      { id: re2, amount: 700 },
    ]);
    const second = await refundEvent(seeded, re2, 1000);
    expect(second?.accessEnded).toBe(true);
    expect((await access()).deletedAt).not.toBeNull();
    expect(await readPurchase(seeded.purchase.id)).toMatchObject({
      status: 'refunded',
      refundAmountCents: 1000,
      stripeRefundId: re2,
    });
    expect(reversedAmount(creator.stripeTransferId)).toBe(765);
    expect((await readRow(creator.id)).status).toBe('reversed');
  });

  it('an already-refunded purchase still runs its clawback: a refund pending at charge.refunded is clawed back once it succeeds (the record, not the purchase, is the gate)', async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    const refundId = `re_later_${seeded.tag}`;
    stripeRefunds([{ id: refundId, amount: 1000, status: 'pending' }]);
    await refundEvent(seeded, refundId, 1000);
    const recorded = await readPurchase(seeded.purchase.id);
    expect(recorded.status).toBe('refunded');
    expect(reversedAmount(creator.stripeTransferId)).toBe(0);

    stripeRefunds([{ id: refundId, amount: 1000, status: 'succeeded' }]);
    await refundEvent(seeded, refundId, 1000);

    expect(reversedAmount(creator.stripeTransferId)).toBe(765);
    // The purchase row itself is not rewritten by the second run.
    const after = await readPurchase(seeded.purchase.id);
    expect(after.refundedAt?.getTime()).toBe(recorded.refundedAt?.getTime());
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
    ).resolves.toEqual({
      userId: buyerId,
      accessEnded: true,
      duplicatePayment: false,
      itemTitle: expect.any(String),
      lateWinKeptThrough: null,
    });
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

  // ── the refunds record (owner decision 2026-10-19, "One refunds table") ──

  function refundFor(
    seeded: Pick<Seeded, 'charge' | 'paymentIntentId'> | null,
    refundId: string,
    status: string | null,
    failureReason: string | null = null
  ) {
    return {
      stripeRefundId: refundId,
      stripeChargeId: seeded?.charge.id ?? `ch_sub_${uid()}`,
      paymentIntentId: seeded?.paymentIntentId ?? `pi_not_a_purchase_${uid()}`,
      amountCents: 400,
      currency: 'gbp',
      status,
      reason: 'requested_by_customer',
      failureReason,
      stripeCreatedAt: new Date('2026-10-19T10:00:00Z'),
    };
  }

  async function readRefund(refundId: string) {
    return db
      .select()
      .from(refunds)
      .where(eq(refunds.stripeRefundId, refundId));
  }

  it("recordRefund records a refund once, with the charge's purchase; a redelivery writes nothing", async () => {
    const seeded = await seedPurchase(1000);
    const refundId = `re_rec_${seeded.tag}`;
    createdRefundIds.push(refundId);

    expect(
      await makeService().recordRefund(
        refundFor(seeded, refundId, 'failed', 'expired_or_canceled_card')
      )
    ).toBe(true);
    expect(
      await makeService().recordRefund(
        refundFor(seeded, refundId, 'failed', 'expired_or_canceled_card')
      )
    ).toBe(false);

    const rows = await readRefund(refundId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purchaseId: seeded.purchase.id,
      stripeChargeId: seeded.charge.id,
      amountCents: 400,
      status: 'failed',
      reason: 'requested_by_customer',
      failureReason: 'expired_or_canceled_card',
      notifiedAt: null,
      resolution: null,
      resolvedAt: null,
    });
  });

  it('recordRefund moves a refund forward only: a stale event never undoes a later status', async () => {
    const seeded = await seedPurchase(1000);
    const refundId = `re_fwd_${seeded.tag}`;
    createdRefundIds.push(refundId);
    const service = makeService();
    const step = async (status: string) =>
      service.recordRefund(refundFor(seeded, refundId, status));
    const status = async () => (await readRefund(refundId))[0]?.status;

    expect(await step('pending')).toBe(true);
    expect(await step('succeeded')).toBe(true);
    expect(await step('pending')).toBe(false);
    expect(await status()).toBe('succeeded');
    // A succeeded refund can still fail, up to 30 days later.
    expect(await step('failed')).toBe(true);
    expect(await step('succeeded')).toBe(false);
    expect(await status()).toBe('failed');
  });

  it("recordRefund records a subscription charge's refund with no purchase, and skips a status it does not know", async () => {
    const refundId = `re_sub_${uid()}`;
    const unknownId = `re_new_${uid()}`;
    createdRefundIds.push(refundId, unknownId);

    await makeService().recordRefund(refundFor(null, refundId, 'succeeded'));
    expect(
      await makeService().recordRefund(
        refundFor(null, unknownId, 'a_status_stripe_adds_later')
      )
    ).toBe(false);

    expect((await readRefund(refundId))[0]?.purchaseId).toBeNull();
    expect(await readRefund(unknownId)).toHaveLength(0);
  });

  it('recordChargeRefunds records every refund of the charge, whatever its status, and returns them newest first', async () => {
    const seeded = await seedPurchase(1000);
    const ids = ['a', 'b', 'c'].map((x) => `re_list_${x}_${seeded.tag}`);
    createdRefundIds.push(...ids);
    stripeRefunds([
      { id: ids[0] as string, amount: 100, status: 'succeeded', created: 10 },
      { id: ids[1] as string, amount: 200, status: 'pending', created: 20 },
      { id: ids[2] as string, amount: 300, status: 'canceled', created: 30 },
    ]);

    const listed = await makeService().recordChargeRefunds({
      id: seeded.charge.id,
      paymentIntentId: seeded.paymentIntentId,
    });

    expect(listed.map((r) => r.id)).toEqual([...ids].reverse());
    const rows = await db
      .select()
      .from(refunds)
      .where(inArray(refunds.stripeRefundId, ids));
    expect(
      rows.map((r) => [r.stripeRefundId, r.status, r.purchaseId]).sort()
    ).toEqual([
      [ids[0], 'succeeded', seeded.purchase.id],
      [ids[1], 'pending', seeded.purchase.id],
      [ids[2], 'canceled', seeded.purchase.id],
    ]);
  });

  it('claimRefundEmails claims each pending or succeeded refund once, oldest first; never a failed, canceled or waiting one', async () => {
    const chargeId = `ch_mail_${uid()}`;
    const service = makeService();
    const statuses = [
      'succeeded',
      'pending',
      'failed',
      'canceled',
      'requires_action',
    ];
    const ids = statuses.map((status) => `re_mail_${status}_${uid()}`);
    createdRefundIds.push(...ids);
    for (const [i, status] of statuses.entries()) {
      await service.recordRefund({
        ...refundFor(null, ids[i] as string, status),
        stripeChargeId: chargeId,
        amountCents: 100 * (i + 1),
        stripeCreatedAt: new Date(Date.UTC(2026, 9, 19, 10, i)),
      });
    }

    expect(await service.claimRefundEmails(chargeId)).toEqual([
      { stripeRefundId: ids[0], amountCents: 100 },
      { stripeRefundId: ids[1], amountCents: 200 },
    ]);
    expect(await service.claimRefundEmails(chargeId)).toEqual([]);
  });

  // ── disputes (Codex-2hxff.9; docs/payments/dispute-record.md) ─────────

  function disputeFor(
    seeded: Seeded,
    disputeId: string,
    status: string,
    amountCents = seeded.charge.amountCents
  ) {
    return {
      stripeDisputeId: disputeId,
      stripeChargeId: seeded.charge.id,
      paymentIntentId: seeded.paymentIntentId,
      amountCents,
      currency: 'gbp',
      status,
      reason: 'fraudulent',
      stripeCreatedAt: new Date('2026-10-19T12:00:00Z'),
    };
  }

  async function grantAccess(seeded: Seeded) {
    const contentId = seeded.purchase.contentId;
    if (!contentId) throw new Error('the seeded purchase is for content');
    await db.insert(contentAccess).values({
      userId: buyerId,
      contentId,
      organizationId: orgId,
      accessType: 'purchased',
    });
    return async () =>
      takeFirst(
        await db
          .select()
          .from(contentAccess)
          .where(eq(contentAccess.contentId, contentId))
      );
  }

  it('recordDispute records a dispute with its purchase and moves it forward only; a final status never changes', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_fwd_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    const record = (status: string, amount?: number) =>
      service.recordDispute(disputeFor(seeded, disputeId, status, amount));

    expect(await record('warning_needs_response')).toMatchObject({
      status: 'warning_needs_response',
      purchaseId: seeded.purchase.id,
    });
    // An inquiry may become a chargeback; a stale inquiry event then changes
    // nothing.
    expect((await record('needs_response'))?.status).toBe('needs_response');
    expect((await record('warning_needs_response'))?.status).toBe(
      'needs_response'
    );
    // Still open: the amount can be corrected.
    expect((await record('needs_response', 800))?.amountCents).toBe(800);
    expect((await record('won'))?.status).toBe('won');
    expect((await record('lost'))?.status).toBe('won');
    expect((await record('under_review'))?.status).toBe('won');
    expect(
      await service.recordDispute(
        disputeFor(seeded, `dp_new_${seeded.tag}`, 'a_status_stripe_adds')
      )
    ).toBeUndefined();
  });

  // ── a late win (Codex-2hxff.70; late-win data design §3.3) ────────────
  // These replace the "alert only" tests (owner decision 2026-10-25), which
  // were right until this bead: the record now moves to won, and the undo
  // runs as an unapplied win (late-win.integration.test.ts).

  /** The service, with its error log watched. */
  function watchedService() {
    const service = makeService();
    const alert = vi.spyOn(
      (service as unknown as { obs: { error: (...args: unknown[]) => void } })
        .obs,
      'error'
    );
    return { service, alert };
  }

  it('a late win on an applied loss: the row becomes won, late_won_at set, the loss’s applied time kept in lost_applied_at and outcome_applied_at cleared; nothing is alerted, and a second delivery changes nothing', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_late_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const { service, alert } = watchedService();
    const record = (status: string) =>
      service.recordDispute(disputeFor(seeded, disputeId, status));
    await record('needs_response');
    await record('lost');
    await service.processLostDispute(seeded.paymentIntentId, 1000, disputeId);
    await service.markDisputeOutcomeApplied(disputeId, { status: 'lost' });
    const applied = (await record('lost'))?.outcomeAppliedAt;
    expect(applied).not.toBeNull();

    const after = await record('won');

    expect(after).toMatchObject({
      status: 'won',
      lostAppliedAt: applied,
      outcomeAppliedAt: null,
    });
    expect(after?.lateWonAt).toBeInstanceOf(Date);
    expect(after).not.toHaveProperty('refusedLost');
    expect(alert).not.toHaveBeenCalled();

    // A redelivery, or the reconcile's read of the same win.
    const again = await record('won');
    expect(again).toEqual(after);
  });

  it('a late win on a loss whose handling never finished: won with no lost_applied_at, and unapplied, for the undo to run', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_late_unapplied_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const { service, alert } = watchedService();
    const record = (status: string) =>
      service.recordDispute(disputeFor(seeded, disputeId, status));
    await record('lost');

    const after = await record('won');

    expect(after).toMatchObject({
      status: 'won',
      lostAppliedAt: null,
      outcomeAppliedAt: null,
    });
    expect(after?.lateWonAt).toBeInstanceOf(Date);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a late win writes updated_at, so the reconcile’s grace sees it as the webhook’s, then retries it as a won, unapplied row (premise 31)', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_late_grace_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));
    await service.markDisputeOutcomeApplied(disputeId, { status: 'lost' });
    // The loss was applied long ago.
    await db
      .update(disputes)
      .set({ updatedAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(disputes.stripeDisputeId, disputeId));
    const inSource2 = async (updatedBefore: Date) =>
      (await service.findDisputesToReconcile(10_000, updatedBefore)).some(
        (row) => row.stripeDisputeId === disputeId
      );

    await service.recordDispute(disputeFor(seeded, disputeId, 'won'));

    // Inside the 15-minute grace: still the webhook's.
    expect(await inSource2(new Date(Date.now() - 15 * 60_000))).toBe(false);
    // After it: won and unapplied, so the hourly source 2 retries the undo.
    expect(await inSource2(new Date(Date.now() + 60_000))).toBe(true);
  });

  it('won → lost is refused and flagged refusedLost; every other move out of a final status is refused silently; a normal win is not a late one', async () => {
    const seeded = await seedPurchase(1000);
    const wonId = `dp_won_${seeded.tag}`;
    const closedId = `dp_closed_${seeded.tag}`;
    createdDisputeIds.push(wonId, closedId);
    const { service, alert } = watchedService();
    const record = (disputeId: string, status: string) =>
      service.recordDispute(disputeFor(seeded, disputeId, status));

    await record(wonId, 'needs_response');
    const won = await record(wonId, 'won');
    expect(won).toMatchObject({ status: 'won', lateWonAt: null });
    expect(await record(wonId, 'lost')).toMatchObject({
      status: 'won',
      lateWonAt: null,
      refusedLost: true,
    });
    const prevented = await record(wonId, 'prevented');
    expect(prevented?.status).toBe('won');
    expect(prevented).not.toHaveProperty('refusedLost');
    // Only `lost` may become `won`: a closed inquiry may not.
    await record(closedId, 'warning_closed');
    expect(await record(closedId, 'won')).toMatchObject({
      status: 'warning_closed',
      lateWonAt: null,
    });
    const closedLost = await record(closedId, 'lost');
    expect(closedLost?.status).toBe('warning_closed');
    expect(closedLost).not.toHaveProperty('refusedLost');
    expect(alert).not.toHaveBeenCalled();
  });

  // ── an appeal of a lost chargeback (Codex-wzaoh; owner D34) ───────────
  // The webhook passes Stripe's raw status; the record reads an appeal
  // (`appeal_*`) as lost, with the appeal marked: only a loss is appealed,
  // and the money is lost either way.

  async function readDisputeRow(disputeId: string) {
    const [row] = await db
      .select()
      .from(disputes)
      .where(eq(disputes.stripeDisputeId, disputeId));
    return row;
  }

  /** Stripe's status, read live, as the webhook records it. */
  function liveFor(seeded: Seeded, disputeId: string, status: string) {
    return { ...disputeFor(seeded, disputeId, status), live: true };
  }

  /** The service's private appeal steps, for the races a test can't stage. */
  function appealSteps(service: PurchaseService) {
    return service as unknown as {
      clearDisputeAppeal: (marked: Dispute) => Promise<Dispute>;
      obs: {
        warn: (...args: unknown[]) => void;
        info: (...args: unknown[]) => void;
      };
    };
  }

  it("Stripe's raw appeal is recorded as lost and marked, and the mark follows Stripe back as well as forward; the loss stays unapplied for the caller to apply, and the same stage again writes nothing", async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    const appeal = (stage: 'appeal_needs_response' | 'appeal_under_review') =>
      service.recordDispute(liveFor(seeded, disputeId, stage));
    // Its `lost` event was missed: the appeal is how the loss arrives.
    await service.recordDispute(disputeFor(seeded, disputeId, 'under_review'));

    const needs = await appeal('appeal_needs_response');

    expect(needs).toMatchObject({
      status: 'lost',
      appealStatus: 'appeal_needs_response',
      outcomeAppliedAt: null,
    });
    expect(needs).not.toHaveProperty('appealCheck');
    // The same stage again: nothing is written, updated_at too.
    expect(await appeal('appeal_needs_response')).toEqual(needs);

    const review = await appeal('appeal_under_review');
    expect(review).toMatchObject({
      status: 'lost',
      appealStatus: 'appeal_under_review',
    });
    // Stripe asks for more evidence: the mark follows it back.
    const back = await appeal('appeal_needs_response');
    expect(back).toMatchObject({
      status: 'lost',
      appealStatus: 'appeal_needs_response',
    });
    expect(await readDisputeRow(disputeId)).toEqual(back);
  });

  it('an appeal for a dispute with no row records it lost and marked', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_new_${seeded.tag}`;
    createdDisputeIds.push(disputeId);

    const recorded = await makeService().recordDispute(
      liveFor(seeded, disputeId, 'appeal_under_review')
    );

    expect(recorded).toMatchObject({
      status: 'lost',
      appealStatus: 'appeal_under_review',
      outcomeAppliedAt: null,
      purchaseId: seeded.purchase.id,
    });
  });

  it('an appeal never marks a row that is not lost: a won one refuses it as lost, a closed inquiry keeps its status and it is logged', async () => {
    const seeded = await seedPurchase(1000);
    const wonId = `dp_appeal_won_${seeded.tag}`;
    const closedId = `dp_appeal_closed_${seeded.tag}`;
    createdDisputeIds.push(wonId, closedId);
    const service = makeService();
    const warn = vi.spyOn(appealSteps(service).obs, 'warn');
    await service.recordDispute(disputeFor(seeded, wonId, 'won'));
    await service.recordDispute(disputeFor(seeded, closedId, 'warning_closed'));

    const won = await service.recordDispute(
      liveFor(seeded, wonId, 'appeal_under_review')
    );
    const closed = await service.recordDispute(
      liveFor(seeded, closedId, 'appeal_needs_response')
    );

    expect(won).toMatchObject({
      status: 'won',
      appealStatus: null,
      refusedLost: true,
    });
    expect(closed).toMatchObject({
      status: 'warning_closed',
      appealStatus: null,
    });
    expect(await readDisputeRow(closedId)).toMatchObject({
      appealStatus: null,
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Stripe reports an appeal of a dispute recorded as neither lost nor won: not marked',
      {
        disputeId: closedId,
        status: 'warning_closed',
        appeal: 'appeal_needs_response',
      }
    );
  });

  it("a `lost` event for a row under appeal changes nothing and asks for Stripe's live status; the live `lost` clears the mark", async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_lost_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));
    const marked = await service.recordDispute(
      liveFor(seeded, disputeId, 'appeal_under_review')
    );

    // From an event: it may be older than the appeal.
    const fromEvent = await service.recordDispute(
      disputeFor(seeded, disputeId, 'lost')
    );
    expect(fromEvent).toEqual({ ...marked, appealCheck: true });
    expect(await readDisputeRow(disputeId)).toEqual(marked);
    // Any other stale event is refused as before, and asks nothing.
    expect(
      await service.recordDispute(disputeFor(seeded, disputeId, 'under_review'))
    ).toEqual(marked);

    // Read live: the bank has decided.
    const decided = await service.recordDispute(
      liveFor(seeded, disputeId, 'lost')
    );
    expect(decided).toMatchObject({ status: 'lost', appealStatus: null });
    expect(decided).not.toHaveProperty('appealCheck');
    // A redelivered `lost` with no appeal to clear writes nothing.
    expect(
      await service.recordDispute(disputeFor(seeded, disputeId, 'lost'))
    ).toEqual(decided);
  });

  it('a late win clears the mark in its own statement', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_late_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));
    await service.recordDispute(
      liveFor(seeded, disputeId, 'appeal_under_review')
    );

    const wonLate = await service.recordDispute(
      disputeFor(seeded, disputeId, 'won')
    );

    expect(wonLate).toMatchObject({ status: 'won', appealStatus: null });
    expect(wonLate?.lateWonAt).toBeInstanceOf(Date);
  });

  it("a mark left stale on a won row (an older worker's late win, after a rollback) is cleared by the next record of it", async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_stale_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));
    await service.recordDispute(
      liveFor(seeded, disputeId, 'appeal_under_review')
    );
    // The older recordLateWin: lost → won, the mark left in place.
    await db
      .update(disputes)
      .set({ status: 'won', lateWonAt: new Date() })
      .where(eq(disputes.stripeDisputeId, disputeId));

    const repaired = await service.recordDispute(
      liveFor(seeded, disputeId, 'won')
    );

    expect(repaired).toMatchObject({ status: 'won', appealStatus: null });
    expect(await readDisputeRow(disputeId)).toMatchObject({
      status: 'won',
      appealStatus: null,
    });
  });

  it('a clear writes only while the row is still marked: not after a late win cleared it, nor after another clear', async () => {
    const seeded = await seedPurchase(1000);
    const movedId = `dp_appeal_moved_${seeded.tag}`;
    const clearedId = `dp_appeal_cleared_${seeded.tag}`;
    createdDisputeIds.push(movedId, clearedId);
    const service = makeService();
    const readAsMarked: Record<string, Dispute> = {};
    for (const disputeId of [movedId, clearedId]) {
      await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));
      const marked = await service.recordDispute(
        liveFor(seeded, disputeId, 'appeal_under_review')
      );
      if (!marked) throw new Error('the appeal was not recorded');
      readAsMarked[disputeId] = marked;
    }
    // Between the read and the clear: a late win, and another clear.
    await service.recordDispute(disputeFor(seeded, movedId, 'won'));
    await service.recordDispute(liveFor(seeded, clearedId, 'lost'));
    const before = {
      moved: await readDisputeRow(movedId),
      cleared: await readDisputeRow(clearedId),
    };

    for (const disputeId of [movedId, clearedId]) {
      const stale = readAsMarked[disputeId];
      if (!stale) throw new Error('no row as read');
      expect(await appealSteps(service).clearDisputeAppeal(stale)).toEqual(
        stale
      );
    }

    expect(await readDisputeRow(movedId)).toEqual(before.moved);
    expect(await readDisputeRow(clearedId)).toEqual(before.cleared);
  });

  it("an appeal from an event, not read live, marks nothing and asks for Stripe's live status: it may be older than the bank's decision", async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_event_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    const lost = await service.recordDispute(
      disputeFor(seeded, disputeId, 'lost')
    );
    if (!lost) throw new Error('the loss was not recorded');

    const fromEvent = await service.recordDispute(
      disputeFor(seeded, disputeId, 'appeal_needs_response')
    );

    expect(fromEvent).toEqual({ ...lost, appealCheck: true });
    expect(await readDisputeRow(disputeId)).toEqual(lost);
  });

  it('a mark written or cleared is logged once at info, with ids and stages only; a write that changes nothing logs nothing', async () => {
    const seeded = await seedPurchase(1000);
    const disputeId = `dp_appeal_logged_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    const marked = 'A lost dispute was marked with its appeal';
    const cleared = "A dispute's appeal mark was cleared";
    const info = vi.spyOn(appealSteps(service).obs, 'info');
    await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));

    const needs = await service.recordDispute(
      liveFor(seeded, disputeId, 'appeal_needs_response')
    );
    if (!needs) throw new Error('the appeal was not recorded');
    // The same stage again, then the decision, then the decision again.
    await service.recordDispute(
      liveFor(seeded, disputeId, 'appeal_needs_response')
    );
    await service.recordDispute(liveFor(seeded, disputeId, 'lost'));
    await service.recordDispute(liveFor(seeded, disputeId, 'lost'));
    // A clear of a mark that is already gone.
    await appealSteps(service).clearDisputeAppeal(needs);

    expect(
      info.mock.calls.filter(
        ([message]) => message === marked || message === cleared
      )
    ).toEqual([
      [marked, { disputeId, appeal: 'appeal_needs_response', was: null }],
      [cleared, { disputeId, was: 'appeal_needs_response' }],
    ]);
  });

  it('clearStaleDisputeAppealMarks clears the mark on every applied dispute that is not lost, and leaves a lost one, and a won one still being undone, marked; it logs what it cleared, and nothing when there is none', async () => {
    const seeded = await seedPurchase(1000);
    const wonId = `dp_stale_won_${seeded.tag}`;
    const undoingId = `dp_stale_undoing_${seeded.tag}`;
    const lostId = `dp_stale_lost_${seeded.tag}`;
    createdDisputeIds.push(wonId, undoingId, lostId);
    const service = makeService();
    for (const disputeId of [wonId, undoingId, lostId]) {
      await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));
      await service.recordDispute(
        liveFor(seeded, disputeId, 'appeal_under_review')
      );
    }
    // An older worker's late win: lost → won, the mark left in place. Its
    // undo has finished on one (applied), and is still to run on the other,
    // which the reconcile's retry of unsettled rows settles, its live record
    // clearing the mark; this step leaves it, so that retry's grace never
    // skips it.
    await db
      .update(disputes)
      .set({
        status: 'won',
        lateWonAt: new Date(),
        outcomeAppliedAt: new Date(),
      })
      .where(eq(disputes.stripeDisputeId, wonId));
    await db
      .update(disputes)
      .set({ status: 'won', lateWonAt: new Date(), outcomeAppliedAt: null })
      .where(eq(disputes.stripeDisputeId, undoingId));
    const info = vi.spyOn(appealSteps(service).obs, 'info');

    const clearedIds = await service.clearStaleDisputeAppealMarks();

    expect(clearedIds).toContain(wonId);
    expect(clearedIds).not.toContain(undoingId);
    expect(clearedIds).not.toContain(lostId);
    expect(await readDisputeRow(undoingId)).toMatchObject({
      status: 'won',
      appealStatus: 'appeal_under_review',
      outcomeAppliedAt: null,
    });
    expect(await readDisputeRow(wonId)).toMatchObject({
      status: 'won',
      appealStatus: null,
    });
    expect(await readDisputeRow(lostId)).toMatchObject({
      status: 'lost',
      appealStatus: 'appeal_under_review',
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      'Stale appeal marks were cleared from disputes that are not lost',
      { count: clearedIds.length, disputeIds: clearedIds }
    );

    // Nothing left to clear: nothing written, nothing logged.
    expect(await service.clearStaleDisputeAppealMarks()).toEqual([]);
    expect(info).toHaveBeenCalledOnce();
  });

  it('an open dispute holds a purchase row recorded before charge ids, by its purchase', async () => {
    const seeded = await seedPurchase(1000);
    const legacy = takeFirst(
      await db
        .insert(payouts)
        .values({
          purchaseId: seeded.purchase.id,
          organizationId: orgId,
          userId: creatorA,
          payoutType: 'creator_payout',
          amountCents: 765,
          status: 'pending',
          sourceType: 'purchase',
          stripeChargeId: null,
          reason: 'connect_not_ready',
        })
        .returning()
    );
    createdPayoutIds.push(legacy.id);
    const drainable = async () =>
      (
        await db
          .select({ id: payouts.id })
          .from(payouts)
          .where(and(eq(payouts.id, legacy.id), isDrainablePayout()))
      ).length === 1;
    expect(await drainable()).toBe(true);

    const disputeId = `dp_hold_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    await makeService().recordDispute(
      disputeFor(seeded, disputeId, 'needs_response')
    );

    expect(await drainable()).toBe(false);
  });

  it("a chargeback claws back the purchase slices (clawBackPurchaseCharge); won pays them back, outside the purchase's scope from then on", async () => {
    const seeded = await seedPurchase(1000);
    const { creator } = await paidSplit(seeded);
    const service = makeService();
    const disputeId = `dp_claw_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    await service.recordDispute(
      disputeFor(seeded, disputeId, 'needs_response', 500)
    );

    await service.clawBackPurchaseCharge(seeded.paymentIntentId, seeded.charge);
    expect(reversedAmount(creator.stripeTransferId)).toBe(382);

    await service.recordDispute(disputeFor(seeded, disputeId, 'won', 500));
    await service.settleWonDispute(disputeId);
    const [won] = await db
      .select()
      .from(disputes)
      .where(eq(disputes.stripeDisputeId, disputeId));
    expect(won?.outcomeAppliedAt).not.toBeNull();
    // The creator's reversal: the fee's share is cancelled, not re-paid.
    const [link] = await db
      .select({ repaid: payoutReversals.repaidByPayoutId })
      .from(payoutReversals)
      .where(
        and(
          eq(payoutReversals.causeId, disputeId),
          eq(payoutReversals.payoutId, creator.id)
        )
      );
    const repay = takeFirst(
      await db
        .select()
        .from(payouts)
        .where(eq(payouts.id, link?.repaid ?? ''))
    );
    // The re-pay row carries the purchase id, as every purchase row does…
    expect(repay).toMatchObject({
      purchaseId: seeded.purchase.id,
      amountCents: 382,
      status: 'pending',
      stripeChargeId: null,
    });

    // …but is never clawed back as a slice of the charge. Codex-2hxff.59 item
    // 1a: a later refund takes the CREATOR SLICE's share,
    // floor(765 × 300/1000) = 229, off the still-unpaid re-pay row, by a
    // reduction recorded on that row. It is not a share of the re-pay row's
    // own 382, no transfer is reversed, and no person is needed: the
    // `slice_repaid` review is only for a re-pay row already paid.
    vi.mocked(stripe.transfers.createReversal).mockClear();
    stripeRefunds([{ id: `re_after_${seeded.tag}`, amount: 300 }]);
    await refundEvent(seeded, `re_after_${seeded.tag}`, 300);
    expect(
      await db
        .select()
        .from(payoutReversals)
        .where(eq(payoutReversals.payoutId, repay.id))
    ).toMatchObject([
      {
        causeType: 'refund',
        causeId: `re_after_${seeded.tag}`,
        kind: 'pending_reduction',
        amountCents: 229,
        status: 'done',
      },
    ]);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect((await readRow(repay.id)).status).toBe('pending');
    expect(
      await db
        .select()
        .from(refundReviews)
        .where(inArray(refundReviews.payoutId, [creator.id, repay.id]))
    ).toHaveLength(0);
  });

  it('restoreDisputedPurchase: a won dispute restores the access a chargeback paused, and clears the mark', async () => {
    const seeded = await seedPurchase(1000);
    const access = await grantAccess(seeded);
    const service = makeService();
    await service.processDispute(seeded.paymentIntentId, {
      stripeDisputeId: `dp_restore_${seeded.tag}`,
    });
    expect((await access()).deletedAt).not.toBeNull();

    const scope = await service.restoreDisputedPurchase(seeded.paymentIntentId);

    expect(scope).toEqual({ userId: buyerId, orgId });
    expect((await access()).deletedAt).toBeNull();
    expect((await readPurchase(seeded.purchase.id)).disputedAt).toBeNull();
  });

  it('restoreDisputedPurchase leaves a purchase refunded since without access', async () => {
    const seeded = await seedPurchase(1000);
    const access = await grantAccess(seeded);
    const service = makeService();
    await service.processDispute(seeded.paymentIntentId, {
      stripeDisputeId: `dp_refunded_${seeded.tag}`,
    });
    await db
      .update(purchases)
      .set({ status: 'refunded' })
      .where(eq(purchases.id, seeded.purchase.id));

    await service.restoreDisputedPurchase(seeded.paymentIntentId);

    expect((await access()).deletedAt).not.toBeNull();
  });

  it('processLostDispute: the purchase becomes refunded with the disputed amount added, capped at what was paid; access stays ended (owner decision Q3)', async () => {
    const seeded = await seedPurchase(1000);
    const access = await grantAccess(seeded);
    // A partial refund first (P-1 kept it completed).
    await db
      .update(purchases)
      .set({ refundAmountCents: 300 })
      .where(eq(purchases.id, seeded.purchase.id));
    const disputeId = `dp_lost_q3_${seeded.tag}`;
    createdDisputeIds.push(disputeId);
    const service = makeService();
    await service.recordDispute(disputeFor(seeded, disputeId, 'lost'));

    await service.processLostDispute(seeded.paymentIntentId, 1000, disputeId);

    expect(await readPurchase(seeded.purchase.id)).toMatchObject({
      status: 'refunded',
      refundAmountCents: 1000,
    });
    expect((await access()).deletedAt).not.toBeNull();
  });
});
