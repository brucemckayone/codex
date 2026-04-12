/**
 * Mycelium (Fungal Network Growth) renderer — implements ShaderRenderer.
 *
 * 2-pass FBO ping-pong at 512x512 for frontier-driven network growth.
 * Buffer: R = density, G = direction (encoded angle), B = age.
 * Two substeps per frame for smoother growth evolution.
 * Mouse attracts growth direction; click accelerates nearby frontier growth.
 * Ambient seeds every 4-8s spawn new growth origins.
 * reset() seeds 3-5 initial growth points for immediate visual interest.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { MyceliumConfig, ShaderConfig } from '../shader-config';
import { MYCELIUM_DISPLAY_FRAG } from '../shaders/mycelium-display.frag';
import { MYCELIUM_SIM_FRAG } from '../shaders/mycelium-sim.frag';
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

/** Init shader — empty field (all zeros). */
const MYCELIUM_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uGrowth',
  'uBranch',
  'uSpread',
  'uPulse',
  'uThickness',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseClick',
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
  'uPulse',
  'uTime',
] as const;

export function createMyceliumRenderer(): ShaderRenderer {
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

  let lastSeedTime = 0;
  let nextSeedInterval = 4.0 + Math.random() * 4.0;
  let clickStrength = 0;

  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseClick: number,
    seedX: number,
    seedY: number,
    cfg: MyceliumConfig
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
    gl.uniform1f(simU.uGrowth, cfg.growth);
    gl.uniform1f(simU.uBranch, cfg.branch);
    gl.uniform1f(simU.uSpread, cfg.spread);
    gl.uniform1f(simU.uPulse, cfg.pulse);
    gl.uniform1f(simU.uThickness, cfg.thickness);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseClick, mouseClick);
    gl.uniform2f(simU.uSeedPos, seedX, seedY);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, MYCELIUM_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, MYCELIUM_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, MYCELIUM_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

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

      const cfg = config as MyceliumConfig;

      // Track click burst strength
      if (mouse.burstStrength > 0.01) {
        clickStrength = mouse.burstStrength;
      } else {
        clickStrength *= 0.9;
        if (clickStrength < 0.01) clickStrength = 0;
      }

      // Ambient seed (every 4-8s)
      let seedX = -10.0;
      let seedY = -10.0;
      if (time - lastSeedTime > nextSeedInterval) {
        lastSeedTime = time;
        nextSeedInterval = 4.0 + Math.random() * 4.0;
        seedX = 0.15 + Math.random() * 0.7;
        seedY = 0.15 + Math.random() * 0.7;
      }

      // Substep 1: with mouse input + seed
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10,
        mouse.active ? mouse.y : -10,
        mouse.active,
        clickStrength,
        seedX,
        seedY,
        cfg
      );

      // Substep 2: coast (no click boost, no seed)
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10,
        mouse.active ? mouse.y : -10,
        mouse.active,
        0,
        -10,
        -10,
        cfg
      );

      // Display pass
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
      gl.uniform1f(displayU.uPulse, cfg.pulse);
      gl.uniform1f(displayU.uTime, time);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastSeedTime = 0;
      nextSeedInterval = 4.0 + Math.random() * 4.0;
      clickStrength = 0;

      // Clear both FBO sides to empty
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Seed initial growth points for immediate visual interest
      const seedCount = 3 + Math.floor(Math.random() * 3);
      const defaultCfg: MyceliumConfig = {
        preset: 'mycelium',
        intensity: 0.65,
        grain: 0.025,
        vignette: 0.2,
        colors: {
          primary: [0.5, 0.5, 0.5],
          secondary: [0.5, 0.5, 0.5],
          accent: [0.5, 0.5, 0.5],
          bg: [0.05, 0.05, 0.05],
        },
        growth: 0.5,
        branch: 0.25,
        spread: 1.0,
        pulse: 0.7,
        thickness: 1.0,
      };
      for (let i = 0; i < seedCount; i++) {
        const sx = 0.2 + Math.random() * 0.6;
        const sy = 0.2 + Math.random() * 0.6;
        stepSim(gl, 0, -10, -10, false, 0, sx, sy, defaultCfg);
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
    },
  };
}
