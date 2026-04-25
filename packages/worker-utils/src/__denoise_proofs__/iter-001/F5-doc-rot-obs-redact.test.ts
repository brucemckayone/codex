/**
 * Denoise iter-001 F5 — proof test for `denoise:doc-rot:01-security-audit:row9`.
 *
 * Finding: `.claude/skills/denoise/references/01-security-audit.md` §7
 * "Secret Hygiene" cites
 *   `obs.redact(secret)` and `@codex/observability obs.redact()`
 * as the way to wrap sensitive values in structured logs.
 *
 * Grepping `packages/observability/src/` for `\.redact\(` returns ZERO hits.
 * The actual API is:
 *   - `redactSensitiveData(metadata)` — standalone helper, exported from index
 *   - `obs.info/warn/error/debug` — auto-redact metadata via `redactSensitiveData`
 *     before output (see `packages/observability/CLAUDE.md` "PII Redaction")
 *
 * No `obs.redact()` method exists on `ObservabilityClient`.
 *
 * Per `08-self-improvement-loop.md` §5, doc-rot is a denoise finding. Fix is
 * to update reference 01 §7 — and the anti-pattern row 9 (`security:secret-in-log`)
 * — to cite the correct API surface.
 *
 * Proof shape: custom lint rule + test the rule (Catalogue row 12). Read
 * the reference, extract any `obs.<method>(` tokens, and assert every cited
 * method actually exists on `ObservabilityClient`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const OBS_INDEX = resolve(REPO_ROOT, 'packages/observability/src/index.ts');
const REFERENCE_PATH = resolve(
  REPO_ROOT,
  '.claude/skills/denoise/references/01-security-audit.md'
);

describe('denoise proof: F5 denoise:doc-rot:01-security-audit:row9 — obs.redact', () => {
  it.skip('every obs.* method cited by reference 01 exists on ObservabilityClient', () => {
    const referenceSrc = readFileSync(REFERENCE_PATH, 'utf8');
    const obsSrc = readFileSync(OBS_INDEX, 'utf8');

    // Citations of `obs.<name>(` in the reference (any section).
    const cited = new Set(
      Array.from(referenceSrc.matchAll(/\bobs\.(\w+)\s*\(/g), (m) => m[1])
    );

    // Methods defined on ObservabilityClient — match `methodName(` inside
    // the class body. Crude but sufficient for the cited token list.
    const defined = new Set(
      Array.from(obsSrc.matchAll(/^\s+(\w+)\s*\([^)]*\)\s*[:{]/gm), (m) => m[1])
    );

    const missing = [...cited].filter((m) => !defined.has(m));

    // R1: fails on main — `redact` ∈ cited but ∉ defined.
    expect(missing).toEqual([]);
  });
});
