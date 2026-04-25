/**
 * Denoise iter-001 F4 — proof test for `denoise:doc-rot:07-domain-packages:row3`.
 *
 * Finding: `.claude/skills/denoise/references/07-domain-packages.md` §3
 * "Error Hierarchy" cites the following classes as part of `@codex/service-errors`:
 *
 *   - `NotFoundError`        ✓ exists
 *   - `ForbiddenError`       ✓ exists
 *   - `ValidationError`      ✓ exists
 *   - `ConflictError`        ✓ exists
 *   - `RateLimitError`       ✗ DOES NOT EXIST in the package
 *   - `BusinessRuleError`    ✗ DOES NOT EXIST (actual class is `BusinessLogicError`)
 *   - `InternalError`        ✗ DOES NOT EXIST (actual class is `InternalServiceError`)
 *
 * The reference also cites the throw idiom
 *   `throw new InternalError('message', { cause: e })`
 * which matches no class in the package.
 *
 * Verified by `grep -rln 'class <Name>' packages/service-errors/src/` at
 * fabrication-check time. The drift is across THREE rows of §3 plus the
 * code example.
 *
 * Per `08-self-improvement-loop.md` §5, doc-rot is a denoise finding. Fix is
 * to update the reference to cite the correct names (`BusinessLogicError`,
 * `InternalServiceError`), and either remove the `RateLimitError` row or
 * add the class to `@codex/service-errors` if the rate-limit path actually
 * needs a typed error (today the rate-limit middleware in `@codex/security`
 * returns a 429 response directly without throwing a typed error).
 *
 * Proof shape: custom lint rule + test the rule (Catalogue row 12 — applied
 * to docs). The test extracts every `<Name>Error` token cited in §3 of the
 * reference and asserts each one corresponds to an exported class in the
 * service-errors package barrel.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const ERRORS_BARREL = resolve(
  REPO_ROOT,
  'packages/service-errors/src/index.ts'
);
const REFERENCE_PATH = resolve(
  REPO_ROOT,
  '.claude/skills/denoise/references/07-domain-packages.md'
);

describe('denoise proof: F4 denoise:doc-rot:07-domain-packages:row3 — error class names', () => {
  it.skip('every *Error class cited in reference 07 §3 is exported from @codex/service-errors', () => {
    const referenceSrc = readFileSync(REFERENCE_PATH, 'utf8');
    const barrelSrc = readFileSync(ERRORS_BARREL, 'utf8');

    // Section header marker; pull §3 only (avoid catching mentions in
    // other sections that may legitimately reference unrelated symbols).
    const sectionStart = referenceSrc.indexOf('## §3 — Error Hierarchy');
    const sectionEnd = referenceSrc.indexOf('## §4', sectionStart);
    expect(sectionStart).toBeGreaterThan(-1);
    const section = referenceSrc.slice(sectionStart, sectionEnd);

    // Extract `<CapitalisedName>Error` tokens — covers `NotFoundError`,
    // `BusinessRuleError`, `InternalError`, etc.
    const cited = new Set(
      Array.from(section.matchAll(/\b([A-Z]\w*Error)\b/g), (m) => m[1])
    );

    // Exclude generic JS `Error` and TypeScript builtins.
    cited.delete('Error');
    cited.delete('ZodError');
    cited.delete('ServiceError');

    // Pull every exported class name from the barrel.
    const exported = new Set(
      Array.from(barrelSrc.matchAll(/export[^;]*\b(\w+Error)\b/g), (m) => m[1])
    );

    const missing = [...cited].filter((c) => !exported.has(c));

    // R1: fails on main because `BusinessRuleError`, `RateLimitError`,
    // `InternalError` ∈ cited but ∉ exported.
    expect(missing).toEqual([]);
  });
});
