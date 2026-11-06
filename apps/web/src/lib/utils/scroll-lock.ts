import { removeScroll } from '@melt-ui/svelte/internal/helpers';

/**
 * The page's scroll lock: one for the whole app, counted.
 *
 * Melt's dialog took the lock itself and, under `forceVisible`, let go only
 * when the panel left the DOM. A dialog reopened during its close animation
 * kept its panel, and Melt's second lock, a no-op on a page already locked,
 * replaced the only release: the page never scrolled again until a reload
 * (Codex-vlphc review H1). Here whatever opens a modal holds the lock until
 * it closes, animating out or not, and the page is let go when the last
 * holder releases, so a dialog over a dialog keeps it still until both have
 * closed.
 *
 * The lock itself is still Melt's `removeScroll`, so the page behind looks
 * as it did: body `overflow: hidden`, padded on its scrollbar side so nothing
 * moves, and `position: fixed` on iOS. It keeps Melt's
 * `data-melt-scroll-lock` mark too: a Melt builder that locks on its own (a
 * Select open inside a dialog) finds the page held and stacks nothing on it,
 * and a page Melt already holds is left as it is.
 */
let holders = 0;
let release: () => void = () => {};

/** Hold the page still. Call what it returns to let go; a second call does nothing. */
export function lockScroll(): () => void {
  holders += 1;
  if (holders === 1) release = removeScroll();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders === 0) release();
  };
}
