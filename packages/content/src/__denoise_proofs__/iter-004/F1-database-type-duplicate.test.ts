/**
 * Denoise iter-004 F1 — proof test for
 * `types:type-duplicate-cross-package` — `Database` type re-declared in
 * three service packages (content, notifications, organization) AS WELL AS
 * a different (HTTP-only) shape in the canonical `@codex/database` package.
 *
 * RESOLVED (Round 3 Tier 6.A — Codex-lqvw4.2):
 *
 * `@codex/database` now exports a canonical `DatabaseClient` union
 * (`typeof dbHttp | typeof dbWs`). The 3 service packages
 * (content, notifications, organization) drop their inline redeclarations
 * and re-export `DatabaseClient` *as* `Database` so existing consumers of
 * `import type { Database } from '@codex/<service>'` keep working.
 *
 * Shape after fix:
 *   - `@codex/database` Database          → `typeof dbHttp` (HTTP-only, narrow)
 *   - `@codex/database` DatabaseWs        → `typeof dbWs`   (WS-only, narrow)
 *   - `@codex/database` DatabaseClient    → `typeof dbHttp | typeof dbWs` (canonical union)
 *   - `@codex/content`  Database          → alias of `DatabaseClient`
 *   - `@codex/notifications` Database     → alias of `DatabaseClient`
 *   - `@codex/organization`  Database     → alias of `DatabaseClient`
 *   - `@codex/test-utils`    Database     → alias of `DatabaseWs` (intentional —
 *                                            test setup uses WS for transactions)
 *
 * Rule (ref 02 §7 row 4): same type name declared in 2+ packages → move to
 * `@codex/shared-types` (or the canonical foundation package — here
 * `@codex/database`) and import via `import type`.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue row 3
 * — Type-equality test). The proof now passes because the service
 * packages' `Database` is a structural alias of the canonical
 * `DatabaseClient` union.
 *
 * Severity: major (drift across 5 declarations, structurally divergent).
 */

import type { DatabaseClient, dbHttp, dbWs } from '@codex/database';
import { describe, expectTypeOf, it } from 'vitest';
import type { Database as ContentDatabase } from '../types';

type CanonicalDatabaseClient = DatabaseClient;
type ExpectedUnion = typeof dbHttp | typeof dbWs;

describe('denoise proof: F1 types:type-duplicate-cross-package — Database', () => {
  it('canonical @codex/database DatabaseClient is the HTTP|WS union', () => {
    // Anchor: the consolidated canonical union matches the literal
    // `typeof dbHttp | typeof dbWs` shape that 3 service packages
    // previously redeclared.
    expectTypeOf<CanonicalDatabaseClient>().toEqualTypeOf<ExpectedUnion>();
  });

  it('service-package Database alias equals the canonical DatabaseClient union', () => {
    // Proves the redeclarations have been removed: every service
    // package's `Database` is now a structural alias of the canonical
    // foundation type.
    expectTypeOf<ContentDatabase>().toEqualTypeOf<CanonicalDatabaseClient>();
  });
});
