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
 * a rate limiter for `/unsubscribe/*` (or that the route-handler file
 * exports a `procedure()` with `rateLimit` set).
 *
 * Failure mode this test would catch: anyone with a leaked
 * unsubscribe token URL can replay it as fast as TCP allows. The
 * HMAC verification cost is non-trivial and the POST mutates DB
 * state (idempotently, but still — write amplification). Without a
 * rate limit:
 *   - DoS by flooding /unsubscribe/<random> tokens (HMAC verify
 *     cycles per request)
 *   - Token-format enumeration (timing on validity vs invalidity)
 *   - DB write amplification on the hot table
 *     `notification_preferences` if a token is replayed
 *
 * Compare against the auth worker which does apply
 * `RATE_LIMIT_PRESETS.auth` (5/15min) on its public endpoints and
 * the ecom-api worker which applies `webhook` (1000/min) on
 * `/webhooks/*`.
 *
 * `it.skip` while the bug stands. Un-skip in the same PR as the fix,
 * which should add `app.use('/unsubscribe/*', rateLimit({ kv:
 * c.env.RATE_LIMIT_KV, ...RATE_LIMIT_PRESETS.api }))` (or `.strict`)
 * to `workers/notifications-api/src/index.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const NOTIFICATIONS_INDEX = join(
  PROJECT_ROOT,
  'workers/notifications-api/src/index.ts'
);
const UNSUBSCRIBE_ROUTE = join(
  PROJECT_ROOT,
  'workers/notifications-api/src/routes/unsubscribe.ts'
);

describe.skip('iter-002 F2 — public unsubscribe endpoint has no rate limit', () => {
  it('notifications-api index has rate-limit middleware on /unsubscribe/*', () => {
    const indexSrc = readFileSync(NOTIFICATIONS_INDEX, 'utf8');
    // FAILS on current main: index.ts has no `rateLimit(` import or
    // call anywhere — there is zero rate-limit wiring on this worker
    // (compare with workers/ecom-api/src/index.ts which calls
    // rateLimit({ ...RATE_LIMIT_PRESETS.webhook }) for /webhooks/*).
    expect(
      indexSrc,
      'notifications-api/src/index.ts should import rateLimit'
    ).toContain("from '@codex/security'");
    expect(
      indexSrc,
      'notifications-api should apply rate limiting to /unsubscribe/*'
    ).toMatch(/app\.use\(\s*['"]\/unsubscribe\/\*['"]/);
  });

  it('unsubscribe handler does not bypass procedure() rate limiting', () => {
    const routeSrc = readFileSync(UNSUBSCRIBE_ROUTE, 'utf8');
    // FAILS on current main: the route uses raw `app.post(...)` and
    // `app.get(...)` Hono handlers with NO procedure() wrapping
    // (because token verification is HMAC-based, not session-based).
    // Per CLAUDE.md this is intentional — but rate limiting must
    // still happen at the Hono middleware level. Either of these
    // assertions should hold after the fix:
    //   - the route uses procedure() with `rateLimit` set, OR
    //   - the index.ts (covered above) attaches `app.use(...
    //     rateLimit(...))` for `/unsubscribe/*`.
    const usesProcedureWithRateLimit =
      /procedure\(\s*\{[\s\S]*?rateLimit\s*:/.test(routeSrc);
    const indexSrc = readFileSync(NOTIFICATIONS_INDEX, 'utf8');
    const indexAttachesRateLimit =
      /app\.use\(\s*['"]\/unsubscribe\/\*['"][\s\S]*?rateLimit/.test(indexSrc);
    expect(
      usesProcedureWithRateLimit || indexAttachesRateLimit,
      'unsubscribe routes must be rate-limited (either procedure({rateLimit}) or app.use rateLimit at index)'
    ).toBe(true);
  });
});
