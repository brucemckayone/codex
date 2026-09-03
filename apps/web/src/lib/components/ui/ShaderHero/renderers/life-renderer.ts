/**
 * SmoothLife (Continuous Game of Life) renderer — implements ShaderRenderer.
 *
 * 2-pass FBO ping-pong at 256x256 (lower resolution due to expensive kernel).
 * SmoothLife kernel convolution: inner disc (~24 samples) + outer annulus (~40 samples).
 * Configurable sim steps per frame (1-4) via the `speed` parameter.
 * Mouse deposits life material. Ambient drops keep the simulation alive.
 * Warm-up: 40 coast steps on reset to let organisms form.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  SILENT_AUDIO,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { LifeConfig, ShaderConfig } from '../shader-config';
import { LIFE_DISPLAY_FRAG } from '../shaders/life-display.frag';
import { LIFE_SIM_FRAG } from '../shaders/life-sim.frag';
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

const SIM_RES = 256;

/** Init shader — seed blob-shaped initial state. */
const LIFE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Dense initial seeding — SmoothLife needs substantial starting mass
  vec2 cell = floor(v_uv * 12.0);
  float h = hash21(cell);
  float alive = step(0.55, h); // 45% of cells start alive

  // Extra fine-grain noise for varied density
  float h2 = hash21(v_uv * 48.0);
  alive = max(alive, step(0.75, h2) * 0.8);

  // Soft circular shape within each cell
  vec2 cellUV = fract(v_uv * 12.0);
  float dist = length(cellUV - 0.5);
  alive *= smoothstep(0.5, 0.15, dist);

  fragColor = vec4(alive, 0.0, 0.0, 1.0);
}
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uInner',
  'uOuter',
  'uBirth',
  'uDeath',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uDropPos',
  'uDropGain',
  ...AUDIO_UNIFORM_NAMES,
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
  ...AUDIO_UNIFORM_NAMES,
] as const;

