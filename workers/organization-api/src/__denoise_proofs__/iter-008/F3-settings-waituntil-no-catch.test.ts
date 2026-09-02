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

    // A VersionedCache SINK DEFINITION is not a call site this rule can judge.
    // `waitUntil: (p) => ctx.executionCtx.waitUntil(p)` (added by RULE 7 of
    // scripts/checks/check-data-access-contract.mjs) forwards a promise the
    // CACHE created and has already caught: `writeCacheSlot` attaches its own
    // `.catch()` that warns through `obs` BEFORE invoking the sink
    // (packages/cache/src/versioned-cache.ts:189-195), and `startVersionWrite`
    // hands over `write.catch(() => {})` at :259 with the reason stated inline
    // -- "a rejecting waitUntil task is an unhandled rejection in workerd".
    // So a `.catch()` at the sink would be unreachable code.
    //
    // The regex also cannot see that provenance: `waitUntil(promise),` is not
    // followed by `;`, so the lazy match runs PAST the arrow body into the
    // enclosing object literal and the "argument" it tests is `promise),\n })`
    // -- a lexical accident, not an analysis. Statement-form calls keep their
    // teeth; only a lambda forwarding its own parameter is excused.
    const sinkForward = /waitUntil\s*:\s*\(\s*(\w+)\s*\)\s*=>\s*(?:[\w$]+\.)*$/;

    const offenders: string[] = [];
    const matches = Array.from(src.matchAll(waitUntilRegex));
    matches.forEach((match, i) => {
      const argExpr = match[1] ?? '';

      const preamble = src.slice(
        Math.max(0, (match.index ?? 0) - 80),
        match.index
      );
      const forwarded = sinkForward.exec(preamble);
      if (forwarded && argExpr.startsWith(forwarded[1] ?? '\u0000')) {
        return;
      }
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
