/**
 * Aurora (Aurora Borealis) renderer — single-pass, no FBOs.
 *
 * Layered sine wave curtains with triNoise displacement create northern lights.
 * Multiple translucent layers at different speeds create depth.
 * u_layers is an int uniform — uses gl.uniform1i().
 * Mouse shifts aurora position and phase. Click brightens and widens.
 * Very cheap (~0.5ms per frame).
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { AuroraConfig, ShaderConfig } from '../shader-config';
import { AURORA_FRAG } from '../shaders/aurora.frag';
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
  'u_layers',
  'u_speed',
  'u_height',
  'u_spread',
  'u_shimmer',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type AuroraUniform = (typeof UNIFORM_NAMES)[number];

const DEFAULTS = {
  layers: 5,
  speed: 0.1,
  height: 0.4,
  spread: 0.25,
  shimmer: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createAuroraRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<AuroraUniform, WebGLUniformLocation | null> | null =
    null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, AURORA_FRAG);
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

      const cfg = config as AuroraConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;
      const treble = audio?.treble ?? 0;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

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

      // CRITICAL: u_layers is int — use uniform1i, NOT uniform1f
      gl.uniform1i(
        uniforms.u_layers,
        Math.round(cfg.layers ?? DEFAULTS.layers)
      );
      gl.uniform1f(uniforms.u_speed, (cfg.speed ?? DEFAULTS.speed) + amp * 0.2);
      gl.uniform1f(
        uniforms.u_height,
        (cfg.height ?? DEFAULTS.height) + bass * 0.15
      );
      gl.uniform1f(uniforms.u_spread, cfg.spread ?? DEFAULTS.spread);
      gl.uniform1f(
        uniforms.u_shimmer,
        (cfg.shimmer ?? DEFAULTS.shimmer) + treble * 0.2
      );
      gl.uniform1f(uniforms.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(uniforms.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        uniforms.u_vignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      /* Single-pass: no FBOs to resize */
    },

    reset(_gl: WebGL2RenderingContext): void {
      /* No simulation state */
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
