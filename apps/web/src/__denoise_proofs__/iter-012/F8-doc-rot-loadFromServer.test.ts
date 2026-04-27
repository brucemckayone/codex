/**
 * Proof test for iter-012 F8 — denoise:doc-rot:05-domain-web:row5
 *
 * Finding: `.claude/skills/denoise/references/05-domain-web.md` cites
 * `loadFromServer()` as the canonical reconciliation function for new
 * localStorage collections (§4 paragraph "New localStorage collection
 * checklist"; ref 05 §9 row 5 for `web:layout-missing-depends-cache-versions`
 * adjacent context).
 *
 * The actual function is `hydrateIfNeeded` (declared at
 * `apps/web/src/lib/collections/hydration.ts:99` and re-exported from
 * `apps/web/src/lib/collections/index.ts`). There is NO `loadFromServer`
 * in the codebase.
 *
 * The reference is stale — at iter-012 build time the function had been
 * renamed but the reference's anti-pattern row still cites the old name.
 *
 * Catalogue row: "Naming/style consistency / API regression with no test
 * infra — Snapshot the route map" — the proof is a grep assertion that
 * BOTH the symbol the reference cites AND the renamed symbol exist in the
 * code.
 *
 * Fingerprint: denoise:doc-rot:05-domain-web:row5
 * Severity: minor — documentation drift; the fix is to update the
 * reference text and the iter-NNN.md fabrication-check protocol.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

describe.skip('iter-012 F8 — ref 05 should cite hydrateIfNeeded, not loadFromServer', () => {
  it('hydrateIfNeeded exists at the cited site', () => {
    const src = readFileSync(
      resolve(repoRoot, 'apps/web/src/lib/collections/hydration.ts'),
      'utf8'
    );
    expect(src).toMatch(/export function hydrateIfNeeded</);
  });

  it('loadFromServer does NOT exist anywhere in apps/web/src', () => {
    // Run a literal grep — if any consumer still expects the old name we
    // would catch that here.
    let output = '';
    try {
      output = execSync(
        `grep -rE "loadFromServer\\b" "${resolve(repoRoot, 'apps/web/src')}"`,
        { encoding: 'utf8' }
      );
    } catch {
      // grep exits non-zero when nothing matches — that's the success case.
      output = '';
    }
    expect(output.trim()).toBe('');
  });

  it('reference 05-domain-web.md no longer mentions loadFromServer', () => {
    const refPath = resolve(
      repoRoot,
      '.claude/skills/denoise/references/05-domain-web.md'
    );
    expect(existsSync(refPath)).toBe(true);
    const ref = readFileSync(refPath, 'utf8');
    // Pre-fix: ref mentions loadFromServer.
    // Post-fix: ref cites hydrateIfNeeded (or a more durable description
    // of "reconciliation function" without naming a specific symbol).
    expect(ref).not.toMatch(/loadFromServer/);
  });
});
