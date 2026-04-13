/**
 * Pulse renderer — implements ShaderRenderer.
 *
 * 3D perspective raymarched wave surface based on tomkh's wave equation.
 * Sim runs at 512x512 in a ping-pong double FBO (identical physics to ripple).
 * Display pass raymarches the heightfield from a configurable camera angle.
 *
 * Optional logo SDF integration: when an org logo URL is present in the
 * shader config, the logo is converted to a signed distance field (SDF)
 * which drives an attractor force in the wave equation. Waves naturally
 * accumulate along the logo boundary, making the logo emerge from the fluid.
 */

import type { SDFResult } from '../jfa-sdf';
import { destroyLogoTexture, loadLogoTexture } from '../logo-texture';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { PulseConfig, ShaderConfig } from '../shader-config';
import { PULSE_DISPLAY_FRAG } from '../shaders/pulse-display.frag';
import { PULSE_SIM_FRAG } from '../shaders/pulse-sim.frag';
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
  'uSdf',
  'uHasLogo',
  'uTime',
  'uAudioBass',
  'uAudioAmplitude',
] as const;

const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uPulseColor',
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
  'uAudioBass',
  'uAudioMids',
  'uAudioTreble',
  'uAudioAmplitude',
] as const;

function screenToHeightmapUV(
  mx: number,
  my: number,
  camHeight: number,
  camTarget: number,
  aspect: number
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
  const px = (mx * 2 - 1) * aspect;
  const py = my * 2 - 1;
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
  let simBuf: DoubleFBO | null = null;
  let lastAmbientTime = 0;
  let clickSplashes: Array<{ u: number; v: number; frames: number }> = [];

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
      const { generateSDF } = await import('../jfa-sdf');
      const newSDF = generateSDF(gl, logoTex, SIM_RES, quad!);

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

  // Audio values set by render() before calling stepSim
  let currentAudioBass = 0;
  let currentAudioAmplitude = 0;

  function stepSim(
    gl: WebGL2RenderingContext,
    mouseU: number,
    mouseV: number,
    mouseOn: boolean,
    mouseStr: number,
    cfg: PulseConfig,
    time: number
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;
    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    quad.bind(simProg);

    // TEXTURE0: simulation state
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    // TEXTURE1: SDF (if available)
    const hasLogo = sdfResult != null;
    if (hasLogo) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sdfResult!.sdfTexture);
      gl.uniform1i(simU.uSdf, 1);
    }
    gl.uniform1f(simU.uHasLogo, hasLogo ? 1.0 : 0.0);
    gl.uniform1f(simU.uTime, time);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
    gl.uniform1f(simU.uDamping, cfg.damping);
    gl.uniform1f(simU.uImpulseSize, cfg.impulseSize);
    gl.uniform2f(simU.uMouse, mouseU, mouseV);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);

    // Audio uniforms for sim
    gl.uniform1f(simU.uAudioBass, currentAudioBass);
    gl.uniform1f(simU.uAudioAmplitude, currentAudioAmplitude);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

      // Audio values (0 when no audio) — shared with stepSim via closure
      const bass = audio?.bass ?? 0;
      const mids = audio?.mids ?? 0;
      const treble = audio?.treble ?? 0;
      const amplitude = audio?.amplitude ?? 0;
      currentAudioBass = bass;
      currentAudioAmplitude = amplitude;

      // ── Logo SDF change detection ───────────────────────────────
      const logoUrl = cfg.logoUrl ?? null;
      if (logoUrl !== currentLogoUrl && !logoLoading) {
        void loadAndGenerateSDF(gl, logoUrl ?? undefined);
      }

      const aspect = width / height;
      const mapped = mouse.active
        ? screenToHeightmapUV(
            mouse.x,
            mouse.y,
            cfg.camHeight,
            cfg.camTarget,
            aspect
          )
        : null;

      // Ambient splashes — more frequent and stronger when audio is active
      const ambientInterval = audio?.active
        ? Math.max(0.3, 1.5 - bass * 1.2)
        : 2.5 + Math.random() * 1.5;
      if (time - lastAmbientTime > ambientInterval) {
        lastAmbientTime = time;
        const ambientStrength = audio?.active ? 0.6 + bass * 2.0 : 0.6;
        stepSim(
          gl,
          0.15 + Math.random() * 0.7,
          0.15 + Math.random() * 0.7,
          true,
          ambientStrength,
          cfg,
          time
        );
      }

      // Bass-driven impulses — fire additional splashes on strong bass hits
      if (audio?.active && bass > 0.4) {
        const impulseStrength = bass * 3.5;
        stepSim(
          gl,
          0.2 + Math.random() * 0.6,
          0.2 + Math.random() * 0.6,
          true,
          impulseStrength,
          cfg,
          time
        );
      }

      if (mouse.burstStrength > 0 && mapped) {
        clickSplashes.push({ u: mapped[0], v: mapped[1], frames: 0 });
      }

      for (let i = clickSplashes.length - 1; i >= 0; i--) {
        const sp = clickSplashes[i];
        if (sp.frames < 6) {
          stepSim(
            gl,
            sp.u,
            sp.v,
            true,
            3.0 * (1.0 - sp.frames / 6.0),
            cfg,
            time
          );
          sp.frames++;
        } else {
          clickSplashes.splice(i, 1);
        }
      }

      stepSim(
        gl,
        mapped ? mapped[0] : -10.0,
        mapped ? mapped[1] : -10.0,
        mapped != null,
        1.0,
        cfg,
        time
      );
      stepSim(gl, -10.0, -10.0, false, 0.0, cfg, time);

      // ── Display pass ────────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      // TEXTURE0: heightfield
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // TEXTURE1: SDF for edge glow (if available)
      const hasLogo = sdfResult != null;
      if (hasLogo) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sdfResult!.sdfTexture);
        gl.uniform1i(displayU.uSdf, 1);
      }
      gl.uniform1f(displayU.uHasLogo, hasLogo ? 1.0 : 0.0);

      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform3fv(displayU.uPulseColor, cfg.pulseColor);
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
      gl.uniform1f(displayU.uAudioBass, bass);
      gl.uniform1f(displayU.uAudioMids, mids);
      gl.uniform1f(displayU.uAudioTreble, treble);
      gl.uniform1f(displayU.uAudioAmplitude, amplitude);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
