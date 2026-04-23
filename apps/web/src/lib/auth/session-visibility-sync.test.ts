import { describe, expect, it } from 'vitest';
import { decideAuthRevalidation } from './session-visibility-sync';

const BASE = {
  visibilityState: 'visible' as const,
  nowHasCookie: true,
  lastHadCookie: true,
  hasUser: true,
  nowMs: 1_000_000,
  lastRecheckMs: 0,
  cooldownMs: 60_000,
};

describe('decideAuthRevalidation', () => {
  it('skips when the tab is not visible', () => {
    expect(
      decideAuthRevalidation({ ...BASE, visibilityState: 'hidden' })
    ).toEqual({ action: 'none' });
    expect(
      decideAuthRevalidation({ ...BASE, visibilityState: 'prerender' })
    ).toEqual({ action: 'none' });
  });

  it('invalidates on cookie appeared (same-device login on other tab/subdomain)', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        lastHadCookie: false,
        nowHasCookie: true,
        hasUser: false,
      })
    ).toEqual({ action: 'invalidate', reason: 'cookie-diff' });
  });

  it('invalidates on cookie disappeared (same-device logout)', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        lastHadCookie: true,
        nowHasCookie: false,
        hasUser: true,
      })
    ).toEqual({ action: 'invalidate', reason: 'cookie-diff' });
  });

  it('skips when authenticated and cookie unchanged (no-op)', () => {
    expect(decideAuthRevalidation({ ...BASE, hasUser: true })).toEqual({
      action: 'none',
    });
  });

  it('skips unauthenticated re-check when cooldown has not elapsed', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        hasUser: false,
        nowMs: 30_000,
        lastRecheckMs: 10_000,
        cooldownMs: 60_000,
      })
    ).toEqual({ action: 'none' });
  });

  it('invalidates unauthenticated re-check when cooldown has elapsed', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        hasUser: false,
        nowMs: 75_000,
        lastRecheckMs: 10_000,
        cooldownMs: 60_000,
      })
    ).toEqual({ action: 'invalidate', reason: 'unauthenticated-recheck' });
  });

  it('invalidates on first unauthenticated visibility-return (lastRecheckMs = 0)', () => {
    // Real-world Date.now() returns ~1.7e12 — the cooldown check is
    // trivially satisfied on first call from any browser event loop.
    expect(
      decideAuthRevalidation({
        ...BASE,
        hasUser: false,
        nowMs: Date.now(),
        lastRecheckMs: 0,
        cooldownMs: 60_000,
      })
    ).toEqual({ action: 'invalidate', reason: 'unauthenticated-recheck' });
  });

  it('skips unauthenticated re-check exactly at the cooldown boundary minus one', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        hasUser: false,
        nowMs: 59_999,
        lastRecheckMs: 0,
        cooldownMs: 60_000,
      })
    ).toEqual({ action: 'none' });
  });

  it('invalidates at the cooldown boundary exactly', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        hasUser: false,
        nowMs: 60_000,
        lastRecheckMs: 0,
        cooldownMs: 60_000,
      })
    ).toEqual({ action: 'invalidate', reason: 'unauthenticated-recheck' });
  });

  it('cookie-diff wins over cooldown when both trigger (diff path is unthrottled)', () => {
    expect(
      decideAuthRevalidation({
        ...BASE,
        lastHadCookie: false,
        nowHasCookie: true,
        hasUser: false,
        nowMs: 10_000,
        lastRecheckMs: 9_000,
        cooldownMs: 60_000,
      })
    ).toEqual({ action: 'invalidate', reason: 'cookie-diff' });
  });
});
