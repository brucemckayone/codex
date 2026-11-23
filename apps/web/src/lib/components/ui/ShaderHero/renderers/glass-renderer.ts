/**
 * Glass renderer — Voronoi stained glass with a thin-film lead fringe.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## The seed drift is paced here, not in the shader
 *
 * The shader used `u_time` directly for the seed orbits, so the pane drifted
 * at wall-clock rate whatever the music did. It now reads a monotone clock
 * this renderer integrates, whose **rate** crossfades between an idle rate and
 * the differentiated musical clock.
 *
 * Blending rates rather than positions is the load-bearing detail:
 * `u_beatPhase` starts at zero when the analyser is created while `u_time` may
 * already be at 60s, so a positional `mix(u_time, u_beatPhase, active)` sweeps
 * the clock backwards as the ramp eases in — every seed would retrace its
 * orbit in reverse at the exact moment playback starts, shearing the whole
 * tessellation.
 *
 * This preset has no speed setting, so the idle rate is 1.0 clock-unit per
 * second, matching the wall clock the shader used before.
 *
 * Mouse passed directly (no lerp) for instant fracture response.
 * Voronoi cells coloured by brand palette (primary/secondary/accent).
 * Click adds burst seeds that fracture nearby cells.
 *
 * Configurable: cellSize, border width, drift, glow, light variation.
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
import { GLASS_FRAG } from '../shaders/glass.frag';
import { createSinglePass, setPalette } from './single-pass';

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_mouseActive',
  'u_burst',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_cellSize',
  'u_border',
  'u_drift',
  'u_glow',
  'u_light',
  'u_lineSoftness',
  'u_lineTint',
  'u_pieceEdges',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Fallbacks, matching shader-config's DEFAULTS. */
const DEFAULTS = {
  cellSize: 5.0,
  border: 0.04,
  drift: 0.1,
  glow: 0.2,
  light: 0.15,
  // The old came: hard, dark, flat pieces.
  lineSoftness: 0,
  lineTint: 0,
  pieceEdges: 0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Idle clock rate, in clock-units per second. One unit per second reproduces
 * the wall clock the shader used to read directly, so the silent look is the
 * pre-audio look at the same pace.
 */
const IDLE_CLOCK_RATE = 1.0;

export function createGlassRenderer(): ShaderRenderer {
  const pass = createSinglePass(GLASS_FRAG, UNIFORM_NAMES);
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated seed-drift clock. Monotone — see the file header. */
  let clock = 0;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!pass.init(gl)) return false;
      clock = 0;
      pace.reset();
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

      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      clock += dt * pace.rate(a, dt);

      // Glass uses direct mouse (no lerp) for instant fracture response
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, mx, my);
      gl.uniform1f(u.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(u.u_burst, mouse.burstStrength);

      // Brand colours. Left as the configured palette rather than routed
      // through computeImmersiveColours(): cells pick a stop by hash and the
      // lead fringe cycles all three as interference orders, so rotating the
      // stops under audio would re-colour every pane at once.
      setPalette(gl, u, config.colors);

      // Read from config if GlassConfig fields exist, otherwise use defaults
      const cfg = config as ShaderConfig & {
        cellSize?: number;
        border?: number;
        drift?: number;
        glow?: number;
        light?: number;
        lineSoftness?: number;
        lineTint?: number;
        pieceEdges?: number;
      };
      gl.uniform1f(u.u_cellSize, cfg.cellSize ?? DEFAULTS.cellSize);
      gl.uniform1f(u.u_border, cfg.border ?? DEFAULTS.border);
      gl.uniform1f(u.u_drift, cfg.drift ?? DEFAULTS.drift);
      gl.uniform1f(u.u_glow, cfg.glow ?? DEFAULTS.glow);
      gl.uniform1f(u.u_light, cfg.light ?? DEFAULTS.light);
      gl.uniform1f(u.u_lineSoftness, cfg.lineSoftness ?? DEFAULTS.lineSoftness);
      gl.uniform1f(u.u_lineTint, cfg.lineTint ?? DEFAULTS.lineTint);
      gl.uniform1f(u.u_pieceEdges, cfg.pieceEdges ?? DEFAULTS.pieceEdges);
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
      // Rewind the drift clock. reset() means "start this preset fresh", and
      // leaving it running would resume the pane mid-orbit at whatever
      // arrangement the previous session reached.
      clock = 0;
      pace.reset();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
