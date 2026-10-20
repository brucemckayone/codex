/**
 * The subscription refund clawback, as
 * `SubscriptionService.reverseSubscriptionPayoutsForCharge` wires it to the
 * @codex/payments engine (Codex-2hxff.8; design in
 * docs/payments/refund-reversal-record.md).
 *
 * The engine's behaviour (shares, records, keys, retries, debts, leases) is
 * specified in packages/payments/src/__tests__/clawback.integration.test.ts.
 * This file covers what the subscription source adds: which rows are a
 * subscription charge's, the subscription and course-subscription metadata, a
 * debt for a subscription (refund_reviews can hold one now, D5), that the
 * charge amount is the denominator, and that a cancel failure still rejects
 * after every other row (Codex-2hxff.51).
 *
 * It replaces subscription-refund-reversal.characterisation.test.ts, which
 * pinned the old copy, defects included, for the extraction (WP3b-2).
 */

import { randomUUID } from 'node:crypto';
import {
  courseSubscriptionPlans,
  courseSubscriptions,
  courses,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  refundReviews,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
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
const DB_DOWN = 'Connection terminated unexpectedly';

describe('SubscriptionService refund clawback (Codex-2hxff.8)', () => {
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
          createTestOrganizationInput({ slug: createUniqueSlug('sub-claw') })
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
          slug: createUniqueSlug('sub-claw-course'),
          title: 'Subscription Clawback Course',
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

  beforeEach(() => {
    stripe = createMockStripe();
  });

  // Payout rows feed global drains/sweeps: never leave them behind.
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
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function makeService(database: Database = db): SubscriptionService {
    return new SubscriptionService(
      { db: database, environment: 'test' },
      stripe
    );
  }

  function newCharge(amountCents: number) {
    return { id: `ch_sclaw_${uid()}`, amountCents };
  }

  async function insertPayout(spec: {
    chargeId: string | null;
    payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
    amountCents: number;
    status?: 'paid' | 'pending';
    userId?: string;
    sourceType?: 'purchase' | 'subscription';
    ref?: 'subscription' | 'course' | 'none';
  }): Promise<Payout> {
    const status = spec.status ?? 'paid';
    const isFee = spec.payoutType === 'platform_fee';
    const ref = spec.ref ?? 'subscription';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: isFee ? null : (spec.userId ?? creatorA),
          subscriptionId: ref === 'subscription' ? subscriptionId : null,
          courseSubscriptionId: ref === 'course' ? courseSubscriptionId : null,
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status,
          sourceType: spec.sourceType ?? 'subscription',
          stripeChargeId: spec.chargeId,
          stripeTransferId:
            status === 'paid' && !isFee ? `tr_sclaw_${uid()}` : null,
          reason: status === 'paid' ? null : 'connect_not_ready',
          resolvedAt: status === 'paid' ? new Date() : null,
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  function stripeRefunds(refunds: Array<{ id: string; amount: number }>) {
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

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
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

  /** A db whose N-th status update of payouts to `status` throws. */
  function failingPayoutUpdate(
    status: string,
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

  // ── tests ─────────────────────────────────────────────────────────────

  it("a subscription charge's rows are its subscription-sourced rows on that charge, tier or course; a purchase-sourced row on it is not", async () => {
    const charge = newCharge(1000);
    const tierRow = await insertPayout({
      chargeId: charge.id,
      payoutType: 'creator_payout',
      amountCents: 400,
    });
    const courseRow = await insertPayout({
      chargeId: charge.id,
      payoutType: 'creator_payout',
      amountCents: 300,
      userId: creatorB,
      ref: 'course',
    });
    const purchaseRow = await insertPayout({
      chargeId: charge.id,
      payoutType: 'organization_fee',
      amountCents: 135,
      sourceType: 'purchase',
      ref: 'none',
    });
    const otherCharge = await insertPayout({
      chargeId: null,
      payoutType: 'creator_payout',
      amountCents: 100,
    });
    stripeRefunds([{ id: `re_scope_${uid()}`, amount: 1000 }]);

    await makeService().reverseSubscriptionPayoutsForCharge(charge);

    expect(reversedAmount(tierRow.stripeTransferId)).toBe(400);
    expect(reversedAmount(courseRow.stripeTransferId)).toBe(300);
    expect(reversedAmount(purchaseRow.stripeTransferId)).toBe(0);
    expect(reversedAmount(otherCharge.stripeTransferId)).toBe(0);
    expect((await readRow(purchaseRow.id)).status).toBe('paid');
  });

  it('the reversal names the tier subscription, or the course subscription, in its Stripe metadata', async () => {
    const charge = newCharge(1000);
    const tierRow = await insertPayout({
      chargeId: charge.id,
      payoutType: 'creator_payout',
      amountCents: 400,
    });
    const courseRow = await insertPayout({
      chargeId: charge.id,
      payoutType: 'creator_payout',
      amountCents: 300,
      userId: creatorB,
      ref: 'course',
    });
    stripeRefunds([{ id: `re_meta_${uid()}`, amount: 1000 }]);

    await makeService().reverseSubscriptionPayoutsForCharge(charge);

    const metadataFor = (transferId: string | null) =>
      (
        vi
          .mocked(stripe.transfers.createReversal)
          .mock.calls.find(([id]) => id === transferId)?.[1] as {
          metadata?: Record<string, string>;
        }
      )?.metadata;
    expect(metadataFor(tierRow.stripeTransferId)).toEqual(
      expect.objectContaining({
        source_type: 'subscription',
        subscription_id: subscriptionId,
      })
    );
    expect(metadataFor(courseRow.stripeTransferId)).toEqual(
      expect.objectContaining({
        source_type: 'subscription',
        course_subscription_id: courseSubscriptionId,
      })
    );
    expect(metadataFor(courseRow.stripeTransferId)).not.toHaveProperty(
      'subscription_id'
    );
  });

  it('the denominator is the charge amount, not the sum of the recorded slices (D1)', async () => {
    // Rows sum to 900; the invoice charged 1000.
    const charge = newCharge(1000);
    const org = await insertPayout({
      chargeId: charge.id,
      payoutType: 'organization_fee',
      amountCents: 135,
    });
    const creator = await insertPayout({
      chargeId: charge.id,
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    stripeRefunds([{ id: `re_denom_${uid()}`, amount: 500 }]);

    await makeService().reverseSubscriptionPayoutsForCharge(charge);

    expect(reversedAmount(org.stripeTransferId)).toBe(67);
    expect(reversedAmount(creator.stripeTransferId)).toBe(382);
  });

  it('a subscription debt is a refund_reviews row now (D5): no purchase id, the reversal it is for', async () => {
    const charge = newCharge(1000);
    const creator = await insertPayout({
      chargeId: charge.id,
      payoutType: 'creator_payout',
      amountCents: 765,
    });
    stripeRefunds([{ id: `re_debt_${uid()}`, amount: 1000 }]);
    vi.mocked(stripe.transfers.createReversal).mockRejectedValue(
      Object.assign(new Error('balance too low'), {
        code: 'insufficient_funds',
        statusCode: 400,
      })
    );

    await makeService().reverseSubscriptionPayoutsForCharge(charge);

    const [record] = await db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, creator.id));
    const reviews = await db
      .select()
      .from(refundReviews)
      .where(eq(refundReviews.payoutId, creator.id));
    expect(record?.status).toBe('debt');
    expect(reviews).toEqual([
      expect.objectContaining({
        purchaseId: null,
        payoutReversalId: record?.id,
        creatorUserId: creatorA,
        attemptedReversalCents: 765,
      }),
    ]);
    expect((await readRow(creator.id)).status).toBe('paid');
  });

  it('a cancel that throws: every other row is still cancelled, then the call rejects with the failure as its cause (Codex-2hxff.51)', async () => {
    const charge = newCharge(1000);
    const rows = [
      await insertPayout({
        chargeId: charge.id,
        payoutType: 'creator_payout',
        amountCents: 300,
        status: 'pending',
      }),
      await insertPayout({
        chargeId: charge.id,
        payoutType: 'creator_payout',
        amountCents: 300,
        status: 'pending',
        userId: creatorB,
      }),
      await insertPayout({
        chargeId: charge.id,
        payoutType: 'organization_fee',
        amountCents: 100,
        status: 'pending',
      }),
    ];
    const re = `re_cancel_${uid()}`;
    stripeRefunds([{ id: re, amount: 1000 }]);

    const failure = await makeService(
      failingPayoutUpdate('cancelled_by_refund', 2)
    )
      .reverseSubscriptionPayoutsForCharge(charge)
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(failure).toBeInstanceOf(InternalServiceError);
    expect((failure as Error).cause).toEqual(
      expect.objectContaining({ message: DB_DOWN })
    );
    const statuses = (await Promise.all(rows.map((r) => readRow(r.id))))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([
      'cancelled_by_refund',
      'cancelled_by_refund',
      'pending',
    ]);

    // The redelivery cancels the one left.
    await makeService().reverseSubscriptionPayoutsForCharge(charge);
    const after = await Promise.all(rows.map((r) => readRow(r.id)));
    expect(after.every((r) => r.status === 'cancelled_by_refund')).toBe(true);
  });

  it('a charge with no subscription rows does not even ask Stripe for its refunds', async () => {
    await makeService().reverseSubscriptionPayoutsForCharge(newCharge(1000));

    expect(stripe.refunds.list).not.toHaveBeenCalled();
  });
});
