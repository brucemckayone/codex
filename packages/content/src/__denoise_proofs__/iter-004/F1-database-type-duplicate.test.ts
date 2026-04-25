/**
 * Denoise iter-004 F1 — proof test for
 * `types:type-duplicate-cross-package` — `Database` type re-declared in
 * three service packages (content, notifications, organization) AS WELL AS
 * a different (HTTP-only) shape in the canonical `@codex/database` package.
 *
 * Finding: five distinct `export type Database` declarations exist across
 * packages, with at least two structurally divergent shapes:
 *
 *   - packages/database/src/client.ts:329
 *       Database = ReturnType<typeof drizzleHttp<typeof schema>>     // HTTP only
 *   - packages/content/src/types.ts:21
 *   - packages/notifications/src/types.ts:36
 *   - packages/organization/src/types.ts:15
 *       Database = typeof dbHttp | typeof dbWs                        // UNION
 *   - packages/test-utils/src/database.ts:87
 *       Database = DatabaseWs                                         // WS only
 *
 * The canonical `@codex/database` package's CLAUDE.md tells consumers to
 * `import type { Database } from '@codex/database'`. Three service
 * packages instead redeclare a structurally different (and therefore
 * incompatible) shape. The redeclarations are the *real* types each
 * service constructor accepts (they want both HTTP and WS clients), so the
 * canonical export under-promises. Either:
 *  - canonical `@codex/database` Database widens to include `dbWs`, OR
 *  - service packages import the existing `DatabaseWs` and form their own
 *    union there
 *
 * Rule (ref 02 §7 row 4): same type name declared in 2+ packages → move to
 * `@codex/shared-types` (or the canonical foundation package — here
 * `@codex/database`) and import via `import type`.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue row 3
 * — Type-equality test). The proof intentionally fails to compile against
 * the current code because the two shapes are NOT equivalent
 * (HTTP-only ≠ HTTP|WS union). The fix is to consolidate to a single
 * canonical `Database` type that both shapes match.
 *
 * Severity: major (drift across 5 declarations, structurally divergent).
 *
 * Remove the `.skip()` modifier in the same PR as the consolidation.
 */

// Re-declare the divergent shapes inline so this test compiles even if
// foreign packages aren't ready to be imported. The structural-equivalence
// assertion is what fails on main and passes after consolidation.
import type { dbHttp, dbWs } from '@codex/database';
import { describe, expectTypeOf, it } from 'vitest';
import type { Database as ContentDatabase } from '../types';

type CanonicalDatabaseFromDatabasePkg =
  // Mirrors @codex/database/src/client.ts:329 — HTTP only.
  typeof dbHttp;

type ContentRedeclaredDatabase = typeof dbHttp | typeof dbWs;

describe('denoise proof: F1 types:type-duplicate-cross-package — Database', () => {
  it.skip('canonical @codex/database Database MUST equal the shape three service packages re-declare', () => {
    // FAILS today: the canonical type is HTTP-only; the redeclaration is a
    // union including WS. After consolidation (canonical broadened OR
    // service packages drop the redeclaration in favour of an existing
    // canonical union), this assertion compiles.
    expectTypeOf<ContentDatabase>().toEqualTypeOf<CanonicalDatabaseFromDatabasePkg>();
  });

  it.skip('the in-package redeclaration mirrors the literal HTTP|WS union — proves divergence today', () => {
    // This passes today (and continues to pass after consolidation if the
    // canonical type is broadened) — it is the *anchor* the consolidation
    // should converge to.
    expectTypeOf<ContentDatabase>().toEqualTypeOf<ContentRedeclaredDatabase>();
  });
});
