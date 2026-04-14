/**
 * Ink Dispersion renderer — implements ShaderRenderer.
 *
 * 3-channel advection-diffusion ink effect with ping-pong FBO simulation.
 * Buffer format: vec4(inkR, inkG, inkB, 1.0) where RGB = concentrations
 * of primary/secondary/accent brand-colored ink.
 *
 * Simulation is run at 512x512 in a ping-pong double FBO.
 * Display pass renders to the full canvas viewport.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { InkConfig, ShaderConfig } from '../shader-config';
import { INK_DISPLAY_FRAG } from '../shaders/ink-display.frag';
import { INK_SIM_FRAG } from '../shaders/ink-sim.frag';
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

/** Ink init fragment shader — clear liquid (all zeros). */
const INK_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

/** Uniform name lists for type-safe location lookup. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDiffusion',
  'uAdvection',
  'uDropSize',
  'uEvaporation',
  'uCurl',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uInkChannel',
  'uDropPos',
  'uDropChannel',
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

export function createInkRenderer(): ShaderRenderer {
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

  /** Next ambient drop interval (randomized between 2-3.5s). */
  let nextAmbientInterval = 2.0 + Math.random() * 1.5;

  /** Current rotating channel for mouse hover deposits (0, 1, 2). */
  let hoverChannel = 0;

  /** Frame counter for rotating hover channel. */
  let hoverFrameCounter = 0;

  /** Current rotating channel for ambient drops (0, 1, 2). */
  let ambientChannel = 0;

  /** Active click burst animations. */
  let clickBursts: Array<{
    x: number;
    y: number;
    frames: number;
    offsets: Array<{ dx: number; dy: number; channel: number }>;
  }> = [];

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    inkChannel: number,
    dropX: number,
    dropY: number,
    dropChannel: number,
    cfg: InkConfig
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
    gl.uniform1f(simU.uDiffusion, cfg.diffusion);
    gl.uniform1f(simU.uAdvection, cfg.advection);
    gl.uniform1f(simU.uDropSize, cfg.dropSize);
    gl.uniform1f(simU.uEvaporation, cfg.evaporation);
    gl.uniform1f(simU.uCurl, cfg.curl);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform1f(simU.uInkChannel, inkChannel);
    gl.uniform2f(simU.uDropPos, dropX, dropY);
    gl.uniform1f(simU.uDropChannel, dropChannel);

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
      initProg = createProgram(gl, VERTEX_SHADER, INK_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, INK_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, INK_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize to clear liquid
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

      const cfg = config as InkConfig;
      const amp = audio?.amplitude ?? 0;
      const bass = audio?.bass ?? 0;

      // ── Rotate hover channel every ~45 frames ──────────────
      hoverFrameCounter++;
      if (hoverFrameCounter >= 45) {
        hoverFrameCounter = 0;
        hoverChannel = (hoverChannel + 1) % 3;
      }

      // ── Ambient drops — gently more frequent with audio ────
      let ambDropX = -10.0;
      let ambDropY = -10.0;
      let ambDropCh = 0;

      const effectiveInterval = audio?.active
        ? Math.max(0.8, nextAmbientInterval - amp * 1.0)
        : nextAmbientInterval;

      if (time - lastAmbientTime > effectiveInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 2.0 + Math.random() * 1.5;
        ambDropX = 0.15 + Math.random() * 0.7;
        ambDropY = 0.15 + Math.random() * 0.7;
        ambDropCh = ambientChannel;
        ambientChannel = (ambientChannel + 1) % 3;
      }

      // ── Gentle bass-driven ink drops ───────────────────────
      if (audio?.active && bass > 0.5) {
        const bx = 0.2 + Math.random() * 0.6;
        const by = 0.2 + Math.random() * 0.6;
        const bCh = Math.floor(Math.random() * 3);
        stepSim(
          gl,
          time,
          bx,
          by,
          true,
          0.5 + bass * 0.5,
          bCh,
          -10.0,
          -10.0,
          0,
          cfg
        );
      }

      // ── Click bursts: 3 offset deposits (one per channel) ─
      if (mouse.burstStrength > 0) {
        const spread = cfg.dropSize * 2.5;
        clickBursts.push({
          x: mouse.x,
          y: mouse.y,
          frames: 0,
          offsets: [
            { dx: 0, dy: 0, channel: 0 },
            { dx: spread, dy: -spread * 0.5, channel: 1 },
            { dx: -spread, dy: spread * 0.5, channel: 2 },
          ],
        });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const burst = clickBursts[i];
        if (burst.frames < 5) {
          const str = 2.5 * (1.0 - burst.frames / 5.0);
          // Deposit one offset per frame, cycling through the 3 channels
          const offsetIdx = burst.frames % burst.offsets.length;
          const off = burst.offsets[offsetIdx];
          stepSim(
            gl,
            time,
            burst.x + off.dx,
            burst.y + off.dy,
            true,
            str,
            off.channel,
            -10.0,
            -10.0,
            0,
            cfg
          );
          burst.frames++;
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
        hoverChannel,
        ambDropX,
        ambDropY,
        ambDropCh,
        cfg
      );

      // ── Substep 2: coast (no input) ───────────────────────
      stepSim(gl, time, -10.0, -10.0, false, 0.0, 0, -10.0, -10.0, 0, cfg);

      // ── Display pass ───────────────────────────────────────
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
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(displayU.uVignette, audio?.active ? 0.0 : cfg.vignette);
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
      nextAmbientInterval = 2.0 + Math.random() * 1.5;
      hoverChannel = 0;
      hoverFrameCounter = 0;
      ambientChannel = 0;
      clickBursts = [];

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Zero out both FBO sides (clear liquid)
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
