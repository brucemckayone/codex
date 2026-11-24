import type { IntoEffect } from './motion';

/**
 * Into the film, a short fade through the brand's picture to the film on
 * the whole stage. No setting names it: it is where the others fall under
 * reduced motion (the letter dive's own: no zoom).
 */
export const intoFade: IntoEffect = {
  id: 'fade',
  axis: 'reel-film',
  label: 'Fade',
  uniforms: ['u_into'],
  phoneFallback: 'fade',
  reducedMotionFallback: 'fade',
  glsl: `void reelInto(inout Motion mo, vec2 uv) {
  if (u_into <= 0.0) return;
  mo.shows *= 1.0 - u_into;
}`,
};
