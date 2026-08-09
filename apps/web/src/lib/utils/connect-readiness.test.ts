import { describe, expect, it } from 'vitest';
import {
  type ConnectReadinessStatus,
  isConnectReady,
  moneyReadiness,
} from './connect-readiness';

/** Fully-ready account; each test flips exactly one field to prove it gates. */
function ready(
  overrides: Partial<ConnectReadinessStatus> = {}
): ConnectReadinessStatus {
  return {
    isConnected: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    status: 'active',
    ...overrides,
  };
}

describe('isConnectReady', () => {
  it('is true only when connected, charges + payouts enabled, and status active', () => {
    expect(isConnectReady(ready())).toBe(true);
  });

  it('is false when not connected', () => {
    expect(isConnectReady(ready({ isConnected: false }))).toBe(false);
  });

  it('is false when charges are disabled (mirrors backend requireActiveConnect)', () => {
    expect(isConnectReady(ready({ chargesEnabled: false }))).toBe(false);
  });

  it('is false when payouts are disabled (mirrors backend requireActiveConnect)', () => {
    expect(isConnectReady(ready({ payoutsEnabled: false }))).toBe(false);
  });

  it('is false for a non-active status even when charges + payouts are enabled', () => {
    for (const status of ['onboarding', 'restricted', 'disabled', null]) {
      expect(isConnectReady(ready({ status }))).toBe(false);
    }
  });

  it('is false for the default not-connected account shape', () => {
    expect(
      isConnectReady({
        isConnected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        status: null,
      })
    ).toBe(false);
  });
});

describe('moneyReadiness', () => {
  const populated = { hasTiers: true, subscriberCount: 3 };
  const bare = { hasTiers: false, subscriberCount: 0 };

  it('reports ready only when Stripe is live and there are tiers and subscribers', () => {
    const r = moneyReadiness(ready(), populated);
    expect(r.state).toBe('ready');
    expect(r.blocking).toBe(false);
    expect(r.hasSubscribers).toBe(true);
  });

  it('resolves every stripe_* state BEFORE no_tiers', () => {
    // The ordering bug this guards: an org with neither Stripe nor tiers must
    // be told to connect Stripe, not to "add a tier" behind a disabled button.
    expect(moneyReadiness(ready({ isConnected: false }), bare).state).toBe(
      'stripe_missing'
    );
    expect(moneyReadiness(ready({ status: 'disabled' }), bare).state).toBe(
      'stripe_disabled'
    );
    expect(moneyReadiness(ready({ status: 'restricted' }), bare).state).toBe(
      'stripe_restricted'
    );
    expect(moneyReadiness(ready({ status: 'onboarding' }), bare).state).toBe(
      'stripe_incomplete'
    );
  });

  it('does not let a disabled account fall through to not-connected', () => {
    // `isConnected` stays true for a disabled account, so the naive check
    // rendered a neutral "Not connected" badge beside a "Continue Setup" button.
    const r = moneyReadiness(ready({ status: 'disabled' }), populated);
    expect(r.state).toBe('stripe_disabled');
    expect(r.tone).toBe('error');
    expect(r.blocking).toBe(true);
  });

  it('treats charges-off and payouts-off as incomplete, matching the backend gate', () => {
    expect(
      moneyReadiness(ready({ chargesEnabled: false }), populated).state
    ).toBe('stripe_incomplete');
    expect(
      moneyReadiness(ready({ payoutsEnabled: false }), populated).state
    ).toBe('stripe_incomplete');
  });

  it('surfaces an unverified status instead of an implied all-clear', () => {
    const r = moneyReadiness(
      ready({ requirementsFetchFailed: true }),
      populated
    );
    expect(r.state).toBe('stripe_unknown');
    expect(r.tone).toBe('info');
  });

  it('does NOT mark an unverified-but-active account as blocking', () => {
    // of-blood-and-bones: status active, charges + payouts enabled, but its
    // seeded acct_local_dev_obab cannot be verified against the real Stripe API
    // so `requirementsFetchFailed` is true. Treating that as blocking told a
    // fully-working org to "set up payments before you can be paid".
    const r = moneyReadiness(
      ready({ requirementsFetchFailed: true }),
      populated
    );
    expect(r.blocking).toBe(false);
  });

  it('ranks a known hard block above an unverified one', () => {
    const r = moneyReadiness(
      ready({ status: 'restricted', requirementsFetchFailed: true }),
      populated
    );
    expect(r.state).toBe('stripe_restricted');
  });

  it('carries hasSubscribers so a blocked org with real payers gets its own copy', () => {
    // studio-alpha today: two active subscriptions, zero Connect rows.
    const r = moneyReadiness(ready({ isConnected: false }), {
      hasTiers: true,
      subscriberCount: 2,
    });
    expect(r.state).toBe('stripe_missing');
    expect(r.hasSubscribers).toBe(true);
    expect(r.blocking).toBe(true);
  });

  it('falls to no_tiers then no_subscribers once Stripe is live', () => {
    expect(moneyReadiness(ready(), bare).state).toBe('no_tiers');
    expect(
      moneyReadiness(ready(), { hasTiers: true, subscriberCount: 0 }).state
    ).toBe('no_subscribers');
  });

  it('marks exactly the four money-cannot-move states as blocking', () => {
    for (const status of ['onboarding', 'restricted', 'disabled']) {
      expect(moneyReadiness(ready({ status }), populated).blocking).toBe(true);
    }
    expect(
      moneyReadiness(ready({ isConnected: false }), populated).blocking
    ).toBe(true);
    // Not blocking: unverified, nothing to sell, nobody buying, all good.
    expect(
      moneyReadiness(ready({ requirementsFetchFailed: true }), populated)
        .blocking
    ).toBe(false);
    expect(moneyReadiness(ready(), bare).blocking).toBe(false);
    expect(
      moneyReadiness(ready(), { hasTiers: true, subscriberCount: 0 }).blocking
    ).toBe(false);
    expect(moneyReadiness(ready(), populated).blocking).toBe(false);
  });
});
