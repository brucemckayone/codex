/**
 * A promise's settled value, read reactively: `undefined` until it settles,
 * then its value, or `null` if it failed.
 *
 * The hero's cover and poster change shape with whether there is media at
 * all, and an `{#await}` would re-mount everything it holds when the promise
 * settles (the headline would replay its entrance and the canvas would lose
 * its caret). Read in a `$derived`, this updates in place instead.
 *
 * One entry per promise, so a context rebuilt around the same promise never
 * starts over. The entry is created where it is first read — inside that
 * derived — and Svelte does not track state a reaction creates and reads in
 * the same run; so a settling promise bumps one signal made here, at module
 * scope, which every reader tracks. The promise's own callback writes it,
 * outside any effect. On the server nothing settles in time: `undefined`.
 */
let settledCount = $state(0);

const entries = new WeakMap<Promise<unknown>, { value: unknown }>();

export function settled<T>(promise: Promise<T>): T | null | undefined {
  void settledCount;
  let entry = entries.get(promise);
  if (!entry) {
    const fresh: { value: unknown } = { value: undefined };
    entries.set(promise, fresh);
    promise.then(
      (value) => {
        fresh.value = value;
        settledCount += 1;
      },
      () => {
        fresh.value = null;
        settledCount += 1;
      }
    );
    entry = fresh;
  }
  return entry.value as T | null | undefined;
}
