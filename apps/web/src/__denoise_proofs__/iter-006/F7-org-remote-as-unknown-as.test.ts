/**
 * Proof test for iter-006 F7 — `types:as-unknown-as`
 * (`getMyOrganizations` query has its return type forcibly re-asserted).
 *
 * Finding: `apps/web/src/lib/remote/org.remote.ts:303` does:
 *
 *   export const getMyOrganizations = query(async () => { ... return response; })
 *     as unknown as () => Promise<OrganizationWithRole[] | null>;
 *
 * The double-cast is bypassing the SvelteKit `query()` factory's inferred
 * return type. `query<T>(fn)` returns a `Query<T>` object, not a bare
 * `() => Promise<T>` — so the cast hides whatever shape `query()` actually
 * produces in this codebase.
 *
 * Same fingerprint as iter-005 F5 (`as unknown as` in worker entry-points).
 * That cycle also flagged the pragmatic stripe-mock + multipart-procedure
 * sites; this is the apps/web instance bringing the trail to 4 production
 * sites.
 *
 * Per recurrence ledger: `types:as-unknown-as` hits=1 after iter-005;
 * this becomes hit #2.
 *
 * Catalogue row: §6 row 3 (type-equality) + grep guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skip('iter-006 F7 — getMyOrganizations should not use `as unknown as`', () => {
  it('org.remote.ts contains no `as unknown as` cast', () => {
    const repoRoot = resolve(__dirname, '../../../../..');
    const content = readFileSync(
      resolve(repoRoot, 'apps/web/src/lib/remote/org.remote.ts'),
      'utf-8'
    );
    expect(content).not.toMatch(/\bas\s+unknown\s+as\b/);
  });
});
