/**
 * `$app/navigation`'s `invalidate` as kit 2.55 runs it (client.js
 * `_invalidate`), for a page-level test of a Retry that reruns the page's
 * LOAD (Codex-if444). The page-level twin of `load-read.mock.svelte`, which
 * doubles the alert's read alone.
 *
 * Mount the page with `props` (reactive) and route the mocked
 * `$app/navigation` `invalidate` to `invalidate`. As kit does it:
 * - the rerun load lands as NEW data (`props.data` is replaced), a failed
 *   reload included: a load that catches its own failure returns data saying
 *   so;
 * - the data lands first, and the invalidate resolves only once the page's
 *   live remote queries have settled too (`landBeforeQueries`, then
 *   `queriesSettle`);
 * - an invalidate that another navigation or invalidate overtook resolves
 *   with the data unchanged (`overtake`). The run that overtook it usually
 *   lands the data later; a shallow Back lands nothing.
 * - a rerun of ANOTHER load (the platform layout's `cache:versions`, on
 *   every tab return) hands the page new merged `data`, with this load's
 *   output kept as it was, the same objects (`otherLoadReruns`).
 *
 * So the invalidate's promise is never the answer: judged when it resolves,
 * a Retry is judged late, or on the data it was meant to replace.
 *
 * Not modelled: a load that throws (kit renders the error page instead).
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file, so it is
 * never collected as a suite.
 */

export interface KitInvalidate<D> {
  /** The page's props: mount it with these. */
  readonly props: { data: D };
  /** What the page's `invalidate(key)` calls. */
  invalidate(key: string): Promise<void>;
  /** The keys invalidated so far, in order. */
  keys(): string[];
  /** The rerun load lands with `data`, and the invalidate resolves. */
  land(data: D): void;
  /** The rerun load lands with `data`; the invalidate waits on other queries. */
  landBeforeQueries(data: D): void;
  /** The page's live remote queries settle, so the invalidate resolves. */
  queriesSettle(): void;
  /** Overtaken: the invalidate resolves with the data unchanged. */
  overtake(): void;
  /** Another load reruns: new merged `data`, this load's output unchanged. */
  otherLoadReruns(): void;
}

export function kitInvalidate<D>(data: D): KitInvalidate<D> {
  const props = $state({ data });
  const keys: string[] = [];
  let pending: Array<() => void> = [];

  function resolvePending() {
    const waiting = pending;
    pending = [];
    for (const resolve of waiting) resolve();
  }

  return {
    props,
    invalidate(key) {
      keys.push(key);
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    },
    keys: () => [...keys],
    land(next) {
      props.data = next;
      resolvePending();
    },
    landBeforeQueries(next) {
      props.data = next;
    },
    queriesSettle: resolvePending,
    overtake: resolvePending,
    otherLoadReruns() {
      props.data = { ...props.data };
    },
  };
}
