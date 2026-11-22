/**
 * The values a Showreel film pass is drawn with, and how they reach its
 * uniforms.
 *
 * A film pass may read any name in `FILM_PASS_UNIFORMS`: the compositor's own
 * (`uniforms.ts`) and the motion's (`motion-uniforms.ts`). `FilmPassValues`
 * holds one value per non-sampler name, and TypeScript makes `filmPassValues`
 * fill it in full, so no name a pass declares is left unset and reading zero.
 * `shaders:check` proves each composed pass declares nothing outside the
 * table (`scripts/film-pass-gate.mjs`).
 */
import type { FilmPassUniform, MotionValues } from './effects/motion-uniforms';
import {
  isSampler,
  SAMPLER_UNITS,
  type UniformValues,
  uploadUniform,
} from './effects/uniforms';
import { governFlash } from './flash';

/** One value per non-sampler uniform a film pass can read. */
export type FilmPassValues = UniformValues &
  MotionValues & {
    /** The governed clock (3 changes a second): the flashing effects' only one. */
    u_flashTime: number;
  };

/** The uniforms every pass of a frame shares (`frameInputs`); `draw` adds the rest. */
export type FrameShared = Omit<
  UniformValues,
  'u_resolution' | 'u_amount' | 'u_time'
>;

/**
 * The film pass's values for this frame: the frame's shared values, the
 * output's size, the real clock and its governed step, and the Showreel's
 * motion as it wrote it. PURE.
 */
export function filmPassValues(
  shared: FrameShared,
  output: readonly [number, number],
  time: number,
  motion: MotionValues
): FilmPassValues {
  return {
    ...shared,
    ...motion,
    u_resolution: output,
    u_amount: 1,
    u_time: time,
    u_flashTime: governFlash(time),
  };
}

/** A film pass's uniform locations, by name (null: the driver dropped it). */
export type FilmPassLocations = readonly (readonly [
  FilmPassUniform,
  WebGLUniformLocation | null,
])[];

/**
 * Set each of a film pass's uniforms: a sampler to its fixed unit, the
 * trail as the array it is (`uniform4fv`), the rest by their size.
 */
export function setFilmPassUniforms(
  gl: WebGL2RenderingContext,
  locations: FilmPassLocations,
  values: FilmPassValues
): void {
  for (const [name, loc] of locations) {
    if (loc === null) continue;
    if (isSampler(name)) gl.uniform1i(loc, SAMPLER_UNITS[name]);
    else uploadUniform(gl, loc, values[name]);
  }
}
