/**
 * Topographic Contour renderer — animated contour lines on a procedural heightfield.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: Gaussian elevation hill at cursor, click burst for larger hill.
 * Configurable: lineCount, lineWidth, speed, scale, elevation, octaves.
 * Brand colors map height to a 3-segment gradient (bg → primary → secondary → accent).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  createMusicalPace,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TopoConfig } from '../shader-config';
import { TOPO_FRAG } from '../shaders/topo.frag';
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
  'u_lineCount',
  'u_lineWidth',
  'u_clock',
  'u_scale',
  'u_elevation',
  'u_octaves',
  'u_intensity',
  'u_grain',
  'u_vignette',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Default values matching the plan spec. */
const DEFAULTS = {
  lineCount: 27,
  lineWidth: 1.0,
  speed: 0.4,
  scale: 2.5,
  elevation: 2.8,
  octaves: 5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Pacing rate with no audio, in clock-units/sec — matches the old u_time * u_speed. */
const IDLE_CLOCK_RATE = 1.0;

export function createTopoRenderer(): ShaderRenderer {
  const pass = createSinglePass(TOPO_FRAG, UNIFORM_NAMES);
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  const pace = createMusicalPace(IDLE_CLOCK_RATE);
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      return pass.init(gl);
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

      const cfg = config as TopoConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      clock += dt * pace.rate(a, dt) * (cfg.speed ?? DEFAULTS.speed);

      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      // The pointer as it is, or the centre while it is off the canvas.
      gl.uniform2f(
        u.u_mouse,
        mouse.active ? mouse.x : 0.5,
        mouse.active ? mouse.y : 0.5
      );
      gl.uniform1f(u.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(u.u_burst, mouse.burstStrength);
      setPalette(gl, u, cfg.colors);

      // Preset-specific config with defaults — int uniforms via uniform1i
      gl.uniform1i(
        u.u_lineCount,
        Math.round(cfg.lineCount ?? DEFAULTS.lineCount)
      );
      gl.uniform1f(u.u_lineWidth, cfg.lineWidth ?? DEFAULTS.lineWidth);
      gl.uniform1f(u.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(u.u_elevation, cfg.elevation ?? DEFAULTS.elevation);
      gl.uniform1i(u.u_octaves, Math.round(cfg.octaves ?? DEFAULTS.octaves));
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
      // The integrated clock is state — rewind so reset() starts fresh
      // rather than resuming motion mid-phase.
      clock = 0;
      pace.reset();
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
