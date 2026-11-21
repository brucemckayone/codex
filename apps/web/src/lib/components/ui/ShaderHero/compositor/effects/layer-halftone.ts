import type { LayerEffect } from './effect';

/**
 * A 45° dot screen in the brand's primary on its ground: the picture as a
 * printed poster, or the Showreel's "halftone in the brand red" over a film.
 * Each dot's size is the light of the cell under it. Still: it reads no
 * clock, so reduced motion keeps it as it is.
 */
export const layerHalftone: LayerEffect = {
  id: 'halftone',
  axis: 'layer',
  label: 'Halftone print',
  uniforms: [
    'u_scene',
    'u_resolution',
    'u_amount',
    'u_brandPrimary',
    'u_bgColor',
  ],
  amount: 1,
  phoneFallback: 'halftone',
  reducedMotionFallback: 'halftone',
  glsl: `void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  float cell = 9.0 * max(1.0, u_resolution.y / 900.0);
  float a = 0.785398;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * gl_FragCoord.xy / cell;
  vec2 g = fract(p) - 0.5;
  vec2 centre = (transpose(R) * ((floor(p) + 0.5) * cell)) / u_resolution;
  vec3 s = texture(u_scene, centre).rgb;
  float r = sqrt(clamp(luma(s) * 1.8, 0.0, 1.0)) * 0.6;
  float d = length(g);
  float aa = fwidth(d) + 0.01;
  float ink = 1.0 - smoothstep(r - aa, r + aa, d);
  vec3 dotCol = mix(u_brandPrimary * 1.1, s * 1.5, 0.35);
  fragColor = vec4(mix(c, mix(u_bgColor * 0.7, dotCol, ink), u_amount), 1.0);
}`,
};
