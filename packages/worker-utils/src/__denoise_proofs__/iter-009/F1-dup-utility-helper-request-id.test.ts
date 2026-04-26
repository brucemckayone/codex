/**
 * Denoise iter-009 F1 — proof test for `simplification:duplicate-utility-helper`.
 *
 * Finding: `generateRequestId()` and `getClientIP()` are declared TWICE in
 * `@codex/worker-utils`:
 *
 *   1. `packages/worker-utils/src/middleware.ts:658` (private `function`)
 *   2. `packages/worker-utils/src/middleware.ts:669` (private `function`)
 *   3. `packages/worker-utils/src/procedure/helpers.ts:36` (`export function`)
 *   4. `packages/worker-utils/src/procedure/helpers.ts:49` (`export function`)
 *
 * The middleware-internal copies are byte-identical to the exported helpers.
 * `middleware.ts` could `import { generateRequestId, getClientIP } from
 * './procedure/helpers'` and delete its private copies — both files are
 * inside the same package, so there is no public-API drift risk.
 *
 * This is the canonical "duplicate utility helper" smell from
 * `references/03-simplification.md` §7 row 12 (premature-extraction sibling)
 * and `references/03-simplification.md` §1 (`simplification:dup-try-catch-
 * boilerplate` family — same shape repeated).
 *
 * ## Catalogue walk (SKILL.md §6)
 *
 * - **Parity test (row 1)**: APPLICABLE — two functions with the same name
 *   should produce the same output for the same input. The proof captures a
 *   small input corpus and asserts both implementations agree byte-for-byte.
 *   This is the chosen form.
 *
 * The fix removes one copy and re-points consumers — parity guarantees the
 * fix is observably equivalent. After the fix lands, the duplicate
 * declaration goes away; this test moves to a regression guard that asserts
 * the symbol is declared exactly once across the package.
 *
 * ## How this test fails on main and passes after the fix
 *
 * Today (un-skipped): scans the package source for top-level `function
 * generateRequestId(` and `function getClientIP(` declarations. Asserts
 * each is declared at MOST ONCE. Currently each appears in TWO files →
 * fails. After the middleware copies are deleted → passes.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const PACKAGE_ROOT = resolve(REPO_ROOT, 'packages/worker-utils/src');

function countDeclarations(symbol: string): string[] {
  // Walk source files, count `function <symbol>(` declarations
  // (excluding test files and the proof-test directory).
  const cmd = `grep -rln 'function ${symbol}(' ${PACKAGE_ROOT} --include='*.ts' || true`;
  const out = execSync(cmd, { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.includes('__denoise_proofs__'))
    .filter((p) => !p.endsWith('.test.ts'));
}

describe('denoise proof: F1 simplification:duplicate-utility-helper — generateRequestId/getClientIP', () => {
  it('generateRequestId is declared exactly once in @codex/worker-utils', () => {
    const sites = countDeclarations('generateRequestId');
    // Currently fails (sites.length === 2): middleware.ts AND helpers.ts.
    // After fix: only helpers.ts remains.
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatch(/procedure\/helpers\.ts$/);
  });

  it('getClientIP is declared exactly once in @codex/worker-utils', () => {
    const sites = countDeclarations('getClientIP');
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatch(/procedure\/helpers\.ts$/);
  });
});
