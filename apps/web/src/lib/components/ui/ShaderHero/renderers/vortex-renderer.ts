/**
 * Vortex renderer — Polar volumetric spirals.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## Two monotone accumulators, integrated here
 *
 * `u_clock` paces the travelling spiral phase and the hue drift. `u_swirl` is
 * the accumulated rotation angle, kept separate because it also carries the
 * click and beat surges — those must add to a rotation RATE, never to a
 * rotation angle. The shader used to add `u_burstStrength * 3.0` straight to
 * theta, which twisted the core on click and untwisted it as the burst
 * decayed: a lurch out and a lurch home.
 *
 * Both accumulate a **rate** that crossfades between wall clock and the
 * differentiated musical clock. Blending rates rather than positions is the
 * load-bearing detail: `u_beatPhase` starts at zero when the analyser is
 * created while `u_time` may already be at 60s, so a positional
 * `mix(u_time * k, u_beatPhase, u_audioActive)` sweeps the clock backwards as
 * the ramp eases in — the whole field would counter-rotate the moment
 * playback starts.
 *
 * Mouse shifts the polar centre, damped frame-rate-independently.
 * Configurable: speed, density (int), twist, rings, spiral.
 *
 * NOTE: u_density is an int uniform — use gl.uniform1i().
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, VortexConfig } from '../shader-config';
import { VORTEX_FRAG } from '../shaders/vortex.frag';
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
  'u_burstStrength',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_density',
  'u_twist',
  'u_rings',
  'u_spiral',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  'u_swirl',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type VortexUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  speed: 0.2,
  density: 40,
  twist: 1.0,
  rings: 1.0,
  spiral: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Mouse-follow time constant (seconds).
 *
 * Was `lerped += (target - lerped) * 0.04` applied per *frame*, which
 * converges twice as fast on a 120Hz display as on 60Hz. 0.04/frame at 60fps
 * is a tau of about 0.4s; driven by dt the feel is identical at any rate.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Idle clock rate in clock-units per second at the reference speed. Sits
 * inside the musical clock's own 0.35..1.5/s band so the crossfade when audio
 * starts changes the pace without announcing itself.
 */
const IDLE_CLOCK_RATE = 0.8;

/**
 * Speed setting the idle rate is calibrated against — the shipped default.
 * Dividing by it makes `speed` a proportional multiplier on the rate, which
 * is what `u_time * u_speed` used to mean.
 */
const SPEED_REF = 0.2;

/**
 * Rotation rate as a fraction of the pacing rate, in radians per clock-unit
 * at the core. 0.45 puts the centre at about 0.36 rad/s at the default speed
 * and the r = 1 edge at roughly 0.05 rad/s.
 */
const SWIRL_FRACTION = 0.45;

/** Radians per second a full-strength beat adds to the core rotation. */
const BEAT_SWIRL = 0.5;

/** Radians per second a full-strength click adds to the core rotation. */
const CLICK_SWIRL = 1.4;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but the render loop
 * pauses (hidden tab, preset switch, reduced motion) while the analyser clamps
 * its own dt rather than freezing. One frame after a long pause can therefore
 * show a large phase jump, and differentiating that unclamped would spike the
 * rate and snap the field around exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createVortexRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<VortexUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth polar centre shifts
  let lerpedMouse = { x: 0.5, y: 0.5 };

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Pacing clock for the spiral travel and hue drift. Monotone. */
  let clock = 0;
  /** Accumulated core rotation in radians. Monotone — never unwinds. */
  let swirl = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, VORTEX_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };
      clock = 0;
      swirl = 0;
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

      const cfg = config as VortexConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent mouse damping.
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
      const speedNorm = (cfg.speed ?? DEFAULTS.speed) / SPEED_REF;
      const paceRate = blended * speedNorm;

      clock += dt * paceRate;
      // Every contribution to the rotation rate is non-negative, so the angle
      // is monotone by construction and no decaying surge can reverse it.
      swirl +=
        dt *
        (paceRate * SWIRL_FRACTION +
          a.beatPulse * a.active * BEAT_SWIRL +
          mouse.burstStrength * CLICK_SWIRL);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colours. Left as the configured palette rather than routed
      // through computeImmersiveColours(): the layer palette is cyclic across
      // all three stops already, so rotating them under audio would fight the
      // depth cue the cycle provides.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults. No u_speed uniform: speed
      // scales the CPU-integrated rates instead, so the shader never sees it.
      // u_density is an int uniform — use uniform1i with Math.round.
      gl.uniform1i(
        uniforms.u_density,
        Math.round(cfg.density ?? DEFAULTS.density)
      );
      gl.uniform1f(uniforms.u_twist, cfg.twist ?? DEFAULTS.twist);
      gl.uniform1f(uniforms.u_rings, cfg.rings ?? DEFAULTS.rings);
      gl.uniform1f(uniforms.u_spiral, cfg.spiral ?? DEFAULTS.spiral);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);
      gl.uniform1f(uniforms.u_clock, clock);
      gl.uniform1f(uniforms.u_swirl, swirl);

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
      // and leaving them running would resume the field mid-rotation at
      // whatever angle the previous session reached.
      clock = 0;
      swirl = 0;
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
