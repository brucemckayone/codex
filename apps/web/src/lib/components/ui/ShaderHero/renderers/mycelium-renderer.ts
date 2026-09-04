/**
 * Mycelium (fungal network growth) renderer — implements ShaderRenderer.
 *
 * 2-pass FBO ping-pong at 512x512. Buffer: R = density, G = encoded direction,
 * B = age. Two substeps per rendered frame, each scaled to a 60Hz-equivalent
 * step. Mouse attracts growth direction; click accelerates nearby frontier
 * growth. Ambient seeds every 4-8s spawn new inoculation points, and reset()
 * places 3-5 so there is something to watch immediately.
 *
 * ## What changed and why
 *
 * **Frame-rate independence.** Growth was a per-step probability and age a
 * per-step increment, both run twice per rendered frame, so the network grew at
 * twice the rate on a 120Hz display. `uDtScale = dt * 60` carries the frame's
 * share of a 60Hz step. It needs no stability clamp of its own — growth is a
 * probability, clamped implicitly by the comparison — but it is bounded anyway
 * so a resumed tab cannot deposit a frame's worth of network in one step.
 *
 * **The two substeps no longer share a random draw.** Both were dispatched with
 * the same `time`, and the growth lottery is
 * `hash21(v_uv * 512.0 + fract(uTime * 17.31))` — so a texel that lost in the
 * first substep drew the identical number and lost again in the second. Half
 * the intended growth opportunities never existed. The second substep is
 * dispatched at `time + 0.008`, which shifts that hash input by 0.138.
 *
 * **The musical clock.** Integrated here from a blended RATE, never crossfaded
 * in the shader: `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the clock backwards as the
 * ramp eases in and every nutrient pulse runs backwards down its branch at the
 * moment playback starts.
 *
 * **Beat-seeded inoculation.** One new growth origin per detected onset, keyed
 * on `onsetCount` changing — not on `beatPulse > x`, true on every frame of its
 * ~400ms decay, and not on a raw band, true through a whole sustained note.
 * Either would plant tens of origins a second and the field would fill with
 * unconnected sprouts instead of a network.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  SILENT_AUDIO,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { MyceliumConfig, ShaderConfig } from '../shader-config';
import { MYCELIUM_DISPLAY_FRAG } from '../shaders/mycelium-display.frag';
import { MYCELIUM_SIM_FRAG } from '../shaders/mycelium-sim.frag';
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

// Frame-rate-independent click decay (docs/04-motion.md §4).
// Old per-frame multiplier `clickStrength *= 0.9` decayed 2x faster on 120Hz
// displays and half as fast on throttled 30Hz tabs. The canonical equivalent
// at 60fps is 0.9^60, so raising this to the power of dt reproduces the felt
// decay exactly at any refresh rate.
const CLICK_DECAY_PER_SECOND = 0.9 ** 60;

/** Bounds on the 60Hz-equivalent step scale. */
const DT_SCALE_MIN = 0.4;
const DT_SCALE_MAX = 2.5;

/**
 * Time offset for the second substep, in seconds. The growth lottery hashes
 * `fract(uTime * 17.31)`, so this shifts the draw by 0.138 — enough to
 * decorrelate the two substeps without moving anything else that reads uTime
 * (the direction noise field moves at 0.03/s, so 8ms is invisible there).
 */
const SUBSTEP_TIME_OFFSET = 0.008;

/** Radians of nutrient-pulse phase per second while silent. */
const IDLE_CLOCK_RATE = 0.5;
/** Radians of phase per musical beat once audio is playing. */
const RAD_PER_BEAT = 2.0;
/**
 * Ceiling on the differentiated musical rate. The render loop pauses (hidden
 * tab, preset switch, reduced motion) while the analyser clamps its own dt
 * rather than freezing, so the first frame after a long pause can carry a large
 * phase jump; differentiating that unclamped is one visible lurch.
 *
 * 1.2 rad/s of clock is 1.2 * pulse * pi = 2.64 rad/s of pulse phase at the
 * default pulse of 0.7 — i.e. a fast track can drive the travelling pulse back
 * up to roughly the rate the old wall-clock version ran at all the time, and no
 * faster. Above that the pulse stops reading as flow along a branch and starts
 * reading as the network strobing.
 */
const MAX_CLOCK_RATE = 1.2;

/** Init shader — empty field (all zeros). */
const MYCELIUM_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uGrowth',
  'uBranch',
  'uSpread',
  'uThickness',
  'uDtScale',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseClick',
  'uSeedPos',
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
  'uPulse',
  'uTime',
  'uClock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Ruleset for the reset-time seeding steps. */
const SEED_CFG: MyceliumConfig = {
  preset: 'mycelium',
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
  colors: {
    primary: [0.5, 0.5, 0.5],
    secondary: [0.5, 0.5, 0.5],
    accent: [0.5, 0.5, 0.5],
    bg: [0.05, 0.05, 0.05],
  },
  growth: 0.5,
  branch: 0.25,
  spread: 1.0,
  pulse: 0.7,
  thickness: 1.0,
};

