/**
 * TYPE-LEVEL proof for the auth-level x cache-preset rule (`CachePolicyRule`).
 *
 * There is no runtime here. Every assertion is a `procedure()` call the
 * COMPILER must accept or reject, and the whole file is the assertion: it
 * compiles clean if and only if the rule holds in both directions.
 *
 * WHY THIS IS NOT A `*.test.ts` FILE. `packages/worker-utils/tsconfig.json`
 * excludes `**\/*.test.ts` and `**\/*.spec.ts`, and vitest transpiles without
 * typechecking — so a type assertion written in a `.test.ts` file is checked by
 * NOTHING, and `@ts-expect-error` in one would be inert decoration. The
 * `.type-check.ts` suffix falls inside `include: ['src/**\/*']` and outside both
 * exclusions, so `pnpm --filter @codex/worker-utils typecheck` reads it; the
 * vitest default include (`src/**\/*.{test,spec}.{js,ts}`) does not match it, so
 * the runner never tries to execute it.
 *
 * HOW EACH DIRECTION IS PROVEN.
 *  - ILLEGAL pairings carry `// @ts-expect-error`. That directive FAILS the
 *    build when the expected error does NOT occur (TS2578, "Unused
 *    '@ts-expect-error' directive"), so weakening the rule turns this file red.
 *    A plain negative test could not do that: an assertion that "this does not
 *    compile" is unwritable in ordinary code.
 *  - LEGAL pairings are written bare. A rule that over-rejects — one that
 *    refuses `auth: 'none' + cache: 'public'`, say — turns this file red too.
 *    Without them, `CachePolicyRule<P> = never` would pass every negative
 *    assertion and be completely wrong.
 *
 * The handler bodies also read `ctx.user` / `ctx.organizationId`, so a rule that
 * broke the existing conditional inference (the auth level decides whether
 * `ctx.user` is `UserData` or `undefined`; `requireOrgMembership` decides
 * whether `ctx.organizationId` is `string`) would be caught here rather than
 * across 200+ route files.
 *
 * WHY THE UNION CASES AT THE BOTTOM ARE THE MOST IMPORTANT ONES HERE. An
 * earlier version of this file proved the rule against single literals only,
 * and the rule passed every one of those while being switched off entirely by a
 * union: `CacheRuleFor` tested the naked type parameter, so `cache: FLAG ?
 * 'public' : 'private'` on `auth: 'required'` distributed to
 * `CachePolicyViolation<…> | unknown`, which collapses to `unknown` — a no-op
 * in the intersection. That form compiled clean through this package's
 * typecheck, content-api's typecheck AND the CI contract gate. Literal-only
 * proof cannot tell a working rule from that one, so every future preset or
 * auth level added here gets a union case as well as a literal case.
 */

import { z } from 'zod';
import { binaryUploadProcedure } from '../binary-upload-procedure';
import { multipartProcedure } from '../multipart-procedure';
import { procedure } from '../procedure';

/**
 * A value the compiler knows only as `boolean` — the shape a feature flag,
 * `env` read or config lookup has at a real call site. Used to build UNION
 * types (`FLAG ? 'public' : 'private'` is `'public' | 'private'`) rather than
 * literals. Not `declare const`: this has to be the same widened `boolean` an
 * ordinary module-level flag is.
 */
const FLAG: boolean = Date.now() > 0;

// ============================================================================
// LEGAL — no annotation. These must all compile.
// ============================================================================

// --- auth: 'none' may declare ANY preset ----------------------------------
// Deliberately no count of them in this heading: `CachePresetName` is derived
// from `CACHE_PRESETS`, the set grew from four to six mid-epic, and a heading
// that states the size is a claim that rots without failing anything.
export const nonePublic = procedure({
  policy: { auth: 'none', cache: 'public' },
  handler: async () => ({ ok: true }),
});

