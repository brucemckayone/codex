import type { BlendEffect } from './effect';

/** The second preset laid over the base at its amount. */
export const blendMix: BlendEffect = {
  id: 'mix',
  axis: 'blend',
  label: 'Mix',
  uniforms: ['u_scene', 'u_second', 'u_amount'],
  amount: 0.5,
  phoneFallback: 'mix',
  reducedMotionFallback: 'mix',
  glsl: `void main() {
  vec3 a = texture(u_scene, v_uv).rgb, b = texture(u_second, v_uv).rgb;
  fragColor = vec4(mix(a, b, u_amount), 1.0);
}`,
};
