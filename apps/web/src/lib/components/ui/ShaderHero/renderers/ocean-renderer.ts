/**
 * Ocean (Underwater Caustics + Sand Ripples) renderer — implements ShaderRenderer.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Three composited layers: sand ripples, caustic light, soft shadows.
 * Mouse creates dual ripple disturbance in both water and sand.
 * All float uniforms (no int uniforms).
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { OceanConfig, ShaderConfig } from '../shader-config';
import { OCEAN_FRAG } from '../shaders/ocean.frag';
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
  'u_causticScale',
  'u_sandScale',
  'u_speed',
  'u_shadow',
  'u_ripple',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type OceanUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  causticScale: 2.0,
  sandScale: 3.0,
  speed: 0.1,
  shadow: 0.25,
  ripple: 1.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createOceanRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<OceanUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, OCEAN_FRAG);
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

      const cfg = config as OceanConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);
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

      // Preset-specific config (all float uniforms)
      gl.uniform1f(
        uniforms.u_causticScale,
        (cfg.causticScale ?? DEFAULTS.causticScale) + bass * 0.1
      );
      gl.uniform1f(uniforms.u_sandScale, cfg.sandScale ?? DEFAULTS.sandScale);
      gl.uniform1f(
        uniforms.u_speed,
        (cfg.speed ?? DEFAULTS.speed) + amp * 0.15
      );
      gl.uniform1f(uniforms.u_shadow, cfg.shadow ?? DEFAULTS.shadow);
      gl.uniform1f(
        uniforms.u_ripple,
        (cfg.ripple ?? DEFAULTS.ripple) + bass * 0.1
      );
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
