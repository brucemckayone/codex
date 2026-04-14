/**
 * Tunnel renderer — Apollonian fractal tunnel flythrough.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse shifts camera look direction, lerped smoothly (0.04 rate).
 * Click creates a speed burst (camera jumps forward).
 * Configurable: speed, fractal (int), radius, brightness, twist.
 * 128 raymarch steps with volumetric colour accumulation.
 * Brand colors derive the per-channel colour offsets.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TunnelConfig } from '../shader-config';
import { TUNNEL_FRAG } from '../shaders/tunnel.frag';
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
  'u_fractal',
  'u_radius',
  'u_brightness',
  'u_twist',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type TunnelUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the plan spec. */
const DEFAULTS = {
  speed: 2.0,
  fractal: 6,
  radius: 2.0,
  brightness: 1.0,
  twist: 0.07,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createTunnelRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<TunnelUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth camera look
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, TUNNEL_FRAG);
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

      const cfg = config as TunnelConfig;
      const amp = audio?.amplitude ?? 0;

      // Lerp mouse for smooth camera look
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

      // Burst strength (speed burst on click)
      gl.uniform1f(uniforms.u_burstStrength, mouse.burstStrength);

      // Immersive colour cycling (shared utility)
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Config uniforms
      gl.uniform1f(uniforms.u_speed, (cfg.speed ?? DEFAULTS.speed) + amp * 0.2);
      // CRITICAL: u_fractal is int — use uniform1i, NOT uniform1f
      gl.uniform1i(
        uniforms.u_fractal,
        Math.round(cfg.fractal ?? DEFAULTS.fractal)
      );
      gl.uniform1f(uniforms.u_radius, cfg.radius ?? DEFAULTS.radius);
      gl.uniform1f(
        uniforms.u_brightness,
        cfg.brightness ?? DEFAULTS.brightness
      );
      gl.uniform1f(uniforms.u_twist, cfg.twist ?? DEFAULTS.twist);
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
