import type { MediaEffect } from './effect';

/**
 * Duotone in the brand, over the footage (WP-5b; the 5b board's, which the
 * owner picked on 2026-11-21): the piece's light, a touch more contrasted,
 * mapped from the brand's dark through its primary to a pale of the primary.
 * Never literal black or white. The dark is the brand's ground when that is
 * dark; a light brand's ground would turn the picture's light over, so its
 * dark is a deep primary instead (the primary squared, as `layer-monotone`).
 * Still: no clock.
 */
export const surfaceDuotone: MediaEffect = {
  id: 'surface-duotone',
  axis: 'media',
  label: 'Duotone in the brand',
  uniforms: ['u_scene', 'u_amount', 'u_bgColor', 'u_brandPrimary'],
  amount: 0.9,
  phoneFallback: 'surface-duotone',
  reducedMotionFallback: 'surface-duotone',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float g = clamp((luma(c) - 0.5) * 1.12 + 0.5, 0.0, 1.0);
  vec3 deep = mix(u_brandPrimary * u_brandPrimary * 0.57, u_bgColor, step(luma(u_bgColor), 0.18));
  vec3 pale = mix(u_brandPrimary, vec3(1.0), 0.78);
  vec3 d = g < 0.5
    ? mix(deep, u_brandPrimary, g * 2.0)
    : mix(u_brandPrimary, pale, g * 2.0 - 1.0);
  fragColor = vec4(mix(c, d, u_amount), 1.0);
}`,
};
