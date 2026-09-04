/**
 * Glow renderer — Bioluminescent deep sea organisms (single-pass).
 *
 * Single-pass: hash-based tiled organisms across depth layers, no FBOs.
 * Each organism pulses, drifts, and glows with a hash-selected brand colour.
 * Fading light trails follow organisms. Mouse gently attracts nearby organisms.
 * Click creates a bright flash that startles them.
 * Lerped mouse (0.04 rate) for smooth organism attraction.
 * Configurable: count (int), pulse, size, drift, trail, depth (int).
 * Brightness cap 0.65 (lower than standard 0.75 for dark scene).
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
import { GLOW_FRAG } from '../shaders/glow.frag';
import {
  createProgram,
  createQuad,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

interface GlowCfg {
  count?: number;
  pulse?: number;
  size?: number;
  drift?: number;
  trail?: number;
  depth?: number;
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
  'u_burstStrength',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_count',
  'u_pulse',
  'u_size',
  'u_drift',
  'u_trail',
  'u_depth',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_clock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

type GlowUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  count: 10,
  pulse: 0.7,
  size: 1.0,
  drift: 0.1,
  trail: 0.4,
  depth: 3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Drift rate with no audio, in clock-units/sec. */
const IDLE_CLOCK_RATE = 1.0;

/**
 * Cap on the differentiated musical clock — one frame after a render-loop
 * pause can show a large phase jump, which unclamped lurches the field once.
 */
const MAX_CLOCK_RATE = 3.0;

export function createGlowRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<GlowUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Integrated drift clock. Monotone — see u_clock in glow.frag.ts. */
  let clock = 0;
  /** Previous beatPhase sample, for differentiating the musical clock. */
  let prevBeatPhase = -1;

  // Internal lerped mouse state for smooth organism attraction
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, GLOW_FRAG);
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

      const cfg = config as unknown as GlowCfg;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // Lerp mouse for smooth attraction
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // Blend RATES, never positions — beatPhase starts at zero while u_time
      // does not, so a positional crossfade runs the field backwards.
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
      clock += dt * rate * (cfg.drift ?? DEFAULTS.drift);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution + mouse
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Immersive colour cycling when audio is active
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      // count and depth are int uniforms
      gl.uniform1i(uniforms.u_count, Math.round(cfg.count ?? DEFAULTS.count));
      gl.uniform1f(
        uniforms.u_pulse,
        (cfg.pulse ?? DEFAULTS.pulse) + bass * 0.1
      );
      gl.uniform1f(uniforms.u_size, cfg.size ?? DEFAULTS.size);
      gl.uniform1f(
        uniforms.u_drift,
        (cfg.drift ?? DEFAULTS.drift) + amp * 0.15
      );
      gl.uniform1f(uniforms.u_trail, cfg.trail ?? DEFAULTS.trail);
      gl.uniform1i(uniforms.u_depth, Math.round(cfg.depth ?? DEFAULTS.depth));
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
