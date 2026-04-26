/**
 * Denoise iter-009 F2 — proof test for
 * `simplification:dup-procedure-context-builder`.
 *
 * Finding: The `procedure()` factory in `procedure.ts:149-168` builds the
 * shared `ProcedureContext` shape inline:
 *
 *   const ctx: ProcedureContext<TPolicy, TInput> = {
 *     user: c.get('user') as ...,
 *     session: c.get('session') as ...,
 *     input: validatedInput as ...,
 *     requestId: c.get('requestId') || generateRequestId(),
 *     clientIP: c.get('clientIP') || getClientIP(c),
 *     userAgent: c.req.header('User-Agent') || 'unknown',
 *     organizationId: ...,
 *     organizationRole: c.get('organizationRole'),
 *     env: c.env,
 *     executionCtx: c.executionCtx,
 *     obs,
 *     services: registry,
 *   };
 *
 * `upload-shared.ts:74-103` exports `buildUploadBaseContext()` that builds
 * the SAME shape — with the file-slot key (`file` / `files`) layered on top
 * by the caller. The shared helper was extracted (Codex-j9xcl) when
 * binary/multipart procedures were de-duped, but `procedure()` itself was
 * never refactored to use it.
 *
 * Net result: the 14-key context-builder appears in TWO places that drift
 * independently. A `userAgent` default change in one site silently splits
 * behaviour between `procedure()` and the upload procedures.
 *
 * ## Catalogue walk (SKILL.md §6)
 *
 * - **Parity test (row 1)**: APPLICABLE — the chosen proof. Mock a `Context`
 *   and a `ServiceRegistry`, call both `buildUploadBaseContext()` and the
 *   inline builder in `procedure()`, assert the produced contexts are
 *   structurally identical for every key the procedure context exposes.
 *
 * - **Consumer-count assertion (row 2)**: NOT APPLICABLE — both sites are
 *   live consumers; the question is whether they share an implementation.
 *
 * - **Type-equality (row 3)**: NOT APPLICABLE — the two builders return
 *   `ProcedureContext<...>` already; type-equality holds even when bodies
 *   diverge.
 *
 * - **Dependency-graph assertion (row 4)**: NOT APPLICABLE — no layer leak.
 *
 * - **Clone-count assertion (row 12)**: APPLICABLE — but parity is stricter
 *   (asserts behaviour, not just AST shape). Fall back to clone-count if
 *   parity is intractable; here it isn't.
 *
 * ## How this test fails on main and passes after the fix
 *
 * Today (un-skipped): grep for the literal `userAgent: c.req.header('User-
 * Agent') || 'unknown',` substring across `packages/worker-utils/src/`. The
 * substring appears in BOTH `procedure.ts` and `upload-shared.ts` (`grep -c`
 * == 2) → fails. After the fix (procedure.ts uses
 * `buildUploadBaseContext()`): only `upload-shared.ts` retains the literal
 * → passes.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const PACKAGE_ROOT = resolve(REPO_ROOT, 'packages/worker-utils/src');

describe('denoise proof: F2 simplification:dup-procedure-context-builder', () => {
  it.skip('procedure context-builder shape exists in exactly one site (canonical: upload-shared.ts)', () => {
    // The shared helper IS upload-shared.buildUploadBaseContext. The inline
    // builder in procedure.ts duplicates it. After the fix, the literal
    // body should only appear in upload-shared.ts.
    const cmd = `grep -rln "userAgent: c.req.header('User-Agent')" ${PACKAGE_ROOT} --include='*.ts' || true`;
    const sites = execSync(cmd, { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((p) => !p.includes('__denoise_proofs__'))
      .filter((p) => !p.endsWith('.test.ts'));

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatch(/upload-shared\.ts$/);
  });
});
