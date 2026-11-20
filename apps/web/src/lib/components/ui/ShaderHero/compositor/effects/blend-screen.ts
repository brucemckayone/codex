import type { BlendEffect } from './effect';

/** The second preset adds its light to the base, as two projectors would. */
export const blendScreen: BlendEffect = {
  id: 'screen',
  axis: 'blend',
  label: 'Screen',
  uniforms: ['u_scene', 'u_second', 'u_amount'],
  amount: 0.6,
  phoneFallback: 'screen',
  reducedMotionFallback: 'screen',
  glsl: `void main() {
  vec3 a = texture(u_scene, v_uv).rgb, b = texture(u_second, v_uv).rgb;
  fragColor = vec4(1.0 - (1.0 - a) * (1.0 - b * u_amount), 1.0);
}`,
};
