/**
 * Aurora (Aurora Borealis) renderer — single-pass, no FBOs.
 *
 * Layered curtains of light whose silhouette is the effect. There is no
 * camera: all motion is internal flow or pointer follow.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 *
 * `u_layers` is an int uniform and uses `gl.uniform1i()`.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { AuroraConfig, ShaderConfig } from '../shader-config';
import { AURORA_FRAG } from '../shaders/aurora.frag';
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
  'u_layers',
  'u_speed',
  'u_height',
  'u_spread',
  'u_shimmer',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const DEFAULTS = {
  layers: 5,
  speed: 0.1,
  height: 0.4,
  spread: 0.25,
  shimmer: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-follow time constant (seconds), applied to BOTH the pointer position
 * and its active weight.
 *
 * The old renderer uploaded `mouse.active ? 1 : 0` and snapped the position to
 * the centre on the same frame, so the pointer leaving the canvas moved every
 * band centre by up to 0.15 in uv-y instantly — a visible jolt in the one
 * motion the viewer causes directly. Damping the weight as well as the
 * position means the aurora settles back rather than jumping.
 */
const MOUSE_TAU_SEC = 0.45;

/**
 * Idle pacing rate, in clock-units per second.
 *
 * 1.0 because `u_clock` is NOT scaled by the speed setting for this preset
 * (see the u_clock comment in aurora.frag.ts): at idle the clock therefore
 * equals `u_time`, and the silent look is unchanged from before.
 */
const IDLE_CLOCK_RATE = 1.0;

export function createAuroraRenderer(): ShaderRenderer {
  const pass = createSinglePass(AURORA_FRAG, UNIFORM_NAMES);
  let pointer = restingPointer();
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated pacing clock. Monotone — see u_clock in aurora.frag.ts. */
  let clock = 0;

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

      const cfg = config as AuroraConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent damping, position and active weight together.
      easePointer(pointer, mouse, 1 - Math.exp(-dt / MOUSE_TAU_SEC));
      clock += dt * pace.rate(a, dt);

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
      gl.uniform1f(u.u_mouseActive, pointer.active);
      gl.uniform1f(u.u_burst, mouse.burstStrength);

      // Brand colours as configured rather than through
      // computeImmersiveColours(): the three stops are this preset's
      // elevation ramp, so cycling them fights the parallax cue they exist to
      // give. Audio moves colour through u_centroid, which slides the ramp
      // position and leaves every stop recognisable.
      setPalette(gl, u, cfg.colors);

      // CRITICAL: u_layers is int — use uniform1i, NOT uniform1f
      gl.uniform1i(u.u_layers, Math.round(cfg.layers ?? DEFAULTS.layers));
      // Speed still means "how fast the curtains travel sideways", exactly as
      // before. It is NOT folded into u_clock: at the default of 0.1 that
      // would have slowed the flame and fringe shimmer tenfold.
      gl.uniform1f(u.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(u.u_height, cfg.height ?? DEFAULTS.height);
      gl.uniform1f(u.u_spread, cfg.spread ?? DEFAULTS.spread);
      gl.uniform1f(u.u_shimmer, cfg.shimmer ?? DEFAULTS.shimmer);
      gl.uniform1f(u.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(u.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(u.u_clock, clock);
      // Vignette reads as a frame around a hero but as a tunnel in fullscreen
      // immersive mode, so it fades with the audio ramp. Switching it off on
      // `audio.active` (the old behaviour) popped on the first beat.
      gl.uniform1f(
        u.u_vignette,
        (cfg.vignette ?? DEFAULTS.vignette) * (1 - a.active)
      );

      uploadAudioUniforms(gl, u, a);
      pass.draw(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      /* Single-pass: no FBOs to resize */
    },

    reset(_gl: WebGL2RenderingContext): void {
      pointer = restingPointer();
      // Rewind the integrated clock: reset() means "start fresh", and leaving
      // it running would resume the curtains mid-travel.
      clock = 0;
      pace.reset();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
