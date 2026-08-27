/**
 * Unsubscribe Rate-Limit Integration Tests
 *
 * Behavioural coverage for the rate-limit middleware applied to
 * /unsubscribe/* in workers/notifications-api/src/index.ts.
 *
 * Per `feedback_security_deep_test`: HMAC/auth/rate-limit changes MUST have
 * unit + integration tests for BOTH positive and negative paths.
 *
 * Background (Codex-ttavz.8 / denoise iter-002 F2): the unsubscribe routes
 * bypass procedure() because they use HMAC token verification, not session
 * auth. Without app-level rate limiting, anyone with a leaked token URL (or
 * none at all) can replay /unsubscribe/<random> as fast as TCP allows — each
 * request pays an HMAC verify cost and the POST mutates
 * `notification_preferences`.
 *
 * ## What changed, and why these assertions changed with it (Codex-kgrdp.17)
 *
 * The limiter used to count in KV, keyed on `${cf-connecting-ip}:${pathname}`,
 * and emitted `X-RateLimit-*` on every response. Two things are now different,
 * and both are deliberate:
 *
 *  1. Counting moved to Cloudflare's native Workers Rate Limiting binding,
 *     whose `limit()` returns `{ success }` alone. Remaining and reset are
 *     genuinely unknowable, so `X-RateLimit-*` are NOT emitted rather than
 *     guessed. The witness that the middleware ran is therefore the 429 at the
 *     budget edge, not a header.
 *  2. The key is no longer the transport address alone. apps/web proxies BOTH
 *     unsubscribe hops server-side, so the address arriving here is a
 *     Cloudflare egress address and `trustedIpSubject()` correctly withholds
 *     it — an IP-only key would have been null on every real unsubscribe. The
 *     primary subject is now the token in the path, with the address as a
 *     second signal where it can be believed. `combineSubjects` blocks if
 *     EITHER bucket is exhausted, which is what the isolation tests below
 *     assert: isolation holds only when BOTH signals differ.
 *
 * The route handler returns 200 (with valid:false for bad tokens) because
 * WORKER_SHARED_SECRET is not bound in the test env — but the middleware runs
 * BEFORE the handler, so the gate works regardless of token validity. We
 * assert on status, never on body shape.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// RATE_LIMIT_PRESETS.api = 100 requests per 60s.
const BUDGET = 100;

/**
 * Hit the unsubscribe endpoint. Each call charges the token bucket for `path`
 * and the address bucket for `ip`.
 */
async function hit(
  path: string,
  ip: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await SELF.fetch(`http://localhost${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), 'cf-connecting-ip': ip },
  });
  // Drain so the stream is freed even when the caller only reads status.
  await res.text();
  return res;
}

/** Spend the whole budget on one (path, ip) pair. */
async function burnBudget(path: string, ip: string): Promise<void> {
  for (let i = 0; i < BUDGET; i++) {
    const res = await hit(path, ip);
    // Sanity: while still under budget, never 429.
    expect(res.status).not.toBe(429);
  }
}

describe('unsubscribe rate-limit middleware (Codex-ttavz.8 / kgrdp.17)', () => {
  it('binds the RATE_LIMIT_API namespace, so the limiter is not a silent fail-open', () => {
    // Without the binding, rateLimit() fails OPEN — it logs
    // `rate_limit.fail_open` at error level and lets every request through.
    // A missing binding would make every other test in this file pass
    // vacuously, so this guard comes first.
    expect(env.RATE_LIMIT_API).toBeDefined();
  });

  it('stays below budget without 429 (positive path)', async () => {
    const res = await hit('/unsubscribe/positive-path-token', '203.0.113.10');
    expect(res.status).not.toBe(429);
  });

  it('does NOT emit X-RateLimit-* — the native binding cannot know them', async () => {
    // Asserted rather than merely absent from the positive test: guessing
    // these values would tell a client something the store never reported.
    const res = await hit('/unsubscribe/headers-token', '203.0.113.11');
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(res.headers.get('X-RateLimit-Reset')).toBeNull();
  });

  it('returns 429 with Retry-After once the budget is exceeded (negative path)', async () => {
    const path = '/unsubscribe/exhaust-budget-token';
    const ip = '203.0.113.20';

    await burnBudget(path, ip);

    const overBudget = await hit(path, ip);
    expect(overBudget.status).toBe(429);
    expect(overBudget.headers.get('Retry-After')).not.toBeNull();
  });

  it('keeps separate budgets per token: a fresh token AND a fresh address pass', async () => {
    const ip = '203.0.113.30';
    await burnBudget('/unsubscribe/token-isolation-a', ip);
    expect((await hit('/unsubscribe/token-isolation-a', ip)).status).toBe(429);

    // Both signals must differ. The address bucket for .30 is spent too, so a
    // fresh token on the SAME address is still blocked — that is
    // combineSubjects working, not a keying bug.
    expect((await hit('/unsubscribe/token-isolation-b', ip)).status).toBe(429);

    // Fresh token + fresh address → both buckets fresh → allowed.
    const allowed = await hit('/unsubscribe/token-isolation-b', '203.0.113.31');
    expect(allowed.status).not.toBe(429);
  });

  it('the token bucket blocks even from an untouched address', async () => {
    // The inverse of the case above, and the one that matters for the DB
    // write-amplification threat: replaying ONE valid token is capped no
    // matter how many addresses the replay comes from.
    const path = '/unsubscribe/token-bucket-token';
    await burnBudget(path, '203.0.113.40');
    expect((await hit(path, '203.0.113.40')).status).toBe(429);

    const otherAddress = await hit(path, '203.0.113.41');
    expect(otherAddress.status).toBe(429);
  });

  // `/health` composes `standardDatabaseCheck`, so every probe is a real Neon
  // round trip (~3s in CI). Four of them serially blows the 5s default, which
  // is a property of the health check, not of the limiter — so the repeats run
  // concurrently and the test carries an explicit allowance.
  it('does NOT charge the unsubscribe budget for unrelated routes (/health)', async () => {
    const res = await SELF.fetch('http://localhost/health');
    // Health may return 200 or 503 depending on DB availability.
    expect([200, 503]).toContain(res.status);
    await res.text();

    const repeats = await Promise.all(
      [0, 1, 2].map(() => SELF.fetch('http://localhost/health'))
    );
    for (const r of repeats) {
      expect(r.status).not.toBe(429);
      await r.text();
    }
  }, 30_000);
});
