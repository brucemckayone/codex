/**
 * The uniforms the Showreel's motion effects read, beyond the compositor's
 * own (`uniforms.ts`), with their GLSL types (Codex-1yd58.7).
 *
 * Every value has a REST: the value at which the motion does nothing. A film
 * frame drawn with every motion uniform at rest is, pixel for pixel, the film
 * frame WP-5 draws (`restMotion`, proven on a real GPU). So the drivers only
 * ever move a value away from rest and back.
 */
import { UNIFORMS, type UniformName } from './uniforms';

/** How many pointer trail points the pass reads (`u_trail`). */
export const TRAIL_POINTS = 24;

export const MOTION_UNIFORMS = {
  /** Between pieces: 1 the piece shows, 0 the brand's picture alone. */
  u_reveal: 'float',
  /** How many cuts the reel has made: the light leak's edge, per cut. */
  u_cut: 'float',
  /**
   * Seconds, stepped by the flash governor to 3 changes a second. A motion
   * effect that changes brightness reads this, never `u_time` (WCAG 2.3.1).
   */
  u_flashTime: 'float',
  /**
   * The pointer's trail in output uv (origin bottom left): x, y, strength,
   * radius. A point of strength 0 is no point.
   */
  u_trail: `vec4[${TRAIL_POINTS}]`,
  /** 1 while the pointer is over the reel, else 0 (`u_pointer` is where). */
  u_pointerOn: 'float',
  /** The name's zoom about `u_nameCentre`: 1 the name as drawn. */
  u_nameZoom: 'float',
  /** The name's deepest point, output uv: where a dive falls in. */
  u_nameCentre: 'vec2',
  /** How much of the film the letters let through, 0-1 (the opening's fade-in). */
  u_nameAlpha: 'float',
  /** On the Corner and Wide layouts: 0 no name, 1 the film only in the letters. */
  u_nameWeight: 'float',
  /** How far through a dive into the name, 0-1: its rim streak. */
  u_dive: 'float',
  /** How far into the film: 0 at rest, 1 at the hand-off's turn. */
  u_into: 'float',
  /** 1: the film fills its whole stage, past the band and the letters. */
  u_fill: 'float',
} as const;

export type MotionUniformName = keyof typeof MOTION_UNIFORMS;
/** Any uniform a Showreel film pass may read. */
export type FilmPassUniform = UniformName | MotionUniformName;

type Vec2 = readonly [number, number];

/**
 * What the Showreel drives: one value per motion uniform, shaped as its GLSL
 * type, but `u_flashTime`, which the compositor steps from the frame's own
 * clock (`governFlash`), so nothing else can hand a flash the real one.
 */
export interface MotionValues {
  u_reveal: number;
  u_cut: number;
  /** `TRAIL_POINTS` × 4 floats. */
  u_trail: Float32Array;
  u_pointerOn: number;
  u_nameZoom: number;
  u_nameCentre: Vec2;
  u_nameAlpha: number;
  u_nameWeight: number;
  u_dive: number;
  u_into: number;
  u_fill: number;
}

/** Every driven motion uniform at rest: a frame drawn with these moves nothing. */
export function restMotion(): MotionValues {
  return {
    u_reveal: 1,
    u_cut: 0,
    u_trail: new Float32Array(TRAIL_POINTS * 4),
    u_pointerOn: 0,
    u_nameZoom: 1,
    u_nameCentre: [0.5, 0.5],
    u_nameAlpha: 1,
    u_nameWeight: 0,
    u_dive: 0,
    u_into: 0,
    u_fill: 0,
  };
}

const TYPES: Record<FilmPassUniform, string> = {
  ...UNIFORMS,
  ...MOTION_UNIFORMS,
};

/** Every uniform a Showreel film pass can read (for `shaders:check`). */
export const FILM_PASS_UNIFORMS: readonly FilmPassUniform[] = Object.keys(
  TYPES
).filter((name): name is FilmPassUniform => name in TYPES);

/**
 * The GLSL declarations for a pass reading `names`. An array type
 * (`vec4[24]`) is declared in the C form, `uniform vec4 u_trail[24];`, the
 * one `shaders:check`'s declaration scan reads.
 */
export function declareFilmPassUniforms(
  names: readonly FilmPassUniform[]
): string {
  return names
    .map((name) => {
      const type = TYPES[name];
      const array = /^(\w+)\[(\d+)\]$/.exec(type);
      return array
        ? `uniform ${array[1]} ${name}[${array[2]}];`
        : `uniform ${type} ${name};`;
    })
    .join('\n');
}
