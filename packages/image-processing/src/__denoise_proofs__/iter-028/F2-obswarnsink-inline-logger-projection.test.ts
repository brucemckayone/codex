/**
 * Denoise iter-028 F2 — proof test for
 * `types:type-duplicate-cross-package` (R11 inline structural shape).
 *
 * Finding: `packages/image-processing/src/utils/upload-pipeline.ts:35` declares
 * an inline `interface ObsWarnSink { warn(msg, ctx?): void }` that is a
 * structural projection of `Logger.warn` from `@codex/observability` — exactly
 * the kind of inline shape R11 forbids.
 *
 * Tier 5.A's commit message explicitly justified the duplication:
 *   "ObsWarnSink structural type defined locally to avoid pulling
 *    @codex/observability into image-processing's deps."
 *
 * BUT image-processing already extends BaseService and uses ObservabilityClient
 * indirectly via `BaseService.obs`. The "no-deps" justification doesn't hold
 * — `@codex/observability` is already a transitive dep.
 *
 * R11 enforcement says: declare canonical Logger ONCE in @codex/observability;
 * replace inline projections with `Pick<Logger, 'warn'>` (or just `Logger`).
 *
 * Drift evidence: parameter name mismatch.
 *   Logger.warn:        warn(message: string, metadata?: Record<string, unknown>): void;
 *   ObsWarnSink.warn:   warn(message: string, context?: Record<string, unknown>): void;
 *
 * Parameter NAMES don't affect structural compatibility, but the choice of
 * `context` vs `metadata` documents intent — and one of them now reads as
 * "a divergent vocabulary around observability". The R11 fix unifies the
 * vocabulary at the canonical site.
 *
 * Proof shape: type-equality (Catalogue row 3) — assert ObsWarnSink is
 * structurally equal to Pick<Logger, 'warn'>. The proof passes today; the
 * fix removes the inline declaration entirely (test moves to typecheck-time
 * grep guard: "no `interface ObsWarnSink` outside @codex/observability").
 *
 * Severity: minor (no runtime bug; structural drift risk only).
 *
 * Remove the `.skip()` modifier in the same PR as the rename.
 */

import type { Logger } from '@codex/observability';
import { describe, expectTypeOf, it } from 'vitest';

// `ObsWarnSink` is module-private (not exported) so we re-derive its shape
// here from the source file. If the type is exported as part of the fix,
// import directly.
type ObsWarnSinkShape = {
  warn(message: string, context?: Record<string, unknown>): void;
};

describe('denoise proof: F2 types:type-duplicate-cross-package — ObsWarnSink inlines Pick<Logger, "warn">', () => {
  it.skip('ObsWarnSink MUST equal Pick<Logger, "warn"> (R11 — inline structural shape)', () => {
    // PASSES today because the shapes are structurally compatible; the bug
    // is that ObsWarnSink should not exist as a separate declaration. The
    // fix replaces it with `Pick<Logger, 'warn'>` from @codex/observability.
    expectTypeOf<ObsWarnSinkShape>().toEqualTypeOf<Pick<Logger, 'warn'>>();
  });
});
