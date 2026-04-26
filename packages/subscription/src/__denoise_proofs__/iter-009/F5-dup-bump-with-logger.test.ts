/**
 * Denoise iter-009 F5 — proof test for
 * `simplification:dup-utility-helper:bump-with-logger`.
 *
 * Finding: A `(cache, waitUntil, key, ctx, logger?) => void` "fire-and-
 * forget version-bump with .catch + warn" helper exists in
 * `packages/content/src/services/content-invalidation.ts:425` as
 * `bumpWithLogger`. Its docblock literally says:
 *
 *   "Mirrors the shape used by `subscription-invalidation.ts` so the two
 *   sibling helpers behave identically in the face of KV outages."
 *
 * Yet `packages/subscription/src/services/subscription-invalidation.ts`
 * (lines 116-140) inlines the SAME shape twice — once for
 * `COLLECTION_USER_LIBRARY` and once for
 * `COLLECTION_USER_SUBSCRIPTION` — instead of importing or sharing a single
 * helper. Two callers, two copies, no central definition.
 *
 * Fix: lift `bumpWithLogger` to a foundation package (most natural home is
 * `@codex/cache` since it's a thin wrapper around `VersionedCache`). Both
 * `content-invalidation.ts` and `subscription-invalidation.ts` then import
 * it.
 *
 * ## Catalogue walk (SKILL.md §6)
 *
 * - **Consumer-count (row 2)**: APPLICABLE — after the fix, exactly TWO
 *   call sites should depend on the foundation helper. Today the helper
 *   exists in only ONE package and the second caller re-implements.
 *
 * - **Clone-count assertion (row 12)**: CHOSEN — proof asserts that the
 *   characteristic 4-line block (`.invalidate(key).catch((error: unknown)
 *   => { logger?.warn(...); })`) is declared in at most one source file
 *   (the canonical foundation helper).
 *
 * - **Parity test (row 1)**: APPLICABLE post-fix; the two helpers must
 *   behave identically for the same `(cache, key, logger)` triple. The
 *   docblock acknowledges "behave identically" as the goal.
 *
 * - **Type-equality (row 3)**: NOT APPLICABLE — this is shape duplication,
 *   not type duplication. (Type duplication of `WaitUntilFn` and
 *   `InvalidationLogger` themselves is already filed under R11 / iter-004
 *   `Codex-lqvw4.1` — explicitly out-of-scope here, NOT re-filed.)
 *
 * ## How this test fails on main and passes after the fix
 *
 * Today (un-skipped): grep for the inline `\.invalidate\(.*\)\.catch\(.*=>`
 * pattern across `packages/*/ src / services; /*-invalidation.ts`. Currently
 * matches 3 sites (1 in content, 2 inline in subscription). After the fix:
 * matches ≤ 1 site (the shared helper).
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('denoise proof: F5 simplification:dup-utility-helper:bump-with-logger', () => {
  it.skip('cache.invalidate(...).catch(...) helper body declared at most once', () => {
    const cmd =
      `grep -rEln "\\.invalidate\\([^)]+\\)\\.catch\\(" ` +
      `packages/content/src packages/subscription/src ` +
      `--include='*.ts' || true`;
    const sites = execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT })
      .split('\n')
      .filter(Boolean)
      .filter((p) => !p.includes('__denoise_proofs__'))
      .filter((p) => !p.endsWith('.test.ts'));

    // Pre-fix: 2 sites (content-invalidation.ts has bumpWithLogger,
    // subscription-invalidation.ts has the inline shape twice — but grep
    // counts files, so 2 files). Post-fix: ≤1 (shared helper).
    expect(sites.length).toBeLessThanOrEqual(1);
  });
});
