/**
 * The values of the motion attribute API (03-expressive-contract §6) and of
 * the hooks a Style sets. `styles/motion.css` gives each value its meaning,
 * and `motion.test.ts` holds the two to each other: a value listed here with
 * no rule there fails.
 */

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
