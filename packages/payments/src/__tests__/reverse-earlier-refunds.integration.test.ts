/**
 * `reverseEarlierRefunds`: the clawback a flow runs right after recording a
 * charge's slices, for a refund or chargeback handled before they existed
 * (Codex-2hxff.67). The flows that call it are covered in
 * @codex/subscription refund-before-invoice and @codex/purchase
 * refund-before-payout; this file covers what the engine adds: which recorded
 * causes trigger it, that a failure is alerted (nothing else would retry one
 * that happened before any step was recorded), and the after-commit form.
 */

import {
  disputes,
  organizations,
  type Payout,
  payoutReversals,
  payouts,
  refunds,
} from '@codex/database/schema';
import { AfterCommitError } from '@codex/service-errors';
import {
  createMockStripe,
  createUniqueSlug,
  type Database,
  seedTestUsers,
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
import {
  type ClawbackDeps,
  reverseEarlierRefunds,
  reverseEarlierRefundsAfterCommit,
} from '../clawback';
import { isDrainablePayout } from '../payout-ledger';

const uid = () => crypto.randomUUID().slice(0, 8);
const CHARGE = 1000;
const SOURCE = { sourceType: 'subscription' } as const;

describe('reverseEarlierRefunds (Codex-2hxff.67)', () => {
  let db: Database;
  let stripe: Stripe;
  let deps: ClawbackDeps;
  let creatorId: string;
  let orgId: string;
  const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const payoutIds: string[] = [];
  const refundIds: string[] = [];
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({ name: 'Earlier Org', slug: createUniqueSlug('earlier') })
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    vi.mocked(stripe.charges.retrieve).mockImplementation((async (
      id: string
    ) => ({ id, object: 'charge', amount: CHARGE, metadata: {} })) as never);
    obs.error.mockClear();
    deps = { db, stripe, obs, environment: 'test' };
  });

  // Payout rows feed global drains and sweeps: never leave them behind.
  afterAll(async () => {
    if (payoutIds.length > 0) {
      await db
        .delete(payoutReversals)
        .where(inArray(payoutReversals.payoutId, payoutIds));
      await db.delete(payouts).where(inArray(payouts.id, payoutIds));
    }
    if (refundIds.length > 0) {
      await db
        .delete(refunds)
        .where(inArray(refunds.stripeRefundId, refundIds));
    }
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    await teardownTestDatabase();
  });

  // ── fixtures ──────────────────────────────────────────────────────────

  /** A subscription charge's slices: org 135 paid, creator 765 unpaid. */
  async function slices(chargeId: string) {
    const insert = async (
      payoutType: 'organization_fee' | 'creator_payout',
      amountCents: number,
      paid: boolean
    ): Promise<Payout> => {
      const row = takeFirst(
        await db
          .insert(payouts)
          .values({
            organizationId: orgId,
            userId: creatorId,
            payoutType,
            amountCents,
            status: paid ? 'paid' : 'pending',
            sourceType: 'subscription',
            stripeChargeId: chargeId,
            stripeTransferId: paid ? `tr_earlier_${uid()}` : null,
            reason: paid ? null : 'connect_not_ready',
            resolvedAt: paid ? new Date() : null,
          })
          .returning()
      );
      payoutIds.push(row.id);
      return row;
    };
    return {
      org: await insert('organization_fee', 135, true),
      creator: await insert('creator_payout', 765, false),
    };
  }

  /** A refund as the refund webhook records it, and as Stripe lists it. */
  async function refunded(chargeId: string, amountCents: number) {
    const id = `re_earlier_${uid()}`;
    refundIds.push(id);
    await db.insert(refunds).values({
      stripeRefundId: id,
      stripeChargeId: chargeId,
      amountCents,
      currency: 'gbp',
      status: 'succeeded',
      stripeCreatedAt: new Date(),
    });
    vi.mocked(stripe.refunds.list).mockResolvedValue({
      object: 'list',
      data: [
        {
          id,
          amount: amountCents,
          status: 'succeeded',
          created: Math.floor(Date.now() / 1000),
        },
      ],
      has_more: false,
    } as never);
    return id;
  }

  /** A chargeback as the dispute webhook records it. */
  async function disputed(chargeId: string, status: string) {
    const id = `dp_earlier_${uid()}`;
    disputeIds.push(id);
    await db.insert(disputes).values({
      stripeDisputeId: id,
      stripeChargeId: chargeId,
      amountCents: CHARGE,
      currency: 'gbp',
      status,
      stripeCreatedAt: new Date(),
    });
    return id;
  }

  async function recordsOf(payoutId: string) {
    return db
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.payoutId, payoutId));
  }

  async function drainable(payoutId: string): Promise<boolean> {
    const rows = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), isDrainablePayout()));
    return rows.length === 1;
  }

  // ── tests ─────────────────────────────────────────────────────────────

  it('a charge with no refund or chargeback recorded asks Stripe nothing', async () => {
    const chargeId = `ch_earlier_${uid()}`;
    const { org } = await slices(chargeId);

    await reverseEarlierRefunds(deps, { chargeId, source: SOURCE });

    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(stripe.refunds.list).not.toHaveBeenCalled();
    expect(await recordsOf(org.id)).toHaveLength(0);
  });

  it('a recorded refund is clawed back from the slices, the charge amount the denominator', async () => {
    const chargeId = `ch_earlier_${uid()}`;
    const { org, creator } = await slices(chargeId);
    const refundId = await refunded(chargeId, 400);

    await reverseEarlierRefunds(deps, { chargeId, source: SOURCE });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      org.stripeTransferId,
      expect.objectContaining({
        amount: 54,
        metadata: expect.objectContaining({ refund_id: refundId }),
      }),
      expect.anything()
    );
    expect(await recordsOf(creator.id)).toEqual([
      expect.objectContaining({
        kind: 'pending_reduction',
        amountCents: 306,
        status: 'done',
      }),
    ]);
  });

  it('a chargeback recorded before the slices, with no refund, is applied too: the paid slice reversed by its share, the unpaid one held', async () => {
    const chargeId = `ch_earlier_${uid()}`;
    const { org, creator } = await slices(chargeId);
    const disputeId = await disputed(chargeId, 'needs_response');

    await reverseEarlierRefunds(deps, { chargeId, source: SOURCE });

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      org.stripeTransferId,
      expect.objectContaining({
        amount: 135,
        metadata: expect.objectContaining({ dispute_id: disputeId }),
      }),
      expect.anything()
    );
    // An open chargeback holds an unpaid slice rather than reducing it.
    expect(await recordsOf(creator.id)).toHaveLength(0);
    expect(await drainable(creator.id)).toBe(false);
  });

  it('a won chargeback, or a canceled refund, is no cause: nothing is asked or reversed', async () => {
    const chargeId = `ch_earlier_${uid()}`;
    const { org } = await slices(chargeId);
    await disputed(chargeId, 'won');
    const refundId = await refunded(chargeId, 400);
    await db
      .update(refunds)
      .set({ status: 'canceled' })
      .where(eq(refunds.stripeRefundId, refundId));

    await reverseEarlierRefunds(deps, { chargeId, source: SOURCE });

    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(await recordsOf(org.id)).toHaveLength(0);
  });

  it('a failure before any step is recorded is alerted with an errorId, then rethrown as it is', async () => {
    const chargeId = `ch_earlier_${uid()}`;
    const { org } = await slices(chargeId);
    await refunded(chargeId, 400);
    const outage = Object.assign(new Error('Stripe is unreachable'), {
      type: 'StripeConnectionError',
    });
    vi.mocked(stripe.charges.retrieve).mockRejectedValueOnce(outage);

    await expect(
      reverseEarlierRefunds(deps, { chargeId, source: SOURCE })
    ).rejects.toBe(outage);

    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('preceded this payout'),
      expect.objectContaining({
        errorId: expect.any(String),
        chargeId,
        sourceType: 'subscription',
        error: 'Stripe is unreachable',
      })
    );
    // Nothing recorded: the hourly retry would never see it.
    expect(await recordsOf(org.id)).toHaveLength(0);
  });

  it('after a commit, a failure is held: finish raises it with the result, as an AfterCommitError', async () => {
    const chargeId = `ch_earlier_${uid()}`;
    await slices(chargeId);
    await refunded(chargeId, 400);
    const outage = new Error('Stripe is unreachable');
    vi.mocked(stripe.charges.retrieve).mockRejectedValueOnce(outage);

    const finish = await reverseEarlierRefundsAfterCommit(deps, {
      chargeId,
      source: SOURCE,
    });

    const raised = (() => {
      try {
        finish({ userId: 'u_1' });
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(raised).toBeInstanceOf(AfterCommitError);
    expect(raised).toMatchObject({
      completed: { userId: 'u_1' },
      cause: outage,
    });
    // Without a failure, finish is the result itself.
    const clean = await reverseEarlierRefundsAfterCommit(deps, {
      chargeId: `ch_earlier_${uid()}`,
      source: SOURCE,
    });
    expect(clean({ userId: 'u_2' })).toEqual({ userId: 'u_2' });
  });
});
