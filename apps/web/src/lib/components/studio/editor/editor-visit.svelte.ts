/**
 * The content editor's `{#key}` (Codex-a6ofh.2.3): one draft session per
 * visit. SvelteKit keeps a route's component across a move inside the route,
 * /new to /new or one piece's edit to another's, and a session kept would go
 * on editing the last piece. The editor's own URL swap (`replaceState`, once
 * the first save makes the row) is not a move, so it keeps the session.
 *
 * `ContentEditor` calls it during its initialisation. Kit calls an
 * `afterNavigate` callback for each navigation that lands after it mounts,
 * never on mount itself (2.55: `add_navigation_callback` only registers it).
 * So a mount made during a navigation hears that navigation land, and that
 * one is the visit's own, not a move. A mount made after its navigation
 * landed hears nothing for it. The org edit route mounts the editor once its
 * read answers, after the move that brought it, so the first navigation it
 * hears IS a move: "Open it to update" goes to the same address and counts on
 * this to swap in the live editor (the visual check, 2026-11-09). The app's
 * first page (`enter`) is never a move.
 */

import { afterNavigate } from '$app/navigation';
import { navigating } from '$app/state';

export function editorVisit(): { readonly key: number } {
  let key = $state(0);
  /**
   * Where the navigation in flight as this mounts is going, or null. Kit
   * passes `afterNavigate` that same navigation's `to`, so it is known by
   * identity when it lands. (`navigating` is raw state: no proxy.)
   */
  const mountedDuring = navigating.to;
  afterNavigate((navigation) => {
    if (navigation.type === 'enter') return;
    if (mountedDuring !== null && navigation.to === mountedDuring) return;
    key += 1;
  });
  return {
    get key() {
      return key;
    },
  };
}
