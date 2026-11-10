/**
 * What LoadFailedAlert reads and retries: a remote query, or a list read from
 * the page's LOAD. The creator content list fails in its load rather than in
 * a remote query. Build its read in a `$derived`, so it is rebuilt whenever
 * the page's data changes:
 *
 *   const listRead = $derived(
 *     loadRead({
 *       current: data.failed ? undefined : data.content,
 *       error: data.failed ? m.studio_content_load_failed() : undefined,
 *       refresh: () => invalidate('cache:studio-page:content'),
 *     })
 *   );
 *
 * Its `refresh` must rerun the load the read is built from (`depends(key)`
 * there, `invalidate(key)` here): the alert's Retry ends when the page's data
 * changes, so a refresh that reruns nothing leaves it on "Retrying…".
 *
 * Only `loadRead` makes one, and the alert tells it from a remote query by
 * its tag. Pass a remote query to the alert as it is: a plain object wrapping
 * one would hide kit's query swap on Retry from the alert.
 */

import type { QueryResult } from '$lib/remote/query-result';

const LOAD_READ: unique symbol = Symbol('load-read');

export interface LoadRead<T> extends QueryResult<T> {
  /** The page's `invalidate`, which reruns the load the read is built from. */
  refresh: () => Promise<unknown>;
  readonly [LOAD_READ]: true;
}

/** A remote query as kit hands it to the page: a promise of its read. */
export type QueryRead = QueryResult<unknown> &
  PromiseLike<unknown> & { refresh: () => Promise<unknown> };

/** LoadFailedAlert's `query`: a remote query as it is, or a `loadRead`. */
export type AlertRead = QueryRead | LoadRead<unknown>;

export function loadRead<T>(
  // Never a remote query: one goes to the alert as it is.
  read: Pick<LoadRead<T>, 'current' | 'error' | 'refresh'> & { then?: never }
): LoadRead<T> {
  return { ...read, [LOAD_READ]: true };
}

export function isLoadRead(read: object): read is LoadRead<unknown> {
  return LOAD_READ in read;
}
