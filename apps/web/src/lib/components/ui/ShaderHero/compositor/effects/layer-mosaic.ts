import type { LayerEffect } from './effect';

/**
 * Big soft pixels: a censored, distant or loading look. The amount is the
 * block size, from one pixel (the input unchanged, at any size) to 32 px at
 * 900 px tall and more on a taller canvas. Still: no clock.
 */
export const layerMosaic: LayerEffect = {
  id: 'mosaic',
  axis: 'layer',
  label: 'Mosaic',
  uniforms: ['u_scene', 'u_resolution', 'u_amount'],
  amount: 0.4,
  phoneFallback: 'mosaic',
  reducedMotionFallback: 'mosaic',
  glsl: `void main() {
  float b = mix(1.0, 32.0 * max(1.0, u_resolution.y / 900.0), u_amount);
  vec2 cell = (floor(gl_FragCoord.xy / b) + 0.5) * b / u_resolution;
  fragColor = vec4(texture(u_scene, cell).rgb, 1.0);
}`,
};
