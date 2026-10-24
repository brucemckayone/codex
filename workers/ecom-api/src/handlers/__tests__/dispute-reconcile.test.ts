/**
 * The hourly dispute reconcile (Codex-2hxff.58; docs/payments/dispute-record.md
 * §9): disputes whose webhook events were missed are settled through the
 * webhook's own `processDispute`.
 *
 * | Source                         | Acted on when                                   |
 * | ------------------------------ | ----------------------------------------------- |
 * | Stripe's events, last 4 days   | no row; or the row would move to a later stage |
 * | Our final, unapplied rows      | always (retrieved from Stripe first)           |
 *
 * A chargeback that is still open is never re-run (no second block), and an
 * outcome step that keeps failing is alerted at error on every run.
 *
 * Strategy: a stateful fake of the purchase service's dispute record (forward
 * only, as `recordDispute` is), spies for the steps, and a Stripe stub. The
 * services' own behaviour is covered by their integration suites.
 */

import type { PurchaseService } from '@codex/purchase';
import type { SubscriptionService } from '@codex/subscription';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  DISPUTE_EVENT_WINDOW_MS,
  DISPUTE_RECONCILE_GRACE_MS,
  DISPUTE_RECONCILE_LIMIT,
  runDisputeReconcile,
} from '../dispute-reconcile';

const NOW = new Date('2026-10-23T12:00:00Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const FINAL = ['won', 'lost', 'warning_closed', 'prevented'];
const RANK: Record<string, number> = {
  warning_needs_response: 0,
  warning_under_review: 1,
  needs_response: 2,
  under_review: 3,
  won: 4,
  lost: 4,
  warning_closed: 4,
  prevented: 4,
};

interface Row {
  stripeDisputeId: string;
  status: string;
  amountCents: number;
  outcomeAppliedAt: Date | null;
  updatedAt: Date;
}

function dispute(
  id: string,
  status: string,
  overrides: Partial<Stripe.Dispute> = {}
): Stripe.Dispute {
  return {
    id,
    object: 'dispute',
    charge: `ch_${id}`,
    payment_intent: `pi_${id}`,
    amount: 1999,
    currency: 'gbp',
    reason: 'fraudulent',
    status,
    created: seconds(NOW) - 3600,
    ...overrides,
  } as Stripe.Dispute;
}

function event(snapshot: Stripe.Dispute, id = `evt_${snapshot.id}`) {
  return {
    id,
    type: 'charge.dispute.updated',
    data: { object: snapshot },
  } as unknown as Stripe.Event;
}

/** A dispute ledger that behaves like ours: forward only, applied once. */
function ledger(
  initial: Array<Partial<Row> & Pick<Row, 'stripeDisputeId' | 'status'>> = []
) {
  const rows = new Map<string, Row>(
    initial.map((row) => [
      row.stripeDisputeId,
      {
        amountCents: 1999,
        outcomeAppliedAt: null,
        updatedAt: new Date(NOW.getTime() - 10 * 24 * 3600 * 1000),
        ...row,
      },
    ])
  );
  const markApplied = async (id: string) => {
    const row = rows.get(id);
    if (row && !row.outcomeAppliedAt) row.outcomeAppliedAt = new Date();
  };
  const purchase = {
    findDisputeRecords: vi.fn(async (ids: string[]) =>
      ids.flatMap((id) => {
        const row = rows.get(id);
        return row ? [{ ...row }] : [];
      })
    ),
    findDisputesToReconcile: vi.fn(async (limit: number, before: Date) =>
      [...rows.values()]
        .filter(
          (row) =>
            FINAL.includes(row.status) &&
            !row.outcomeAppliedAt &&
            row.updatedAt < before
        )
        .slice(0, limit)
        .map(({ stripeDisputeId, status }) => ({ stripeDisputeId, status }))
    ),
    recordDispute: vi.fn(
      async (d: {
        stripeDisputeId: string;
        status: string;
        amountCents: number;
      }) => {
        const row = rows.get(d.stripeDisputeId);
        if (!row) {
          rows.set(d.stripeDisputeId, {
            stripeDisputeId: d.stripeDisputeId,
            status: d.status,
            amountCents: d.amountCents,
            outcomeAppliedAt: null,
            updatedAt: new Date(),
          });
        } else if ((RANK[d.status] ?? -1) > (RANK[row.status] ?? -1)) {
          row.status = d.status;
          row.updatedAt = new Date();
        }
        return { ...rows.get(d.stripeDisputeId) };
      }
    ),
    markDisputeOutcomeApplied: vi.fn(markApplied),
    settleWonDispute: vi.fn(markApplied),
    processDispute: vi.fn().mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      accessEnded: true,
    }),
    clawBackPurchaseCharge: vi.fn().mockResolvedValue(undefined),
    restoreDisputedPurchase: vi
      .fn()
      .mockResolvedValue({ userId: 'user_1', orgId: 'org_1' }),
    processLostDispute: vi.fn().mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      accessEnded: true,
    }),
    countDisputeReversalSteps: vi.fn().mockResolvedValue(0),
  };
  return { rows, purchase };
}

