/**
 * Denoise iter-028 F1 — proof test for
 * `types:type-duplicate-cross-package` — `OrganizationMembership` is declared
 * in three places with divergent shapes:
 *
 *   1. packages/database/src/schema/content.ts:412
 *        export type OrganizationMembership = typeof organizationMemberships.$inferSelect;
 *        // Drizzle row: 11 fields (id, organizationId, userId, role, status,
 *        //               joinedAt, invitedBy, ...)
 *
 *   2. packages/worker-utils/src/procedure/helpers.ts:173
 *        export interface OrganizationMembership {
 *          role: string; status: string; joinedAt: Date;
 *        }
 *        // 3-field projection used to populate ctx.organizationMembership
 *
 *   3. packages/shared-types/src/worker-types.ts:352 (anonymous inline)
 *        organizationMembership?: { role: string; status: string; joinedAt: Date }
 *        // Same 3-field shape, declared inline on Variables interface, not
 *        // re-using the named export from worker-utils
 *
 * Codex-lqvw4.5 already filed the worker-utils <-> database collision; this
 * iter-028 finding extends it with the third inline-shape site discovered by
 * grep.
 *
 * Concrete bug shape (R11): the same structural type is declared in 3 sites
 * without a single canonical declaration site. If a future schema change adds
 * `joinedAt: Date | null`, the inline shape on `Variables` and the named
 * `OrganizationMembership` interface in `helpers.ts` will silently drift apart.
 *
 * Suggested fix: keep `OrganizationMembership` as the Drizzle row type in
 * `@codex/database/schema`, rename the worker-utils helper to
 * `OrganizationMembershipContext` (or derive via
 * `Pick<OrganizationMembership, 'role' | 'status' | 'joinedAt'>`), and replace
 * the inline shape in `Variables.organizationMembership` with that named
 * import.
 *
 * Proof shape: type-equality assertion (Catalogue row 3) — the inline shape
 * MUST equal the named export, otherwise drift is silent.
 *
 * Severity: minor (no current runtime bug — all three projections share the
 * same 3-field shape today). The risk is future drift.
 *
 * Remove the `.skip()` modifier in the same PR as the rename.
 */

import type { Variables } from '@codex/shared-types';
import { describe, expectTypeOf, it } from 'vitest';
import type { OrganizationMembership as WorkerUtilsOrgMembership } from '../../procedure/helpers';

type InlineShapeOnVariables = NonNullable<Variables['organizationMembership']>;

describe('denoise proof: F1 types:type-duplicate-cross-package — OrganizationMembership', () => {
  it.skip('Variables.organizationMembership inline shape MUST equal the named OrganizationMembership export', () => {
    // PASSES today (shapes are byte-identical) but the bug is the duplication
    // itself — the test will keep passing only if both sites are kept in sync
    // by hand. This proof exists to FAIL when one drifts; the fix is to
    // replace the inline shape with `OrganizationMembership`.
    expectTypeOf<InlineShapeOnVariables>().toEqualTypeOf<WorkerUtilsOrgMembership>();
  });
});
