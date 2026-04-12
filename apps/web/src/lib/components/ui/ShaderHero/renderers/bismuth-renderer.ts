/**
 * Bismuth (Crystal Terraces) renderer — implements ShaderRenderer.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Stepped terraces from domain-warped noise + floor().
 * Edge detection + brand-palette iridescence.
 * Mouse shifts viewing angle for prismatic colour sweep.
 * Click adds rotation impulse.
 *
 * CRITICAL: u_terraces is an int uniform — use gl.uniform1i(), NOT uniform1f().
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { BismuthConfig, ShaderConfig } from '../shader-config';
import { BISMUTH_FRAG } from '../shaders/bismuth.frag';
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
  'u_terraces',
  'u_warp',
  'u_iridescence',
  'u_speed',
  'u_edge',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type BismuthUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  terraces: 8,
  warp: 0.8,
  iridescence: 0.8,
  speed: 0.06,
  edge: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createBismuthRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<BismuthUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, BISMUTH_FRAG);
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

      const cfg = config as BismuthConfig;

      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colors
      gl.uniform3fv(uniforms.u_brandPrimary, cfg.colors.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, cfg.colors.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, cfg.colors.accent);
      gl.uniform3fv(uniforms.u_bgColor, cfg.colors.bg);

      // Preset-specific config
      // CRITICAL: u_terraces is int — use uniform1i with Math.round()
      gl.uniform1i(
        uniforms.u_terraces,
        Math.round(cfg.terraces ?? DEFAULTS.terraces)
      );
      gl.uniform1f(uniforms.u_warp, cfg.warp ?? DEFAULTS.warp);
      gl.uniform1f(
        uniforms.u_iridescence,
        cfg.iridescence ?? DEFAULTS.iridescence
      );
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_edge, cfg.edge ?? DEFAULTS.edge);
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
