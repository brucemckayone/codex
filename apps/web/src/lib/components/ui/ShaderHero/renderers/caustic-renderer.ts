/**
 * Caustic renderer — Underwater light patterns (single-pass).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Iterative sin/cos UV warping creates caustic convergence lines.
 * Mouse creates localized ripple; click propagates an outward ring.
 * Lerped mouse (0.04 rate) for smooth interaction.
 * Configurable: scale, speed, iterations (int), brightness, ripple.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { CAUSTIC_FRAG } from '../shaders/caustic.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

interface CausticCfg {
  scale?: number;
  speed?: number;
  iterations?: number;
  brightness?: number;
  ripple?: number;
  intensity?: number;
  grain?: number;
  vignette?: number;
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
    bg: [number, number, number];
  };
}

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
  'u_scale',
  'u_iterations',
  'u_brightness',
  'u_ripple',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type CausticUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  scale: 2.5,
  speed: 0.1,
  iterations: 3,
  brightness: 1.2,
  ripple: 1.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createCausticRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<CausticUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated shimmer clock. Monotone — see u_clock in caustic.frag.ts. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  // Internal lerped mouse state for smooth interaction
  let lerpedMouse = { x: 0.5, y: 0.5 };
  /**
   * Mouse-follow time constant (seconds). Was `* 0.04` applied per FRAME, which
   * converges twice as fast on a 120Hz display as on 60Hz; 0.04/frame at 60fps
   * is a tau of roughly 0.4s.
   */
  const MOUSE_TAU_SEC = 0.4;

  /** Shimmer rate with no audio, in clock-units/sec — matches the old u_time * u_speed. */
  const IDLE_CLOCK_RATE = 1.0;

  /**
   * Cap on the differentiated musical clock. The render loop pauses while the
   * analyser clamps its own dt, so one frame after a long pause can show a large
   * phase jump — unclamped that spikes the rate and lurches the pattern once.
   */
  const MAX_CLOCK_RATE = 3.0;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, CAUSTIC_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      lerpedMouse = { x: 0.5, y: 0.5 };

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

      const cfg = config as unknown as CausticCfg;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      // Smoothed, not raw — these reach brightness and colour, where a
      // frame-rate-noisy band reads as flicker.
      const amp = a.level;
      const bass = a.bass;
      const mids = a.mids;

      // Integrate the shimmer clock by blending RATES, never positions:
      // beatPhase starts at zero while u_time does not, so a positional
      // crossfade would run the caustic warp backwards on audio start.
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
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
      const rate = IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active;
      clock += dt * rate * (cfg.speed ?? DEFAULTS.speed);

      // Frame-rate-independent mouse damping. Was a per-frame constant, which
      // converged twice as fast at 120Hz as at 60Hz.
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      const k = 1 - Math.exp(-dt / MOUSE_TAU_SEC);
      lerpedMouse.x += (targetX - lerpedMouse.x) * k;
      lerpedMouse.y += (targetY - lerpedMouse.y) * k;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution + mouse
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength);

      // Immersive colour cycling (shared utility)
      const colours = a.silent
        ? cfg.colors
        : computeImmersiveColours(time, cfg.colors, amp);

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_clock, clock);
      gl.uniform1i(
        uniforms.u_iterations,
        Math.round(cfg.iterations ?? DEFAULTS.iterations)
      );
      gl.uniform1f(
        uniforms.u_brightness,
        (cfg.brightness ?? DEFAULTS.brightness) + bass * 0.1
      );
      gl.uniform1f(
        uniforms.u_ripple,
        (cfg.ripple ?? DEFAULTS.ripple) + mids * 0.15
      );
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the frame popping away on the first beat.
      gl.uniform1f(
        uniforms.u_vignette,
        (cfg.vignette ?? DEFAULTS.vignette) * (1 - a.active)
      );

      uploadAudioUniforms(gl, uniforms, a);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // The integrated clock is state — rewind it so reset() starts fresh
      // rather than resuming the shimmer mid-phase.
      clock = 0;
      prevBeatPhase = -1;
      // No simulation state to reset for single-pass presets.
      lerpedMouse = { x: 0.5, y: 0.5 };
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
