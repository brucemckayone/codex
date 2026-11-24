import type { PointerEffect } from './motion';

/** The pointer does nothing to the film. */
export const pointerNone: PointerEffect = {
  id: 'none',
  axis: 'reel-pointer',
  label: 'None',
  uniforms: [],
  phoneFallback: 'none',
  reducedMotionFallback: 'none',
  glsl: 'void reelPointer(inout Motion mo, vec2 uv) {}',
};
