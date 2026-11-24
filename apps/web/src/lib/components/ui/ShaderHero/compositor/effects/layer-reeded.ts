import type { LayerEffect } from './effect';

/**
 * Reeded glass, from the Showreel mock's surfaces: 46 vertical flutes, each
 * bending the picture sideways and catching a ridge of light. Still: no
 * clock.
 */
export const layerReeded: LayerEffect = {
  id: 'reeded',
  axis: 'layer',
  label: 'Reeded glass',
  uniforms: ['u_scene', 'u_amount'],
  amount: 1,
  phoneFallback: 'reeded',
  reducedMotionFallback: 'reeded',
  glsl: `void main() {
  float flute = fract(v_uv.x * 46.0);
  vec2 uv = v_uv + vec2((flute - 0.5) * 0.024 * u_amount, 0.0);
  vec3 c = texture(u_scene, uv).rgb;
  c += (0.07 * (1.0 - abs(flute - 0.5) * 2.0) - 0.035) * u_amount;
  fragColor = vec4(c, 1.0);
}`,
};
