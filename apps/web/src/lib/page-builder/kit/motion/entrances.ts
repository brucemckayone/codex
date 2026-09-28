/**
 * Everything on a page that ENTERS (03-expressive-contract X13), found as the
 * page mounts and again whenever content is added (a streamed section, a
 * layout that swaps its parts), and handed to the page's stage.
 *
 * Only what `motion.css` would move is armed. A candidate is tried on its
 * first frame (`data-lp-enter="wait"`); if nothing it or its marks would play
 * shows up — no motion attribute, no hook from the Style — it is let go at
 * once. So the Style's hooks and marks stay pure CSS, read in one place.
 */
import type { Attachment } from 'svelte/attachments';
import { type Actor, stageFor } from './stage';

/**
 * Where an entrance can be: the attribute API, and what the hooks and marks
 * reach. Inside `:is()`, whose forgiving list drops `:has()` where a browser
 * lacks it instead of throwing.
 */
const CANDIDATES =
  ':is([data-lp-reveal], [data-lp-build], [data-lp-draw]:not(svg), .lp-heading, .lp-media, .stat__value, :has(> .lp-media))';

/**
 * Its own CSS animations in time, and its marks'. Not a transition that
 * happens to be running (a story's heading changing ink), and not a scrubbed
 * animation, which is no entrance.
 */
function moving(el: Element): Animation[] {
  return el
    .getAnimations({ subtree: true })
    .filter(
      (a) =>
        'animationName' in a &&
        (a.effect as KeyframeEffect | null)?.target === el &&
        a.timeline === el.ownerDocument.timeline
    );
}

function entrance(el: Element): Actor {
  const settle = () => {
    el.removeAttribute('data-lp-enter');
    el.removeAttribute('data-lp-order');
  };
  return {
    arm() {
      el.setAttribute('data-lp-enter', 'wait');
      if (moving(el).length > 0) return true;
      settle();
      return false;
    },
    play(order) {
      if (order > 0) el.setAttribute('data-lp-order', String(order));
      el.setAttribute('data-lp-enter', 'go');
      void Promise.allSettled(moving(el).map((a) => a.finished)).then(settle);
    },
    settle,
  };
}

/**
 * On the page's root. `off` (a still page) is passed so the attachment runs
 * again when it changes.
 */
export function entrances(off: boolean): Attachment<HTMLElement> {
  return (root) => {
    if (off) return;
    const staged = new Map<Element, () => void>();
    const stage = (el: Element) => {
      if (staged.has(el)) return;
      const release = stageFor(el)?.add(el, entrance(el));
      if (release) staged.set(el, release);
    };
    const scan = (node: Element) => {
      if (node.matches(CANDIDATES)) stage(node);
      for (const el of node.querySelectorAll(CANDIDATES)) stage(el);
    };

    scan(root);
    const added = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element) scan(node);
      for (const [el, release] of staged)
        if (!el.isConnected) {
          release();
          staged.delete(el);
        }
    });
    added.observe(root, { childList: true, subtree: true });

    return () => {
      added.disconnect();
      for (const release of staged.values()) release();
    };
  };
}
