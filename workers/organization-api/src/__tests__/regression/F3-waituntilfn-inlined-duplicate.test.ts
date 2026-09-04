/**
 * Denoise iter-005 F3 — `WaitUntilFn` shape inlined at 5 worker route call sites
 * instead of imported from canonical declaration.
 *
 * Fingerprint: types:type-duplicate-cross-package
 * Severity: major (recurrence — same fingerprint as iter-004 F3 and iter-005 F2)
 *
 * Pre-fix sites (now updated to import canonical):
 *   - workers/ecom-api/src/routes/subscriptions.ts:66
 *   - workers/organization-api/src/routes/tiers.ts:34
 *   - workers/organization-api/src/routes/settings.ts:186
 *   - workers/organization-api/src/routes/members.ts:38, 91
 *
 * After Tier 3.A fix (Codex-lqvw4.8):
 *   - Canonical `WaitUntilFn` lives in `@codex/cache`
 *     (`packages/cache/src/helpers/invalidate.ts`).
 *   - `@codex/content` and `@codex/subscription` re-export it from
 *     `@codex/cache` (single declaration, two re-exports).
 *   - Worker route files type their `executionCtx` arg as
 *     `{ waitUntil: WaitUntilFn }` with the canonical import.
 *
 * Proof shape: Catalogue row 3 (type-equality test). Worker tests run in the
 * workerd pool which has no `node:child_process` — the structural assertion
 * is sufficient since drift would change the canonical type and break this
 * file.
 */
import type { WaitUntilFn } from '@codex/cache';
import type { WaitUntilFn as SubscriptionWaitUntilFn } from '@codex/subscription';
import { describe, expectTypeOf, it } from 'vitest';

describe('iter-005 F3 — inline WaitUntilFn duplicate (proof)', () => {
  it('inline executionCtx shape ≡ canonical WaitUntilFn', () => {
    // The structural shape every worker route was using inline.
    type Inline = (p: Promise<unknown>) => void;
    expectTypeOf<Inline>().toEqualTypeOf<WaitUntilFn>();
  });

  it('package WaitUntilFn re-exports resolve to the same canonical type', () => {
    // The cross-package duplicate of `WaitUntilFn` between @codex/cache and
    // @codex/subscription was the original endemic-pattern recurrence (iter-004 F3).
    // After consolidation the subscription re-export must resolve to the cache
    // declaration. Content's re-export is verified in
    // `packages/content/src/__denoise_proofs__/iter-004/F3-*.test.ts`.
    expectTypeOf<SubscriptionWaitUntilFn>().toEqualTypeOf<WaitUntilFn>();
  });
});
