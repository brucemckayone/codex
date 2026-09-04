/**
 * Film renderer — Oil film thin-film interference (iridescence).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse is lerped smoothly (MOUSE_LERP=0.04, like ether) for fluid hover.
 * Passes mouse.burstStrength to u_burstStrength for click ripples.
 *
 * Configurable: filmScale, filmSpeed, bands, shift, ripple.
 * Brand colors drive a cyclic palette (bg → primary → secondary → accent → primary).
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { FILM_FRAG } from '../shaders/film.frag';
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
  'u_filmScale',
  'u_filmSpeed',
  'u_bands',
  'u_shift',
  'u_ripple',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type FilmUniform = (typeof UNIFORM_NAMES)[number];

/** Default values for film preset. */
const DEFAULTS = {
  filmScale: 3.0,
  filmSpeed: 0.3,
  bands: 3.0,
  shift: 0.5,
  ripple: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

const MOUSE_LERP = 0.04;

/** Pacing rate with no audio, in clock-units/sec — matches the old wall-clock feel. */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Cap on the differentiated musical clock. The render loop pauses while the
 * analyser clamps its own dt, so one frame after a long pause can show a large
 * phase jump — unclamped that spikes the rate and lurches the scene once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createFilmRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<FilmUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  // Internal lerped mouse state for smooth hover
  let lerpedMouse = { x: 0.5, y: 0.5 };

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, FILM_FRAG);
      if (!program) return false;

      uniforms = getUniforms(gl, program, UNIFORM_NAMES);
      quad = createQuad(gl);

      // Reset lerped mouse to center
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

      // Lerp mouse for smooth hover effect
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

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

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution + mouse
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colors
      const c = config.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      // Read from config if FilmConfig fields exist, otherwise use defaults
      const cfg = config as ShaderConfig & {
        filmScale?: number;
        filmSpeed?: number;
        bands?: number;
        shift?: number;
        ripple?: number;
      };

      // Accumulated here rather than beside the rate derivation above: film
      // declares `cfg` AFTER its viewport call, and the accumulation is the one
      // part that needs it. tsc caught the original ordering.
      clock += dt * rate * (cfg.filmSpeed ?? DEFAULTS.filmSpeed);
      gl.uniform1f(uniforms.u_filmScale, cfg.filmScale ?? DEFAULTS.filmScale);
      gl.uniform1f(uniforms.u_filmSpeed, cfg.filmSpeed ?? DEFAULTS.filmSpeed);
      gl.uniform1f(uniforms.u_bands, cfg.bands ?? DEFAULTS.bands);
      gl.uniform1f(uniforms.u_shift, cfg.shift ?? DEFAULTS.shift);
      gl.uniform1f(uniforms.u_ripple, cfg.ripple ?? DEFAULTS.ripple);
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
      clock = 0;
      prevBeatPhase = -1;
      // Reset lerped mouse to center on preset change.
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
