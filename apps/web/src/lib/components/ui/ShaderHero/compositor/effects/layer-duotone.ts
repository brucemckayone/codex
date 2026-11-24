import type { LayerEffect } from './effect';

/**
 * The brand's three colours by light: shadows to its ground, light to its
 * primary, the brightest to its accent. Still: no clock.
 */
export const layerDuotone: LayerEffect = {
  id: 'duotone',
  axis: 'layer',
  label: 'Brand duotone',
  uniforms: [
    'u_scene',
    'u_amount',
    'u_bgColor',
    'u_brandPrimary',
    'u_brandAccent',
  ],
  amount: 1,
  phoneFallback: 'duotone',
  reducedMotionFallback: 'duotone',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float y = smoothstep(0.02, 0.6, luma(c));
  vec3 d = mix(u_bgColor, mix(u_brandPrimary, u_brandAccent, smoothstep(0.65, 1.0, y)), y);
  fragColor = vec4(mix(c, d, u_amount), 1.0);
}`,
};
