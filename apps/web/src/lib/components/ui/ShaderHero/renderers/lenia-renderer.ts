/**
 * Lenia (Advanced Continuous Cellular Automata) renderer — implements ShaderRenderer.
 *
 * Bump-function kernel convolution + Gaussian growth function.
 * Ping-pong FBO at 256x256 (lower res due to expensive kernel).
 * Three programs: init (Gaussian blob seeds), sim (kernel convolution + growth),
 * display (multi-stop colour ramp with concentric zone mapping).
 *
 * `speed` substeps per frame (1-4, default 2).
 * Init seeds smooth circular Gaussian blobs (NOT hash noise).
 * Reset includes 50-step warm-up for creature formation.
 * Ambient deposits every 4-7s to inject diversity.
 * Click deposits large life blob that may grow into new creature.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
import type { LeniaConfig, ShaderConfig } from '../shader-config';
import { LENIA_DISPLAY_FRAG } from '../shaders/lenia-display.frag';
import { LENIA_SIM_FRAG } from '../shaders/lenia-sim.frag';
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

const SIM_RES = 256; // Lower res than ink/turing due to expensive kernel

// Frame-rate-independent click-burst lifespan (docs/04-motion.md §4).
// Old per-frame counter (`b.frame++` with `b.frame < 5`) made clicks visibly
// live for 5 frames — 83ms on 60Hz, 42ms on 120Hz, 167ms on throttled 30Hz.
// Switching to elapsed-time lets wall-clock duration stay constant regardless
// of refresh rate. Value tuned to match the previous 5-frames-at-60fps feel.
const BURST_LIFETIME_SECONDS = 5 / 60;

/** Init fragment shader — smooth Gaussian blobs for Lenia-appropriate seeding. */
const LENIA_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float alive = 0.0;

  // Place ~12 smooth Gaussian blobs at pseudo-random positions
  for (float i = 0.0; i < 12.0; i += 1.0) {
    vec2 center = vec2(
      0.15 + hash21(vec2(i * 7.3, 13.1)) * 0.7,
      0.15 + hash21(vec2(i * 13.1 + 100.0, i * 3.7)) * 0.7
    );
    float blobRadius = 0.03 + hash21(vec2(i * 29.3, i * 17.7)) * 0.05;
    vec2 d = v_uv - center;
    float g = exp(-dot(d, d) / (blobRadius * blobRadius));
    alive += g;
  }

  alive = clamp(alive, 0.0, 1.0);
  fragColor = vec4(alive, 0.0, 0.0, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uRadius',
  'uGrowth',
  'uWidth',
  'uDt',
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

export function createLeniaRenderer(): ShaderRenderer {
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

  /** Timestamp of last ambient deposit. */
  let lastAmbientTime = 0;
  /** Next ambient deposit interval (4-7s). */
  let nextAmbientInterval = 4.0 + Math.random() * 3.0;

  /** Active click burst animations. */
  let clickBursts: Array<{ x: number; y: number; age: number }> = [];

  /** Previous render() timestamp (seconds). Used for dt computation. */
  let lastTime = 0;

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
    cfg: LeniaConfig
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
    gl.uniform1f(simU.uRadius, cfg.radius);
    gl.uniform1f(simU.uGrowth, cfg.growth);
    gl.uniform1f(simU.uWidth, cfg.width);
    gl.uniform1f(simU.uDt, cfg.dt);
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
      // Check required extensions for RGBA16F FBO
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, LENIA_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, LENIA_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, LENIA_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Seed initial state (with warm-up)
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

      // Elapsed-time delta, clamped to 0.1s to survive pauses (tab hidden,
      // preset switch, reduced-motion resume). First frame after a pause
      // would otherwise see a multi-second dt and collapse burst lifetimes
      // instantly.
      const dt = Math.min(time - lastTime, 0.1);
      lastTime = time;

      const cfg = config as LeniaConfig;
      const steps = Math.round(cfg.speed ?? 2);

      // ── Ambient deposit (every 4-7s) ────────────────────────
      let dropX = -10.0,
        dropY = -10.0;
      if (time - lastAmbientTime > nextAmbientInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 4.0 + Math.random() * 3.0;
        dropX = 0.15 + Math.random() * 0.7;
        dropY = 0.15 + Math.random() * 0.7;
      }

      // ── Click bursts: deposit large blob over BURST_LIFETIME_SECONDS ──
      if (mouse.burstStrength > 0) {
        clickBursts.push({ x: mouse.x, y: mouse.y, age: 0 });
      }

      // ── Sim steps ───────────────────────────────────────────
      for (let s = 0; s < steps; s++) {
        // Determine mouse and drop for this step
        let mx = -10.0,
          my = -10.0,
          mStr = 0.0;
        let dx = -10.0,
          dy = -10.0;

        // Only apply mouse/drops on first step
        if (s === 0) {
          if (mouse.active) {
            mx = mouse.x;
            my = mouse.y;
            mStr = 0.3;
          }

          // Click burst processing — age each burst by dt; retire when
          // elapsed ≥ BURST_LIFETIME_SECONDS. Frame-rate independent.
          for (let i = clickBursts.length - 1; i >= 0; i--) {
            const b = clickBursts[i];
            if (b.age < BURST_LIFETIME_SECONDS) {
              mx = b.x;
              my = b.y;
              mStr = 0.6 * Math.max(0, 1 - b.age / BURST_LIFETIME_SECONDS); // Decaying strength
              b.age += dt;
            } else {
              clickBursts.splice(i, 1);
            }
          }

          dx = dropX;
          dy = dropY;
        }

        stepSim(gl, time, mx, my, mx > -5.0, mStr, dx, dy, cfg);
      }

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
      gl.uniform1f(displayU.uTime, time);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 256x256.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastAmbientTime = 0;
      lastTime = 0;
      nextAmbientInterval = 4.0 + Math.random() * 3.0;
      clickBursts = [];

      // Seed both FBO sides with initial Gaussian blobs
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Warm-up: run 50 coast steps to let organisms form
      if (!simProg || !simU) return;

      for (let w = 0; w < 50; w++) {
        gl.viewport(0, 0, SIM_RES, SIM_RES);
        gl.useProgram(simProg);
        quad.bind(simProg);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
        gl.uniform1i(simU.uState, 0);

        const tx = 1.0 / SIM_RES;
        gl.uniform2f(simU.uTexel, tx, tx);
        gl.uniform1f(simU.uRadius, 13.0); // default radius
        gl.uniform1f(simU.uGrowth, 0.14); // default growth centre
        gl.uniform1f(simU.uWidth, 0.04); // wider for stable warm-up
        gl.uniform1f(simU.uDt, 0.2); // default dt
        gl.uniform1f(simU.uTime, 0.0);
        gl.uniform2f(simU.uMouse, -10.0, -10.0);
        gl.uniform1f(simU.uMouseActive, 0.0);
        gl.uniform1f(simU.uMouseStrength, 0.0);
        gl.uniform2f(simU.uDropPos, -10.0, -10.0);

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
