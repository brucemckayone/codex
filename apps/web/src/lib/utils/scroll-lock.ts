import { isIos } from '@melt-ui/svelte/internal/helpers';

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
 * The lock holds the viewport: `overflow: hidden` on <html>. Melt's own lock
 * set it on <body>, which reaches the viewport only while <html>'s overflow
 * is `visible`, and base.css clips <html>'s overflow-x. So in the app the
 * page behind every dialog still scrolled under the wheel, and Melt's
 * scrollbar padding narrowed it by the scrollbar's width while the
 * scrollbar stayed (Codex-vlphc review N7). A classic scrollbar's gutter is
 * kept (`scrollbar-gutter: stable`), so nothing moves sideways: in-flow
 * content keeps its width and a fixed bar its right edge. iOS scrolls a
 * page that `overflow: hidden` does not hold, so there <body> is also fixed
 * in place at its scroll position, which is restored at the release.
 *
 * Every style is put back exactly at the last release. The lock keeps
 * Melt's `data-melt-scroll-lock` mark: a Melt builder that locks on its own
 * (a Select open inside a dialog) finds the page held and stacks nothing on
 * it, and a page Melt already holds is left as it is.
 */
const MARK = 'data-melt-scroll-lock';
let holders = 0;
let release: () => void = () => {};

/** Hold the page still. Call what it returns to let go; a second call does nothing. */
export function lockScroll(): () => void {
  holders += 1;
  if (holders === 1) release = hold();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders === 0) release();
  };
}

function hold(): () => void {
  const { documentElement: html, body } = document;
  if (body.hasAttribute(MARK)) return () => {};
  body.setAttribute(MARK, '');
  // Read before anything changes: a classic scrollbar's width; 0 for an
  // overlay scrollbar, or a page too short to scroll.
  const scrollbar = window.innerWidth - html.clientWidth;
  const before = body.getBoundingClientRect();
  const undo = [setStyle(html, 'overflow', 'hidden')];
  if (scrollbar > 0) {
    undo.push(setStyle(html, 'scrollbar-gutter', 'stable'));
    // WebKit keeps no gutter on a root that is `overflow: hidden`: the page
    // widens by the scrollbar. Padding on that side takes it back, so
    // in-flow content still keeps its width (a fixed bar there still widens).
    const after = body.getBoundingClientRect();
    const grown = after.width - before.width;
    if (grown > 0.5) {
      const side = after.left < before.left ? 'padding-left' : 'padding-right';
      const padding =
        Number.parseFloat(getComputedStyle(html).getPropertyValue(side)) || 0;
      undo.push(setStyle(html, side, `${padding + grown}px`));
    }
  }
  if (isIos()) undo.push(fixBody(body));
  return () => {
    // The mark goes whatever happens. Left behind, it reads as another
    // lock's, and every hold() after it would leave the page alone: locked
    // for the rest of the session.
    try {
      for (const restore of undo.reverse()) restore();
    } finally {
      body.removeAttribute(MARK);
    }
  };
}

/** iOS: <body> fixed at the page's scroll position, which is put back at the release. */
function fixBody(body: HTMLElement): () => void {
  const { scrollX, scrollY, visualViewport } = window;
  const undo = [
    setStyle(body, 'position', 'fixed'),
    setStyle(
      body,
      'top',
      `${-(scrollY - Math.floor(visualViewport?.offsetTop ?? 0))}px`
    ),
    setStyle(
      body,
      'left',
      `${-(scrollX - Math.floor(visualViewport?.offsetLeft ?? 0))}px`
    ),
    setStyle(body, 'right', '0'),
  ];
  return () => {
    for (const restore of undo.reverse()) restore();
    // Instant: base.css makes <html> scroll smoothly, and the page would
    // glide back down from the top. An engine whose ScrollBehavior has no
    // 'instant' throws a TypeError at it; the page still goes back, gliding.
    try {
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    } catch {
      window.scrollTo(scrollX, scrollY);
    }
  };
}

/** Set one inline style; what it returns puts back exactly what was there. */
function setStyle(
  el: HTMLElement,
  property: string,
  value: string
): () => void {
  const previous = el.style.getPropertyValue(property);
  const priority = el.style.getPropertyPriority(property);
  el.style.setProperty(property, value);
  return () => {
    if (previous) el.style.setProperty(property, previous, priority);
    else el.style.removeProperty(property);
  };
}
