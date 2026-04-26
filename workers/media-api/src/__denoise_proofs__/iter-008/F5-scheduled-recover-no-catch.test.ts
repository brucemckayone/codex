/**
 * Denoise iter-008 F5 — scheduled-handler `waitUntil` of
 * `runRecoverStuckTranscoding` without `.catch()`
 * (workers:waituntil-no-catch — minor; defensive-only because the
 * function is internally try/caught and documented "NEVER throws").
 *
 * Fingerprint: workers:waituntil-no-catch
 * Severity: minor (defensive)
 * File:Line: workers/media-api/src/index.ts:242
 *
 * Site:
 *
 *   async scheduled(_controller, env, ctx): Promise<void> {
 *     ctx.waitUntil(runRecoverStuckTranscoding(env, ctx));
 *   }
 *
 * The function `runRecoverStuckTranscoding` (line 175-227) wraps its
 * body in `try { ... } catch (error) { obs.error(...) }` and the
 * docstring promises "NEVER throws". So today this is functionally
 * safe. But ref 04 §6 row 6 + ref 06 §9 row 4 require explicit
 * `.catch()` regardless — the rule guards against future refactors
 * that drop the inner try/catch.
 *
 * Fix: chain `.catch((err) => obs?.error('runRecoverStuckTranscoding
 * waitUntil rejected', { error: ... }))` so the rule holds even if
 * the inner try/catch is removed.
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Static-analysis grep over the file.
 *
 * `it.skip` while the bug stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MEDIA_INDEX = join(PROJECT_ROOT, 'workers/media-api/src/index.ts');

describe.skip('iter-008 F5 — media-api scheduled waitUntil missing .catch', () => {
  it('every waitUntil(...) in media-api/src/index.ts has a .catch handler', () => {
    const src = readFileSync(MEDIA_INDEX, 'utf8');

    // Match both `ctx.waitUntil(...)` (scheduled handler) and
    // `executionCtx.waitUntil(...)` (route handlers).
    const waitUntilRegex =
      /(?:executionCtx|ctx)\.waitUntil\(\s*([\s\S]*?)\s*\)\s*;/g;

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

    // FAILS on iter-008 main: 1 offender at :242
    // (runRecoverStuckTranscoding cron dispatch).
    expect(
      offenders,
      `Every waitUntil() must chain .catch() — offenders:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