// The two long viewer-invariant windows. Legal ONLY here: `static` carries
// `stale-while-revalidate` and `asset` a 24h `s-maxage`, so on any route that
// can see a session they are the 2026-05 leak with a longer window.
export const noneStatic = procedure({
  policy: { auth: 'none', cache: 'static' },
  handler: async () => ({ ok: true }),
});

export const noneAsset = procedure({
  policy: { auth: 'none', cache: 'asset' },
  handler: async () => ({ ok: true }),
});

export const nonePerViewer = procedure({
  policy: { auth: 'none', cache: 'per-viewer' },
  handler: async () => ({ ok: true }),
});

export const nonePrivate = procedure({
  policy: { auth: 'none', cache: 'private' },
  handler: async () => ({ ok: true }),
});

export const noneFresh = procedure({
  policy: { auth: 'none', cache: 'fresh' },
  handler: async () => ({ ok: true }),
});

// --- auth: 'optional' ------------------------------------------------------
// `public` IS legal here, but only alongside the explicit assertion that the
// body ignores the session. This is the carve-out the journeys portal reads
// need; see ProcedurePolicy.variesBySession.
export const optionalPublicAsserted = procedure({
  policy: { auth: 'optional', cache: 'public', variesBySession: false },
  handler: async (ctx) => ({ signedIn: ctx.user !== undefined }),
});

export const optionalPerViewer = procedure({
  policy: { auth: 'optional', cache: 'per-viewer' },
  handler: async (ctx) => ({ signedIn: ctx.user !== undefined }),
});

export const optionalPrivate = procedure({
  policy: { auth: 'optional', cache: 'private' },
  handler: async () => ({ ok: true }),
});

export const optionalFresh = procedure({
  policy: { auth: 'optional', cache: 'fresh' },
  handler: async () => ({ ok: true }),
});

// `variesBySession: false` on its own is inert, not an error — a route may
// document the fact without asking for a shared-cache window.
export const optionalAssertedNoCache = procedure({
  policy: { auth: 'optional', variesBySession: false },
  handler: async () => ({ ok: true }),
});

