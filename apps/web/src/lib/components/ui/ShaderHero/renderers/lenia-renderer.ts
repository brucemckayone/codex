/**
 * Lenia (continuous cellular automata) renderer — implements ShaderRenderer.
 *
 * Three programs over a 256x256 ping-pong FBO: init (smooth Gaussian blob
 * seeds), sim (bump-kernel convolution + Gaussian growth), display (four-stop
 * concentric ramp). `speed` sets substeps per rendered frame; `dt` sets the
 * integration step, now scaled to be frame-rate independent.
 *
 * ## What changed and why
 *
 * **Frame-rate independence.** `steps` substeps of a fixed `uDt` per rendered
 * frame meant the simulation evolved at twice the rate on a 120Hz display and
 * half on a throttled 30Hz tab — creatures that are stable at one refresh rate
 * dissolve at another. `uDtScale` carries the frame's share of a 60Hz step.
 *
 * **The musical clock.** The display pass needs a monotone phase for the core
 * breathing. It is integrated here from a blended RATE rather than crossfaded
 * in the shader: `u_beatPhase` starts at zero while `uTime` may be at 60s, so
 * `mix(uTime * k, u_beatPhase, u_audioActive)` sweeps the phase backwards as
 * the audio ramp eases in, and the breathing visibly runs in reverse the moment
 * playback starts. Integrating a clamped rate makes the position monotone by
 * construction.
 *
 * **Beat-seeded colonies.** One deposit per detected onset, keyed on
 * `onsetCount` changing. Not on `beatPulse > x` (which is true on every frame
 * of its ~400ms decay) and not on a raw band (true for the whole duration of a
 * sustained note) — either floods a stateful field into a flat mass.
 *
 * **reset().** The warm-up loop duplicated the entire sim uniform upload
 * inline, so every uniform added to the sim pass had to be remembered in two
 * places. It now calls `stepSim` with `SILENT_AUDIO`.
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
import type { LeniaConfig, ShaderConfig } from '../shader-config';
import { LENIA_DISPLAY_FRAG } from '../shaders/lenia-display.frag';
import { LENIA_SIM_FRAG } from '../shaders/lenia-sim.frag';
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

const SIM_RES = 256; // Lower res than ink/turing due to the expensive kernel

// Frame-rate-independent click-burst lifespan (docs/04-motion.md §4).
// Old per-frame counter (`b.frame++` with `b.frame < 5`) made clicks visibly
// live for 5 frames — 83ms on 60Hz, 42ms on 120Hz, 167ms on throttled 30Hz.
const BURST_LIFETIME_SECONDS = 5 / 60;

/**
 * Bounds on the 60Hz-equivalent step scale.
 *
 * The upper bound is the load-bearing one: `uDt` defaults to 0.2 and the state
 * update is an explicit Euler step on a growth term in -1..1, so a scale of 2.0
 * (a 30Hz frame) would move a cell by 0.4 in one step and Lenia's creatures
 * break up into oscillation well before that. 1.6 caps the step at 0.368,
 * including the sim's 1.15x beat-pace ceiling (0.2 * 1.6 * 1.15).
 * The lower bound means a 144Hz display runs about 20% fast rather than 2.4x
 * fast, which is the defect this exists to remove.
 */
const DT_SCALE_MIN = 0.5;
const DT_SCALE_MAX = 1.6;

/** Radians of core-pulse phase per second while silent. */
const IDLE_PULSE_RATE = 0.28;
/** Radians of core-pulse phase per musical beat once audio is playing. */
const PULSE_RAD_PER_BEAT = 2.0;
/**
 * Ceiling on the differentiated musical rate (rad/s). The render loop pauses
 * (hidden tab, preset switch, reduced motion) while the analyser clamps its own
 * dt rather than freezing, so the first frame after a long pause can show a
 * large phase jump; differentiating that unclamped spikes the rate and produces
 * exactly one visible lurch.
 */
const MAX_PULSE_RATE = 1.6;

