/**
 * Orb renderer — Raymarched crystal sphere with procedural displacement.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: orbits camera angle + elevation, lerped smoothly.
 * Configurable: speed, displacement, reflection, refraction, camera distance.
 * Brand colors: surface blend (primary↔secondary), specular (accent), environment (all).
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { OrbConfig, ShaderConfig } from '../shader-config';
import { ORB_FRAG } from '../shaders/orb.frag';
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
  'u_displace',
  'u_reflect',
  'u_refract',
  'u_camDist',
  // Shared post-process
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type OrbUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  speed: 0.15,
  displace: 1.0,
  reflect: 0.6,
  refract: 0.8,
  camDist: 2.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createOrbRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<OrbUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse for smooth camera orbiting
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.03;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, ORB_FRAG);
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

      const cfg = config as OrbConfig;

      // Lerp mouse for smooth camera orbiting
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
      gl.uniform1f(uniforms.u_speed, cfg.orbSpeed ?? DEFAULTS.speed);
      gl.uniform1f(uniforms.u_displace, cfg.orbDisplace ?? DEFAULTS.displace);
      gl.uniform1f(uniforms.u_reflect, cfg.orbReflect ?? DEFAULTS.reflect);
      gl.uniform1f(uniforms.u_refract, cfg.orbRefract ?? DEFAULTS.refract);
      gl.uniform1f(uniforms.u_camDist, cfg.orbCamDist ?? DEFAULTS.camDist);

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
