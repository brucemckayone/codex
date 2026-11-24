import type { TransEffect } from './motion';

/**
 * Between pieces, a plain fade through the brand's picture. No setting
 * names it: it is where every moving cut falls under reduced motion, with
 * the reveal clock's short timing.
 */
export const transFade: TransEffect = {
  id: 'fade',
  axis: 'reel-trans',
  label: 'Fade',
  uniforms: ['u_reveal'],
  phoneFallback: 'fade',
  reducedMotionFallback: 'fade',
  glsl: `void reelTrans(inout Motion mo, vec2 uv) {
  mo.shows *= u_reveal;
}`,
};
