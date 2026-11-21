import type { LayerEffect } from './effect';

/**
 * Bands of the picture slip sideways in short bursts, with a colour split and
 * the odd blocky tear. A burst changes the light of what it moves, so it
 * FLASHES: the governor steps its clock to at most 3 values a second, and its
 * beat is 2 a second within that (WCAG 2.3.1). Under reduced motion it is
 * dropped: the one still frame would freeze a tear, which reads as a fault.
 * The tears thin out with the amount too (none at 0, the top 12% of bands at
 * 1), so `glitch:0` draws its input unchanged, as every layer does at 0.
 */
export const layerGlitch: LayerEffect = {
  id: 'glitch',
  axis: 'layer',
  label: 'Signal glitch',
  uniforms: ['u_scene', 'u_resolution', 'u_time', 'u_amount'],
  amount: 0.8,
  phoneFallback: 'glitch',
  reducedMotionFallback: null,
  flashes: true,
  glsl: `void main() {
  float beat = floor(u_time * 2.0);
  float live = step(0.55, hash12(vec2(beat, 1.7)));
  float bands = mix(8.0, 28.0, hash12(vec2(beat, 3.1)));
  float band = floor(v_uv.y * bands);
  float r = hash12(vec2(band, beat));
  float shift = (r - 0.5) * 0.14 * u_amount * live * step(0.6, r);
  vec2 uv = vec2(fract(v_uv.x + shift), v_uv.y);
  float ca = 0.007 * u_amount * live;
  vec3 c = vec3(
    texture(u_scene, uv + vec2(ca, 0.0)).r,
    texture(u_scene, uv).g,
    texture(u_scene, uv - vec2(ca, 0.0)).b
  );
  if (live > 0.5 && r > mix(1.01, 0.88, u_amount)) {
    vec2 b = (floor(v_uv * u_resolution / 18.0) + 0.5) * 18.0 / u_resolution;
    c = texture(u_scene, b).rgb;
  }
  fragColor = vec4(c, 1.0);
}`,
};
