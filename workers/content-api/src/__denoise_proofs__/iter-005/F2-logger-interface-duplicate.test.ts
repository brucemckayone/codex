/**
 * Denoise iter-005 F2 — Inline `Logger` interface duplicated across worker route files.
 *
 * Fingerprint: types:type-duplicate-cross-package
 * Severity: major (recurrence — iter-004 cycle_density=6 + iter-005 +2 instances → endemic)
 *
 * Pre-fix sites (now removed):
 *   - workers/content-api/src/routes/content.ts:54
 *   - workers/organization-api/src/routes/settings.ts:48
 *   - workers/organization-api/src/routes/members.ts:40
 *   - packages/cloudflare-clients/src/cache/client.ts:4
 *
 * After Tier 3.A fix (Codex-lqvw4.7):
 *   - Canonical `Logger` interface lives in `@codex/observability` (the package
 *     that owns `ObservabilityClient` — which structurally satisfies `Logger`).
 *   - `InvalidationLogger` is preserved as a back-compat alias in
 *     `@codex/observability` and re-exported from `@codex/cache`,
 *     `@codex/content`, and `@codex/subscription`.
 *   - Worker route files and `@codex/cloudflare-clients` import
 *     `import type { Logger } from '@codex/observability'` directly.
 *
 * Proof shape: Catalogue row 3 (type-equality test). Worker tests run in the
 * workerd pool which has no `node:child_process` — the grep-style guard for
 * this rule lives at `packages/content/src/__denoise_proofs__/iter-004/F3-*`
 * (which runs in the node pool) so we keep that pattern out of this file.
 */
import type {
  InvalidationLogger,
  Logger,
  ObservabilityClient,
} from '@codex/observability';
import { describe, expectTypeOf, it } from 'vitest';

describe('iter-005 F2 — duplicate Logger interface (proof)', () => {
  it('Logger ≡ InvalidationLogger (canonical structural alias)', () => {
    // After consolidation both names resolve to the same declaration in
    // `@codex/observability` — `InvalidationLogger` is `type InvalidationLogger = Logger;`.
    expectTypeOf<InvalidationLogger>().toEqualTypeOf<Logger>();
  });

  it('ObservabilityClient structurally satisfies Logger', () => {
    // The canonical concrete implementation must conform to the canonical
    // structural type. If a future change splits these (e.g. ObservabilityClient
    // drops `error`), every Logger consumer becomes a compile error here first.
    //
    // `toExtend<Logger>()` is the right matcher here — Logger has optional
    // methods (`info?`, `error?`) so it isn't a strict object literal that
    // `toMatchObjectType` accepts. `toExtend` checks structural assignability,
    // which is what "satisfies" means in TypeScript.
    expectTypeOf<ObservabilityClient>().toExtend<Logger>();
  });
});
