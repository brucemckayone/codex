/**
 * CHARACTERISATION — the subscription refund clawback as it behaves TODAY
 * (`SubscriptionService.reverseSubscriptionPayoutsForCharge`).
 *
 * WP3 of Codex-2hxff.56 extracts ONE clawback engine (`reverseCharge`, into a
 * new @codex/payments package) to replace this method and its divergent copy,
 * `PurchaseService.reversePayoutsForPurchase` (pinned in
 * packages/purchase/src/__tests__/refund-reversal.characterisation.test.ts).
 * These tests pin every observable behaviour of the subscription copy — the
 * Stripe calls (amount, metadata, idempotency key), the ledger rows it leaves,
 * what it writes (and does not write) to the database, and the logs it emits —
 * so the extraction can be proven to change NOTHING.
 *
 * They pin CURRENT behaviour, defects included. A test named
 * "CHARACTERISATION (defect)" asserts something the spec says is wrong; its
 * comment quotes the spec line and names the bead whose behaviour PR will flip
 * it. Do NOT "fix" one of these to match the spec, except in that behaviour PR,
 * deliberately and in the same change as the code. "CHARACTERISATION:" tests
 * pin behaviour that is correct (or a neutral divergence the engine must keep).
 *
 * Fixtures: real test DB (payouts rows inserted directly, so each row's
 * status, amount and transfer is exact) and the shared Stripe mock
 * (`createMockStripe`), with per-test overrides of `transfers.createReversal`.
 * Every Stripe id carries a run-unique tag. Payout rows feed global drains, so
 * every row this file creates is deleted in `afterAll`.
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  type Payout,
  payouts,
  refundReviews,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
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

describe('SubscriptionService refund clawback — characterisation (Codex-2hxff.56 WP3)', () => {
  let db: Database;
  let stripe: Stripe;
  let subscriberId: string;
  let creatorA: string;
  let creatorB: string;
  let orgId: string;
  let subscriptionId: string;
  let courseSubscriptionId: string;
  const createdPayoutIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [subscriberId, creatorA, creatorB] = await seedTestUsers(db, 3);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('sub-clawback'),
          })
        )
        .returning()
    ).id;
    const tier = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning()
    );
    subscriptionId = takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(subscriberId, orgId, tier.id))
        .returning()
    ).id;
    const course = takeFirst(
      await db
        .insert(courses)
        .values({
          organizationId: orgId,
          creatorId: creatorA,
          slug: createUniqueSlug('sub-clawback-course'),
          title: 'Clawback Characterisation Course',
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
          priceMonthly: 5000,
          priceAnnual: 50000,
          stripeProductId: `prod_${uid()}`,
          stripePriceMonthlyId: `price_m_${uid()}`,
          stripePriceAnnualId: `price_a_${uid()}`,
        })
        .returning()
    );
    const now = new Date();
    courseSubscriptionId = takeFirst(
      await db
        .insert(courseSubscriptions)
        .values({
          userId: subscriberId,
          courseId: course.id,
          planId: plan.id,
          organizationId: orgId,
          stripeSubscriptionId: `sub_course_${uid()}`,
          stripeCustomerId: `cus_course_${uid()}`,
          status: 'active',
          billingInterval: 'month',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
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

  function makeService(database: Database = db): SubscriptionService {
    return new SubscriptionService(
      { db: database, environment: 'test' },
      stripe
    );
  }

  function spyObs(service: SubscriptionService) {
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

  function newCharge() {
    const tag = uid();
    return { tag, chargeId: `ch_subchar_${tag}` };
  }

  async function insertPayout(spec: {
    payoutType: PayoutType;
    amountCents: number;
    status: PayoutStatus;
    userId: string | null;
    stripeChargeId: string | null;
    stripeTransferId?: string | null;
    source?: 'subscription' | 'course' | 'purchase';
    reason?: 'connect_not_ready' | 'transfer_failed' | null;
  }): Promise<Payout> {
    const settled = spec.status === 'paid' || spec.status === 'reversed';
    const source = spec.source ?? 'subscription';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: spec.userId,
          subscriptionId: source === 'subscription' ? subscriptionId : null,
          courseSubscriptionId:
            source === 'course' ? courseSubscriptionId : null,
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status: spec.status,
          sourceType: source === 'purchase' ? 'purchase' : 'subscription',
          stripeChargeId: spec.stripeChargeId,
          stripeTransferId: spec.stripeTransferId ?? null,
          transferGroup: `sub_${subscriptionId}`,
          reason: spec.reason ?? null,
          resolvedAt: settled ? new Date() : null,
          lastRetryAt: spec.status === 'failed' ? new Date() : null,
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /**
   * platform_fee (no transfer) + organization_fee + creator_payout_to_owner,
   * all paid — the shape executeTransfers writes. Omit `platform` for none.
   */
  async function seedPaidSplit(
    charge: { tag: string; chargeId: string },
    amounts: {
      platform?: number;
      platformStatus?: PayoutStatus;
      org: number;
      creator: number;
    }
  ) {
    const platform =
      amounts.platform === undefined
        ? undefined
        : await insertPayout({
            payoutType: 'platform_fee',
            amountCents: amounts.platform,
            status: amounts.platformStatus ?? 'paid',
            userId: null,
            stripeChargeId: charge.chargeId,
          });
    const org = await insertPayout({
      payoutType: 'organization_fee',
      amountCents: amounts.org,
      status: 'paid',
      userId: creatorA,
      stripeChargeId: charge.chargeId,
      stripeTransferId: `tr_org_${charge.tag}`,
    });
    const creator = await insertPayout({
      payoutType: 'creator_payout_to_owner',
      amountCents: amounts.creator,
      status: 'paid',
      userId: creatorA,
      stripeChargeId: charge.chargeId,
      stripeTransferId: `tr_creator_${charge.tag}`,
    });
    return { platform, org, creator };
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
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

  async function threePendingRows(chargeId: string) {
    // Payees have no Connect account, so the post-cancel Stripe lookup is
    // skipped and a successful cancel ends at cancelled_by_refund.
    return Promise.all([
      insertPayout({
        payoutType: 'creator_payout',
        amountCents: 300,
        status: 'pending',
        userId: creatorA,
        stripeChargeId: chargeId,
        reason: 'connect_not_ready',
      }),
      insertPayout({
        payoutType: 'creator_payout',
        amountCents: 300,
        status: 'pending',
        userId: creatorB,
        stripeChargeId: chargeId,
        reason: 'connect_not_ready',
      }),
      insertPayout({
        payoutType: 'organization_fee',
        amountCents: 100,
        status: 'pending',
        userId: creatorA,
        stripeChargeId: chargeId,
        reason: 'connect_not_ready',
      }),
    ]);
  }

  // ── 1. a cancel that throws ───────────────────────────────────────────

  describe('1 · cancelUnpaidPayoutForRefund throws for one row', () => {
    // Spec (docs/payments/subscriptions.md#refunds): "Either way, the creator
    // and organisation slices are reversed in proportion, exactly as for
    // one-off purchases" — and for those (docs/payments/purchases.md#refunds):
    // "every pending or failed slice becomes `cancelled_by_refund`". One row's
    // failure aborts the loop here (the purchase copy isolates it). Flipped by
    // Codex-2hxff.51.
    it('CHARACTERISATION (defect): the error is not caught — the call rejects, rows after the failing one are never reached, nothing is logged', async () => {
      const { tag, chargeId } = newCharge();
      const rows = await threePendingRows(chargeId);
      const service = makeService(
        failingPayoutUpdate('cancelled_by_refund', 2)
      );
      const obs = spyObs(service);

      await expect(
        service.reverseSubscriptionPayoutsForCharge(chargeId, {
          refundAmountCents: 700,
          stripeRefundId: `re_cancel_${tag}`,
        })
      ).rejects.toThrow(DB_DOWN);

      // The first row was cancelled, the second's cancel threw, the third
      // was never reached.
      const statuses = (await Promise.all(rows.map((r) => readRow(r.id))))
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual(['cancelled_by_refund', 'pending', 'pending']);
      expect(obs.error).not.toHaveBeenCalled();
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    });
  });

  // ── 2. redelivery after a failure ─────────────────────────────────────

  describe('2 · the same refund delivered again after a failure', () => {
    it('CHARACTERISATION: a redelivery after a cancel failure cancels the rows left pending and skips the row already cancelled', async () => {
      const { tag, chargeId } = newCharge();
      const rows = await threePendingRows(chargeId);
      const refund = {
        refundAmountCents: 700,
        stripeRefundId: `re_redeliver_${tag}`,
      };
      const first = makeService(failingPayoutUpdate('cancelled_by_refund', 2));
      spyObs(first);
      await expect(
        first.reverseSubscriptionPayoutsForCharge(chargeId, refund)
      ).rejects.toThrow(DB_DOWN);
      const afterFirst = await Promise.all(rows.map((r) => readRow(r.id)));
      const alreadyCancelled = afterFirst.find(
        (r) => r.status === 'cancelled_by_refund'
      );
      expect(alreadyCancelled).toBeDefined();

      const second = makeService();
      spyObs(second);
      await second.reverseSubscriptionPayoutsForCharge(chargeId, refund);

      const afterSecond = await Promise.all(rows.map((r) => readRow(r.id)));
      expect(afterSecond.every((r) => r.status === 'cancelled_by_refund')).toBe(
        true
      );
      // Skipped, not re-written.
      const again = afterSecond.find((r) => r.id === alreadyCancelled?.id);
      expect(again?.updatedAt.getTime()).toBe(
        alreadyCancelled?.updatedAt.getTime()
      );
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    });

    it('CHARACTERISATION: a redelivery retries an insufficient_funds row with the same key and amount; rows already reversed are skipped', async () => {
      const charge = newCharge();
      const { platform, org, creator } = await seedPaidSplit(charge, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      rejectReversalFor(
        `tr_creator_${charge.tag}`,
        Object.assign(new Error('Insufficient funds'), {
          code: 'insufficient_funds',
        }),
        1
      );
      const re = `re_retry_${charge.tag}`;
      const refund = { refundAmountCents: 1000, stripeRefundId: re };
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(
        charge.chargeId,
        refund
      );
      expect((await readRow(creator.id)).status).toBe('paid');
      expect((await readRow(org.id)).status).toBe('reversed');
      expect(reversalCalls()).toHaveLength(2);

      await service.reverseSubscriptionPayoutsForCharge(
        charge.chargeId,
        refund
      );

      expect(reversalCalls()).toHaveLength(3);
      expect(reversalCalls()[2]).toEqual({
        transferId: `tr_creator_${charge.tag}`,
        params: expect.objectContaining({ amount: 765 }),
        options: { idempotencyKey: `tr_creator_${charge.tag}_reversal_${re}` },
      });
      expect((await readRow(creator.id)).status).toBe('reversed');
      expect((await readRow(platform?.id as string)).status).toBe('reversed');
    });
  });

  // ── 3. two partial refunds on one charge ──────────────────────────────

  describe('3 · two partial refunds on one charge (cumulative amount_refunded)', () => {
    // Spec (docs/payments/purchases.md#refunds, which subscriptions.md#refunds
    // applies "exactly as for one-off purchases"): "Each event is handled for
    // the amount **newly** refunded — the charge's cumulative `amount_refunded`
    // minus what has already been processed — so a second partial refund
    // claws back its own increment — **gap**: `Codex-2hxff.8` (partial
    // refunds)." Flipped by Codex-2hxff.8.
    it('CHARACTERISATION (defect): the first partial flips every row to reversed; the second partial reverses nothing', async () => {
      const charge = newCharge();
      const rows = await seedPaidSplit(charge, {
        platform: 200,
        org: 270,
        creator: 1530,
      });
      const service = makeService();
      spyObs(service);
      const re1 = `re_part1_${charge.tag}`;

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 500,
        stripeRefundId: re1,
      });

      // floor(1530 × 500 / 2000) = 382; floor(270 × 500 / 2000) = 67.
      expect(
        reversalCalls().map((c) => [c.transferId, c.params?.amount, c.options])
      ).toEqual(
        expect.arrayContaining([
          [
            `tr_creator_${charge.tag}`,
            382,
            { idempotencyKey: `tr_creator_${charge.tag}_reversal_${re1}` },
          ],
          [
            `tr_org_${charge.tag}`,
            67,
            { idempotencyKey: `tr_org_${charge.tag}_reversal_${re1}` },
          ],
        ])
      );
      expect(reversalCalls()).toHaveLength(2);
      for (const row of [rows.platform, rows.org, rows.creator]) {
        expect((await readRow(row?.id as string)).status).toBe('reversed');
      }

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 1000,
        stripeRefundId: `re_part2_${charge.tag}`,
      });

      expect(reversalCalls()).toHaveLength(2);
    });
  });

  // ── 4. the denominator ────────────────────────────────────────────────

  describe('4 · the partial-refund denominator', () => {
    it('CHARACTERISATION: the fraction is refund / SUM(selected rows) — the platform_fee row is included', async () => {
      const charge = newCharge();
      await seedPaidSplit(charge, { platform: 200, org: 270, creator: 1530 });
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 500,
        stripeRefundId: `re_denom_${charge.tag}`,
      });

      // ÷2000: 382 / 67. (Without the platform row, ÷1800: 425 / 75.)
      expect(amountFor(`tr_creator_${charge.tag}`)).toBe(382);
      expect(amountFor(`tr_org_${charge.tag}`)).toBe(67);
    });

    it('CHARACTERISATION: a row in any status counts — an already-reversed platform_fee row stays in the denominator', async () => {
      const charge = newCharge();
      await seedPaidSplit(charge, {
        platform: 200,
        platformStatus: 'reversed',
        org: 270,
        creator: 1530,
      });
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 500,
        stripeRefundId: `re_denom_rev_${charge.tag}`,
      });

      expect(amountFor(`tr_creator_${charge.tag}`)).toBe(382);
      expect(amountFor(`tr_org_${charge.tag}`)).toBe(67);
    });

    // Spec (docs/payments/purchases.md#refunds, applied to subscriptions by
    // subscriptions.md#refunds): "each paid creator and organisation slice is
    // reversed by the same fraction as the refund (rounded down)" — the
    // fraction of the CHARGE. This copy reconstructs the charge from the
    // ledger rows, so when the rows do not sum to the charge (here: no
    // platform_fee row on a 2000 charge) the same refund reverses more, and a
    // refund of 1800 of 2000 is treated as FULL. The purchase copy divides by
    // the purchase's amountPaidCents. The WP3 engine must pick one; flipped
    // (if at all) by Codex-2hxff.8.
    it('CHARACTERISATION (defect): with no platform_fee row the denominator is only the transfer rows — 500 reverses 425/75, 1800 is a full reversal', async () => {
      const a = newCharge();
      await seedPaidSplit(a, { org: 270, creator: 1530 });
      const b = newCharge();
      await seedPaidSplit(b, { org: 270, creator: 1530 });
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(a.chargeId, {
        refundAmountCents: 500,
        stripeRefundId: `re_denom_a_${a.tag}`,
      });
      await service.reverseSubscriptionPayoutsForCharge(b.chargeId, {
        refundAmountCents: 1800,
        stripeRefundId: `re_denom_b_${b.tag}`,
      });

      // ÷1800: floor(1530 × 500 / 1800) = 425; floor(270 × 500 / 1800) = 75.
      expect(amountFor(`tr_creator_${a.tag}`)).toBe(425);
      expect(amountFor(`tr_org_${a.tag}`)).toBe(75);
      // 1800 is not < 1800 → full slices.
      expect(amountFor(`tr_creator_${b.tag}`)).toBe(1530);
      expect(amountFor(`tr_org_${b.tag}`)).toBe(270);
    });
  });

  // ── 5. a non-insufficient_funds reversal failure ──────────────────────

  describe('5 · a reversal rejected for a reason other than insufficient_funds', () => {
    // Spec (docs/payments/purchases.md#refunds, Reversals — applied to
    // subscriptions "exactly as for one-off purchases"): "Any other reversal
    // failure is retried. A row is marked `reversed` only once the reversal
    // succeeds — **gap**: `Codex-2hxff.8`." Flipped by Codex-2hxff.8 (SUB-08).
    it('CHARACTERISATION (defect): the row is still marked reversed, so a redelivery never retries it', async () => {
      const charge = newCharge();
      const { org, creator } = await seedPaidSplit(charge, {
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
      const refund = {
        refundAmountCents: 1000,
        stripeRefundId: `re_generic_${charge.tag}`,
      };
      const service = makeService();
      const obs = spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(
        charge.chargeId,
        refund
      );

      expect(await readRow(creator.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: creator.stripeTransferId,
      });
      expect(await readRow(org.id)).toMatchObject({
        status: 'reversed',
        stripeTransferId: org.stripeTransferId,
      });
      const failures = logged(
        obs.error,
        'Failed to reverse subscription transfer for refund'
      );
      expect(failures.map((m) => (m as { code: unknown }).code).sort()).toEqual(
        ['balance_insufficient', null]
      );
      // Only the reversal-failure log — not the insufficient_funds one.
      expect(obs.error).toHaveBeenCalledTimes(2);

      await service.reverseSubscriptionPayoutsForCharge(
        charge.chargeId,
        refund
      );
      expect(reversalCalls()).toHaveLength(2);
    });
  });

  // ── 6. insufficient_funds ─────────────────────────────────────────────

  describe('6 · insufficient_funds', () => {
    // Spec (docs/payments/subscriptions.md#refunds): "A shortfall on the
    // payee's balance goes to `refund_reviews`, which must be able to hold
    // subscription rows (`Codex-in0g4`)." Flipped by Codex-in0g4.
    it('CHARACTERISATION (defect): writes nothing — no refund_reviews row, the payouts row untouched and paid — and logs two errors sharing one errorId', async () => {
      const charge = newCharge();
      const { platform, org, creator } = await seedPaidSplit(charge, {
        platform: 100,
        org: 135,
        creator: 765,
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

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 1000,
        stripeRefundId: `re_if_${charge.tag}`,
      });

      const creatorAfter = await readRow(creator.id);
      expect(creatorAfter).toMatchObject({
        status: 'paid',
        stripeTransferId: creator.stripeTransferId,
      });
      expect(creatorAfter.updatedAt.getTime()).toBe(
        creator.updatedAt.getTime()
      );
      expect(
        await db
          .select()
          .from(refundReviews)
          .where(eq(refundReviews.payoutId, creator.id))
      ).toHaveLength(0);
      expect((await readRow(org.id)).status).toBe('reversed');
      expect((await readRow(platform?.id as string)).status).toBe('reversed');

      const [failure] = logged(
        obs.error,
        'Failed to reverse subscription transfer for refund'
      ) as Array<{ errorId: string }>;
      expect(failure).toEqual({
        errorId: expect.stringMatching(UUID),
        chargeId: charge.chargeId,
        payoutId: creator.id,
        stripeTransferId: creator.stripeTransferId,
        attemptedReversalCents: 765,
        code: 'insufficient_funds',
        error: 'Insufficient funds in the connected account',
      });
      expect(
        logged(
          obs.error,
          'Subscription clawback obligation unresolved (insufficient_funds) — NOT yet queued in refund_reviews'
        )
      ).toEqual([
        {
          errorId: failure?.errorId,
          chargeId: charge.chargeId,
          payoutId: creator.id,
          creatorUserId: creatorA,
          attemptedReversalCents: 765,
        },
      ]);
      expect(obs.error).toHaveBeenCalledTimes(2);
      expect(obs.warn).not.toHaveBeenCalled();
    });

    it('CHARACTERISATION: the row stays paid even with no payee — no userId gate, unlike the purchase copy', async () => {
      const charge = newCharge();
      const feeWithTransfer = await insertPayout({
        payoutType: 'platform_fee',
        amountCents: 100,
        status: 'paid',
        userId: null,
        stripeChargeId: charge.chargeId,
        stripeTransferId: `tr_fee_${charge.tag}`,
      });
      rejectReversalFor(
        `tr_fee_${charge.tag}`,
        Object.assign(new Error('Insufficient funds'), {
          code: 'insufficient_funds',
        })
      );
      const service = makeService();
      const obs = spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 100,
        stripeRefundId: `re_if_nopayee_${charge.tag}`,
      });

      expect((await readRow(feeWithTransfer.id)).status).toBe('paid');
      expect(
        logged(
          obs.error,
          'Subscription clawback obligation unresolved (insufficient_funds) — NOT yet queued in refund_reviews'
        )
      ).toEqual([
        expect.objectContaining({
          payoutId: feeWithTransfer.id,
          creatorUserId: null,
        }),
      ]);
    });
  });

  // ── 7. zero floor ─────────────────────────────────────────────────────

  describe('7 · a proportional share that floors to zero', () => {
    it('CHARACTERISATION: no Stripe call, the transfer rows stay paid, an info log per row — and the platform_fee row is still marked reversed', async () => {
      const charge = newCharge();
      const { platform, org, creator } = await seedPaidSplit(charge, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      const service = makeService();
      const obs = spyObs(service);

      // floor(135 × 1 / 1000) = 0; floor(765 × 1 / 1000) = 0.
      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 1,
        stripeRefundId: `re_floor_${charge.tag}`,
      });

      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect((await readRow(org.id)).status).toBe('paid');
      expect((await readRow(creator.id)).status).toBe('paid');
      expect((await readRow(platform?.id as string)).status).toBe('reversed');
      const floored = logged(
        obs.info,
        'Subscription reversal amount floored to zero, platform absorbs'
      );
      expect(floored).toHaveLength(2);
      expect(floored).toEqual(
        expect.arrayContaining([
          {
            chargeId: charge.chargeId,
            payoutId: org.id,
            rowAmountCents: 135,
            refundAmountCents: 1,
          },
          {
            chargeId: charge.chargeId,
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
      refund: (tag: string) => {
        refundAmountCents: number | null;
        stripeRefundId: string | null;
      }
    ) {
      const charge = newCharge();
      const { creator } = await seedPaidSplit(charge, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      const service = makeService();
      spyObs(service);
      await service.reverseSubscriptionPayoutsForCharge(
        charge.chargeId,
        refund(charge.tag)
      );
      const call = reversalCalls().find(
        (c) => c.transferId === creator.stripeTransferId
      );
      return {
        transferId: creator.stripeTransferId as string,
        tag: charge.tag,
        key: call?.options?.idempotencyKey,
        amount: call?.params?.amount,
      };
    }

    it('CHARACTERISATION: with a refund id the key is `<transferId>_reversal_<refundId>`', async () => {
      const r = await keyAndAmountFor((tag) => ({
        refundAmountCents: 1000,
        stripeRefundId: `re_key_${tag}`,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal_re_key_${r.tag}`);
      expect(r.amount).toBe(765);
    });

    it('CHARACTERISATION: a refund id with no amount is a full reversal keyed on the refund id', async () => {
      const r = await keyAndAmountFor((tag) => ({
        refundAmountCents: null,
        stripeRefundId: `re_noamt_${tag}`,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal_re_noamt_${r.tag}`);
      expect(r.amount).toBe(765);
    });

    // Spec (docs/payments/purchases.md#refunds, applied to subscriptions by
    // subscriptions.md#refunds): "**Reversals.** Each reversal uses the key
    // `${transferId}_reversal_${refundId}`, so the refund id and reason are
    // recorded on the purchase (`charge.refunds` must be expanded …) —
    // **gap**: `Codex-2hxff.8`." The fallbacks below exist because the refund
    // id can be missing today. Flipped by Codex-2hxff.8.
    it('CHARACTERISATION (defect): with no refund id but an amount the key falls back to `<transferId>_reversal_<cents>`', async () => {
      const r = await keyAndAmountFor(() => ({
        refundAmountCents: 1000,
        stripeRefundId: null,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal_1000`);
      expect(r.amount).toBe(765);
    });

    it('CHARACTERISATION (defect): a full refund with no refund id and no amount uses the bare key `<transferId>_reversal`', async () => {
      const r = await keyAndAmountFor(() => ({
        refundAmountCents: null,
        stripeRefundId: null,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal`);
      expect(r.amount).toBe(765);
    });

    it('CHARACTERISATION (defect): refundAmountCents 0 is treated as a FULL reversal keyed `<transferId>_reversal_0`', async () => {
      const r = await keyAndAmountFor(() => ({
        refundAmountCents: 0,
        stripeRefundId: null,
      }));
      expect(r.key).toBe(`${r.transferId}_reversal_0`);
      expect(r.amount).toBe(765);
    });
  });

  // ── 9. reversal metadata ──────────────────────────────────────────────

  describe('9 · the exact createReversal call', () => {
    it('CHARACTERISATION: (transferId, { amount, metadata: { subscription_id, charge_id, payout_id, type, codex_env } }, { idempotencyKey }) — a course-subscription row sends subscription_id ""', async () => {
      const { tag, chargeId } = newCharge();
      const subRow = await insertPayout({
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'paid',
        userId: creatorA,
        stripeChargeId: chargeId,
        stripeTransferId: `tr_sub_${tag}`,
      });
      const courseRow = await insertPayout({
        payoutType: 'organization_fee',
        amountCents: 135,
        status: 'paid',
        userId: creatorB,
        stripeChargeId: chargeId,
        stripeTransferId: `tr_course_${tag}`,
        source: 'course',
      });
      const re = `re_meta_${tag}`;
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(chargeId, {
        refundAmountCents: 900,
        stripeRefundId: re,
      });

      expect(reversalCalls()).toHaveLength(2);
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        `tr_sub_${tag}`,
        {
          amount: 765,
          metadata: {
            subscription_id: subscriptionId,
            charge_id: chargeId,
            payout_id: subRow.id,
            type: 'refund_reversal',
            codex_env: 'test',
          },
        },
        { idempotencyKey: `tr_sub_${tag}_reversal_${re}` }
      );
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        `tr_course_${tag}`,
        {
          amount: 135,
          metadata: {
            subscription_id: '',
            charge_id: chargeId,
            payout_id: courseRow.id,
            type: 'refund_reversal',
            codex_env: 'test',
          },
        },
        { idempotencyKey: `tr_course_${tag}_reversal_${re}` }
      );
    });
  });

  // ── 10. errorId on the reversal-failure log ───────────────────────────

  describe('10 · the reversal-failure error log', () => {
    it('CHARACTERISATION: carries an errorId (the purchase copy has none)', async () => {
      const charge = newCharge();
      const { creator } = await seedPaidSplit(charge, {
        platform: 100,
        org: 135,
        creator: 765,
      });
      rejectReversalFor(
        creator.stripeTransferId as string,
        new Error('Stripe down')
      );
      const service = makeService();
      const obs = spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
        refundAmountCents: 1000,
        stripeRefundId: `re_errid_${charge.tag}`,
      });

      expect(
        logged(obs.error, 'Failed to reverse subscription transfer for refund')
      ).toEqual([
        {
          errorId: expect.stringMatching(UUID),
          chargeId: charge.chargeId,
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
    it('CHARACTERISATION: by stripeChargeId + sourceType subscription — a course-subscription row on the charge is processed; a row with no charge id, or a purchase-sourced row on the charge, is not', async () => {
      const { tag, chargeId } = newCharge();
      const subRow = await insertPayout({
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'paid',
        userId: creatorA,
        stripeChargeId: chargeId,
        stripeTransferId: `tr_sub_${tag}`,
      });
      const courseRow = await insertPayout({
        payoutType: 'organization_fee',
        amountCents: 135,
        status: 'paid',
        userId: creatorB,
        stripeChargeId: chargeId,
        stripeTransferId: `tr_course_${tag}`,
        source: 'course',
      });
      const noCharge = await insertPayout({
        payoutType: 'creator_payout',
        amountCents: 500,
        status: 'paid',
        userId: creatorB,
        stripeChargeId: null,
        stripeTransferId: `tr_nocharge_${tag}`,
      });
      const purchaseSourced = await insertPayout({
        payoutType: 'creator_payout_to_owner',
        amountCents: 400,
        status: 'paid',
        userId: creatorA,
        stripeChargeId: chargeId,
        stripeTransferId: `tr_purchase_${tag}`,
        source: 'purchase',
      });
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(chargeId, {
        refundAmountCents: 900,
        stripeRefundId: `re_select_${tag}`,
      });

      expect(
        reversalCalls()
          .map((c) => c.transferId)
          .sort()
      ).toEqual([`tr_course_${tag}`, `tr_sub_${tag}`].sort());
      expect((await readRow(subRow.id)).status).toBe('reversed');
      expect((await readRow(courseRow.id)).status).toBe('reversed');
      expect((await readRow(noCharge.id)).status).toBe('paid');
      expect((await readRow(purchaseSourced.id)).status).toBe('paid');
    });
  });

  // ── 12. a failed row ──────────────────────────────────────────────────

  describe('12 · a failed row', () => {
    it('CHARACTERISATION: is cancelled first like a pending one — cancelled_by_refund with no transfer in Stripe, reversed when one landed', async () => {
      const { tag, chargeId } = newCharge();
      const landedRow = await insertPayout({
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'failed',
        userId: creatorA,
        stripeChargeId: chargeId,
        reason: 'transfer_failed',
      });
      const neverSent = await insertPayout({
        payoutType: 'organization_fee',
        amountCents: 135,
        status: 'failed',
        userId: creatorB,
        stripeChargeId: chargeId,
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
      const re = `re_failed_${tag}`;
      const service = makeService();
      spyObs(service);

      await service.reverseSubscriptionPayoutsForCharge(chargeId, {
        refundAmountCents: null,
        stripeRefundId: re,
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
    it('CHARACTERISATION: logged without an errorId and swallowed — the Stripe reversal stands, the row stays paid, the call resolves', async () => {
      const charge = newCharge();
      const { org, creator } = await seedPaidSplit(charge, {
        org: 135,
        creator: 765,
      });
      // Rows are read in no fixed order: the FIRST reversed-write fails,
      // whichever row it belongs to; the other row's write succeeds.
      const service = makeService(failingPayoutUpdate('reversed', 1));
      const obs = spyObs(service);

      await expect(
        service.reverseSubscriptionPayoutsForCharge(charge.chargeId, {
          refundAmountCents: 900,
          stripeRefundId: `re_update_${charge.tag}`,
        })
      ).resolves.toBeUndefined();

      expect(reversalCalls()).toHaveLength(2);
      const failures = logged(
        obs.error,
        'Failed to update subscription payouts row after refund'
      );
      expect(failures).toHaveLength(1);
      const failedId = (failures[0] as { payoutId: string }).payoutId;
      expect(failures[0]).toEqual({
        chargeId: charge.chargeId,
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
