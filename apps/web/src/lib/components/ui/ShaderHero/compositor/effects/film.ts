/**
 * What the Showreel's film frames share (Codex-1yd58.6): where the stage is,
 * and the film as it fills it. GLSL text placed after a frame's generated
 * uniforms, so every frame using it must read the uniforms listed here.
 */
import type { UniformName } from './uniforms';

export const FILM_UNIFORMS: readonly UniformName[] = [
  'u_scene',
  'u_media',
  'u_resolution',
  'u_rect',
  'u_fade',
  'u_mediaSize',
  'u_hasMedia',
];

export const FILM_GLSL = `// This pixel's place in the stage: 0-1 inside it, origin bottom left.
vec2 stageLocal() {
  return (v_uv * u_resolution - u_rect.xy) / max(u_rect.zw, vec2(1.0));
}
// 1 inside the stage, 0 outside it.
float inStage(vec2 local) {
  return step(0.0, local.x) * step(local.x, 1.0) * step(0.0, local.y) * step(local.y, 1.0);
}
// The film, covering the stage (cropped, never stretched).
vec3 film(vec2 local) {
  return texture(u_media, coverUv(clamp(local, 0.0, 1.0), u_rect.zw, u_mediaSize)).rgb;
}
// How much of the film shows here: once uploaded, and fading as the hero leaves.
float filmShows(vec2 local) {
  return inStage(local) * u_hasMedia * u_fade;
}`;

/** What the smoke light reads, beside the film's own uniforms. */
export const SMOKE_UNIFORMS: readonly UniformName[] = [
  'u_bgColor',
  'u_brandPrimary',
];

/**
 * The brand picture's smoke under this pixel, blurred over 9 taps: 0 its
 * ground, 1 its primary (more for a brighter colour, up to 1.3). The v4
 * mock's smoke light, measured against the brand's own two colours rather
 * than a frame's darkest and brightest, which no pass knows.
 */
export const SMOKE_GLSL = `float smokeLight(vec2 uv) {
  vec2 texel = vec2(0.0049, 0.0078);
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      sum += luma(texture(u_scene, uv + vec2(float(i), float(j)) * texel).rgb);
  float ground = luma(u_bgColor);
  float range = max(abs(luma(u_brandPrimary) - ground), 0.02);
  return clamp(abs(sum / 9.0 - ground) / range, 0.0, 1.3);
}`;
