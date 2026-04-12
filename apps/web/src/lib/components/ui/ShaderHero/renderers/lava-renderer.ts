/**
 * Lava renderer — Molten Voronoi crust with glowing cracks.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: lerped smoothly (0.04 rate) for organic feel.
 * Mouse hover widens cracks + increases glow. Click erupts accent.
 *
 * Configurable: crackScale, crackWidth, glow, speed, crust, heat.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { LavaConfig, ShaderConfig } from '../shader-config';
import { LAVA_FRAG } from '../shaders/lava.frag';
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
  'u_crackScale',
  'u_crackWidth',
  'u_glow',
  'u_speed',
  'u_crust',
  'u_heat',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type LavaUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching shader-config.ts. */
const DEFAULTS = {
  crackScale: 4.0,
  crackWidth: 0.04,
  glow: 1.5,
  speed: 0.08,
  crust: 0.6,
  heat: 1.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createLavaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<LavaUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth interaction
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, LAVA_FRAG);
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

      const cfg = config as LavaConfig;

      // Lerp mouse for smooth interaction
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config with defaults
      gl.uniform1f(
        uniforms.u_crackScale,
        cfg.crackScale ?? DEFAULTS.crackScale
      );
      gl.uniform1f(
        uniforms.u_crackWidth,
        cfg.crackWidth ?? DEFAULTS.crackWidth
      );
      gl.uniform1f(uniforms.u_glow, cfg.glow ?? DEFAULTS.glow);
      gl.uniform1f(uniforms.u_speed, cfg.speed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_crust, cfg.crust ?? DEFAULTS.crust);
      gl.uniform1f(uniforms.u_heat, cfg.heat ?? DEFAULTS.heat);
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
      // Reset lerped mouse to center on preset change/reset.
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
