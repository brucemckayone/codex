/**
 * The values of the motion attribute API (03-expressive-contract §6) and of
 * the hooks a Style sets. `styles/motion.css` gives each value its meaning,
 * and `motion.test.ts` holds the two to each other: a value listed here with
 * no rule there fails.
 */

/**
 * Where motion stops, beside reduced motion and print (03 X62). The CSS
 * spells the same lists inside `.lp:not(…)`, and `motion.test.ts` holds each
 * rule to one of them.
 *
 * NOTHING_MOVES: a still page (thumbnails, galleries, the editing canvas) or
 * the motion dial at `still`, which is the page reduced motion sees. An
 * entrance, and what answers a hover or a click, stops here.
 *
 * NOTHING_FOLLOWS: those, and the dial at any step. What follows the scroll
 * or moves on its own (a route drawn down the page, parallax, a drift, the
 * marquee, the org's moving background) stops at `gentle` too.
 */
export const NOTHING_MOVES = "[data-lp-still], [data-lp-motion='still']";
export const NOTHING_FOLLOWS = '[data-lp-still], [data-lp-motion]';

/**
 * Whether `el` is where motion stops: on a page `NOTHING_MOVES` covers, or
 * under reduced motion. The page is read first, so a still page never asks
 * the media query.
 */
export function holdsStill(el: Element): boolean {
  return (
    el.closest(NOTHING_MOVES) !== null ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** `data-lp-reveal` and `--lp-media-reveal`: how an element enters. */
export const REVEALS = ['rise', 'fade', 'wipe', 'scale'] as const;

/** `data-lp-build` and `--lp-build-<size>`: how a heading builds, whole. */
export const BUILDS = ['rise', 'wipe', 'track'] as const;

/** `data-lp-parallax` and `--lp-media-parallax`: 1 is subtle. */
export const DEPTHS = ['1', '2'] as const;

/** The heading sizes a Style can build (`Heading`'s `size`). */
export const BUILD_SIZES = ['display', 'heading', 'title'] as const;

export type Reveal = (typeof REVEALS)[number];
export type Build = (typeof BUILDS)[number];
