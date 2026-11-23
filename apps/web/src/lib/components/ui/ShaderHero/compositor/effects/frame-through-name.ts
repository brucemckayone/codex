import type { FrameEffect } from './effect';

/**
 * The picture shows only through the org's name, on the brand ground. Needs
 * the name mask (`setNameMask`); until one is set it draws as shader only.
 */
export const frameThroughName: FrameEffect = {
  id: 'through-name',
  axis: 'frame',
  label: 'Through the name',
  uniforms: ['u_scene', 'u_mask', 'u_bgColor'],
  amount: 1,
  phoneFallback: 'through-name',
  reducedMotionFallback: 'through-name',
  glsl: `void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  float m = texture(u_mask, v_uv).r;
  fragColor = vec4(mix(u_bgColor * 0.9 + s * 0.06, s * 1.15, m), 1.0);
}`,
};