function subscriptionStub() {
  return {
    reverseSubscriptionPayoutsForCharge: vi.fn().mockResolvedValue(undefined),
    pauseForDispute: vi.fn().mockResolvedValue(undefined),
    pauseBillingForDispute: vi.fn().mockResolvedValue(undefined),
    restoreAfterDispute: vi.fn().mockResolvedValue(undefined),
    cancelForLostDispute: vi.fn().mockResolvedValue(undefined),
  };
}

function stripeStub(
  options: {
    events?: Stripe.Event[];
    disputes?: Stripe.Dispute[];
    chargeMetadata?: Record<string, string>;
  } = {}
) {
  return {
    events: {
      list: vi.fn().mockResolvedValue({
        object: 'list',
        data: options.events ?? [],
        has_more: false,
      }),
    },
    disputes: {
      retrieve: vi.fn(async (id: string) => {
        const found = options.disputes?.find((d) => d.id === id);
        if (!found) throw new Error(`No such dispute: ${id}`);
        return found;
      }),
    },
    charges: {
      retrieve: vi.fn(async (id: string) => ({
        id,
        amount: 1999,
        payment_intent: id.replace(/^ch_/, 'pi_'),
        metadata: options.chargeMetadata ?? {},
      })),
    },
  };
}

function reconcile(parts: {
  purchase: ReturnType<typeof ledger>['purchase'];
  stripe: ReturnType<typeof stripeStub>;
  subscription?: ReturnType<typeof subscriptionStub>;
  environment?: string;
}) {
  const effects = {
    invalidateLibrary: vi.fn(),
    revokeAccess: vi.fn(),
    clearRevocation: vi.fn(),
  };
  const obs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const subscription = parts.subscription ?? subscriptionStub();
  const run = () =>
    runDisputeReconcile({
      stripe: parts.stripe as unknown as Stripe,
      purchase: parts.purchase as unknown as PurchaseService,
      subscription: subscription as unknown as SubscriptionService,
      environment: parts.environment ?? 'development',
      obs: obs as never,
      effects,
      now: NOW,
    });
  return { run, effects, obs, subscription };
}

