import type { BlendEffect } from './effect';

/** Where the two presets differ, the picture lights up. */
export const blendDifference: BlendEffect = {
  id: 'difference',
  axis: 'blend',
  label: 'Difference',
  uniforms: ['u_scene', 'u_second', 'u_amount'],
  amount: 0.6,
  phoneFallback: 'difference',
  reducedMotionFallback: 'difference',
  glsl: `void main() {
  vec3 a = texture(u_scene, v_uv).rgb, b = texture(u_second, v_uv).rgb;
  fragColor = vec4(mix(a, abs(a - b), u_amount), 1.0);
}`,
};
