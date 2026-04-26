/**
 * Denoise iter-008 F4 — `BRAND_KV.delete(...)` and `updateBrandCache`
 * sites inside `routes/organizations.ts` handed to `waitUntil` without
 * a `.catch()` chain (workers:waituntil-no-catch recurrence).
 *
 * Fingerprint: workers:waituntil-no-catch
 * Severity: minor — `updateBrandCache` is internally try/caught (never
 * rejects); but `BRAND_KV.delete` IS a raw KV call that can reject. The
 * rule per ref 04 §6 + ref 06 §3 is "every waitUntil .catch'd
 * defensively" regardless of whether the inner promise can currently
 * reject — a future refactor of `updateBrandCache` (drop the try/catch,
 * surface errors) would make this site silently leak.
 *
 * File:Lines:
 *   - organizations.ts:79  — `updateBrandCache(...)` (POST / create)
 *   - organizations.ts:572 — `BRAND_KV.delete('brand:${oldSlug}')` on
 *     slug change (PATCH /:id)
 *   - organizations.ts:577 — `updateBrandCache(...)` (PATCH /:id refresh)
 *
 * The two paired sites in the PATCH handler (572 + 577) are the most
 * concerning: 572 is a raw KV.delete that CAN reject (network, quota),
 * 577 is the matched recovery path. Same handler, same waitUntil block,
 * same risk profile — both should chain `.catch(() => {})` minimum.
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Static-analysis grep over the file.
 *
 * Note: this test is permissive — it includes `Promise.all(...).catch`
 * patterns at :590 and :659 already-correctly catch-wrapped, so it
 * counts only the truly bare-promise ones.
 *
 * `it.skip` while the bug stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ORGS_ROUTE = join(
  PROJECT_ROOT,
  'workers/organization-api/src/routes/organizations.ts'
);

describe.skip('iter-008 F4 — organizations.ts waitUntil missing .catch', () => {
  it('every waitUntil(...) in routes/organizations.ts has a .catch handler', () => {
    const src = readFileSync(ORGS_ROUTE, 'utf8');

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

    // FAILS on iter-008 main: 3 offenders at :79 (updateBrandCache POST),
    // :572 (BRAND_KV.delete oldSlug), :577 (updateBrandCache PATCH refresh).
    expect(
      offenders,
      `Every waitUntil() must chain .catch() — offenders:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
