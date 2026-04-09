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

import type { MouseState, ShaderRenderer } from '../renderer-types';
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
  'u_speed',
  'u_lightAng',
  'u_contrast',
  'u_invert',
  'u_intensity',
  'u_grain',
  'u_vignette',
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

export function createWarpRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<WarpUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

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
      height: number
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as WarpConfig;

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

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_warpStr, cfg.warpStrength ?? DEFAULTS.warpStr);
      gl.uniform1i(uniforms.u_detail, cfg.detail ?? DEFAULTS.detail);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_lightAng, cfg.lightAngle ?? DEFAULTS.lightAng);
      gl.uniform1f(uniforms.u_contrast, cfg.contrast ?? DEFAULTS.contrast);
      gl.uniform1f(
        uniforms.u_invert,
        (cfg.invert ?? DEFAULTS.invert) ? 1.0 : 0.0
      );
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
