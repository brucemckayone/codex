/**
 * Glass renderer — Voronoi stained glass with a thin-film lead fringe.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 *
 * ## The seed drift is paced here, not in the shader
 *
 * The shader used `u_time` directly for the seed orbits, so the pane drifted
 * at wall-clock rate whatever the music did. It now reads a monotone clock
 * this renderer integrates, whose **rate** crossfades between an idle rate and
 * the differentiated musical clock.
 *
 * Blending rates rather than positions is the load-bearing detail:
 * `u_beatPhase` starts at zero when the analyser is created while `u_time` may
 * already be at 60s, so a positional `mix(u_time, u_beatPhase, active)` sweeps
 * the clock backwards as the ramp eases in — every seed would retrace its
 * orbit in reverse at the exact moment playback starts, shearing the whole
 * tessellation.
 *
 * This preset has no speed setting, so the idle rate is 1.0 clock-unit per
 * second, matching the wall clock the shader used before.
 *
 * Mouse passed directly (no lerp) for instant fracture response.
 * Voronoi cells coloured by brand palette (primary/secondary/accent).
 * Click adds burst seeds that fracture nearby cells.
 *
 * Configurable: cellSize, border width, drift, glow, light variation.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { GLASS_FRAG } from '../shaders/glass.frag';
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
  'u_cellSize',
  'u_border',
  'u_drift',
  'u_glow',
  'u_light',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type GlassUniform = (typeof UNIFORM_NAMES)[number];

/** Default values for glass preset. */
const DEFAULTS = {
  cellSize: 8.0,
  border: 0.08,
  drift: 0.3,
  glow: 0.4,
  light: 0.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Idle clock rate, in clock-units per second. One unit per second reproduces
 * the wall clock the shader used to read directly, so the silent look is the
 * pre-audio look at the same pace.
 */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Upper bound on the differentiated musical clock, in clock-units per second.
 *
 * `beatPhase` advances at 0.35..1.5/s in normal operation, but the render loop
 * pauses (hidden tab, preset switch, reduced motion) while the analyser clamps
 * its own dt rather than freezing. One frame after a long pause can show a
 * large phase jump, and differentiating that unclamped would spike the rate
 * and jump every seed at once — a visible shear across the whole pane.
 */
const MAX_CLOCK_RATE = 3.0;

export function createGlassRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<GlassUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Integrated seed-drift clock. Monotone — see the file header. */
  let clock = 0;
  /** Previous `beatPhase` sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, GLASS_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

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

      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

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
      clock +=
        dt * (IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active);

      // Glass uses direct mouse (no lerp) for instant fracture response
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution + mouse
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength);

      // Brand colours. Left as the configured palette rather than routed
      // through computeImmersiveColours(): cells pick a stop by hash and the
      // lead fringe cycles all three as interference orders, so rotating the
      // stops under audio would re-colour every pane at once.
      const c = config.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      // Read from config if GlassConfig fields exist, otherwise use defaults
      const cfg = config as ShaderConfig & {
        cellSize?: number;
        border?: number;
        drift?: number;
        glow?: number;
        light?: number;
      };
      gl.uniform1f(uniforms.u_cellSize, cfg.cellSize ?? DEFAULTS.cellSize);
      gl.uniform1f(uniforms.u_border, cfg.border ?? DEFAULTS.border);
      gl.uniform1f(uniforms.u_drift, cfg.drift ?? DEFAULTS.drift);
      gl.uniform1f(uniforms.u_glow, cfg.glow ?? DEFAULTS.glow);
      gl.uniform1f(uniforms.u_light, cfg.light ?? DEFAULTS.light);
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
      // Rewind the drift clock. reset() means "start this preset fresh", and
      // leaving it running would resume the pane mid-orbit at whatever
      // arrangement the previous session reached.
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
