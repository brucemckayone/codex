/**
 * Denoise iter-029 F3 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: workers:waituntil-no-catch (apps/web instance)
 * Severity: major (R13 hard-rule violation)
 * Recurrence: 2nd hit (iter-003 F8, now iter-029 F3) — Codex-ttavz.16 still open.
 *
 * Bug
 * ---
 * `apps/web/src/lib/server/brand-cache.ts:75` and `:90` call
 * `platform.context.waitUntil(promise)` where `promise` is a raw
 * `BRAND_KV.put(...)` / `BRAND_KV.delete(...)` returned from the KV
 * binding API. Neither call has a `.catch(...)` — if the KV write fails
 * (transient KV outage, eventual-consistency race, account-level
 * throttle), the rejection propagates as an unhandled promise rejection
 * inside the SvelteKit worker, which in workerd surfaces as an
 * `unhandledRejection` and may terminate the request.
 *
 * R13 (promoted iter-008, fingerprint `workers:waituntil-no-catch`)
 * states: "Every `executionCtx.waitUntil(...)` (or `ctx.waitUntil(...)`
 * in scheduled handlers) MUST chain `.catch(...)` on the inner promise
 * expression". The rule is currently scoped to `workers/*/ src; /**` in
 * its grep guard, but the same hazard exists wherever
 * `platform.context.waitUntil(...)` is reachable — including the
 * SvelteKit `apps/web` server runtime.
 *
 * Two call sites in this file (`setBrandConfig`, `deleteBrandConfig`)
 * both bare-fire the put/delete. Fix:
 *
 *   const promise = platform.env.BRAND_KV.put(key, value, opts).catch(
 *     (err) => logger.error('Brand cache write failed', { error: err })
 *   );
 *   platform.context.waitUntil(promise);
 *
 * Catalogue rows
 * --------------
 * Row 11 — API-map snapshot. Static-analysis test that scans the
 * `brand-cache.ts` source, locates every `waitUntil(...)` call, and
 * asserts the argument expression contains `.catch(`.
 *
 * Filed at: docs/denoise/iter-029.md
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BRAND_CACHE = resolve(__dirname, '../../lib/server/brand-cache.ts');

describe.skip('iter-029 F3 — brand-cache.ts waitUntil missing .catch', () => {
  it('every platform.context.waitUntil(...) call passes a .catch()-chained promise', () => {
    const source = readFileSync(BRAND_CACHE, 'utf-8');

    // Match every `.waitUntil(<expr>)` and capture the argument expression.
    // We then assert each captured arg contains `.catch(` somewhere — either
    // on the same line as a chained expression, or in the variable assigned
    // to it earlier (which we approximate by also looking 5 lines up).
    const waitUntilRegex = /waitUntil\(([^)]+)\)/g;
    const offenders: { line: number; arg: string; window: string }[] = [];
    const lines = source.split('\n');
    let match = waitUntilRegex.exec(source);

    while (match !== null) {
      const arg = (match[1] ?? '').trim();
      const lineIdx = source.slice(0, match.index).split('\n').length - 1;
      // Scan a 5-line window before the call for the variable assignment;
      // if `arg` is `promise`, look at where `promise = ...` is built.
      const windowStart = Math.max(0, lineIdx - 5);
      const windowSlice = lines.slice(windowStart, lineIdx + 1).join('\n');

      const argHasCatch = arg.includes('.catch(');
      const windowHasCatch = windowSlice.includes('.catch(');

      if (!argHasCatch && !windowHasCatch) {
        offenders.push({ line: lineIdx + 1, arg, window: windowSlice });
      }
      match = waitUntilRegex.exec(source);
    }

    expect(
      offenders,
      `brand-cache.ts has ${offenders.length} waitUntil() call(s) whose promise argument lacks .catch() chaining (R13). ${offenders
        .map(
          (o) =>
            `\n  line ${o.line}: waitUntil(${o.arg}) — preceding window:\n${o.window}`
        )
        .join('\n')}`
    ).toEqual([]);
  });
});
