/**
 * ISO-date serialisation helper.
 *
 * Service formatters at the API boundary frequently receive a value that is
 * either a `Date` (when the row came from Drizzle's WS client) or an
 * already-serialised ISO string (when the row came from the HTTP client or
 * Stripe). This helper canonicalises both shapes so read-models can be typed
 * cleanly and JSON serialisation is deterministic.
 *
 * Overloads preserve non-nullability: a non-null input yields a non-null
 * string, mirroring the original `x instanceof Date ? x.toISOString() : x`
 * ternary it replaces (which never widened to null when the source column
 * was non-nullable).
 *
 * @example
 *   toIso(new Date('2026-05-14T10:00:00Z')) // '2026-05-14T10:00:00.000Z'
 *   toIso('2026-05-14T10:00:00.000Z')       // '2026-05-14T10:00:00.000Z'
 *   toIso(null)                              // null
 *   toIso(undefined)                         // null
 */
export function toIso(d: Date | string): string;
export function toIso(d: Date | string | null | undefined): string | null;
export function toIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : d;
}