describe('runDisputeReconcile', () => {
  it('reads the last 4 days of dispute events, leaving the last 15 minutes to the webhook', async () => {
    const { purchase } = ledger();
    const stripe = stripeStub();

    await reconcile({ purchase, stripe }).run();

    expect(stripe.events.list).toHaveBeenCalledWith({
      type: 'charge.dispute.*',
      created: {
        gte: seconds(new Date(NOW.getTime() - DISPUTE_EVENT_WINDOW_MS)),
        lte: seconds(new Date(NOW.getTime() - DISPUTE_RECONCILE_GRACE_MS)),
      },
      limit: 100,
    });
    expect(purchase.findDisputesToReconcile).toHaveBeenCalledWith(
      DISPUTE_RECONCILE_LIMIT,
      new Date(NOW.getTime() - DISPUTE_EVENT_WINDOW_MS)
    );
  });

  it('a won dispute with no row (every event missed) is recorded and re-paid', async () => {
    const { rows, purchase } = ledger();
    const stripe = stripeStub({ events: [event(dispute('dp_won', 'won'))] });
    const { run, effects } = reconcile({ purchase, stripe });

    const result = await run();

    expect(purchase.recordDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeDisputeId: 'dp_won',
        stripeChargeId: 'ch_dp_won',
        paymentIntentId: 'pi_dp_won',
        status: 'won',
      })
    );
    expect(purchase.restoreDisputedPurchase).toHaveBeenCalledWith('pi_dp_won');
    expect(purchase.settleWonDispute).toHaveBeenCalledWith('dp_won');
    expect(effects.clearRevocation).toHaveBeenCalledWith('user_1', 'org_1');
    expect(rows.get('dp_won')?.outcomeAppliedAt).toBeInstanceOf(Date);
    expect(result).toEqual({ fromEvents: 1, fromRows: 0, acted: 1, failed: 0 });
  });

  it("a chargeback with no row is recorded and acted on: access paused, paid slices clawed back, the sale's slices held", async () => {
    const { rows, purchase } = ledger();
    const stripe = stripeStub({
      events: [event(dispute('dp_open', 'needs_response'))],
    });
    const { run, effects, subscription } = reconcile({ purchase, stripe });

    await run();

    expect(rows.get('dp_open')?.status).toBe('needs_response');
    expect(purchase.processDispute).toHaveBeenCalledWith('pi_dp_open', {
      stripeDisputeId: 'dp_open',
      disputeReason: 'fraudulent',
    });
    expect(effects.revokeAccess).toHaveBeenCalledWith('user_1', 'org_1');
    expect(subscription.reverseSubscriptionPayoutsForCharge).toHaveBeenCalled();
    expect(purchase.clawBackPurchaseCharge).toHaveBeenCalled();
  });

  it('a row recorded as an open inquiry whose close was missed is released', async () => {
    const { rows, purchase } = ledger([
      { stripeDisputeId: 'dp_inq', status: 'warning_needs_response' },
    ]);
    const stripe = stripeStub({
      events: [event(dispute('dp_inq', 'warning_closed'))],
    });
    const { run, subscription } = reconcile({ purchase, stripe });

    await run();

    expect(rows.get('dp_inq')?.status).toBe('warning_closed');
    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledWith('dp_inq');
    expect(
      subscription.reverseSubscriptionPayoutsForCharge
    ).not.toHaveBeenCalled();
  });

  it('a row recorded as an open chargeback whose loss was missed is applied: refunded, held slices cut, then marked', async () => {
    const { rows, purchase } = ledger([
      { stripeDisputeId: 'dp_lost', status: 'needs_response' },
    ]);
    const stripe = stripeStub({ events: [event(dispute('dp_lost', 'lost'))] });
    const { run, subscription } = reconcile({ purchase, stripe });

    await run();

    expect(purchase.processLostDispute).toHaveBeenCalledWith(
      'pi_dp_lost',
      1999
    );
    expect(subscription.reverseSubscriptionPayoutsForCharge).toHaveBeenCalled();
    expect(purchase.clawBackPurchaseCharge).toHaveBeenCalled();
    expect(
      purchase.markDisputeOutcomeApplied.mock.invocationCallOrder[0]
    ).toBeGreaterThan(
      purchase.clawBackPurchaseCharge.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(rows.get('dp_lost')?.outcomeAppliedAt).toBeInstanceOf(Date);
  });

  it('a chargeback that is genuinely still open is never re-run, so its buyer is not blocked again', async () => {
    const { purchase } = ledger([
      { stripeDisputeId: 'dp_still', status: 'needs_response' },
    ]);
    // Stripe moved it within the stage: it is still an open chargeback.
    const stripe = stripeStub({
      events: [event(dispute('dp_still', 'under_review'))],
    });
    const { run, effects } = reconcile({ purchase, stripe });

    const result = await run();

    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(purchase.recordDispute).not.toHaveBeenCalled();
    expect(purchase.processDispute).not.toHaveBeenCalled();
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(result.acted).toBe(0);
  });

  it('a dispute whose outcome is applied is left alone', async () => {
    const { purchase } = ledger([
      {
        stripeDisputeId: 'dp_done',
        status: 'won',
        outcomeAppliedAt: new Date(NOW.getTime() - 3600_000),
      },
    ]);
    const stripe = stripeStub({ events: [event(dispute('dp_done', 'won'))] });

    await reconcile({ purchase, stripe }).run();

    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(purchase.settleWonDispute).not.toHaveBeenCalled();
  });

  it('each dispute is handled once, from its newest event', async () => {
    const { purchase } = ledger();
    // Newest first, as Stripe lists them.
    const stripe = stripeStub({
      events: [
        event(dispute('dp_twice', 'won'), 'evt_new'),
        event(dispute('dp_twice', 'needs_response'), 'evt_old'),
      ],
    });

    await reconcile({ purchase, stripe }).run();

    expect(purchase.recordDispute).toHaveBeenCalledOnce();
    expect(purchase.recordDispute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'won' })
    );
  });

  it('a lost dispute whose outcome step failed, older than the window, is applied once; a second run does nothing', async () => {
    const { rows, purchase } = ledger([
      { stripeDisputeId: 'dp_old', status: 'lost' },
    ]);
    const stripe = stripeStub({ disputes: [dispute('dp_old', 'lost')] });
    const { run } = reconcile({ purchase, stripe });

    const first = await run();

    expect(stripe.disputes.retrieve).toHaveBeenCalledWith('dp_old');
    expect(purchase.processLostDispute).toHaveBeenCalledOnce();
    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledOnce();
    expect(rows.get('dp_old')?.outcomeAppliedAt).toBeInstanceOf(Date);
    expect(first).toEqual({ fromEvents: 0, fromRows: 1, acted: 1, failed: 0 });

    const second = await run();

    expect(purchase.processLostDispute).toHaveBeenCalledOnce();
    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledOnce();
    expect(second).toEqual({ fromEvents: 0, fromRows: 0, acted: 0, failed: 0 });
  });

  it('an outcome step that keeps failing is retried every run and alerted at error with an errorId each time (owner decision 2026-10-23)', async () => {
    const { rows, purchase } = ledger([
      { stripeDisputeId: 'dp_stuck', status: 'lost' },
    ]);
    purchase.clawBackPurchaseCharge.mockRejectedValue(
      new Error('transfer reversal refused (test)')
    );
    const stripe = stripeStub({ disputes: [dispute('dp_stuck', 'lost')] });
    const { run, obs } = reconcile({ purchase, stripe });

    await run();
    await run();

    const alerts = obs.error.mock.calls.filter(([message]) =>
      String(message).includes('could not be settled by the hourly reconcile')
    );
    expect(alerts).toHaveLength(2);
    for (const [, fields] of alerts) {
      expect(fields).toMatchObject({
        errorId: expect.any(String),
        disputeId: 'dp_stuck',
        error: 'transfer reversal refused (test)',
      });
    }
    expect(alerts[0]?.[1].errorId).not.toBe(alerts[1]?.[1].errorId);
    expect(rows.get('dp_stuck')?.outcomeAppliedAt).toBeNull();
  });

  it('one dispute failing never stops the next', async () => {
    const { purchase } = ledger();
    purchase.restoreDisputedPurchase.mockRejectedValueOnce(
      new Error('database unavailable (test)')
    );
    const stripe = stripeStub({
      events: [
        event(dispute('dp_a', 'won')),
        event(dispute('dp_b', 'warning_closed')),
      ],
    });

    const result = await reconcile({ purchase, stripe }).run();

    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledWith('dp_b');
    expect(result).toEqual({ fromEvents: 2, fromRows: 0, acted: 1, failed: 1 });
  });

  it("another environment's dispute is ignored and never recorded", async () => {
    const { rows, purchase } = ledger();
    const stripe = stripeStub({
      events: [event(dispute('dp_dev', 'lost'))],
      chargeMetadata: { codex_env: 'development' },
    });

    const result = await reconcile({
      purchase,
      stripe,
      environment: 'production',
    }).run();

    expect(stripe.charges.retrieve).toHaveBeenCalledWith('ch_dp_dev');
    expect(purchase.recordDispute).not.toHaveBeenCalled();
    expect(purchase.processLostDispute).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
    expect(result.acted).toBe(0);
  });

  it('a won dispute whose re-pay rejects (the re-run clawback failed) is alerted, left unapplied, and settled by the next run', async () => {
    const { rows, purchase } = ledger([
      { stripeDisputeId: 'dp_repay', status: 'won' },
    ]);
    // `repayDispute` rejects with the clawback's error; `settleWonDispute`
    // marks the outcome only after it succeeds.
    purchase.settleWonDispute.mockRejectedValueOnce(
      new Error('clawback after re-pay failed (test)')
    );
    const stripe = stripeStub({ disputes: [dispute('dp_repay', 'won')] });
    const { run, obs } = reconcile({ purchase, stripe });

    const first = await run();

    expect(first).toMatchObject({ acted: 0, failed: 1 });
    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining('could not be settled by the hourly reconcile'),
      expect.objectContaining({
        errorId: expect.any(String),
        disputeId: 'dp_repay',
        error: 'clawback after re-pay failed (test)',
      })
    );
    expect(rows.get('dp_repay')?.outcomeAppliedAt).toBeNull();

    const second = await run();

    expect(second).toMatchObject({ acted: 1, failed: 0 });
    expect(purchase.settleWonDispute).toHaveBeenCalledTimes(2);
    expect(rows.get('dp_repay')?.outcomeAppliedAt).toBeInstanceOf(Date);
  });

  it("a failure reading Stripe's events is alerted, and our unapplied rows are still retried", async () => {
    const { purchase } = ledger([
      { stripeDisputeId: 'dp_row', status: 'warning_closed' },
    ]);
    const stripe = stripeStub({
      disputes: [dispute('dp_row', 'warning_closed')],
    });
    stripe.events.list.mockRejectedValueOnce(new Error('Stripe down (test)'));
    const { run, obs } = reconcile({ purchase, stripe });

    await expect(run()).resolves.toMatchObject({ acted: 1 });

    expect(obs.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read Stripe's dispute events"),
      expect.objectContaining({ errorId: expect.any(String) })
    );
    expect(purchase.markDisputeOutcomeApplied).toHaveBeenCalledWith('dp_row');
  });
});
