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
 *
 * WHY THIS IS A `.type-check.ts` FILE AND NOT A `.test.ts` FILE. It was a
 * `.test.ts`, and in that form it proved NOTHING, twice over:
 *   1. `packages/content/tsconfig.json` excludes `**\/*.test.ts`, and vitest
 *      transpiles without typechecking — so no tool ever evaluated these
 *      assertions. `expectTypeOf` has no runtime behaviour, so the `it()`
 *      bodies were empty and the suite went green regardless.
 *   2. Its import of `ContentDatabase` read `'../types'`, which resolves to
 *      `src/__tests__/types` and does not exist. Even had it been checked,
 *      the second assertion compared the canonical union against an error
 *      type. Found by `fallow dead-code` (`unresolved_imports`).
 * `.type-check.ts` falls inside `include: ['src/**\/*']` and outside both
 * exclusions, so `pnpm --filter @codex/content typecheck` reads it, while
 * vitest's `src/**\/*.{test,spec}.*` pattern does not match it. Same reasoning
 * as `packages/worker-utils/src/procedure/__tests__/*.type-check.ts`.
 */

import type { DatabaseClient, dbHttp, dbWs } from '@codex/database';
import { expectTypeOf } from 'vitest';
import type { Database as ContentDatabase } from '../../types';

type CanonicalDatabaseClient = DatabaseClient;
type ExpectedUnion = typeof dbHttp | typeof dbWs;

// Anchor: the consolidated canonical union matches the literal
// `typeof dbHttp | typeof dbWs` shape that 3 service packages previously
// redeclared.
expectTypeOf<CanonicalDatabaseClient>().toEqualTypeOf<ExpectedUnion>();

// The proof proper: every service package's `Database` is a structural alias
// of the canonical foundation type, so the redeclarations are really gone.
expectTypeOf<ContentDatabase>().toEqualTypeOf<CanonicalDatabaseClient>();
