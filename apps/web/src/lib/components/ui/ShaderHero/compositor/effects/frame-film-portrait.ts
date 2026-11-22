import { PORTRAIT_LEAD } from '../portrait';
import type { FrameEffect } from './effect';
import { FILM_GLSL, FILM_UNIFORMS } from './film';
import type { UniformName } from './uniforms';

/**
 * Where a portrait film or picture sits on a landscape stage, and how much of
 * it shows, shared with the Showreel's film pass with its motion
 * (`film-pass.ts`), so the two place it alike. GLSL text placed after
 * `FILM_GLSL`, in a pass that reads `PORTRAIT_UNIFORMS` too.
 */
export const PORTRAIT_GLSL = `// The share of the piece's width its left edge fades in over.
const float LEAD = ${PORTRAIT_LEAD.toFixed(4)};
// The width it is drawn at, a share of the stage's (u_placed.x, from the
// compositor's placedRect).
float portraitWidth() {
  return clamp(u_placed.x, 0.001, 1.0);
}
// Where a stage point samples it: flush right, and of its height the middle
// u_placed.y, the rest trimmed top and bottom.
vec2 portraitUv(vec2 local) {
  float w = portraitWidth();
  return vec2((local.x - (1.0 - w)) / w, 0.5 + (local.y - 0.5) * u_placed.y);
}
// How much of it shows at a stage point: its left edge fades in, and nothing
// gives way at its foot.
float portraitShows(vec2 local) {
  float w = portraitWidth();
  float left = 1.0 - w;
  return smoothstep(left, left + w * LEAD, local.x);
}`;

/** What `PORTRAIT_GLSL` reads beside the film's own uniforms. */
export const PORTRAIT_UNIFORMS: readonly UniformName[] = ['u_placed'];

/**
 * A portrait film or picture on a landscape stage: flush right at the stage's
 * full height with no frame, `PORTRAIT_MIN_WIDTH` of the stage's width, a film
 * and a picture alike, cover-cropped about its centre (trimmed top and bottom,
 * never stretched; `../portrait.ts` `placedRect`, which the compositor hands
 * it as `u_placed`). Its left fifth fades in from the brand's picture, so no
 * edge or column shows, and nothing gives way at its foot, whatever the
 * look's band (the band is `film-fill`'s).
 *
 * No look names it: the compositor draws it in `film-fill`'s place when
 * filling would crop more than 40% of a portrait piece (`../portrait.ts`).
 */
export const frameFilmPortrait: FrameEffect = {
  id: 'film-portrait',
  axis: 'frame',
  label: 'The film flush right, fading in from the left',
  uniforms: [...FILM_UNIFORMS, ...PORTRAIT_UNIFORMS],
  amount: 1,
  // The stage's shape decides, not the device: a phone held sideways is placed
  // as a desktop is.
  phoneFallback: 'film-portrait',
  reducedMotionFallback: 'film-portrait',
  glsl: `${FILM_GLSL}
${PORTRAIT_GLSL}
void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  vec2 local = stageLocal();
  float m = filmShows(local) * portraitShows(local);
  vec3 f = texture(u_media, clamp(portraitUv(local), 0.0, 1.0)).rgb;
  fragColor = vec4(mix(s, f, m), 1.0);
}`,
};
