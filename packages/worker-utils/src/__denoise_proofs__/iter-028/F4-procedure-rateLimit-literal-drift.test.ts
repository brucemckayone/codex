/**
 * Denoise iter-028 F4 — proof test for
 * `types:literal-union-drift-vs-runtime-presets` (NEW fingerprint — first
 * sighting in this cycle; will be added to recurrence ledger).
 *
 * Finding: `packages/worker-utils/src/procedure/types.ts:190` declares
 *
 *   rateLimit?: 'api' | 'auth' | 'strict' | 'public' | 'webhook' | 'streaming';
 *
 * — but `RATE_LIMIT_PRESETS` in `@codex/security/src/rate-limit.ts:256` exposes
 * the keys: `'api' | 'auth' | 'strict' | 'streaming' | 'webhook' | 'web'`.
 *
 * Drift: the procedure type allows `'public'` (which has no preset entry) and
 * disallows `'web'` (which is the actual preset key 300 req/min). This is a
 * type-system lie: a route that declares `policy.rateLimit = 'public'`
 * compiles, but at runtime the value is never matched against a preset (the
 * `policy.rateLimit` field is currently merged but not actually applied — see
 * helpers.ts:440 — so today this is a latent bug, not a runtime fault).
 *
 * Fix shape: derive the union from `keyof typeof RATE_LIMIT_PRESETS` so the
 * type tracks the runtime presets:
 *
 *   import type { RATE_LIMIT_PRESETS } from '@codex/security';
 *   rateLimit?: keyof typeof RATE_LIMIT_PRESETS;
 *
 * (This mirrors what `middleware-chain.ts:61` already does — the procedure
 * surface should match.)
 *
 * Proof shape: type-equality (Catalogue row 3) — assert ProcedurePolicy's
 * rateLimit literal union equals `keyof typeof RATE_LIMIT_PRESETS`. FAILS
 * today (`'public'` ≠ `'web'`), PASSES after the fix.
 *
 * Severity: minor (no observed runtime bug because procedure() doesn't
 * actually wire policy.rateLimit through to the rate limiter today; the
 * application path is via `createWorker` middleware-chain which already
 * uses the keyof-derived type). The bug is the type-system contract drift.
 *
 * Remove the `.skip()` modifier in the same PR as the fix.
 */

import type { RATE_LIMIT_PRESETS } from '@codex/security';
import { describe, expectTypeOf, it } from 'vitest';
import type { ProcedurePolicy } from '../../procedure/types';

type ProcedureRateLimitLiteralUnion = NonNullable<ProcedurePolicy['rateLimit']>;
type CanonicalPresetKeys = keyof typeof RATE_LIMIT_PRESETS;

describe('denoise proof: F4 types:literal-union-drift-vs-runtime-presets — procedure rateLimit', () => {
  it.skip('ProcedurePolicy.rateLimit literal union MUST equal keyof RATE_LIMIT_PRESETS', () => {
    // FAILS today: ProcedurePolicy includes 'public' (no preset),
    // RATE_LIMIT_PRESETS includes 'web' (no procedure literal).
    // After the fix, both sides are `keyof typeof RATE_LIMIT_PRESETS`.
    expectTypeOf<ProcedureRateLimitLiteralUnion>().toEqualTypeOf<CanonicalPresetKeys>();
  });
});
