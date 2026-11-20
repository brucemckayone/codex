import type { LayerEffect } from './effect';

/**
 * Moving grain at 24 frames a second, strongest in the mid-tones, like film
 * stock. Not a flash: each pixel moves by a few per cent around its own
 * value, so the picture's brightness holds still (WCAG 2.3.1 counts an area
 * changing, not grain). Under reduced motion the one still frame keeps it.
 */
export const layerGrain: LayerEffect = {
  id: 'grain',
  axis: 'layer',
  label: 'Film grain',
  uniforms: ['u_scene', 'u_time', 'u_amount'],
  amount: 0.6,
  phoneFallback: 'grain',
  reducedMotionFallback: 'grain',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float t = floor(u_time * 24.0);
  float n = hash12(gl_FragCoord.xy + t * 37.0) - 0.5;
  float w = 1.0 - abs(luma(c) - 0.4) * 1.3;
  fragColor = vec4(c + n * 0.24 * u_amount * w, 1.0);
}`,
};
