/**
 * Nebula renderer — Raymarched volumetric cosmic dust clouds.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Each depth layer is tinted with a different brand color (primary near,
 * secondary mid, accent far). Mouse creates stellar wind displacement.
 * Click creates a bright star flash at the cursor.
 *
 * Internal lerped mouse state (MOUSE_LERP ≈ 0.04) for smooth wind.
 * Passes mouse.burstStrength to u_burstStrength for click flash.
 * u_depth is an int uniform — uses gl.uniform1i().
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { NebulaConfig, ShaderConfig } from '../shader-config';
import { NEBULA_FRAG } from '../shaders/nebula.frag';
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
  'u_speed',
  'u_scale',
  'u_depth',
  'u_wind',
  'u_stars',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type NebulaUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  density: 0.8,
  speed: 0.12,
  scale: 2.0,
  depth: 8,
  wind: 0.5,
  stars: 0.3,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createNebulaRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<NebulaUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  // Internal lerped mouse state for smooth stellar wind
  let lerpedMouse = { x: 0.5, y: 0.5 };
  const MOUSE_LERP = 0.04;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, NEBULA_FRAG);
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

      const cfg = config as NebulaConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // Lerp mouse for smooth stellar wind
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

      // Burst strength (click flash)
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
      gl.uniform1f(uniforms.u_density, cfg.density ?? DEFAULTS.density);
      gl.uniform1f(
        uniforms.u_speed,
        (cfg.speed ?? DEFAULTS.speed) + amp * 0.15
      );
      gl.uniform1f(uniforms.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1i(uniforms.u_depth, Math.round(cfg.depth ?? DEFAULTS.depth));
      gl.uniform1f(uniforms.u_wind, (cfg.wind ?? DEFAULTS.wind) + bass * 0.2);
      gl.uniform1f(uniforms.u_stars, cfg.stars ?? DEFAULTS.stars);
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
