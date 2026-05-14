/**
 * Shape returned by SvelteKit's query() when called client-side.
 *
 * Duplicated locally in payouts/subscribers/sales studio pages before this
 * refactor — see Codex-yre9v. SvelteKit's query() return type is loose, so
 * call sites cast `(someQuery as QueryResult<X> | null)?.current` defensively.
 */
export interface QueryResult<T> {
  current: T | undefined;
  loading?: boolean;
  error?: { message?: string } | null;
}
