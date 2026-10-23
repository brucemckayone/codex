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
 * (When the refund is handled before the purchase is recorded at all, the
 * self-heal records it refunded and no slice is ever written: a full refund
 * already pays no one. That path is not this file's.)
 *
 * Every test runs the late order on a second purchase as its oracle: same
 * price, same split, the refund after the payout. Real DB, mocked Stripe that
 * keeps state: a refund made reads back from `refunds.list` and
 * `charges.retrieve`, and each transfer from `transfers.list`, with its
 * reversals from `listReversals`.
 */

import { randomUUID } from 'node:crypto';
import {
  content,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  purchases,
  refunds,
  stripeConnectAccounts,
} from '@codex/database/schema';
import { AfterCommitError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTestOrganisationPayee,
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
      { db: database, environment: 'test' },
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
    const service = new PurchaseService({ db, environment: 'test' }, stripe);
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

  it('a clawback that fails after the purchase committed is logged as exactly that and comes back as an AfterCommitError with the purchase', async () => {
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
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('was not clawed back; a redelivery retries it'),
      expect.objectContaining({
        errorId: expect.any(String),
        stripeChargeId: sold.chargeId,
      })
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
});
