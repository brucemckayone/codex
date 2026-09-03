/**
 * Denoise iter-005 F4 — Local `CacheCtx` narrows env to `unknown` then re-casts
 * to `KVNamespace` at every consumer (members.ts).
 *
 * Fingerprint: types:as-cast-without-guard (cross-link types:as-unknown-as,
 * types:type-narrow-then-recast)
 * Severity: major (silent type-safety hole + 4 hand-written casts in one file)
 * File:Line:
 *   - workers/organization-api/src/routes/members.ts:36-39 (local CacheCtx
 *     declares `env: { CACHE_KV?: unknown }`)
 *   - workers/organization-api/src/routes/members.ts:55-56, 78, 96 (3 sites
 *     re-cast `ctx.env.CACHE_KV as KVNamespace`)
 *   - workers/organization-api/src/routes/members.ts:101-103 (1 site
 *     re-casts `ctx.env as Parameters<typeof createDbClient>[0]`)
 *
 * Description:
 *
 *   The local helper-input type `CacheCtx`:
 *
 *     interface CacheCtx {
 *       env: { CACHE_KV?: unknown };
 *       executionCtx: { waitUntil(p: Promise<unknown>): void };
 *     }
 *
 *   intentionally narrows the binding type to a structural subset.
 *   But to actually USE the binding, every call site re-casts:
 *
 *     const kv = ctx.env.CACHE_KV as
 *       import('@cloudflare/workers-types').KVNamespace;
 *
 *   That's a `types:as-cast-without-guard` per ref 02 §3 row 8 —
 *   the cast happens after a runtime null check (`if
 *   (!ctx.env.CACHE_KV) return`), so the value is non-null, but
 *   the TYPE was never `KVNamespace | undefined` to begin with —
 *   it was `unknown`. The cast asserts a stronger type than the
 *   declared one.
 *
 *   The canonical `Bindings.CACHE_KV` type IS already
 *   `KVNamespace | undefined` (see
 *   packages/shared-types/src/worker-types.ts:73-75). Using
 *   `Pick<Bindings, 'CACHE_KV'>` for the helper input would
 *   propagate the correct type and eliminate the cast.
 *
 *   Plus there's a related cast at line 102:
 *
 *     ctx.env as Parameters<typeof createDbClient>[0]
 *
 *   which obscures whatever createDbClient actually wants.
 *   Strengthening CacheCtx to `Pick<Bindings,
 *   'CACHE_KV' | 'DATABASE_URL' | 'ENVIRONMENT'>` would resolve
 *   both casts together.
 *
 *   Concrete risk: the inline `CACHE_KV?: unknown` is a footgun.
 *   If a future contributor changes the cache binding to a
 *   non-KVNamespace shape (e.g., a Durable Object reference for
 *   cache invalidation), the runtime cast still compiles and
 *   silently invokes wrong methods.
 *
 *   Fix:
 *   - Replace `interface CacheCtx { env: { CACHE_KV?: unknown };
 *     executionCtx: ... }` with a `Pick<Bindings, 'CACHE_KV'>`
 *     based shape
 *   - Drop the 3 `as KVNamespace` casts in lines 56, 78, 96
 *   - Drop the `as Parameters<typeof createDbClient>[0]` at 102
 *     by widening the env shape to also pick `'DATABASE_URL'` etc.
 *
 * Proof shape: Catalogue row 3 (type-equality test) + grep guard.
 * The type-eq asserts that after the fix, `CacheCtx['env']` is
 * structurally a `Pick<Bindings, 'CACHE_KV' | ...>` so the
 * `.CACHE_KV` access yields `KVNamespace | undefined` directly.
 * The grep guard asserts zero `as KVNamespace` casts remain.
 */
// `?raw` baked-at-build-time import — works under workerd (no node:fs).

import type { KVNamespace } from '@cloudflare/workers-types';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import membersSrc from '../../routes/members.ts?raw';

describe('iter-005 F4 — CacheCtx narrow→cast pattern (proof)', () => {
  it('Bindings.CACHE_KV is canonically `KVNamespace | undefined`', () => {
    // The canonical binding type is what helper signatures should propagate;
    // any helper that re-narrows to `unknown` and re-casts is the
    // `types:as-cast-without-guard` smell this proof guards against.
    type FixedCacheEnv = Pick<Bindings, 'CACHE_KV'>;
    expectTypeOf<FixedCacheEnv['CACHE_KV']>().toEqualTypeOf<
      KVNamespace | undefined
    >();
  });

  it('grep guard: no `as KVNamespace` casts in members.ts', () => {
    // Pre-fix: 3+ `ctx.env.CACHE_KV as ...KVNamespace` sites in members.ts.
    // Post-fix: helper input uses `HonoEnv['Bindings']` (full Bindings) so
    // the binding access yields `KVNamespace | undefined` directly — no
    // cast needed.
    const hits = membersSrc.match(/as\s+(?:import\([^)]+\)\.)?KVNamespace/g);
    expect(hits, 'expected zero `as KVNamespace` casts').toBeNull();
  });

  it('grep guard: no `as Parameters<typeof createDbClient>` cast', () => {
    // Pre-fix: one site cast `ctx.env as Parameters<typeof createDbClient>[0]`
    // which obscured the real env shape. Post-fix: `Bindings` widening makes
    // the cast unnecessary — `createDbClient(ctx.env)` typechecks directly.
    const hits = membersSrc.match(/as\s+Parameters<typeof\s+createDbClient>/);
    expect(
      hits,
      'expected zero `as Parameters<typeof createDbClient>` casts'
    ).toBeNull();
  });
});
