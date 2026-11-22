import type { FrameEffect } from './effect';
import { FILM_GLSL, FILM_UNIFORMS } from './film';

/**
 * The Showreel's Name window: the film plays inside the letters of the org's
 * name (`setNameMask`), the brand's picture around them. With no mask the plan
 * draws `film-fill` instead. The mask is held where the page sat at the top, so
 * its letters go within a short scroll (`u_nameFade`), as the composed film
 * pass's do.
 */
export const frameFilmName: FrameEffect = {
  id: 'film-name',
  axis: 'frame',
  label: 'The film through the name',
  uniforms: [...FILM_UNIFORMS, 'u_mask', 'u_nameFade'],
  amount: 1,
  phoneFallback: 'film-name',
  reducedMotionFallback: 'film-name',
  glsl: `${FILM_GLSL}
void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  vec2 local = stageLocal();
  float m = filmShows(local) * texture(u_mask, v_uv).r * u_nameFade;
  fragColor = vec4(mix(s, film(local), m), 1.0);
}`,
};
