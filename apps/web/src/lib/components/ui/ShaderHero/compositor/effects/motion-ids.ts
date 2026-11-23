/**
 * The Showreel's motion effects, per axis. Kept apart from the GLSL, as
 * `ids.ts` is, so the hero's settings can name them without pulling the shaders
 * into the page's chunk.
 *
 * The axes are the Showreel's own settings (`hero-config.ts`): between
 * pieces, the pointer, the opening, and the way into the film. A setting's
 * value is one of these ids. `fade` is no setting: it is where the moving
 * cuts fall under reduced motion.
 */

/** Between pieces: how one piece gives way, through the brand's picture, to the next. */
export const TRANS_IDS = [
  'burn',
  'liquid',
  'glitch',
  'light-leak',
  'fade',
] as const;
export type TransId = (typeof TRANS_IDS)[number];

/** What the visitor's pointer (or a sideways swipe) does to the film. */
export const POINTER_IDS = ['liquid', 'smoke', 'glitch', 'none'] as const;
export type PointerId = (typeof POINTER_IDS)[number];

/** How the reel first appears. */
export const OPENING_IDS = ['name', 'none'] as const;
export type OpeningId = (typeof OPENING_IDS)[number];

/** How the hero gives way to the full film or the theatre. */
export const INTO_IDS = ['name', 'smoke', 'liquid', 'fade'] as const;
export type IntoId = (typeof INTO_IDS)[number];

export type MotionAxis =
  | 'reel-trans'
  | 'reel-pointer'
  | 'reel-opening'
  | 'reel-film';

/** One effect per axis: what the Showreel's film frame runs. */
export interface MotionChoice {
  readonly trans: TransId;
  readonly pointer: PointerId;
  readonly opening: OpeningId;
  readonly into: IntoId;
}
