/**
 * Denoise iter-030 F4 — `as unknown as` double-cast in worker
 * entry-points (RECURRENCE of Codex-lqvw4.10, fingerprint
 * `types:as-unknown-as`).
 *
 * Fingerprint: types:as-unknown-as (recurrence increment hits 2 → 3)
 * Severity: minor (same severity as iter-005 F5; entry-point bindings
 *   are well-known, the cast is a missing-generic shortcut, not a
 *   security or correctness hazard at runtime)
 *
 * **R7 STANDARD 3-HIT THRESHOLD REACHED THIS CYCLE**
 * (iter-005 + iter-006 + iter-030; cumulative cycle_density 5).
 * Sibling fingerprint to R15 — same family of "narrowing without
 * runtime guard" — but distinct in that `as unknown as` is the
 * 2-step form which R15 explicitly carves OUT of its scope ("`as
 * unknown as Foo` is a separate fingerprint and is NOT covered by
 * this rule's exceptions"). So this cycle's verdict is: queue R7
 * promotion as a sibling rule (R16 candidate) for next cycle's
 * prep, with permitted-exception list aligned to R15's intent
 * (Drizzle bridges, framework defaults, Proxy targets, type-test
 * scaffolding) — but NO carve-out for "missing generic on a worker
 * factory" because that's a fixable shortcut, not a framework
 * limitation.
 *
 * Site inventory (UNCHANGED from iter-005 F5 — Round 3 didn't touch):
 *
 *   workers/auth/src/index.ts:135
 *     const env = c.env as unknown as AuthBindings;
 *     // After test fast-register handler dispatch.
 *
 *   workers/media-api/src/index.ts:129
 *     const env = c.env as unknown as {
 *       ORPHAN_CLEANUP_DO: DurableObjectNamespace;
 *     };
 *     // Inside /internal/orphan-cleanup/* HMAC-guarded handler.
 *
 * Description:
 *
 *   Both casts exist because the worker's `createWorker(...)`
 *   call doesn't supply the typed environment generic. The
 *   admin-api worker uses the canonical pattern:
 *
 *     createWorker<AdminApiEnv>({ ... })
 *     // workers/admin-api/src/index.ts:58 — drops the cast
 *
 *   Fix is mechanical:
 *
 *   workers/auth/src/index.ts:
 *     - createWorker({ ... })
 *     + createWorker<AuthEnv>({ ... })
 *     - const env = c.env as unknown as AuthBindings;
 *     + // c.env is now AuthBindings directly
 *
 *   workers/media-api/src/index.ts:
 *     1. Add `type MediaBindings = SharedBindings & {
 *          ORPHAN_CLEANUP_DO?: DurableObjectNamespace;
 *        };` and `type MediaEnv = { Bindings: MediaBindings;
 *        Variables: SharedVariables };`
 *        in `workers/media-api/src/types.ts` (mirroring
 *        auth/src/types.ts).
 *     2. createWorker({ ... }) → createWorker<MediaEnv>({ ... })
 *     3. drop the cast at line 129.
 *
 *   Codex-lqvw4.10 has been OPEN since iter-005. Round 3
 *   (commits be00ddb1..253ffab4) didn't touch these entry-
 *   points, so the bead state is unchanged. This iteration
 *   adds a recurrence increment, NOT a new bead.
 *
 *   The R7 standard 3-hit threshold for `types:as-unknown-as`
 *   triggers a promotion candidate. The promoted rule shape:
 *
 *     R16 (proposed for iter-031 prep):
 *       Type assertions of the form `value as unknown as Foo`
 *       (the double-cast that bypasses TypeScript entirely)
 *       are forbidden in production code. Permitted only in:
 *         (a) Type-test scaffolding in `*.test.ts` files
 *             (`reason: type-test`)
 *         (b) Pragmatic framework-interop bridges where
 *             the third-party type system genuinely cannot
 *             express the relationship (`reason:
 *             framework-interop-cast`) — case-by-case
 *             review, with a documented external-issue link
 *             demonstrating the limitation.
 *       Verified by a per-package grep that lists every
 *       `as unknown as` cast NOT matching one of the
 *       reason codes.
 *
 *   The 2 sites in workers/* fall under NEITHER reason code
 *   under R16's intent — they're missing-generic shortcuts.
 *   Codex-lqvw4.10's fix would close both R16 violations.
 *
 *   The 2 OTHER known sites in packages/test-utils/src/
 *   stripe-mock.ts:165 and packages/worker-utils/src/
 *   procedure/multipart-procedure.ts:279 (per iter-004 +
 *   iter-005 inventory) are pragmatic framework-interop
 *   bridges — they would qualify for the new
 *   `framework-interop-cast` reason code under R16.
 *
 * Proof shape: Catalogue row 11 (structural grep guard).
 *   After Codex-lqvw4.10 lands:
 *   - grep -rE 'as[ ]+unknown[ ]+as' under workers slash-star slash src
 *     for *.ts (excluding __tests__) returns 0 hits (both sites cleaned).
 *   - `createWorker<AuthEnv>` and `createWorker<MediaEnv>`
 *     appear in the respective index.ts files.
 */
import { describe, it } from 'vitest';

describe.skip('iter-030 F4 — as unknown as recurrence in workers/* entry-points', () => {
  it('grep guard: zero `as unknown as` casts in workers/*/src', () => {
    // After fix:
    //   import { execSync } from 'node:child_process';
    //   const hits = execSync(
    //     "grep -rE 'as\\s+unknown\\s+as' workers/*/src " +
    //       "--include=*.ts | grep -v __tests__ || true",
    //     { encoding: 'utf-8' }
    //   ).trim();
    //   expect(hits).toBe('');
  });

  it('auth worker uses createWorker<AuthEnv> generic', () => {
    // After fix: index.ts contains 'createWorker<AuthEnv>('
  });

  it('media-api worker uses createWorker<MediaEnv> generic', () => {
    // After fix: index.ts contains 'createWorker<MediaEnv>('
    // AND types.ts exports MediaBindings + MediaEnv mirroring
    // workers/auth/src/types.ts.
  });
});
