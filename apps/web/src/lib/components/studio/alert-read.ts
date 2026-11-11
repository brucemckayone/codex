/**
 * What LoadFailedAlert (and createLoadRetry) reads and retries: a remote
 * query, or a list read from the page's LOAD. The account payment page fails
 * in its load rather than in a remote query. Build its read in a `$derived`,
 * so it is rebuilt whenever the page's data changes:
 *
 *   const purchasesRead = $derived(
 *     loadRead({
 *       current: data.loadFailed ? undefined : data.purchases,
 *       error: data.loadFailed ? m.account_payments_load_failed() : undefined,
 *       refresh: () => invalidate('account:purchases'),
 *     })
 *   );
 *
 * The load must catch its own failure (a failed reload still lands as new
 * `data`) and `depends()` on the key `refresh` invalidates, or a Retry waits.
 *
 * Only `loadRead` makes one, and the alert tells it from a remote query by
 * its tag. Pass a remote query to the alert as it is: a plain object wrapping
 * one would hide kit's query swap on Retry from the alert.
 */

import type { QueryResult } from '$lib/remote/query-result';

const LOAD_READ: unique symbol = Symbol('load-read');

export interface LoadRead<T> extends QueryResult<T> {
  /** The page's `invalidate`. It must rerun the load the read is built from. */
  refresh: () => Promise<unknown>;
  readonly [LOAD_READ]: true;
}

/** A remote query as kit hands it to the page: a promise of its read. */
export type QueryRead = QueryResult<unknown> &
  PromiseLike<unknown> & { refresh: () => Promise<unknown> };

/** LoadFailedAlert's `query`: a remote query as it is, or a `loadRead`. */
export type AlertRead = QueryRead | LoadRead<unknown>;

/**
 * Makes a load read. Build it from the page's `data` alone, in a `$derived`:
 * the alert takes each new read as a new answer, so never mark the reload in
 * it. Its `refresh` must return the one `invalidate(key)` that reruns the
 * load it is built from (`depends(key)` there): a second invalidate in the
 * same tick resolves before anything reloads. If it reruns nothing, Retry is
 * offered again while the alert goes on waiting for the data to change.
 */
export function loadRead<T>(
  // Never a remote query: one goes to the alert as it is.
  read: Pick<LoadRead<T>, 'current' | 'error' | 'refresh'> & { then?: never }
): LoadRead<T> {
  return { ...read, [LOAD_READ]: true };
}

export function isLoadRead(read: object): read is LoadRead<unknown> {
  return LOAD_READ in read;
}
