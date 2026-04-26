/**
 * Denoise iter-002 F2 — Public unsubscribe endpoint has no rate limit.
 *
 * Fingerprint: security:public-route-no-ratelimit
 * Severity: major
 * File:Line: workers/notifications-api/src/routes/unsubscribe.ts:22,46
 * Also: workers/notifications-api/src/index.ts (no app-level
 * `app.use('/unsubscribe/*', rateLimit(...))` wiring)
 *
 * Proof shape: Catalogue row 11 — "API regression with no test infra:
 * Snapshot the route map; any drift fails." Adapted: structurally
 * assert that the notifications-api app's middleware stack contains
 * a rate limiter for `/unsubscribe/*`.
 *
 * Originally this proof read the index.ts source via `node:fs` to
 * grep for the wiring. That style does NOT work in the workers pool
 * (workerd sandboxes the host filesystem) — confirmed by the cousin
 * file at workers/content-api/src/__denoise_proofs__/iter-005/F2-*
 * which moved its filesystem-grep guard into the node pool for the
 * same reason. So this proof now does the equivalent assertion via
 * runtime behaviour: hit the worker through SELF.fetch and verify
 * the X-RateLimit-* headers are emitted on /unsubscribe/* responses.
 * If the middleware is removed or detached, those headers disappear
 * and this test fails.
 *
 * Failure mode this test catches: anyone with a leaked unsubscribe
 * token URL can replay it as fast as TCP allows. The HMAC verify
 * cost is non-trivial and the POST mutates DB state (idempotently,
 * but still — write amplification). Without the rate limit:
 *   - DoS by flooding /unsubscribe/<random> tokens (HMAC verify
 *     cycles per request)
 *   - Token-format enumeration (timing on validity vs invalidity)
 *   - DB write amplification on the hot table
 *     `notification_preferences` if a token is replayed
 *
 * Compare against the auth worker which applies
 * `RATE_LIMIT_PRESETS.auth` (5/15min) on its public endpoints and
 * the ecom-api worker which applies `webhook` (1000/min) on
 * `/webhooks/*`.
 *
 * Fix landed: `app.use('/unsubscribe/*', rateLimit({ kv:
 * c.env.RATE_LIMIT_KV, ...RATE_LIMIT_PRESETS.api }))` in
 * workers/notifications-api/src/index.ts. See bead Codex-ttavz.8.
 *
 * Behavioural integration coverage (positive + negative budget,
 * per-IP + per-path isolation) lives at
 * `workers/notifications-api/src/__tests__/unsubscribe-rate-limit.test.ts`.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('iter-002 F2 — public unsubscribe endpoint has no rate limit', () => {
  it('GET /unsubscribe/:token responses carry X-RateLimit-* headers', async () => {
    // Use a unique IP so this test does not race with other tests
    // for the same (ip, path) budget bucket.
    const res = await SELF.fetch(
      'http://localhost/unsubscribe/proof-f2-token-get',
      {
        method: 'GET',
        headers: { 'cf-connecting-ip': '198.51.100.10' },
      }
    );

    // The middleware must have run — these headers are added
    // unconditionally by `rateLimit()` in @codex/security.
    expect(
      res.headers.get('X-RateLimit-Limit'),
      'X-RateLimit-Limit header proves rate-limit middleware ran on /unsubscribe/*'
    ).not.toBeNull();
    expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
    expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();

    // Drain body to free the stream.
    await res.text();
  });

  it('POST /unsubscribe/:token responses carry X-RateLimit-* headers', async () => {
    // Same assertion for POST — the route file uses raw Hono
    // handlers (not procedure()) for both verbs, so the index-level
    // middleware MUST cover both. If a future refactor accidentally
    // limits this to GET, this test fails.
    const res = await SELF.fetch(
      'http://localhost/unsubscribe/proof-f2-token-post',
      {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.100.11' },
      }
    );

    expect(
      res.headers.get('X-RateLimit-Limit'),
      'X-RateLimit-Limit header proves rate-limit middleware ran on POST /unsubscribe/*'
    ).not.toBeNull();
    expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
    expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();

    await res.text();
  });
});
