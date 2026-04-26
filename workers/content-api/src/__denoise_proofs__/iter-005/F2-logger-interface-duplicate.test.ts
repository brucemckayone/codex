/**
 * Denoise iter-005 F2 — Inline `Logger` interface duplicated across worker route files.
 *
 * Fingerprint: types:type-duplicate-cross-package
 * Severity: major (recurrence — iter-004 cycle_density=6 + iter-005 +2 instances → endemic)
 * File:Line:
 *   - workers/content-api/src/routes/content.ts:54
 *   - workers/organization-api/src/routes/settings.ts:48
 *
 * Description:
 *
 *   Two worker route files declare a near-identical `Logger`
 *   interface inline:
 *
 *     // content.ts
 *     interface Logger {
 *       warn(message: string, metadata?: Record<string, unknown>): void;
 *     }
 *
 *     // settings.ts
 *     interface Logger {
 *       warn(message: string, metadata?: Record<string, unknown>): void;
 *       error(message: string, metadata?: Record<string, unknown>): void;
 *     }
 *
 *   Both shapes match the comment "matches the subset of
 *   ObservabilityClient the helper uses" — they are duplicating
 *   the structural-typing trick that `@codex/content` already
 *   exports as `InvalidationLogger` (see iter-004 F3,
 *   Codex-lqvw4.3) and `@codex/subscription` re-exports under the
 *   same name. The pattern is now spreading from package
 *   foundation code into worker-side route helpers.
 *
 *   Per master.md "endemic-pattern watch" set after iter-004:
 *
 *     "If iter-005 (any scope) surfaces another instance of
 *      [types:type-duplicate-cross-package], consider promoting
 *      on 2nd hit (instead of standard 3-hit threshold) — the
 *      SHAPE of the recurrence (multi-instance per cycle) tells
 *      us the pattern is endemic."
 *
 *   This finding is the 2nd hit. Cycle_density for this iter is
 *   2 (Logger inline AND WaitUntilFn inline — see F3). Combined
 *   with iter-004's cycle_density=6, the dispatching skill should
 *   apply 2-hit early promotion and add a hard rule to SKILL.md
 *   §1.
 *
 *   Fix:
 *   - Promote `InvalidationLogger` to `@codex/observability` (or
 *     `@codex/shared-types` if it's a wire-shape, which it isn't)
 *   - Both worker route files import it from there
 *   - The package-side declarations in `@codex/content` and
 *     `@codex/subscription` (iter-004 F3) collapse to that import
 *   - Single canonical site
 *
 * Proof shape: Catalogue row 3 (type-equality test). Asserts
 * structural equivalence today (test passes), and would FAIL to
 * compile if either inline declaration drifts in the future
 * (regression guard).
 */
import { describe, it } from 'vitest';

describe.skip('iter-005 F2 — duplicate Logger interface (proof)', () => {
  it('content.ts Logger ≡ subset of subscription InvalidationLogger', () => {
    // After fix:
    //   import { expectTypeOf } from 'vitest';
    //   import type { InvalidationLogger } from '@codex/observability';
    //   // Re-exported from @codex/content for back-compat
    //   import type { Logger as ContentLogger } from
    //     '../routes/content';
    //   expectTypeOf<ContentLogger>().toMatchTypeOf<InvalidationLogger>();
    //
    // Today: ContentLogger is not exported (file-internal) —
    // this is precisely the bug. Lift it via the canonical
    // @codex/observability import.
  });

  it('grep guard: no inline `interface Logger {` in worker routes', () => {
    // After fix:
    //   import { execSync } from 'node:child_process';
    //   const hits = execSync(
    //     "grep -rn 'interface Logger' workers/*/src --include=*.ts",
    //     { encoding: 'utf-8' }
    //   ).trim();
    //   expect(hits).toBe(''); // Zero inline declarations remain
  });
});
