/**
 * Liquid Logo renderer (preset id 'pulse') — implements ShaderRenderer.
 *
 * 3D perspective raymarched wave surface based on tomkh's wave equation.
 * Sim runs at 512x512 in a ping-pong double FBO (identical physics to ripple).
 * The grid stays SQUARE: it is the plane in world space (90 x 90 units), seen
 * in perspective, not the canvas, so a canvas-shaped grid would stretch it.
 * It runs on the step clock (Codex-1yd58 WP-1d): 120 steps a second at any
 * frame rate, input on every second step. It ran a fixed number of steps
 * per frame (twice as fast at 120 Hz) and queued a click splash on every
 * frame of the click's decay. R2b: it starts still, and only the pointer
 * and the sound move it (no idle drops, no seed, no logo attractor).
 * Display pass raymarches the heightfield from a configurable camera angle.
 *
 * Optional logo SDF integration: when an org logo URL is present in the
 * shader config, the logo is converted to a signed distance field (SDF)
 * which the display pass raises into a still liquid relief (LOGO_HEIGHT)
 * the waves ride over. The sim never reads it.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  SILENT_AUDIO,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { createClickEdge } from '../click-edge';
import type { SDFResult } from '../jfa-sdf';
import { destroyLogoTexture, loadLogoTexture } from '../logo-texture';
import { bindOutput } from '../output-target';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { PulseConfig, ShaderConfig } from '../shader-config';
import { PULSE_DISPLAY_FRAG } from '../shaders/pulse-display.frag';
import { PULSE_SIM_FRAG } from '../shaders/pulse-sim.frag';
import { createStepClock, inputStride, SIM_BASE } from '../sim-grid';
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

/** The plane's grid: square, see above. */
const SIM_RES = SIM_BASE;
/** Steps a second: what pulse ran at 60 Hz (an input step and a coast step). */
const STEPS_PER_SECOND = 120;
const INPUT_STRIDE = inputStride(STEPS_PER_SECOND);
/** Input steps one click splash lasts, and its first push. */
const CLICK_SPLASH_STEPS = 6;
const CLICK_SPLASH_STRENGTH = 3.0;
/** The hover push on each input step. */
const HOVER_STRENGTH = 1.0;
/** The logo ridge's height in world units (waves are ~±2 at wave scale 4). */
const LOGO_HEIGHT = 1.4;
const HEIGHTMAPSCALE = 90;
const CAM_RADIUS = 50;

const PULSE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDamping',
  'uImpulseSize',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uLogoHeight',
  'uIntensity',
  'uGrain',
  'uVignette',
  'uTime',
  'uWaveScale',
  'uCamHeight',
  'uCamTarget',
  'uSpecular',
  'uResolution',
  'uSdf',
  'uHasLogo',
  ...AUDIO_UNIFORM_NAMES,
] as const;

function screenToHeightmapUV(
  mx: number,
  my: number,
  camHeight: number,
  camTarget: number,
  width: number,
  height: number
): [number, number] | null {
  const cy = camHeight;
  const cz = -CAM_RADIUS;
  const fyRaw = -cy;
  const fzRaw = camTarget - cz;
  const fLen = Math.hypot(fyRaw, fzRaw);
  const fy = fyRaw / fLen;
  const fz = fzRaw / fLen;
  const rx = fz > 0 ? 1 : -1;
  const uy = fz;
  const uz = -fy;
  // The display's framing: fitted to the canvas's short side.
  const short = Math.min(width, height) || 1;
  const px = ((mx * 2 - 1) * width) / short;
  const py = ((my * 2 - 1) * height) / short;
  const fov = 0.5;
  const dx = fov * px * rx;
  const dy = fy + fov * py * uy;
  const dz = fz + fov * py * uz;
  const dLen = Math.hypot(dx, dy, dz);
  const rdx = dx / dLen;
  const rdy = dy / dLen;
  const rdz = dz / dLen;
  if (rdy >= 0) return null;
  const t = -cy / rdy;
  const hitX = t * rdx;
  const hitZ = cz + t * rdz;
  const u = hitX / HEIGHTMAPSCALE + 0.5;
  const v = hitZ / HEIGHTMAPSCALE + 0.5;
  if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return null;
  return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))];
}

