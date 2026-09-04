/**
 * Waves renderer — Gerstner ocean surface.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * 5 superposed Gerstner waves with iterative height solve, Fresnel,
 * subsurface scattering, specular, and foam.
 * Mouse shifts wind direction; click creates splash disturbance.
 * Brand colors: primary=wave body, secondary=subsurface, accent=foam.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, WavesConfig } from '../shader-config';
import { WAVES_FRAG } from '../shaders/waves.frag';
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
  'u_height',
  'u_chop',
  'u_foam',
  'u_depth',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type WavesUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  height: 1.0,
  speed: 1.0,
  chop: 0.7,
  foam: 0.3,
  depth: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/**
 * Wave-phase rate with no audio, in clock-units per second. Matches the old
 * `u_time * u_speed` behaviour at speed 1, so the silent look is unchanged.
 */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Cap on the differentiated musical clock. The render loop pauses (hidden tab,
 * preset switch) while the analyser clamps its own dt rather than freezing, so
 * one frame after a long pause can show a large phase jump — unclamped, that
 * spikes the rate and lurches the swell exactly once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createWavesRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<WavesUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated wave-phase clock. Monotone — see u_clock in waves.frag.ts. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, WAVES_FRAG);
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

      const cfg = config as WavesConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Integrate the wave-phase clock by blending RATES, never positions.
      // A positional crossfade between u_time and beatPhase would sweep the
      // phase BACKWARDS when audio starts (beatPhase begins at zero while
      // u_time does not) — which on a height field reverses the entire ocean.
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

      // Time + resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

      // Mouse state
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Palette left as configured rather than routed through
      // computeImmersiveColours(). The three brand stops are load-bearing here
      // — primary is the water body, secondary the subsurface, accent the foam
      // — so cycling them muddles the depth read. The shader moves colour with
      // u_centroid instead, tinting the surface warm or cool with timbre.
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_height, cfg.height ?? DEFAULTS.height);
      gl.uniform1f(uniforms.u_clock, clock);
      // Chop steepens with the slow macro envelope. A raw band here would make
      // the wave crests flicker between rounded and pinched every frame.
      gl.uniform1f(
        uniforms.u_chop,
        Math.min(
          1,
          (cfg.chop ?? DEFAULTS.chop) * (1 + a.energy * 0.35 * a.active)
        )
      );
      gl.uniform1f(uniforms.u_foam, cfg.foam ?? DEFAULTS.foam);
      gl.uniform1f(uniforms.u_depth, cfg.depth ?? DEFAULTS.depth);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      // Faded by the audio ramp rather than switched off, so entering
      // immersive mode is a glide instead of the frame popping away.
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
      // No FBO state, but the integrated clock IS state. reset() means "start
      // fresh", and leaving it running would resume the swell mid-phase at
      // wherever the previous session had reached.
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
