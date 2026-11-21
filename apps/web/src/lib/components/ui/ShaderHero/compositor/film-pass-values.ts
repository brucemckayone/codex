/**
 * The values a Showreel film pass is drawn with (Codex-1yd58.7, WP-6 wiring
 * part 1), and how they reach its uniforms.
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
  SAMPLER_UNITS,
  type SamplerName,
  type UniformValues,
} from './effects/uniforms';
import { governFlash } from './flash';

/** One value per non-sampler uniform a film pass can read. */
export type FilmPassValues = UniformValues &
  MotionValues & {
    /** The governed clock (3 changes a second): the flashing effects' only one. */
    u_flashTime: number;
  };

/** The values every pass of a frame shares (the compositor's `frameInputs`). */
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

const isSamplerName = (name: FilmPassUniform): name is SamplerName =>
  name in SAMPLER_UNITS;

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
    if (isSamplerName(name)) {
      gl.uniform1i(loc, SAMPLER_UNITS[name]);
      continue;
    }
    const v = values[name];
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v instanceof Float32Array) gl.uniform4fv(loc, v);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
  }
}
