/**
 * Facet-patch semantics for filterable list pages.
 *
 * Extracted from the explore page so the merge rules are testable in isolation.
 * The bug this exists to prevent: building each next URL from the CURRENT page
 * URL loses a facet whenever two writes happen before the router has advanced.
 * The explore filter drawer does exactly that on mobile Apply — it calls
 * `onFilterChange` then `onSortChange` in the same tick — so staging a sort and
 * a featured toggle together committed only the sort. Applying both patches to
 * ONE `URL` object, then navigating once, is the fix, and `applyFilterPatch` is
 * the part of it worth pinning with tests.
 */

/**
 * Apply a facet patch to `url` IN PLACE and return it, so successive patches
 * can accumulate on a single URL before a single navigation.
 *
 * - A truthy value sets the param; `null` (or an empty string) deletes it.
 * - A value equal to its entry in `defaults` deletes it too: the default is
 *   what the page shows with the param absent, so the URL stays canonical
 *   (`?range=30` and no `range` are the same view).
 * - Changing any param other than `page` resets `page`, because a facet change
 *   invalidates the current offset. Patching only `page` leaves it alone.
 */
export function applyFilterPatch(
  url: URL,
  patch: Record<string, string | null>,
  defaults: Record<string, string> = {}
): URL {
  let touchedFacet = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value && value !== defaults[key]) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    if (key !== 'page') touchedFacet = true;
  }
  if (touchedFacet) url.searchParams.delete('page');
  return url;
}

/**
 * The same-page href after applying `patch` to a COPY of `url`: path plus
 * query, no origin or hash. For a page that makes one filter change per
 * navigation (the studio list pages); `url` is left untouched.
 */
export function filterHref(
  url: URL,
  patch: Record<string, string | null>,
  defaults: Record<string, string> = {}
): string {
  const next = applyFilterPatch(new URL(url), patch, defaults);
  return `${next.pathname}${next.search}`;
}
