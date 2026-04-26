/**
 * Denoise iter-008 F1 — `cache.invalidate(...)` inside `waitUntil` with
 * no `.catch()` chain (workers:waituntil-no-catch — 3rd recurrence,
 * triggers R7 standard 3-hit promotion).
 *
 * Fingerprint: workers:waituntil-no-catch
 * Severity: major (3rd hit; promotion-eligible)
 * File:Line: workers/ecom-api/src/handlers/checkout.ts:169-173
 *
 * Site:
 *
 *   c.executionCtx.waitUntil(
 *     cache.invalidate(
 *       CacheType.COLLECTION_USER_LIBRARY(validatedMetadata.customerId)
 *     )
 *   );
 *
 * Failure mode: when KV is unhealthy or `cache.invalidate` rejects (KV
 * write quota, network), the rejection bypasses observability. The
 * subscription-cache-audit (Codex-v8bub PR 1 + PR 2) explicitly relies
 * on every cache invalidation logging warn() on failure for forensic
 * visibility. This site is the only one in ecom-api that does NOT.
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Adapted: a static-analysis test reads
 * the file and asserts every `executionCtx.waitUntil(...)` call has
 * a `.catch(...)` somewhere in its argument expression. Same shape
 * as iter-002 F3 (worker:waituntil-no-catch hit #1).
 *
 * Fix: chain `.catch((err) => ctx.obs?.warn(...))` on cache.invalidate.
 *
 * `it.skip` while the bug stands. Un-skip in the same PR as the fix.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const CHECKOUT_HANDLER = join(
  PROJECT_ROOT,
  'workers/ecom-api/src/handlers/checkout.ts'
);

describe.skip('iter-008 F1 — checkout cache-invalidate waitUntil missing .catch', () => {
  it('every waitUntil(...) in handlers/checkout.ts has a .catch handler', () => {
    const src = readFileSync(CHECKOUT_HANDLER, 'utf8');

    // Capture each `executionCtx.waitUntil(<expr>);` call and check the
    // captured argument expression contains a `.catch(`.
    const waitUntilRegex = /executionCtx\.waitUntil\(\s*([\s\S]*?)\s*\)\s*;/g;

    const offenders: string[] = [];
    const matches = Array.from(src.matchAll(waitUntilRegex));
    matches.forEach((match, i) => {
      const argExpr = match[1] ?? '';
      if (!/\.catch\(/.test(argExpr)) {
        offenders.push(
          `waitUntil #${i + 1} (offset ${match.index}): ${argExpr.slice(0, 120)}…`
        );
      }
    });

    // FAILS on iter-008 main: cache.invalidate(...) at line 169-173.
    expect(
      offenders,
      `Every waitUntil() must chain .catch() — offenders:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
