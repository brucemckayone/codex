/**
 * Motion choices shared by the compositor, ShaderHero and Showreel tests.
 */
import type { MotionChoice } from '../compositor/effects/motion-ids';

/** Nothing moves: a film frame with no motion chosen. */
export const STILL_MOTION: MotionChoice = {
  trans: 'fade',
  pointer: 'none',
  opening: 'none',
  into: 'fade',
};
