/**
 * Denoise iter-008 F3 — three `waitUntil(...)` calls in
 * `workers/organization-api/src/routes/settings.ts` without a
 * `.catch()` chain (workers:waituntil-no-catch recurrence).
 *
 * Fingerprint: workers:waituntil-no-catch
 * Severity: major (3 sites in one file; settings is a hot mutation path)
 * File:Lines:
 *   - settings.ts:217 — `waitUntil(Promise.all(tasks))` (multi-task warm
 *     + version bump on branding mutations)
 *   - settings.ts:454 — `cache.invalidate(orgId)` after PUT /contact
 *   - settings.ts:499 — `cache.invalidate(orgId)` after PUT /features
 *
 * The contact/features PUT routes are user-facing and the missing
 * `.catch()` means a KV reject on those routes evaporates. The settings
 * /branding flow uses Promise.all of `updateBrandCache` (internally
 * try-caught) + `cache.invalidate` (CAN reject); a reject on the
 * invalidate breaks the Promise.all without surfacing to obs.
 *
 * Note: every other `waitUntil` in this worker (members.ts,
 * followers.ts, organizations.ts:590, .ts:659, settings.ts via
 * `invalidateOrgSlugCache` style helpers) IS catch-wrapped. These
 * three sites are the regression.
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Static-analysis grep over the file.
 *
 * Fix: chain `.catch((err) => obs?.warn(...))` on each invalidate /
 * Promise.all so KV failures surface in tail logs (per the
 * subscription-cache-audit forensic-visibility contract).
 *
 * `it.skip` while the bug stands.
 */
// Vite `?raw` baked-at-build-time import — works under both Node and the
// workerd runtime used by @cloudflare/vitest-pool-workers.

import { describe, expect, it } from 'vitest';
import settingsSrc from '../../routes/settings.ts?raw';

describe('iter-008 F3 — settings.ts waitUntil missing .catch', () => {
  it('every waitUntil(...) in routes/settings.ts has a .catch handler', () => {
    const src = settingsSrc;

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

    // FAILS on iter-008 main: 3 offenders at :217 (Promise.all(tasks)),
    // :454 (cache.invalidate orgId after PUT /contact), :499
    // (cache.invalidate orgId after PUT /features).
    expect(
      offenders,
      `Every waitUntil() must chain .catch() — offenders:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
