import type { BlendEffect } from './effect';

/** The second preset tints and darkens the base, like a gel over a light. */
export const blendMultiply: BlendEffect = {
  id: 'multiply',
  axis: 'blend',
  label: 'Multiply',
  uniforms: ['u_scene', 'u_second', 'u_amount'],
  amount: 0.6,
  phoneFallback: 'multiply',
  reducedMotionFallback: 'multiply',
  glsl: `void main() {
  vec3 a = texture(u_scene, v_uv).rgb, b = texture(u_second, v_uv).rgb;
  fragColor = vec4(a * mix(vec3(1.0), b * 1.7, u_amount), 1.0);
}`,
};
