/**
 * Test double of a read that comes from the page's LOAD, not a remote query:
 * the creator content list builds one as
 * `$derived({ current, error, refresh: () => invalidate(key) })`.
 *
 * As there:
 * - the read object is rebuilt whenever the page's data changes, and is not
 *   thenable;
 * - the load catches its own failure, so a failed reload still lands, with
 *   `error` set;
 * - `refresh()` resolves only once the reload has landed, as `invalidate`
 *   does.
 *
 * With `marksReloading`, `refresh()` also marks the reload in the data at
 * once, so the page hands the alert a NEW read before the reload lands.
 */

import type { QueryResult } from '$lib/remote/query-result';

export type LoadReadResult<T> = QueryResult<T> & {
  refresh: () => Promise<void>;
};

export interface LoadRead<T> {
  /** The read the page holds now: a page derives it from its data. */
  get(): LoadReadResult<T>;
  /** How many times `refresh()` was called. */
  refreshes(): number;
  /** The pending reload lands with `value`; its `refresh()` resolves. */
  land(value: T): void;
  /** The pending reload lands failed; its `refresh()` resolves. */
  fail(): void;
}

interface Data<T> {
  failed: boolean;
  value: T | undefined;
  reloading: boolean;
}

/** A load read whose first load failed, as the alert is mounted for. */
export function loadRead<T>(
  options: { marksReloading?: boolean } = {}
): LoadRead<T> {
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

  function landWith(next: Data<T>) {
    data = next;
    const resolve = pending;
    pending = null;
    resolve?.();
  }

  const read = $derived<LoadReadResult<T> & { reloading: boolean }>({
    current: data.failed ? undefined : data.value,
    error: data.failed ? 'The load failed.' : undefined,
    reloading: data.reloading,
    refresh,
  });

  return {
    get: () => read,
    refreshes: () => calls,
    land: (value) => landWith({ failed: false, value, reloading: false }),
    fail: () => landWith({ failed: true, value: undefined, reloading: false }),
  };
}