/** Init fragment shader — smooth Gaussian blobs for Lenia-appropriate seeding. */
const LENIA_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  float alive = 0.0;

  // Place ~12 smooth Gaussian blobs at pseudo-random positions. Lenia needs
  // smooth initial mass: hash noise has no scale above one texel, so the
  // kernel averages it to a uniform value and the whole field decays at once.
  for (float i = 0.0; i < 12.0; i += 1.0) {
    vec2 center = vec2(
      0.15 + hash21(vec2(i * 7.3, 13.1)) * 0.7,
      0.15 + hash21(vec2(i * 13.1 + 100.0, i * 3.7)) * 0.7
    );
    float blobRadius = 0.03 + hash21(vec2(i * 29.3, i * 17.7)) * 0.05;
    vec2 d = v_uv - center;
    float g = exp(-dot(d, d) / (blobRadius * blobRadius));
    alive += g;
  }

  alive = clamp(alive, 0.0, 1.0);
  fragColor = vec4(alive, 0.0, 0.0, 1.0);
}
`;

/** Sim uniform names. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uRadius',
  'uGrowth',
  'uWidth',
  'uDt',
  'uDtScale',
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

/** Warm-up ruleset. Matches the shader defaults, with a wider growth width so
 * the initial blobs relax into creatures instead of fragmenting. */
const WARMUP_CFG: LeniaConfig = {
  preset: 'lenia',
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
  colors: {
    primary: [0.5, 0.5, 0.5],
    secondary: [0.5, 0.5, 0.5],
    accent: [0.5, 0.5, 0.5],
    bg: [0.05, 0.05, 0.05],
  },
  radius: 13.0,
  growth: 0.14,
  width: 0.04,
  speed: 2,
  dt: 0.2,
};

export function createLeniaRenderer(): ShaderRenderer {
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

  /** Timestamp of last ambient deposit. */
  let lastAmbientTime = 0;
  /** Next ambient deposit interval (4-7s). */
  let nextAmbientInterval = 4.0 + Math.random() * 3.0;

  /** Active click burst animations. */
  let clickBursts: Array<{ x: number; y: number; age: number }> = [];

  // Per-instance, never module-level: a hero and an immersive overlay are two
  // live renderers and would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  /** Accumulated core-pulse phase (radians), monotone by construction. */
  let pulseClock = 0;
  /** Previous beatPhase sample, or -1 when there is none to difference. */
  let prevBeatPhase = -1;
  /** Last onset acted on, so a beat seeds exactly one colony. */
  let lastOnsetSeen = -1;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    dropX: number,
    dropY: number,
    dropGain: number,
    dtScale: number,
    cfg: LeniaConfig,
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
    gl.uniform1f(simU.uRadius, cfg.radius);
    gl.uniform1f(simU.uGrowth, cfg.growth);
    gl.uniform1f(simU.uWidth, cfg.width);
    gl.uniform1f(simU.uDt, cfg.dt);
    gl.uniform1f(simU.uDtScale, dtScale);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform2f(simU.uDropPos, dropX, dropY);
    gl.uniform1f(simU.uDropGain, dropGain);

    // The sim pass reads u_energy (to shift mu/sigma inside their stable band)
    // and u_beatPhase (to pace the integration step), so the block must be
    // uploaded here as well as on the display pass — uniforms are per-program.
    uploadAudioUniforms(gl, simU, audio);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions for RGBA16F FBO
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, LENIA_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, LENIA_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, LENIA_DISPLAY_FRAG);

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

      const cfg = config as LeniaConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // ── Musical clock: blend RATES, then integrate ─────────
      let musicalRate = IDLE_PULSE_RATE;
      if (!a.silent) {
        musicalRate =
          prevBeatPhase < 0
            ? IDLE_PULSE_RATE
            : Math.min(
                MAX_PULSE_RATE,
                Math.max(
                  0,
                  ((a.beatPhase - prevBeatPhase) / dt) * PULSE_RAD_PER_BEAT
                )
              );
        prevBeatPhase = a.beatPhase;
      } else {
        prevBeatPhase = -1;
      }
      pulseClock +=
        dt * (IDLE_PULSE_RATE + (musicalRate - IDLE_PULSE_RATE) * a.active);

      // 60Hz-equivalent step scale, clamped for stability (see the constants).
      const dtScale = Math.min(DT_SCALE_MAX, Math.max(DT_SCALE_MIN, dt * 60));

      // Substeps rise with the slow macro envelope, never instantaneous
      // amplitude: the count is an integer, so a jittery input would make the
      // simulation rate flicker between 2 and 3 steps frame to frame.
      const steps = Math.max(
        1,
        Math.min(4, Math.round((cfg.speed ?? 2) + a.energy * 0.5 * a.active))
      );

      // ── Ambient deposit (every 4-7s, slightly more often with audio) ──
      let dropX = -10.0;
      let dropY = -10.0;
      const effectiveInterval = a.silent
        ? nextAmbientInterval
        : Math.max(2.0, nextAmbientInterval - a.energy * 2.0);
      if (time - lastAmbientTime > effectiveInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 4.0 + Math.random() * 3.0;
        dropX = 0.15 + Math.random() * 0.7;
        dropY = 0.15 + Math.random() * 0.7;
      }

      // ── Click bursts ────────────────────────────────────────
      if (mouse.burstStrength > 0) {
        clickBursts.push({ x: mouse.x, y: mouse.y, age: 0 });
      }

      // ── Beat-seeded colonies — one deposit per detected onset ──
      // Position comes from `beatSeed` (re-rolled per onset) rather than
      // Math.random(), so consecutive beats walk around the field instead of
      // scattering, and the placement is musically determined.
      if (!a.silent && a.onsetCount !== lastOnsetSeen) {
        lastOnsetSeen = a.onsetCount;
        stepSim(
          gl,
          -10.0,
          -10.0,
          false,
          0,
          0.2 + a.beatSeed * 0.6,
          0.2 + ((a.beatSeed * 7.31) % 1.0) * 0.6,
          // A beat-seeded blob needs enough mass to survive its first few
          // relaxation steps; below about 0.35 the convolution never reaches mu
          // and the blob evaporates instead of becoming a creature.
          0.45 + a.bass * 0.3,
          dtScale,
          cfg,
          a
        );
      }

      // ── Sim steps ───────────────────────────────────────────
      for (let s = 0; s < steps; s++) {
        // Mouse and ambient drops apply on the first substep only, so the
        // deposit mass per frame does not scale with the substep count.
        let mx = -10.0;
        let my = -10.0;
        let mStr = 0.0;
        let dx = -10.0;
        let dy = -10.0;

        if (s === 0) {
          if (mouse.active) {
            mx = mouse.x;
            my = mouse.y;
            mStr = 0.3;
          }

          // Age each burst by dt; retire at BURST_LIFETIME_SECONDS.
          for (let i = clickBursts.length - 1; i >= 0; i--) {
            const b = clickBursts[i];
            if (b.age < BURST_LIFETIME_SECONDS) {
              mx = b.x;
              my = b.y;
              mStr = 0.6 * Math.max(0, 1 - b.age / BURST_LIFETIME_SECONDS);
              b.age += dt;
            } else {
              clickBursts.splice(i, 1);
            }
          }

          dx = dropX;
          dy = dropY;
        }

        stepSim(gl, mx, my, mx > -5.0, mStr, dx, dy, 0.4, dtScale, cfg, a);
      }

      // ── Display pass ────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // No immersive colour cycling here: Lenia's three stops encode a
      // creature's concentric structure (corona / body / core), so drifting
      // them fights the cue the ramp exists to carry. Timbre reaches the
      // accent through audioHueShift() in the shader instead.
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      // Faded by the audio ramp rather than switched, so entering immersive
      // mode is a glide instead of the vignette popping off on the first beat.
      gl.uniform1f(displayU.uVignette, cfg.vignette * (1 - a.active));
      gl.uniform1f(displayU.uTime, time);
      gl.uniform1f(displayU.uClock, pulseClock);

      uploadAudioUniforms(gl, displayU, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 256x256.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastAmbientTime = 0;
      nextAmbientInterval = 4.0 + Math.random() * 3.0;
      clickBursts = [];
      pulseClock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;

      // Seed both FBO sides with initial Gaussian blobs
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Warm-up: 50 coast steps to let creatures form. Runs silent — this is
      // bootstrapping the field, not playback, so reacting to whatever was
      // playing at reset would bake a transient into the initial condition.
      for (let w = 0; w < 50; w++) {
        stepSim(
          gl,
          -10.0,
          -10.0,
          false,
          0,
          -10.0,
          -10.0,
          0.0,
          1.0,
          WARMUP_CFG,
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
