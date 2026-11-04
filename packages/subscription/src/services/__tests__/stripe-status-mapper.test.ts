import { SUBSCRIPTION_STATUS } from '@codex/constants';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  mapStripeSubscriptionStatus,
  resolveStatus,
} from '../stripe-status-mapper';

function makeSubscription(
  overrides: Partial<Stripe.Subscription> = {},
  itemOverrides: {
    interval?: 'month' | 'year' | 'day' | 'week';
    unit_amount?: number | null;
    period_start?: number;
    period_end?: number;
  } = {}
): Stripe.Subscription {
  return {
    id: 'sub_test',
    status: 'active',
    cancel_at_period_end: false,
    metadata: {},
    items: {
      data: [
        {
          current_period_start: itemOverrides.period_start ?? 1_700_000_000,
          current_period_end: itemOverrides.period_end ?? 1_702_000_000,
          price: {
            unit_amount: itemOverrides.unit_amount ?? 999,
            recurring: {
              interval: itemOverrides.interval ?? 'month',
            },
          },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('resolveStatus', () => {
  it('maps active + cancel_at_period_end=false → ACTIVE', () => {
    expect(resolveStatus('active', false, SUBSCRIPTION_STATUS.CANCELLED)).toBe(
      SUBSCRIPTION_STATUS.ACTIVE
    );
  });

  it('maps active + cancel_at_period_end=true → CANCELLING', () => {
    // Stripe keeps reporting 'active' for the remainder of a paid period
    // after cancellation — the cancel_at_period_end flag is the only way
    // to distinguish it from a genuine active subscription.
    expect(resolveStatus('active', true, SUBSCRIPTION_STATUS.CANCELLED)).toBe(
      SUBSCRIPTION_STATUS.CANCELLING
    );
  });

  it('maps past_due → PAST_DUE regardless of cancel_at_period_end', () => {
    expect(resolveStatus('past_due', false, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.PAST_DUE
    );
    expect(resolveStatus('past_due', true, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.PAST_DUE
    );
  });

  it('maps canceled → CANCELLED', () => {
    expect(resolveStatus('canceled', false, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.CANCELLED
    );
  });

  // Codex-2hxff.10: past_due grants access, so an `unpaid` subscription (Stripe
  // gave up retrying) left past_due would keep access for ever.
  it('maps incomplete_expired (a first payment never completed) → CANCELLED', () => {
    expect(
      resolveStatus('incomplete_expired', false, SUBSCRIPTION_STATUS.ACTIVE)
    ).toBe(SUBSCRIPTION_STATUS.CANCELLED);
  });

  it('maps unpaid → CANCELLED, whatever the prior status', () => {
    expect(resolveStatus('unpaid', false, SUBSCRIPTION_STATUS.PAST_DUE)).toBe(
      SUBSCRIPTION_STATUS.CANCELLED
    );
    expect(resolveStatus('unpaid', true, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.CANCELLED
    );
  });

  it('maps incomplete → INCOMPLETE', () => {
    expect(resolveStatus('incomplete', false, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.INCOMPLETE
    );
  });

  it('maps paused → PAUSED', () => {
    expect(resolveStatus('paused', false, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.PAUSED
    );
  });

  it('returns fallback for unmapped Stripe statuses (V2 regression)', () => {
    // The pre-audit handler fell through to `let status = sub.status`
    // silently — meaning `trialing`, `unpaid`, `incomplete_expired` all
    // left the DB status stale. The mapper returns the explicit fallback
    // so callers can pass the prior status with their eyes open. (`unpaid`
    // and `incomplete_expired` are now mapped — see above.)
    expect(resolveStatus('trialing', false, SUBSCRIPTION_STATUS.PAUSED)).toBe(
      SUBSCRIPTION_STATUS.PAUSED
    );
  });
});

describe('mapStripeSubscriptionStatus', () => {
  it('extracts every Stripe field the subscriptions row mirrors', () => {
    const sub = makeSubscription(
      {
        cancel_at_period_end: true,
        metadata: { codex_tier_id: 'tier-42' },
      },
      { interval: 'year', unit_amount: 9990 }
    );

    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);

    expect(mapped).toEqual({
      status: SUBSCRIPTION_STATUS.CANCELLING,
      cancelAtPeriodEnd: true,
      billingInterval: 'year',
      amountCents: 9990,
      tierId: 'tier-42',
      currentPeriodStart: new Date(1_700_000_000 * 1000),
      currentPeriodEnd: new Date(1_702_000_000 * 1000),
      pendingTierId: null,
      pendingTierFrom: null,
      heldAmountCents: null,
      pendingBillingInterval: null,
      pendingAmountCents: null,
      stripeScheduleId: null,
    });
  });

  // ─── A waiting move to a cheaper tier (Codex-2hxff.16, §2.1) ───────────

  const TARGET_TIER = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

  it('mirrors a waiting move from codex_move_* / codex_hold_*, keeping the current tier', () => {
    const sub = makeSubscription(
      {
        metadata: {
          codex_tier_id: 'tier-pro',
          codex_move_tier_id: TARGET_TIER,
          codex_move_at: '1702000000',
          codex_hold_price_id: 'price_pro_monthly',
          codex_hold_amount: '1200',
        },
      },
      { unit_amount: 500 }
    );

    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);

    // Access keeps the current tier; the item already bills the target.
    expect(mapped.tierId).toBe('tier-pro');
    expect(mapped.amountCents).toBe(500);
    expect(mapped.pendingTierId).toBe(TARGET_TIER);
    expect(mapped.pendingTierFrom).toEqual(new Date(1_702_000_000 * 1000));
    expect(mapped.heldAmountCents).toBe(1200);
  });

  it.each([
    ['no hold amount', { codex_hold_amount: '' }],
    ['no move date', { codex_move_at: '' }],
    ['no held Price', { codex_hold_price_id: '' }],
    ['a target that is not a tier id', { codex_move_tier_id: 'tier-basic' }],
    ['an unreadable date', { codex_move_at: 'soon' }],
  ])('reads half a move (%s) as none: all three columns null', (_, broken) => {
    const sub = makeSubscription({
      metadata: {
        codex_tier_id: 'tier-pro',
        codex_move_tier_id: TARGET_TIER,
        codex_move_at: '1702000000',
        codex_hold_price_id: 'price_pro_monthly',
        codex_hold_amount: '1200',
        ...broken,
      },
    });

    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);

    expect([
      mapped.pendingTierId,
      mapped.pendingTierFrom,
      mapped.heldAmountCents,
    ]).toEqual([null, null, null]);
  });

  // ─── A waiting change of billing (Codex-2hxff.97, §2.1, §4.4) ──────────

  const SWITCHING = {
    codex_tier_id: 'tier-pro',
    codex_move_tier_id: TARGET_TIER,
    codex_move_at: '1702000000',
    codex_hold_price_id: 'price_pro_yearly',
    codex_hold_amount: '12000',
    codex_move_interval: 'month',
    codex_move_price_id: 'price_basic_monthly',
    codex_move_amount: '500',
  };

  it('mirrors a waiting change of billing and its schedule; the yearly price stays the amount', () => {
    const sub = makeSubscription(
      { metadata: SWITCHING, schedule: 'sub_sched_1' },
      { interval: 'year', unit_amount: 12000 }
    );

    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);

    expect(mapped).toMatchObject({
      billingInterval: 'year',
      amountCents: 12000,
      pendingTierId: TARGET_TIER,
      heldAmountCents: 12000,
      pendingBillingInterval: 'month',
      pendingAmountCents: 500,
      stripeScheduleId: 'sub_sched_1',
    });
  });

  it('a change of billing whose item is already monthly has landed: not mirrored as waiting (the CHECK)', () => {
    // Phase 2's metadata missed: the record is still there, the Price moved.
    const sub = makeSubscription(
      { metadata: SWITCHING },
      { interval: 'month', unit_amount: 500 }
    );

    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);

    expect([
      mapped.pendingTierId,
      mapped.pendingBillingInterval,
      mapped.pendingAmountCents,
    ]).toEqual([null, null, null]);
    expect(mapped.billingInterval).toBe('month');
  });

  it('returns billingInterval null for non-mapped Stripe intervals (day/week)', () => {
    // Stripe supports day/week for unusual billing setups. Codex only
    // understands month/year; anything else returns null so callers can
    // refuse to write rather than corrupt the column.
    const sub = makeSubscription({}, { interval: 'week' });
    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapped.billingInterval).toBeNull();
  });

  it('returns null for tierId when metadata is missing', () => {
    const sub = makeSubscription({ metadata: {} });
    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapped.tierId).toBeNull();
  });

  it('returns null period dates when Stripe reports 0 (unset)', () => {
    const sub = makeSubscription({}, { period_start: 0, period_end: 0 });
    const mapped = mapStripeSubscriptionStatus(sub, SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapped.currentPeriodStart).toBeNull();
    expect(mapped.currentPeriodEnd).toBeNull();
  });
});
