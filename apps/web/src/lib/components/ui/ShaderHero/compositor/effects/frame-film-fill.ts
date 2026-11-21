import type { FrameEffect } from './effect';
import { FILM_GLSL, FILM_UNIFORMS, SMOKE_GLSL, SMOKE_UNIFORMS } from './film';

/**
 * The Showreel's Corner and Wide layouts (Codex-1yd58.6): the film fills its
 * stage over the brand's picture, which shows outside the stage. With a band
 * (`stage.ts` `FilmBand`) the film gives way to the picture: at its foot
 * ('under' through the smoke, 'fade' evenly), or all round ('edges').
 */
export const frameFilmFill: FrameEffect = {
  id: 'film-fill',
  axis: 'frame',
  label: 'The film fills the stage',
  uniforms: [...FILM_UNIFORMS, ...SMOKE_UNIFORMS, 'u_band', 'u_ramp'],
  amount: 1,
  phoneFallback: 'film-fill',
  reducedMotionFallback: 'film-fill',
  glsl: `${FILM_GLSL}
${SMOKE_GLSL}
// How much of the film the band lets through here: 1 with none.
float bandShows(vec2 local) {
  if (u_band < 0.5) return 1.0;
  float ramp = smoothstep(u_ramp.x, u_ramp.y, 1.0 - local.y);
  // under: the smoke takes the foot, the brightest smoke last
  if (u_band < 1.5)
    return smoothstep(0.24, 0.76, mix(1.3, -0.5, ramp) + (smokeLight(v_uv) - 0.5) * 0.9);
  float foot = 1.0 - ramp;
  if (u_band < 2.5) return foot;
  // edges: the sides and the top give way through the same smoke edge,
  // a band as deep as a fifth of the stage's height
  float aspect = u_rect.z / max(u_rect.w, 1.0);
  float edge = min(min(local.x, 1.0 - local.x) * aspect, 1.0 - local.y);
  float inward = smoothstep(0.0, 0.2, edge);
  return foot * smoothstep(0.24, 0.76, mix(-0.5, 1.3, inward) + (smokeLight(v_uv) - 0.5) * 0.9);
}
void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  vec2 local = stageLocal();
  float m = filmShows(local);
  if (u_band > 0.5) m *= bandShows(local);
  fragColor = vec4(mix(s, film(local), m), 1.0);
}`,
};
