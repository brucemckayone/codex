import type { LayerEffect } from './effect';

/**
 * Ordered dither in the brand's four colours on coarse pixels: a print or
 * screen look that stays on brand. Still: no clock.
 */
export const layerDither: LayerEffect = {
  id: 'dither',
  axis: 'layer',
  label: 'Brand dither',
  uniforms: [
    'u_scene',
    'u_resolution',
    'u_amount',
    'u_bgColor',
    'u_brandSecondary',
    'u_brandPrimary',
    'u_brandAccent',
  ],
  amount: 1,
  phoneFallback: 'dither',
  reducedMotionFallback: 'dither',
  glsl: `float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[x + y * 4] + 0.5) / 16.0;
}
void main() {
  float px = max(2.0, floor(u_resolution.y / 300.0));
  vec2 cell = floor(gl_FragCoord.xy / px);
  vec3 c = texture(u_scene, (cell * px + px * 0.5) / u_resolution).rgb;
  float y = clamp(luma(c) * 1.6, 0.0, 1.0);
  float q = clamp(floor(y * 3.0 + bayer4(cell)), 0.0, 3.0);
  vec3 pal = q < 0.5 ? u_bgColor : q < 1.5 ? u_brandSecondary : q < 2.5 ? u_brandPrimary : u_brandAccent;
  fragColor = vec4(mix(texture(u_scene, v_uv).rgb, pal, u_amount), 1.0);
}`,
};
