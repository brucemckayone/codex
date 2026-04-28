/**
 * Denoise iter-030 F1 — `membership.role` narrowed to OrgMemberRole | null
 * without a runtime guard.
 *
 * Fingerprint: types:as-cast-without-guard (R15 violation)
 * Severity: major (R15 hard-rule violation; security-adjacent because the
 *   narrowed value flows out across a worker-to-worker boundary into the
 *   SvelteKit hooks `reroute()` → membership-cached subdomain routing →
 *   role-based UI rendering. A drift between the Drizzle column CHECK
 *   constraint and `MembershipLookupResponse['role']` would silently
 *   propagate an unmapped role string to consumers without throwing.)
 *
 * File:Line:
 *   workers/identity-api/src/routes/membership.ts:52
 *     `role: membership.role as MembershipLookupResponse['role'],`
 *
 * Description:
 *
 *   `membership` is `OrganizationMembership` from
 *   `@codex/worker-utils` — its `role` is typed `string`
 *   (helpers.ts:174). The handler narrows that to
 *   `MembershipLookupResponse['role']` which is the
 *   `'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null`
 *   union from `@codex/shared-types/api-responses.ts:150` —
 *   strictly narrower. R15 (promoted iter-029) requires a
 *   runtime guard for narrowing casts unless one of the four
 *   reason codes applies. None do here:
 *
 *   - drizzle-infinite-recursion: NO. This is not a Drizzle
 *     row-inference bridge.
 *   - framework-default-init: NO. The cast is on a fetched
 *     value, not a generic-typed config init.
 *   - proxy-target: NO. No `new Proxy(...)` involved.
 *   - type-test: NO. This is production handler code, not a
 *     `.test.ts` file.
 *
 *   The comment in `api-responses.ts:147` flags this exact
 *   risk: "Maintenance: role union must match
 *   organizationMembers.role column CHECK constraint in
 *   packages/database schema. Update both locations if roles
 *   change." That comment IS the proof — the type-system
 *   gives no help; manual coordination across 2 files is
 *   load-bearing. R15's intent is to convert that human
 *   coordination into a runtime-checked Zod parse so a drift
 *   surfaces as `ValidationError` rather than a silently
 *   miscategorised role on the client.
 *
 *   Suggested fix:
 *
 *     1. Define a Zod schema in `@codex/validation`:
 *          export const orgMemberRoleSchema = z.enum([
 *            'owner', 'admin', 'creator', 'subscriber', 'member',
 *          ]);
 *          export type OrgMemberRole = z.infer<
 *            typeof orgMemberRoleSchema
 *          >;
 *     2. Make `@codex/shared-types` `OrgMemberRole` import
 *        from validation (or vice-versa — the canonical
 *        runtime owner is validation per the shared-types
 *        contract §4 row 1).
 *     3. In membership.ts:52 replace the cast with a parse:
 *          const role = orgMemberRoleSchema.parse(membership.role);
 *        (since `MembershipLookupResponse` allows null when
 *        membership === null, but here membership is
 *        non-null so `role` is non-null).
 *
 *   Sibling site to check after this fix lands:
 *   `workers/identity-api/src/routes/...my-membership` —
 *   `MyMembershipResponse['role']` shares the same union
 *   shape (api-responses.ts:163) and the
 *   `IdentityService.getMyMembership` return value flows
 *   through with the same drift risk. NOT in this finding's
 *   blast radius today (the service likely does its own
 *   typing) but worth a follow-up grep when the fix lands.
 *
 * Proof shape: Catalogue row 3 (type-equality test).
 *   Two assertions:
 *   (a) Source-shape: `OrganizationMembership['role']` is
 *       `string` — broader than `MembershipLookupResponse['role']`.
 *       This proves the cast IS narrowing, not widening (R15
 *       only covers narrowing).
 *   (b) Target-shape: `MembershipLookupResponse['role']` is
 *       a 5-member literal union | null — strictly narrower.
 *
 *   After the fix:
 *   - Replace the cast with a Zod parse at the call site.
 *   - The runtime narrowing produces `OrgMemberRole`
 *     (non-null in this branch), which structurally matches
 *     `MembershipLookupResponse['role']` minus null.
 *   - This proof transitions from `.skip()` to active and
 *     passes (because the type-equality holds without a
 *     cast: `z.infer<typeof orgMemberRoleSchema>` ≡
 *     `Exclude<MembershipLookupResponse['role'], null>`).
 */

import type { MembershipLookupResponse } from '@codex/shared-types';

import type { OrganizationMembership } from '@codex/worker-utils';
import { describe, expectTypeOf, it } from 'vitest';

describe.skip('iter-030 F1 — membership.role narrowed without Zod (R15)', () => {
  it('source type is broader: OrganizationMembership.role is string', () => {
    // Today: helpers.ts:174 declares role: string
    expectTypeOf<OrganizationMembership['role']>().toEqualTypeOf<string>();
  });

  it('target type is a strict 5-member union | null', () => {
    // Today: api-responses.ts:150 declares the union
    type Target = MembershipLookupResponse['role'];
    expectTypeOf<Target>().toEqualTypeOf<
      'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null
    >();
  });

  it('after fix: orgMemberRoleSchema.parse(role) produces narrowed type structurally', () => {
    // Pseudo (depends on @codex/validation export):
    //   import { orgMemberRoleSchema } from '@codex/validation';
    //   type Parsed = z.infer<typeof orgMemberRoleSchema>;
    //   expectTypeOf<Parsed>().toEqualTypeOf<
    //     Exclude<MembershipLookupResponse['role'], null>
    //   >();
    //
    // The proof here is "the cast can be replaced by a parse
    // and the resulting type is identical" — which is exactly
    // R15's intent: trade a compile-time-only assertion for a
    // runtime-checked one.
  });
});
