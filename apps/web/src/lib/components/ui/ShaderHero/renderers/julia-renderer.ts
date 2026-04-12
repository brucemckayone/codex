/**
 * Julia renderer — Animated Julia set fractal with cosine palette.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse shifts the c parameter directly for fractal exploration, lerped
 * smoothly (0.04 rate). Click recentres c to the orbit path via burstStrength.
 * Configurable: zoom, speed, iterations (int), radius, saturation.
 * Brand colors derive the cosine palette vectors.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { JuliaConfig, ShaderConfig } from '../shader-config';
import { JULIA_FRAG } from '../shaders/julia.frag';
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
  'u_zoom',
  'u_speed',
  'u_iterations',
  'u_radius',
  'u_saturation',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type JuliaUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  zoom: 1.3,
  speed: 0.33,
  iterations: 75,
  radius: 0.79,
  saturation: 0.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createJuliaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<JuliaUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth c exploration
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, JULIA_FRAG);
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
      height: number
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as JuliaConfig;

      // Lerp mouse for smooth fractal exploration
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time & resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);

      // Burst strength (click recentre)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_zoom, cfg.zoom ?? DEFAULTS.zoom);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      // CRITICAL: u_iterations is int — use uniform1i, NOT uniform1f
      gl.uniform1i(
        uniforms.u_iterations,
        Math.round(cfg.iterations ?? DEFAULTS.iterations)
      );
      gl.uniform1f(uniforms.u_radius, cfg.radius ?? DEFAULTS.radius);
      gl.uniform1f(
        uniforms.u_saturation,
        cfg.saturation ?? DEFAULTS.saturation
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
      // Reset lerped mouse to center for smooth restart.
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
