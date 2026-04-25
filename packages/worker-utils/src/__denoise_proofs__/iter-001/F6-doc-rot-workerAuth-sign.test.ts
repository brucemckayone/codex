/**
 * Denoise iter-001 F6 — proof test for `denoise:doc-rot:01-security-audit:row6`.
 *
 * Finding: `.claude/skills/denoise/references/01-security-audit.md` §3b and
 * anti-pattern table row 6 (`security:worker-call-no-hmac`) cite
 * `workerAuth.sign()` as the canonical caller-side API for HMAC-SHA256
 * worker-to-worker signing.
 *
 * Grepping the codebase for `workerAuth.sign` returns ZERO hits. The actual
 * caller-side API is:
 *   - `workerFetch(url, init, secret, options?)` — high-level helper
 *   - `generateWorkerSignature(payload, secret, timestamp)` — low-level helper
 *
 * `workerAuth` itself is the **receiver-side** Hono middleware factory; it
 * has no `.sign()` method on its return value.
 *
 * Per `08-self-improvement-loop.md` §5, doc-rot is a denoise finding. Fix is
 * to update reference 01 §3b and anti-pattern row 6 to cite `workerFetch()`
 * (the documented public path in `packages/security/CLAUDE.md`).
 *
 * Proof shape: structural assertion (Catalogue row 11 — snapshot the route /
 * API map). Pull the public symbols re-exported from `@codex/security`'s
 * index and assert every `workerAuth.*` token cited by reference 01
 * resolves to a known export.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SECURITY_INDEX = resolve(REPO_ROOT, 'packages/security/src/index.ts');
const REFERENCE_PATH = resolve(
  REPO_ROOT,
  '.claude/skills/denoise/references/01-security-audit.md'
);

describe('denoise proof: F6 denoise:doc-rot:01-security-audit:row6 — workerAuth.sign', () => {
  it.skip('every workerAuth.* symbol cited in reference 01 is exported from @codex/security', () => {
    const referenceSrc = readFileSync(REFERENCE_PATH, 'utf8');
    const securitySrc = readFileSync(SECURITY_INDEX, 'utf8');

    // Citations of `workerAuth.<member>` — surface anything dotted off
    // the exported `workerAuth` symbol.
    const cited = new Set(
      Array.from(referenceSrc.matchAll(/\bworkerAuth\.(\w+)/g), (m) => m[1])
    );

    // Exports from packages/security/src/index.ts — pull every named
    // identifier listed in re-export blocks.
    const exported = new Set(
      Array.from(securitySrc.matchAll(/^\s+(\w+),?\s*$/gm), (m) => m[1])
    );

    // `workerAuth` itself is exported as a middleware factory; the cited
    // members would have to be properties of its return value (a Hono
    // middleware function), which has none. The fix is to remove the
    // `.sign()` citation.
    const knownToExist = [...cited].filter((m) => exported.has(m));

    // R1: fails on main — `sign` is cited but is neither an export nor a
    // method on the workerAuth middleware factory.
    expect(knownToExist).toEqual([...cited]);
  });
});
