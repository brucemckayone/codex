import type { LayerEffect } from './effect';

/**
 * Only the edges of the shapes survive, drawn in the brand's primary on a
 * darkened ground: a linocut of the picture. Nine reads a pixel, the second
 * dearest layer after glow. Still: no clock.
 */
export const layerInk: LayerEffect = {
  id: 'ink',
  axis: 'layer',
  label: 'Ink edges',
  uniforms: [
    'u_scene',
    'u_resolution',
    'u_amount',
    'u_bgColor',
    'u_brandPrimary',
  ],
  amount: 1,
  phoneFallback: 'ink',
  reducedMotionFallback: 'ink',
  glsl: `float lumaAt(vec2 uv) { return luma(texture(u_scene, uv).rgb); }
void main() {
  vec2 px = 1.5 / u_resolution;
  float tl = lumaAt(v_uv + px * vec2(-1, 1)), t = lumaAt(v_uv + px * vec2(0, 1)), tr = lumaAt(v_uv + px * vec2(1, 1));
  float l = lumaAt(v_uv + px * vec2(-1, 0)), r = lumaAt(v_uv + px * vec2(1, 0));
  float bl = lumaAt(v_uv + px * vec2(-1, -1)), b = lumaAt(v_uv + px * vec2(0, -1)), br = lumaAt(v_uv + px * vec2(1, -1));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float e = smoothstep(0.03, 0.18, length(vec2(gx, gy)));
  vec3 inkCol = mix(u_bgColor * 0.6, u_brandPrimary * 1.25, e);
  fragColor = vec4(mix(texture(u_scene, v_uv).rgb, inkCol, u_amount), 1.0);
}`,
};
