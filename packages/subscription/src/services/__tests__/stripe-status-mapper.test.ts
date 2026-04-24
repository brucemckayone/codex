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
    // so callers can pass the prior status with their eyes open.
    expect(resolveStatus('trialing', false, SUBSCRIPTION_STATUS.PAUSED)).toBe(
      SUBSCRIPTION_STATUS.PAUSED
    );
    expect(
      resolveStatus('incomplete_expired', false, SUBSCRIPTION_STATUS.ACTIVE)
    ).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(resolveStatus('unpaid', false, SUBSCRIPTION_STATUS.ACTIVE)).toBe(
      SUBSCRIPTION_STATUS.ACTIVE
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
    });
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
