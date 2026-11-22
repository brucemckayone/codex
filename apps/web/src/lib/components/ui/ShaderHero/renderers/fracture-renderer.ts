/**
 * Fracture renderer — Space subdivided by animated half-plane cuts.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## Two monotone accumulators, integrated here
 *
 * `u_clock` paces the cut-angle drift. `u_shatter` is the accumulated re-deal:
 * each click adds to it, and every cut reads it through its own hash
 * multiplier, so a click rotates each cut by a different amount and the
 * pattern never returns to where it was. The shader used to add
 * `u_burst * hash * 6.28` to each cut angle directly, which spun the shards on
 * click and then unwound them as the burst decayed.
 *
 * The pacing rate crossfades between wall clock and the differentiated musical
 * clock. Blending rates rather than positions is the load-bearing detail:
 * `u_beatPhase` starts at zero when the analyser is created while `u_time` may
 * already be at 60s, so a positional `mix(u_time * k, u_beatPhase, active)`
 * sweeps the clock backwards as the ramp eases in — every cut would rewind at
 * the exact moment playback starts.
 *
 * Animated cutting lines subdivide space into geometric shards, hash-coloured
 * from the brand palette with anti-aliased edges and shadow offsets for depth.
 * Mouse influences cut angles; click re-deals the pattern.
 * u_cuts is an int uniform (gl.uniform1i).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { FractureConfig, ShaderConfig } from '../shader-config';
import { FRACTURE_FRAG } from '../shaders/fracture.frag';
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
  'u_mouseActive',
  'u_burst',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_cuts',
  'u_border',
  'u_shadow',
  'u_fill',
  'u_lineSoftness',
  'u_lineTint',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  'u_shatter',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Fallbacks, matching shader-config's DEFAULTS. */
const DEFAULTS = {
  cuts: 5,
  speed: 0.12,
  border: 0.01,
  shadow: 0.05,
  fill: 0.85,
  lineSoftness: 0,
  lineTint: 0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-follow time constant (seconds).
 *
 * The pointer used to be passed straight through, and `u_mouseActive` was a
 * hard 0/1. The frame the pointer left the canvas, the position jumped to dead
 * centre and the gate dropped to zero in one step — a visible snap on exactly
 * the motion the brief singles out as the good kind. Damping both toward their
 * resting values eases that out, and expressing it as a tau driven by dt keeps
 * the feel identical at 60Hz and 120Hz.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Idle clock rate in clock-units per second at the reference speed. Sits
 * inside the musical clock's own 0.35..1.5/s band so the crossfade when audio
 * starts changes the pace without announcing itself.
 */
const IDLE_CLOCK_RATE = 0.8;

/** Speed setting the idle rate is calibrated against — the shipped default. */
const SPEED_REF = 0.17;

/**
 * Radians per second of re-deal a full-strength click adds. Applied as a rate
 * so it integrates into a monotone accumulator: the shards settle into a new
 * arrangement instead of springing back to the old one.
 */
const CLICK_SHATTER = 2.4;

export function createFractureRenderer(): ShaderRenderer {
  const pass = createSinglePass(FRACTURE_FRAG, UNIFORM_NAMES);
  // Damped pointer state, position and gate.
  let pointer = restingPointer();
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Pacing clock for the cut-angle drift. Monotone. */
  let clock = 0;
  /** Accumulated re-deal in radians. Monotone — never unwinds. */
  let shatter = 0;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!pass.init(gl)) return false;
      pointer = restingPointer();
      clock = 0;
      shatter = 0;
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

      const cfg = config as FractureConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent pointer damping.
      easePointer(pointer, mouse, 1 - Math.exp(-dt / MOUSE_TAU_SEC));
      clock +=
        dt * pace.rate(a, dt) * ((cfg.speed ?? DEFAULTS.speed) / SPEED_REF);
      // Non-negative contribution only, so the re-deal is monotone by
      // construction and a decaying burst cannot reverse it.
      shatter += dt * mouse.burstStrength * CLICK_SHATTER;

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
      gl.uniform1f(u.u_mouseActive, pointer.active);
      gl.uniform1f(u.u_burst, mouse.burstStrength);

      // Brand colours. Left as the configured palette rather than routed
      // through computeImmersiveColours(): cells pick a stop by hash, so
      // rotating the stops under audio would re-colour the whole mosaic at
      // once and destroy the per-cell identity the hash exists to give.
      setPalette(gl, u, cfg.colors);

      // Preset-specific config with defaults. No u_speed uniform: speed
      // scales the CPU-integrated clock rate instead, so the shader never
      // sees it.
      // u_cuts is an int uniform — MUST use gl.uniform1i()
      gl.uniform1i(u.u_cuts, Math.round(cfg.cuts ?? DEFAULTS.cuts));
      gl.uniform1f(u.u_border, cfg.border ?? DEFAULTS.border);
      gl.uniform1f(u.u_shadow, cfg.shadow ?? DEFAULTS.shadow);
      gl.uniform1f(u.u_fill, cfg.fill ?? DEFAULTS.fill);
      gl.uniform1f(u.u_lineSoftness, cfg.lineSoftness ?? DEFAULTS.lineSoftness);
      gl.uniform1f(u.u_lineTint, cfg.lineTint ?? DEFAULTS.lineTint);
      gl.uniform1f(u.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(u.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(u.u_vignette, cfg.vignette ?? DEFAULTS.vignette);
      gl.uniform1f(u.u_clock, clock);
      gl.uniform1f(u.u_shatter, shatter);

      uploadAudioUniforms(gl, u, a);
      pass.draw(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      pointer = restingPointer();
      // Rewind both accumulators. reset() means "start this preset fresh",
      // and leaving them running would resume the shards mid-drift in
      // whatever arrangement the previous session reached.
      clock = 0;
      shatter = 0;
      pace.reset();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
