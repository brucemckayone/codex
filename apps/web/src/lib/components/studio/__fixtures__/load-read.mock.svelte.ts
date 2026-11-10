/**
 * Test double of a page whose list is read from its LOAD, as the creator
 * content list's is: `$derived(loadRead({ current, error, refresh }))`, with
 * `refresh: () => invalidate(key)`. Built with the real `loadRead`.
 *
 * As kit 2.55's `invalidate` (client.js `_invalidate`):
 * - the read is rebuilt whenever the page's data changes, and is no promise;
 * - the load catches its own failure, so a failed reload still lands, with
 *   `error` set;
 * - the data lands first, and the refresh resolves only once every live
 *   remote query has settled too (`landBeforeQueries`, then
 *   `queriesSettle`);
 * - an invalidate that another navigation or invalidate overtakes resolves
 *   with nothing rerun (`overtake`).
 *
 * With `marksReloading`, `refresh()` also marks the reload in the data at
 * once, so the page hands the alert a NEW read before the reload lands.
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
  /** Overtaken: the refresh resolves, and the page's data is unchanged. */
  overtake(): void;
}

interface Data<T> {
  failed: boolean;
  value: T | undefined;
  reloading: boolean;
}

/** A page whose first load failed, as the alert is mounted for. */
export function loadReadDouble<T>(
  options: { marksReloading?: boolean } = {}
): LoadReadDouble<T> {
  let data = $state<Data<T>>({
    failed: true,
    value: undefined,
    reloading: false,
  });
  let pending: (() => void) | null = null;
  let calls = 0;

  function refresh(): Promise<void> {
    calls += 1;
    if (options.marksReloading) data = { ...data, reloading: true };
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  function resolvePending() {
    const resolve = pending;
    pending = null;
    resolve?.();
  }

  // Reads `data` itself, so any new data, `reloading` included, rebuilds it.
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
      data = { failed: false, value, reloading: false };
      resolvePending();
    },
    fail() {
      data = { failed: true, value: undefined, reloading: false };
      resolvePending();
    },
    landBeforeQueries(value) {
      data = { failed: false, value, reloading: false };
    },
    queriesSettle: resolvePending,
    overtake: resolvePending,
  };
}
