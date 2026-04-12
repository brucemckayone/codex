/**
 * Glass renderer — Animated Voronoi stained glass.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse passed directly (no lerp) for instant fracture response.
 * Voronoi cells coloured by brand palette (primary/secondary/accent).
 * Click adds burst seeds that fracture nearby cells.
 *
 * Configurable: cellSize, border width, drift, glow, light variation.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
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

export function createGlassRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<GlassUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, GLASS_FRAG);
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

      // Brand colors
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
