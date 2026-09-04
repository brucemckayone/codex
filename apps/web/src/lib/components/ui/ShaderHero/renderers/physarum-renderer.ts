/**
 * Physarum renderer — slime-mould pheromone transport network (2-pass FBO).
 *
 * Ping-pong FBO at 512x512: R = trail, G = heading, B = agent presence.
 * Agents advect along their heading, steer toward the strongest of three
 * forward trail sensors, and deposit pheromone; trail diffuses and decays, so
 * unused routes prune themselves. Two substeps per rendered frame, each scaled
 * to a 60Hz-equivalent step. Mouse is a pheromone attractor; ambient food
 * sources appear every 2-4s and one more on every detected beat.
 *
 * ## What changed and why
 *
 * See `shaders/physarum-sim.frag.ts` for the substantive fix: the preset had no
 * motor stage at all, so its heading channel was dead state and it rendered a
 * saturated near-uniform slab rather than a network. This file supplies the
 * three things that change needed.
 *
 * **Agents at init.** The init pass wrote zero into the agent channel, so with
 * a birth rate that reaches equilibrium coverage in about 16 seconds the preset
 * would open on an empty frame and fill in slowly. Init now seeds roughly 2.5%
 * of texels as agents with random headings, which is close to the equilibrium
 * the population regulator holds.
 *
 * **Frame-rate independence.** Everything in the sim was per-step, run twice
 * per rendered frame, so the network grew and decayed at twice the rate on a
 * 120Hz display. `uDtScale = dt * 60` carries the frame's share of a 60Hz step,
 * clamped so the backtrace never travels more than about 2.4 texels in one step
 * (beyond that bilinear sampling of the source aliases into streaks).
 *
 * **Click bursts are wall-clock again.** They were retired after a fixed six
 * FRAMES — 100ms at 60Hz, 50ms at 120Hz, 200ms on a throttled tab. They now age
 * by dt against a fixed lifetime.
 *
 * **The musical clock.** Integrated here from a blended RATE, never crossfaded
 * in the shader: `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the clock backwards as
 * the ramp eases in and the junction pulse visibly reverses at the moment
 * playback starts.
 *
 * **Beat-chosen food.** One food source per detected onset, keyed on
 * `onsetCount` changing — not on `beatPulse > x`, which is true on every frame
 * of its ~400ms decay, and not on a raw band, which stays true through a whole
 * sustained note. Either would drop tens of sources a second and the pheromone
 * field would flatten into the same uniform slab this rewrite removed.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { PHYSARUM_DISPLAY_FRAG } from '../shaders/physarum-display.frag';
import { PHYSARUM_SIM_FRAG } from '../shaders/physarum-sim.frag';
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

/**
 * Bounds on the 60Hz-equivalent step scale. The upper bound keeps the
 * semi-Lagrangian backtrace under ~2.4 texels per step: past that, bilinear
 * sampling of the source no longer overlaps the previous footprint and
 * filaments break into dashes.
 */
const DT_SCALE_MIN = 0.4;
const DT_SCALE_MAX = 2.0;

/** Wall-clock lifetime of a click burst. Matches the previous 6-frames-at-60Hz. */
const BURST_LIFETIME_SECONDS = 6 / 60;

/** Radians of junction-pulse phase per second while silent. */
const IDLE_CLOCK_RATE = 0.32;
/** Radians of phase per musical beat once audio is playing. */
const RAD_PER_BEAT = 2.0;
/**
 * Ceiling on the differentiated musical rate. The render loop pauses (hidden
 * tab, preset switch, reduced motion) while the analyser clamps its own dt
 * rather than freezing, so the first frame after a long pause can carry a large
 * phase jump; differentiating that unclamped is one visible lurch.
 */
const MAX_CLOCK_RATE = 1.8;

interface PhysarumCfg {
  diffusion?: number;
  decay?: number;
  deposit?: number;
  sensor?: number;
  turn?: number;
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

/**
 * Init shader: scattered food, random headings, and a sparse agent population.
 *
 * The agent fraction (~2.5%) is chosen to match where the sim's birth/death
 * balance settles, so the opening frame is already a plausible steady state
 * instead of 16 seconds of filling in.
 */
const PHYSARUM_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Scattered pheromone so newborn agents have something to sense; without it
  // every sensor reads zero, the steer term is zero, and the population sets
  // off in straight lines until it happens to cross a trail.
  float trail = step(0.85, hash21(v_uv * 64.0)) * 0.5;

  // Random heading per texel.
  float heading = hash21(v_uv * 128.0 + 42.0);

  // Sparse agents.
  float agent = step(0.975, hash21(v_uv * 311.0 + 7.0));

