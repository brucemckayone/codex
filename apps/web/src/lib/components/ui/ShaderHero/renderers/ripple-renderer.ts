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

      // ── Ambient drips — more frequent with audio ───────────
      const ambientInterval = audio?.active
        ? Math.max(0.2, 1.2 - bass * 1.0)
        : 2.5 + Math.random() * 1.5;
      if (time - lastAmbientTime > ambientInterval) {
        lastAmbientTime = time;
        const ax = 0.15 + Math.random() * 0.7;
        const ay = 0.15 + Math.random() * 0.7;
        const strength = audio?.active ? 0.6 + bass * 2.5 : 0.6;
        stepSim(gl, ax, ay, true, strength, cfg);
      }

      // ── Bass-driven extra impulses ─────────────────────────
      if (audio?.active && bass > 0.35) {
        stepSim(
          gl,
          0.2 + Math.random() * 0.6,
          0.2 + Math.random() * 0.6,
          true,
          bass * 4.0,
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

      // ── Audio-reactive colour mixing ─────────────────────────
      // In immersive mode, colours shift freely with audio:
      // - Bass blends primary toward accent
      // - Treble blends secondary toward a hue-rotated primary
      // - Mids brighten the background slightly
      const p = cfg.colors.primary;
      const s = cfg.colors.secondary;
      const a = cfg.colors.accent;
      const bg = cfg.colors.bg;

      if (audio?.active) {
        // Bass: primary shifts toward accent
        const bMix = bass * 0.6;
        gl.uniform3f(
          displayU.uColorPrimary,
          p[0] * (1 - bMix) + a[0] * bMix,
          p[1] * (1 - bMix) + a[1] * bMix,
          p[2] * (1 - bMix) + a[2] * bMix
        );
        // Treble: secondary shifts toward complementary of primary
        const tMix = (audio.treble ?? 0) * 0.5;
        gl.uniform3f(
          displayU.uColorSecondary,
          s[0] * (1 - tMix) + (1 - p[0]) * tMix,
          s[1] * (1 - tMix) + (1 - p[1]) * tMix,
          s[2] * (1 - tMix) + (1 - p[2]) * tMix
        );
        // Accent gets boosted saturation with amplitude
        const aSat = 1 + amplitude * 0.8;
        gl.uniform3f(
          displayU.uColorAccent,
          Math.min(1, a[0] * aSat),
          Math.min(1, a[1] * aSat),
          Math.min(1, a[2] * aSat)
        );
        // Background lightens subtly with mids
        const mBright = (audio.mids ?? 0) * 0.15;
        gl.uniform3f(
          displayU.uBgColor,
          Math.min(1, bg[0] + mBright),
          Math.min(1, bg[1] + mBright),
          Math.min(1, bg[2] + mBright)
        );
      } else {
        gl.uniform3fv(displayU.uColorPrimary, p);
        gl.uniform3fv(displayU.uColorSecondary, s);
        gl.uniform3fv(displayU.uColorAccent, a);
        gl.uniform3fv(displayU.uBgColor, bg);
      }

      gl.uniform1f(
        displayU.uIntensity,
        cfg.intensity * (1.0 + amplitude * 0.5)
      );
      gl.uniform1f(
        displayU.uRefraction,
        (cfg.refraction ?? DEFAULT_REFRACTION) * (1.0 + bass * 1.5)
      );
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(
        displayU.uVignette,
        Math.max(0, cfg.vignette - amplitude * 0.1)
      );
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
