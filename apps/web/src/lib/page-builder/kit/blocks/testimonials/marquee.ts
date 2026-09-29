/**
 * How many copies of the quotes the moving strip needs (03 §7).
 *
 * Every set of cards slides one set's width and starts again, so behind the
 * last card there must always be another copy until the widest window is
 * covered: `copies × set width ≥ window`. Worked out here, from the count
 * alone, so the server's HTML is already complete and nothing grows after
 * the page loads. The numbers are the CSS's own (`TestimonialsMarquee`): a
 * card is at most 22rem with at least a 1.5rem gap, and no window is wider
 * than 240rem (a 4K screen at 1×).
 */

/** Fewer quotes than this sit still: one or two on a moving strip repeat in plain sight. */
export const MARQUEE_MIN = 3;

const WIDEST_WINDOW = 240;
const NARROWEST_PITCH = 22 + 1.5;

export function marqueeCopies(count: number): number {
  if (count < MARQUEE_MIN) return 0;
  return Math.ceil(WIDEST_WINDOW / (count * NARROWEST_PITCH));
}
