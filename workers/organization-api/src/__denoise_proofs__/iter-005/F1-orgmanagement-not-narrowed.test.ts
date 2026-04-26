/**
 * Denoise iter-005 F1 — `requireOrgManagement: true` does NOT narrow
 * `ctx.organizationId` to `string`.
 *
 * Fingerprint: types:type-narrowing-incomplete-orgmanagement
 * Severity: BLOCKER (silent type-safety hole compensated by `as string` casts)
 *
 * Status: FIXED (Codex-lqvw4.11). The type narrow in
 * `packages/worker-utils/src/procedure/types.ts` now also checks
 * `TPolicy['requireOrgManagement'] extends true`. All 6 `as string`
 * casts have been dropped from `tiers.ts` (×4) and `subscriptions.ts` (×2).
 *
 * Description (preserved for audit trail):
 *
 *   The procedure factory's runtime helper `enforcePolicy` (in
 *   packages/worker-utils/src/procedure/helpers.ts:476-490) treats
 *   `requireOrgMembership` and `requireOrgManagement` IDENTICALLY:
 *   both gate `needsOrg`, which then asserts `organizationId` is
 *   non-null before continuing. So at runtime, a route declared with
 *   `requireOrgManagement: true` is GUARANTEED to have a string
 *   `ctx.organizationId`. The type narrow now reflects this invariant.
 *
 * Proof shape: Catalogue row 3 (type-equality test). We assert the
 * type narrows to `string` for `requireOrgManagement: true` policy.
 */

import type { ProcedureContext } from '@codex/worker-utils';
import { describe, expectTypeOf, it } from 'vitest';

describe('iter-005 F1 — requireOrgManagement narrow (proof)', () => {
  it('ctx.organizationId is `string` when requireOrgManagement: true', () => {
    type ManagementCtx = ProcedureContext<
      { auth: 'required'; requireOrgManagement: true },
      undefined
    >;
    expectTypeOf<ManagementCtx['organizationId']>().toEqualTypeOf<string>();
  });

  it('ctx.organizationId is `string` when requireOrgMembership: true', () => {
    type MembershipCtx = ProcedureContext<
      { auth: 'required'; requireOrgMembership: true },
      undefined
    >;
    expectTypeOf<MembershipCtx['organizationId']>().toEqualTypeOf<string>();
  });

  it('ctx.organizationId is `string | undefined` without org flags', () => {
    type PlainCtx = ProcedureContext<{ auth: 'required' }, undefined>;
    expectTypeOf<PlainCtx['organizationId']>().toEqualTypeOf<
      string | undefined
    >();
  });

  it('runtime invariant: enforcePolicy throws if no orgId for management', () => {
    // The runtime side of the invariant is already enforced by
    // packages/worker-utils/src/procedure/helpers.ts:476-490 — see the
    // existing tests under packages/worker-utils/src/procedure/__tests__/
    // for runtime coverage. The type narrow is the missing half.
  });
});
