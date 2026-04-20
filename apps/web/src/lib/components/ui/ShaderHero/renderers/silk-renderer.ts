/**
 * Silk Fabric renderer — flowing fabric with wrap-around lighting and sheen.
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse interaction: Gaussian depression at cursor, click burst for larger dip.
 * Configurable: foldScale, foldDepth, speed, softness, sheen, lining.
 * Primary = fabric colour. Secondary in deep valleys via lining param.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, SilkConfig } from '../shader-config';
import { SILK_FRAG } from '../shaders/silk.frag';
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
  'u_foldScale',
  'u_foldDepth',
  'u_speed',
  'u_softness',
  'u_sheen',
  'u_lining',
  'u_intensity',
  'u_grain',
  'u_vignette',
] as const;

type SilkUniform = (typeof UNIFORM_NAMES)[number];

/** Default values matching the spec. */
const DEFAULTS = {
  foldScale: 2.5,
  foldDepth: 1.5,
  speed: 0.1,
  softness: 0.7,
  sheen: 0.15,
  lining: 0.1,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createSilkRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let uniforms: Record<SilkUniform, WebGLUniformLocation | null> | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      program = createProgram(gl, VERTEX_SHADER, SILK_FRAG);
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

      const cfg = config as SilkConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;
      const treble = audio?.treble ?? 0;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      quad.bind(program);

      // Time & resolution
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform2f(uniforms.u_resolution, width, height);

      // Mouse state
      const mx = mouse.active ? mouse.x : 0.5;
      const my = mouse.active ? mouse.y : 0.5;
      gl.uniform2f(uniforms.u_mouse, mx, my);
      gl.uniform1f(uniforms.u_mouseActive, mouse.active ? 1.0 : 0.0);
      gl.uniform1f(uniforms.u_burst, mouse.burstStrength ?? 0.0);

      // Immersive colour cycling when audio is active.
      // Silk uses primary + secondary + accent (iridescent sheen).
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(uniforms.u_brandPrimary, colours.primary);
      gl.uniform3fv(uniforms.u_brandSecondary, colours.secondary);
      gl.uniform3fv(uniforms.u_brandAccent, colours.accent);
      gl.uniform3fv(uniforms.u_bgColor, colours.bg);

      // Preset-specific config with defaults
      gl.uniform1f(uniforms.u_foldScale, cfg.foldScale ?? DEFAULTS.foldScale);
      gl.uniform1f(
        uniforms.u_foldDepth,
        (cfg.foldDepth ?? DEFAULTS.foldDepth) + bass * 0.1
      );
      gl.uniform1f(uniforms.u_speed, (cfg.speed ?? DEFAULTS.speed) + amp * 0.2);
      gl.uniform1f(uniforms.u_softness, cfg.softness ?? DEFAULTS.softness);
      gl.uniform1f(
        uniforms.u_sheen,
        (cfg.sheen ?? DEFAULTS.sheen) + treble * 0.15
      );
      gl.uniform1f(uniforms.u_lining, cfg.lining ?? DEFAULTS.lining);
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
