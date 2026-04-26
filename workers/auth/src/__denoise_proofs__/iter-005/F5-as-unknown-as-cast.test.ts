/**
 * Denoise iter-005 F5 — `as unknown as` double-cast in worker entry-points.
 *
 * Fingerprint: types:as-unknown-as
 * Severity: minor (workers-side recurrence; iter-004 deferred this fingerprint
 *  because the only 2 instances were in test/multipart helpers — now there are
 *  2 production instances in worker entry-point files)
 * File:Line:
 *   - workers/auth/src/index.ts:135 (`c.env as unknown as AuthBindings`)
 *   - workers/media-api/src/index.ts:129
 *     (`c.env as unknown as { ORPHAN_CLEANUP_DO: DurableObjectNamespace }`)
 *
 * Description:
 *
 *   `as unknown as` is the canonical "I'm bypassing TypeScript"
 *   double-cast (ref 02 §7 row 10). Two new production instances:
 *
 *   1. workers/auth/src/index.ts:135 — `app` is created via
 *      `createWorker({ ... })` with no explicit generic; the
 *      auth worker's `AuthBindings` (which extends shared
 *      `Bindings`) is narrower than the default `HonoEnv`. The
 *      fix is to instantiate as
 *      `createWorker<AuthEnv>({ ... })` so `c.env` is typed
 *      `AuthBindings` directly. The admin-api worker already
 *      uses this pattern (see
 *      workers/admin-api/src/index.ts:58:
 *      `createWorker<AdminApiEnv>({ ... })`) — auth worker should
 *      mirror it.
 *
 *   2. workers/media-api/src/index.ts:129 — uses
 *      `c.env as unknown as { ORPHAN_CLEANUP_DO: DurableObjectNamespace }`.
 *      `ORPHAN_CLEANUP_DO` is a worker-specific binding not
 *      declared in shared `Bindings` (because it's a Durable
 *      Object specific to media-api). The fix is to declare a
 *      `MediaBindings extends SharedBindings` type (mirroring
 *      `AuthBindings`/`AdminVariables`) and instantiate
 *      `createWorker<MediaEnv>({ ... })`.
 *
 *   Both cases are the same root cause: workers with bindings
 *   beyond the shared shape don't declare a typed env. The
 *   pattern of using `createWorker<TEnv>` is already established
 *   for admin-api — both workers should adopt it.
 *
 *   iter-004 deferred this fingerprint because the only sites
 *   were `packages/test-utils/src/stripe-mock.ts:165` and
 *   `packages/worker-utils/src/procedure/multipart-procedure.ts:279`
 *   — both pragmatic framework-interop exceptions. These two
 *   worker-side instances are NOT pragmatic — they're a missing
 *   generic instantiation. So they cross the threshold from
 *   "track for 3rd instance" to a real finding.
 *
 *   Fix:
 *   - workers/auth/src/index.ts: change `createWorker({ ... })`
 *     to `createWorker<AuthEnv>({ ... })` and drop the cast at
 *     line 135 (`c.env` already `AuthBindings`)
 *   - workers/media-api/src/index.ts: declare
 *     `type MediaBindings = Bindings & { ORPHAN_CLEANUP_DO?:
 *     DurableObjectNamespace }`, change `createWorker(...)` to
 *     `createWorker<MediaEnv>(...)`, drop cast at line 129
 *
 * Proof shape: Catalogue row 3 (type-equality test) + grep guard.
 * The type-eq asserts that after the fix, `c.env` directly
 * resolves to the typed binding shape. Grep guard asserts zero
 * `as unknown as` in worker source files.
 */
import { describe, it } from 'vitest';

describe.skip('iter-005 F5 — as-unknown-as in worker entry-points (proof)', () => {
  it('auth worker c.env is AuthBindings without cast', () => {
    // After fix:
    //   import { expectTypeOf } from 'vitest';
    //   // Once createWorker<AuthEnv>({ ... }) is wired, the Hono
    //   // app's c.env is AuthBindings directly. We re-import a
    //   // representative typed handler and expectTypeOf its env.
  });

  it('grep guard: zero `as unknown as` casts in workers/*/src', () => {
    // After fix:
    //   const hits = execSync(
    //     "grep -rE 'as\\s+unknown\\s+as' workers/*/src --include=*.ts " +
    //       "| grep -v __tests__ || true",
    //     { encoding: 'utf-8' }
    //   ).trim();
    //   expect(hits).toBe('');
  });
});
