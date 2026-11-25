/**
 * Denoise iter-009 F3 — proof test for `simplification:dup-paginated-list-shape`.
 *
 * Finding: The same paginated-list shape (Promise.all([findMany,
 * select-count]) + total + items envelope + totalPages) is repeated across
 * at least 6 service methods in 3 packages:
 *
 *   - `packages/content/src/services/content-service.ts` — `list()` (~line 700-770)
 *   - `packages/content/src/services/content-service.ts` — `listPublic()` (~line 800-870)
 *   - `packages/content/src/services/media-service.ts` — `list()` (~line 405-455)
 *   - `packages/notifications/src/services/template-service.ts` — `listGlobalTemplates()` (~line 75-110)
 *   - `packages/notifications/src/services/template-service.ts` — `listOrgTemplates()` (~line 220-260)
 *   - `packages/notifications/src/services/template-service.ts` — `listCreatorTemplates()` (~line 405-445)
 *
 * Each implementation:
 *   1. Computes `offset = (page - 1) * limit` (or via `withPagination()`)
 *   2. Builds a `whereConditions` array
 *   3. Runs `await Promise.all([db.query.X.findMany({ where, limit, offset, ... }), db.select({ total: count() }).from(X).where(...)])`
 *   4. Computes `totalPages = Math.ceil(total / limit)`
 *   5. Returns `{ items, pagination: { page, limit, total, totalPages } }`
 *
 * Differences are limited to (a) the table being queried, (b) the WHERE
 * conditions, and (c) the relation columns/`with` clauses. Steps 1, 4, 5 are
 * identical across all six call sites.
 *
 * Fix: extract a `paginatedQuery({ db, table, where, with?, orderBy?,
 * pagination })` helper. Either in `@codex/database` (closer to the table-
 * shape) or `@codex/worker-utils` (closer to `withPagination` +
 * `PaginatedResult`).
 *
 * ## Catalogue walk (SKILL.md §6)
 *
 * - **Parity test (row 1)**: APPLICABLE post-fix (assert refactored helper
 *   produces same `(items, pagination)` envelope as the original inline
 *   bodies for a representative corpus).
 *
 * - **Clone-count assertion (row 12)**: CHOSEN — programmatic
 *   `jscpdBudget()` against `packages/content/src` and
 *   `packages/notifications/src` with `minTokens: 60`. Pre-fix: at least 4
 *   clusters in the paginated-list region. Post-fix: 0 clusters.
 *
 * - **Consumer-count (row 2)**: NOT APPLICABLE — the helpers are NEW;
 *   nobody is calling the (not-yet-existing) `paginatedQuery` yet.
 *
 * - **Dep-graph (row 4)**: NOT APPLICABLE — no layer leak; question is
 *   intra-tier duplication.
 *
 * ## How this test fails on main and passes after the fix
 *
 * Today (un-skipped): walks the source of the 6 list methods with a regex
 * for the `Promise.all([..., db.select({ ... count() }).from(...).where])`
 * pattern. Counts hits — currently 6+ → fails (>1). After fix (helper
 * extracted, call sites delegate): 0 inline hits, all delegated to the
 * single helper → passes.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

/**
 * Files that inline a paginated list's TOTAL: `select({ total: count() })`,
 * on one line or as a `total: count()` line of a multi-line select. That is
 * step 3 of the shape above, which `paginatedQuery` (@codex/database) now owns.
 *
 * Narrowed 2026-11-24 (Codex-8swlj). The pattern had been any
 * `select({ <name>: count() })`, which also matches aggregates that are not a
 * list's total: content-buyers' buyer counts, and the public topic list's
 * per-topic GROUP BY count. So a second legitimate aggregate failed it while
 * an inlined pagination total in a file that already had one would not.
 */
function inlinePaginatedTotals(): string[] {
  const cmd =
    `grep -rEln "\\.select\\(\\{\\s*total\\s*:\\s*count\\(\\)|^\\s*total\\s*:\\s*count\\(\\)" ` +
    `packages/content/src packages/notifications/src ` +
    `--include='*.ts' || true`;
  const out = execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.includes('__denoise_proofs__'))
    .filter((p) => !p.endsWith('.test.ts'));
}

describe('denoise proof: F3 simplification:dup-paginated-list-shape', () => {
  it('no service inlines a paginated total: every list delegates to paginatedQuery', () => {
    // Pre-fix: content-service, media-service and template-service each
    // inlined it. Post-fix: the helper lives in @codex/database, outside these
    // packages, so none of their files may hold it.
    expect(inlinePaginatedTotals()).toEqual([]);
  });
});
