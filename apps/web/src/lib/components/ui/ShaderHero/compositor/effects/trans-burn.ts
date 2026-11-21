import type { TransEffect } from './motion';

/**
 * Between pieces, the smoke burn (the v4 mock's; the owner's "I LIKE THE
 * TRANSITION"): the brand's smoke takes the piece back, the darkest smoke
 * first, then burns the next one in, the brightest smoke first.
 */
export const transBurn: TransEffect = {
  id: 'burn',
  axis: 'reel-trans',
  label: 'Smoke burn',
  uniforms: ['u_reveal'],
  phoneFallback: 'burn',
  reducedMotionFallback: 'fade',
  glsl: `void reelTrans(inout Motion mo, vec2 uv) {
  if (u_reveal >= 1.0) return;
  mo.shows *= burnShows(smokeLight(uv, 1.0), u_reveal);
}`,
};
