/**
 * Frost renderer — Ice crystal dendrite growth (2-pass FBO).
 *
 * Ping-pong FBO (512x512): R = frozen state, G = diffusion field, B = freeze age.
 * DLA-inspired crystal growth with anisotropic branching (N-fold symmetry).
 * Mouse acts as heat source that melts frozen regions.
 * Click plants a new seed crystal. Ambient seeds spawn every 5-10s.
 * Two substeps per frame for smoother crystal evolution.
 *
 * Display pass renders frozen crystals with age-based colour transition
 * and growth front glow on newly frozen edges.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { FROST_DISPLAY_FRAG } from '../shaders/frost-display.frag';
import { FROST_SIM_FRAG } from '../shaders/frost-sim.frag';
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

interface FrostCfg {
  growth?: number;
  branch?: number;
  symmetry?: number;
  melt?: number;
  glow?: number;
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

/** Init shader — all liquid, low ambient diffusion. */
const FROST_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // R=0 (liquid), G=0.1 (low ambient diffusion), B=0 (no age), A=1
  fragColor = vec4(0.0, 0.1, 0.0, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uGrowth',
  'uBranch',
  'uSymmetry',
  'uMelt',
  'uTime',
  'uDt',
  'uMouse',
  'uMouseActive',
  'uSeedPos',
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
  'uGlow',
  'uTime',
] as const;

const DEFAULTS = {
  growth: 0.6,
  branch: 0.3,
  symmetry: 6,
  melt: 1.0,
  glow: 0.8,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createFrostRenderer(): ShaderRenderer {
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
  let lastSeedTime = 0;
  /** Next ambient seed interval (randomised 5-10s). */
  let nextSeedInterval = 5.0 + Math.random() * 5.0;
  /** Timestamp (seconds) of previous render() call. -1 sentinel = first frame. */
  let lastRenderTime = -1;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    dt: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    seedX: number,
    seedY: number,
    cfg: FrostCfg
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
    gl.uniform1f(simU.uGrowth, cfg.growth ?? DEFAULTS.growth);
    gl.uniform1f(simU.uBranch, cfg.branch ?? DEFAULTS.branch);
    gl.uniform1i(simU.uSymmetry, Math.round(cfg.symmetry ?? DEFAULTS.symmetry));
    gl.uniform1f(simU.uMelt, cfg.melt ?? DEFAULTS.melt);
    gl.uniform1f(simU.uTime, time);
    gl.uniform1f(simU.uDt, dt);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
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
      initProg = createProgram(gl, VERTEX_SHADER, FROST_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, FROST_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, FROST_DISPLAY_FRAG);

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
      height: number,
      audio?: AudioState
    ): void {
      if (!simProg || !displayProg || !simU || !displayU || !simBuf || !quad)
        return;

      const cfg = config as unknown as FrostCfg;
      const amp = audio?.amplitude ?? 0;

      // Frame-rate-independent dt for the sim shader. Clamped to 0.1s to
      // match the ShaderHero RAF loop's clamp and avoid a single huge step
      // after a tab-hidden → visible transition. -1 sentinel on first frame
      // after reset yields a conservative 1/60s seed (avoids zero-decay on
      // the very first step after the loop resumes).
      const dt =
        lastRenderTime < 0 ? 1 / 60 : Math.min(time - lastRenderTime, 0.1);
      lastRenderTime = time;

      // ── Ambient seed (every 5-10s) ──────────────────────────
      let seedX = -10.0;
      let seedY = -10.0;
      if (time - lastSeedTime > nextSeedInterval) {
        lastSeedTime = time;
        nextSeedInterval = 5.0 + Math.random() * 5.0;
        seedX = 0.15 + Math.random() * 0.7;
        seedY = 0.15 + Math.random() * 0.7;
      }

      // ── Click seed ──────────────────────────────────────────
      if (mouse.burstStrength > 0) {
        seedX = mouse.x;
        seedY = mouse.y;
      }

      // ── Substep 1: with input (mouse melt + seed) ──────────
      // Both substeps use the full frame `dt`. At 60fps this preserves the
      // original 0.995 × 0.995 = 0.990 per-frame decay; at other refresh
      // rates the two pow(0.995, dt*60) multiplications compensate so the
      // per-wall-clock-second decay stays constant.
      stepSim(
        gl,
        time,
        dt,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        seedX,
        seedY,
        cfg
      );

      // ── Substep 2: coast (no input, no seed) ────────────────
      stepSim(gl, time, dt, -10.0, -10.0, false, -10.0, -10.0, cfg);

      // ── Display pass ────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Immersive colour cycling when audio is active
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
      gl.uniform1f(displayU.uGlow, (cfg.glow ?? DEFAULTS.glow) + amp * 0.1);
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
      nextSeedInterval = 5.0 + Math.random() * 5.0;
      lastRenderTime = -1;

      // Clear both FBO sides with init shader
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Seed initial crystal points for immediate visual interest
      const seedCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < seedCount; i++) {
        const sx = 0.2 + Math.random() * 0.6;
        const sy = 0.2 + Math.random() * 0.6;
        // Run a sim step with seed to plant crystal point.
        // dt=0 → pow(0.995, 0) = 1.0 (no decay during seed-planting).
        stepSim(gl, 0, 0, -10.0, -10.0, false, sx, sy, {
          growth: DEFAULTS.growth,
          branch: DEFAULTS.branch,
          symmetry: DEFAULTS.symmetry,
          melt: DEFAULTS.melt,
          colors: {
            primary: [0.5, 0.5, 0.5],
            secondary: [0.5, 0.5, 0.5],
            accent: [0.5, 0.5, 0.5],
            bg: [0.05, 0.05, 0.05],
          },
        });
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
