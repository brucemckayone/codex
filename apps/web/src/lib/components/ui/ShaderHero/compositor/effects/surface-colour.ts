import type { MediaEffect } from './effect';

/**
 * Your colour, over the footage: the piece keeps its light, in the brand's
 * primary's hue (the "colour" blend), so a film of any colours plays in the
 * org's own. The brand's own primary (`u_tint`), never the shader's custom
 * palette. Still: no clock.
 *
 * `setLum` is the W3C compositing spec's, as `layer-shader-light` writes it.
 */
export const surfaceColour: MediaEffect = {
  id: 'surface-colour',
  axis: 'media',
  label: 'Your colour',
  uniforms: ['u_scene', 'u_amount', 'u_tint'],
  amount: 0.65,
  phoneFallback: 'surface-colour',
  reducedMotionFallback: 'surface-colour',
  glsl: `vec3 setLum(vec3 c, float l) {
  c += l - luma(c);
  float L = luma(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = L + (c - L) * L / (L - n);
  if (x > 1.0) c = L + (c - L) * (1.0 - L) / (x - L);
  return c;
}
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  fragColor = vec4(mix(c, setLum(u_tint, luma(c)), u_amount), 1.0);
}`,
};
