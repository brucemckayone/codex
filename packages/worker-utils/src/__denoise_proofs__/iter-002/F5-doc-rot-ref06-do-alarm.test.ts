/**
 * Denoise iter-002 F5 — doc-rot in
 * `.claude/skills/denoise/references/06-domain-workers.md` §4 + §9 row 9:
 * cite `ctx.storage.transaction(...)` and `alarmInFlight` storage key,
 * but neither symbol exists anywhere in workers/.
 *
 * Fingerprint: denoise:doc-rot:06-domain-workers:row9
 * Severity: minor (doc-rot)
 * File:Line:
 *   .claude/skills/denoise/references/06-domain-workers.md:131-141 (§4)
 *   .claude/skills/denoise/references/06-domain-workers.md:222 (row 9)
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Grep assertion against the cited
 * symbols. The symbols don't have to be omnipresent — but if a
 * reference cites them as anti-pattern targets, at least one
 * implementation has to exist somewhere or the row guards a
 * non-existent surface.
 *
 * Live evidence:
 *   $ rg -n "ctx\.storage\.transaction|alarmInFlight" workers/ packages/ --type ts
 *   (no matches outside dist/ build artefacts)
 *
 * Workers/ DOES have one DurableObject — orphaned-file-cleanup-do
 * — at workers/media-api/src/durable-objects/. Whatever idempotency
 * pattern that DO uses (or doesn't) becomes the live anchor for the
 * reference's anti-pattern row. Today the row is fabricated against a
 * pattern with zero implementations to compare against.
 *
 * Fix: either (a) update ref 06 §4 + §9 row 9 to cite the actual
 * idempotency mechanism used by `orphaned-file-cleanup-do.ts` (read
 * the file and rewrite the row), or (b) drop the row if the project
 * has converged on a different DO storm-prevention pattern.
 *
 * `it.skip` while the bug stands.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const REF_06 = join(
  PROJECT_ROOT,
  '.claude/skills/denoise/references/06-domain-workers.md'
);

describe.skip('iter-002 F5 — doc-rot ref 06 row 9 (DO alarm idempotency)', () => {
  it('cited symbols exist in worker source', () => {
    const refSrc = readFileSync(REF_06, 'utf8');

    // Both citations live in §4 ("DurableObject lifecycle") and §9
    // row 9 ("workers:do-alarm-no-idempotency").
    const cites = {
      'ctx.storage.transaction': /ctx\.storage\.transaction/.test(refSrc),
      alarmInFlight: /alarmInFlight/.test(refSrc),
    };

    if (!cites['ctx.storage.transaction'] && !cites.alarmInFlight) {
      // Already fixed.
      return;
    }

    const grepHits = (pattern: string): number => {
      try {
        const out = execSync(
          `rg -l ${pattern} workers/*/src --type ts -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!**/dist/**' -g '!.claude/worktrees/**'`,
          { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }
        )
          .toString()
          .trim();
        return out ? out.split('\n').length : 0;
      } catch {
        return 0;
      }
    };

    if (cites['ctx.storage.transaction']) {
      // FAILS on current main: zero hits.
      expect(grepHits("'ctx\\.storage\\.transaction'")).toBeGreaterThan(0);
    }
    if (cites.alarmInFlight) {
      // FAILS on current main: zero hits.
      expect(grepHits("'alarmInFlight'")).toBeGreaterThan(0);
    }
  });
});
