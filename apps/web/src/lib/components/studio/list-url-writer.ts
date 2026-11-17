/**
 * How a studio list writes its view back to the URL (Codex-a6ofh.3.1; the
 * media library's since Codex-a6ofh.1.7). The URL is the list's source of
 * truth, so a facet, a sort, the search and the view are all writes here.
 *
 * - Facet changes made in one tick land in ONE navigation. The phone sheet's
 *   Apply calls its filter and sort setters back to back; built from
 *   `page.url` each, the second would undo the first (see filter-url.ts).
 * - A navigation in flight to this page is newer than `page.url`, so a write
 *   made during it builds on it rather than dropping it. One to another page
 *   is not this list's URL.
 * - A write that changes nothing navigates nowhere. A navigation re-runs
 *   whatever reads `page`, so an echo that writes the same URL back would
 *   loop without ever yielding.
 */
import { goto } from '$app/navigation';
import { navigating, page } from '$app/state';
import { applyFilterPatch } from '$lib/utils/filter-url';

/** A URL write: each param's new value, `null` for its default. */
export type ListUrlPatch = Record<string, string | null | undefined>;

/** The list's URL as it is about to be: a navigation to it in flight, or here. */
function currentUrl(): URL {
  const to = navigating?.to?.url;
  const here = page.url;
  return to && to.origin === here.origin && to.pathname === here.pathname
    ? to
    : here;
}

/**
 * A writer for one list, given each param's bare-URL value (`applyFilterPatch`'s
 * `defaults`): a value equal to it leaves the param out. `undefined` in a
 * patch leaves that param as it is.
 */
export function createListUrlWriter(
  defaults: Record<string, string>
): (patch: ListUrlPatch) => void {
  let pending: URL | null = null;

  return function write(patch) {
    const clean: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) clean[key] = value;
    }
    if (pending) {
      applyFilterPatch(pending, clean, defaults);
      return;
    }
    const url = applyFilterPatch(new URL(currentUrl()), clean, defaults);
    pending = url;
    queueMicrotask(() => {
      pending = null;
      const href = `${url.pathname}${url.search}`;
      const shown = currentUrl();
      if (href === `${shown.pathname}${shown.search}`) return;
      void goto(href, { keepFocus: true, noScroll: true });
    });
  };
}

/** How long a list's search box waits after a keystroke to write the URL. */
export const LIST_SEARCH_DEBOUNCE_MS = 300;

/**
 * A studio list's search box, written to the URL (Codex-a6ofh.3.1): typing
 * writes once it pauses, Clear writes at once. Both cancel a write still
 * waiting, which would otherwise put the typed text back after a Clear;
 * `cancel()` is for the caller's own resets (Clear filters) and unmount, when
 * a late write would land on whatever page came next.
 */
export function createListSearch(
  write: (search: string | null) => void,
  delayMs = LIST_SEARCH_DEBOUNCE_MS
): { input: (value: string) => void; clear: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  return {
    input(value) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        write(value.trim() ? value : null);
      }, delayMs);
    },
    clear() {
      cancel();
      write(null);
    },
    cancel,
  };
}