// --- authenticated levels: private | fresh --------------------------------
export const requiredPrivate = procedure({
  policy: { auth: 'required', cache: 'private' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const requiredFresh = procedure({
  policy: { auth: 'required', cache: 'fresh' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const workerPrivate = procedure({
  policy: { auth: 'worker', cache: 'private' },
  handler: async () => ({ ok: true }),
});

export const workerFresh = procedure({
  policy: { auth: 'worker', cache: 'fresh' },
  handler: async () => ({ ok: true }),
});

export const platformOwnerPrivate = procedure({
  policy: { auth: 'platform_owner', cache: 'private' },
  handler: async (ctx) => ({ orgId: ctx.organizationId }),
});

export const platformOwnerFresh = procedure({
  policy: { auth: 'platform_owner', cache: 'fresh' },
  handler: async (ctx) => ({ orgId: ctx.organizationId }),
});

// ============================================================================
// LEGAL — the 200+ existing call sites, which declare no cache at all.
// These resolve to `private` at runtime and must keep compiling untouched.
// ============================================================================

export const undeclaredRequired = procedure({
  policy: { auth: 'required' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const undeclaredNoPolicy = procedure({
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const undeclaredNone = procedure({
  policy: { auth: 'none' },
  handler: async () => ({ ok: true }),
});

export const undeclaredOptional = procedure({
  policy: { auth: 'optional' },
  handler: async (ctx) => ({ signedIn: ctx.user !== undefined }),
});

export const undeclaredWorker = procedure({
  policy: { auth: 'worker' },
  handler: async () => ({ ok: true }),
});

export const undeclaredPlatformOwner = procedure({
  policy: { auth: 'platform_owner' },
  handler: async (ctx) => ({ orgId: ctx.organizationId.length }),
});

// The full-fat shape a real route uses, with a preset added. `ctx.organizationId`
// must still narrow to `string` (not `string | undefined`) off
// `requireOrgMembership: true`, and `ctx.input` must still infer from the Zod
// schemas — the intersection that carries the cache rule must not disturb
// either.
export const realisticRoute = procedure({
  policy: {
    auth: 'required',
    roles: ['creator', 'admin'],
    requireOrgMembership: true,
    rateLimit: 'strict',
    cache: 'private',
  },
  input: {
    params: z.object({ contentId: z.string() }),
    query: z.object({ page: z.coerce.number().optional() }),
  },
  successStatus: 201,
  handler: async (ctx) => ({
    orgId: ctx.organizationId.length,
    contentId: ctx.input.params.contentId,
    page: ctx.input.query.page,
    userId: ctx.user.id,
  }),
});

export const managementRoute = procedure({
  policy: {
    auth: 'required',
    requireOrgManagement: true,
    cache: 'fresh',
  },
  handler: async (ctx) => ({ orgId: ctx.organizationId.length }),
});

// ============================================================================
// ILLEGAL — each `@ts-expect-error` fails the build if the error disappears.
// ============================================================================

// --- authenticated + a shared-cache preset --------------------------------
// The leak this whole rule exists to prevent: shared caches key on URL and
// NEVER on Cookie, so a stored `public` body is handed to the next viewer.
export const requiredPublic = procedure({
  // @ts-expect-error auth: 'required' may not declare cache: 'public'
  policy: { auth: 'required', cache: 'public' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const requiredPerViewer = procedure({
  // @ts-expect-error auth: 'required' may not declare cache: 'per-viewer'
  policy: { auth: 'required', cache: 'per-viewer' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const workerPublic = procedure({
  // @ts-expect-error auth: 'worker' may not declare cache: 'public'
  policy: { auth: 'worker', cache: 'public' },
  handler: async () => ({ ok: true }),
});

export const workerPerViewer = procedure({
  // @ts-expect-error auth: 'worker' may not declare cache: 'per-viewer'
  policy: { auth: 'worker', cache: 'per-viewer' },
  handler: async () => ({ ok: true }),
});

export const platformOwnerPublic = procedure({
  // @ts-expect-error auth: 'platform_owner' may not declare cache: 'public'
  policy: { auth: 'platform_owner', cache: 'public' },
  handler: async () => ({ ok: true }),
});

export const platformOwnerPerViewer = procedure({
  // @ts-expect-error auth: 'platform_owner' may not declare cache: 'per-viewer'
  policy: { auth: 'platform_owner', cache: 'per-viewer' },
  handler: async () => ({ ok: true }),
});

// An omitted `auth` resolves to 'required' — the same default
// `enforcePolicyInline` applies — so it is bound by the same table.
export const impliedRequiredPublic = procedure({
  // @ts-expect-error omitted auth defaults to 'required', which may not declare cache: 'public'
  policy: { cache: 'public' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const impliedRequiredPerViewer = procedure({
  // @ts-expect-error omitted auth defaults to 'required', which may not declare cache: 'per-viewer'
  policy: { cache: 'per-viewer' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

// --- auth: 'optional' + public without the assertion ----------------------
export const optionalPublicUnasserted = procedure({
  // @ts-expect-error auth: 'optional' + cache: 'public' requires variesBySession: false
  policy: { auth: 'optional', cache: 'public' },
  handler: async (ctx) => ({ signedIn: ctx.user !== undefined }),
});

export const optionalPublicAssertedTrue = procedure({
  // @ts-expect-error variesBySession: true is the dangerous case, not the assertion
  policy: { auth: 'optional', cache: 'public', variesBySession: true },
  handler: async (ctx) => ({ signedIn: ctx.user !== undefined }),
});

// --- the full-fat shape does not launder a violation ----------------------
// The rule is enforced on the `policy` PROPERTY, so that is where the error
// lands — not on the offending `cache:` line inside the object. Worth knowing
// when reading a real failure.
export const realisticRoutePublic = procedure({
  // @ts-expect-error a violation is still a violation inside a full policy
  policy: {
    auth: 'required',
    roles: ['creator'],
    requireOrgMembership: true,
    cache: 'public',
  },
  handler: async (ctx) => ({ orgId: ctx.organizationId.length }),
});

// --- a preset name that is not one of the four ----------------------------
export const unknownPreset = procedure({
  // @ts-expect-error 'public, max-age=60' is a header value, not a preset name
  policy: { auth: 'none', cache: 'public, max-age=60' },
  handler: async () => ({ ok: true }),
});

// ============================================================================
// The upload procedures share ProcedurePolicy, so the rule has to be wired
// into their configs too. Nothing else in the repo proves that it is.
// ============================================================================

export const multipartPrivate = multipartProcedure({
  policy: { auth: 'required', cache: 'private' },
  files: {
    avatar: { required: true, maxSize: 1024, allowedMimeTypes: ['image/png'] },
  },
  handler: async (ctx) => ({ size: ctx.files.avatar.size }),
});

export const multipartPublic = multipartProcedure({
  // @ts-expect-error an upload route is authenticated; it may not declare cache: 'public'
  policy: { auth: 'required', cache: 'public' },
  handler: async () => ({ ok: true }),
});

export const binaryFresh = binaryUploadProcedure({
  policy: { auth: 'required', cache: 'fresh' },
  handler: async (ctx) => ({ size: ctx.file.size }),
});

export const binaryPerViewer = binaryUploadProcedure({
  // @ts-expect-error an upload route is authenticated; it may not declare cache: 'per-viewer'
  policy: { auth: 'required', cache: 'per-viewer' },
  handler: async () => ({ ok: true }),
});

// ============================================================================
// LEGAL — UNIONS EVERY MEMBER OF WHICH IS PERMITTED.
//
// These exist so the union fix cannot be "reject anything that is not a single
// literal", which would pass every negative assertion below while being wrong.
// A union is legal exactly when the strictest reading of the auth level permits
// EVERY member of the cache union — the emitted header is then one of a set of
// legal headers, whichever arm was built.
// ============================================================================

export const unionCacheBothLegal = procedure({
  policy: { auth: 'required', cache: FLAG ? 'private' : 'fresh' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

// A union AUTH level is judged by its strictest member ('private' | 'fresh'),
// and 'private' is in that set — so this compiles while `unionAuthPublic`
// below does not.
export const unionAuthBothLegal = procedure({
  policy: { auth: FLAG ? 'required' : 'worker', cache: 'private' },
  handler: async () => ({ ok: true }),
});

export const unionCacheNoneAuth = procedure({
  policy: { auth: 'none', cache: FLAG ? 'static' : 'asset' },
  handler: async () => ({ ok: true }),
});

// The `variesBySession: false` carve-out applies to a union too: with the
// assertion present, both 'public' and 'per-viewer' are permitted on
// auth: 'optional', so the union of them is permitted.
export const unionCacheOptionalAsserted = procedure({
  policy: {
    auth: 'optional',
    cache: FLAG ? 'public' : 'per-viewer',
    variesBySession: false,
  },
  handler: async (ctx) => ({ signedIn: ctx.user !== undefined }),
});

// ============================================================================
// ILLEGAL — UNION FORMS. THE REPRODUCED BYPASS.
//
// Each of these compiled CLEAN before `CacheRuleFor` was made
// non-distributive — through this package's typecheck, content-api's typecheck
// and the CI contract gate — while the single-literal twin above errored
// correctly. A rule proven only against literals cannot see the difference,
// which is exactly how it shipped.
// ============================================================================

// THE case. `cache: FLAG ? 'public' : 'private'` distributed to
// `CachePolicyViolation<…> | unknown`, and `X | unknown` is `unknown`.
export const unionCachePublicOnRequired = procedure({
  // @ts-expect-error a union containing 'public' is still 'public' on auth: 'required'
  policy: { auth: 'required', cache: FLAG ? 'public' : 'private' },
  handler: async () => ({ ok: true }),
});

// The same collapse through `CachePresetForAuth<TAuth>`: distributing over
// `'required' | 'none'` UNIONED the two allowed sets, so the 'none' arm's
// permission licensed the 'required' arm's response.
export const unionAuthPublic = procedure({
  // @ts-expect-error a union of auth levels is bound by its strictest member
  policy: { auth: FLAG ? 'required' : 'none', cache: 'public' },
  handler: async () => ({ ok: true }),
});

// Not only 'public': the same hole hid the two long windows.
export const unionCacheStaticOnRequired = procedure({
  // @ts-expect-error a union containing 'static' is a shared window on an authenticated route
  policy: { auth: 'required', cache: FLAG ? 'static' : 'fresh' },
  handler: async () => ({ ok: true }),
});

// Without the assertion, 'public' is illegal on auth: 'optional' — and hiding
// it in a union with a legal preset does not change that.
export const unionCacheOptionalUnasserted = procedure({
  // @ts-expect-error auth: 'optional' + a union containing 'public' still needs variesBySession: false
  policy: { auth: 'optional', cache: FLAG ? 'public' : 'per-viewer' },
  handler: async () => ({ ok: true }),
});

// The THIRD input to the rule takes union input too. A widened `boolean` is not
// the literal `false`, so the carve-out is refused — an assertion the compiler
// cannot read is not an assertion.
export const unionInvariantFlag = procedure({
  // @ts-expect-error variesBySession must be the literal false, not a boolean
  policy: { auth: 'optional', cache: 'public', variesBySession: FLAG },
  handler: async () => ({ ok: true }),
});

// A union at the level of the POLICY OBJECT, not of one property. `DeclaredAuth`
// and `DeclaredCache` are distributive over `TPolicy` (deliberately — see their
// comments), so this arrives at the rule as `TAuth = 'required' | 'none'`, which
// the tuple test then reads as the strictest member.
export const unionPolicyObject = procedure({
  // @ts-expect-error the arm that is auth: 'required' may not declare cache: 'public'
  policy: FLAG
    ? { auth: 'required' as const, cache: 'public' as const }
    : { auth: 'none' as const, cache: 'public' as const },
  handler: async () => ({ ok: true }),
});

// A union policy where only ONE arm declares a preset. `DeclaredCache` resolves
// to `'public' | undefined`, which a whole-type test would read as "no preset
// declared" and skip — while `resolveCacheControl` would emit `public` off the
// arm that was actually built. `Extract<TCache, CachePresetName>` in
// `CacheRuleFor` is what keeps this caught.
export const unionPolicyPartialCache = procedure({
  // @ts-expect-error the arm that declares cache: 'public' is still judged
  policy: FLAG
    ? { auth: 'required' as const, cache: 'public' as const }
    : { auth: 'required' as const },
  handler: async () => ({ ok: true }),
});

// ============================================================================
// ILLEGAL — the two long viewer-invariant windows on a session-aware route.
//
// `static` carries `stale-while-revalidate=86400` and `asset` an `s-maxage` of
// 24h, so these are the 2026-05 `DYNAMIC_PUBLIC_REVALIDATE` leak with a much
// longer window and no purge path. The `variesBySession: false` carve-out is
// `public` ALONE and deliberately does not extend to them (see `AllowedCache`).
// ============================================================================

export const requiredStatic = procedure({
  // @ts-expect-error auth: 'required' may not declare cache: 'static'
  policy: { auth: 'required', cache: 'static' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const requiredAsset = procedure({
  // @ts-expect-error auth: 'required' may not declare cache: 'asset'
  policy: { auth: 'required', cache: 'asset' },
  handler: async (ctx) => ({ userId: ctx.user.id }),
});

export const optionalStaticAsserted = procedure({
  // @ts-expect-error the variesBySession carve-out licenses 'public' only, not 'static'
  policy: { auth: 'optional', cache: 'static', variesBySession: false },
  handler: async () => ({ ok: true }),
});

export const optionalAsset = procedure({
  // @ts-expect-error auth: 'optional' may not declare cache: 'asset'
  policy: { auth: 'optional', cache: 'asset' },
  handler: async () => ({ ok: true }),
});
