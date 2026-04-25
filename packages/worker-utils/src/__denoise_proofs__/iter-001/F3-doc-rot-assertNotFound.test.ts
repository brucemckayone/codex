/**
 * Denoise iter-001 F3 — proof test for `denoise:doc-rot:07-domain-packages:row1`.
 *
 * Finding: `.claude/skills/denoise/references/07-domain-packages.md` §1
 * cites `BaseService.assertNotFound(value, message)` as a method on the
 * abstract class. Grepping the codebase for `assertNotFound` returns ZERO
 * hits (verified at fabrication-check time on iter-001).
 *
 * The actual `BaseService` (packages/service-errors/src/base-service.ts)
 * exposes only `handleError(error, context?)`. There is no `assertNotFound`.
 *
 * Per `08-self-improvement-loop.md` §5: "Stale references are treated as
 * `denoise:doc-rot` findings — they get the same Catalogue walk and
 * proof-test gate as code findings. The proof test for doc-rot is typically
 * a grep assertion: 'this symbol exists at this path', which fails when the
 * reference's claim is false."
 *
 * Proof shape: custom lint rule + test the rule (Catalogue row 12 —
 * naming/style consistency, but applied to documentation drift). The test
 * reads the reference file and asserts that any symbol cited by it as a
 * BaseService method is actually defined on `BaseService`. Failing on main
 * (today): `assertNotFound` is cited but not defined. After the fix (remove
 * the citation OR add the method), the test passes.
 *
 * The fix is to update the reference, NOT to add a method that wasn't
 * needed — the existing `handleError` + `NotFoundError` throw idiom is the
 * documented public API per `packages/service-errors/CLAUDE.md`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const BASE_SERVICE_PATH = resolve(
  REPO_ROOT,
  'packages/service-errors/src/base-service.ts'
);
const REFERENCE_PATH = resolve(
  REPO_ROOT,
  '.claude/skills/denoise/references/07-domain-packages.md'
);

describe('denoise proof: F3 denoise:doc-rot:07-domain-packages:row1 — assertNotFound', () => {
  it.skip('every BaseService method cited by reference 07 §1 is defined on BaseService', () => {
    const baseServiceSrc = readFileSync(BASE_SERVICE_PATH, 'utf8');
    const referenceSrc = readFileSync(REFERENCE_PATH, 'utf8');

    // The reference cites two BaseService methods; pull them mechanically
    // out of the §1 block. Currently §1 lists `handleError(...)` and
    // `assertNotFound(...)` with backticks.
    const citedMethodPattern = /BaseService[^.]*\.\s*(\w+)\(/g;
    const cited = new Set<string>();
    for (const match of referenceSrc.matchAll(citedMethodPattern)) {
      const name = match[1];
      if (name) cited.add(name);
    }

    // Defined methods on the abstract class — match `protected? methodName(`
    // inside the class body. Filter to non-private function definitions.
    const definedPattern = /(?:protected\s+|public\s+|^\s+)(\w+)\s*\(/gm;
    const defined = new Set<string>();
    for (const match of baseServiceSrc.matchAll(definedPattern)) {
      const name = match[1];
      if (name && name !== 'constructor') defined.add(name);
    }

    const missing = [...cited].filter((m) => !defined.has(m));

    // R1: the test fails iff any cited method isn't defined. On main,
    // `assertNotFound` ∈ cited but ∉ defined → failure.
    expect(missing).toEqual([]);
  });
});
