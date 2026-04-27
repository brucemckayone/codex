/**
 * Proof test for iter-027 F4 — denoise:doc-rot:references/05-domain-web.md
 *
 * Finding: `references/05-domain-web.md` §4 anti-pattern row 1 cites a
 * symbol `loadFromServer()` that does not exist anywhere in
 * `apps/web/src/lib/collections/`. The actual canonical hydration helper is
 * `hydrateIfNeeded()` (per `apps/web/CLAUDE.md` §"Adding a New localStorage
 * Collection" and `apps/web/src/lib/collections/hydration.ts:99`).
 *
 * The reference text reads (line 145 of references/05-domain-web.md):
 *   `web:collection-init-missing-platform-layout` — New localStorage
 *   collection doesn't have `loadFromServer()` reconciliation in
 *   `(platform)/+layout.svelte`
 *
 * Codex-mqyql.18 was the original tracker (filed iter-012). Round 3 did not
 * touch the references/, so the doc-rot persists.
 *
 * Fix: edit `references/05-domain-web.md`:
 *   - line 145: replace `loadFromServer()` with `hydrateIfNeeded()`
 *   - cross-reference the helper at `apps/web/src/lib/collections/hydration.ts:99`
 *
 * Catalogue row: "Naming/style consistency" → "Custom lint rule + test the
 * rule" — replaced here with a structural grep assertion: assert the
 * referenced symbol exists at the cited location.
 *
 * Fingerprint: denoise:doc-rot:references/05-domain-web.md:§4
 * Severity: minor — reference drifts from canonical helper name; misleads
 *           future audits that grep the cited symbol.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const reference = resolve(
  repoRoot,
  '.claude/skills/denoise/references/05-domain-web.md'
);
const hydrationModule = resolve(
  repoRoot,
  'apps/web/src/lib/collections/hydration.ts'
);

describe('iter-027 F4 — references/05-domain-web.md §4 must cite hydrateIfNeeded, not loadFromServer', () => {
  it('canonical hydration helper exists at the documented path', () => {
    expect(existsSync(hydrationModule)).toBe(true);
    const src = readFileSync(hydrationModule, 'utf8');
    expect(src).toMatch(/export function hydrateIfNeeded\b/);
  });

  it('the loadFromServer symbol does NOT exist in apps/web/src/lib/collections/', () => {
    // Verify the doc claim is stale.
    const collectionsIndex = resolve(
      repoRoot,
      'apps/web/src/lib/collections/index.ts'
    );
    const indexSrc = readFileSync(collectionsIndex, 'utf8');
    expect(indexSrc).not.toMatch(/\bloadFromServer\b/);
    const hydrationSrc = readFileSync(hydrationModule, 'utf8');
    expect(hydrationSrc).not.toMatch(/\bloadFromServer\b/);
  });

  it('reference 05-domain-web.md no longer cites loadFromServer', () => {
    // Pre-fix: line 145 mentions `loadFromServer()`.
    // Post-fix: line replaced to cite `hydrateIfNeeded()`.
    expect(existsSync(reference)).toBe(true);
    const src = readFileSync(reference, 'utf8');
    expect(src).not.toMatch(/loadFromServer\(\)/);
  });

  it('reference 05-domain-web.md cites hydrateIfNeeded for the platform-layout reconciliation rule', () => {
    const src = readFileSync(reference, 'utf8');
    // Post-fix: the row is rewritten around `hydrateIfNeeded` (or links to
    // apps/web/CLAUDE.md's "Adding a New localStorage Collection" recipe).
    expect(src).toMatch(/hydrateIfNeeded\b/);
  });
});
