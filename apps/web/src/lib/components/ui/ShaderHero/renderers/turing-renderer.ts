/**
 * Turing Pattern renderer — implements ShaderRenderer.
 *
 * FBO-based Gray-Scott reaction-diffusion simulation.
 * Buffer format: vec4(A, B, 0.0, 1.0) where RG = chemical concentrations.
 *
 * Simulation is run at 512x512 in a ping-pong double FBO.
 * Display pass renders to the full canvas viewport.
 * `speed` parameter controls sim steps per frame (1-8).
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TuringConfig } from '../shader-config';
import { TURING_DISPLAY_FRAG } from '../shaders/turing-display.frag';
import { TURING_SIM_FRAG } from '../shaders/turing-sim.frag';
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

/** Turing init fragment shader — A=1, B=0 everywhere (homogeneous steady state). */
const TURING_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }
`;

/** Uniform name lists for type-safe location lookup. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uFeed',
  'uKill',
  'uDa',
  'uDb',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uSeedPos',
] as const;

const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uTime',
] as const;

/** Simple hash for random seeding positions. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function createTuringRenderer(): ShaderRenderer {
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

  /** Timestamp (seconds) of last ambient seed. */
  let lastAmbientTime = 0;

  /** Next ambient seed interval (randomized between 3-6s). */
  let nextAmbientInterval = 3.0 + Math.random() * 3.0;

  /** Active click burst animations. */
  let clickBursts: Array<{
    x: number;
    y: number;
    frames: number;
  }> = [];

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    seedX: number,
    seedY: number,
    cfg: TuringConfig
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
    gl.uniform1f(simU.uFeed, cfg.feed);
    gl.uniform1f(simU.uKill, cfg.kill);
    gl.uniform1f(simU.uDa, cfg.da);
    gl.uniform1f(simU.uDb, cfg.db);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform2f(simU.uSeedPos, seedX, seedY);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, TURING_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, TURING_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, TURING_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize and seed
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

      const cfg = config as TuringConfig;
      const stepsPerFrame = Math.max(1, Math.min(8, cfg.speed));

      // ── Ambient seeds (every 3-6s) ────────────────────────────
      let ambSeedX = -10.0;
      let ambSeedY = -10.0;

      if (time - lastAmbientTime > nextAmbientInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 3.0 + Math.random() * 3.0;
        ambSeedX = 0.15 + Math.random() * 0.7;
        ambSeedY = 0.15 + Math.random() * 0.7;
      }

      // ── Click bursts: large seed of B ─────────────────────────
      if (mouse.burstStrength > 0) {
        clickBursts.push({
          x: mouse.x,
          y: mouse.y,
          frames: 0,
        });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const burst = clickBursts[i];
        if (burst.frames < 6) {
          const str = 3.0 * (1.0 - burst.frames / 6.0);
          stepSim(gl, time, burst.x, burst.y, true, str, -10.0, -10.0, cfg);
          burst.frames++;
        } else {
          clickBursts.splice(i, 1);
        }
      }

      // ── Main simulation steps ─────────────────────────────────
      for (let s = 0; s < stepsPerFrame; s++) {
        // First step includes mouse + ambient, rest are coast steps
        if (s === 0) {
          stepSim(
            gl,
            time,
            mouse.active ? mouse.x : -10.0,
            mouse.active ? mouse.y : -10.0,
            mouse.active,
            1.0,
            ambSeedX,
            ambSeedY,
            cfg
          );
        } else {
          stepSim(gl, time, -10.0, -10.0, false, 0.0, -10.0, -10.0, cfg);
        }
      }

      // ── Display pass ───────────────────────────────────────────
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

      lastAmbientTime = 0;
      nextAmbientInterval = 3.0 + Math.random() * 3.0;
      clickBursts = [];

      // Initialize both FBO sides to A=1, B=0 (homogeneous state)
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Seed random B spots to nucleate pattern formation
      if (!simProg || !simU) return;

      const seedCount = 8 + Math.floor(Math.random() * 5);
      const baseSeed = performance.now();

      for (let i = 0; i < seedCount; i++) {
        const sx = 0.15 + pseudoRandom(baseSeed + i * 7.3) * 0.7;
        const sy = 0.15 + pseudoRandom(baseSeed + i * 13.1 + 100.0) * 0.7;

        gl.viewport(0, 0, SIM_RES, SIM_RES);
        gl.useProgram(simProg);
        quad.bind(simProg);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
        gl.uniform1i(simU.uState, 0);

        const tx = 1.0 / SIM_RES;
        gl.uniform2f(simU.uTexel, tx, tx);
        gl.uniform1f(simU.uFeed, 0.055);
        gl.uniform1f(simU.uKill, 0.062);
        gl.uniform1f(simU.uDa, 1.0);
        gl.uniform1f(simU.uDb, 0.5);
        gl.uniform1f(simU.uTime, 0.0);
        gl.uniform2f(simU.uMouse, -10.0, -10.0);
        gl.uniform1f(simU.uMouseActive, 0.0);
        gl.uniform1f(simU.uMouseStrength, 0.0);
        gl.uniform2f(simU.uSeedPos, sx, sy);

        gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
        drawQuad(gl);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        simBuf.swap();
      }

      // Warm-up: run 60 coast steps to let pattern begin forming
      for (let w = 0; w < 60; w++) {
        gl.viewport(0, 0, SIM_RES, SIM_RES);
        gl.useProgram(simProg);
        quad.bind(simProg);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
        gl.uniform1i(simU.uState, 0);

        const tx = 1.0 / SIM_RES;
        gl.uniform2f(simU.uTexel, tx, tx);
        gl.uniform1f(simU.uFeed, 0.055);
        gl.uniform1f(simU.uKill, 0.062);
        gl.uniform1f(simU.uDa, 1.0);
        gl.uniform1f(simU.uDb, 0.5);
        gl.uniform1f(simU.uTime, 0.0);
        gl.uniform2f(simU.uMouse, -10.0, -10.0);
        gl.uniform1f(simU.uMouseActive, 0.0);
        gl.uniform1f(simU.uMouseStrength, 0.0);
        gl.uniform2f(simU.uSeedPos, -10.0, -10.0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
        drawQuad(gl);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        simBuf.swap();
      }
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
      clickBursts = [];
    },
  };
}
