import type { IntoEffect } from './motion';

/**
 * Into the film, liquid: the frame ripples and thins, opens across the
 * whole stage, and settles as the player takes over.
 */
export const intoLiquid: IntoEffect = {
  id: 'liquid',
  axis: 'reel-film',
  label: 'Liquid',
  uniforms: ['u_into', 'u_time'],
  phoneFallback: 'liquid',
  reducedMotionFallback: 'fade',
  glsl: `void reelInto(inout Motion mo, vec2 uv) {
  if (u_into <= 0.0) return;
  mo.warp += u_into * 0.1 * vec2(sin(uv.y * 7.0 + u_time * 1.7), cos(uv.x * 6.0 + u_time * 1.3));
  mo.shows *= 1.0 - 0.6 * u_into;
}`,
};
