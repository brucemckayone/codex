/**
 * Source-selection rule for `useLiveQuery` + SSR-hydrated collections.
 *
 * TanStack Query's observer notification is microtask-scheduled, so the
 * live query reports `data: []` for a tick after every `setQueryData` —
 * even when the synchronous hydrate has already landed. That tick is
 * enough for Svelte's `$derived` to render the empty state before the
 * observer catches up, producing a "flash empty" symptom. Re-opens on
 * every navigation that re-hydrates (sort, filter, search).
 *
 * Disambiguate by comparing to the SSR payload: if SSR has items but
 * the live query is empty, the collection is mid-hydrate — render SSR.
 * Only trust an empty live query when SSR is also empty.
 *
 * Edge case: legitimate mutations that drain a non-empty collection to
 * zero (rare; not applicable on /explore where mutations don't subtract
 * from `contentCollection`) will briefly render the stale SSR items.
 * Pair with a "mutation occurred" flag if that matters for your page.
 */
export function selectLiveOrSsr<T>(
  liveData: readonly T[],
  ssrData: readonly T[]
): readonly T[] {
  return liveData.length === 0 && ssrData.length > 0 ? ssrData : liveData;
}
