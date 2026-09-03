/**
 * Pearl renderer — Raymarched displaced sphere with a thin-film nacre.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## The surface phase is integrated here, not in the shader
 *
 * The shader used to derive its deformation phase from `u_time * u_speed`,
 * with `u_burstStrength * 2.0` added on top. Two problems: the pace was
 * wall-clock, so the surface crawled at a constant rate whatever the music
 * did; and a click displaced the phase two radians and then dragged it back
 * as the burst decayed, which is a lurch out followed by a lurch home.
 *
 * The phase clock is now a monotone accumulator whose **rate** is what
 * crossfades. Blending rates rather than positions is the load-bearing detail:
 * `u_beatPhase` starts at zero when the analyser is created while `u_time` may
 * already be at 60s, so `mix(u_time * k, u_beatPhase, u_audioActive)` sweeps
 * the clock backwards as the ramp eases in — the surface would unwind itself
 * at the exact moment playback starts.
 *
 * Mouse moves the light, damped frame-rate-independently. Click surges the
 * phase forward (monotone — it never reverses) and blooms the highlight.
 * Configurable: displacement, speed, fresnel, specular.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { PearlConfig, ShaderConfig } from '../shader-config';
import { PEARL_FRAG } from '../shaders/pearl.frag';
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
  'u_displacement',
  'u_fresnel',
  'u_specular',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type PearlUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  displacement: 0.15,
  speed: 0.7,
  fresnel: 3.0,
  specular: 1.25,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Mouse-follow time constant (seconds).
 *
 * Was `lerped += (target - lerped) * 0.04` applied per *frame*, which
 * converges twice as fast on a 120Hz display as on 60Hz. 0.04/frame at 60fps
 * is a tau of about 0.4s; expressed as a tau and driven by dt the feel is
 * identical at any refresh rate.
 */
const MOUSE_TAU_SEC = 0.4;

/**
 * Idle clock rate in clock-units per second, at the preset's reference speed.
 *
 * Chosen to sit inside the musical clock's own 0.35..1.5/s band so the
 * crossfade when audio starts changes the pace without announcing itself.
 */
const IDLE_CLOCK_RATE = 0.8;

/**
 * Speed setting the idle rate is calibrated against — the shipped default for
 * this preset. Dividing by it makes `speed` a proportional multiplier on the
 * clock rate, which is exactly what `u_time * u_speed` used to mean, while
 * keeping the calibration above readable as "0.8 clock-units per second".
 */
const SPEED_REF = 0.7;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but it is sampled
 * from a render loop that pauses (hidden tab, preset switch, reduced motion)
 * while the analyser clamps its own dt rather than freezing. So one frame
 * after a long pause can show a large phase jump, and differentiating that
 * unclamped would spike the rate and jerk the surface exactly once — the
 * artefact this whole integration exists to prevent.
 */
const MAX_CLOCK_RATE = 3.0;

/**
 * Clock-units per second a full-strength click adds. Applied as a rate, so it
 * integrates into the monotone phase rather than displacing it: the surface
 * surges and stays, instead of springing back when the burst decays.
 */
const CLICK_SURGE = 1.6;

export function createPearlRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<PearlUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal damped mouse state for smooth light direction
  let lerpedMouse = { x: 0.5, y: 0.5 };

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated surface-phase clock. Monotone — see the file header. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, PEARL_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };
      clock = 0;
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

      const cfg = config as PearlConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent mouse damping.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      // Integrate the phase clock by blending RATES, never positions.
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
        // The first audio frame has no previous sample to difference against;
        // fall back to the idle rate for that one frame rather than treating
        // the whole accumulated phase as a single frame's advance.
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
      clock += dt * (blended * speedNorm + mouse.burstStrength * CLICK_SURGE);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colours. Left as the configured palette rather than routed
      // through computeImmersiveColours(): the nacre cycles all three stops as
      // interference orders, so rotating them under audio would fight the
      // order cue. Audio moves colour here through u_centroid thickness.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults. No u_speed uniform: speed
      // scales the CPU-integrated clock rate instead, so the shader never
      // sees it. Uploading a stripped uniform would be a silent no-op and
      // would imply the shader still reads it.
      gl.uniform1f(
        uniforms.u_displacement,
        cfg.displacement ?? DEFAULTS.displacement
      );
      gl.uniform1f(uniforms.u_fresnel, cfg.fresnel ?? DEFAULTS.fresnel);
      gl.uniform1f(uniforms.u_specular, cfg.specular ?? DEFAULTS.specular);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);
      gl.uniform1f(uniforms.u_clock, clock);

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
      // Rewind the phase clock too. reset() means "start this preset fresh",
      // and leaving it running would resume the surface mid-drift at whatever
      // phase the previous session reached.
      clock = 0;
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
