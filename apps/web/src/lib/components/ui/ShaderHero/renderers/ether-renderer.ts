/**
 * Ether renderer — Raymarched volumetric light (nimitz 2014).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse parallax shifts the view origin, lerped smoothly (0.04 rate).
 * Configurable: rotationSpeed, complexity (3-8 steps), glow, scale, zoom.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { EtherConfig, ShaderConfig } from '../shader-config';
import { ETHER_FRAG } from '../shaders/ether.frag';
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
  'u_rotSpeed',
  'u_complexity',
  'u_glow',
  'u_scale',
  'u_zoom',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_aberration',
] as const;

type EtherUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the prototype. */
const DEFAULTS = {
  rotSpeed: 0.4,
  complexity: 6,
  glow: 0.5,
  scale: 2.0,
  zoom: 5.0,
  intensity: 0.4,
  grain: 0.02,
  vignette: 0.2,
  aberration: 0.003,
} as const;

export function createEtherRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<EtherUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth parallax
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, ETHER_FRAG);
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
      height: number,
      audio?: AudioState
    ): void {
      if (!program || !uniforms || !quad) return;

      const cfg = config as EtherConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // Lerp mouse for smooth parallax
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

      // Immersive colour cycling when audio is active
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(
        uniforms.u_rotSpeed,
        (cfg.rotationSpeed ?? DEFAULTS.rotSpeed) + amp * 0.15
      );
      gl.uniform1i(
        uniforms.u_complexity,
        cfg.complexity ?? DEFAULTS.complexity
      );
      gl.uniform1f(uniforms.u_glow, (cfg.glow ?? DEFAULTS.glow) + bass * 0.1);
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(uniforms.u_zoom, cfg.zoom ?? DEFAULTS.zoom);
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        uniforms.u_vignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );
      gl.uniform1f(
        uniforms.u_aberration,
        cfg.aberration ?? DEFAULTS.aberration
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
