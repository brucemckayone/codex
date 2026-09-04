/**
 * Turing Pattern renderer — implements ShaderRenderer.
 *
 * FBO-based Gray-Scott reaction-diffusion simulation.
 * Buffer format: vec4(A, B, 0.0, 1.0) where RG = chemical concentrations.
 *
 * Simulation runs at 512x512 in a ping-pong double FBO; the display pass
 * renders to the full canvas viewport.
 *
 * ## What changed and why
 *
 * **Frame-rate independence.** `speed` used to mean "sim steps per rendered
 * frame", so the chemistry evolved twice as fast on a 120Hz display as on 60Hz
 * and half as fast in a throttled tab. It now means steps per second (the
 * former value x 60, so 60Hz behaviour is unchanged) and is metered by an
 * accumulator against `createDeltaClock()`.
 *
 * **Click bursts no longer distort time.** A burst used to run up to six
 * *extra* whole sim steps per frame on top of the configured budget — a 2.5x
 * cost spike that also fast-forwarded the simulation. The burst is now an
 * amplitude on the existing seed injector, decaying over wall-clock time.
 *
 * **Audio.** Beat onsets inject a chemical-B spot at a `u_beatSeed`-chosen
 * site. That is the whole point of putting audio into a stateful sim: the beat
 * writes into a field with memory, so the spot it nucleates goes on developing
 * into worms and rings for tens of seconds afterwards. Parameter response
 * (feed/kill, reaction rate) lives in the sim shader; light response lives in
 * the display shader.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  type ResolvedAudio,
  uploadAudioUniforms,
} from '../audio-uniforms';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig, TuringConfig } from '../shader-config';
import { TURING_DISPLAY_FRAG } from '../shaders/turing-display.frag';
import { TURING_SIM_FRAG } from '../shaders/turing-sim.frag';
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
 * `speed` is steps per frame in the config's units; multiplying by 60 turns it
 * into steps per second, which is what the accumulator meters. 60Hz behaviour
 * is therefore identical to before this change.
 */
const STEPS_PER_SPEED_UNIT = 60;

/**
 * Ceiling on catch-up steps in one frame. `createDeltaClock()` already clamps
 * dt to 100ms, so this only bites on a 30Hz display (where doubling up is
 * correct) — it exists so a slow first frame cannot stall the tab further.
 */
const MAX_STEPS_PER_FRAME = 16;

/** Wall-clock lifetime of a click burst's seed injection (seconds). */
const BURST_LIFETIME_SEC = 0.28;

/** Minimum gap between beat-driven seeds, so a dense track cannot flood. */
const BEAT_SEED_MIN_GAP_SEC = 0.25;

