/**
 * Growth (Differential Growth) renderer — implements ShaderRenderer.
 *
 * SDF-based differential growth with ping-pong FBO at 512x512.
 * Three programs: init (circular SDF seed), sim (expansion + buckling + redistribution),
 * display (edge coloring + interior gradient + glow).
 * Two substeps per frame for smoother contour evolution.
 * Mouse accelerates growth near cursor. Click plants new SDF seed.
 * Ambient seeds every 8-15 seconds via smooth-min union.
 *
 * CRITICAL: reset() MUST initialise a circular SDF seed — growth requires
 * an initial zero-contour to expand from. Without it, nothing is visible.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { GrowthConfig, ShaderConfig } from '../shader-config';
import { GROWTH_DISPLAY_FRAG } from '../shaders/growth-display.frag';
import { GROWTH_SIM_FRAG } from '../shaders/growth-sim.frag';
import {
  createDoubleFBO,
  createProgram,
  createQuad,
  type DoubleFBO,
  destroyDoubleFBO,
  drawQuad,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

const SIM_RES = 512;

/** Init fragment shader — circular SDF seed at centre. */
const GROWTH_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // Signed distance field for a circle at centre: negative inside, positive outside
  float dist = length(v_uv - vec2(0.5)) - 0.08;
  fragColor = vec4(dist, 0.0, 0.0, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uSpeed',
  'uNoise',
  'uScale',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uSeedPos',
  'uSeedRadius',
] as const;

/** Display uniform names. */
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uWidth',
  'uGlow',
  'uTime',
] as const;

export function createGrowthRenderer(): ShaderRenderer {
  let initProg: WebGLProgram | null = null;
  let simProg: WebGLProgram | null = null;
  let displayProg: WebGLProgram | null = null;

  let simU: Record<
    (typeof SIM_UNIFORM_NAMES)[number],
    WebGLUniformLocation | null
  > | null = null;
  let displayU: Record<
    (typeof DISPLAY_UNIFORM_NAMES)[number],
    WebGLUniformLocation | null
  > | null = null;

  let quad: ReturnType<typeof createQuad> | null = null;
  let simBuf: DoubleFBO | null = null;

  /** Timestamp of last ambient seed. */
  let lastSeedTime = 0;
  /** Next ambient seed interval (8-15s). */
  let nextSeedInterval = 8.0 + Math.random() * 7.0;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    seedX: number,
    seedY: number,
    seedRadius: number,
    cfg: GrowthConfig
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;

    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
    gl.uniform1f(simU.uSpeed, cfg.speed);
    gl.uniform1f(simU.uNoise, cfg.noise);
    gl.uniform1f(simU.uScale, cfg.scale);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform2f(simU.uSeedPos, seedX, seedY);
    gl.uniform1f(simU.uSeedRadius, seedRadius);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions for RGBA16F FBO
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, GROWTH_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, GROWTH_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, GROWTH_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Seed initial state
      this.reset(gl);

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
      if (!simProg || !displayProg || !simU || !displayU || !simBuf || !quad)
        return;

      const cfg = config as GrowthConfig;

      // ── Ambient seed (every 8-15s) ──────────────────────────
      let seedX = -10.0,
        seedY = -10.0;
      const seedRadius = 0.05 + Math.random() * 0.04;
      if (time - lastSeedTime > nextSeedInterval) {
        lastSeedTime = time;
        nextSeedInterval = 8.0 + Math.random() * 7.0;
        seedX = 0.15 + Math.random() * 0.7;
        seedY = 0.15 + Math.random() * 0.7;
      }

      // ── Click seed ──────────────────────────────────────────
      if (mouse.burstStrength > 0) {
        seedX = mouse.x;
        seedY = mouse.y;
      }

      // ── Substep 1: with input (mouse acceleration + seed) ──
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        seedX,
        seedY,
        seedRadius,
        cfg
      );

      // ── Substep 2: coast (no input, no seed) ───────────────
      stepSim(gl, time, -10.0, -10.0, false, -10.0, -10.0, 0.08, cfg);

      // ── Display pass ────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(displayU.uVignette, cfg.vignette);
      gl.uniform1f(displayU.uWidth, cfg.width);
      gl.uniform1f(displayU.uGlow, cfg.glow);
      gl.uniform1f(displayU.uTime, time);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastSeedTime = 0;
      nextSeedInterval = 8.0 + Math.random() * 7.0;

      // Write the initial circular SDF to both FBO sides
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (simBuf) {
        destroyDoubleFBO(gl, simBuf);
        simBuf = null;
      }
      if (initProg) {
        gl.deleteProgram(initProg);
        initProg = null;
      }
      if (simProg) {
        gl.deleteProgram(simProg);
        simProg = null;
      }
      if (displayProg) {
        gl.deleteProgram(displayProg);
        displayProg = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }

      simU = null;
      displayU = null;
    },
  };
}
