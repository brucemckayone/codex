import type { PointerEffect } from './motion';

/**
 * The pointer, glitch: the film tears and splits around the pointer. It
 * flashes, so it changes only with the governed clock, and under reduced
 * motion it goes.
 */
export const pointerGlitch: PointerEffect = {
  id: 'glitch',
  axis: 'reel-pointer',
  label: 'Glitch',
  uniforms: ['u_pointerOn', 'u_pointer'],
  phoneFallback: 'glitch',
  reducedMotionFallback: 'none',
  flashes: true,
  glsl: `void reelPointer(inout Motion mo, vec2 uv) {
  if (u_pointerOn < 0.5) return;
  vec2 d = (uv - u_pointer) * aspectScale();
  mo.glitch += exp(-dot(d, d) / 0.02);
}`,
};
