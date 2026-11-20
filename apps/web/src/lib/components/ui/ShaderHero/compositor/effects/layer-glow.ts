import type { LayerEffect } from './effect';

/**
 * The bright parts bloom softly into the dark: one pass, twelve taps on a
 * golden-angle spiral. Thirteen reads a pixel, the dearest layer (measured on
 * the phone in WP-11). Still: no clock.
 */
export const layerGlow: LayerEffect = {
  id: 'glow',
  axis: 'layer',
  label: 'Glow',
  uniforms: ['u_scene', 'u_resolution', 'u_amount'],
  amount: 0.7,
  phoneFallback: 'glow',
  reducedMotionFallback: 'glow',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  vec3 acc = vec3(0.0);
  vec2 asp = vec2(u_resolution.y / u_resolution.x, 1.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996;
    float rr = sqrt(float(i) + 0.5) / sqrt(12.0) * 0.04;
    acc += max(texture(u_scene, v_uv + vec2(cos(a), sin(a)) * rr * asp).rgb - 0.22, 0.0);
  }
  fragColor = vec4(c + acc / 12.0 * 2.4 * u_amount, 1.0);
}`,
};
