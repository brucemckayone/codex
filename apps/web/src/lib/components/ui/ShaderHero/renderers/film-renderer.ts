/**
 * Film renderer — Oil film thin-film interference (iridescence).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse is lerped smoothly (MOUSE_LERP=0.04, like ether) for fluid hover.
 * Passes mouse.burstStrength to u_burstStrength for click ripples.
 *
 * Configurable: filmScale, filmSpeed, bands, shift, ripple.
 * Brand colors drive a cyclic palette (bg → primary → secondary → accent → primary).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { FILM_FRAG } from '../shaders/film.frag';
import {
  createSinglePass,
  easePointer,
  restingPointer,
  setPalette,
} from './single-pass';

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_burstStrength',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_filmScale',
  'u_filmSpeed',
  'u_bands',
  'u_shift',
  'u_ripple',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Default values for film preset. */
const DEFAULTS = {
  filmScale: 3.0,
  filmSpeed: 0.3,
  bands: 3.0,
  shift: 0.5,
  ripple: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Per-frame share of the way the eased pointer moves toward the real one. */
const MOUSE_LERP = 0.04;

/** Pacing rate with no audio, in clock-units/sec — matches the old wall-clock feel. */
const IDLE_CLOCK_RATE = 1.0;

export function createFilmRenderer(): ShaderRenderer {
  const pass = createSinglePass(FILM_FRAG, UNIFORM_NAMES);
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  // Eased for smooth hover; only its position is uploaded.
  let pointer = restingPointer();

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!pass.init(gl)) return false;
      pointer = restingPointer();
      return true;
    },

    render(
      gl: WebGL2RenderingContext,
      time: number,
      mouse: MouseState,
      config: ShaderConfig,
      width: number,
      height: number,
      audio?: AudioState
    ): void {
      const u = pass.begin(gl, width, height);
      if (!u) return;

      // Read from config if FilmConfig fields exist, otherwise use defaults
      const cfg = config as ShaderConfig & {
        filmScale?: number;
        filmSpeed?: number;
        bands?: number;
        shift?: number;
        ripple?: number;
      };
      easePointer(pointer, mouse, MOUSE_LERP);
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      clock += dt * pace.rate(a, dt) * (cfg.filmSpeed ?? DEFAULTS.filmSpeed);

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
      gl.uniform1f(u.u_burstStrength, mouse.burstStrength);
      setPalette(gl, u, cfg.colors);

      gl.uniform1f(u.u_filmScale, cfg.filmScale ?? DEFAULTS.filmScale);
      gl.uniform1f(u.u_filmSpeed, cfg.filmSpeed ?? DEFAULTS.filmSpeed);
      gl.uniform1f(u.u_bands, cfg.bands ?? DEFAULTS.bands);
      gl.uniform1f(u.u_shift, cfg.shift ?? DEFAULTS.shift);
      gl.uniform1f(u.u_ripple, cfg.ripple ?? DEFAULTS.ripple);
      gl.uniform1f(u.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(u.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(u.u_vignette, cfg.vignette ?? DEFAULTS.vignette);
      gl.uniform1f(u.u_clock, clock);

      uploadAudioUniforms(gl, u, a);
      pass.draw(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      clock = 0;
      pace.reset();
      // Reset the eased pointer to the centre on preset change.
      pointer = restingPointer();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
