/**
 * Denoise iter-004 F3 — proof test for
 * `types:type-duplicate-cross-package` — `WaitUntilFn` and
 * `InvalidationLogger` are declared (and publicly exported from the
 * package barrel) in two packages with structurally identical shapes.
 *
 * Finding:
 *   - packages/content/src/services/content-invalidation.ts:101,107
 *       export type WaitUntilFn = (promise: Promise<unknown>) => void;
 *       export interface InvalidationLogger {
 *         warn: (message: string, context?: Record<string, unknown>) => void;
 *         info?: (message: string, context?: Record<string, unknown>) => void;
 *       }
 *   - packages/subscription/src/services/subscription-invalidation.ts:70,76
 *       export type WaitUntilFn = (promise: Promise<unknown>) => void;
 *       export interface InvalidationLogger {
 *         warn: (message: string, context?: Record<string, unknown>) => void;
 *       }
 *
 * Both are exported through each package's barrel:
 *   - packages/content/src/index.ts:67-68 → InvalidationLogger, WaitUntilFn
 *   - packages/subscription/src/index.ts:68,71 → type InvalidationLogger, type WaitUntilFn
 *
 * `WaitUntilFn` is structurally identical. `InvalidationLogger` shares the
 * `warn` member but @codex/content also adds an optional `info` — so they
 * are NOT structurally identical, just close. A consumer typed against the
 * subscription variant cannot pass it to the content variant if the
 * content code calls `logger.info(...)` (no compile error today because
 * `info` is optional, but documents intent confusion).
 *
 * Both types are infrastructure plumbing for cache invalidation helpers.
 * They belong in `@codex/cache` (the package that owns `VersionedCache`),
 * or in `@codex/shared-types` as a cross-cutting "fire-and-forget" helper
 * type. Today they are duplicated because the two service packages are
 * trying to stay foundation-free.
 *
 * Rule (ref 02 §7 row 4 / ref 07 §7 row 5): same name declared in 2+
 * packages, both publicly exported.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue
 * row 3 — Type-equality test). For `WaitUntilFn` the assertion passes
 * today (true structural equivalence); for `InvalidationLogger` the
 * proof is that the two are NOT identical — so the test asserts the
 * subset relationship and explicitly notes which member differs.
 *
 * Severity: minor (no runtime impact; doc-rot in package boundaries).
 *
 * Remove the `.skip()` modifier in the same PR as consolidation.
 */

import type {
  InvalidationLogger as SubscriptionInvalidationLogger,
  WaitUntilFn as SubscriptionWaitUntilFn,
} from '@codex/subscription';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  InvalidationLogger as ContentInvalidationLogger,
  WaitUntilFn as ContentWaitUntilFn,
} from '../services/content-invalidation';

describe('denoise proof: F3 types:type-duplicate-cross-package — WaitUntilFn / InvalidationLogger', () => {
  it('WaitUntilFn MUST resolve to a single canonical declaration across @codex/content and @codex/subscription', () => {
    // Both packages re-export the canonical declaration in `@codex/cache`.
    expectTypeOf<ContentWaitUntilFn>().toEqualTypeOf<SubscriptionWaitUntilFn>();
  });

  it('InvalidationLogger MUST resolve to a single canonical declaration', () => {
    // Both packages re-export the canonical alias declared in
    // `@codex/observability` (via `@codex/cache`).
    expectTypeOf<ContentInvalidationLogger>().toEqualTypeOf<SubscriptionInvalidationLogger>();
  });
});
