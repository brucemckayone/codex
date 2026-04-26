/**
 * Denoise iter-028 F3 — proof test for
 * `types:type-duplicate-cross-package` (R11 — name collision with canonical
 * runtime class).
 *
 * Finding: `packages/security/src/kv-secondary-storage.ts:50` declares
 *   export interface ObservabilityClient {
 *     warn: (message: string, context?: Record<string, unknown>) => void;
 *   }
 *
 * — using the SAME NAME as the runtime class `ObservabilityClient` from
 * `@codex/observability` (line 45 imports it as `ObsClientImpl`):
 *
 *   import { ObservabilityClient as ObsClientImpl } from '@codex/observability';
 *
 * The local interface is a structural projection of just `Logger.warn` from
 * the canonical class. Two different declarations under the same name is
 * exactly the R11 anti-pattern that Tier 3.A consolidated for `Logger` /
 * `WaitUntilFn` / `InvalidationLogger` — this site was MISSED because the
 * inline declaration uses the runtime CLASS name, not `Logger`.
 *
 * Drift evidence:
 *   @codex/observability.ObservabilityClient — the full runtime class with
 *     warn/info/error/debug/perf/setRequestId/trackRequest/trackError, etc.
 *   security/kv-secondary-storage.ObservabilityClient (interface) — only
 *     `warn(message, context?): void`
 *
 * The NAME collision is the bug. A consumer reading
 *   import type { ObservabilityClient } from '@codex/security/kv-secondary-storage'
 * gets a 1-method projection; reading
 *   import { ObservabilityClient } from '@codex/observability'
 * gets the full class. Two different types under one name = drift waiting
 * to fire. Fallow already flags this interface as unused
 * (packages/security/src/kv-secondary-storage.ts:50 — fallow iter-028 line).
 *
 * Suggested fix: either
 *   (a) drop the inline interface, type fallbackObs as `Logger` or
 *       `Pick<Logger, 'warn'>` from @codex/observability, OR
 *   (b) rename the local interface to `KvStorageObsSink` to remove the
 *       name collision.
 *
 * Proof shape: type-equality (Catalogue row 3). The proof asserts the local
 * interface is NOT structurally equal to the canonical class — proving the
 * name collision shadows the canonical type.
 *
 * Severity: minor (no current runtime bug — the local interface is internal
 * to the file; fallback obs is the runtime class which satisfies the
 * narrower interface). The risk is name-collision confusion + drift.
 *
 * Remove the `.skip()` modifier in the same PR as the fix.
 */

import type { ObservabilityClient as CanonicalObservabilityClient } from '@codex/observability';
import { describe, expectTypeOf, it } from 'vitest';
import type { ObservabilityClient as LocalObservabilityClient } from '../kv-secondary-storage';

describe('denoise proof: F3 types:type-duplicate-cross-package — ObservabilityClient name collision', () => {
  it.skip('Local ObservabilityClient interface MUST equal canonical class instance shape (currently FAILS)', () => {
    // FAILS today because the local interface only declares `warn`, but the
    // canonical class instance has many more methods (info, error, debug,
    // setRequestId, trackRequest, trackError, perf, ...). The two cannot
    // be the same type under the same name. The fix removes the local
    // declaration in favour of an alias to `Logger` (or `Pick<Logger,'warn'>`).
    type CanonicalShape = InstanceType<typeof CanonicalObservabilityClient>;
    expectTypeOf<LocalObservabilityClient>().toEqualTypeOf<CanonicalShape>();
  });

  it.skip('Local ObservabilityClient should be `Pick<Logger, "warn">` from @codex/observability (R11 fix)', () => {
    // After the fix: the local interface is replaced with a Pick projection
    // from the canonical Logger. This proof PASSES once the fix lands.
    type LoggerWarnOnly = {
      warn(message: string, metadata?: Record<string, unknown>): void;
    };
    expectTypeOf<LocalObservabilityClient>().toEqualTypeOf<LoggerWarnOnly>();
  });
});
