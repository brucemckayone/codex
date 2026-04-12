/**
 * Vortex renderer — Polar volumetric spirals.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse shifts the polar centre, lerped smoothly (0.04 rate).
 * Click burst adds angular twist distortion concentrated at the centre.
 * Configurable: speed, density (int), twist, rings, spiral.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 *
 * NOTE: u_density is an int uniform — use gl.uniform1i().
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, VortexConfig } from '../shader-config';
import { VORTEX_FRAG } from '../shaders/vortex.frag';
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
  'u_speed',
  'u_density',
  'u_twist',
  'u_rings',
  'u_spiral',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type VortexUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  speed: 0.2,
  density: 40,
  twist: 1.0,
  rings: 1.0,
  spiral: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createVortexRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<VortexUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth polar centre shifts
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, VORTEX_FRAG);
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

      const cfg = config as VortexConfig;

      // Lerp mouse for smooth polar centre shifts
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time + resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      // u_density is an int uniform — use uniform1i with Math.round
      gl.uniform1i(
        uniforms.u_density,
        Math.round(cfg.density ?? DEFAULTS.density)
      );
      gl.uniform1f(uniforms.u_twist, cfg.twist ?? DEFAULTS.twist);
      gl.uniform1f(uniforms.u_rings, cfg.rings ?? DEFAULTS.rings);
      gl.uniform1f(uniforms.u_spiral, cfg.spiral ?? DEFAULTS.spiral);
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
