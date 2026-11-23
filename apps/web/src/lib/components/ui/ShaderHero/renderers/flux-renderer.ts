/**
 * Flux renderer — magnetic field lines around a set of poles.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * The pointer acts as a movable pole — positive on hover, flipping polarity
 * on click through the burst ramp.
 *
 * Audio integration follows the shared substrate documented in
 * `../audio-uniforms`: one `createAudioFade()` and one `createDeltaClock()`
 * per renderer instance, resolved once per frame, uploaded with
 * `uploadAudioUniforms()`. No new config keys — audio is runtime state.
 *
 * `u_poles` is an int uniform and uses `gl.uniform1i()`.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { FluxConfig, ShaderConfig } from '../shader-config';
import { FLUX_FRAG } from '../shaders/flux.frag';
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
  'u_poles',
  'u_lineDensity',
  'u_lineWidth',
  'u_strength',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Default values matching shader-config.ts. */
const DEFAULTS = {
  poles: 3,
  lineDensity: 10.0,
  lineWidth: 1.0,
  strength: 1.5,
  speed: 0.1,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Pointer-pole time constant (seconds), applied to the pointer position and to
 * its active weight.
 *
 * The old renderer uploaded `mouse.active ? 1 : 0` and snapped the position to
 * the centre on the same frame. A pole appearing or vanishing instantly
 * reconfigures the entire field in one frame — the single most jarring motion
 * this preset had, and it fired every time the pointer crossed the canvas
 * edge. Damping the weight fades the pole in and out instead.
 */
const MOUSE_TAU_SEC = 0.35;

/**
 * Idle pacing rate, in clock-units per second.
 *
 * 1.0 so that, with the speed setting applied to the integration rate, the
 * clock equals `u_time * speed` at idle and the poles wander at the pace the
 * old orbit had.
 */
const IDLE_CLOCK_RATE = 1.0;

export function createFluxRenderer(): ShaderRenderer {
  const pass = createSinglePass(FLUX_FRAG, UNIFORM_NAMES);
  let pointer = restingPointer();
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated pacing clock. Monotone — see u_clock in flux.frag.ts. */
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

      const cfg = config as FluxConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Frame-rate-independent pointer damping, position and weight together.
      easePointer(pointer, mouse, 1 - Math.exp(-dt / MOUSE_TAU_SEC));
      clock += dt * pace.rate(a, dt) * (cfg.speed ?? DEFAULTS.speed);

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
      gl.uniform1f(u.u_mouseActive, pointer.active);
      gl.uniform1f(u.u_burst, mouse.burstStrength);

      // Brand colours as configured rather than through
      // computeImmersiveColours(): the four-stop ramp encodes field magnitude,
      // so cycling the stops fights the structural cue they exist to give.
      // Audio moves colour through u_centroid, which slides the ramp position.
      setPalette(gl, u, cfg.colors);

      gl.uniform1i(u.u_poles, cfg.poles ?? DEFAULTS.poles);
      gl.uniform1f(u.u_lineDensity, cfg.lineDensity ?? DEFAULTS.lineDensity);
      gl.uniform1f(u.u_lineWidth, cfg.lineWidth ?? DEFAULTS.lineWidth);
      gl.uniform1f(u.u_strength, cfg.strength ?? DEFAULTS.strength);
      // No u_speed uniform: speed scales the CPU-integrated clock instead, so
      // the shader never sees it. Uploading a stripped uniform would be a
      // silent no-op and would imply the shader still reads it.
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
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      pointer = restingPointer();
      // Rewind the integrated clock: reset() means "start fresh", and leaving
      // it running would resume the poles mid-wander.
      clock = 0;
      pace.reset();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
