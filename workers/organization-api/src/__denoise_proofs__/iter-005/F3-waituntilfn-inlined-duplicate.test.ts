/**
 * Denoise iter-005 F3 — `WaitUntilFn` shape inlined at 5 worker route call sites
 * instead of imported from canonical declaration.
 *
 * Fingerprint: types:type-duplicate-cross-package
 * Severity: major (recurrence — same fingerprint as iter-004 F3 and iter-005 F2)
 * File:Line:
 *   - workers/ecom-api/src/routes/subscriptions.ts:66
 *   - workers/organization-api/src/routes/tiers.ts:34
 *   - workers/organization-api/src/routes/settings.ts:186
 *   - workers/organization-api/src/routes/members.ts:38, 91
 *
 * Description:
 *
 *   `@codex/content` exports `WaitUntilFn` (see
 *   packages/content/src/services/content-invalidation.ts:101) and
 *   `@codex/subscription` re-exports it (already filed under
 *   iter-004 F3 as a duplicate to consolidate to
 *   `@codex/cache`). Independently of THAT consolidation, five
 *   worker route files inline the same shape:
 *
 *     executionCtx: { waitUntil(p: Promise<unknown>): void };
 *
 *   That's a hand-written copy of `WaitUntilFn` wrapped in an
 *   `executionCtx` shape so the helper accepts a partial Hono
 *   context. The inline shape diverges in cosmetic ways (param
 *   named `p` in 4 files, `promise` in settings.ts:186) but is
 *   structurally identical.
 *
 *   This is the SAME fingerprint as iter-004 F3 and is endemic.
 *   Combined with F2 (Logger interface), iter-005 produces
 *   cycle_density=2 of `types:type-duplicate-cross-package`. The
 *   master.md endemic-pattern watch fires on hit 2; this iteration
 *   is hit 2 of the trailing-6 window.
 *
 *   Fix (after the consolidation in iter-004 F3 lands):
 *   - Import `WaitUntilFn` from the canonical site
 *     (`@codex/cache` per iter-004 F3's recommendation, or
 *     `@codex/observability` if it merges with InvalidationLogger
 *     consolidation)
 *   - Each route file types its `executionCtx` arg as
 *     `{ waitUntil: WaitUntilFn }`
 *   - Or — since the helper is always called inside a procedure
 *     handler — use the full `Pick<ProcedureContext, 'executionCtx'>`
 *     to pick up the canonical shape from the procedure context
 *     types
 *
 * Proof shape: Catalogue row 3 (type-equality test). Asserts the
 * inline shape is structurally equal to the canonical
 * `WaitUntilFn`. After the fix, every worker function that takes
 * a `{ waitUntil(...) }` shape uses the same name; a grep guard
 * here asserts zero inline declarations remain.
 */
import { describe, it } from 'vitest';

describe.skip('iter-005 F3 — inline WaitUntilFn duplicate (proof)', () => {
  it('inline executionCtx shape ≡ canonical WaitUntilFn', () => {
    // After fix (and iter-004 F3 consolidation):
    //   import { expectTypeOf } from 'vitest';
    //   import type { WaitUntilFn } from '@codex/cache';
    //   type Inline = (p: Promise<unknown>) => void;
    //   expectTypeOf<Inline>().toEqualTypeOf<WaitUntilFn>();
  });

  it('grep guard: zero inline executionCtx waitUntil shapes in workers', () => {
    // After fix:
    //   const hits = execSync(
    //     "grep -rE 'waitUntil\\((p|promise):' workers/*/src --include=*.ts " +
    //       "| grep -v __tests__ || true",
    //     { encoding: 'utf-8' }
    //   ).trim();
    //   expect(hits).toBe('');
  });
});
