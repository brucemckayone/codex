import type { FrameEffect } from './effect';

/**
 * The picture dims, and the org's name glows out of it in the brand colour.
 * Needs the name mask (`setNameMask`); until one is set it draws as shader
 * only.
 */
export const frameNameGlows: FrameEffect = {
  id: 'name-glows',
  axis: 'frame',
  label: 'Name glows',
  uniforms: ['u_scene', 'u_mask', 'u_brandPrimary'],
  amount: 1,
  phoneFallback: 'name-glows',
  reducedMotionFallback: 'name-glows',
  glsl: `void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  float m = texture(u_mask, v_uv).r;
  fragColor = vec4(mix(s * 0.35, min(s * 1.6 + u_brandPrimary * 0.15, vec3(1.0)), m), 1.0);
}`,
};
