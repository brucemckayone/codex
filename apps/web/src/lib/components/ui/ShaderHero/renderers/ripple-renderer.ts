/**
 * Water Ripple renderer — implements ShaderRenderer.
 *
 * 2D wave equation with ping-pong FBO simulation.
 * Buffer format: vec4(height, previousHeight, 0, 0).
 * Display pass renders normal-mapped surface with Fresnel, refraction,
 * caustics, specular highlights, and brand gradient.
 *
 * Simulation is run at 512x512 in a ping-pong double FBO.
 * Display pass renders to the full canvas viewport.
 */

import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { RippleConfig, ShaderConfig } from '../shader-config';
import { RIPPLE_DISPLAY_FRAG } from '../shaders/ripple-display.frag';
import { RIPPLE_SIM_FRAG } from '../shaders/ripple-sim.frag';
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

/** Ripple init fragment shader — flat water (all zeros). */
const RIPPLE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

/** Default refraction strength (from prototype). */
const DEFAULT_REFRACTION = 0.5;

/** Default ripple size for mouse impulse (from prototype). */
const DEFAULT_RIPPLE_SIZE = 0.03;

/** Uniform name lists for type-safe location lookup. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uWaveSpeed',
  'uDamping',
  'uRippleSize',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
] as const;
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uRefraction',
  'uGrain',
  'uVignette',
  'uTime',
] as const;

export function createRippleRenderer(): ShaderRenderer {
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

  /** Timestamp (seconds) of last ambient drip. */
  let lastAmbientTime = 0;

  /** Active click splash animations. */
  let clickSplashes: Array<{ x: number; y: number; frames: number }> = [];

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    cfg: RippleConfig
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
    gl.uniform1f(simU.uWaveSpeed, cfg.waveSpeed);
    gl.uniform1f(simU.uDamping, cfg.damping);
    gl.uniform1f(simU.uRippleSize, cfg.rippleSize ?? DEFAULT_RIPPLE_SIZE);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);

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
      initProg = createProgram(gl, VERTEX_SHADER, RIPPLE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, RIPPLE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, RIPPLE_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize to flat water
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

      const cfg = config as RippleConfig;
      const bass = audio?.bass ?? 0;
      const amplitude = audio?.amplitude ?? 0;

      // ── Ambient drips — gently more frequent with audio ────
      const ambientInterval = audio?.active
        ? Math.max(0.8, 2.0 - amplitude * 0.8)
        : 2.5 + Math.random() * 1.5;
      if (time - lastAmbientTime > ambientInterval) {
        lastAmbientTime = time;
        const ax = 0.15 + Math.random() * 0.7;
        const ay = 0.15 + Math.random() * 0.7;
        const strength = audio?.active ? 0.4 + bass * 0.6 : 0.6;
        stepSim(gl, ax, ay, true, strength, cfg);
      }

      // ── Gentle bass-driven drips ───────────────────────────
      if (audio?.active && bass > 0.5) {
        stepSim(
          gl,
          0.2 + Math.random() * 0.6,
          0.2 + Math.random() * 0.6,
          true,
          0.5 + bass * 0.5,
          cfg
        );
      }

      // ── Click splashes: inject over several frames ─────────
      if (mouse.burstStrength > 0) {
        clickSplashes.push({ x: mouse.x, y: mouse.y, frames: 0 });
      }

      for (let i = clickSplashes.length - 1; i >= 0; i--) {
        const sp = clickSplashes[i];
        if (sp.frames < 6) {
          // Deposit at center with decreasing strength
          const str = 3.0 * (1.0 - sp.frames / 6.0);
          stepSim(gl, sp.x, sp.y, true, str, cfg);
          sp.frames++;
        } else {
          clickSplashes.splice(i, 1);
        }
      }

      // ── Normal sim step with hover ─────────────────────────
      stepSim(
        gl,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        1.0,
        cfg
      );

      // Extra substep for smoother wave propagation (matches prototype)
      stepSim(gl, -10.0, -10.0, false, 0.0, cfg);

      // ── Display pass ───────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      const tx = 1.0 / SIM_RES;
      gl.uniform2f(displayU.uTexel, tx, tx);

      // ── Immersive colour cycling ────────────────────────────
      // Colours drift continuously using time-based sinusoidal mixing
      // across all brand colours + complementary tones. Audio gently
      // nudges the phase but doesn't hard-drive it.
      const p = cfg.colors.primary;
      const s = cfg.colors.secondary;
      const a = cfg.colors.accent;
      const bg = cfg.colors.bg;

      if (audio?.active) {
        // Slow oscillating phases — each colour channel drifts at different rates
        const t = time;
        const phase1 = Math.sin(t * 0.3) * 0.5 + 0.5;
        const phase2 = Math.sin(t * 0.2 + 2.1) * 0.5 + 0.5;
        const phase3 = Math.sin(t * 0.15 + 4.2) * 0.5 + 0.5;

        // Audio nudges the phases slightly
        const audioShift = amplitude * 0.2;

        // Primary drifts between primary → accent → complement
        const comp = [1 - p[0], 1 - p[1], 1 - p[2]];
        const mix1 = phase1 + audioShift;
        gl.uniform3f(
          displayU.uColorPrimary,
          p[0] * (1 - mix1) + a[0] * mix1 * 0.6 + comp[0] * mix1 * 0.4,
          p[1] * (1 - mix1) + a[1] * mix1 * 0.6 + comp[1] * mix1 * 0.4,
          p[2] * (1 - mix1) + a[2] * mix1 * 0.6 + comp[2] * mix1 * 0.4
        );

        // Secondary drifts between secondary → primary → warm tone
        const warm = [0.95, 0.6, 0.3];
        const mix2 = phase2 + audioShift;
        gl.uniform3f(
          displayU.uColorSecondary,
          s[0] * (1 - mix2) + p[0] * mix2 * 0.5 + warm[0] * mix2 * 0.5,
          s[1] * (1 - mix2) + p[1] * mix2 * 0.5 + warm[1] * mix2 * 0.5,
          s[2] * (1 - mix2) + p[2] * mix2 * 0.5 + warm[2] * mix2 * 0.5
        );

        // Accent drifts between accent → cool tone → secondary
        const cool = [0.3, 0.5, 0.95];
        const mix3 = phase3 + audioShift;
        gl.uniform3f(
          displayU.uColorAccent,
          a[0] * (1 - mix3) + cool[0] * mix3 * 0.6 + s[0] * mix3 * 0.4,
          a[1] * (1 - mix3) + cool[1] * mix3 * 0.6 + s[1] * mix3 * 0.4,
          a[2] * (1 - mix3) + cool[2] * mix3 * 0.6 + s[2] * mix3 * 0.4
        );

        // Background slowly shifts between dark tones
        const bgPhase = Math.sin(t * 0.1) * 0.5 + 0.5;
        gl.uniform3f(
          displayU.uBgColor,
          bg[0] + bgPhase * 0.08 + bass * 0.04,
          bg[1] + bgPhase * 0.04,
          bg[2] + bgPhase * 0.06 + (audio.treble ?? 0) * 0.03
        );
      } else {
        gl.uniform3fv(displayU.uColorPrimary, p);
        gl.uniform3fv(displayU.uColorSecondary, s);
        gl.uniform3fv(displayU.uColorAccent, a);
        gl.uniform3fv(displayU.uBgColor, bg);
      }

      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(
        displayU.uRefraction,
        (cfg.refraction ?? DEFAULT_REFRACTION) * (1.0 + bass * 0.3)
      );
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(displayU.uVignette, 0.0);
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
      clickSplashes = [];

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Zero out both FBO sides (flat water)
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
      clickSplashes = [];
    },
  };
}
