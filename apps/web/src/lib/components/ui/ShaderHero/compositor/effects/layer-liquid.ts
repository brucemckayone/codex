import type { LayerEffect } from './effect';

/**
 * The picture swirls and ripples around the pointer like a finger in water,
 * adding nothing on top. It moves pixels, not light, so it does not flash.
 * Under reduced motion it is dropped: the one still frame would hold a swirl at
 * wherever the pointer last was. It reads the pointer's position only, not its
 * presence, so it does not rest when the pointer leaves.
 */
export const layerLiquid: LayerEffect = {
  id: 'liquid',
  axis: 'layer',
  label: 'Liquid pointer',
  uniforms: ['u_scene', 'u_resolution', 'u_time', 'u_amount', 'u_pointer'],
  amount: 0.8,
  phoneFallback: 'liquid',
  reducedMotionFallback: null,
  glsl: `void main() {
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 d = (v_uv - u_pointer) * asp;
  float r = length(d);
  float f = exp(-r * r * 16.0) * u_amount;
  float a = f * 2.0 * sin(u_time * 0.6);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 uv = u_pointer + (R * d) / asp;
  uv += d / asp * f * 0.12 * sin(r * 34.0 - u_time * 3.0);
  fragColor = vec4(texture(u_scene, uv).rgb, 1.0);
}`,
};
