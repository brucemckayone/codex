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

/**
 * Whether a query is on its FIRST load: no value yet, and no failure.
 *
 * Not the query's own `loading`, which is also true during every refresh (a
 * Retry, an `invalidateAll()`). A surface gated on `loading` flips its loaded
 * content back to skeletons for each round trip; one gated on this keeps it,
 * because kit's `Query` keeps `current` through a refresh. A query that was
 * never made (`null`) is not loading.
 */
export function isFirstLoad(
  query: QueryResult<unknown> | null | undefined
): boolean {
  if (!query) return false;
  return query.current === undefined && queryErrorMessage(query.error) === null;
}

/**
 * The worker's `error.code`, wherever the rejection carries it: under `body`
 * for an `HttpError`, at the top for anything code-bearing.
 */
export function remoteErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const body = (error as { body?: unknown }).body;
  if (body !== null && typeof body === 'object') {
    const nested = (body as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  const direct = (error as { code?: unknown }).code;
  return typeof direct === 'string' ? direct : undefined;
}

/**
 * The HTTP status a remote call's rejection carries (an `HttpError`'s
 * `status`), or undefined for a network failure or a plain `Error`.
 */
export function remoteErrorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** The parts of kit's `RemoteQuery` that {@link readFreshQuery} uses. */
export interface FreshReadable<T> extends PromiseLike<unknown> {
  readonly ready: boolean;
  readonly loading: boolean;
  readonly current: T | undefined;
  refresh(): Promise<void>;
}

/**
 * The value of a remote query as the server has it now, never a cached read:
 * for a check a write is about to trust (the media delete's usage read,
 * Codex-6sbn1).
 *
 * kit caches a query while anything tracks it, so `getX(arg)` can hand back a
 * read another component made minutes ago. One that has landed and is idle is
 * asked again; one just made, or still in flight, is already fresh, and a
 * refresh would only send a second request. Rejects when the read fails, and
 * when it answers nothing.
 */
export async function readFreshQuery<T>(query: FreshReadable<T>): Promise<T> {
  if (query.ready && !query.loading) {
    await query.refresh();
  } else {
    await query;
  }
  const value = query.current;
  if (value === undefined) throw new Error('The query answered nothing');
  return value;
}
