/**
 * Pulse renderer — implements ShaderRenderer.
 *
 * 3D perspective raymarched wave surface based on tomkh's wave equation.
 * Sim runs at 512x512 in a ping-pong double FBO (identical physics to ripple).
 * Display pass raymarches the heightfield from a configurable camera angle.
 */

import type { MouseState, ShaderRenderer } from '../renderer-types';
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
    quad.bind(simProg);
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
      height: number
    ): void {
      if (!simProg || !displayProg || !simU || !displayU || !simBuf || !quad)
        return;
      const cfg = config as PulseConfig;
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

      if (time - lastAmbientTime > 2.5 + Math.random() * 1.5) {
        lastAmbientTime = time;
        stepSim(
          gl,
          0.15 + Math.random() * 0.7,
          0.15 + Math.random() * 0.7,
          true,
          0.6,
          cfg
        );
      }

      if (mouse.burstStrength > 0 && mapped) {
        clickSplashes.push({ u: mapped[0], v: mapped[1], frames: 0 });
      }

      for (let i = clickSplashes.length - 1; i >= 0; i--) {
        const sp = clickSplashes[i];
        if (sp.frames < 6) {
          stepSim(gl, sp.u, sp.v, true, 3.0 * (1.0 - sp.frames / 6.0), cfg);
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
        cfg
      );
      stepSim(gl, -10.0, -10.0, false, 0.0, cfg);

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
