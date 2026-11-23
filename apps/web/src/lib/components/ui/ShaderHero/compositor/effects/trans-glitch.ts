import type { TransEffect } from './motion';

/**
 * Between pieces, the glitch: the piece breaks into blocks that drop out to
 * the brand's picture, torn into slices with its colours split, and the next
 * one blocks back in. It flashes, so its blocks and slices change only with
 * the governed clock.
 */
export const transGlitch: TransEffect = {
  id: 'glitch',
  axis: 'reel-trans',
  label: 'Glitch',
  uniforms: ['u_reveal', 'u_flashTime'],
  phoneFallback: 'glitch',
  reducedMotionFallback: 'fade',
  flashes: true,
  glsl: `void reelTrans(inout Motion mo, vec2 uv) {
  if (u_reveal >= 1.0) return;
  mo.glitch += (1.0 - u_reveal) * 1.6;
  // Clamped: a GPU's fract can land a hair below 0, which would show a
  // block at reveal 0 (seen on Apple Metal).
  float block = clamp(hash12(floor(uv * vec2(36.0, 20.0)) + floor(u_flashTime * 10.0)), 0.0, 0.999);
  mo.shows *= step(block + 1e-4, u_reveal * 1.02);
}`,
};
