import { gte, lte, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Builds SQL conditions for a single-column date window. Returns an array
 * of `SQL` conditions suitable for spreading into Drizzle's `and(...)`.
 *
 * Accepts ISO strings (from query params) OR Date objects (already parsed
 * by callers). Returns empty array when both bounds are absent.
 *
 * For NULL-fallback date windows (e.g. purchases.purchasedAt → createdAt),
 * use the specialised purchaseDateWindow helper in purchase-service.
 */
export function dateWindow(
  column: AnyPgColumn,
  from?: string | Date | null,
  to?: string | Date | null
): SQL[] {
  const conditions: SQL[] = [];
  if (from) {
    conditions.push(gte(column, from instanceof Date ? from : new Date(from)));
  }
  if (to) {
    conditions.push(lte(column, to instanceof Date ? to : new Date(to)));
  }
  return conditions;
}