  fragColor = vec4(trail, heading, agent, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDiffusion',
  'uDecay',
  'uDeposit',
  'uSensor',
  'uTurn',
  'uDtScale',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uDropPos',
  'uDropGain',
  ...AUDIO_UNIFORM_NAMES,
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
  'uTime',
  'uClock',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const DEFAULTS = {
  diffusion: 1.0,
  decay: 0.98,
  deposit: 1.0,
  sensor: 0.03,
  turn: 0.25,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

/** Gain of an ambient food deposit, per 60Hz-equivalent step. */
const FOOD_GAIN = 0.4;

export function createPhysarumRenderer(): ShaderRenderer {
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
  /** Next ambient interval (randomised). */
  let nextAmbientInterval = 2.0 + Math.random() * 2.0;

  /** Active click bursts, aged in seconds. */
  let clickBursts: Array<{ x: number; y: number; age: number }> = [];

  // Per-instance, never module-level: two live renderers (a hero and an
  // immersive overlay) would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Accumulated junction-pulse phase, monotone by construction. */
  let clock = 0;
  /** Previous beatPhase sample, or -1 when there is none to difference. */
  let prevBeatPhase = -1;
  /** Last onset acted on, so a beat drops exactly one food source. */
  let lastOnsetSeen = -1;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    dropX: number,
    dropY: number,
    dropGain: number,
    dtScale: number,
    cfg: PhysarumCfg,
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
    gl.uniform1f(simU.uDiffusion, cfg.diffusion ?? DEFAULTS.diffusion);
    gl.uniform1f(simU.uDecay, cfg.decay ?? DEFAULTS.decay);
    gl.uniform1f(simU.uDeposit, cfg.deposit ?? DEFAULTS.deposit);
    gl.uniform1f(simU.uSensor, cfg.sensor ?? DEFAULTS.sensor);
    gl.uniform1f(simU.uTurn, cfg.turn ?? DEFAULTS.turn);
    gl.uniform1f(simU.uDtScale, dtScale);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform2f(simU.uDropPos, dropX, dropY);
    gl.uniform1f(simU.uDropGain, dropGain);

    // The sim pass reads u_energy (turn rate, sensor distance), u_beatPhase
    // (agent pace) and u_bass (deposit), so the block must be uploaded here as
    // well as on the display pass — uniforms are per-program state.
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

      initProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_DISPLAY_FRAG);

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

      const cfg = config as unknown as PhysarumCfg;
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

      // ── Ambient food source (every 2-4s, sooner with audio) ──
      let dropX = -10.0;
      let dropY = -10.0;
      const effectiveInterval = a.silent
        ? nextAmbientInterval
        : Math.max(1.0, nextAmbientInterval - a.energy * 1.5);
      if (time - lastAmbientTime > effectiveInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 2.0 + Math.random() * 2.0;
        dropX = 0.15 + Math.random() * 0.7;
        dropY = 0.15 + Math.random() * 0.7;
      }

      // ── Click bursts: a large concentrated attractor ───────
      if (mouse.burstStrength > 0) {
        clickBursts.push({ x: mouse.x, y: mouse.y, age: 0 });
      }
      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const b = clickBursts[i];
        if (b.age < BURST_LIFETIME_SECONDS) {
          const str = 3.0 * (1 - b.age / BURST_LIFETIME_SECONDS);
          stepSim(
            gl,
            time,
            b.x,
            b.y,
            true,
            str,
            -10.0,
            -10.0,
            0,
            dtScale,
            cfg,
            a
          );
          b.age += dt;
        } else {
          clickBursts.splice(i, 1);
        }
      }

      // ── Beat-chosen food source — one per detected onset ───
      // Its own substep so it never displaces the ambient drop on the same
      // frame (uDropPos carries one position). Position comes from `beatSeed`,
      // re-rolled per onset, so the network is pulled to a new place each beat
      // and consecutive beats walk across the field rather than scattering.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          time,
          -10.0,
          -10.0,
          false,
          0,
          0.15 + a.beatSeed * 0.7,
          0.15 + ((a.beatSeed * 7.31) % 1.0) * 0.7,
          FOOD_GAIN * (1 + a.bass * 0.8),
          dtScale,
          cfg,
          a
        );
      }

      // ── Substep 1: mouse + ambient input ──────────────────
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        1.0,
        dropX,
        dropY,
        FOOD_GAIN,
        dtScale,
        cfg,
        a
      );

      // ── Substep 2: coast (no input) ───────────────────────
      stepSim(
        gl,
        time,
        -10.0,
        -10.0,
        false,
        0.0,
        -10.0,
        -10.0,
        0,
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

      // No immersive colour cycling: the three stops encode trail STRENGTH
      // (capillary / vein / trunk), a structural cue, so drifting them would
      // destroy the reading of which routes the network has reinforced. Timbre
      // reaches the accent via audioHueShift() in the shader instead.
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain ?? DEFAULTS.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the vignette popping off on the first beat.
      gl.uniform1f(
        displayU.uVignette,
        (cfg.vignette ?? DEFAULTS.vignette) * (1 - a.active)
      );
      gl.uniform1f(displayU.uTime, time);
      gl.uniform1f(displayU.uClock, clock);

      uploadAudioUniforms(gl, displayU, a);

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
      nextAmbientInterval = 2.0 + Math.random() * 2.0;
      clickBursts = [];
      clock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Seed both FBO sides with trail, headings and a sparse agent population
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
