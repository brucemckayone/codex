/**
 * A remote query as kit 2.55 hands it to a page that derives it
 * (`const q = $derived(getX(id))`), for tests of what happens around a failed
 * read (Codex-zskbp).
 *
 * The slot doubles beside this one never swap their query, and kit does:
 * - A kit `Query` is a promise of its read: `await query` settles with it.
 * - Kit drops a FAILED query from its cache (`create_remote_function`). Its
 *   `refresh()` re-runs the page's derivation, which tracks the query's
 *   promise, and the derivation is handed a NEW query, still loading, with a
 *   read of its own. The refreshed query's read settles on its own.
 *
 * Here the refreshed query's own read fails at once, before the new one: the
 * order in which judging the refreshed query, not the held one, goes wrong.
 * A query that had loaded stays cached, so its refresh re-reads in place.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import { type Mock, vi } from 'vitest';

/** The shape SvelteKit rejects a remote query with: `{ status, body }`. */
const httpError = (status = 500) => ({
  status,
  body: { message: 'Internal Error' },
});

export interface KitRead<T> extends PromiseLike<T | undefined> {
  current: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: Mock<() => Promise<void>>;
}

export interface KitQuery<T> {
  /** What the page calls inside its `$derived`. */
  get(): KitRead<T>;
  /** The query the page holds now. */
  held(): KitRead<T>;
  /** The held query's read succeeds. */
  land(value: T): void;
  /** The held query's read fails; kit drops the query from its cache. */
  fail(error?: unknown): void;
}

interface Pending {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function pending(): Pending {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A read nobody awaits may fail; that is not an unhandled rejection.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function kitQuery<T>(): KitQuery<T> {
  const cache = $state({ generation: 0 });
  const reads = new WeakMap<KitRead<T>, Pending>();
  const dropped = new WeakSet<KitRead<T>>();

  function readOf(query: KitRead<T>): Pending {
    const read = reads.get(query);
    if (!read) throw new Error('kitQuery: a query with no read');
    return read;
  }

  function makeQuery(): KitRead<T> {
    const query: KitRead<T> = $state({
      current: undefined,
      error: undefined,
      loading: true,
      refresh: vi.fn(() => refresh(query)),
      // biome-ignore lint/suspicious/noThenProperty: a kit Query is thenable, and this double models it
      then: (onFulfilled, onRejected) =>
        readOf(query)
          .promise.then(() => query.current)
          .then(onFulfilled, onRejected),
    });
    reads.set(query, pending());
    return query;
  }

  let held = makeQuery();

  function refresh(query: KitRead<T>): Promise<void> {
    query.loading = true;
    if (!dropped.has(query)) {
      const read = pending();
      reads.set(query, read);
      return read.promise;
    }
    held = makeQuery();
    cache.generation += 1;
    query.loading = false;
    return Promise.reject(query.error);
  }

  return {
    get() {
      // Tracked by the caller's `$derived`, as kit's query promise is.
      void cache.generation;
      return held;
    },
    held: () => held,
    land(value) {
      const query = held;
      query.current = value;
      query.error = undefined;
      query.loading = false;
      readOf(query).resolve();
    },
    fail(error = httpError()) {
      const query = held;
      query.error = error;
      query.loading = false;
      dropped.add(query);
      readOf(query).reject(error);
    },
  };
}
