/**
 * Denoise iter-004 F5 — proof test for
 * `types:type-duplicate-cross-package` — `OrganizationMembership` declared
 * in two packages with structurally DIVERGENT shapes.
 *
 * Finding:
 *   - packages/database/src/schema/content.ts:412
 *       export type OrganizationMembership =
 *         typeof organizationMemberships.$inferSelect;
 *       // Full DB row: id, userId, organizationId, role, status, joinedAt,
 *       // invitedBy, invitedAt, createdAt, updatedAt, deletedAt, ...
 *
 *   - packages/worker-utils/src/procedure/helpers.ts:173
 *       export interface OrganizationMembership {
 *         role: string;
 *         status: string;
 *         joinedAt: Date;
 *       }
 *
 * The worker-utils variant is a 3-field projection of the DB row — used
 * inside `procedure({ requireOrgMembership: true })` to populate
 * `ctx.organizationMembership`. The DB shape is the canonical row.
 *
 * Concrete consumer risk: a route handler that types its membership
 * variable as `OrganizationMembership` from `@codex/database` (the
 * canonical schema export) and assigns from `ctx.organizationMembership`
 * (the worker-utils projection) compiles only because the projection is a
 * subset — assignment in the OTHER direction (canonical → projection)
 * silently strips fields. Either name should be unique.
 *
 * Suggested fix: rename worker-utils helper to `OrganizationMembershipContext`
 * (or `MembershipPolicyContext`) so the schema name remains canonical.
 * Alternatively: derive the projection via `Pick<OrganizationMembership,
 * 'role' | 'status' | 'joinedAt'>` so the shape stays in sync.
 *
 * Rule (ref 02 §7 row 4 / ref 07 §7 row 5): same name declared in 2+
 * packages → resolve via canonical type + Pick projection, OR rename one.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue
 * row 3 — Type-equality test). The two shapes are NOT structurally
 * equivalent — proof captures the divergence.
 *
 * Severity: minor (subset-relation only; no runtime breakage today).
 *
 * Remove the `.skip()` modifier in the same PR as the rename or
 * Pick-derivation.
 */

import type { OrganizationMembership as ProcedureOrgMembership } from '@codex/worker-utils';
import { describe, expectTypeOf, it } from 'vitest';
import type { OrganizationMembership as DatabaseOrgMembership } from '../schema/content';

describe('denoise proof: F5 types:type-duplicate-cross-package — OrganizationMembership', () => {
  it.skip('@codex/database.OrganizationMembership and @codex/worker-utils.OrganizationMembership MUST resolve to a single declaration', () => {
    // FAILS today: the DB row has many more fields than the procedure
    // projection. After consolidation either:
    //   (a) the projection is renamed (procedure type ≠ DB type, but
    //       names no longer collide), or
    //   (b) the projection is `Pick<DatabaseOrgMembership, ...>` derived,
    //       and the named import in worker-utils is just a re-export.
    expectTypeOf<DatabaseOrgMembership>().toEqualTypeOf<ProcedureOrgMembership>();
  });
});
