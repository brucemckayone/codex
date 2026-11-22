/**
 * Caustic renderer — Underwater light patterns (single-pass).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Iterative sin/cos UV warping creates caustic convergence lines.
 * Mouse creates localized ripple; click propagates an outward ring.
 * The pointer is eased (a 0.4 s time constant) for smooth interaction.
 * Configurable: scale, speed, iterations (int), brightness, ripple.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { CAUSTIC_FRAG } from '../shaders/caustic.frag';
import {
  createSinglePass,
  easePointer,
  restingPointer,
  setPalette,
} from './single-pass';

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

/**
 * Mouse-follow time constant (seconds). Was `* 0.04` applied per FRAME, which
 * converges twice as fast on a 120Hz display as on 60Hz; 0.04/frame at 60fps
 * is a tau of roughly 0.4s.
 */
const MOUSE_TAU_SEC = 0.4;

/** Shimmer rate with no audio, in clock-units/sec — matches the old u_time * u_speed. */
const IDLE_CLOCK_RATE = 1.0;

export function createCausticRenderer(): ShaderRenderer {
  const pass = createSinglePass(CAUSTIC_FRAG, UNIFORM_NAMES);
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated shimmer clock. Monotone — see u_clock in caustic.frag.ts. */
  let clock = 0;
  // Eased for smooth interaction; only its position is uploaded.
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

      const cfg = config as unknown as CausticCfg;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      // Smoothed, not raw — these reach brightness and colour, where a
      // frame-rate-noisy band reads as flicker.
      const amp = a.level;
      const bass = a.bass;
      const mids = a.mids;

      clock += dt * pace.rate(a, dt) * (cfg.speed ?? DEFAULTS.speed);
      // Frame-rate-independent mouse damping. Was a per-frame constant, which
      // converged twice as fast at 120Hz as at 60Hz.
      easePointer(pointer, mouse, 1 - Math.exp(-dt / MOUSE_TAU_SEC));

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
      gl.uniform1f(u.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(u.u_burst, mouse.burstStrength);

      // Immersive colour cycling (shared utility)
      setPalette(
        gl,
        u,
        a.silent ? cfg.colors : computeImmersiveColours(time, cfg.colors, amp)
      );

      // Preset-specific config with defaults
      gl.uniform1f(u.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(u.u_clock, clock);
      gl.uniform1i(
        u.u_iterations,
        Math.round(cfg.iterations ?? DEFAULTS.iterations)
      );
      gl.uniform1f(
        u.u_brightness,
        (cfg.brightness ?? DEFAULTS.brightness) + bass * 0.1
      );
      gl.uniform1f(u.u_ripple, (cfg.ripple ?? DEFAULTS.ripple) + mids * 0.15);
      gl.uniform1f(u.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(u.u_grain, cfg.grain ?? DEFAULTS.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the frame popping away on the first beat.
      gl.uniform1f(
        u.u_vignette,
        (cfg.vignette ?? DEFAULTS.vignette) * (1 - a.active)
      );

      uploadAudioUniforms(gl, u, a);
      pass.draw(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // The integrated clock is state — rewind it so reset() starts fresh
      // rather than resuming the shimmer mid-phase.
      clock = 0;
      pace.reset();
      pointer = restingPointer();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
