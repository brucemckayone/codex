/**
 * Denoise iter-005 F1 — `requireOrgManagement: true` does NOT narrow
 * `ctx.organizationId` to `string`.
 *
 * Fingerprint: types:type-narrowing-incomplete-orgmanagement
 * Severity: BLOCKER (silent type-safety hole compensated by `as string` casts)
 * File:Line:
 *   - packages/worker-utils/src/procedure/types.ts:230-234 (incomplete narrow)
 *   - workers/organization-api/src/routes/tiers.ts:77,128,158,182 (4 casts)
 *   - workers/ecom-api/src/routes/subscriptions.ts:311,328 (2 casts)
 *
 * Description:
 *
 *   The procedure factory's runtime helper `enforcePolicy` (in
 *   packages/worker-utils/src/procedure/helpers.ts:476-490) treats
 *   `requireOrgMembership` and `requireOrgManagement` IDENTICALLY:
 *   both gate `needsOrg`, which then asserts `organizationId` is
 *   non-null before continuing. So at runtime, a route declared with
 *   `requireOrgManagement: true` is GUARANTEED to have a string
 *   `ctx.organizationId`.
 *
 *   But the type-level narrow at types.ts:230 only checks
 *   `TPolicy['requireOrgMembership'] extends true`. So routes with
 *   `requireOrgManagement: true` (and no `requireOrgMembership`)
 *   see `ctx.organizationId: string | undefined` and have to cast
 *   via `ctx.organizationId as string`. That's 6 known sites today
 *   (tiers.ts ×4, subscriptions.ts ×2) — every cast is a TS escape
 *   hatch covering an invariant that's true at runtime but invisible
 *   at the type level.
 *
 *   Real risk: if any of those 6 routes are ever mistakenly declared
 *   with NEITHER flag (e.g. a copy-paste error keeps the cast but
 *   drops `requireOrgManagement`), the cast silently assumes a
 *   defined organizationId at runtime when it could be undefined.
 *   The TS compiler would not catch the bug — `as string` is a
 *   blind narrow.
 *
 *   Fix: change types.ts narrow to also check `requireOrgManagement`:
 *
 *     organizationId: TPolicy['requireOrgMembership'] extends true
 *       ? string
 *       : TPolicy['requireOrgManagement'] extends true
 *         ? string
 *         : TPolicy['auth'] extends 'platform_owner'
 *           ? string
 *           : string | undefined;
 *
 *   After the fix, all 6 `as string` casts become unnecessary and
 *   should be removed in the same PR.
 *
 * Proof shape: Catalogue row 3 (type-equality test). We assert the
 * type narrows to `string` for `requireOrgManagement: true` policy.
 * BEFORE fix: this `expectTypeOf` fails to compile (organizationId
 * is `string | undefined`). AFTER fix: it compiles cleanly.
 *
 * Test stays `it.skip(...)` until the fix lands. The `expectTypeOf`
 * lines below are commented out so the file compiles in the
 * baseline; uncomment + remove `.skip()` in the fix PR.
 */
import { describe, it } from 'vitest';

describe.skip('iter-005 F1 — requireOrgManagement narrow (proof)', () => {
  it('ctx.organizationId is `string` when requireOrgManagement: true', () => {
    // Uncomment in the fix PR — these are compile-time assertions
    // that fail today and pass after the type narrow is widened.
    //
    // import { expectTypeOf } from 'vitest';
    // import type { ProcedureContext } from '@codex/worker-utils';
    //
    // type ManagementCtx = ProcedureContext<
    //   { auth: 'required'; requireOrgManagement: true },
    //   {}
    // >;
    // expectTypeOf<ManagementCtx['organizationId']>().toEqualTypeOf<string>();
  });

  it('runtime invariant: enforcePolicy throws if no orgId for management', () => {
    // The runtime side of the invariant is already enforced by
    // packages/worker-utils/src/procedure/helpers.ts:476-490 — see the
    // existing tests under packages/worker-utils/src/procedure/__tests__/
    // for runtime coverage. The type narrow is the missing half.
  });
});
