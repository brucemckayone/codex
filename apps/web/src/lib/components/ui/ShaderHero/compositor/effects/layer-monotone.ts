import type { LayerEffect } from './effect';

/**
 * One brand colour by light, from the Showreel mock's "brand red": the
 * picture's light, a touch more contrasted, washed from the brand's primary
 * to a deep primary across the frame. The deep end is the primary squared
 * (keeps the hue, drops the light), which for Of Blood & Bones' red lands on
 * the mock's own deep red. Still: no clock.
 */
export const layerMonotone: LayerEffect = {
  id: 'monotone',
  axis: 'layer',
  label: 'Brand monotone',
  uniforms: ['u_scene', 'u_amount', 'u_brandPrimary'],
  amount: 1,
  phoneFallback: 'monotone',
  reducedMotionFallback: 'monotone',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float g = clamp((luma(c) - 0.5) * 1.12 + 0.5, 0.0, 1.0) * 0.86;
  vec3 deep = u_brandPrimary * u_brandPrimary * 0.57;
  float across = clamp(0.5 + dot(v_uv - 0.5, vec2(0.34, 0.94)), 0.0, 1.0);
  vec3 tone = g * mix(u_brandPrimary, deep, across);
  fragColor = vec4(mix(c, tone, u_amount), 1.0);
}`,
};
