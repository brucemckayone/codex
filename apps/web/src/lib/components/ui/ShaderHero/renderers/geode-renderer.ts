/**
 * Geode (Agate Cross-Section) renderer — implements ShaderRenderer.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Concentric mineral bands with crystal cavity at centre.
 * Mouse shifts specular light source for crystal facets.
 * Click adds rotation impulse.
 *
 * CRITICAL: u_bands is an int uniform — use gl.uniform1i(), NOT uniform1f().
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { GeodeConfig, ShaderConfig } from '../shader-config';
import { GEODE_FRAG } from '../shaders/geode.frag';
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
  'u_bands',
  'u_warp',
  'u_cavity',
  'u_speed',
  'u_sparkle',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type GeodeUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  bands: 8,
  warp: 0.8,
  cavity: 0.2,
  speed: 0.06,
  sparkle: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createGeodeRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<GeodeUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, GEODE_FRAG);
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

      const cfg = config as GeodeConfig;

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
      // CRITICAL: u_bands is int — use uniform1i with Math.round()
      gl.uniform1i(uniforms.u_bands, Math.round(cfg.bands ?? DEFAULTS.bands));
      gl.uniform1f(uniforms.u_warp, cfg.warp ?? DEFAULTS.warp);
      gl.uniform1f(uniforms.u_cavity, cfg.cavity ?? DEFAULTS.cavity);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_sparkle, cfg.sparkle ?? DEFAULTS.sparkle);
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
