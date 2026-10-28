/**
 * A refund handled before a purchase's payout slices are recorded
 * (Codex-2hxff.67): the payouts must end exactly as they would had the refund
 * come after.
 *
 * `completePurchase` commits the purchase, then records its slices after the
 * commit. A `charge.refunded` handled in between finds the purchase but no
 * slices, so its clawback does nothing; the slices are then recorded and paid
 * in full. `reverseEarlierRefunds` (@codex/payments) claws the refund back
 * from them in the same flow. The race is fixed here rather than left to
 * timing: the completing service's database lets the refund run the moment
 * the purchase's transaction commits.
 *
 * A refund handled before the purchase is recorded AT ALL rebuilds it from its
 * checkout session (the self-heal), and the later completion replays into it
 * (Codex-2hxff.68, and PAY-11 for courses): the last block below. The
 * rebuilt purchase carries the real split and the access grant, so a partial
 * refund nets the same as the late order, and a full one pays no one.
 *
 * Every test runs the late order on a second purchase as its oracle: same
 * price, same split, the refund after the payout. Real DB, mocked Stripe that
 * keeps state: a refund made reads back from `refunds.list` and
 * `charges.retrieve`, and each transfer from `transfers.list`, with its
 * reversals from `listReversals`.
 */

import { randomUUID } from 'node:crypto';
import {
  agreementProposals,
  content,
  contentAccess,
  courseEnrollments,
  courses,
  creatorOrganizationAgreements,
  entitlements,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  purchases,
  refunds,
  stripeConnectAccounts,
  users,
} from '@codex/database/schema';
import {
  AfterCommitError,
  UnsupportedCurrencyError,
} from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createTestMoneyDeps,
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
import type { FeeConfigService } from '../services/fee-config-service';
import { PurchaseService } from '../services/purchase-service';

const uid = () => randomUUID().slice(0, 8);
const PRICE = 1000;

/** A slice's share of a refund, as the spec states it: the same fraction, rounded down. */
const afterRefund = (gross: number, refunded: number) =>
  gross - Math.floor((gross * refunded) / PRICE);

