/**
 * Waves renderer — Gerstner ocean surface.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * 5 superposed Gerstner waves with iterative height solve, Fresnel,
 * subsurface scattering, specular, and foam.
 * Mouse shifts wind direction; click creates splash disturbance.
 * Brand colors: primary=wave body, secondary=subsurface, accent=foam.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, WavesConfig } from '../shader-config';
import { WAVES_FRAG } from '../shaders/waves.frag';
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
  'u_height',
  'u_speed',
  'u_chop',
  'u_foam',
  'u_depth',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type WavesUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  height: 1.0,
  speed: 1.0,
  chop: 0.7,
  foam: 0.3,
  depth: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createWavesRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<WavesUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, WAVES_FRAG);
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
      height: number,
      audio?: AudioState
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as WavesConfig;
      const amp = audio?.amplitude ?? 0;

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

      // Immersive colour cycling when audio is active
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_height, cfg.height ?? DEFAULTS.height);
      gl.uniform1f(
        uniforms.u_speed,
        (cfg.speed ?? DEFAULTS.speed) + amp * 0.15
      );
      gl.uniform1f(uniforms.u_chop, cfg.chop ?? DEFAULTS.chop);
      gl.uniform1f(uniforms.u_foam, cfg.foam ?? DEFAULTS.foam);
      gl.uniform1f(uniforms.u_depth, cfg.depth ?? DEFAULTS.depth);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        uniforms.u_vignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );

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
