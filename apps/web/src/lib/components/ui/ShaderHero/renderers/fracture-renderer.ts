/**
 * Fracture renderer — Recursive polygon subdivision.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Animated cutting lines subdivide space into geometric shards.
 * Hash-based brand color assignment per cell with anti-aliased edges
 * and shadow offsets for depth.
 * Mouse influences cut angles; click triggers new random pattern.
 * u_cuts is an int uniform (gl.uniform1i).
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { FractureConfig, ShaderConfig } from '../shader-config';
import { FRACTURE_FRAG } from '../shaders/fracture.frag';
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
  'u_cuts',
  'u_speed',
  'u_border',
  'u_shadow',
  'u_fill',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type FractureUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  cuts: 8,
  speed: 0.17,
  border: 0.01,
  shadow: 0.05,
  fill: 0.85,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createFractureRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<FractureUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, FRACTURE_FRAG);
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
      height: number
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as FractureConfig;

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

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      // u_cuts is an int uniform — MUST use gl.uniform1i()
      gl.uniform1i(uniforms.u_cuts, Math.round(cfg.cuts ?? DEFAULTS.cuts));
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_border, cfg.border ?? DEFAULTS.border);
      gl.uniform1f(uniforms.u_shadow, cfg.shadow ?? DEFAULTS.shadow);
      gl.uniform1f(uniforms.u_fill, cfg.fill ?? DEFAULTS.fill);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      // Draw to screen (no FBO)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
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
