/**
 * Rate-limit behaviour tests for ecom-api mutation routes (Codex-agvv).
 *
 * The hard-coded preset choices on individual endpoints are compile-time
 * constants in the route files — if someone removes `rateLimit: 'strict'`
 * on `/subscriptions/cancel`/`/subscriptions/reactivate`, typecheck won't
 * catch it. So this file verifies:
 *
 *   1. The presets exported from `@codex/security` still cap at their
 *      intended values (positive: 20/min for 'strict', 100/min for 'api').
 *   2. Behavioural: the rate limiter actually rejects the 21st request
 *      inside a single window (negative — enforces the cap, not just
 *      exposes the numbers).
 *
 * A full integration test that runs the ecom-api worker with a real
 * session cookie + KV counter against `/subscriptions/cancel` would be
 * higher-fidelity but is heavier than this configuration guard warrants.
 * The route handlers themselves are reviewed during PR — these assertions
 * are a safety net on the shared preset contract.
 */

import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

describe('ecom-api rate-limit presets (Codex-agvv)', () => {
  it("'strict' preset is 20 req / minute", () => {
    expect(RATE_LIMIT_PRESETS.strict.maxRequests).toBe(20);
    expect(RATE_LIMIT_PRESETS.strict.windowMs).toBe(60_000);
  });

  it("'api' preset is 100 req / minute", () => {
    expect(RATE_LIMIT_PRESETS.api.maxRequests).toBe(100);
    expect(RATE_LIMIT_PRESETS.api.windowMs).toBe(60_000);
  });

  it("rate limiter rejects the 21st 'strict' request within a single window", async () => {
    // Create the middleware *once* so the in-memory store persists across
    // requests. The `rateLimit()` factory news up a single InMemoryStore
    // when kv is undefined, so we must reuse that factory result.
    const mw = rateLimit({
      kv: undefined,
      ...RATE_LIMIT_PRESETS.strict,
    });
    const app = new Hono();
    app.use('*', mw);
    app.post('/go', (c) => c.text('OK'));

    const headers = { 'CF-Connecting-IP': '10.0.0.42' };
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await app.request(
        new Request('http://localhost/go', { method: 'POST', headers })
      );
      statuses.push(res.status);
    }

    // Positive: first 20 succeed.
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    // Negative: 21st is 429.
    expect(statuses[20]).toBe(429);
  });
});