describe('A refund handled before a purchase is paid out (Codex-2hxff.67)', () => {
  let db: Database;
  let stripe: Stripe;
  let buyerId: string;
  let creatorId: string;
  let ownerId: string;
  let orgId: string;
  const purchaseIds: string[] = [];
  const refundIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorId, ownerId] = (await seedTestUsers(db, 3)) as [
      string,
      string,
      string,
    ];
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Refund Order Org',
          slug: createUniqueSlug('refund-order'),
        })
        .returning()
    ).id;
    await setTestOrganisationPayee(db, orgId, ownerId);
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(null, creatorId),
        createTestConnectAccountInput(null, ownerId),
      ]);
  });

  beforeEach(() => {
    stripe = createMockStripe();
  });

  // Payout rows feed global drains: never leave them behind.
  // payout_reversals -> payouts is ON DELETE RESTRICT.
  afterAll(async () => {
    if (purchaseIds.length > 0) {
      const rows = await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(inArray(payouts.purchaseId, purchaseIds));
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
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [creatorId, ownerId]));
    await teardownTestDatabase();
  });

  // ── Stripe, keeping state ─────────────────────────────────────────────

  /** Charges and their refunds as Stripe holds them. */
  function stripeCharges() {
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
      const refunded = (refundsOf.get(id) ?? []).reduce(
        (sum, refund) => sum + refund.amount,
        0
      );
      return {
        id,
        object: 'charge',
        amount: PRICE,
        amount_refunded: refunded,
        refunded: refunded >= PRICE,
        metadata: {},
      };
    }) as never);
    return {
      refund(chargeId: string, amount: number): void {
        const id = `re_order_${uid()}`;
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

  // ── a sale ────────────────────────────────────────────────────────────

  /** One purchase of a new item (a second of the same item is a duplicate). */
  async function sale() {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('refund-order'),
          })
        )
        .returning()
    );
    const tag = uid();
    return {
      paymentIntentId: `pi_order_${tag}`,
      chargeId: `ch_order_${tag}`,
      metadata: {
        contentId: item.id,
        customerId: buyerId,
        organizationId: orgId,
        amountPaidCents: PRICE,
        currency: 'gbp',
        stripeChargeId: `ch_order_${tag}`,
      },
    };
  }

  type Sale = Awaited<ReturnType<typeof sale>>;

  async function complete(sold: Sale, database: Database = db) {
    const purchase = await new PurchaseService(
      { db: database, environment: 'test', ...createTestMoneyDeps() },
      stripe
    ).completePurchase(sold.paymentIntentId, sold.metadata);
    purchaseIds.push(purchase.id);
    return purchase;
  }

  /**
   * The purchase's half of `charge.refunded`, in the webhook's order: every
   * refund recorded first, then the refund applied and clawed back.
   */
  async function chargeRefunded(sold: Sale): Promise<void> {
    const service = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
    const [latest] = await service.recordChargeRefunds({
      id: sold.chargeId,
      paymentIntentId: sold.paymentIntentId,
    });
    const charge = await stripe.charges.retrieve(sold.chargeId);
    await service.processRefund(sold.paymentIntentId, {
      charge: { id: charge.id, amountCents: charge.amount },
      stripeRefundId: latest?.id,
      refundAmountCents: charge.amount_refunded,
    });
  }

  /**
   * A database whose first transaction, once committed, lets `between` run
   * before the caller goes on: the refund lands between the purchase's commit
   * and its slices.
   */
  function refundLandsAfterCommit(between: () => Promise<void>): Database {
    let landed = false;
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return async (fn: Parameters<Database['transaction']>[0]) => {
            const result = await target.transaction(fn);
            if (!landed) {
              landed = true;
              await between();
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  // ── what the payees end with ──────────────────────────────────────────

  async function slicesOf(chargeId: string): Promise<Payout[]> {
    return db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, chargeId));
  }

  /** What Stripe transferred to each payee slice, less what it reversed. */
  async function netByType(chargeId: string): Promise<Record<string, number>> {
    const rows = (await slicesOf(chargeId)).filter(
      (row) => row.payoutType !== 'platform_fee'
    );
    const { data: transfers } = await stripe.transfers.list({ limit: 100 });
    const net: Record<string, number> = {};
    for (const row of rows) {
      let cents = 0;
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

  function statusByType(rows: Payout[]): Record<string, string> {
    return Object.fromEntries(rows.map((row) => [row.payoutType, row.status]));
  }

  function moneyCalls() {
    return {
      transfers: vi.mocked(stripe.transfers.create).mock.calls.length,
      reversals: vi.mocked(stripe.transfers.createReversal).mock.calls.length,
    };
  }

  // ── tests ─────────────────────────────────────────────────────────────

  it('a purchase whose charge has no refund recorded asks Stripe nothing more', async () => {
    stripeCharges();
    const sold = await sale();

    await complete(sold);

    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(stripe.refunds.list).not.toHaveBeenCalled();
    const rows = await slicesOf(sold.chargeId);
    expect(statusByType(rows)).toEqual({
      platform_fee: 'paid',
      organization_fee: 'paid',
      creator_payout: 'paid',
    });
    expect(await netByType(sold.chargeId)).toEqual(
      Object.fromEntries(
        rows
          .filter((row) => row.payoutType !== 'platform_fee')
          .map((row) => [row.payoutType, row.amountCents])
      )
    );
  });

  it('a full refund handled between the commit and the payout: each slice is transferred, then reversed in full', async () => {
    const charges = stripeCharges();
    const early = await sale();
    const late = await sale();

    charges.refund(early.chargeId, PRICE);
    const purchase = await complete(
      early,
      refundLandsAfterCommit(() => chargeRefunded(early))
    );
    expect(
      takeFirst(
        await db.select().from(purchases).where(eq(purchases.id, purchase.id))
      ).status
    ).toBe('refunded');

    // The oracle: the same sale, refunded after its payout.
    await complete(late);
    charges.refund(late.chargeId, PRICE);
    await chargeRefunded(late);

    expect(await netByType(early.chargeId)).toEqual({
      organization_fee: 0,
      creator_payout: 0,
    });
    expect(await netByType(early.chargeId)).toEqual(
      await netByType(late.chargeId)
    );
    const rows = await slicesOf(early.chargeId);
    expect(statusByType(rows)).toEqual({
      platform_fee: 'reversed',
      organization_fee: 'reversed',
      creator_payout: 'reversed',
    });
    expect(statusByType(rows)).toEqual(
      statusByType(await slicesOf(late.chargeId))
    );
  });

  it('a partial refund handled in that gap: each payee nets exactly what the late refund leaves', async () => {
    const charges = stripeCharges();
    const early = await sale();
    const late = await sale();
    const REFUND = 300;

    charges.refund(early.chargeId, REFUND);
    await complete(
      early,
      refundLandsAfterCommit(() => chargeRefunded(early))
    );

    await complete(late);
    charges.refund(late.chargeId, REFUND);
    await chargeRefunded(late);

    const rows = await slicesOf(early.chargeId);
    expect(await netByType(early.chargeId)).toEqual(
      await netByType(late.chargeId)
    );
    expect(await netByType(early.chargeId)).toEqual(
      Object.fromEntries(
        rows
          .filter((row) => row.payoutType !== 'platform_fee')
          .map((row) => [row.payoutType, afterRefund(row.amountCents, REFUND)])
      )
    );
    expect(statusByType(rows)).toEqual({
      platform_fee: 'paid',
      organization_fee: 'paid',
      creator_payout: 'paid',
    });
  });

  it('a redelivery of either event moves no more money', async () => {
    const charges = stripeCharges();
    const sold = await sale();
    charges.refund(sold.chargeId, 450);
    await complete(
      sold,
      refundLandsAfterCommit(() => chargeRefunded(sold))
    );
    const settled = await netByType(sold.chargeId);
    const calls = moneyCalls();

    await complete(sold);
    await chargeRefunded(sold);
    await complete(sold);

    expect(moneyCalls()).toEqual(calls);
    expect(await netByType(sold.chargeId)).toEqual(settled);
    const records = await db
      .select()
      .from(payoutReversals)
      .where(
        inArray(
          payoutReversals.payoutId,
          (await slicesOf(sold.chargeId)).map((row) => row.id)
        )
      );
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.status === 'done')).toBe(true);
  });

  it('a clawback that fails after the purchase committed is logged once, by the clawback, and comes back as an AfterCommitError with the purchase', async () => {
    const charges = stripeCharges();
    const sold = await sale();
    charges.refund(sold.chargeId, PRICE);
    const refusal = Object.assign(new Error('No such charge'), {
      type: 'StripeInvalidRequestError',
      statusCode: 404,
    });
    const service = new PurchaseService(
      {
        db: refundLandsAfterCommit(async () => {
          await chargeRefunded(sold);
          // The refund is in; the clawback after the payout is refused.
          vi.mocked(stripe.charges.retrieve).mockRejectedValueOnce(refusal);
        }),
        environment: 'test',
        ...createTestMoneyDeps(),
      },
      stripe
    );
    const logged = vi.spyOn(
      (service as unknown as { obs: { error: (...args: unknown[]) => void } })
        .obs,
      'error'
    );

    const failure = await service
      .completePurchase(sold.paymentIntentId, sold.metadata)
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(failure).toBeInstanceOf(AfterCommitError);
    expect(failure).toMatchObject({
      cause: refusal,
      completed: { stripePaymentIntentId: sold.paymentIntentId },
    });
    // Logged once, by the clawback, with its purchase and charge.
    const clawbackLogs = logged.mock.calls.filter(([message]) =>
      String(message).includes('preceded this payout')
    );
    expect(clawbackLogs).toEqual([
      [
        expect.stringContaining('if the event is not retried, a person must'),
        expect.objectContaining({
          errorId: expect.any(String),
          chargeId: sold.chargeId,
          purchaseId: expect.any(String),
          errorMessage: 'No such charge',
        }),
      ],
    ]);
    expect(logged).not.toHaveBeenCalledWith(
      expect.stringContaining('redelivery retries it'),
      expect.anything()
    );
    // The purchase did complete: it is not logged as one that failed.
    expect(logged).not.toHaveBeenCalledWith(
      'Failed to complete purchase',
      expect.anything()
    );
    // The payout went out; the next delivery claws it back.
    await complete(sold);
    expect(await netByType(sold.chargeId)).toEqual({
      organization_fee: 0,
      creator_payout: 0,
    });
  });

  // ── a refund before the purchase exists (Codex-2hxff.68, PAY-11) ───────
  //
  // `charge.refunded` beats `checkout.session.completed`: the self-heal
  // rebuilds the purchase from its checkout session, then the completion
  // replays into it. Last in this file: the creator agreement it adds to the
  // shared organisation is deleted when it ends.

  describe('a refund handled before the purchase is recorded at all', () => {
    // The configured fees and the creator's agreement, so the split is not
    // the default one a self-heal used to write.
    const FEES = {
      platformFeePercent: 1500,
      orgFeePercent: 2000,
      minPlatformFeeCents: 0,
      minTransferCents: 0,
    };
    const CREATOR_SHARE = 7000;
    /** The checkout's start: the agreement is resolved at it. */
    const sessionCreated = Math.floor(Date.now() / 1000) - 3600;
    const paidAt = new Date((sessionCreated + 600) * 1000);
    const feeConfig = {
      getFeesForCreator: vi.fn(async () => FEES),
      getFeesForOrg: vi.fn(async () => FEES),
      getFeesPlatform: vi.fn(async () => FEES),
    } as unknown as FeeConfigService;

    // The self-heal parses the session with the booking webhook's schema,
    // whose user id is alphanumeric, as production ids are.
    const healBuyerId = `refundheal${uid()}`.replace(/[^a-zA-Z0-9]/g, '');
    let agreementId: string;
    const itemIds: { content: string[]; courses: string[] } = {
      content: [],
      courses: [],
    };
    const chargeIds: string[] = [];
    /** Checkout sessions as Stripe holds them, by PaymentIntent. */
    let sessions: Map<string, Record<string, unknown>>;

    beforeAll(async () => {
      await db.insert(users).values({
        id: healBuyerId,
        name: 'Refund-first buyer',
        email: `${healBuyerId}@example.com`,
        emailVerified: true,
        role: 'customer',
      });
      const effectiveFrom = new Date(Date.now() - 86_400_000);
      const proposal = takeFirst(
        await db
          .insert(agreementProposals)
          .values({
            organizationId: orgId,
            creatorId,
            revenueType: 'content_purchase',
            roundNumber: 1,
            proposedByUserId: creatorId,
            proposedByRole: 'owner',
            proposedCreatorSharePercent: CREATOR_SHARE,
            proposedEffectiveFrom: effectiveFrom,
            status: 'accepted',
          })
          .returning()
      );
      agreementId = takeFirst(
        await db
          .insert(creatorOrganizationAgreements)
          .values({
            organizationId: orgId,
            creatorId,
            organizationFeePercentage: 10_000 - CREATOR_SHARE,
            revenueType: 'content_purchase',
            status: 'active',
            currentProposalId: proposal.id,
            effectiveFrom,
          })
          .returning()
      ).id;
    });

    beforeEach(() => {
      sessions = new Map();
      Object.assign(stripe.checkout.sessions, {
        list: vi.fn(async (params: { payment_intent?: string }) => {
          const session = sessions.get(params.payment_intent ?? '');
          return { object: 'list', data: session ? [session] : [] };
        }),
      });
    });

    afterAll(async () => {
      const bought = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.customerId, healBuyerId));
      const boughtIds = bought.map((row) => row.id);
      if (boughtIds.length > 0) {
        const slices = await db
          .select({ id: payouts.id })
          .from(payouts)
          .where(inArray(payouts.purchaseId, boughtIds));
        const sliceIds = slices.map((row) => row.id);
        if (sliceIds.length > 0) {
          await db
            .delete(payoutReversals)
            .where(inArray(payoutReversals.payoutId, sliceIds));
          await db.delete(payouts).where(inArray(payouts.id, sliceIds));
        }
      }
      if (chargeIds.length > 0) {
        await db
          .delete(refunds)
          .where(inArray(refunds.stripeChargeId, chargeIds));
      }
      await db.delete(entitlements).where(eq(entitlements.userId, healBuyerId));
      await db
        .delete(courseEnrollments)
        .where(eq(courseEnrollments.userId, healBuyerId));
      await db
        .delete(contentAccess)
        .where(eq(contentAccess.userId, healBuyerId));
      await db.delete(purchases).where(eq(purchases.customerId, healBuyerId));
      await db
        .delete(creatorOrganizationAgreements)
        .where(eq(creatorOrganizationAgreements.id, agreementId));
      await db
        .delete(agreementProposals)
        .where(
          and(
            eq(agreementProposals.organizationId, orgId),
            eq(agreementProposals.creatorId, creatorId)
          )
        );
      if (itemIds.courses.length > 0) {
        await db.delete(courses).where(inArray(courses.id, itemIds.courses));
      }
      if (itemIds.content.length > 0) {
        await db.delete(content).where(inArray(content.id, itemIds.content));
      }
      await db.delete(users).where(eq(users.id, healBuyerId));
    });

    function service(): PurchaseService {
      return new PurchaseService(
        { db, environment: 'test', ...createTestMoneyDeps(), feeConfig },
        stripe
      );
    }

    /** One sale of a new item, and the checkout session Stripe holds for it. */
    async function healSale(kind: 'content' | 'course') {
      const tag = uid();
      const paymentIntentId = `pi_heal_${tag}`;
      const chargeId = `ch_heal_${tag}`;
      chargeIds.push(chargeId);
      if (kind === 'content') {
        const item = takeFirst(
          await db
            .insert(content)
            .values(
              createTestContentInput(creatorId, {
                organizationId: orgId,
                contentType: 'written',
                slug: createUniqueSlug('refund-heal'),
              })
            )
            .returning()
        );
        itemIds.content.push(item.id);
        sessions.set(paymentIntentId, {
          id: `cs_${tag}`,
          amount_total: PRICE,
          currency: 'gbp',
          created: sessionCreated,
          metadata: {
            customerId: healBuyerId,
            contentId: item.id,
            organizationId: orgId,
          },
        });
        return {
          kind,
          paymentIntentId,
          chargeId,
          itemId: item.id,
          complete: () =>
            service().completePurchase(paymentIntentId, {
              contentId: item.id,
              customerId: healBuyerId,
              organizationId: orgId,
              amountPaidCents: PRICE,
              currency: 'gbp',
              stripeChargeId: chargeId,
              paidAt,
              offerAt: new Date(sessionCreated * 1000),
            }),
        };
      }
      const course = takeFirst(
        await db
          .insert(courses)
          .values({
            organizationId: orgId,
            creatorId,
            slug: createUniqueSlug('refund-heal-course'),
            title: 'Refund-first course',
            status: 'published',
            priceCents: PRICE,
          })
          .returning()
      );
      itemIds.courses.push(course.id);
      sessions.set(paymentIntentId, {
        id: `cs_${tag}`,
        amount_total: PRICE,
        currency: 'gbp',
        created: sessionCreated,
        metadata: {
          kind: 'course',
          customerId: healBuyerId,
          courseId: course.id,
          courseTitle: course.title,
        },
      });
      return {
        kind,
        paymentIntentId,
        chargeId,
        itemId: course.id,
        complete: () =>
          service().completeCoursePurchase(paymentIntentId, {
            courseId: course.id,
            customerId: healBuyerId,
            amountPaidCents: PRICE,
            currency: 'gbp',
            stripeChargeId: chargeId,
            paidAt,
            offerAt: new Date(sessionCreated * 1000),
          }),
      };
    }

    type HealSale = Awaited<ReturnType<typeof healSale>>;

    /** `charge.refunded`'s purchase half, as the webhook runs it. */
    async function refunded(sold: HealSale): Promise<void> {
      const svc = service();
      const [latest] = await svc.recordChargeRefunds({
        id: sold.chargeId,
        paymentIntentId: sold.paymentIntentId,
      });
      const charge = await stripe.charges.retrieve(sold.chargeId);
      await svc.processRefund(sold.paymentIntentId, {
        charge: { id: charge.id, amountCents: charge.amount },
        stripeRefundId: latest?.id,
        refundAmountCents: charge.amount_refunded,
        paidAt,
      });
    }

    async function purchaseOf(sold: HealSale) {
      return takeFirst(
        await db
          .select()
          .from(purchases)
          .where(eq(purchases.stripePaymentIntentId, sold.paymentIntentId))
      );
    }

    /** Whether the buyer can open what they bought, by every grant. */
    async function hasAccess(sold: HealSale): Promise<boolean> {
      const purchase = await purchaseOf(sold);
      const [grant] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.sourceRef, purchase.id));
      const live = grant !== undefined && grant.revokedAt === null;
      if (sold.kind === 'course') return live;
      const [row] = await db
        .select()
        .from(contentAccess)
        .where(
          and(
            eq(contentAccess.userId, healBuyerId),
            eq(contentAccess.contentId, sold.itemId)
          )
        );
      const verified = await service().verifyPurchase(sold.itemId, healBuyerId);
      return live && row?.deletedAt === null && verified;
    }

    function split(purchase: Awaited<ReturnType<typeof purchaseOf>>) {
      return {
        platformFeeCents: purchase.platformFeeCents,
        organizationFeeCents: purchase.organizationFeeCents,
        creatorPayoutCents: purchase.creatorPayoutCents,
        creatorOrgAgreementId: purchase.creatorOrgAgreementId,
      };
    }

    for (const kind of ['content', 'course'] as const) {
      it(`${kind}: a partial refund first — the rebuilt purchase keeps its real split and the buyer's access, and each payee nets what the late refund leaves`, async () => {
        const charges = stripeCharges();
        const REFUND = 300;
        const early = await healSale(kind);
        const late = await healSale(kind);

        charges.refund(early.chargeId, REFUND);
        await refunded(early);
        const rebuilt = await purchaseOf(early);
        expect(rebuilt).toMatchObject({
          status: 'completed',
          refundAmountCents: REFUND,
          purchasedAt: paidAt,
        });
        // Nothing is paid before the completion.
        expect(await slicesOf(early.chargeId)).toEqual([]);
        expect(await hasAccess(early)).toBe(true);

        await early.complete();

        // The oracle: the same sale, refunded after its payout.
        await late.complete();
        charges.refund(late.chargeId, REFUND);
        await refunded(late);

        // The split completion computes: the configured fees, and the
        // agreement in force when the checkout started (not the default).
        expect(split(rebuilt)).toEqual(split(await purchaseOf(late)));
        expect(rebuilt.creatorOrgAgreementId).toBe(agreementId);
        expect(rebuilt.platformFeeCents).toBe(150);
        expect(rebuilt.creatorPayoutCents).toBe(595);

        const rows = await slicesOf(early.chargeId);
        expect(await netByType(early.chargeId)).toEqual(
          await netByType(late.chargeId)
        );
        expect(await netByType(early.chargeId)).toEqual(
          Object.fromEntries(
            rows
              .filter((row) => row.payoutType !== 'platform_fee')
              .map((row) => [
                row.payoutType,
                afterRefund(row.amountCents, REFUND),
              ])
          )
        );
        expect(statusByType(rows)).toEqual({
          platform_fee: 'paid',
          organization_fee: 'paid',
          creator_payout: 'paid',
        });
        // P-1: a partial refund keeps access, whichever came first.
        expect(await hasAccess(early)).toBe(true);
        expect(await hasAccess(late)).toBe(true);
      });

      it(`${kind}: a full refund first — the purchase is refunded, the buyer has no access, and nothing is ever paid`, async () => {
        const charges = stripeCharges();
        const early = await healSale(kind);

        charges.refund(early.chargeId, PRICE);
        await refunded(early);
        await early.complete();

        const purchase = await purchaseOf(early);
        expect(purchase).toMatchObject({
          status: 'refunded',
          refundAmountCents: PRICE,
          stripeRefundId: expect.stringMatching(/^re_order_/),
        });
        expect(await hasAccess(early)).toBe(false);
        // Rebuilt already refunded, so access was never granted at all: there
        // is no grant a failed revoke could leave behind.
        expect(
          await db
            .select()
            .from(entitlements)
            .where(eq(entitlements.sourceRef, purchase.id))
        ).toEqual([]);
        expect(
          await db
            .select()
            .from(contentAccess)
            .where(
              and(
                eq(contentAccess.userId, healBuyerId),
                eq(contentAccess.contentId, early.itemId)
              )
            )
        ).toEqual([]);
        expect(await slicesOf(early.chargeId)).toEqual([]);
        expect(moneyCalls()).toEqual({ transfers: 0, reversals: 0 });
      });

      it(`${kind}: a sale in another currency is refused before anything is written, as completion refuses it (PAY-25)`, async () => {
        const charges = stripeCharges();
        const early = await healSale(kind);
        const session = sessions.get(early.paymentIntentId);
        if (session) session.currency = 'usd';

        charges.refund(early.chargeId, 300);
        await expect(refunded(early)).rejects.toBeInstanceOf(
          UnsupportedCurrencyError
        );

        expect(
          await db
            .select()
            .from(purchases)
            .where(eq(purchases.stripePaymentIntentId, early.paymentIntentId))
        ).toEqual([]);
        expect(
          await db
            .select()
            .from(entitlements)
            .where(eq(entitlements.userId, healBuyerId))
        ).toEqual(
          expect.not.arrayContaining([
            expect.objectContaining({
              [kind === 'content' ? 'contentId' : 'courseId']: early.itemId,
            }),
          ])
        );
      });

      it(`${kind}: redeliveries of either event move no more money`, async () => {
        const charges = stripeCharges();
        const early = await healSale(kind);
        charges.refund(early.chargeId, 450);
        await refunded(early);
        await early.complete();
        const settled = await netByType(early.chargeId);
        const calls = moneyCalls();

        await refunded(early);
        await early.complete();
        await refunded(early);
        await early.complete();

        expect(moneyCalls()).toEqual(calls);
        expect(await netByType(early.chargeId)).toEqual(settled);
        expect(await slicesOf(early.chargeId)).toHaveLength(3);
        expect(await hasAccess(early)).toBe(true);
      });
    }
  });
});
