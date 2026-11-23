import type { TransEffect } from './motion';

/**
 * Between pieces, liquid: the piece melts into the brand's picture in slow
 * waves and the next one sets out of it. Its light changes smoothly, never
 * in steps, so it reads the real clock.
 */
export const transLiquid: TransEffect = {
  id: 'liquid',
  axis: 'reel-trans',
  label: 'Liquid',
  uniforms: ['u_reveal', 'u_time'],
  phoneFallback: 'liquid',
  reducedMotionFallback: 'fade',
  glsl: `void reelTrans(inout Motion mo, vec2 uv) {
  if (u_reveal >= 1.0) return;
  float k = 1.0 - u_reveal;
  mo.warp += k * 0.07 * vec2(sin(uv.y * 9.0 + u_time * 1.3), cos(uv.x * 7.0 + u_time * 1.1));
  mo.shows *= smoothstep(0.0, 1.0, u_reveal);
}`,
};
