/**
 * Sigil renderer — Fractal line SDF with iterative UV warping.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: parallax UV offset, lerped smoothly.
 * Configurable: speed, layers (fractal depth), distortion, glow.
 * Brand colors: 3-phase cycling through primary, secondary, accent.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, SigilConfig } from '../shader-config';
import { SIGIL_FRAG } from '../shaders/sigil.frag';
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
  // Preset-specific
  'u_speed',
  'u_layers',
  'u_distortion',
  'u_glow',
  // Shared post-process
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type SigilUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  speed: 2.0,
  layers: 6,
  distortion: 1.05,
  glow: 0.01,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createSigilRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<SigilUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse for smooth parallax
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.05;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, SIGIL_FRAG);
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

      const cfg = config as SigilConfig;

      // Lerp mouse for smooth parallax
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

      // Mouse state
      gl.uniform2f(uniforms.u_mouse, lerpedMouse.x, lerpedMouse.y);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Brand colors
      const c = cfg.colors;
      gl.uniform3fv(uniforms.u_brandPrimary, c.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, c.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, c.accent);
      gl.uniform3fv(uniforms.u_bgColor, c.bg);

      // Preset-specific config
      gl.uniform1f(uniforms.u_speed, cfg.sigilSpeed ?? DEFAULTS.speed);
      gl.uniform1i(
        uniforms.u_layers,
        Math.round(cfg.sigilLayers ?? DEFAULTS.layers)
      );
      gl.uniform1f(
        uniforms.u_distortion,
        cfg.sigilDistortion ?? DEFAULTS.distortion
      );
      gl.uniform1f(uniforms.u_glow, cfg.sigilGlow ?? DEFAULTS.glow);

      // Shared post-process
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(uniforms.u_vignette, cfg.vignette ?? DEFAULTS.vignette);

      // Draw to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
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
