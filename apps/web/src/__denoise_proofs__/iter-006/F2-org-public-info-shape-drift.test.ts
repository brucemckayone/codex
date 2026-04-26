/**
 * Proof test for iter-006 F2 — `types:type-narrow-by-cast`
 * (apps/web client type drifts from worker response shape).
 *
 * Finding: `apps/web/src/routes/_org/[slug]/+layout.server.ts` calls
 * `api.org.getPublicInfo(slug)` (declared return type: `OrganizationData`)
 * but THEN re-narrows the response via a hand-written cast:
 *
 *   const typedOrg = org as { id; slug; name; description; logoUrl;
 *     brandColors; brandFonts; brandRadius; brandDensity; brandFineTune;
 *     introVideoUrl; heroLayout?: string; enableSubscriptions?: boolean };
 *
 * `heroLayout` and `enableSubscriptions` are NOT declared on
 * `OrganizationData` (lib/types.ts:195) — yet the server actually returns
 * them (organization-api/src/routes/organizations.ts:298,337). The cast
 * is doing the work that the static type should: declaring the real
 * wire shape.
 *
 * Catalogue row: §6 row 3 (type-equality test). The fix is to add
 * `heroLayout?: string` and `enableSubscriptions?: boolean` to
 * `OrganizationData` (or extract a `PublicOrganizationInfo` subset in
 * `@codex/shared-types` and import here), then drop the inline `as`.
 *
 * After fix: this test (un-skipped) compiles cleanly. Before fix: the
 * properties don't exist on `OrganizationData` so the assertions fail.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { OrganizationData } from '../../lib/types';

describe.skip('iter-006 F2 — OrganizationData should declare server fields', () => {
  it('OrganizationData includes heroLayout (returned by getPublicInfo)', () => {
    // Pre-fix: heroLayout is not declared. Type error when accessing.
    expectTypeOf<OrganizationData>().toHaveProperty('heroLayout');
  });

  it('OrganizationData includes enableSubscriptions (returned by getPublicInfo)', () => {
    expectTypeOf<OrganizationData>().toHaveProperty('enableSubscriptions');
  });
});
