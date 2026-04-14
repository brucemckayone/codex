/**
 * Plasma renderer — PIC fluid + slime mold iridescent density bands (2-pass FBO).
 *
 * Ping-pong FBO (512x512): RG = velocity, B = density, A = trail.
 * Semi-Lagrangian advection with pressure forces, slime-mold angular
 * sensors for self-organising flow patterns, and density normalization.
 * Mouse injects vortex force; click burst deposits density spike.
 * Two substeps per frame for smoother evolution.
 *
 * Display pass maps density cubed through sin() bands to create
 * iridescent spectral coloring, remapped to brand palette.
 *
 * Inspired by Shadertoy Wt2BR1 (michael0884's "Fireballs").
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { PlasmaConfig, ShaderConfig } from '../shader-config';
import { PLASMA_DISPLAY_FRAG } from '../shaders/plasma-display.frag';
import { PLASMA_SIM_FRAG } from '../shaders/plasma-sim.frag';
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

/**
 * Init shader: faithful to original Wt2BR1 initial condition.
 * Two counter-rotating vortices + random grid kicks + density gradient.
 * Velocity is in TEXEL units per frame (not UV units).
 */
const PLASMA_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

#define PI 3.14159265
#define R 512.0

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 pos = v_uv * R; // pixel coordinates

  // Two counter-rotating vortices (from original init)
  // V = 0.5*Rot(PI/2)*dx*GS(dx/30)
  vec2 dx0 = pos - vec2(R * 0.3);
  vec2 dx1 = pos - vec2(R * 0.7);
  vec2 V = 0.5 * vec2(-dx0.y, dx0.x) * exp(-dot(dx0, dx0) / 900.0)
         - 0.5 * vec2(-dx1.y, dx1.x) * exp(-dot(dx1, dx1) / 900.0);

  // Random grid kicks (original: 0.2*Dir(2*PI*hash(floor(pos/20))))
  float h = hash21(floor(pos / 20.0));
  V += 0.2 * vec2(cos(2.0 * PI * h), sin(2.0 * PI * h));

  // Cap velocity to 1.0 texel/frame (original caps in force step)
  float spd = length(V);
  if (spd > 1.0) V /= spd;

  // Density: slight gradient (exact original formula)
  float M = 0.1 + v_uv.x * 0.01 + v_uv.y * 0.01;

  // A channel = smoothed density (same as M initially)
  fragColor = vec4(V, M, M);
}
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uBurst',
  'uSpeed',
  'uPressure',
  'uTurn',
  'uDiffusion',
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
  'uBands',
] as const;

const DEFAULTS = {
  speed: 0.8,
  bands: 25.0,
  pressure: 0.9,
  turn: 0.11,
  diffusion: 1.2,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createPlasmaRenderer(): ShaderRenderer {
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

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    burst: number,
    cfg: PlasmaConfig
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
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uBurst, burst);

    gl.uniform1f(simU.uSpeed, cfg.speed ?? DEFAULTS.speed);
    gl.uniform1f(simU.uPressure, cfg.pressure ?? DEFAULTS.pressure);
    gl.uniform1f(simU.uTurn, cfg.turn ?? DEFAULTS.turn);
    gl.uniform1f(simU.uDiffusion, cfg.diffusion ?? DEFAULTS.diffusion);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, PLASMA_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, PLASMA_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, PLASMA_DISPLAY_FRAG);

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
      height: number,
      audio?: AudioState
    ): void {
      if (!simProg || !displayProg || !simU || !displayU || !simBuf || !quad)
        return;

      const cfg = config as PlasmaConfig;
      const amp = audio?.amplitude ?? 0;
      const mids = audio?.mids ?? 0;

      // Audio-modulated config for sim — gentle speed boost
      const audioCfg = audio?.active
        ? {
            ...cfg,
            speed: (cfg.speed ?? DEFAULTS.speed) + amp * 0.2,
          }
        : cfg;

      // ── Substep 1: with mouse input ───────────────────────
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        mouse.burstStrength ?? 0.0,
        audioCfg
      );

      // ── Substep 2: coast (no input) ───────────────────────
      stepSim(gl, time, -10.0, -10.0, false, 0.0, audioCfg);

      // ── Display pass ──────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Immersive colour cycling
      const colours = audio?.active
        ? computeImmersiveColours(time, cfg.colors, amp)
        : cfg.colors;

      gl.uniform3fv(displayU.uColorPrimary, colours.primary);
      gl.uniform3fv(displayU.uColorSecondary, colours.secondary);
      gl.uniform3fv(displayU.uColorAccent, colours.accent);
      gl.uniform3fv(displayU.uBgColor, colours.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        displayU.uVignette,
        audio?.active ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );
      gl.uniform1f(displayU.uTime, time);
      gl.uniform1f(displayU.uBands, (cfg.bands ?? DEFAULTS.bands) + mids * 0.1);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Seed both FBO sides
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