export function createPulseRenderer(): ShaderRenderer {
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

  const audioFade = createAudioFade();
  const clock = createStepClock(STEPS_PER_SECOND);
  const clickEdge = createClickEdge();
  /** An ambient drop due, held until an input step lays it. */
  let pendingAmbient: { u: number; v: number; strength: number } | null = null;
  let simBuf: DoubleFBO | null = null;
  let lastAmbientTime = 0;
  /** One per click, over CLICK_SPLASH_STEPS input steps. */
  let clickSplashes: Array<{ u: number; v: number; applied: number }> = [];

  // ── Logo SDF state ──────────────────────────────────────────────
  let sdfResult: SDFResult | null = null;
  let currentLogoUrl: string | null = null;
  let logoLoading = false;

  async function loadAndGenerateSDF(
    gl: WebGL2RenderingContext,
    url: string | undefined
  ): Promise<void> {
    if (logoLoading) return;
    logoLoading = true;

    try {
      // Logo removed — clean up
      if (!url) {
        if (sdfResult) {
          sdfResult.destroy();
          sdfResult = null;
        }
        currentLogoUrl = null;
        return;
      }

      // Load logo as texture
      const logoTex = await loadLogoTexture(gl, url, SIM_RES);
      if (!logoTex) {
        console.warn(
          '[pulse] Logo texture load failed, continuing without SDF'
        );
        currentLogoUrl = url; // prevent retry loop
        return;
      }

      // Generate SDF from logo mask (synchronous GPU work, <3ms)
      if (!quad) {
        // The quad is built during init, so this is unreachable in practice —
        // but `generateSDF` calls `quad.bind()`, so a null here would fault
        // inside the GPU pass rather than here, where it can be named.
        console.warn('[pulse] SDF requested before the quad existed');
        destroyLogoTexture(gl, logoTex);
        return;
      }
      const { generateSDF } = await import('../jfa-sdf');
      const newSDF = generateSDF(gl, logoTex, SIM_RES, quad);

      // Clean up: logo bitmap no longer needed, only the SDF persists
      destroyLogoTexture(gl, logoTex);

      // Replace old SDF
      if (sdfResult) sdfResult.destroy();
      sdfResult = newSDF;
      currentLogoUrl = url;
    } catch (err) {
      console.warn('[pulse] SDF generation failed:', err);
      currentLogoUrl = url; // prevent retry loop
    } finally {
      logoLoading = false;
    }
  }

  /**
   * This frame's resolved audio, shared with the sim pass — which runs from a
   * helper outside the render scope, and needs its own upload because uniforms
   * are per-program state.
   */
  let resolvedAudio = SILENT_AUDIO;

  function stepSim(
    gl: WebGL2RenderingContext,
    mouseU: number,
    mouseV: number,
    mouseOn: boolean,
    mouseStr: number,
    cfg: PulseConfig
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;
    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    uploadAudioUniforms(gl, simU, resolvedAudio);
    quad.bind(simProg);

    // TEXTURE0: simulation state
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
    gl.uniform1f(simU.uDamping, cfg.damping);
    gl.uniform1f(simU.uImpulseSize, cfg.impulseSize);
    gl.uniform2f(simU.uMouse, mouseU, mouseV);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);

    // Audio uniforms for sim

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    bindOutput(gl);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');
      initProg = createProgram(gl, VERTEX_SHADER, PULSE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, PULSE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, PULSE_DISPLAY_FRAG);
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
      const cfg = config as PulseConfig;

      // One clock for the frame: dt and this frame's simulation steps.
      const { steps, first, dt } = clock.tick(time);
      // Resolve through the shared fade: the sim shader reads the same block
      // (u_bass, u_level) the display one does.
      const a = audioFade.update(audio, dt);
      resolvedAudio = a;
      const bass = a.bass;

      // ── Logo SDF: (re)generate when the logo URL changes ─────
      const logoUrl = cfg.logoUrl ?? null;
      if (logoUrl !== currentLogoUrl && !logoLoading) {
        void loadAndGenerateSDF(gl, logoUrl ?? undefined);
      }

      // ── Mouse → heightmap UV (camera ray onto the plane) ─────
      const mapped = mouse.active
        ? screenToHeightmapUV(
            mouse.x,
            mouse.y,
            cfg.camHeight,
            cfg.camTarget,
            width,
            height
          )
        : null;

      // ── Per-frame state ────────────────────────────────────
      // Timers and the click edge follow time and are caught on the frame
      // they land; the input steps below lay them.
      // Drops come only with sound (R2b). With none, nothing moves the
      // water but the pointer: idle drops every few seconds read as the
      // surface pulsing by itself.
      if (audio?.active) {
        if (time - lastAmbientTime > Math.max(0.3, 1.5 - bass * 1.2)) {
          lastAmbientTime = time;
          pendingAmbient = {
            u: 0.15 + Math.random() * 0.7,
            v: 0.15 + Math.random() * 0.7,
            strength: 0.6 + bass * 2.0,
          };
        }
      } else {
        lastAmbientTime = time;
      }
      // One splash per click (click-edge.ts). A splash used to be queued on
      // every frame burstStrength was above zero: ~28 per click at 60 Hz,
      // each running 6 extra steps: the "overwhelming" touch.
      if (clickEdge.clicked(mouse.burstStrength) && mapped) {
        clickSplashes.push({ u: mapped[0], v: mapped[1], applied: 0 });
      }

      /**
       * The input step's impulses, in the order they ran per frame: the
       * ambient drop, the bass impulse, click splashes, then the hover step.
       * Each is a sim step of its own, so they run on the clock's input
       * steps (60 a second at any frame rate). They ran once a FRAME, so at
       * 120 Hz the waves ran twice as fast. At 60 Hz the count and order
       * are what they were.
       */
      const inputStep = (): void => {
        const amb = pendingAmbient;
        pendingAmbient = null;
        if (amb) stepSim(gl, amb.u, amb.v, true, amb.strength, cfg);

        // Bass impulse at a random point, during playback.
        if (audio?.active && bass > 0.4) {
          stepSim(
            gl,
            0.2 + Math.random() * 0.6,
            0.2 + Math.random() * 0.6,
            true,
            bass * 3.5,
            cfg
          );
        }

        for (let i = clickSplashes.length - 1; i >= 0; i--) {
          const sp = clickSplashes[i];
          stepSim(
            gl,
            sp.u,
            sp.v,
            true,
            CLICK_SPLASH_STRENGTH * (1.0 - sp.applied / CLICK_SPLASH_STEPS),
            cfg
          );
          sp.applied++;
          if (sp.applied >= CLICK_SPLASH_STEPS) clickSplashes.splice(i, 1);
        }

        stepSim(
          gl,
          mapped ? mapped[0] : -10.0,
          mapped ? mapped[1] : -10.0,
          mapped != null,
          HOVER_STRENGTH,
          cfg
        );
      };

      // Steps follow elapsed time, so 120 Hz runs the waves at 60 Hz speed.
      // Input lands on a fixed stride of steps; the rest propagate.
      for (let i = 0; i < steps; i++) {
        if ((first + i) % INPUT_STRIDE === 0) inputStep();
        else stepSim(gl, -10.0, -10.0, false, 0.0, cfg);
      }

      // ── Display pass ────────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      uploadAudioUniforms(gl, displayU, a);
      quad.bind(displayProg);

      // TEXTURE0: heightfield
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // TEXTURE1: SDF for edge glow (if available)
      const sdf = sdfResult;
      if (sdf) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sdf.sdfTexture);
        gl.uniform1i(displayU.uSdf, 1);
      }
      gl.uniform1f(displayU.uHasLogo, sdf ? 1.0 : 0.0);

      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uLogoHeight, LOGO_HEIGHT);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(displayU.uVignette, cfg.vignette);
      gl.uniform1f(displayU.uTime, time);
      gl.uniform1f(displayU.uWaveScale, cfg.waveScale);
      gl.uniform1f(displayU.uCamHeight, cfg.camHeight);
      gl.uniform1f(displayU.uCamTarget, cfg.camTarget);
      gl.uniform1f(displayU.uSpecular, cfg.specular);
      gl.uniform2f(displayU.uResolution, width, height);

      // Audio uniforms for display

      bindOutput(gl);
      drawQuad(gl);
    },

    resize(
      _gl: WebGL2RenderingContext,
      _width: number,
      _height: number
    ): void {},

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;
      lastAmbientTime = 0;
      clickSplashes = [];
      pendingAmbient = null;
      clock.reset();
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      bindOutput(gl);
    },

    destroy(gl: WebGL2RenderingContext): void {
      // Clean up SDF resources
      if (sdfResult) {
        sdfResult.destroy();
        sdfResult = null;
      }
      currentLogoUrl = null;
      logoLoading = false;

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
