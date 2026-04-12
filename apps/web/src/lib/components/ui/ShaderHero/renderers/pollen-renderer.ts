/**
 * Pollen (Floating Organic Spore Drift) renderer — single-pass, no FBOs.
 *
 * Organic SDF particles with radial fibres and depth-of-field bokeh.
 * Multiple depth layers with parallax. Curl noise drift displacement.
 * Internal lerped mouse state (MOUSE_LERP = 0.04) for smooth breath avoidance.
 * u_fibres and u_depth are int uniforms — use gl.uniform1i().
 * Mouse pushes particles away (avoidance). Click creates stronger push.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { PollenConfig, ShaderConfig } from '../shader-config';
import { POLLEN_FRAG } from '../shaders/pollen.frag';
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
  'u_density',
  'u_size',
  'u_fibres',
  'u_drift',
  'u_depth',
  'u_bokeh',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type PollenUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  density: 0.6,
  size: 1.0,
  fibres: 5,
  drift: 0.1,
  depth: 3,
  bokeh: 0.5,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createPollenRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<PollenUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth breath avoidance
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, POLLEN_FRAG);
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
      height: number
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as PollenConfig;

      // Lerp mouse for smooth breath avoidance
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

      // Preset-specific (NOTE: fibres and depth are INT uniforms)
      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      gl.uniform1f(uniforms.u_size, cfg.size ?? DEFAULTS.size);
      gl.uniform1i(
        uniforms.u_fibres,
        Math.round(cfg.fibres ?? DEFAULTS.fibres)
      );
      gl.uniform1f(uniforms.u_drift, cfg.drift ?? DEFAULTS.drift);
      gl.uniform1i(uniforms.u_depth, Math.round(cfg.depth ?? DEFAULTS.depth));
      gl.uniform1f(uniforms.u_bokeh, cfg.bokeh ?? DEFAULTS.bokeh);

      // Post-processing
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
