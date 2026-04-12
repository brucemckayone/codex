/**
 * Flux renderer — Magnetic dipole field lines.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: instant response (no internal lerp).
 * Mouse acts as a movable pole — positive on hover, flips on click (burst).
 *
 * Configurable: poles, lineDensity, lineWidth, strength, speed.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { FluxConfig, ShaderConfig } from '../shader-config';
import { FLUX_FRAG } from '../shaders/flux.frag';
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
  'u_poles',
  'u_lineDensity',
  'u_lineWidth',
  'u_strength',
  'u_speed',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type FluxUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching shader-config.ts. */
const DEFAULTS = {
  poles: 3,
  lineDensity: 10.0,
  lineWidth: 1.0,
  strength: 1.5,
  speed: 0.1,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createFluxRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<FluxUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, FLUX_FRAG);
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

      const cfg = config as FluxConfig;

      // Flux uses mouse directly — no internal lerp (instant response)
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
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1i(uniforms.u_poles, cfg.poles ?? DEFAULTS.poles);
      gl.uniform1f(
        uniforms.u_lineDensity,
        cfg.lineDensity ?? DEFAULTS.lineDensity
      );
      gl.uniform1f(uniforms.u_lineWidth, cfg.lineWidth ?? DEFAULTS.lineWidth);
      gl.uniform1f(uniforms.u_strength, cfg.strength ?? DEFAULTS.strength);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
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
