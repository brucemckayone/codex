import type { LayerEffect } from './effect';

/**
 * Through the shader, from the Showreel mock's surfaces: the brand shader's
 * colour, lit by the picture's light, so a film plays in the shader's hues.
 *
 * SURFACE-ONLY (`SURFACE_ONLY_LAYER_IDS`): it reads the picture it treats as
 * `u_scene` and the brand shader's own picture, without the film, as
 * `u_second`, which only the Showreel's surface slot binds. A brand's stack
 * never runs it. Where the two pictures are the same (outside the film) it only
 * lifts the contrast a little. Still: no clock.
 */
export const layerShaderLight: LayerEffect = {
  id: 'shader-light',
  axis: 'layer',
  label: 'Through the shader',
  uniforms: ['u_scene', 'u_second', 'u_amount'],
  amount: 1,
  phoneFallback: 'shader-light',
  reducedMotionFallback: 'shader-light',
  glsl: `vec3 setLum(vec3 c, float l) {
  c += l - luma(c);
  float L = luma(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = L + (c - L) * L / (L - n);
  if (x > 1.0) c = L + (c - L) * (1.0 - L) / (x - L);
  return c;
}
void main() {
  vec3 piece = texture(u_scene, v_uv).rgb;
  vec3 shader = texture(u_second, v_uv).rgb;
  float light = clamp((luma(piece) - 0.5) * 1.15 + 0.5, 0.0, 1.0) * 0.92;
  fragColor = vec4(mix(piece, setLum(shader, light), u_amount), 1.0);
}`,
};
