/**
 * Denoise iter-003 F5 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: workers:waituntil-no-catch
 *
 * Bug
 * ---
 * `apps/web/src/lib/server/brand-cache.ts:75` and `:90` chain
 * `platform.context.waitUntil(promise)` for KV writes (`setBrandConfig`)
 * and deletes (`deleteBrandConfig`) without a `.catch()` on the promise.
 *
 * Reference 06 §3 + §9 row 4 fingerprint this as `workers:waituntil-no-catch`
 * — same fingerprint as iter-002 F3 (`workers/ecom-api/src/handlers/checkout.ts`).
 *
 * Why it matters in apps/web specifically:
 *   - The web app runs on Cloudflare Pages workers; `platform.context.waitUntil`
 *     forwards the promise to the Cloudflare runtime. An unhandled rejection
 *     surfaces as an `uncaughtException` in the runtime logger, BYPASSING
 *     the structured `obs.error/warn` channel that ops dashboards consume.
 *   - The two waitUntil calls fire on every org-layout server load that
 *     refreshes the brand-cache entry — this is hot-path code (every org
 *     subdomain visit). A KV outage would surface as runtime noise instead
 *     of structured "brand cache write failed" warnings.
 *
 * Project memory `feedback_dont_defer_cache_issues.md` rules out deferral.
 *
 * Recurrence: this is the SECOND sighting of `workers:waituntil-no-catch`
 * in the trailing 6 cycles (iter-002 F3 was the first). Per SKILL.md §1 R7,
 * a third sighting in the next 4 cycles promotes this fingerprint to a
 * hard rule. The cell-domain split (workers vs apps/web) doesn't change
 * the fingerprint — both file-system locations are server-side waitUntil
 * usage.
 *
 * Catalogue row
 * -------------
 * Row 12 — Custom lint rule + test. Static analysis: parse brand-cache.ts,
 * find every `waitUntil(...)` call, assert `.catch(` appears in the
 * argument expression.
 *
 * MCP evidence
 * ------------
 * Static finding — no runtime MCP evidence required (per §3 matrix,
 * security × apps/web's `playwright`/`chrome-devtools` requirements
 * apply to runtime auth + headers proofs). For waitUntil hygiene a
 * file-system lint is sufficient.
 *
 * Severity: minor (operational visibility, not data exposure)
 * Filed at: docs/denoise/iter-003.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BRAND_CACHE = resolve(__dirname, '../../lib/server/brand-cache.ts');

describe.skip('iter-003 F5 — brand-cache.ts waitUntil hygiene', () => {
  it('every waitUntil call has a .catch() on its argument expression', () => {
    const src = readFileSync(BRAND_CACHE, 'utf-8');

    // Find every waitUntil(...) call and capture the argument expression.
    // Naive but adequate: balance parens. Regex variant good enough since
    // the file has only two waitUntil call sites.
    const callPattern =
      /(?:context|executionCtx)\.waitUntil\(([^)]*\([^)]*\)[^)]*|[^)]+)\)/g;
    const matches = [...src.matchAll(callPattern)];

    expect(
      matches.length,
      'expected at least one waitUntil call in brand-cache.ts'
    ).toBeGreaterThan(0);

    for (const [whole, arg] of matches) {
      expect(
        /\.catch\s*\(/.test(arg),
        `waitUntil call in brand-cache.ts has no .catch() on its argument: ${whole}`
      ).toBe(true);
    }
  });
});
