import { z } from 'zod';

/**
 * Free-text search validation — the single source of truth for every `search`
 * facet on the platform.
 *
 * ## Why this file exists
 *
 * There were twelve independent `search: z.string()` declarations across
 * `@codex/validation` and `apps/web/src/lib/remote`. Ten set no minimum at
 * all; the other two were written `z.string().trim().min(1)`, which rejects
 * only the empty string. So all twelve let a ONE-CHARACTER query reach a
 * `LIKE '%a%'` and scan the whole table.
 *
 * Note how the drift survived: because those two were `.trim().min(1)`, a
 * literal grep for `z.string().min` matched NONE of the twelve. Twelve
 * copies of a rule is twelve chances for one to be written without it, and
 * no spelling to grep for. Hence one builder, here, with the reasoning
 * beside it.
 */

// ============================================================================
// The floor
// ============================================================================

/**
 * The minimum query length at which a free-text search is worth ISSUING: 3.
 *
 * The reason is mechanical, not taste. A trigram is three characters.
 * Postgres `pg_trgm` extracts the trigram set from the search pattern and
 * probes its GIN index with it, so a pattern shorter than three characters
 * yields no extractable trigram, leaves the planner with nothing to probe
 * with, and falls back to a sequential scan of the whole table.
 *
 * Two characters is therefore not "nearly as good as three" — it is a
 * different execution plan, and it is precisely the plan this floor exists
 * to prevent. DO NOT relax this to 2 to make short searches "work": below
 * three the index cannot be used at all, so every keystroke costs a full
 * table scan.
 *
 * Enforced in the CLIENT via {@link gateSearchQuery}, never as a server-side
 * `.min(3)` — see {@link createSearchQuerySchema} for why.
 */
export const SEARCH_MIN_QUERY_LENGTH = 3;

// ============================================================================
// The server schema
// ============================================================================

/**
 * Build the schema for an optional free-text `search` query parameter.
 *
 * - **trims**, so `'   '` normalises to `''` rather than becoming a
 *   whitespace `LIKE` pattern that matches most rows;
 * - **caps length**, bounding the pattern the database has to compile;
 * - is **`.optional()`**, because every search facet on the platform is.
 *
 * ## Deliberately NOT `.min(SEARCH_MIN_QUERY_LENGTH)`
 *
 * A server-side minimum turns a legal short search into a 400. A user typing
 * "Bo" on the way to "Bones" would get a validation error instead of results,
 * and any caller that did not know about the floor — a curl, a bookmarked
 * `?search=Bo`, a stale client build — would break rather than degrade.
 *
 * The floor is a PERFORMANCE gate, and a performance gate belongs where the
 * request is ISSUED, not where it is validated. So 1-2 characters parse fine
 * here and return 200 (with a scan); the client is what declines to issue
 * them. See {@link gateSearchQuery}.
 *
 * @param maxLength - Maximum accepted length after trimming (default 255)
 *
 * @example
 * ```typescript
 * export const contentQuerySchema = paginationSchema.extend({
 *   search: createSearchQuerySchema(255),
 * });
 * ```
 */
export const createSearchQuerySchema = (maxLength: number = 255) =>
  z
    .string()
    .trim()
    .max(maxLength, `Search query must be ${maxLength} characters or less`)
    .optional();

// ============================================================================
// The client gate
// ============================================================================

/**
 * The CLIENT-SIDE gate. Normalises a raw search input into the value a query
 * may be issued with, or `null` when no query should be issued at all.
 *
 * `null` is the "no search" signal both kinds of call site already speak:
 * URL writers delete the param on `null`, and remote-arg builders omit the
 * key (`...(gated && { search: gated })`).
 *
 * Empty input and below-floor input both return `null`, and that is
 * deliberate: to the database, "the user has typed one letter" and "the user
 * has typed nothing" are the same request — an unfiltered list — and only
 * one of the two costs a full table scan.
 *
 * @example
 * ```typescript
 * // URL-backed page: don't put a below-floor value in the URL at all.
 * updateFilters({ q: gateSearchQuery(value) });
 *
 * // Client-issued remote query: omit the arg below the floor.
 * const search = $derived(gateSearchQuery(page.url.searchParams.get('search')));
 * const rows = $derived(listContent({ ...(search && { search }) }));
 * ```
 */
export function gateSearchQuery(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed.length >= SEARCH_MIN_QUERY_LENGTH ? trimmed : null;
}

/**
 * True when `raw` is a NON-EMPTY search input that has not yet reached the
 * floor — i.e. the user has typed something, but too little to issue.
 *
 * This distinction is the whole client gate, because the three cases need
 * three different actions and only two of them are "no search":
 *
 * | input        | `gateSearchQuery` | this | what the client should do        |
 * |--------------|-------------------|------|----------------------------------|
 * | `'Bones'`    | `'Bones'`         | `false` | issue the query               |
 * | `'Bo'`       | `null`            | `true`  | HOLD — issue nothing, and      |
 * |              |                   |         | change nothing                 |
 * | `''`         | `null`            | `false` | CLEAR any active search        |
 *
 * Collapsing "hold" into "clear" is the bug worth naming: on a page whose
 * search lives in the URL, editing `?q=Bones` down to `Bo` would drop the
 * param, which navigates, which re-renders the input from the URL — so the
 * box empties itself under the user mid-edit and the full catalogue returns.
 * Holding leaves the URL (and the results, and the input) untouched until
 * the third character arrives.
 *
 * @example
 * ```typescript
 * function onSearchSubmit(value: string) {
 *   if (isSearchQueryBelowFloor(value)) return; // hold
 *   updateFilters({ q: gateSearchQuery(value) }); // issue, or clear on ''
 * }
 * ```
 */
export function isSearchQueryBelowFloor(
  raw: string | null | undefined
): boolean {
  const length = (raw ?? '').trim().length;
  return length > 0 && length < SEARCH_MIN_QUERY_LENGTH;
}
