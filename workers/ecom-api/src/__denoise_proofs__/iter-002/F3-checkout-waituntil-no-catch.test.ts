/**
 * Denoise iter-002 F3 — `waitUntil` without `.catch()` in checkout
 * webhook handler.
 *
 * Fingerprint: workers:waituntil-no-catch
 * Severity: minor
 * File:Line: workers/ecom-api/src/handlers/checkout.ts:169-173
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Adapted: a static-analysis test reads
 * the file and asserts every `executionCtx.waitUntil(...)` call has
 * a `.catch(...)` somewhere in its argument expression.
 *
 * Failure mode this test would catch: the checkout-completed webhook
 * fire-and-forgets a KV cache invalidation via:
 *   c.executionCtx.waitUntil(
 *     cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(...))
 *   );
 * with no `.catch()`. If KV is unhealthy or rejects, the unhandled
 * rejection bypasses the `obs?` warn pattern used by every other
 * waitUntil in this worker (e.g. lines 81-99 of connect-webhook.ts,
 * lines 87-103 of payment-webhook.ts). It will not crash the worker
 * but pollutes tail logs and skips the structured warn that the
 * subscription-cache-audit (Codex-v8bub) explicitly relies on for
 * forensic visibility into invalidation drops.
 *
 * Reference 06 §3 + §9 row 4 cite this fingerprint. Reference 04
 * §"waitUntil hygiene" enforces it.
 *
 * `it.skip` while the bug stands. Un-skip in the same PR as the fix,
 * which should chain `.catch((err) => obs?.warn(...))` on the
 * `cache.invalidate(...)` promise.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const CHECKOUT_HANDLER = join(
  PROJECT_ROOT,
  'workers/ecom-api/src/handlers/checkout.ts'
);

describe.skip('iter-002 F3 — checkout-completed waitUntil missing .catch', () => {
  it('every waitUntil(...) in checkout.ts has a .catch handler', () => {
    const src = readFileSync(CHECKOUT_HANDLER, 'utf8');

    // Find every waitUntil(...) call. The whole call expression
    // must contain `.catch(` somewhere — either chained directly on
    // the inner promise OR wrapped in a Promise.all().catch(...).
    const waitUntilRegex = /executionCtx\.waitUntil\(\s*([\s\S]*?)\s*\)\s*;/g;

    const offenders: string[] = [];
    const matches = Array.from(src.matchAll(waitUntilRegex));
    matches.forEach((match, i) => {
      const argExpr = match[1] ?? '';
      if (!/\.catch\(/.test(argExpr)) {
        offenders.push(
          `waitUntil call #${i + 1} (offset ${match.index ?? '?'}): ${argExpr.slice(0, 120)}…`
        );
      }
    });

    // FAILS on current main: one offender at line ~169-173
    // (cache.invalidate fire-and-forget without .catch).
    expect(
      offenders,
      `Every waitUntil() must chain .catch() — offenders:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
