/**
 * Spore renderer — Jones-style Physarum transport network (2-pass FBO).
 *
 * Ping-pong FBO at 512x512: R = primary trail, G = secondary trail,
 * B = heading, A = agent presence. Two substeps per rendered frame, each
 * scaled to a 60Hz-equivalent step. Mouse deposits attractant; a click seeds
 * agents and aims their headings inward; ambient food sources appear every
 * 3-6s and one more on every detected beat.
 *
 * Distinct from the `physarum` preset by its sensor geometry — a narrow fan at
 * a short offset with a discrete Jones turn, giving thin strongly branching
 * filaments rather than broad smooth veins.
 *
 * ## What changed and why
 *
 * **This preset had never run.** Its sim declared `bool active`, a GLSL ES 3.00
 * reserved word, so it never compiled; and behind that, its motor stage did not
 * exist and its deposit arithmetic saturated the field. See
 * `shaders/spore-sim.frag.ts` for both. Everything below is what that fix
 * needed from this file.
 *
 * **The agent seed density.** Init wrote agents into 30% of texels, an order of
 * magnitude above where the population regulator settles (~3.4%). With real
 * transport that would open on a solid sheet of agents and take half a minute
 * to thin out. Init now seeds close to the equilibrium coverage.
 *
 * **Ambient food.** The preset had no ambient source of any kind — the only
 * inputs were mouse and click. With trails that decay, an unattended canvas
 * eventually had nothing left to organise around. Food sources now appear on a
 * 3-6s timer, as the sibling presets do.
 *
 * **Frame-rate independence.** Every rate in the sim was per-step and the
 * renderer runs two substeps per rendered frame, so the network grew and
 * decayed twice as fast on a 120Hz display. `uDtScale = dt * 60` carries the
 * frame's share of a 60Hz step, clamped so the backtrace never travels far
 * enough for the bilinear source to stop overlapping the previous footprint.
 *
 * **The substeps no longer share a random draw.** The second was dispatched at
 * `time + 0.016` already, which is right — that shifts every `fract(uTime * k)`
 * hash input — and is kept, now as a named constant rather than a literal.
 *
 * **The audio hack is gone.** It was `stepSize + amplitude * 0.15` off the RAW
 * amplitude: 2.5% of the default step size, so inaudibly small, and driven by a
 * frame-rate-noisy signal. Turn magnitude driven by `u_energy` replaces it —
 * see the sim header for why turn rate is the lever that matters for an agent
 * system.
 *
 * **The colour switch is gone.** `audio?.active ? computeImmersiveColours(...)
 * : cfg.colors` is a boolean branch on the LOOK, so the palette jumped on the
 * first frame of playback and jumped back on pause. Cycling was also the wrong
 * call here: the stops encode trail strength, a structural cue, so drifting
 * them destroys the reading of which routes the network has reinforced. Timbre
 * reaches the accent through `audioHueShift()` in the display shader instead.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  uploadAudioUniforms,
} from '../audio-uniforms';
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

/**
 * Bounds on the 60Hz-equivalent step scale. The upper bound keeps the
 * semi-Lagrangian backtrace overlapping its previous footprint: the default
 * step is 1.5 texels, so 2.0 caps travel at 3 texels per step.
 */
const DT_SCALE_MIN = 0.4;
const DT_SCALE_MAX = 2.0;

/**
 * Time offset for the second substep, in seconds. Every stochastic decision in
 * the sim hashes some `fract(uTime * k)`, so without an offset a texel that
 * lost the birth lottery in the first substep draws the identical number and
 * loses again in the second.
 */
const SUBSTEP_TIME_OFFSET = 0.016;

/** Radians of shimmer phase per second while silent. */
const IDLE_CLOCK_RATE = 0.3;
/** Radians of phase per musical beat once audio is playing. */
const RAD_PER_BEAT = 2.0;
/**
 * Ceiling on the differentiated musical rate. The render loop pauses (hidden
 * tab, preset switch, reduced motion) while the analyser clamps its own dt
 * rather than freezing, so the first frame after a long pause can carry a large
 * phase jump; differentiating that unclamped is one visible lurch.
 */
const MAX_CLOCK_RATE = 1.8;

/** Gain of an ambient food deposit, per 60Hz-equivalent step. */
const FOOD_GAIN = 0.35;

