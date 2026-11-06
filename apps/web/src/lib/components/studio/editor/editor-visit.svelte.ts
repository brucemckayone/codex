/**
 * The content editor's `{#key}` (Codex-a6ofh.2.3): one draft session per
 * visit. SvelteKit keeps a route's component across a move inside the route,
 * /new to /new or one piece's edit to another's, and a session kept would go
 * on editing the last piece. The editor's own URL swap (`replaceState`, once
 * the first save makes the row) is not a move, so it keeps the session.
 *
 * `ContentEditor` calls it during its initialisation. `afterNavigate` also
 * runs once as the caller mounts, for the visit that mounted it, which is
 * never counted as a move.
 */

import { afterNavigate } from '$app/navigation';

export function editorVisit(): { readonly key: number } {
  let key = $state(0);
  /** The navigation that mounted the route is this visit's own. */
  let entered = false;
  afterNavigate(() => {
    if (entered) key += 1;
    entered = true;
  });
  return {
    get key() {
      return key;
    },
  };
}
