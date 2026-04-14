/**
 * Tendrils (Curl Noise Tendrils) renderer — single-pass, no FBOs.
 *
 * Curl noise advected UV with density accumulation along advected paths.
 * Divergence-free flow creates smooth, non-intersecting tendril shapes.
 * Internal lerped mouse state (MOUSE_LERP = 0.04) for smooth vortex response.
 * u_steps is an int uniform — uses gl.uniform1i().
 * Click creates a Gaussian density flash at cursor.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TendrilsConfig } from '../shader-config';
import { TENDRILS_FRAG } from '../shaders/tendrils.frag';
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
  'u_scale',
  'u_speed',
  'u_steps',
  'u_curl',
  'u_fade',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type TendrilsUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  scale: 2.5,
  speed: 0.12,
  steps: 5,
  curl: 1.0,
  fade: 0.6,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createTendrilsRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TendrilsUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth vortex response
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, TENDRILS_FRAG);
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
      height: number,
      audio?: AudioState
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as TendrilsConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // Lerp mouse for smooth vortex
      const targetX = mouse.active ? mouse.x : 0.5;
      const targetY = mouse.active ? mouse.y : 0.5;
      lerpedMouse.x += (targetX - lerpedMouse.x) * MOUSE_LERP;
      lerpedMouse.y += (targetY - lerpedMouse.y) * MOUSE_LERP;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Immersive colour cycling (shared utility)
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(
        uniforms.u_speed,
        (cfg.speed ?? DEFAULTS.speed) + amp * 0.15
      );
      // CRITICAL: u_steps is int — use uniform1i, NOT uniform1f
      gl.uniform1i(uniforms.u_steps, Math.round(cfg.steps ?? DEFAULTS.steps));
      gl.uniform1f(uniforms.u_curl, (cfg.curl ?? DEFAULTS.curl) + bass * 0.1);
      gl.uniform1f(uniforms.u_fade, cfg.fade ?? DEFAULTS.fade);
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
