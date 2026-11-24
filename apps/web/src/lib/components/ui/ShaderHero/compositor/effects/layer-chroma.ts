import type { LayerEffect } from './effect';

/**
 * Red and blue pull apart away from the pointer, so the picture splits where
 * the visitor is not looking. It reads no clock: under reduced motion the
 * one still frame keeps the split around wherever the pointer was.
 */
export const layerChroma: LayerEffect = {
  id: 'chroma',
  axis: 'layer',
  label: 'Colour split',
  uniforms: ['u_scene', 'u_amount', 'u_pointer'],
  amount: 0.7,
  phoneFallback: 'chroma',
  reducedMotionFallback: 'chroma',
  glsl: `void main() {
  vec2 dir = v_uv - u_pointer;
  vec2 o = dir * 0.025 * u_amount * (0.3 + length(dir));
  fragColor = vec4(
    texture(u_scene, v_uv + o).r,
    texture(u_scene, v_uv).g,
    texture(u_scene, v_uv - o).b,
    1.0
  );
}`,
};
