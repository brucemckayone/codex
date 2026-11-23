import type { FrameEffect } from './effect';
import { FILM_GLSL, FILM_UNIFORMS, SMOKE_GLSL, SMOKE_UNIFORMS } from './film';
import { BAND_GLSL, BAND_UNIFORMS } from './film-band';

/**
 * The Showreel's Corner and Wide layouts: the film fills its stage over the
 * brand's picture, which shows outside the stage. With a band (`stage.ts`
 * `FilmBand`) the film gives way to the picture: at its foot ('under' through
 * the smoke, 'fade' evenly), or all round ('edges').
 */
export const frameFilmFill: FrameEffect = {
  id: 'film-fill',
  axis: 'frame',
  label: 'The film fills the stage',
  uniforms: [...FILM_UNIFORMS, ...SMOKE_UNIFORMS, ...BAND_UNIFORMS],
  amount: 1,
  phoneFallback: 'film-fill',
  reducedMotionFallback: 'film-fill',
  glsl: `${FILM_GLSL}
${SMOKE_GLSL}
${BAND_GLSL}
void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  vec2 local = stageLocal();
  float m = filmShows(local);
  if (u_band > 0.5) m *= bandShows(local);
  fragColor = vec4(mix(s, film(local), m), 1.0);
}`,
};
