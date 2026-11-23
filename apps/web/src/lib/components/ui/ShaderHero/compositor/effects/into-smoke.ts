import type { IntoEffect } from './motion';

/**
 * Into the film, smoke: the smoke burn takes the reel back to the brand's
 * picture, then burns the film in across the whole stage, and the player
 * takes over.
 */
export const intoSmoke: IntoEffect = {
  id: 'smoke',
  axis: 'reel-film',
  label: 'Smoke',
  uniforms: ['u_into'],
  phoneFallback: 'smoke',
  reducedMotionFallback: 'fade',
  glsl: `void reelInto(inout Motion mo, vec2 uv) {
  if (u_into <= 0.0) return;
  mo.shows *= burnShows(smokeLight(uv, 1.0), 1.0 - u_into);
}`,
};
