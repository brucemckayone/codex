/**
 * Test double of a page whose list is read from its LOAD, as the creator
 * content list's is: `$derived(loadRead({ current, error, refresh }))`, with
 * `refresh: () => invalidate(key)`. Built with the real `loadRead`.
 *
 * As kit 2.55's `invalidate` (client.js `_invalidate`):
 * - the read is rebuilt whenever the page's data changes, and is no promise;
 * - the load catches its own failure, so a failed reload still lands, with
 *   `error` set;
 * - the data lands first, and the refresh resolves only once the page's
 *   live remote queries have settled too (`landBeforeQueries`, then
 *   `queriesSettle`);
 * - an invalidate that another navigation or invalidate overtook resolves
 *   with the data unchanged (`overtake`). The run that overtook it usually
 *   lands the data later (`land` or `fail` after it); a shallow Back lands
 *   nothing.
 *
 * Not modelled: a load that throws (kit renders the error page instead).
 */

import { type LoadRead, loadRead } from '../alert-read';

export interface LoadReadDouble<T> {
  /** The read the page holds now. */
  get(): LoadRead<T>;
  /** How many times `refresh()` was called. */
  refreshes(): number;
  /** The reload lands with `value`, and its refresh resolves. */
  land(value: T): void;
  /** The reload lands failed, and its refresh resolves. */
  fail(): void;
  /** The reload lands with `value`; its refresh waits on other queries. */
  landBeforeQueries(value: T): void;
  /** The other live remote queries settle, so the refresh resolves. */
  queriesSettle(): void;
  /** Overtaken: the refresh resolves with the data unchanged. */
  overtake(): void;
}

interface Data<T> {
  failed: boolean;
  value: T | undefined;
}

/** A page whose first load failed, as the alert is mounted for. */
export function loadReadDouble<T>(): LoadReadDouble<T> {
  let data = $state<Data<T>>({ failed: true, value: undefined });
  let pending: (() => void) | null = null;
  let calls = 0;

  function refresh(): Promise<void> {
    calls += 1;
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  function resolvePending() {
    const resolve = pending;
    pending = null;
    resolve?.();
  }

  // Built from `data` alone, as a page builds it: new data, a new read.
  const read = $derived(
    loadRead<T>({
      current: data.failed ? undefined : data.value,
      error: data.failed ? 'The load failed.' : undefined,
      refresh,
    })
  );

  return {
    get: () => read,
    refreshes: () => calls,
    land(value) {
      data = { failed: false, value };
      resolvePending();
    },
    fail() {
      data = { failed: true, value: undefined };
      resolvePending();
    },
    landBeforeQueries(value) {
      data = { failed: false, value };
    },
    queriesSettle: resolvePending,
    overtake: resolvePending,
  };
}
