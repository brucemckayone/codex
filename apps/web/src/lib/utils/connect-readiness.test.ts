import { describe, expect, it } from 'vitest';
import {
  type ConnectReadinessStatus,
  isConnectReady,
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
