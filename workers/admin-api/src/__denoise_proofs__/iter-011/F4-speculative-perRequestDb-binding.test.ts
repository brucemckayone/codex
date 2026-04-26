/**
 * Denoise iter-011 F4 — speculative `perRequestDb` field on AdminVariables.
 *
 * Fingerprint: simplification:speculative-extension-point
 * Severity: minor (no runtime impact — type-only speculative surface)
 *
 * Site:
 *   - workers/admin-api/src/types.ts:14-19 declares
 *     `interface AdminVariables { organizationId: string;
 *      perRequestDb?: DatabaseWs; }` and the JSDoc says "set by
 *     withPerRequestDb middleware".
 *
 * Reality: no `withPerRequestDb` middleware exists anywhere in the repo
 * (grep returns hits only in this file's source + dist copies). The
 * field is a leftover plan-marker.
 *
 * Why it matters (per-row score):
 *   - Reading time: yes (admin-api readers wonder which middleware sets
 *     it; trace turns up nothing).
 *   - Maintenance: yes (`AdminVariables` and `AdminApiEnv` carry a
 *     phantom field that consumers might lean on, only to find it's
 *     never set).
 *   - Test surface: minor (no production code reads
 *     `c.var.perRequestDb`).
 *
 * Hand-off candidate? — borderline. The fix IS deletion (no behaviour
 * change), so by `/fallow-audit` precedence, this could route there. But
 * fallow flagged the type as "unused type" at line 14, which routes to
 * deletion of the WHOLE interface; the actionable signal is finer:
 * delete just the `perRequestDb` member + its JSDoc, leave
 * `AdminVariables.organizationId` (which IS set by procedure's
 * org-membership middleware path). So this stays here as a
 * simplification finding rather than a fallow-audit "delete export".
 *
 * Proof shape: Catalogue row 12 — grep assertion. Asserts the
 * `perRequestDb` field is gone from AdminVariables AND no
 * `withPerRequestDb` reference remains in the source tree (excluding
 * dist/).
 *
 * Fix: drop the `perRequestDb?: DatabaseWs` member; drop the JSDoc
 * line; drop the unused `DatabaseWs` import.
 *
 * `it.skip` while the dead field stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ADMIN_TYPES = join(PROJECT_ROOT, 'workers/admin-api/src/types.ts');

describe.skip('iter-011 F4 — perRequestDb speculative-extension-point', () => {
  it('AdminVariables does not declare a perRequestDb field', () => {
    const src = readFileSync(ADMIN_TYPES, 'utf8');
    expect(
      src,
      'AdminVariables.perRequestDb is a speculative field — no withPerRequestDb middleware exists. Drop it.'
    ).not.toMatch(/perRequestDb/);
  });

  it('JSDoc no longer references withPerRequestDb middleware', () => {
    const src = readFileSync(ADMIN_TYPES, 'utf8');
    expect(
      src,
      'JSDoc cites withPerRequestDb middleware that does not exist in the repo.'
    ).not.toMatch(/withPerRequestDb/);
  });
});
