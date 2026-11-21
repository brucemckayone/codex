import type { TransEffect } from './motion';

/**
 * Between pieces, the light-leak cut (a WP-1b pick): three flares of the
 * brand's light, primary deepening to accent, flood in from one edge (a new
 * edge each cut) and the piece changes under them at their brightest.
 *
 * One flash per cut: its light rises once and falls once, with the reveal,
 * and the reveal clock never turns a cut round, so a cut takes at least its
 * full length (WCAG 2.3.1).
 */
export const transLightLeak: TransEffect = {
  id: 'light-leak',
  axis: 'reel-trans',
  label: 'Light leak',
  uniforms: ['u_reveal', 'u_cut', 'u_brandPrimary', 'u_brandAccent'],
  phoneFallback: 'light-leak',
  reducedMotionFallback: 'fade',
  flashes: true,
  glsl: `// The three flares at strength e: how far each reaches in from the edge.
vec3 leakFlares(vec2 uv, float e) {
  float edge = mod(u_cut, 4.0);
  float depth = edge < 0.5 ? uv.x : edge < 1.5 ? 1.0 - uv.x : edge < 2.5 ? 1.0 - uv.y : uv.y;
  float along = edge < 1.5 ? uv.y : uv.x;
  float light = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float at = 0.15 + 0.35 * fi + 0.2 * (hash12(vec2(u_cut, fi)) - 0.5);
    float reach = (0.16 + 0.14 * hash12(vec2(fi, u_cut + 7.0))) * (0.5 + 1.5 * e);
    vec2 d = vec2((along - at) / 0.22, depth / reach);
    light += exp(-dot(d, d));
  }
  vec3 tint = mix(u_brandPrimary, u_brandAccent, smoothstep(0.0, 0.5, depth));
  return tint * min(light, 1.2) * e;
}
void reelTrans(inout Motion mo, vec2 uv) {
  if (u_reveal >= 1.0) return;
  mo.shows *= smoothstep(0.0, 0.35, u_reveal);
  mo.glow += leakFlares(uv, 1.0 - u_reveal);
}`,
};
