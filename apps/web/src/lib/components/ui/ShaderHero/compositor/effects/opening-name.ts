import type { OpeningEffect } from './motion';

/**
 * The opening, through the name: the film fades in inside the letters of the
 * org's name and, on the Corner and Wide layouts, the view then dives into the
 * name's thickest stroke to the full stage. The frame draws it through the
 * name's veil, the timeline (`name-motion.ts`) drives the name's uniforms, so
 * the hook adds nothing of its own. Under reduced motion there is no opening.
 */
export const openingName: OpeningEffect = {
  id: 'name',
  axis: 'reel-opening',
  label: 'Through the name',
  uniforms: [],
  phoneFallback: 'name',
  reducedMotionFallback: 'none',
  throughName: true,
  glsl: 'void reelOpening(inout Motion mo, vec2 uv) {}',
};
