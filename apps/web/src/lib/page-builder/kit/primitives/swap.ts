/**
 * The two steps by which a section trades its full markup for a more compact
 * control on a phone: the before and after's toggle, the curriculum
 * timeline's folding stages (03 X55, X57).
 *
 * The section is SERVED full, at every width, so a visitor without JavaScript
 * reads all of it. The page's script swaps it only where it is at phone width
 * (`phoneWidth`), and only once doing so moves nothing the visitor is looking
 * at (`whenAhead`).
 */
import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

/**
 * Calls `go` once, when re-laying the section out moves nothing in view: the
 * section is still ahead of the visitor (below the viewport), or the page is
 * a still preview (the canvas, thumbnails), which nobody is scrolling. With
 * no IntersectionObserver it never calls, and the section stays as served.
 */
export function whenAhead(go: () => void): Attachment<HTMLElement> {
  return (root) => {
    if (typeof IntersectionObserver === 'undefined') return;
    const still = root.closest('[data-lp-still]') !== null;
    const observer = new IntersectionObserver(([entry]) => {
      if (
        still ||
        (!entry.isIntersecting && entry.boundingClientRect.top > 0)
      ) {
        go();
        observer.disconnect();
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  };
}

/**
 * Follows the section across its phone-width breakpoint as it resizes.
 *
 * The breakpoint is the stylesheet's, never restated here: the block sets
 * `--_phone: 1` on the attached element under its own container query, and
 * this reads it. `follow` hears the first reading at once and every change
 * after it. A change waits a frame: made inside the observer's own delivery,
 * it would resize the section being observed, which the browser reports as a
 * loop.
 */
export function phoneWidth(
  follow: (phone: boolean, root: HTMLElement) => void
): Attachment<HTMLElement> {
  return (root) => {
    const read = () =>
      getComputedStyle(root).getPropertyValue('--_phone').trim() === '1';
    let phone = read();
    // What `follow` reads is its own business: it must not re-run this.
    untrack(() => follow(phone, root));
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = read();
        if (next === phone) return;
        phone = next;
        follow(next, root);
      });
    });
    // The section is the query container the breakpoint is measured on.
    observer.observe(root.closest('.lp-section') ?? root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  };
}
