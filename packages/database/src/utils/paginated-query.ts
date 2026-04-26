/**
 * Paginated Query Helper
 *
 * Centralises the recurring "Promise.all([findMany, count]) → { items,
 * pagination }" envelope shape used by every paginated list method in the
 * service layer (content, media, templates, etc.).
 *
 * Design choice — callback for items, table+where for count:
 * Drizzle's `db.query.<table>.findMany()` builder is keyed by the schema
 * type, so reproducing its full type inference (relation `with`, column
 * selection, custom `orderBy`) inside a single helper signature would
 * require complex generics that risk falling back to `any`. The helper
 * therefore accepts a `fetchItems(limit, offset)` callback for the items
 * query (caller writes it locally with full inference), but takes a
 * `countQuery: { db, table, where }` triple for the count query — that
 * shape IS uniform across call sites (always `db.select({ x: count(...)
 * }).from(table).where(where)`), so the helper can own it without losing
 * type safety. This eliminates the literal `.select({ ... count() })`
 * fragment from every service method.
 *
 * The helper owns:
 *   1. Page → offset conversion (delegating to `withPagination`).
 *   2. The actual `db.select({ total: count() }).from(table).where(where)`
 *      query that runs the count.
 *   3. Concurrent execution of items + count via `Promise.all`.
 *   4. `totalPages = Math.ceil(total / limit)` calculation.
 *   5. `{ items, pagination: { page, limit, total, totalPages } }` envelope.
 *
 * Callers retain control of:
 *   - The Drizzle table being queried (and its `with` relations) inside
 *     `fetchItems`.
 *   - The where-clause for both items and count (passed into both).
 *   - Any post-fetch row mapping (e.g. content body sanitisation in
 *     `listPublic`) — pass `mapItem` for declarative mapping, or simply
 *     map inside `fetchItems`.
 *   - Whether they wrap the return in `new PaginatedResult(items,
 *     pagination)` (worker-utils marker class) or return the plain
 *     envelope (most service methods today).
 */

import { count, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Database, DatabaseWs } from '../client';
import { withPagination } from './query-helpers';

/**
 * Paginated query envelope returned by `paginatedQuery`.
 *
 * Matches the shape services currently return inline. Procedure handlers
 * either return this envelope directly or wrap it in `new
 * PaginatedResult(items, pagination)` (the worker-utils marker class) at
 * the call site.
 */
export interface PaginatedQueryResult<TItem> {
  items: TItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Count-query input — describes the table + where clause used to compute
 * the total row count. The helper runs `db.select({ total: count() })
 * .from(table).where(where)` internally, eliminating the literal SELECT
 * COUNT fragment from every service method.
 */
export interface CountQuery {
  /** Database client (HTTP or WebSocket). */
  db: Database | DatabaseWs;
  /** Drizzle table to count rows from. */
  table: PgTable;
  /** Same WHERE clause as the items query. */
  where: SQL<unknown> | undefined;
}

async function runCount(input: CountQuery): Promise<number> {
  const result = await input.db
    .select({ total: count() })
    .from(input.table)
    .where(input.where);
  return Number(result[0]?.total ?? 0);
}

/**
 * Run a paginated list query.
 *
 * Two overloads: with or without `mapItem`. Splitting them avoids the
 * need for a runtime narrowing cast inside the implementation — when
 * `mapItem` is provided, items are `TItem[]`; when omitted, items are
 * `TRow[]`.
 *
 * Overload order matters: the more specific (`mapItem` present) variant
 * must come first so TypeScript prefers it when the caller passes a
 * mapper. Otherwise the first overload's call signature accepts the
 * object literal (excess properties allowed in some inference paths) and
 * `item` falls through to `any`.
 *
 * @example
 * ```typescript
 * // ContentService.list
 * const where = and(...whereConditions);
 * return paginatedQuery({
 *   page: pagination.page,
 *   limit: pagination.limit,
 *   fetchItems: (limit, offset) =>
 *     this.db.query.content.findMany({
 *       where,
 *       limit,
 *       offset,
 *       orderBy: [orderByClause],
 *       with: { mediaItem: true, organization: true, creator: { columns: { id: true, email: true, name: true } } },
 *     }),
 *   countQuery: { db: this.db, table: content, where },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // ContentService.listPublic — with row mapper for body sanitisation
 * return paginatedQuery({
 *   page: params.page,
 *   limit: params.limit,
 *   fetchItems: (limit, offset) => this.db.query.content.findMany({ ... }),
 *   countQuery: { db: this.db, table: content, where },
 *   mapItem: (item) =>
 *     item.accessType === CONTENT_ACCESS_TYPE.FREE
 *       ? item
 *       : { ...item, contentBody: null, contentBodyJson: null },
 * });
 * ```
 */
export function paginatedQuery<TRow, TItem>(options: {
  page: number;
  limit: number;
  fetchItems: (limit: number, offset: number) => Promise<TRow[]>;
  countQuery: CountQuery;
  mapItem: (row: TRow) => TItem;
}): Promise<PaginatedQueryResult<TItem>>;
export function paginatedQuery<TRow>(options: {
  page: number;
  limit: number;
  fetchItems: (limit: number, offset: number) => Promise<TRow[]>;
  countQuery: CountQuery;
}): Promise<PaginatedQueryResult<TRow>>;
export async function paginatedQuery<TRow, TItem>(options: {
  page: number;
  limit: number;
  fetchItems: (limit: number, offset: number) => Promise<TRow[]>;
  countQuery: CountQuery;
  mapItem?: (row: TRow) => TItem;
}): Promise<PaginatedQueryResult<TRow | TItem>> {
  const { page, fetchItems, countQuery, mapItem } = options;
  const { limit, offset } = withPagination({ page, limit: options.limit });

  const [rows, total] = await Promise.all([
    fetchItems(limit, offset),
    runCount(countQuery),
  ]);

  const items: (TRow | TItem)[] = mapItem ? rows.map(mapItem) : rows;

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
