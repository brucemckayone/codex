/**
 * Spore renderer — Explicit agent Physarum transport network (2-pass FBO).
 *
 * Ping-pong FBO (512x512): R = trail, G = secondary trail, B = heading, A = agent flag.
 * ~30% of texels act as agents performing the Jones (2010) Physarum algorithm:
 * sense pheromone at 3 angular sensors, turn toward strongest, deposit trail.
 * Trail diffuses via 3x3 blur and decays each frame.
 * Mouse deposits attractant trail; click seeds agents toward cursor.
 *
 * Display maps trail density to brand colors with agent accent glow.
 *
 * Distinct from existing 'physarum' preset: uses explicit sensor geometry
 * parameters (SA/SO/SS/RA) from the Jones paper for tighter networks.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, SporeConfig } from '../shader-config';
import { SPORE_DISPLAY_FRAG } from '../shaders/spore-display.frag';
import { SPORE_SIM_FRAG } from '../shaders/spore-sim.frag';
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

/** Init shader: seeds random trail deposits + random agent headings. */
const SPORE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float h1 = hash21(v_uv * 64.0);
  float h2 = hash21(v_uv * 128.0 + 42.0);
  float h3 = hash21(v_uv * 96.0 + 17.0);

  // Seed scattered trail deposits to kickstart network
  float trail = step(0.85, h1) * 0.5;
  // Secondary trail
  float trail2 = step(0.9, h3) * 0.3;
  // Random heading
  float heading = h2;
  // Agent marker
  float agent = step(0.7, h1);

  fragColor = vec4(trail, trail2, heading, agent);
}
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uBurst',
  'uSensorAngle',
  'uSensorOffset',
  'uStepSize',
  'uRotation',
  'uDecay',
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

const DEFAULTS = {
  sensorAngle: 12.5,
  sensorOffset: 3.0,
  stepSize: 6.0,
  rotation: 22.5,
  decay: 0.998,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createSporeRenderer(): ShaderRenderer {
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
    cfg: SporeConfig
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

    gl.uniform1f(simU.uSensorAngle, cfg.sensorAngle ?? DEFAULTS.sensorAngle);
    gl.uniform1f(simU.uSensorOffset, cfg.sensorOffset ?? DEFAULTS.sensorOffset);
    gl.uniform1f(simU.uStepSize, cfg.stepSize ?? DEFAULTS.stepSize);
    gl.uniform1f(simU.uRotation, cfg.rotation ?? DEFAULTS.rotation);
    gl.uniform1f(simU.uDecay, cfg.decay ?? DEFAULTS.decay);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, SPORE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, SPORE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, SPORE_DISPLAY_FRAG);

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

      const cfg = config as SporeConfig;
      const amp = audio?.amplitude ?? 0;

      // Gentle agent speed boost with audio
      const audioCfg = audio?.active
        ? {
            ...cfg,
            stepSize: (cfg.stepSize ?? DEFAULTS.stepSize) + amp * 0.15,
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
      stepSim(gl, time + 0.016, -10.0, -10.0, false, 0.0, audioCfg);

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

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
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