export function createMyceliumRenderer(): ShaderRenderer {
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

  let lastSeedTime = 0;
  let nextSeedInterval = 4.0 + Math.random() * 4.0;
  let clickStrength = 0;

  // Per-instance, never module-level: two live renderers (a hero and an
  // immersive overlay) would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Accumulated nutrient-pulse phase, monotone by construction. */
  let clock = 0;
  /** Previous beatPhase sample, or -1 when there is none to difference. */
  let prevBeatPhase = -1;
  /** Last onset acted on, so a beat plants exactly one origin. */
  let lastOnsetSeen = -1;

  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseClick: number,
    seedX: number,
    seedY: number,
    dtScale: number,
    cfg: MyceliumConfig,
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
    gl.uniform1f(simU.uGrowth, cfg.growth);
    gl.uniform1f(simU.uBranch, cfg.branch);
    gl.uniform1f(simU.uSpread, cfg.spread);
    gl.uniform1f(simU.uThickness, cfg.thickness);
    gl.uniform1f(simU.uDtScale, dtScale);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseClick, mouseClick);
    gl.uniform2f(simU.uSeedPos, seedX, seedY);

    // The sim pass reads u_energy (wander gain, fork probability, senescence
    // rate) and u_beatPhase (growth pacing), so the block must be uploaded here
    // as well as on the display pass — uniforms are per-program state.
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

      initProg = createProgram(gl, VERTEX_SHADER, MYCELIUM_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, MYCELIUM_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, MYCELIUM_DISPLAY_FRAG);

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

      const cfg = config as MyceliumConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // ── Musical clock: blend RATES, then integrate ─────────
      let musicalRate = IDLE_CLOCK_RATE;
      if (!a.silent) {
        musicalRate =
          prevBeatPhase < 0
            ? IDLE_CLOCK_RATE
            : Math.min(
                MAX_CLOCK_RATE,
                Math.max(0, ((a.beatPhase - prevBeatPhase) / dt) * RAD_PER_BEAT)
              );
        prevBeatPhase = a.beatPhase;
      } else {
        prevBeatPhase = -1;
      }
      clock +=
        dt * (IDLE_CLOCK_RATE + (musicalRate - IDLE_CLOCK_RATE) * a.active);

      const dtScale = Math.min(DT_SCALE_MAX, Math.max(DT_SCALE_MIN, dt * 60));

      // Frame-rate-independent click decay.
      if (mouse.burstStrength > 0.01) {
        clickStrength = mouse.burstStrength;
      } else {
        clickStrength *= CLICK_DECAY_PER_SECOND ** dt;
        if (clickStrength < 0.01) clickStrength = 0;
      }

      // ── Ambient seed (every 4-8s, a little sooner with audio) ──
      let seedX = -10.0;
      let seedY = -10.0;
      const effectiveInterval = a.silent
        ? nextSeedInterval
        : Math.max(2.0, nextSeedInterval - a.energy * 2.0);
      if (time - lastSeedTime > effectiveInterval) {
        lastSeedTime = time;
        nextSeedInterval = 4.0 + Math.random() * 4.0;
        seedX = 0.15 + Math.random() * 0.7;
        seedY = 0.15 + Math.random() * 0.7;
      }

      // ── Beat-seeded origin — one per detected onset ────────
      // Its own substep so it never displaces the ambient seed on the same
      // frame (uSeedPos carries one position). Position comes from `beatSeed`,
      // re-rolled per onset, so consecutive beats walk across the field.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          time,
          -10,
          -10,
          false,
          0,
          0.15 + a.beatSeed * 0.7,
          0.15 + ((a.beatSeed * 7.31) % 1.0) * 0.7,
          dtScale,
          cfg,
          a
        );
      }

      // ── Substep 1: mouse input + seed ─────────────────────
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10,
        mouse.active ? mouse.y : -10,
        mouse.active,
        clickStrength,
        seedX,
        seedY,
        dtScale,
        cfg,
        a
      );

      // ── Substep 2: coast (no click boost, no seed) ────────
      stepSim(
        gl,
        time + SUBSTEP_TIME_OFFSET,
        mouse.active ? mouse.x : -10,
        mouse.active ? mouse.y : -10,
        mouse.active,
        0,
        -10,
        -10,
        dtScale,
        cfg,
        a
      );

      // ── Display pass ───────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // No immersive colour cycling: primary is the hypha body, secondary marks
      // junctions and accent marks live tips, so the three stops carry a
      // structural cue and drifting them would blur the distinction between a
      // junction and a growing tip. Timbre reaches the accent via
      // audioHueShift() in the shader instead.
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the vignette popping off on the first beat.
      gl.uniform1f(displayU.uVignette, cfg.vignette * (1 - a.active));
      gl.uniform1f(displayU.uPulse, cfg.pulse);
      gl.uniform1f(displayU.uTime, time);
      gl.uniform1f(displayU.uClock, clock);

      uploadAudioUniforms(gl, displayU, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastSeedTime = 0;
      nextSeedInterval = 4.0 + Math.random() * 4.0;
      clickStrength = 0;
      clock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;

      // Clear both FBO sides to empty
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Seed initial growth points. Runs silent: this is bootstrapping the
      // field, not playback, so reacting to whatever was playing at reset would
      // bake a transient into the initial condition.
      const seedCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < seedCount; i++) {
        stepSim(
          gl,
          i * 0.01,
          -10,
          -10,
          false,
          0,
          0.2 + Math.random() * 0.6,
          0.2 + Math.random() * 0.6,
          1.0,
          SEED_CFG,
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
    },
  };
}
