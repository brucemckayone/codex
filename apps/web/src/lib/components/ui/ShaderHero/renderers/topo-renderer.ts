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
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TopoConfig } from '../shader-config';
import { TOPO_FRAG } from '../shaders/topo.frag';
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

type TopoUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  lineCount: 12,
  lineWidth: 1.2,
  speed: 0.15,
  scale: 2.5,
  elevation: 1.0,
  octaves: 3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Pacing rate with no audio, in clock-units/sec — matches the old u_time * u_speed. */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Cap on the differentiated musical clock. The render loop pauses (hidden tab,
 * preset switch) while the analyser clamps its own dt rather than freezing, so
 * one frame after a long pause can show a large phase jump. Unclamped, that
 * spikes the rate and produces exactly one visible lurch.
 */
const MAX_CLOCK_RATE = 3.0;

export function createTopoRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TopoUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, TOPO_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

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

      const cfg = config as TopoConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Integrate the pacing clock by blending RATES, never positions.
      // beatPhase starts at zero while u_time does not, so a positional
      // crossfade sweeps the clock backwards the moment audio starts.
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

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time & resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

      // Mouse state
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults — int uniforms via uniform1i
      gl.uniform1i(
        uniforms.u_lineCount,
        Math.round(cfg.lineCount ?? DEFAULTS.lineCount)
      );
      gl.uniform1f(uniforms.u_lineWidth, cfg.lineWidth ?? DEFAULTS.lineWidth);
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_elevation, cfg.elevation ?? DEFAULTS.elevation);
      gl.uniform1i(
        uniforms.u_octaves,
        Math.round(cfg.octaves ?? DEFAULTS.octaves)
      );
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      // Draw to screen (no FBO)
      gl.uniform1f(uniforms.u_clock, clock);
      uploadAudioUniforms(gl, uniforms, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // The integrated clock is state — rewind so reset() starts fresh
      // rather than resuming motion mid-phase.
      clock = 0;
      prevBeatPhase = -1;
      // No simulation state to reset for single-pass presets.
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
