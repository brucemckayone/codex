/**
 * UI filter primitives shared across studio surfaces (sales, payouts,
 * analytics, customers). These are URL-derived enums — the values are
 * the canonical query-string forms, NOT human labels.
 *
 * Workers do not consume these directly today (they accept ISO-8601
 * `fromDate`/`toDate` instead), but `DateRange` defines the
 * SvelteKit-side vocabulary that pages translate into those windows.
 */

/**
 * Lookback window for studio filter chips.
 *
 * Values:
 *  - `'7'`   — last 7 days
 *  - `'30'`  — last 30 days (default across studio surfaces)
 *  - `'90'`  — last 90 days
 *  - `'all'` — no lookback window
 *
 * Codex-6nt4l: lifted out of per-page declarations after sales + payouts
 * duplicated the same union. New surfaces (analytics, customers) should
 * import this rather than redefine.
 */
export type DateRange = '7' | '30' | '90' | 'all';
