/**
 * CHARACTERISATION — the purchase refund clawback
 * (`PurchaseService.processRefund` → @codex/payments `reverseCharge`, purchase
 * source).
 *
 * Written against the purchase copy, `reversePayoutsForPurchase`, before WP3
 * of Codex-2hxff.56 extracted ONE clawback engine to replace it and its
 * divergent subscription copy (pinned in
 * packages/subscription/src/services/__tests__/subscription-refund-reversal.characterisation.test.ts).
 * These tests pin every observable behaviour — the Stripe calls (amount,
 * metadata, idempotency key), the ledger rows it leaves, the refund_reviews
 * rows it writes and the logs it emits — and passed unchanged across the
 * extraction (WP3b-2, Codex-2hxff.56.3), which is the proof it changed
 * NOTHING.
 *
 * They pin CURRENT behaviour, defects included. A test named
 * "CHARACTERISATION (defect)" asserts something the spec says is wrong; its
 * comment quotes the spec line and names the bead whose behaviour PR will flip
 * it. Do NOT "fix" one of these to match the spec, except in that behaviour PR,
 * deliberately and in the same change as the code. "CHARACTERISATION:" tests
 * pin behaviour that is correct (or a neutral divergence the engine must keep).
 *
 * Fixtures: real test DB (purchase + payouts rows inserted directly, so each
 * row's status, amount and transfer is exact) and the shared Stripe mock
 * (`createMockStripe`), with per-test overrides of `transfers.createReversal`.
 * Every Stripe id carries a run-unique tag. Payout rows feed global drains, so
 * every row this file creates is deleted in `afterAll`.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  organizations,
  type Payout,
  type Purchase,
  payouts,
  purchases,
  refundReviews,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
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

type PayoutType =
  | 'platform_fee'
  | 'organization_fee'
  | 'creator_payout'
  | 'creator_payout_to_owner';
type PayoutStatus =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'reversed'
  | 'cancelled_by_refund';

interface ObsLike {
  error(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
}

interface ReversalCall {
  transferId: string;
  params: { amount?: number; metadata?: Record<string, string> } | undefined;
  options: { idempotencyKey?: string } | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DB_DOWN = 'Connection terminated unexpectedly';

const uid = () => randomUUID().slice(0, 8);

describe('PurchaseService refund clawback — characterisation (Codex-2hxff.56 WP3)', () => {
  let db: Database;
  let stripe: Stripe;
  let buyerId: string;
  let creatorA: string;
  let creatorB: string;
  let orgId: string;
  const createdPayoutIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorA, creatorB] = await seedTestUsers(db, 3);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Clawback Characterisation Org',
          slug: createUniqueSlug('clawback-char'),
        })
        .returning()
    ).id;
  });

  beforeEach(async () => {
    stripe = createMockStripe();
    // One Connect account per user: each test that needs one seeds it.
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [creatorA, creatorB]));
  });

  afterAll(async () => {
    // Payout rows feed global drains/sweeps — never leave them behind.
    // refund_reviews references payouts with onDelete: 'restrict'.
    if (createdPayoutIds.length > 0) {
      await db
        .delete(refundReviews)
        .where(inArray(refundReviews.payoutId, createdPayoutIds));
      await db.delete(payouts).where(inArray(payouts.id, createdPayoutIds));
    }
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [creatorA, creatorB]));
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function makeService(database: Database = db): PurchaseService {
    return new PurchaseService({ db: database, environment: 'test' }, stripe);
  }

  function spyObs(service: PurchaseService) {
    const obs = (service as unknown as { obs: ObsLike }).obs;
    return {
      error: vi.spyOn(obs, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(obs, 'warn').mockImplementation(() => {}),
      info: vi.spyOn(obs, 'info').mockImplementation(() => {}),
    };
  }

  function logged(
    spy: { mock: { calls: unknown[][] } },
    message: string
  ): unknown[] {
    return spy.mock.calls
      .filter(([m]) => m === message)
      .map(([, meta]) => meta);
  }

  /**
   * A completed purchase (content target, split columns summing to the amount
   * so `check_revenue_split_equals_total` holds). No payouts rows — the test
   * inserts exactly the rows it needs with `insertPayout`.
   */
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
            slug: createUniqueSlug('clawback-char'),
          })
        )
        .returning()
    );
    const paymentIntentId = `pi_char_${tag}`;
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
          stripePaymentIntentId: paymentIntentId,
          status: 'completed',
          purchasedAt: new Date(),
        })
        .returning()
    );
    return { purchase, paymentIntentId, chargeId: `ch_char_${tag}`, tag };
  }

  async function insertPayout(spec: {
    purchaseId: string | null;
    payoutType: PayoutType;
    amountCents: number;
    status: PayoutStatus;
    userId: string | null;
    stripeChargeId: string | null;
    stripeTransferId?: string | null;
    sourceType?: 'purchase' | 'subscription';
    reason?: 'connect_not_ready' | 'transfer_failed' | null;
  }): Promise<Payout> {
    const settled = spec.status === 'paid' || spec.status === 'reversed';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          purchaseId: spec.purchaseId,
          organizationId: orgId,
          userId: spec.userId,
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status: spec.status,
          sourceType: spec.sourceType ?? 'purchase',
          stripeChargeId: spec.stripeChargeId,
          stripeTransferId: spec.stripeTransferId ?? null,
          transferGroup: spec.stripeChargeId
            ? `grp_${spec.stripeChargeId}`
            : null,
          reason: spec.reason ?? null,
          resolvedAt: settled ? new Date() : null,
          lastRetryAt: spec.status === 'failed' ? new Date() : null,
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /** platform_fee (no transfer) + organization_fee + creator_payout, all paid. */
  async function seedPaidSplit(
    seeded: Awaited<ReturnType<typeof seedPurchase>>,
    amounts: { platform?: number; org: number; creator: number }
  ) {
    const platform =
      amounts.platform === undefined
        ? undefined
        : await insertPayout({
            purchaseId: seeded.purchase.id,
            payoutType: 'platform_fee',
            amountCents: amounts.platform,
            status: 'paid',
            userId: null,
            stripeChargeId: seeded.chargeId,
          });
    const org = await insertPayout({
      purchaseId: seeded.purchase.id,
      payoutType: 'organization_fee',
      amountCents: amounts.org,
      status: 'paid',
      userId: creatorA,
      stripeChargeId: seeded.chargeId,
      stripeTransferId: `tr_org_${seeded.tag}`,
    });
    const creator = await insertPayout({
      purchaseId: seeded.purchase.id,
      payoutType: 'creator_payout',
      amountCents: amounts.creator,
      status: 'paid',
      userId: creatorA,
      stripeChargeId: seeded.chargeId,
      stripeTransferId: `tr_creator_${seeded.tag}`,
    });
    return { platform, org, creator };
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function readPurchase(id: string): Promise<Purchase> {
    return takeFirst(
      await db.select().from(purchases).where(eq(purchases.id, id))
    );
  }

  function reversalCalls(): ReversalCall[] {
    const calls = vi.mocked(stripe.transfers.createReversal).mock
      .calls as unknown as Array<
      [string, ReversalCall['params'], ReversalCall['options']]
    >;
    return calls.map(([transferId, params, options]) => ({
      transferId,
      params,
      options,
    }));
  }

  function amountFor(transferId: string): number | undefined {
    return reversalCalls().find((c) => c.transferId === transferId)?.params
      ?.amount;
  }

  /** Reject `createReversal` for one transfer (all others succeed). */
  function rejectReversalFor(
    transferId: string,
    error: unknown,
    times = Number.POSITIVE_INFINITY
  ) {
    let remaining = times;
    vi.mocked(stripe.transfers.createReversal).mockImplementation((async (
      id: string,
      params?: { amount?: number }
    ) => {
      if (id === transferId && remaining > 0) {
        remaining -= 1;
        throw error;
      }
      return {
        id: `trr_${uid()}`,
        object: 'transfer_reversal',
        transfer: id,
        amount: params?.amount ?? 0,
      };
    }) as never);
  }

  /**
   * A db whose N-th `update(payouts).set({ status })` for the given status
   * throws — as course-subscription-service.integration.test.ts does with a
   * failing `insert`. Everything else passes through to the real db.
   */
  function failingPayoutUpdate(
    status: 'cancelled_by_refund' | 'reversed',
    failOnAttempt: number
  ): Database {
    let attempts = 0;
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return (table: typeof payouts) => {
            const builder = target.update(table) as unknown as {
              set: (values: Record<string, unknown>) => unknown;
            };
            const realSet = builder.set.bind(builder);
            builder.set = (values) => {
              if (table === payouts && values.status === status) {
                attempts += 1;
                if (attempts === failOnAttempt) throw new Error(DB_DOWN);
              }
              return realSet(values);
            };
            return builder;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  async function threePendingRows(
    seeded: Awaited<ReturnType<typeof seedPurchase>>
  ) {
    // Payees have no Connect account, so the post-cancel Stripe lookup is
    // skipped and a successful cancel ends at cancelled_by_refund.
    return Promise.all([
      insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'creator_payout',
        amountCents: 300,
        status: 'pending',
        userId: creatorA,
        stripeChargeId: seeded.chargeId,
        reason: 'connect_not_ready',
      }),
      insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'creator_payout',
        amountCents: 300,
        status: 'pending',
        userId: creatorB,
        stripeChargeId: seeded.chargeId,
        reason: 'connect_not_ready',
      }),
      insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'organization_fee',
        amountCents: 100,
        status: 'pending',
        userId: creatorA,
        stripeChargeId: seeded.chargeId,
        reason: 'connect_not_ready',
      }),
    ]);
  }

  // ── 1. a cancel that throws ───────────────────────────────────────────

  describe('1 · cancelUnpaidPayoutForRefund throws for one row', () => {
    it('CHARACTERISATION: the failure is logged with an errorId and the remaining rows are still cancelled; the refund resolves', async () => {
      const seeded = await seedPurchase(1000);
      const rows = await threePendingRows(seeded);
      const service = makeService(
        failingPayoutUpdate('cancelled_by_refund', 2)
      );
      const obs = spyObs(service);

      const result = await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_cancel_${seeded.tag}`,
        refundAmountCents: 1000,
      });

      expect(result).toEqual({ userId: buyerId });
      const after = await Promise.all(rows.map((r) => readRow(r.id)));
      const statuses = after.map((r) => r.status).sort();
      expect(statuses).toEqual([
        'cancelled_by_refund',
        'cancelled_by_refund',
        'pending',
      ]);
      const stuck = after.find((r) => r.status === 'pending');
      expect(
        logged(obs.error, 'Failed to cancel payouts row for refund')
      ).toEqual([
        {
          errorId: expect.stringMatching(UUID),
          purchaseId: seeded.purchase.id,
          payoutId: stuck?.id,
          error: DB_DOWN,
        },
      ]);
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect((await readPurchase(seeded.purchase.id)).status).toBe('refunded');
    });
  });

  // ── 2. redelivery after a failure ─────────────────────────────────────

  describe('2 · the same refund delivered again after a failure', () => {
    // Spec (docs/payments/purchases.md#refunds, full refund): "every pending or
    // failed slice becomes `cancelled_by_refund` — first, so nothing can mark it
    // paid afterwards." The code's own comment admits the gap: "a redelivery
    // stops at the 'already processed' check and would never come back to this
    // row." Flipped by Codex-2hxff.8 (PAY-03).
    it('CHARACTERISATION (defect): a row the first delivery failed to cancel is never retried — the REFUNDED gate returns first', async () => {
      const seeded = await seedPurchase(1000);
      const rows = await threePendingRows(seeded);
      const refund = {
        stripeRefundId: `re_redeliver_${seeded.tag}`,
        refundAmountCents: 1000,
      };
      const first = makeService(failingPayoutUpdate('cancelled_by_refund', 1));
      spyObs(first);
      await first.processRefund(seeded.paymentIntentId, refund);
      const stuckId = (await Promise.all(rows.map((r) => readRow(r.id)))).find(
        (r) => r.status === 'pending'
      )?.id;
      expect(stuckId).toBeDefined();

      const second = makeService();
      const obs = spyObs(second);
      const result = await second.processRefund(seeded.paymentIntentId, refund);

      expect(result).toEqual({ userId: buyerId });
      expect(logged(obs.info, 'Refund already processed')).toEqual([
        {
          purchaseId: seeded.purchase.id,
          paymentIntentId: seeded.paymentIntentId,
        },
      ]);
      // Still pending — and so still drainable: the next drain pays it.
      expect((await readRow(stuckId as string)).status).toBe('pending');
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    });

    it('CHARACTERISATION: an insufficient_funds reversal is not retried by a redelivery — one Stripe call, one refund_reviews row', async () => {
      const seeded = await seedPurchase(1000);
      const { creator } = await seedPaidSplit(seeded, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      rejectReversalFor(
        `tr_creator_${seeded.tag}`,
        Object.assign(new Error('Insufficient funds'), {
          code: 'insufficient_funds',
        })
      );
      const refund = {
        stripeRefundId: `re_if_redeliver_${seeded.tag}`,
        refundAmountCents: 1000,
      };
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, refund);
      await service.processRefund(seeded.paymentIntentId, refund);

      expect(
        reversalCalls().filter(
          (c) => c.transferId === `tr_creator_${seeded.tag}`
        )
      ).toHaveLength(1);
      expect(reversalCalls()).toHaveLength(2);
      expect((await readRow(creator.id)).status).toBe('paid');
      const reviews = await db
        .select()
        .from(refundReviews)
        .where(eq(refundReviews.payoutId, creator.id));
      expect(reviews).toHaveLength(1);
    });
  });

  // ── 3. two partial refunds on one charge ──────────────────────────────

  describe('3 · two partial refunds on one charge (cumulative amount_refunded)', () => {
    // Spec (docs/payments/purchases.md#refunds): "Each event is handled for the
    // amount **newly** refunded — the charge's cumulative `amount_refunded` minus
    // what has already been processed — so a second partial refund claws back
    // its own increment — **gap**: `Codex-2hxff.8` (partial refunds)." and
    // "A partial refund … the buyer **keeps** access … — **gap**:
    // `Codex-2hxff.8` (today any refund removes access)." Flipped by Codex-2hxff.8.
    it('CHARACTERISATION (defect): the first partial marks the purchase refunded and every row reversed; the second partial reverses nothing and is not recorded', async () => {
      const seeded = await seedPurchase(2000);
      const rows = await seedPaidSplit(seeded, {
        platform: 200,
        org: 270,
        creator: 1530,
      });
      const service = makeService();
      spyObs(service);
      const re1 = `re_part1_${seeded.tag}`;
      const re2 = `re_part2_${seeded.tag}`;

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: re1,
        refundAmountCents: 500,
      });

      // floor(1530 × 500 / 2000) = 382; floor(270 × 500 / 2000) = 67.
      expect(
        reversalCalls().map((c) => [c.transferId, c.params?.amount, c.options])
      ).toEqual(
        expect.arrayContaining([
          [
            `tr_creator_${seeded.tag}`,
            382,
            { idempotencyKey: `tr_creator_${seeded.tag}_reversal_${re1}` },
          ],
          [
            `tr_org_${seeded.tag}`,
            67,
            { idempotencyKey: `tr_org_${seeded.tag}_reversal_${re1}` },
          ],
        ])
      );
      expect(reversalCalls()).toHaveLength(2);
      for (const row of [rows.platform, rows.org, rows.creator]) {
        expect((await readRow(row?.id as string)).status).toBe('reversed');
      }
      const afterFirst = await readPurchase(seeded.purchase.id);
      expect(afterFirst).toMatchObject({
        status: 'refunded',
        refundAmountCents: 500,
        stripeRefundId: re1,
      });

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: re2,
        refundAmountCents: 1000,
      });

      expect(reversalCalls()).toHaveLength(2);
      expect(await readPurchase(seeded.purchase.id)).toMatchObject({
        status: 'refunded',
        refundAmountCents: 500,
        stripeRefundId: re1,
      });
    });
  });

  // ── 4. the denominator ────────────────────────────────────────────────

  describe('4 · the partial-refund denominator', () => {
    it('CHARACTERISATION: the fraction is refund / purchase.amountPaidCents, not the sum of the payout rows', async () => {
      // amountPaidCents 2000, but only the two transfer rows exist (sum 1800).
      const seeded = await seedPurchase(2000);
      await seedPaidSplit(seeded, { org: 270, creator: 1530 });
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_denom_${seeded.tag}`,
        refundAmountCents: 500,
      });

      // ÷2000: 382 / 67. (÷1800 would give 425 / 75.)
      expect(amountFor(`tr_creator_${seeded.tag}`)).toBe(382);
      expect(amountFor(`tr_org_${seeded.tag}`)).toBe(67);
    });

    it('CHARACTERISATION: a refund equal to the row sum but below amountPaidCents is still partial', async () => {
      const seeded = await seedPurchase(2000);
      await seedPaidSplit(seeded, { org: 270, creator: 1530 });
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_denom_full_${seeded.tag}`,
        refundAmountCents: 1800,
      });

      // floor(1530 × 1800 / 2000) = 1377; floor(270 × 1800 / 2000) = 243.
      expect(amountFor(`tr_creator_${seeded.tag}`)).toBe(1377);
      expect(amountFor(`tr_org_${seeded.tag}`)).toBe(243);
    });
  });

  // ── 5. a non-insufficient_funds reversal failure ──────────────────────

  describe('5 · a reversal rejected for a reason other than insufficient_funds', () => {
    // Spec (docs/payments/purchases.md#refunds, Reversals): "Any other reversal
    // failure is retried. A row is marked `reversed` only once the reversal
    // succeeds — **gap**: `Codex-2hxff.8`." Flipped by Codex-2hxff.8 (PAY-04).
    it('CHARACTERISATION (defect): the row is still marked reversed and no refund_reviews row is written', async () => {
      const seeded = await seedPurchase(1000);
      const { org, creator } = await seedPaidSplit(seeded, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      const balanceError = Object.assign(new Error('Balance insufficient'), {
        code: 'balance_insufficient',
      });
      const genericError = new Error(
        'An error occurred with our connection to Stripe'
      );
      vi.mocked(stripe.transfers.createReversal).mockImplementation((async (
        id: string
      ) => {
        throw id === creator.stripeTransferId ? balanceError : genericError;
      }) as never);
      const service = makeService();
      const obs = spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_generic_${seeded.tag}`,
        refundAmountCents: 1000,
      });

      expect(await readRow(creator.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: creator.stripeTransferId,
      });
      expect(await readRow(org.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: org.stripeTransferId,
      });
      expect(
        await db
          .select()
          .from(refundReviews)
          .where(eq(refundReviews.purchaseId, seeded.purchase.id))
      ).toHaveLength(0);
      const codes = logged(
        obs.error,
        'Failed to reverse Stripe transfer for refund'
      )
        .map((m) => (m as { code: unknown }).code)
        .sort();
      expect(codes).toEqual(['balance_insufficient', null]);
      expect(obs.warn).not.toHaveBeenCalled();
    });
  });

  // ── 6. insufficient_funds ─────────────────────────────────────────────

  describe('6 · insufficient_funds', () => {
    it('CHARACTERISATION: refund_reviews records the proportional amount and the Stripe message; the row stays paid and untouched; a warn is logged', async () => {
      const seeded = await seedPurchase(2000);
      const { platform, org, creator } = await seedPaidSplit(seeded, {
        platform: 200,
        org: 270,
        creator: 1530,
      });
      rejectReversalFor(
        creator.stripeTransferId as string,
        Object.assign(
          new Error('Insufficient funds in the connected account'),
          {
            code: 'insufficient_funds',
          }
        )
      );
      const service = makeService();
      const obs = spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_if_${seeded.tag}`,
        refundAmountCents: 500,
      });

      const reviews = await db
        .select()
        .from(refundReviews)
        .where(eq(refundReviews.purchaseId, seeded.purchase.id));
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        payoutId: creator.id,
        creatorUserId: creatorA,
        attemptedReversalCents: 382,
        errorCode: 'insufficient_funds',
        errorMessage: 'Insufficient funds in the connected account',
        resolution: null,
        resolvedAt: null,
      });
      const creatorAfter = await readRow(creator.id);
      expect(creatorAfter.status).toBe('paid');
      expect(creatorAfter.updatedAt.getTime()).toBe(
        creator.updatedAt.getTime()
      );
      expect((await readRow(org.id)).status).toBe('reversed');
      expect((await readRow(platform?.id as string)).status).toBe('reversed');
      expect(
        logged(obs.warn, 'Refund review queued for ops resolution')
      ).toEqual([
        {
          purchaseId: seeded.purchase.id,
          payoutId: creator.id,
          creatorUserId: creatorA,
          attemptedReversalCents: 382,
          errorCode: 'insufficient_funds',
        },
      ]);
    });

    // Spec (docs/payments/purchases.md#refunds, Reversals): "A row is marked
    // `reversed` only once the reversal succeeds — **gap**: `Codex-2hxff.8`."
    // The review is gated on `row.userId`; a payee-less row with a transfer
    // (only a platform_fee row may be paid with no payee) falls through to the
    // status flip. The subscription copy has no such gate and leaves it paid.
    // Flipped by Codex-2hxff.8.
    it('CHARACTERISATION (defect): insufficient_funds on a row with no payee writes no review and marks the row reversed', async () => {
      const seeded = await seedPurchase(1000);
      const feeWithTransfer = await insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'platform_fee',
        amountCents: 100,
        status: 'paid',
        userId: null,
        stripeChargeId: seeded.chargeId,
        stripeTransferId: `tr_fee_${seeded.tag}`,
      });
      rejectReversalFor(
        `tr_fee_${seeded.tag}`,
        Object.assign(new Error('Insufficient funds'), {
          code: 'insufficient_funds',
        })
      );
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_if_nopayee_${seeded.tag}`,
        refundAmountCents: 1000,
      });

      expect((await readRow(feeWithTransfer.id)).status).toBe('reversed');
      expect(
        await db
          .select()
          .from(refundReviews)
          .where(eq(refundReviews.payoutId, feeWithTransfer.id))
      ).toHaveLength(0);
    });
  });

  // ── 7. zero floor ─────────────────────────────────────────────────────

  describe('7 · a proportional share that floors to zero', () => {
    it('CHARACTERISATION: no Stripe call, the transfer rows stay paid, an info log per row — and the platform_fee row is still marked reversed', async () => {
      const seeded = await seedPurchase(1000);
      const { platform, org, creator } = await seedPaidSplit(seeded, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      const service = makeService();
      const obs = spyObs(service);

      // floor(135 × 1 / 1000) = 0; floor(765 × 1 / 1000) = 0.
      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_floor_${seeded.tag}`,
        refundAmountCents: 1,
      });

      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect((await readRow(org.id)).status).toBe('paid');
      expect((await readRow(creator.id)).status).toBe('paid');
      expect((await readRow(platform?.id as string)).status).toBe('reversed');
      const floored = logged(
        obs.info,
        'Reversal amount floored to zero, platform absorbs'
      );
      expect(floored).toHaveLength(2);
      expect(floored).toEqual(
        expect.arrayContaining([
          {
            purchaseId: seeded.purchase.id,
            payoutId: org.id,
            rowAmountCents: 135,
            refundAmountCents: 1,
          },
          {
            purchaseId: seeded.purchase.id,
            payoutId: creator.id,
            rowAmountCents: 765,
            refundAmountCents: 1,
          },
        ])
      );
    });
  });

  // ── 8. idempotency key ────────────────────────────────────────────────

  describe('8 · the idempotency key passed to createReversal', () => {
    async function keyAndAmountFor(
      details: (
        tag: string
      ) => { stripeRefundId?: string; refundAmountCents?: number } | undefined
    ) {
      const seeded = await seedPurchase(1000);
      const { creator } = await seedPaidSplit(seeded, {
        org: 135,
        creator: 765,
      });
      const service = makeService();
      spyObs(service);
      await service.processRefund(seeded.paymentIntentId, details(seeded.tag));
      const call = reversalCalls().find(
        (c) => c.transferId === creator.stripeTransferId
      );
      return {
        transferId: creator.stripeTransferId as string,
        tag: seeded.tag,
        key: call?.options?.idempotencyKey,
        amount: call?.params?.amount,
      };
    }

    it('CHARACTERISATION: with a refund id the key is `<transferId>_reversal_<refundId>`', async () => {
      const r = await keyAndAmountFor((tag) => ({
        stripeRefundId: `re_key_${tag}`,
        refundAmountCents: 1000,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal_re_key_${r.tag}`);
      expect(r.amount).toBe(765);
    });

    it('CHARACTERISATION: a refund id with no amount is a full reversal keyed on the refund id', async () => {
      const r = await keyAndAmountFor((tag) => ({
        stripeRefundId: `re_noamt_${tag}`,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal_re_noamt_${r.tag}`);
      expect(r.amount).toBe(765);
    });

    // Spec (docs/payments/purchases.md#refunds): "**Reversals.** Each reversal
    // uses the key `${transferId}_reversal_${refundId}`, so the refund id and
    // reason are recorded on the purchase (`charge.refunds` must be expanded …)
    // — **gap**: `Codex-2hxff.8`." The fallbacks below exist because the refund
    // id can be missing today. Flipped by Codex-2hxff.8.
    it('CHARACTERISATION (defect): with no refund id but an amount the key falls back to `<transferId>_reversal_<cents>`', async () => {
      const r = await keyAndAmountFor(() => ({ refundAmountCents: 1000 }));
      expect(r.key).toBe(`${r.transferId}_reversal_1000`);
      expect(r.amount).toBe(765);
    });

    it('CHARACTERISATION (defect): a full refund with no refund id and no amount uses the bare key `<transferId>_reversal`', async () => {
      const r = await keyAndAmountFor(() => undefined);
      expect(r.key).toBe(`${r.transferId}_reversal`);
      expect(r.amount).toBe(765);
    });

    it('CHARACTERISATION (defect): refundAmountCents 0 is treated as a FULL reversal keyed `<transferId>_reversal_0`', async () => {
      const r = await keyAndAmountFor(() => ({ refundAmountCents: 0 }));
      expect(r.key).toBe(`${r.transferId}_reversal_0`);
      expect(r.amount).toBe(765);
    });
  });

  // ── 9. reversal metadata ──────────────────────────────────────────────

  describe('9 · the exact createReversal call', () => {
    it('CHARACTERISATION: (transferId, { amount, metadata: { purchase_id, payout_id, type, codex_env } }, { idempotencyKey })', async () => {
      const seeded = await seedPurchase(1000);
      const { creator } = await seedPaidSplit(seeded, {
        org: 135,
        creator: 765,
      });
      const re = `re_meta_${seeded.tag}`;
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: re,
        refundAmountCents: 1000,
      });

      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        creator.stripeTransferId,
        {
          amount: 765,
          metadata: {
            purchase_id: seeded.purchase.id,
            payout_id: creator.id,
            type: 'refund_reversal',
            codex_env: 'test',
          },
        },
        { idempotencyKey: `${creator.stripeTransferId}_reversal_${re}` }
      );
    });
  });

  // ── 10. errorId on the reversal-failure log ───────────────────────────

  describe('10 · the reversal-failure error log', () => {
    it('CHARACTERISATION: carries no errorId (the subscription copy adds one)', async () => {
      const seeded = await seedPurchase(1000);
      const { creator } = await seedPaidSplit(seeded, {
        org: 135,
        creator: 765,
      });
      rejectReversalFor(
        creator.stripeTransferId as string,
        new Error('Stripe down')
      );
      const service = makeService();
      const obs = spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_errid_${seeded.tag}`,
        refundAmountCents: 1000,
      });

      expect(
        logged(obs.error, 'Failed to reverse Stripe transfer for refund')
      ).toEqual([
        {
          purchaseId: seeded.purchase.id,
          payoutId: creator.id,
          stripeTransferId: creator.stripeTransferId,
          attemptedReversalCents: 765,
          code: null,
          error: 'Stripe down',
        },
      ]);
    });
  });

  // ── 11. row selection ─────────────────────────────────────────────────

  describe('11 · which rows are selected', () => {
    it('CHARACTERISATION: by purchaseId alone — a row with no charge id or with sourceType subscription is processed; another purchase on the same charge is not', async () => {
      const seeded = await seedPurchase(1000);
      const noCharge = await insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'paid',
        userId: creatorA,
        stripeChargeId: null,
        stripeTransferId: `tr_nocharge_${seeded.tag}`,
      });
      const subSourced = await insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'organization_fee',
        amountCents: 135,
        status: 'paid',
        userId: creatorA,
        stripeChargeId: seeded.chargeId,
        stripeTransferId: `tr_subsrc_${seeded.tag}`,
        sourceType: 'subscription',
      });
      const other = await seedPurchase(1000);
      const otherRow = await insertPayout({
        purchaseId: other.purchase.id,
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'paid',
        userId: creatorB,
        stripeChargeId: seeded.chargeId,
        stripeTransferId: `tr_other_${seeded.tag}`,
      });
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_select_${seeded.tag}`,
        refundAmountCents: 1000,
      });

      expect(
        reversalCalls()
          .map((c) => c.transferId)
          .sort()
      ).toEqual(
        [`tr_nocharge_${seeded.tag}`, `tr_subsrc_${seeded.tag}`].sort()
      );
      expect((await readRow(noCharge.id)).status).toBe('reversed');
      expect((await readRow(subSourced.id)).status).toBe('reversed');
      expect((await readRow(otherRow.id)).status).toBe('paid');
    });
  });

  // ── 12. a failed row ──────────────────────────────────────────────────

  describe('12 · a failed row', () => {
    it('CHARACTERISATION: is cancelled first like a pending one — cancelled_by_refund with no transfer in Stripe, reversed when one landed', async () => {
      const seeded = await seedPurchase(1000);
      const landedRow = await insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'failed',
        userId: creatorA,
        stripeChargeId: seeded.chargeId,
        reason: 'transfer_failed',
      });
      const neverSent = await insertPayout({
        purchaseId: seeded.purchase.id,
        payoutType: 'organization_fee',
        amountCents: 135,
        status: 'failed',
        userId: creatorB,
        stripeChargeId: seeded.chargeId,
        reason: 'transfer_failed',
      });
      const account = takeFirst(
        await db
          .insert(stripeConnectAccounts)
          .values(createTestConnectAccountInput(null, creatorA))
          .returning()
      );
      // The "failed" transfer went out after all.
      const landed = await stripe.transfers.create({
        amount: 765,
        currency: 'gbp',
        destination: account.stripeAccountId,
        metadata: { payout_id: landedRow.id },
      });
      const re = `re_failed_${seeded.tag}`;
      const service = makeService();
      spyObs(service);

      await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: re,
        refundAmountCents: 1000,
      });

      expect(reversalCalls()).toHaveLength(1);
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        landed.id,
        expect.objectContaining({ amount: 765 }),
        { idempotencyKey: `${landed.id}_reversal_${re}` }
      );
      expect(await readRow(landedRow.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: landed.id,
      });
      const cancelled = await readRow(neverSent.id);
      expect(cancelled.status).toBe('cancelled_by_refund');
      expect(cancelled.resolvedAt).not.toBeNull();
    });
  });

  // ── 13. the final status update fails ─────────────────────────────────

  describe('13 · the reversed-status write fails', () => {
    it('CHARACTERISATION: logged without an errorId and swallowed — the Stripe reversal stands, the row stays paid, the refund resolves', async () => {
      const seeded = await seedPurchase(1000);
      const { org, creator } = await seedPaidSplit(seeded, {
        org: 135,
        creator: 765,
      });
      // Rows are read in no fixed order: the FIRST reversed-write fails,
      // whichever row it belongs to; the other row's write succeeds.
      const service = makeService(failingPayoutUpdate('reversed', 1));
      const obs = spyObs(service);

      const result = await service.processRefund(seeded.paymentIntentId, {
        stripeRefundId: `re_update_${seeded.tag}`,
        refundAmountCents: 1000,
      });

      expect(result).toEqual({ userId: buyerId });
      expect(reversalCalls()).toHaveLength(2);
      const failures = logged(
        obs.error,
        'Failed to update payouts row after refund'
      );
      expect(failures).toHaveLength(1);
      const failedId = (failures[0] as { payoutId: string }).payoutId;
      expect(failures[0]).toEqual({
        purchaseId: seeded.purchase.id,
        payoutId: failedId,
        nextStatus: 'reversed',
        error: DB_DOWN,
      });
      expect((await readRow(failedId)).status).toBe('paid');
      const otherId = failedId === creator.id ? org.id : creator.id;
      expect((await readRow(otherId)).status).toBe('reversed');
    });
  });
});
