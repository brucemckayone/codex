/**
 * A remote query as kit 2.55 hands it to a page that derives it
 * (`const q = $derived(getX(id))`), for tests of what happens around a failed
 * read (Codex-zskbp). Read against kit's `runtime/client/remote-functions/`:
 * `query.svelte.js` (class Query) and `shared.svelte.js`
 * (`create_remote_function`).
 *
 * As kit does it:
 * - A query is a promise of its LATEST read. `await query` settles with that
 *   read, after a `tick()`, to `current`; a failed read rejects with its error.
 * - `refresh()` starts a new read: `loading` goes true, and `current` and
 *   `error` stay. When a later read settles, every earlier read still pending
 *   resolves, whatever the later one did, and changes nothing.
 * - A query whose FIRST read fails is dropped from kit's cache: the `.catch`
 *   is attached once, at creation. Its `refresh()` still fetches it again,
 *   and it also re-runs the page's derivation (which tracks the query's
 *   promise), so the page is handed a NEW query, still loading, with a read
 *   of its own. A query whose first read landed stays cached, so its refresh
 *   re-reads in place.
 *
 * `land` and `fail` settle the latest read of the held query, or of the query
 * named. So a test can settle a dropped query's stray fetch before or after
 * the held query's read.
 *
 * Not modelled: kit makes the new query when the page next reads its
 * derivation, and this double makes it inside `refresh()`. A page reads the
 * same query either way.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

import { tick } from 'svelte';
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
  /** The latest read of `query` (the held one by default) succeeds. */
  land(value: T, query?: KitRead<T>): void;
  /** The latest read of `query` (the held one by default) fails. */
  fail(error?: unknown, query?: KitRead<T>): void;
}

interface Read {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** A query's reads: those still pending (oldest first), its latest, its first. */
interface Reads {
  pending: Read[];
  latest: Read;
  first: Read;
}

function newRead(): Read {
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
  const readsOf = new WeakMap<KitRead<T>, Reads>();
  const dropped = new WeakSet<KitRead<T>>();

  function reads(query: KitRead<T>): Reads {
    const found = readsOf.get(query);
    if (!found) throw new Error('kitQuery: not a query of this double');
    return found;
  }

  function makeQuery(): KitRead<T> {
    const query: KitRead<T> = $state({
      current: undefined,
      error: undefined,
      loading: true,
      refresh: vi.fn(() => refresh(query)),
      // biome-ignore lint/suspicious/noThenProperty: a kit Query is thenable, and this double models it
      then: (onFulfilled, onRejected) =>
        reads(query)
          .latest.promise.then(async () => {
            await tick();
            return query.current;
          })
          .then(onFulfilled, onRejected),
    });
    const first = newRead();
    readsOf.set(query, { pending: [first], latest: first, first });
    return query;
  }

  let held = makeQuery();

  function refresh(query: KitRead<T>): Promise<void> {
    const own = reads(query);
    const read = newRead();
    own.pending.push(read);
    own.latest = read;
    query.loading = true;
    if (dropped.has(query) && query === held) {
      held = makeQuery();
      cache.generation += 1;
    }
    return read.promise;
  }

  /** Settles the latest read of `query`; earlier pending reads resolve. */
  function settle(query: KitRead<T>): Read {
    const own = reads(query);
    const read = own.latest;
    const at = own.pending.indexOf(read);
    if (at === -1) throw new Error('kitQuery: its latest read has settled');
    for (const earlier of own.pending.splice(0, at)) earlier.resolve();
    own.pending.shift();
    return read;
  }

  return {
    get() {
      // Tracked by the caller's `$derived`, as kit's query promise is.
      void cache.generation;
      return held;
    },
    held: () => held,
    land(value, query = held) {
      const read = settle(query);
      query.current = value;
      query.error = undefined;
      query.loading = false;
      read.resolve();
    },
    fail(error = httpError(), query = held) {
      const read = settle(query);
      query.error = error;
      query.loading = false;
      if (read === reads(query).first) dropped.add(query);
      read.reject(error);
    },
  };
}
