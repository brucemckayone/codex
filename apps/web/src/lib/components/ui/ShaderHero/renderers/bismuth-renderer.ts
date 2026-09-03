/**
 * Bismuth (Crystal Terraces) renderer — implements ShaderRenderer.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## Two monotone accumulators, integrated here
 *
 * `u_clock` paces the field wander. `u_tilt` is the accumulated click tilt,
 * kept separate because it carries the burst surge — that must add to a
 * rotation RATE, never to a rotation angle. The shader used to rotate by
 * `u_burst * 0.5` directly, which spun the crystal on click and counter-
 * rotated it as the burst decayed.
 *
 * The pacing rate crossfades between wall clock and the differentiated musical
 * clock. Blending rates rather than positions is the load-bearing detail:
 * `u_beatPhase` starts at zero when the analyser is created while `u_time` may
 * already be at 60s, so a positional `mix(u_time * k, u_beatPhase, active)`
 * sweeps the clock backwards as the ramp eases in — the whole heightfield
 * would retrace its wander in reverse the moment playback starts.
 *
 * ## The pointer is damped now
 *
 * The mouse was passed straight through, and the shader picked between the
 * pointer and dead centre on a hard `u_mouseActive > 0.5`. On a thin-film
 * material the view angle is one of the two quantities that set the colour, so
 * that boolean made the whole crystal change colour in one frame when the
 * pointer left the canvas. The pointer is now damped toward centre with a time
 * constant, which eases the crystal back to a neutral view — and makes the
 * `u_mouseActive` uniform redundant, so it is gone from both files.
 *
 * Stepped terraces from domain-warped noise + floor(), with thin-film
 * interference over the brand palette.
 *
 * CRITICAL: u_terraces is an int uniform — use gl.uniform1i(), NOT uniform1f().
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { BismuthConfig, ShaderConfig } from '../shader-config';
import { BISMUTH_FRAG } from '../shaders/bismuth.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_burst',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_terraces',
  'u_warp',
  'u_iridescence',
  'u_edge',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  'u_tilt',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type BismuthUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  terraces: 8,
  warp: 0.8,
  iridescence: 0.8,
  speed: 0.06,
  edge: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-follow time constant (seconds). Long enough that leaving the canvas
 * eases the crystal back to a neutral view rather than snapping it, short
 * enough that a deliberate tilt still feels attached to the hand.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Idle clock rate in clock-units per second at the reference speed.
 *
 * Calibrated so the drift helpers see a clock advancing at roughly 0.8/s,
 * which puts their slowest component at a two-minute period and their fastest
 * at about twenty seconds. It also sits inside the musical clock's own
 * 0.35..1.5/s band, so the crossfade when audio starts changes the pace
 * without announcing itself.
 */
const IDLE_CLOCK_RATE = 0.8;

/** Speed setting the idle rate is calibrated against — the shipped default. */
const SPEED_REF = 0.06;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but the render loop
 * pauses (hidden tab, preset switch, reduced motion) while the analyser clamps
 * its own dt rather than freezing. One frame after a long pause can show a
 * large phase jump, and differentiating that unclamped would spike the rate
 * and jump the whole heightfield exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

/**
 * Radians per second a full-strength click adds to the tilt. Applied as a rate
 * so it integrates into the monotone accumulator: the crystal settles at a new
 * angle instead of springing back to the old one.
 */
const CLICK_TILT = 0.4;

export function createBismuthRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<BismuthUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped pointer state — see the file header for why this matters
  // more here than on most presets.
  let lerpedMouse = { x: 0.5, y: 0.5 };

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Pacing clock for the field wander. Monotone. */
  let clock = 0;
  /** Accumulated tilt in radians. Monotone — never unwinds. */
  let tilt = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, BISMUTH_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };
      clock = 0;
      tilt = 0;
      prevBeatPhase = -1;

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
      if (!program || !uniforms || !quad) return;

      const cfg = config as BismuthConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent pointer damping. A per-frame lerp constant
      // would converge twice as fast on a 120Hz display as on 60Hz.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      // Blend RATES, never positions.
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
        // The first audio frame has no previous sample to difference against;
        // fall back to the idle rate rather than treating the whole
        // accumulated phase as one frame's advance.
        musicalRate =
          prevBeatPhase < 0
            ? IDLE_CLOCK_RATE
            : Math.min(
                MAX_CLOCK_RATE,
                Math.max(0, (a.beatPhase - prevBeatPhase) / dt)
              );
        prevBeatPhase = a.beatPhase;
      } else {
        prevBeatPhase = -1;
      }
      const blended =
        IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active;
      clock += dt * blended * ((cfg.speed ?? DEFAULTS.speed) / SPEED_REF);
      // Non-negative contribution only, so the tilt is monotone by
      // construction and a decaying burst cannot reverse it.
      tilt += dt * mouse.burstStrength * CLICK_TILT;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colours. Left as the configured palette rather than routed
      // through computeImmersiveColours(): the thin film walks the three stops
      // as interference orders, and the terrace a colour lands on IS the depth
      // cue — rotating the stops would scramble it. Audio moves colour here
      // through u_centroid film thickness instead.
      gl.uniform3fv(uniforms.u_brandPrimary, cfg.colors.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, cfg.colors.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, cfg.colors.accent);
      gl.uniform3fv(uniforms.u_bgColor, cfg.colors.bg);

      // Preset-specific config. No u_speed uniform: speed scales the
      // CPU-integrated clock rate instead, so the shader never sees it.
      // CRITICAL: u_terraces is int — use uniform1i with Math.round()
      gl.uniform1i(
        uniforms.u_terraces,
        Math.round(cfg.terraces ?? DEFAULTS.terraces)
      );
      gl.uniform1f(uniforms.u_warp, cfg.warp ?? DEFAULTS.warp);
      gl.uniform1f(
        uniforms.u_iridescence,
        cfg.iridescence ?? DEFAULTS.iridescence
      );
      gl.uniform1f(uniforms.u_edge, cfg.edge ?? DEFAULTS.edge);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);
      gl.uniform1f(uniforms.u_clock, clock);
      gl.uniform1f(uniforms.u_tilt, tilt);

      uploadAudioUniforms(gl, uniforms, a);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      lerpedMouse = { x: 0.5, y: 0.5 };
      // Rewind both accumulators. reset() means "start this preset fresh",
      // and leaving them running would resume the field mid-wander at
      // whatever position the previous session reached.
      clock = 0;
      tilt = 0;
      prevBeatPhase = -1;
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (program) {
        gl.deleteProgram(program);
        program = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }
      uniforms = null;
    },
  };
}
