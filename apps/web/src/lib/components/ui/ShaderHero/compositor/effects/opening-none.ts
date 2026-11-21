import type { OpeningEffect } from './motion';

/** No opening: the reel starts on its first piece. */
export const openingNone: OpeningEffect = {
  id: 'none',
  axis: 'reel-opening',
  label: 'None',
  uniforms: [],
  phoneFallback: 'none',
  reducedMotionFallback: 'none',
  glsl: 'void reelOpening(inout Motion mo, vec2 uv) {}',
};
