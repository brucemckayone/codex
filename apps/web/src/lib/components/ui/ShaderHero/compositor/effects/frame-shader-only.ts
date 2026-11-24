import type { FrameEffect } from './effect';

/** The picture as it is. Every frame falls back to this one. */
export const frameShaderOnly: FrameEffect = {
  id: 'shader-only',
  axis: 'frame',
  label: 'Shader only',
  uniforms: ['u_scene'],
  amount: 1,
  phoneFallback: 'shader-only',
  reducedMotionFallback: 'shader-only',
  glsl: `void main() {
  fragColor = vec4(texture(u_scene, v_uv).rgb, 1.0);
}`,
};
