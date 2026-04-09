/**
 * Suture Fluid renderer — implements ShaderRenderer.
 *
 * Faithful port of cornusammonis XddSRX (Shadertoy).
 * Single feedback buffer: vec3(velocity.x, velocity.y, divergence).
 * Self-sustaining via curl-rotation + divergence-pressure feedback.
 *
 * Simulation is run at 512x512 in a ping-pong double FBO.
 * Display pass renders to the full canvas viewport.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, SutureConfig } from '../shader-config';
import { SUTURE_DISPLAY_FRAG } from '../shaders/suture-display.frag';
import { SUTURE_SIM_FRAG } from '../shaders/suture-sim.frag';
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

/** Number of init frames to seed the noise field (matches original). */
const INIT_FRAMES = 10;

/** Suture init fragment shader — IQ's simplex noise. */
const SUTURE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform float uSeed;

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x+p.y)*K1);
  vec2 a = p - i + (i.x+i.y)*K2;
  vec2 o = step(a.yx, a.xy);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0*K2;
  vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
  vec3 n = h*h*h*h * vec3(dot(a,hash(i)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
  return dot(n, vec3(70.0));
}

void main() {
  vec2 p = 16.0 * v_uv + uSeed;
  fragColor = vec4(noise(p + 1.1), noise(p + 2.2), noise(p + 3.3), 0.0);
}
`;

/** Uniform name lists for type-safe location lookup. */
const INIT_UNIFORM_NAMES = ['uSeed'] as const;
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uCurlScale',
  'uAdvDist',
  'uMouse',
  'uMouseActive',
  'uForce',
] as const;
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorA',
  'uColorB',
  'uColorC',
  'uBgColor',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uTime',
] as const;

export function createSutureRenderer(): ShaderRenderer {
  let initProg: WebGLProgram | null = null;
  let simProg: WebGLProgram | null = null;
  let displayProg: WebGLProgram | null = null;

  let initU: Record<
    (typeof INIT_UNIFORM_NAMES)[number],
    WebGLUniformLocation | null
  > | null = null;
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

  /** Frame counter for the init seeding phase. */
  let frameNum = 0;

  /** Timestamp (seconds) of last ambient force injection. */
  let lastAmbientTime = 0;

  /** Active click burst animations. */
  let clickBursts: Array<{ x: number; y: number; frame: number }> = [];

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    force: number
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
    gl.uniform1f(simU.uCurlScale, _curlScale);
    gl.uniform1f(simU.uAdvDist, _advDist);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uForce, force);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  // Cached config values (updated each render call)
  let _curlScale = -0.6;
  let _advDist = 6.0;

  // ── Display pass helper ────────────────────────────────────
  function displayPass(
    gl: WebGL2RenderingContext,
    time: number,
    cfg: SutureConfig,
    width: number,
    height: number
  ): void {
    if (!displayProg || !displayU || !simBuf || !quad) return;

    gl.viewport(0, 0, width, height);
    gl.useProgram(displayProg);
    quad.bind(displayProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(displayU.uState, 0);

    gl.uniform3fv(displayU.uColorA, cfg.colors.primary);
    gl.uniform3fv(displayU.uColorB, cfg.colors.secondary);
    gl.uniform3fv(displayU.uColorC, cfg.colors.accent);
    gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
    gl.uniform1f(displayU.uIntensity, cfg.intensity);
    gl.uniform1f(displayU.uGrain, cfg.grain);
    gl.uniform1f(displayU.uVignette, cfg.vignette);
    gl.uniform1f(displayU.uTime, time);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    drawQuad(gl);
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, SUTURE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, SUTURE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, SUTURE_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      initU = getUniforms(gl, initProg, INIT_UNIFORM_NAMES);
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
      if (
        !initProg ||
        !simProg ||
        !displayProg ||
        !initU ||
        !simU ||
        !displayU ||
        !simBuf ||
        !quad
      )
        return;

      const cfg = config as SutureConfig;

      // Cache config values for stepSim
      _curlScale = -cfg.curl / 50.0;
      _advDist = cfg.dissipation > 0.98 ? 6.0 : 6.0 * (cfg.dissipation / 0.985);

      frameNum++;

      // ── Init seeding phase (first 10 frames) ───────────────
      if (frameNum <= INIT_FRAMES) {
        gl.viewport(0, 0, SIM_RES, SIM_RES);
        gl.useProgram(initProg);
        quad.bind(initProg);
        gl.uniform1f(initU.uSeed, Math.random() * 100.0 + frameNum);
        gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
        drawQuad(gl);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        simBuf.swap();

        // Display even during init
        displayPass(gl, time, cfg, width, height);
        return;
      }

      // ── Ambient force (every ~3.5 seconds) ─────────────────
      if (time - lastAmbientTime > 3.5) {
        lastAmbientTime = time;
        const ax = (0.15 + Math.random() * 0.7) * SIM_RES;
        const ay = (0.15 + Math.random() * 0.7) * SIM_RES;
        stepSim(
          gl,
          ax,
          ay,
          true,
          cfg.dissipation > 0.98 ? 1.0 : cfg.dissipation
        );
      }

      // ── Click bursts: 8 radial force injections ────────────
      if (mouse.burstStrength > 0) {
        const mx = mouse.x * SIM_RES;
        const my = mouse.y * SIM_RES;
        clickBursts.push({ x: mx, y: my, frame: 0 });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const b = clickBursts[i];
        if (b.frame < 8) {
          const angle = (b.frame / 8) * Math.PI * 2;
          const r = 20; // 20 sim-pixels radius
          const bx = b.x + Math.cos(angle) * r;
          const by = b.y + Math.sin(angle) * r;
          stepSim(gl, bx, by, true, 2.0);
          b.frame++;
        } else {
          clickBursts.splice(i, 1);
        }
      }

      // ── Normal sim step with hover ─────────────────────────
      const mouseX = mouse.active ? mouse.x * SIM_RES : -1000;
      const mouseY = mouse.active ? mouse.y * SIM_RES : -1000;
      stepSim(gl, mouseX, mouseY, mouse.active, 1.0);

      // ── Display pass ───────────────────────────────────────
      displayPass(gl, time, cfg, width, height);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !initU || !simBuf || !quad) return;

      frameNum = 0;
      lastAmbientTime = 0;
      clickBursts = [];

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);
      gl.uniform1f(initU.uSeed, Math.random() * 100.0);

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

      initU = null;
      simU = null;
      displayU = null;
      clickBursts = [];
    },
  };
}
