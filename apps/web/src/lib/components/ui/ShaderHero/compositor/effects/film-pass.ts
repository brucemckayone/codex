/**
 * The Showreel's film frame with its motion: one pass that draws the film over
 * the brand's picture and runs the four motion hooks (`motion.ts`) inside it.
 *
 * At rest (`restMotion`) the pass draws exactly what the plain film frame draws
 * (`frame-film-fill.ts`, `frame-film-name.ts`, `frame-film-portrait.ts`): every
 * hook leaves the motion untouched, the film is sampled at the very point the
 * frame samples it (`frameFilm`, as that frame places it), it gives way as that
 * frame does (the band, `bandShows`; a portrait piece's own left fade,
 * `portraitShows`), and nothing is multiplied but by exactly 1. A real-GPU
 * probe compares the two pixel for pixel.
 */

import { FILM_GLSL, FILM_UNIFORMS, SMOKE_GLSL, SMOKE_UNIFORMS } from './film';
import { BAND_GLSL, BAND_UNIFORMS } from './film-band';
import { PORTRAIT_GLSL, PORTRAIT_UNIFORMS } from './frame-film-portrait';
import { HEADER } from './header';
import type { FilmFrameId } from './ids';
import { MOTION_GLSL, MOTION_GLSL_UNIFORMS, type MotionSet } from './motion';
import { INTOS, OPENINGS, POINTERS, TRANS } from './motion-registry';
import {
  declareFilmPassUniforms,
  type FilmPassUniform,
} from './motion-uniforms';

export interface FilmPass {
  /** The pass cache key: the frame and its four effects. */
  readonly id: string;
  /** Every uniform the pass reads; its declarations are generated. */
  readonly uniforms: readonly FilmPassUniform[];
  /** The body after the header and the declarations. */
  readonly glsl: string;
}

/**
 * What each film frame adds before the motion: the film as the frame places
 * it (`frameFilm`, which the glitch samples too), and what its film gives way
 * through (the band, or a portrait piece's left fade). After `FILM_GLSL`,
 * before `MOTION_GLSL`.
 */
const FRAME_GLSL: Record<FilmFrameId, string> = {
  'film-fill': `${SMOKE_GLSL}
${BAND_GLSL}
// The film as this frame places it: covering the stage.
vec3 frameFilm(vec2 local) {
  return film(local);
}`,
  'film-name': `// The film as this frame places it: covering the stage.
vec3 frameFilm(vec2 local) {
  return film(local);
}`,
  'film-portrait': `${PORTRAIT_GLSL}
// The film as this frame places it: flush right at the stage's full
// height, as wide as u_placed says, trimmed top and bottom.
vec3 frameFilm(vec2 local) {
  return texture(u_media, clamp(portraitUv(local), 0.0, 1.0)).rgb;
}`,
};

/** What each film frame lets through, before the motion's own `shows`. */
function frameTerm(frame: FilmFrameId, throughName: boolean): string {
  if (frame === 'film-name') return 'float frame = nameVeil(v_uv, mo.warp);';
  // As the plain frames give way: the band (1 with none), or a portrait
  // piece's left edge fading in, with no band at its foot.
  const band =
    frame === 'film-portrait'
      ? 'float frame = portraitShows(local);'
      : 'float frame = bandShows(local);';
  if (!throughName) return band;
  // The opening and the dive draw the film into the letters on these
  // layouts too, as far as the name's weight says.
  return `${band}
  if (u_nameWeight > 0.0) {
    float veil = nameVeil(v_uv, mo.warp);
    frame *= u_nameWeight >= 1.0 ? veil : mix(1.0, veil, u_nameWeight);
  }`;
}

const FRAME_UNIFORMS: Record<FilmFrameId, readonly FilmPassUniform[]> = {
  'film-fill': [...SMOKE_UNIFORMS, ...BAND_UNIFORMS],
  'film-name': [],
  'film-portrait': PORTRAIT_UNIFORMS,
};
/** What `main` itself reads, and the name's weight it reads for a dive. */
const MAIN_UNIFORMS: readonly FilmPassUniform[] = ['u_fill'];
const NAME_WEIGHT: readonly FilmPassUniform[] = ['u_nameWeight'];

/** The film frame `frame` running the effects of `motion`. PURE. */
export function composeFilmPass(
  frame: FilmFrameId,
  motion: MotionSet
): FilmPass {
  const { trans, pointer, opening, into } = motion;
  const effects = [pointer, trans, into, opening];
  const throughName = effects.some((e) => e.throughName === true);
  const named = throughName || frame === 'film-name';
  const uniforms = [
    ...new Set<FilmPassUniform>([
      ...FILM_UNIFORMS,
      ...MOTION_GLSL_UNIFORMS,
      ...MAIN_UNIFORMS,
      ...FRAME_UNIFORMS[frame],
      ...(throughName && frame !== 'film-name' ? NAME_WEIGHT : []),
      ...effects.flatMap((e) => e.uniforms),
    ]),
  ];
  const glsl = `${FILM_GLSL}
${FRAME_GLSL[frame]}
${MOTION_GLSL}
${effects.map((e) => e.glsl).join('\n')}
void main() {
  vec3 s = texture(u_scene, v_uv).rgb;
  vec2 local = stageLocal();
  Motion mo = Motion(vec2(0.0), 1.0, 0.0, vec3(0.0));
  reelPointer(mo, v_uv);
  reelTrans(mo, v_uv);
  reelInto(mo, v_uv);
  reelOpening(mo, v_uv);
  // Unmoved, the film is sampled exactly where the frame samples it.
  bool moved = mo.warp != vec2(0.0);
  vec3 f = mo.glitch > 0.01 ? glitchedFilm(v_uv + mo.warp, mo.glitch)
                            : frameFilm(moved ? stageAt(v_uv + mo.warp) : local);
  ${frameTerm(frame, throughName)}
  if (u_fill > 0.0) frame = mix(frame, 1.0, u_fill);
  float m = filmShows(local) * frame * mo.shows;
  vec3 col = mix(s, f, m);${named ? '\n  if (u_dive > 0.0) mo.glow += nameStreak(v_uv);' : ''}
  if (mo.glow != vec3(0.0)) col = 1.0 - (1.0 - col) * (1.0 - min(mo.glow, vec3(1.0)));
  fragColor = vec4(col, 1.0);
}`;
  return {
    id: `${frame}+${trans.id}+${pointer.id}+${opening.id}+${into.id}`,
    uniforms,
    glsl,
  };
}

/** The fragment source of a film pass: header, its uniforms, its body. */
export function assembleFilmPass(pass: FilmPass): string {
  return `${HEADER}${declareFilmPassUniforms(pass.uniforms)}\n${pass.glsl}\n`;
}

/** The frames that draw the film, and so run its motion. */
export const FILM_FRAMES: readonly FilmFrameId[] = [
  'film-fill',
  'film-name',
  'film-portrait',
];

/** Every film pass the Showreel can draw, for `shaders:check`. */
export function everyFilmPass(): FilmPass[] {
  const passes: FilmPass[] = [];
  for (const frame of FILM_FRAMES)
    for (const trans of Object.values(TRANS))
      for (const pointer of Object.values(POINTERS))
        for (const opening of Object.values(OPENINGS))
          for (const into of Object.values(INTOS))
            passes.push(
              composeFilmPass(frame, { trans, pointer, opening, into })
            );
  return passes;
}
