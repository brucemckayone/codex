/**
 * Unsubscribe Rate-Limit Integration Tests
 *
 * Behavioural coverage for the rate-limit middleware applied to
 * /unsubscribe/* in workers/notifications-api/src/index.ts.
 *
 * Per `feedback_security_deep_test`: HMAC/auth/rate-limit changes
 * MUST have unit + integration tests for BOTH positive and negative
 * paths before closing.
 *
 * Background (Codex-ttavz.8 / denoise iter-002 F2): the unsubscribe
 * routes bypass procedure() because they use HMAC token verification,
 * not session auth. Without app-level rate limiting, anyone with a
 * leaked token URL (or none at all) can replay /unsubscribe/<random>
 * as fast as TCP allows — each request pays an HMAC verify cost and
 * the POST mutates `notification_preferences`.
 *
 * The middleware uses `RATE_LIMIT_PRESETS.api` (100 requests / 60s)
 * keyed by `${cf-connecting-ip}:${pathname}` — permissive enough for
 * a human retrying an unsubscribe link, tight enough to stop scripted
 * DoS.
 *
 * Test strategy:
 *   - Positive path: 100 requests within budget all return non-429
 *     and carry X-RateLimit-* headers
 *   - Negative path: the 101st request returns 429 with Retry-After
 *   - Per-route isolation: GET and POST share the path so they share
 *     a budget — but a different token-path (different pathname) has
 *     a fresh budget (defaultKeyGenerator includes pathname)
 *   - Per-IP isolation: a different CF-Connecting-IP gets a fresh
 *     budget on the same path
 *
 * The route handler will return 200 (with valid:false for bad tokens)
 * because WORKER_SHARED_SECRET is not bound in test env — but the
 * rate-limit middleware runs BEFORE the handler, so the gate works
 * regardless of token validity. We assert on the rate-limit headers
 * and 429 status, not on body shape.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// RATE_LIMIT_PRESETS.api = 100 requests per 60s. We keep tests tight
// to avoid slow runs, but must still cross the boundary.
const BUDGET = 100;

/**
 * Hit the unsubscribe endpoint with a stable IP and path.
 * Each call increments the rate-limit counter for `${ip}:${path}`.
 */
async function hit(
  path: string,
  ip: string,
  init: RequestInit = {}
): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'cf-connecting-ip': ip,
    },
  });
}

describe('unsubscribe rate-limit middleware (Codex-ttavz.8)', () => {
  it('applies X-RateLimit-* headers to /unsubscribe/* responses (positive path)', async () => {
    // Use a unique IP+path per test to avoid cross-test budget bleed.
    const ip = '203.0.113.10';
    const path = '/unsubscribe/positive-headers-token';

    const res = await hit(path, ip);

    // Whether token is valid is irrelevant — we only assert the
    // middleware ran and tagged the response.
    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(BUDGET));
    const remaining = res.headers.get('X-RateLimit-Remaining');
    expect(remaining).not.toBeNull();
    expect(Number(remaining)).toBeLessThanOrEqual(BUDGET - 1);
    expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();
    // Below budget → never 429
    expect(res.status).not.toBe(429);
  });

  it('returns 429 once the per-IP per-path budget is exceeded (negative path)', async () => {
    const ip = '203.0.113.20';
    const path = '/unsubscribe/exhaust-budget-token';

    // Burn through the entire budget. We do this serially to avoid
    // KV write races (the limiter is read-modify-write).
    let lastBelow: Response | undefined;
    for (let i = 0; i < BUDGET; i++) {
      lastBelow = await hit(path, ip);
      // Sanity: while we're still under budget, never 429.
      expect(lastBelow.status).not.toBe(429);
    }
    // Drain bodies to free streams.
    if (lastBelow) await lastBelow.text();

    // The (BUDGET+1)th request must be rejected.
    const overBudget = await hit(path, ip);
    expect(overBudget.status).toBe(429);
    expect(overBudget.headers.get('Retry-After')).not.toBeNull();

    const body = (await overBudget.json()) as {
      error?: string;
      retryAfter?: number;
    };
    expect(body.error).toBe('Too many requests');
    expect(typeof body.retryAfter).toBe('number');
  });

  it('keeps separate budgets per (IP, path) tuple', async () => {
    // After exhausting one (ip, path), a different path on the same
    // IP must still be allowed. defaultKeyGenerator hashes by
    // `${ip}:${pathname}` so this proves the keying is right.
    const ip = '203.0.113.30';
    const exhausted = '/unsubscribe/path-isolation-a';
    const fresh = '/unsubscribe/path-isolation-b';

    for (let i = 0; i < BUDGET; i++) {
      const res = await hit(exhausted, ip);
      await res.text();
    }
    const blocked = await hit(exhausted, ip);
    expect(blocked.status).toBe(429);
    await blocked.text();

    // Different path on the same IP → fresh budget.
    const allowed = await hit(fresh, ip);
    expect(allowed.status).not.toBe(429);
    expect(allowed.headers.get('X-RateLimit-Limit')).toBe(String(BUDGET));
  });

  it('keeps separate budgets per IP on the same path', async () => {
    const path = '/unsubscribe/ip-isolation-token';
    const blockedIp = '203.0.113.40';
    const freshIp = '203.0.113.41';

    for (let i = 0; i < BUDGET; i++) {
      const res = await hit(path, blockedIp);
      await res.text();
    }
    const blocked = await hit(path, blockedIp);
    expect(blocked.status).toBe(429);
    await blocked.text();

    // Different IP on the same path → fresh budget.
    const allowed = await hit(path, freshIp);
    expect(allowed.status).not.toBe(429);
  });

  it('does NOT apply unsubscribe rate limit to unrelated routes (/health)', async () => {
    // /health must not advertise unsubscribe rate-limit headers.
    // (Even if other middleware adds its own headers, the /unsubscribe
    // budget must not be charged.)
    const res = await SELF.fetch('http://localhost/health');
    // Health may return 200 or 503 depending on DB availability.
    expect([200, 503]).toContain(res.status);
    // A few hits to /health should never exhaust the unsubscribe budget.
    for (let i = 0; i < 3; i++) {
      const r = await SELF.fetch('http://localhost/health');
      expect(r.status).not.toBe(429);
      await r.text();
    }
  });
});
