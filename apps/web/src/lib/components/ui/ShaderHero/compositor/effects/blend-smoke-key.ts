import type { BlendEffect } from './effect';

/**
 * The second preset shows where the base is dark: the base's smoke keys it
 * in. The thresholds are the lab's, as the owner judged them (WP-1b).
 */
export const blendSmokeKey: BlendEffect = {
  id: 'smoke-key',
  axis: 'blend',
  label: 'Smoke key',
  uniforms: ['u_scene', 'u_second', 'u_amount'],
  amount: 0.6,
  phoneFallback: 'smoke-key',
  reducedMotionFallback: 'smoke-key',
  glsl: `void main() {
  vec3 a = texture(u_scene, v_uv).rgb, b = texture(u_second, v_uv).rgb;
  float k = smoothstep(0.06, 0.28, luma(a));
  fragColor = vec4(mix(b, a, mix(1.0, k, u_amount)), 1.0);
}`,
};
