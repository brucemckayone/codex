/**
 * Rate-limit contract tests for ecom-api mutation routes (Codex-agvv).
 *
 * The preset choices on individual endpoints are string literals in the route
 * files — if someone drops `rateLimit: 'strict'` from `/subscriptions/cancel`
 * or `/subscriptions/reactivate`, typecheck will not catch it. And since
 * Codex-kgrdp.9 those literals are actually ENFORCED by `procedure()`, which
 * makes a second failure mode possible: a declared preset whose binding this
 * worker does not bind fails OPEN, logging `rate_limit.fail_open` on every
 * request while capping nothing. A green typecheck and a green deploy both
 * look identical in that state.
 *
 * So this file pins both halves of the contract:
 *
 *   1. The presets exported from `@codex/security` still cap where intended
 *      (20/min for 'strict', 100/min for 'api') and still name the binding the
 *      wrangler config has to supply.
 *   2. Every preset this worker's routes can reach is actually BOUND here, so
 *      the enforcement declared in the route files is real rather than a
 *      permanent fail-open.
 *
 * `procedure()`'s own enforcement behaviour — the 21st 'strict' request being
 * rejected, subject isolation, the fail-open paths — is covered against the
 * real limiter in
 * packages/worker-utils/src/procedure/__tests__/procedure-rate-limit.test.ts.
 * Reproducing it per worker would only re-test the shared substrate.
 */

import { env } from 'cloudflare:test';
import { RATE_LIMIT_PRESETS } from '@codex/security';
import { describe, expect, it } from 'vitest';

describe('ecom-api rate-limit presets (Codex-agvv)', () => {
  it("'strict' preset is 20 req / minute on the native binding", () => {
    expect(RATE_LIMIT_PRESETS.strict.maxRequests).toBe(20);
    expect(RATE_LIMIT_PRESETS.strict.periodSeconds).toBe(60);
    expect(RATE_LIMIT_PRESETS.strict.store).toBe('binding');
    expect(RATE_LIMIT_PRESETS.strict.bindingName).toBe('RATE_LIMIT_STRICT');
  });

  it("'api' preset is 100 req / minute on the native binding", () => {
    expect(RATE_LIMIT_PRESETS.api.maxRequests).toBe(100);
    expect(RATE_LIMIT_PRESETS.api.periodSeconds).toBe(60);
    expect(RATE_LIMIT_PRESETS.api.store).toBe('binding');
    expect(RATE_LIMIT_PRESETS.api.bindingName).toBe('RATE_LIMIT_API');
  });

  it('binds every preset its routes declare, so enforcement is not a silent fail-open', () => {
    // 'strict' is declared on the commerce mutations; 'api' is both declared
    // explicitly and applied by procedure() as the default where a route
    // declares nothing, so it is reachable from every route in this worker.
    expect(env.RATE_LIMIT_STRICT).toBeDefined();
    expect(env.RATE_LIMIT_API).toBeDefined();
  });

  it('has no `webhook` preset to re-mount on the Stripe webhook', () => {
    // Deliberate (Codex-kgrdp.17): the webhook is authenticated by Stripe's
    // HMAC signature, so a per-IP cap adds no security there and can only
    // reject a legitimate retry burst. This asserts the preset stays deleted
    // rather than quietly returning.
    expect(RATE_LIMIT_PRESETS).not.toHaveProperty('webhook');
  });
});
