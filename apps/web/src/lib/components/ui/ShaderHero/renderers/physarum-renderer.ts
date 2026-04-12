/**
 * Physarum renderer — Slime mould pheromone network (2-pass FBO).
 *
 * Ping-pong FBO (512x512): R = trail density, G = agent heading.
 * Implicit agent simulation: ~25% of texels act as agents per frame.
 * Agents sense + deposit trail, creating self-reinforcing network paths.
 * Mouse acts as pheromone attractor. Ambient food sources every 2-4s.
 * Two substeps per frame for smoother network evolution.
 *
 * Display pass maps trail density to brand colour gradient with
 * edge glow and pulsing node highlights.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { PHYSARUM_DISPLAY_FRAG } from '../shaders/physarum-display.frag';
import { PHYSARUM_SIM_FRAG } from '../shaders/physarum-sim.frag';
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

interface PhysarumCfg {
  diffusion?: number;
  decay?: number;
  deposit?: number;
  sensor?: number;
  turn?: number;
  intensity?: number;
  grain?: number;
  vignette?: number;
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
    bg: [number, number, number];
  };
}

/** Init shader: seeds trail with scattered food sources + random headings. */
const PHYSARUM_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Seed trail with scattered food sources to kick-start network formation
  float h = hash21(v_uv * 64.0);
  float trail = step(0.85, h) * 0.5; // ~15% of texels get initial trail deposit

  // Random heading for each texel-agent
  float heading = hash21(v_uv * 128.0 + 42.0);

  fragColor = vec4(trail, heading, 0.0, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDiffusion',
  'uDecay',
  'uDeposit',
  'uSensor',
  'uTurn',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uDropPos',
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
  'uTime',
] as const;

const DEFAULTS = {
  diffusion: 1.0,
  decay: 0.98,
  deposit: 1.0,
  sensor: 0.03,
  turn: 0.25,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createPhysarumRenderer(): ShaderRenderer {
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

  /** Timestamp (seconds) of last ambient drop. */
  let lastAmbientTime = 0;
  /** Next ambient interval (randomised). */
  let nextAmbientInterval = 2.0 + Math.random() * 2.0;

  /** Active click burst animations. */
  let clickBursts: Array<{ x: number; y: number; frames: number }> = [];

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    dropX: number,
    dropY: number,
    cfg: PhysarumCfg
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
    gl.uniform1f(simU.uDiffusion, cfg.diffusion ?? DEFAULTS.diffusion);
    gl.uniform1f(simU.uDecay, cfg.decay ?? DEFAULTS.decay);
    gl.uniform1f(simU.uDeposit, cfg.deposit ?? DEFAULTS.deposit);
    gl.uniform1f(simU.uSensor, cfg.sensor ?? DEFAULTS.sensor);
    gl.uniform1f(simU.uTurn, cfg.turn ?? DEFAULTS.turn);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform2f(simU.uDropPos, dropX, dropY);

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
      initProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_DISPLAY_FRAG);

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

      const cfg = config as unknown as PhysarumCfg;

      // ── Ambient food source (every 2-4s) ───────────────────
      let dropX = -10.0;
      let dropY = -10.0;
      if (time - lastAmbientTime > nextAmbientInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 2.0 + Math.random() * 2.0;
        dropX = 0.15 + Math.random() * 0.7;
        dropY = 0.15 + Math.random() * 0.7;
      }

      // ── Click bursts: large concentrated deposit ───────────
      if (mouse.burstStrength > 0) {
        clickBursts.push({ x: mouse.x, y: mouse.y, frames: 0 });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const sp = clickBursts[i];
        if (sp.frames < 6) {
          const str = 3.0 * (1.0 - sp.frames / 6.0);
          stepSim(gl, time, sp.x, sp.y, true, str, -10.0, -10.0, cfg);
          sp.frames++;
        } else {
          clickBursts.splice(i, 1);
        }
      }

      // ── Substep 1: with mouse + ambient input ─────────────
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        1.0,
        dropX,
        dropY,
        cfg
      );

      // ── Substep 2: coast (no input) ────────────────────────
      stepSim(gl, time, -10.0, -10.0, false, 0.0, -10.0, -10.0, cfg);

      // ── Display pass ───────────────────────────────────────
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
      gl.uniform1f(displayU.uIntensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(displayU.uVignette, cfg.vignette ?? DEFAULTS.vignette);
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
      nextAmbientInterval = 2.0 + Math.random() * 2.0;
      clickBursts = [];

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Seed both FBO sides with initial trail + headings
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
      clickBursts = [];
    },
  };
}
