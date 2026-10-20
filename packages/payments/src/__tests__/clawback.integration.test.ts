/**
 * The clawback engine (`reverseCharge`), against the real schema: the
 * guarantees are unique indexes, a row lock and CHECKs a mocked db would not
 * enforce. Design: docs/payments/refund-reversal-record.md (Codex-2hxff.8).
 *
 * Rows here are subscription-source slices on a run-unique charge id, so no
 * purchase or subscription fixture is needed (a payout may carry no source
 * ref). Purchase-source wiring is tested in @codex/purchase.
 */

import {
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  refundReviews,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  InternalServiceError,
  ServiceUnavailableError,
} from '@codex/service-errors';
import {
  createMockStripe,
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
import {
  type ClawbackCharge,
  type ClawbackDeps,
  type ClawbackRefund,
  listClawableRefunds,
  MAX_CLAWBACK_ATTEMPTS,
  pendingReductionsFor,
  refundShare,
  retryFailedClawbacks,
  reverseCharge,
} from '../clawback';

const uid = () => crypto.randomUUID().slice(0, 8);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A Stripe error as the SDK raises it. */
function stripeError(code: string, statusCode: number | undefined) {
  return Object.assign(new Error(`Stripe says ${code}`), {
    type: 'StripeInvalidRequestError',
    code,
    ...(statusCode === undefined ? {} : { statusCode }),
  });
}

describe('reverseCharge (the clawback engine)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let creatorA: string;
  let creatorB: string;
  let orgId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const createdPayoutIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorA, creatorB] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Clawback Org', slug: createUniqueSlug('clawback') })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    obs.error.mockClear();
    obs.warn.mockClear();
    obs.info.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // Payout rows feed global drains and sweeps: never leave them behind.
  // refund_reviews -> payout_reversals -> payouts are all ON DELETE RESTRICT.
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
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [creatorA, creatorB]));
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  function newCharge(amountCents: number): ClawbackCharge {
    return { id: `ch_claw_${uid()}`, amountCents };
  }

  let created = 1_000;
  function refundOf(amountCents: number): ClawbackRefund {
    created += 1;
    return { id: `re_claw_${uid()}`, amountCents, createdAt: created };
  }

  async function slice(
    charge: ClawbackCharge,
    spec: {
      payoutType: 'platform_fee' | 'organization_fee' | 'creator_payout';
      amountCents: number;
      status?: 'paid' | 'pending' | 'failed';
      userId?: string | null;
      lastRetryAt?: Date | null;
    }
  ): Promise<Payout> {
    const status = spec.status ?? 'paid';
    const isFee = spec.payoutType === 'platform_fee';
    const row = takeFirst(
      await db
        .insert(payouts)
        .values({
          organizationId: orgId,
          userId: isFee ? null : (spec.userId ?? creatorA),
          payoutType: spec.payoutType,
          amountCents: spec.amountCents,
          status,
          sourceType: 'subscription',
          stripeChargeId: charge.id,
          stripeTransferId:
            status === 'paid' && !isFee
              ? `tr_${spec.payoutType}_${uid()}`
              : null,
          reason: status === 'paid' ? null : 'connect_not_ready',
          resolvedAt: status === 'paid' ? new Date() : null,
          lastRetryAt: spec.lastRetryAt ?? null,
        })
        .returning()
    );
    createdPayoutIds.push(row.id);
    return row;
  }

  /** platform 100 + org 135 + creator 765 on a 1000p charge, all paid. */
  async function paidSplit(charge: ClawbackCharge) {
    return {
      platform: await slice(charge, {
        payoutType: 'platform_fee',
        amountCents: 100,
      }),
      org: await slice(charge, {
        payoutType: 'organization_fee',
        amountCents: 135,
      }),
      creator: await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
      }),
    };
  }

  function run(charge: ClawbackCharge, refunds: ClawbackRefund[]) {
    return reverseCharge(deps, {
      charge,
      source: { sourceType: 'subscription' },
      refunds,
    });
  }

  async function readRow(id: string): Promise<Payout> {
    return takeFirst(await db.select().from(payouts).where(eq(payouts.id, id)));
  }

  async function records(payoutId: string) {
    return db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, payoutId));
  }

  function reversals() {
    // The engine calls createReversal(id, params, options); its typings' last
    // overload is (id, options?), so the calls are read as the 3-argument form.
    const calls = vi.mocked(stripe.transfers.createReversal).mock
      .calls as unknown as Array<[string, unknown, unknown]>;
    return calls.map(([transferId, params, options]) => ({
      transferId,
      amount: (params as { amount?: number } | undefined)?.amount,
      key: (options as { idempotencyKey?: string } | undefined)?.idempotencyKey,
    }));
  }

  function failReversalOf(transferId: string, error: unknown, times = 1) {
    let left = times;
    const real = vi
      .mocked(stripe.transfers.createReversal)
      .getMockImplementation();
    vi.mocked(stripe.transfers.createReversal).mockImplementation(((
      id: string,
      ...rest: unknown[]
    ) => {
      if (id === transferId && left > 0) {
        left -= 1;
        return Promise.reject(error);
      }
      return (real as (...a: unknown[]) => unknown)(id, ...rest);
    }) as never);
  }

  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => undefined,
      (error: unknown) => error
    );
  }

  // ── shares ────────────────────────────────────────────────────────────

  describe('each refund claws back its own share', () => {
    it('a partial refund reverses each paid slice by its fraction; the rows stay paid; the fee share is recorded and kept', async () => {
      const charge = newCharge(1000);
      const { platform, org, creator } = await paidSplit(charge);
      const re = refundOf(300);

      await run(charge, [re]);

      expect(reversals()).toEqual(
        expect.arrayContaining([
          {
            transferId: org.stripeTransferId,
            amount: 40,
            key: `${org.stripeTransferId}_reversal_${re.id}_0`,
          },
          {
            transferId: creator.stripeTransferId,
            amount: 229,
            key: `${creator.stripeTransferId}_reversal_${re.id}_0`,
          },
        ])
      );
      expect(reversals()).toHaveLength(2);
      for (const row of [platform, org, creator]) {
        expect((await readRow(row.id)).status).toBe('paid');
      }
      expect(await records(platform.id)).toEqual([
        expect.objectContaining({
          kind: 'retained_fee',
          amountCents: 30,
          status: 'done',
        }),
      ]);
      expect(await records(org.id)).toEqual([
        expect.objectContaining({
          kind: 'transfer_reversal',
          amountCents: 40,
          status: 'done',
          causeType: 'refund',
          causeId: re.id,
          stripeReversalId: expect.stringMatching(/^trr_/),
        }),
      ]);
    });

    it('a second partial refund claws back its own share, and the first is not done again', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re1 = refundOf(300);
      const re2 = refundOf(300);

      await run(charge, [re1]);
      vi.mocked(stripe.transfers.createReversal).mockClear();
      await run(charge, [re1, re2]);

      // floor(765*600/1000) - floor(765*300/1000) = 459 - 229
      expect(reversals()).toEqual(
        expect.arrayContaining([
          {
            transferId: creator.stripeTransferId,
            amount: 230,
            key: `${creator.stripeTransferId}_reversal_${re2.id}_0`,
          },
        ])
      );
      expect(reversals().some((c) => c.key?.includes(re1.id))).toBe(false);
      expect((await records(creator.id)).map((r) => r.causeId).sort()).toEqual(
        [re1.id, re2.id].sort()
      );
    });

    it('refunds adding up to the whole charge reverse exactly each gross, and every row ends reversed', async () => {
      const charge = newCharge(1000);
      const { platform, org, creator } = await paidSplit(charge);
      const refunds = [refundOf(333), refundOf(333), refundOf(334)];

      await run(charge, refunds);

      const reversed = (transferId: string | null) =>
        reversals()
          .filter((c) => c.transferId === transferId)
          .reduce((sum, c) => sum + (c.amount ?? 0), 0);
      expect(reversed(org.stripeTransferId)).toBe(135);
      expect(reversed(creator.stripeTransferId)).toBe(765);
      for (const row of [platform, org, creator]) {
        expect((await readRow(row.id)).status).toBe('reversed');
      }
      const feeShares = (await records(platform.id)).map((r) => r.amountCents);
      expect(feeShares.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('the denominator is the charge amount, not the sum of the rows (D1)', async () => {
      // No platform row: the rows sum to 900 but the charge was 1000.
      const charge = newCharge(1000);
      const org = await slice(charge, {
        payoutType: 'organization_fee',
        amountCents: 135,
      });
      const creator = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
      });

      await run(charge, [refundOf(500)]);

      expect(reversals()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            transferId: org.stripeTransferId,
            amount: 67,
          }),
          expect.objectContaining({
            transferId: creator.stripeTransferId,
            amount: 382,
          }),
        ])
      );
      expect((await readRow(creator.id)).status).toBe('paid');
    });

    it('a share that floors to zero records nothing and calls Stripe for nothing', async () => {
      const charge = newCharge(1000);
      const tiny = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 3,
      });

      await run(charge, [refundOf(100)]);

      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect(await records(tiny.id)).toEqual([]);
      expect((await readRow(tiny.id)).status).toBe('paid');
      expect(obs.info).toHaveBeenCalledWith(
        'Refund share floored to zero, platform absorbs',
        expect.objectContaining({ payoutId: tiny.id, chargeId: charge.id })
      );
    });
  });

  // ── idempotency ───────────────────────────────────────────────────────

  describe('a redelivery does only what is left', () => {
    it('the same refunds again call Stripe for nothing and change no record', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re = refundOf(300);
      await run(charge, [re]);
      const before = await records(creator.id);
      vi.mocked(stripe.transfers.createReversal).mockClear();

      await run(charge, [re]);

      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect(await records(creator.id)).toEqual(before);
    });

    it('the reversal names its source, charge, refund, payout and record in Stripe metadata', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re = refundOf(1000);

      await run(charge, [re]);

      const [record] = await records(creator.id);
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        creator.stripeTransferId,
        {
          amount: 765,
          metadata: {
            source_type: 'subscription',
            charge_id: charge.id,
            refund_id: re.id,
            payout_id: creator.id,
            payout_reversal_id: record?.id,
            type: 'refund_reversal',
            codex_env: 'test',
          },
        },
        { idempotencyKey: `${creator.stripeTransferId}_reversal_${re.id}_0` }
      );
    });
  });

  // ── unpaid slices ─────────────────────────────────────────────────────

  describe('an unpaid slice', () => {
    it('a partial refund records a reduction; the row stays pending, and the drain will pay gross less it', async () => {
      const charge = newCharge(1000);
      const pending = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'pending',
      });

      await run(charge, [refundOf(300)]);

      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
      expect((await readRow(pending.id)).status).toBe('pending');
      expect(await records(pending.id)).toEqual([
        expect.objectContaining({
          kind: 'pending_reduction',
          amountCents: 229,
          status: 'done',
        }),
      ]);
      expect(
        (await pendingReductionsFor(db, [pending.id])).get(pending.id)
      ).toBe(229);
    });

    it('the refund that completes the charge cancels it', async () => {
      const charge = newCharge(1000);
      const pending = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'pending',
      });

      await run(charge, [refundOf(300), refundOf(700)]);

      expect((await readRow(pending.id)).status).toBe('cancelled_by_refund');
      expect(
        (await records(pending.id)).map((r) => [r.kind, r.status]).sort()
      ).toEqual([
        ['cancellation', 'done'],
        ['pending_reduction', 'done'],
      ]);
      expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    });

    it('a transfer that went out for a slice the refund cancelled is reversed in full', async () => {
      const charge = newCharge(1000);
      const stripeAccountId = `acct_claw_${uid()}`;
      await db.insert(stripeConnectAccounts).values({
        userId: creatorB,
        stripeAccountId,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
      });
      const pending = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'pending',
        userId: creatorB,
      });
      vi.mocked(stripe.transfers.list).mockResolvedValue({
        object: 'list',
        data: [{ id: 'tr_landed', metadata: { payout_id: pending.id } }],
        has_more: false,
      } as never);

      await run(charge, [refundOf(1000)]);

      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        'tr_landed',
        expect.not.objectContaining({ amount: expect.anything() }),
        expect.anything()
      );
      const after = await readRow(pending.id);
      expect(after.status).toBe('reversed');
      expect(after.stripeTransferId).toBe('tr_landed');
    });

    it('a slice a drain is paying right now is not reduced: the step is left failed and the call asks for a retry', async () => {
      const charge = newCharge(1000);
      const inFlight = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
        status: 'pending',
        lastRetryAt: new Date(),
      });

      const failure = await rejection(run(charge, [refundOf(300)]));

      expect(failure).toBeInstanceOf(InternalServiceError);
      expect((failure as Error).cause).toBeInstanceOf(ServiceUnavailableError);
      expect(await records(inFlight.id)).toEqual([
        expect.objectContaining({
          kind: 'pending_reduction',
          status: 'failed',
          lastErrorCode: 'payout_in_flight',
        }),
      ]);
      expect(
        (await pendingReductionsFor(db, [inFlight.id])).get(inFlight.id)
      ).toBeUndefined();
    });
  });

  // ── failures ──────────────────────────────────────────────────────────

  describe('a step that fails', () => {
    it('Stripe refused it: left failed with the next attempt, logged with an errorId, and the call resolves', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      failReversalOf(
        creator.stripeTransferId ?? '',
        stripeError('transfer_reversed', 400)
      );

      await run(charge, [refundOf(1000)]);

      expect(await records(creator.id)).toEqual([
        expect.objectContaining({
          status: 'failed',
          attempt: 1,
          lastErrorCode: 'transfer_reversed',
        }),
      ]);
      expect((await readRow(creator.id)).status).toBe('paid');
      expect(obs.error).toHaveBeenCalledWith(
        'Refund clawback step failed',
        expect.objectContaining({
          errorId: expect.stringMatching(UUID),
          payoutId: creator.id,
        })
      );
    });

    it('then a retry uses the next attempt key and completes', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re = refundOf(1000);
      failReversalOf(
        creator.stripeTransferId ?? '',
        stripeError('transfer_reversed', 400)
      );
      await run(charge, [re]);
      vi.mocked(stripe.transfers.createReversal).mockClear();

      await run(charge, [re]);

      expect(reversals()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: `${creator.stripeTransferId}_reversal_${re.id}_1`,
          }),
        ])
      );
      expect((await readRow(creator.id)).status).toBe('reversed');
    });

    it('an outcome Stripe did not confirm: left failed on the SAME attempt, and the call rejects with it as the cause', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re = refundOf(1000);
      const outage = Object.assign(new Error('socket hang up'), {
        type: 'StripeConnectionError',
      });
      failReversalOf(creator.stripeTransferId ?? '', outage);

      const failure = await rejection(run(charge, [re]));

      expect(failure).toBeInstanceOf(InternalServiceError);
      expect((failure as Error).cause).toBe(outage);
      expect(await records(creator.id)).toEqual([
        expect.objectContaining({ status: 'failed', attempt: 0 }),
      ]);

      // The redelivery keeps the key: Stripe returns the first attempt's
      // result if it did happen, so nothing is reversed twice.
      vi.mocked(stripe.transfers.createReversal).mockClear();
      await run(charge, [re]);
      expect(reversals()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: `${creator.stripeTransferId}_reversal_${re.id}_0`,
          }),
        ])
      );
      expect((await readRow(creator.id)).status).toBe('reversed');
    });

    it('several unconfirmed outcomes: the cause is an AggregateError of each', async () => {
      const charge = newCharge(1000);
      const { org, creator } = await paidSplit(charge);
      const outage = () =>
        Object.assign(new Error('socket hang up'), {
          type: 'StripeConnectionError',
        });
      failReversalOf(org.stripeTransferId ?? '', outage());
      // Chain a second failure for the creator's transfer on top.
      const first = vi
        .mocked(stripe.transfers.createReversal)
        .getMockImplementation();
      vi.mocked(stripe.transfers.createReversal).mockImplementation(((
        id: string,
        ...rest: unknown[]
      ) =>
        id === creator.stripeTransferId
          ? Promise.reject(outage())
          : (first as (...a: unknown[]) => unknown)(id, ...rest)) as never);

      const failure = await rejection(run(charge, [refundOf(1000)]));

      const cause = (failure as Error).cause;
      expect(cause).toBeInstanceOf(AggregateError);
      expect((cause as AggregateError).errors).toHaveLength(2);
    });

    it.each([
      'insufficient_funds',
      'balance_insufficient',
    ])('the payee cannot cover it (%s): a debt, one refund_reviews row, the row stays paid, and a redelivery adds nothing', async (code) => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re = refundOf(1000);
      failReversalOf(creator.stripeTransferId ?? '', stripeError(code, 400), 5);

      await run(charge, [re]);
      await run(charge, [re]);

      const [record] = await records(creator.id);
      expect(record).toEqual(
        expect.objectContaining({ status: 'debt', lastErrorCode: code })
      );
      const reviews = await db
        .select()
        .from(refundReviews)
        .where(eq(refundReviews.payoutId, creator.id));
      expect(reviews).toEqual([
        expect.objectContaining({
          payoutReversalId: record?.id,
          purchaseId: null,
          creatorUserId: creatorA,
          attemptedReversalCents: 765,
          errorCode: code,
        }),
      ]);
      expect((await readRow(creator.id)).status).toBe('paid');
      expect(
        reversals().filter((c) => c.transferId === creator.stripeTransferId)
      ).toHaveLength(1);
    });

    it('a step another delivery holds is not run: the call asks for a retry', async () => {
      const charge = newCharge(1000);
      const { creator } = await paidSplit(charge);
      const re = refundOf(1000);
      await db.insert(payoutReversals).values({
        payoutId: creator.id,
        causeType: 'refund',
        causeId: re.id,
        amountCents: 765,
        kind: 'transfer_reversal',
        status: 'pending',
        attemptedAt: new Date(),
      });

      const failure = await rejection(run(charge, [re]));

      expect((failure as Error).cause).toBeInstanceOf(ServiceUnavailableError);
      expect(
        reversals().some((c) => c.transferId === creator.stripeTransferId)
      ).toBe(false);
    });
  });

  // ── the hourly retry ──────────────────────────────────────────────────

  describe('retryFailedClawbacks', () => {
    async function failedStep(
      charge: ClawbackCharge,
      attempt: number,
      minutesAgo: number
    ) {
      const creator = await slice(charge, {
        payoutType: 'creator_payout',
        amountCents: 765,
      });
      const re = refundOf(1000);
      await db.insert(payoutReversals).values({
        payoutId: creator.id,
        causeType: 'refund',
        causeId: re.id,
        amountCents: 765,
        kind: 'transfer_reversal',
        status: 'failed',
        attempt,
        updatedAt: new Date(Date.now() - minutesAgo * 60_000),
      });
      return { creator, re };
    }

    it('retries a step failed long enough ago, on the charge and refunds read from Stripe, with its attempt key', async () => {
      const charge = newCharge(1000);
      const { creator, re } = await failedStep(charge, 2, 60);
      vi.mocked(stripe.charges.retrieve).mockResolvedValue({
        id: charge.id,
        amount: 1000,
      } as never);
      vi.mocked(stripe.refunds.list).mockResolvedValue({
        object: 'list',
        data: [
          {
            id: re.id,
            amount: 1000,
            status: 'succeeded',
            created: re.createdAt,
          },
        ],
        has_more: false,
      } as never);

      const result = await retryFailedClawbacks(deps, { olderThanMinutes: 15 });

      expect(result.retried).toBeGreaterThanOrEqual(1);
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        creator.stripeTransferId,
        expect.anything(),
        { idempotencyKey: `${creator.stripeTransferId}_reversal_${re.id}_2` }
      );
      expect((await readRow(creator.id)).status).toBe('reversed');
    });

    it('a refund that failed at Stripe is still clawed back: its step is retried, not stranded', async () => {
      // Owner decision 2026-10-19, "Hold it for support": the customer must
      // still be refunded another way, so the clawback stands. Were the
      // failed refund left out, its step would stay `failed` and the cron
      // would pick its charge first every run without ever completing it.
      const charge = newCharge(1000);
      const { creator, re } = await failedStep(charge, 0, 60);
      vi.mocked(stripe.charges.retrieve).mockResolvedValue({
        id: charge.id,
        amount: 1000,
      } as never);
      vi.mocked(stripe.refunds.list).mockResolvedValue({
        object: 'list',
        data: [
          { id: re.id, amount: 1000, status: 'failed', created: re.createdAt },
        ],
        has_more: false,
      } as never);

      await retryFailedClawbacks(deps, { olderThanMinutes: 15 });

      const [record] = await records(creator.id);
      expect(record?.status).toBe('done');
      expect((await readRow(creator.id)).status).toBe('reversed');
    });

    it('leaves a fresh failure and one that has used every attempt', async () => {
      const fresh = await failedStep(newCharge(1000), 1, 1);
      const spent = await failedStep(
        newCharge(1000),
        MAX_CLAWBACK_ATTEMPTS,
        60
      );

      await retryFailedClawbacks(deps, { olderThanMinutes: 15, limit: 500 });

      for (const { creator } of [fresh, spent]) {
        expect(stripe.charges.retrieve).not.toHaveBeenCalledWith(
          creator.stripeChargeId
        );
      }
    });
  });

  // ── reading refunds ───────────────────────────────────────────────────

  describe('listClawableRefunds', () => {
    it('returns succeeded and failed refunds with an amount, oldest first, across pages', async () => {
      vi.mocked(stripe.refunds.list)
        .mockResolvedValueOnce({
          object: 'list',
          data: [
            { id: 're_3', amount: 300, status: 'succeeded', created: 30 },
            { id: 're_p', amount: 200, status: 'pending', created: 25 },
            { id: 're_c', amount: 70, status: 'canceled', created: 20 },
          ],
          has_more: true,
        } as never)
        .mockResolvedValueOnce({
          object: 'list',
          data: [
            { id: 're_1', amount: 100, status: 'succeeded', created: 10 },
            { id: 're_a', amount: 60, status: 'requires_action', created: 8 },
            // Failed after it was issued: the clawback stands (owner decision
            // 2026-10-19, "Hold it for support").
            { id: 're_f', amount: 50, status: 'failed', created: 5 },
          ],
          has_more: false,
        } as never);

      const refunds = await listClawableRefunds(stripe, 'ch_list');

      expect(refunds.map((r) => r.id)).toEqual(['re_f', 're_1', 're_3']);
      expect(stripe.refunds.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ charge: 'ch_list', starting_after: 're_c' })
      );
    });
  });
});

describe('refundShare', () => {
  it('a partial refund takes the floored fraction of the slice', () => {
    expect(refundShare(765, 1000, 0, 300)).toBe(229);
  });

  it('each later refund takes what the cumulative fraction adds, so a full refund sums to the gross', () => {
    const shares = [
      refundShare(765, 1000, 0, 333),
      refundShare(765, 1000, 333, 666),
      refundShare(765, 1000, 666, 1000),
    ];
    expect(shares.reduce((a, b) => a + b, 0)).toBe(765);
  });

  it('refunds past the charge amount take nothing more', () => {
    expect(refundShare(765, 1000, 1000, 1200)).toBe(0);
  });
});
