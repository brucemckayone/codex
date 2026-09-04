/**
 * Domain Warp renderer — Recursive FBM warping with bump-mapped lighting.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: parallax offset, time distortion (mouse.x * 2.0),
 * warp magnification near cursor.
 *
 * CRITICAL: noise function is sin(p.x) * sin(p.y) — NOT hash-based value noise.
 * FBM with inter-octave rotation mat2(0.8, 0.6, -0.6, 0.8).
 *
 * Configurable: warpStrength, lightAngle, speed, contrast, invert.
 * Brand colors mapped from intermediate warp vectors (q, r) in 4 layers.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, WarpConfig } from '../shader-config';
import { WARP_FRAG } from '../shaders/warp.frag';
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
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_warpStr',
  'u_detail',
  'u_clock',
  'u_lightAng',
  'u_contrast',
  'u_invert',
  'u_intensity',
  'u_grain',
  'u_vignette',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type WarpUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the prototype. */
const DEFAULTS = {
  warpStr: 1.5,
  detail: 4,
  speed: 0.3,
  lightAng: 135,
  contrast: 1.1,
  invert: true,
  intensity: 0.45,
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

export function createWarpRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<WarpUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated pacing clock. Monotone — see u_clock in the fragment shader. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, WARP_FRAG);
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

      const cfg = config as WarpConfig;
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

      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // Warp uses mouse directly (no internal lerp — the component lerps MouseState)
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, mx, my);

      // Immersive colour cycling when audio is active
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(
        uniforms.u_warpStr,
        (cfg.warpStrength ?? DEFAULTS.warpStr) + bass * 0.1
      );
      gl.uniform1i(uniforms.u_detail, cfg.detail ?? DEFAULTS.detail);
      gl.uniform1f(uniforms.u_lightAng, cfg.lightAngle ?? DEFAULTS.lightAng);
      gl.uniform1f(uniforms.u_contrast, cfg.contrast ?? DEFAULTS.contrast);
      gl.uniform1f(
        uniforms.u_invert,
        (cfg.invert ?? DEFAULTS.invert) ? 1.0 : 0.0
      );
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        uniforms.u_vignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );

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
