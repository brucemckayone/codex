/**
 * The queue's counts, as ONE held query for the /admin area (Codex-2hxff.28).
 *
 * The /admin layout creates it for the nav badge and provides it; the queue
 * and charge pages refresh that same instance. Calling
 * `getSupportQueueCounts()` again is not the same thing: kit drops a query
 * whose first load failed from its cache, so a second call makes a new
 * instance the layout never reads, and the badge would never come back.
 */

import { getContext, setContext } from 'svelte';
import { getSupportQueueCounts } from '$lib/remote/support.remote';

type CountsQuery = ReturnType<typeof getSupportQueueCounts>;

const KEY = Symbol('support-queue-counts');

/** In the /admin layout: create the counts query and hand it to the pages. */
export function provideQueueCounts(): CountsQuery {
  const query = getSupportQueueCounts();
  setContext(KEY, query);
  return query;
}

/** The layout's instance; a page mounted without the layout gets its own. */
export function useQueueCounts(): CountsQuery {
  return getContext<CountsQuery | undefined>(KEY) ?? getSupportQueueCounts();
}