export function createLifeRenderer(): ShaderRenderer {
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
  let nextAmbientInterval = 3.0 + Math.random() * 2.0;
  let clickBursts: Array<{ x: number; y: number; frames: number }> = [];

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();
  /** Last onset acted on, so a beat seeds exactly one colony. */
  let lastOnsetSeen = -1;

  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    dropX: number,
    dropY: number,
    cfg: LifeConfig,
    audio: ResolvedAudio
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
    gl.uniform1f(simU.uInner, cfg.inner);
    gl.uniform1f(simU.uOuter, cfg.outer);
    gl.uniform1f(simU.uBirth, cfg.birth);
    gl.uniform1f(simU.uDeath, cfg.death);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform2f(simU.uDropPos, dropX, dropY);
    // 0.5 is the historical deposit gain: the sim used a hardcoded
    // `newState += 0.5 * exp(...)` before the drop was parameterised, and the
    // Gaussian radius is unchanged, so this reproduces the original mass
    // exactly. Audio lifts it slightly so a beat-seeded colony starts denser
    // and survives its first few relaxation steps.
    gl.uniform1f(simU.uDropGain, 0.5 * (1 + audio.energy * 0.4 * audio.active));

    // The sim pass reads u_energy (to shift the birth/death thresholds within
    // their stable band) and u_beatPhase (to pace the relaxation step), so the
    // block must be uploaded here as well as on the display pass — a program's
    // uniforms are per-program state.
    uploadAudioUniforms(gl, simU, audio);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, LIFE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, LIFE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, LIFE_DISPLAY_FRAG);

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

      const cfg = config as LifeConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);
      // Smoothed, not raw: `amplitude` at frame rate is noisy enough to read
      // as jitter, and this value reaches colour and step count.
      const amp = a.level;

      // Step count rises with the slow macro envelope rather than instantaneous
      // amplitude. Sim steps are integer, so a jittery input would make the
      // simulation rate flicker between 2 and 3 steps frame to frame.
      const audioSpeedBoost = a.energy * 0.5 * a.active;
      const steps = Math.max(
        1,
        Math.min(4, Math.round(cfg.speed + audioSpeedBoost))
      );

      // Click bursts: deposit large blob of life
      if (mouse.burstStrength > 0) {
        clickBursts.push({ x: mouse.x, y: mouse.y, frames: 0 });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const burst = clickBursts[i];
        if (burst.frames < 5) {
          const str = 2.0 * (1.0 - burst.frames / 5.0);
          stepSim(gl, time, burst.x, burst.y, true, str, -10, -10, cfg, a);
          burst.frames++;
        } else {
          clickBursts.splice(i, 1);
        }
      }

      // Ambient deposits — gently more frequent with audio
      let dropX = -10.0;
      let dropY = -10.0;
      const effectiveInterval = a.silent
        ? nextAmbientInterval
        : Math.max(1.5, nextAmbientInterval - a.energy * 1.5);
      if (time - lastAmbientTime > effectiveInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 3.0 + Math.random() * 2.0;
        dropX = 0.15 + Math.random() * 0.7;
        dropY = 0.15 + Math.random() * 0.7;
      }

      // Beat-seeded colonies — one deposit per detected onset.
      //
      // This replaces a `bass > 0.5` gate. Because that tested the RAW band it
      // stayed true for the whole duration of any sustained bass note, so it
      // deposited on every frame — up to 60 colonies a second, which saturates
      // the field to a flat mass rather than seeding life. Keying on
      // `onsetCount` fires exactly once per onset, and the analyser already
      // refractory-gates onsets to at most one per 180ms.
      //
      // The position comes from `beatSeed` (re-rolled per onset) rather than
      // Math.random(), so a colony lands somewhere musically determined and
      // consecutive beats walk around the field instead of scattering.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          time,
          0.2 + a.beatSeed * 0.6,
          0.2 + ((a.beatSeed * 7.31) % 1.0) * 0.6,
          true,
          0.5 + a.bass * 0.5,
          -10,
          -10,
          cfg,
          a
        );
      }

      // Run sim steps
      for (let s = 0; s < steps; s++) {
        const isFirst = s === 0;
        stepSim(
          gl,
          time,
          mouse.active ? mouse.x : -10.0,
          mouse.active ? mouse.y : -10.0,
          mouse.active,
          isFirst ? 1.0 : 0.0,
          isFirst ? dropX : -10.0,
          isFirst ? dropY : -10.0,
          cfg,
          a
        );
      }

      // Display pass
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Immersive colour cycling. Kept for this preset: SmoothLife's palette
      // is a state ramp (dead → alive → accent), not a depth or structural
      // cue, so drifting the stops reads as the organisms changing hue rather
      // than as the depth ordering breaking down.
      const colours = a.silent
        ? cfg.colors
        : computeImmersiveColours(time, cfg.colors, amp);

      gl.uniform3fv(displayU.uColorPrimary, colours.primary);
      gl.uniform3fv(displayU.uColorSecondary, colours.secondary);
      gl.uniform3fv(displayU.uColorAccent, colours.accent);
      gl.uniform3fv(displayU.uBgColor, colours.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the vignette popping off on the first beat.
      gl.uniform1f(displayU.uVignette, cfg.vignette * (1 - a.active));
      gl.uniform1f(displayU.uTime, time);

      uploadAudioUniforms(gl, displayU, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 256x256.
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastAmbientTime = 0;
      nextAmbientInterval = 3.0 + Math.random() * 2.0;
      clickBursts = [];

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Seed both FBO sides with initial life blobs
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Warm-up: 40 coast steps to let organisms form
      if (!simProg || !simU) return;

      const defaultCfg: LifeConfig = {
        preset: 'life',
        intensity: 0.65,
        grain: 0.025,
        vignette: 0.2,
        colors: {
          primary: [0.5, 0.5, 0.5],
          secondary: [0.5, 0.5, 0.5],
          accent: [0.5, 0.5, 0.5],
          bg: [0.05, 0.05, 0.05],
        },
        inner: 7.0,
        outer: 21.0,
        birth: 0.278,
        death: 0.365,
        speed: 2,
      };

      // Warm-up runs silent: this is bootstrapping the field, not playback, so
      // reacting to whatever was playing at reset would bake a transient into
      // the initial condition.
      for (let w = 0; w < 40; w++) {
        stepSim(
          gl,
          0,
          -10.0,
          -10.0,
          false,
          0,
          -10.0,
          -10.0,
          defaultCfg,
          SILENT_AUDIO
        );
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
