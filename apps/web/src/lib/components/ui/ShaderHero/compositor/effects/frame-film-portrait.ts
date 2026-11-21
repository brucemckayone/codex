import type { FrameEffect } from './effect';
import { FILM_GLSL, FILM_UNIFORMS, SMOKE_GLSL, SMOKE_UNIFORMS } from './film';
import { BAND_GLSL, BAND_UNIFORMS } from './film-band';

/**
 * A portrait film or picture on a desktop (owner, 2026-11-21): held at the
 * stage's full height and flush right, with no frame. Its left half fades in
 * from the brand's picture, so the words on the left sit over the shader and
 * no edge or column shows. The band gives way as in `film-fill`.
 *
 * No look names it: the compositor draws it in `film-fill`'s place when
 * filling would crop more than 40% of a piece narrower than the stage
 * (`../portrait.ts`). The film is contained, never stretched or cropped.
 */
export const frameFilmPortrait: FrameEffect = {
  id: 'film-portrait',
  axis: 'frame',
  label: 'The film flush right, fading in from the left',
  uniforms: [...FILM_UNIFORMS, ...SMOKE_UNIFORMS, ...BAND_UNIFORMS],
  amount: 1,
  // A phone fills its stage: the plan never reaches here there, but a frame
  // must name one of its own axis.
  phoneFallback: 'film-fill',
  reducedMotionFallback: 'film-portrait',
  glsl: `${FILM_GLSL}
${SMOKE_GLSL}
${BAND_GLSL}
// The share of the film's width its left edge fades in over.
const float LEAD = 0.5;
// The film's width at the stage's height, as a share of the stage's width.
float portraitWidth() {
  float w = u_rect.w * u_mediaSize.x / max(u_mediaSize.y, 1.0) / max(u_rect.z, 1.0);
  return clamp(w, 0.001, 1.0);
}
void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  vec2 local = stageLocal();
  float w = portraitWidth();
  float left = 1.0 - w;
  vec2 uv = vec2((local.x - left) / w, local.y);
  float m = filmShows(local) * smoothstep(left, left + w * LEAD, local.x);
  if (u_band > 0.5) m *= bandShows(local);
  vec3 f = texture(u_media, clamp(uv, 0.0, 1.0)).rgb;
  fragColor = vec4(mix(s, f, m), 1.0);
}`,
};
