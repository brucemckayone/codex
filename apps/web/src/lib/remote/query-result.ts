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
  /**
   * The rejection value, once the query has failed.
   *
   * DELIBERATELY `unknown` (Codex-xo3bl). SvelteKit rejects a failed remote
   * query with `HttpError`, whose shape is `{ status, body: { message } }` — it
   * carries NO top-level `message`. This field used to be typed
   * `{ message?: string } | null`, which type-checked four studio pages that all
   * read `error?.message`, got `undefined` forever, and therefore NEVER entered
   * their error branch: the surface sat on its loading skeletons instead of
   * reporting the failure. SvelteKit's own types warn the rejection is only
   * "most often" an `HttpError`, so no single struct is honest here.
   *
   * Read it through {@link queryErrorMessage}, never by property access.
   */
  error?: unknown;
}

/**
 * Human-readable text for a failed remote query, or `null` if it has not failed.
 *
 * Handles every rejection shape SvelteKit can produce:
 *   - `HttpError` — `{ status, body: { message } }`, the normal single-query path
 *   - `Error` — e.g. `Error('Failed to execute batch query')` from the batched
 *     path's outer catch, which has `message` but no `body`
 *   - a bare string, or anything else (→ `fallback`)
 *
 * NEVER returns `null` for a present error, so `{#if queryErrorMessage(...)}` is
 * a sound "did this fail?" test — the property-access version it replaces was
 * not, and that is precisely how Codex-xo3bl stayed invisible.
 */
export function queryErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string | null {
  if (error === null || error === undefined) return null;

  if (typeof error === 'string') return error.length > 0 ? error : fallback;

  if (typeof error === 'object') {
    // HttpError puts the text one level down, under `body`.
    const body = (error as { body?: unknown }).body;
    if (body !== null && typeof body === 'object') {
      const nested = (body as { message?: unknown }).message;
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }

    // A plain Error (or anything else message-bearing) keeps it at the top.
    const direct = (error as { message?: unknown }).message;
    if (typeof direct === 'string' && direct.length > 0) return direct;
  }

  return fallback;
}