/** Turing init fragment shader — A=1, B=0 everywhere (homogeneous steady state). */
const TURING_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }
`;

/** Uniform name lists for type-safe location lookup. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uFeed',
  'uKill',
  'uDa',
  'uDb',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uSeedPos',
  'uSeedGain',
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

/**
 * The subset of the config the sim pass reads. Narrowed so reset() can warm up
 * from the catalogue defaults without fabricating a whole TuringConfig.
 */
type SimParams = Pick<TuringConfig, 'feed' | 'kill' | 'da' | 'db'>;

/** Per-step injection state. Parked values (-10) underflow the sim's Gaussian. */
interface SimInput {
  mouseX: number;
  mouseY: number;
  mouseOn: boolean;
  mouseStr: number;
  seedX: number;
  seedY: number;
  seedGain: number;
}

/** No pointer, no seed — a pure coast step. */
const COAST: SimInput = {
  mouseX: -10,
  mouseY: -10,
  mouseOn: false,
  mouseStr: 0,
  seedX: -10,
  seedY: -10,
  seedGain: 0,
};

/** Simple hash for random seeding positions. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function createTuringRenderer(): ShaderRenderer {
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

  /** Timestamp (seconds) of last ambient seed. */
  let lastAmbientTime = 0;

  /** Next ambient seed interval (randomized between 3-6s). */
  let nextAmbientInterval = 3.0 + Math.random() * 3.0;

  /** Fractional sim-step debt carried between frames. */
  let stepAccum = 0;

  /** Onset counter the last beat seed fired on, and when it fired. */
  let lastOnsetCount = -1;
  let lastBeatSeedTime = -1;

  /** Live click bursts, aged in seconds so their feel is refresh-independent. */
  let clickBursts: Array<{ x: number; y: number; age: number }> = [];

  const audioFade = createAudioFade();
  const deltaClock = createDeltaClock();

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    input: SimInput,
    cfg: SimParams,
    audio: ResolvedAudio | null
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
    gl.uniform1f(simU.uFeed, cfg.feed);
    gl.uniform1f(simU.uKill, cfg.kill);
    gl.uniform1f(simU.uDa, cfg.da);
    gl.uniform1f(simU.uDb, cfg.db);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, input.mouseX, input.mouseY);
    gl.uniform1f(simU.uMouseActive, input.mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, input.mouseStr);
    gl.uniform2f(simU.uSeedPos, input.seedX, input.seedY);
    gl.uniform1f(simU.uSeedGain, input.seedGain);

    if (audio) {
      uploadAudioUniforms(gl, simU, audio);
    } else {
      // Warm-up and reset steps: force the silent look rather than inheriting
      // whatever the last rendered frame left in the program's uniforms.
      for (const name of AUDIO_UNIFORM_NAMES) gl.uniform1f(simU[name], 0);
    }

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
      initProg = createProgram(gl, VERTEX_SHADER, TURING_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, TURING_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, TURING_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize and seed
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

      const cfg = config as TuringConfig;
      const dt = deltaClock(time);
      const a = audioFade.update(audio, dt);

      // ── Step budget: steps per *second*, not per frame ────────
      const speed = Math.max(1, Math.min(8, Math.round(cfg.speed)));
      stepAccum += dt * speed * STEPS_PER_SPEED_UNIT;
      let steps = Math.floor(stepAccum);
      stepAccum -= steps;
      steps = Math.min(steps, MAX_STEPS_PER_FRAME);

      // ── Choose this frame's seed ──────────────────────────────
      // One injector, three sources, in priority order: a click, a beat, the
      // ambient timer. Ambient seeding is never gated on audio — an all-A
      // field is an absorbing state for Gray-Scott (B=0 makes the reaction
      // term vanish), so periodic nucleation is what keeps the preset alive
      // through a silent passage.
      let seedX = -10.0;
      let seedY = -10.0;
      let seedGain = 0.0;

      if (time - lastAmbientTime > nextAmbientInterval) {
        lastAmbientTime = time;
        nextAmbientInterval = 3.0 + Math.random() * 3.0;
        seedX = 0.15 + Math.random() * 0.7;
        seedY = 0.15 + Math.random() * 0.7;
        seedGain = 0.4;
      }

      // Beat-chosen nucleation site. u_beatSeed is re-rolled per onset and
      // slewed over ~0.25s, so consecutive beats land near one another: the
      // injection site *migrates* across the field rather than teleporting,
      // and the pattern reads as one colony spreading rather than confetti.
      if (
        audio &&
        a.active > 0.05 &&
        audio.onsetCount !== lastOnsetCount &&
        time - lastBeatSeedTime > BEAT_SEED_MIN_GAP_SEC
      ) {
        lastOnsetCount = audio.onsetCount;
        lastBeatSeedTime = time;
        seedX = 0.18 + a.beatSeed * 0.64;
        seedY = 0.18 + pseudoRandom(a.beatSeed * 91.7) * 0.64;
        seedGain = (0.34 + a.beatPulse * 0.28) * a.active;
      }

      if (mouse.burstStrength > 0) {
        clickBursts.push({ x: mouse.x, y: mouse.y, age: 0 });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const burst = clickBursts[i];
        if (burst.age >= BURST_LIFETIME_SEC) {
          clickBursts.splice(i, 1);
          continue;
        }
        seedX = burst.x;
        seedY = burst.y;
        seedGain = 0.75 * (1 - burst.age / BURST_LIFETIME_SEC);
        burst.age += dt;
      }

      // A pending seed must not be dropped by a frame that happens to owe no
      // step (120Hz alternates 4 and 3 steps at speed 4), or a click could
      // silently do nothing.
      if (steps === 0 && seedGain > 0) steps = 1;

      // ── Simulation steps ──────────────────────────────────────
      // Injections ride the first step only; the rest coast. Applying them
      // every step would multiply the deposit by the step count, which would
      // then vary with refresh rate again.
      for (let s = 0; s < steps; s++) {
        stepSim(
          gl,
          time,
          s === 0
            ? {
                mouseX: mouse.active ? mouse.x : -10.0,
                mouseY: mouse.active ? mouse.y : -10.0,
                mouseOn: mouse.active,
                mouseStr: 1.0,
                seedX,
                seedY,
                seedGain,
              }
            : COAST,
          cfg,
          a
        );
      }

      // ── Display pass ───────────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Brand colours are passed through rather than routed via
      // computeImmersiveColours(): this display derives a *depth* cue from the
      // three stops (pattern → primary, deep → secondary, contour → accent),
      // and cycling them fights that cue. Audio moves colour here through
      // u_centroid warmth and the beat bloom instead.
      gl.uniform3fv(displayU.uColorPrimary, cfg.colors.primary);
      gl.uniform3fv(displayU.uColorSecondary, cfg.colors.secondary);
      gl.uniform3fv(displayU.uColorAccent, cfg.colors.accent);
      gl.uniform3fv(displayU.uBgColor, cfg.colors.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      // Vignette frames a hero but tunnels in fullscreen immersive mode, so it
      // fades with the ramp rather than switching (which would pop on beat 1).
      gl.uniform1f(displayU.uVignette, cfg.vignette * (1 - a.active));
      gl.uniform1f(displayU.uTime, time);
      uploadAudioUniforms(gl, displayU, a);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawQuad(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // FBO sim resolution is fixed at 512x512.
      // Display pass viewport is set each frame in render().
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad || !simProg || !simU) return;

      lastAmbientTime = 0;
      nextAmbientInterval = 3.0 + Math.random() * 3.0;
      stepAccum = 0;
      lastOnsetCount = -1;
      lastBeatSeedTime = -1;
      clickBursts = [];

      // Initialize both FBO sides to A=1, B=0 (homogeneous state)
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Warm-up uses the catalogue defaults rather than the live config: the
      // pattern only nucleates reliably in the coral regime, and a creator can
      // park the sliders somewhere that never forms one from a cold field.
      const warmCfg: SimParams = { feed: 0.055, kill: 0.062, da: 1.0, db: 0.5 };

      // Seed random B spots to nucleate pattern formation
      const seedCount = 8 + Math.floor(Math.random() * 5);
      const baseSeed = performance.now();

      for (let i = 0; i < seedCount; i++) {
        stepSim(
          gl,
          0,
          {
            ...COAST,
            seedX: 0.15 + pseudoRandom(baseSeed + i * 7.3) * 0.7,
            seedY: 0.15 + pseudoRandom(baseSeed + i * 13.1 + 100.0) * 0.7,
            seedGain: 0.4,
          },
          warmCfg,
          null
        );
      }

      // Warm-up: run 60 coast steps to let pattern begin forming
      for (let w = 0; w < 60; w++) {
        stepSim(gl, 0, COAST, warmCfg, null);
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