/**
 * Init shader: scattered trail, random headings, sparse agents.
 *
 * The agent fraction (~3.4%) matches where the sim's birth/death balance
 * settles, so the opening frame is already a plausible steady state.
 */
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
  // Scattered pheromone so newborn agents have something to sense; with an
  // empty field all three sensors read zero, the Jones rule takes its
  // centre-weakest branch, and the whole population random-walks.
  float trail = step(0.85, hash21(v_uv * 64.0)) * 0.5;
  float trail2 = step(0.90, hash21(v_uv * 96.0 + 17.0)) * 0.3;

  // Random heading per texel.
  float heading = hash21(v_uv * 128.0 + 42.0);

  // Sparse agents, near the population equilibrium.
  float agent = step(0.966, hash21(v_uv * 311.0 + 7.0));

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
  'uDtScale',
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
  'uClock',
  ...AUDIO_UNIFORM_NAMES,
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

  /** Timestamp (seconds) of the last ambient food source. */
  let lastFoodTime = 0;
  /** Next ambient food interval (3-6s). */
  let nextFoodInterval = 3.0 + Math.random() * 3.0;

  // Per-instance, never module-level: two live renderers (a hero and an
  // immersive overlay) would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Accumulated shimmer phase, monotone by construction. */
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
    burst: number,
    dropX: number,
    dropY: number,
    dropGain: number,
    dtScale: number,
    cfg: SporeConfig,
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
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uBurst, burst);
    gl.uniform1f(simU.uSensorAngle, cfg.sensorAngle ?? DEFAULTS.sensorAngle);
    gl.uniform1f(simU.uSensorOffset, cfg.sensorOffset ?? DEFAULTS.sensorOffset);
    gl.uniform1f(simU.uStepSize, cfg.stepSize ?? DEFAULTS.stepSize);
    gl.uniform1f(simU.uRotation, cfg.rotation ?? DEFAULTS.rotation);
    gl.uniform1f(simU.uDecay, cfg.decay ?? DEFAULTS.decay);
    gl.uniform1f(simU.uDtScale, dtScale);
    gl.uniform2f(simU.uDropPos, dropX, dropY);
    gl.uniform1f(simU.uDropGain, dropGain);

    // The sim pass reads u_energy (turn magnitude, sensor fan), u_beatPhase
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

      // ── Ambient food source (every 3-6s, sooner with audio) ──
      let dropX = -10.0;
      let dropY = -10.0;
      const effectiveInterval = a.silent
        ? nextFoodInterval
        : Math.max(1.5, nextFoodInterval - a.energy * 2.0);
      if (time - lastFoodTime > effectiveInterval) {
        lastFoodTime = time;
        nextFoodInterval = 3.0 + Math.random() * 3.0;
        dropX = 0.15 + Math.random() * 0.7;
        dropY = 0.15 + Math.random() * 0.7;
      }

      // ── Beat-chosen food source — one per detected onset ───
      // Its own substep so it never displaces the ambient drop on the same
      // frame (uDropPos carries one position). Position comes from `beatSeed`,
      // re-rolled per onset, so consecutive beats walk across the field and the
      // network is pulled somewhere new on each one.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          time,
          -10.0,
          -10.0,
          false,
          0.0,
          0.15 + a.beatSeed * 0.7,
          0.15 + ((a.beatSeed * 7.31) % 1.0) * 0.7,
          FOOD_GAIN * (1 + a.bass * 0.8),
          dtScale,
          cfg,
          a
        );
      }

      // ── Substep 1: mouse input + ambient food ─────────────
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        mouse.burstStrength ?? 0.0,
        dropX,
        dropY,
        FOOD_GAIN,
        dtScale,
        cfg,
        a
      );

      // ── Substep 2: coast (no input, no food) ──────────────
      stepSim(
        gl,
        time + SUBSTEP_TIME_OFFSET,
        -10.0,
        -10.0,
        false,
        0.0,
        -10.0,
        -10.0,
        0.0,
        dtScale,
        cfg,
        a
      );

      // ── Display pass ──────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Brand colours pass through unmodified — see the header note on why the
      // immersive colour cycling was removed rather than smoothed.
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain ?? DEFAULTS.grain);
      // Faded by the audio ramp rather than switched off, so entering immersive
      // mode is a glide instead of the vignette popping on the first beat.
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
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastFoodTime = 0;
      nextFoodInterval = 3.0 + Math.random() * 3.0;
      clock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;

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
