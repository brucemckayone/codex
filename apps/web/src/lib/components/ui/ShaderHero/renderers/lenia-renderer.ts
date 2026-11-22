/**
 * Lenia (continuous cellular automata) renderer — implements ShaderRenderer.
 *
 * Three programs over a ping-pong FBO of the canvas's shape at about 256²
 * texels (sim-grid.ts): init (smooth Gaussian blob seeds), sim (bump-kernel
 * convolution + Gaussian growth), display (four-stop concentric ramp).
 * `speed` sets the steps a second (x 60); `dt` the integration step.
 *
 * ## What changed and why
 *
 * - The step clock: `speed` x 60 steps a second at any frame rate, input on
 *   60 of them. It ran `speed` substeps a frame with a frame-scaled dt,
 *   clamped, so a 144 Hz display still ran about 20% fast.
 * - One click lays one burst (click-edge.ts). A burst was queued on every
 *   frame the click's strength was above zero, about 28 per click.
 * - The grid has the canvas's shape: a square one stretched every creature
 *   1.8x wide on a 16:9 hero.
 * - The warm-up runs the brand's own rules, so the first frame (a reduced
 *   motion still) shows creatures grown under the rules the hero then plays.
 * - The lab's tuning (radius 15, growth 0.2, width 0.05, speed 4, dt 0.5)
 *   is the default.
 *
 * ## Kept
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
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  type ResolvedAudio,
  SILENT_AUDIO,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { createClickEdge } from '../click-edge';
import { bindOutput } from '../output-target';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { LeniaConfig, ShaderConfig } from '../shader-config';
import { LENIA_DISPLAY_FRAG } from '../shaders/lenia-display.frag';
import { LENIA_GRID_BASE, LENIA_SIM_FRAG } from '../shaders/lenia-sim.frag';
import {
  createStepClock,
  inputStride,
  type SimGrid,
  type StepClock,
  simGridFor,
} from '../sim-grid';
import { resizeSim } from '../sim-resize';
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

/** Input steps one click's burst lasts (what 5 frames were at 60 Hz). */
const CLICK_BURST_STEPS = 5;
const CLICK_BURST_STRENGTH = 0.6;
const HOVER_STRENGTH = 0.3;
/** Mass of an ambient drop. */
const AMBIENT_DROP_GAIN = 0.4;
/**
 * Mass of a beat's drop (plus bass). A beat-seeded blob needs enough mass to
 * survive its first few relaxation steps; below about 0.35 the convolution
 * never reaches mu and the blob evaporates instead of becoming a creature.
 */
const BEAT_DROP_GAIN = 0.45;
/** Steps run before the first frame shows, so creatures have formed. */
const WARMUP_STEPS = 50;
/** Off the grid: a pointer or drop parked here lays nothing. */
const OFF = -10;
const NO_TOUCH = { x: OFF, y: OFF, strength: 0 };
const NO_DROP = { x: OFF, y: OFF, gain: 0 };

/** The speed slider, as whole steps per 60 Hz frame (1 to 4). */
function stepsPerFrame(speed: number | undefined): number {
  return Math.min(4, Math.max(1, Math.round(speed ?? 2)));
}

/**
 * The field wraps at its edges (a torus): the kernel reads across an edge
 * from the other side, so no edge is dead space and no frame is drawn.
 */
function wrapGrid(gl: WebGL2RenderingContext, buf: DoubleFBO): void {
  for (const side of [buf.read, buf.write]) {
    gl.bindTexture(gl.TEXTURE_2D, side.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
}

/**
 * A clock for `perFrame` x 60 steps a second. A slow frame catches up to
 * twice a 60 Hz frame's steps, and never fewer than 4, so 30 fps (iOS Low
 * Power) keeps full speed at speed 4 and 20 fps at speed 1; a longer stall
 * drops the rest rather than snowballing.
 */
function leniaClock(perFrame: number): StepClock {
  return createStepClock(perFrame * 60, Math.max(4, 2 * perFrame));
}

/**
 * Grid sides round to 16 texels: lenia seeds Gaussian blobs, not a periodic
 * noise, and 64-texel sides on its small 256² grid made ovals on tablets.
 */
const LENIA_GRID_CELL = 16;

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

uniform vec2 uTexel;

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
    // In base texels, so a blob is round on a canvas-shaped grid.
    vec2 d = (v_uv - center) / uTexel / ${LENIA_GRID_BASE}.0;
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

  let initTexelU: WebGLUniformLocation | null = null;
  let quad: ReturnType<typeof createQuad> | null = null;
  let grid: SimGrid = simGridFor(0, 0, LENIA_GRID_BASE, LENIA_GRID_CELL);
  let simBuf: DoubleFBO | null = null;

  /** Timestamp of last ambient deposit. */
  let lastAmbientTime = 0;
  /** Next ambient deposit interval (4-7s). */
  let nextAmbientInterval = 4.0 + Math.random() * 3.0;
  /** Drops due, laid one an input step. */
  let pendingDrops: Array<{ x: number; y: number; gain: number }> = [];
  /** The latest click's burst: a new click restarts it where it lands. */
  let burst: { x: number; y: number; applied: number } | null = null;
  let seedPending = true;

  // Per-instance, never module-level: a hero and an immersive overlay are two
  // live renderers and would otherwise share and fight over this state.
  const audioFade = createAudioFade();
  const clickEdge = createClickEdge();
  /** The step clock, rebuilt when the speed slider moves. */
  let clockSpeed = stepsPerFrame(undefined);
  let stepClock = leniaClock(clockSpeed);

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
    cfg: LeniaConfig,
    audio: ResolvedAudio
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;

    gl.viewport(0, 0, grid.w, grid.h);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    gl.uniform2f(simU.uTexel, 1 / grid.w, 1 / grid.h);
    gl.uniform1f(simU.uRadius, cfg.radius);
    gl.uniform1f(simU.uGrowth, cfg.growth);
    gl.uniform1f(simU.uWidth, cfg.width);
    gl.uniform1f(simU.uDt, cfg.dt);
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
    bindOutput(gl);
    simBuf.swap();
  }

  /** Seed the blobs, then let them grow into creatures under these rules. */
  function seed(gl: WebGL2RenderingContext, cfg: LeniaConfig): void {
    if (!initProg || !simBuf || !quad) return;
    gl.viewport(0, 0, grid.w, grid.h);
    gl.useProgram(initProg);
    quad.bind(initProg);
    gl.uniform2f(initTexelU, 1 / grid.w, 1 / grid.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    bindOutput(gl);
    // Runs silent: this is bootstrapping the field, not playback, so reacting
    // to whatever was playing at reset would bake a transient into it.
    for (let i = 0; i < WARMUP_STEPS; i++) {
      stepSim(gl, OFF, OFF, false, 0, OFF, OFF, 0, cfg, SILENT_AUDIO);
    }
  }

  /**
   * The musical clock for the core pulse: blend RATES, then integrate. A
   * frame on the same timestamp as the last (dt 0: Firefox's coarsened
   * performance.now) leaves it: the rate would be x / 0, and NaN sticks.
   */
  function advancePulse(dt: number, a: ResolvedAudio): void {
    if (!(dt > 0)) return;
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
  }

  /** Drops due this frame: every 4-7 s (sooner with sound), one a beat. */
  function queueDrops(time: number, a: ResolvedAudio): void {
    const interval = a.silent
      ? nextAmbientInterval
      : Math.max(2.0, nextAmbientInterval - a.energy * 2.0);
    if (time - lastAmbientTime > interval) {
      lastAmbientTime = time;
      nextAmbientInterval = 4.0 + Math.random() * 3.0;
      pendingDrops.push({
        x: 0.15 + Math.random() * 0.7,
        y: 0.15 + Math.random() * 0.7,
        gain: AMBIENT_DROP_GAIN,
      });
    }
    // One colony per detected onset, keyed on onsetCount changing; placed by
    // beatSeed, so consecutive beats walk around the field.
    if (!a.silent && a.onsetCount !== lastOnsetSeen) {
      lastOnsetSeen = a.onsetCount;
      pendingDrops.push({
        x: 0.2 + a.beatSeed * 0.6,
        y: 0.2 + ((a.beatSeed * 7.31) % 1.0) * 0.6,
        gain: BEAT_DROP_GAIN + a.bass * 0.3,
      });
    }
    // A backlog (a tab back from the background) lays the newest few.
    if (pendingDrops.length > 3) pendingDrops = pendingDrops.slice(-3);
  }

  /** Where this input step touches the field: a click's burst, or the hover. */
  function touch(mouse: MouseState): {
    x: number;
    y: number;
    strength: number;
  } {
    if (burst) {
      const at = {
        x: burst.x,
        y: burst.y,
        strength:
          CLICK_BURST_STRENGTH * (1 - burst.applied / CLICK_BURST_STEPS),
      };
      burst.applied++;
      if (burst.applied >= CLICK_BURST_STEPS) burst = null;
      return at;
    }
    if (!mouse.active) return NO_TOUCH;
    return { x: mouse.x, y: mouse.y, strength: HOVER_STRENGTH };
  }

  /** One input step: the pointer or a click's burst, and a drop if due. */
  function inputStep(
    gl: WebGL2RenderingContext,
    mouse: MouseState,
    cfg: LeniaConfig,
    a: ResolvedAudio
  ): void {
    const at = touch(mouse);
    const drop = pendingDrops.shift() ?? NO_DROP;
    stepSim(
      gl,
      at.x,
      at.y,
      at !== NO_TOUCH,
      at.strength,
      drop.x,
      drop.y,
      drop.gain,
      cfg,
      a
    );
  }

  /** The display pass: the field in the concentric brand ramp. */
  function displayPass(
    gl: WebGL2RenderingContext,
    cfg: LeniaConfig,
    a: ResolvedAudio,
    time: number,
    width: number,
    height: number
  ): void {
    if (!displayProg || !displayU || !simBuf || !quad) return;
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

    bindOutput(gl);
    drawQuad(gl);
  }

  return {
    init(gl: WebGL2RenderingContext, width: number, height: number): boolean {
      // Check required extensions for RGBA16F FBO
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, LENIA_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, LENIA_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, LENIA_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      initTexelU = gl.getUniformLocation(initProg, 'uTexel');
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      quad = createQuad(gl);
      grid = simGridFor(width, height, LENIA_GRID_BASE, LENIA_GRID_CELL);
      simBuf = createDoubleFBO(gl, grid.w, grid.h);
      wrapGrid(gl, simBuf);

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
      if (!simBuf) return;
      const cfg = config as LeniaConfig;
      // `speed` x 60 steps a second at any frame rate; a new speed is a new
      // clock. Input lands on 60 of them a second.
      const perFrame = stepsPerFrame(cfg.speed);
      if (perFrame !== clockSpeed) {
        clockSpeed = perFrame;
        stepClock = leniaClock(perFrame);
      }
      const { steps, first, dt } = stepClock.tick(time);
      const a = audioFade.update(audio, dt);
      advancePulse(dt, a);

      if (seedPending) {
        seedPending = false;
        seed(gl, cfg);
        lastAmbientTime = time;
      }

      queueDrops(time, a);
      // One burst per click (click-edge.ts).
      if (clickEdge.clicked(mouse.burstStrength)) {
        burst = { x: mouse.x, y: mouse.y, applied: 0 };
      }

      const stride = inputStride(perFrame * 60);
      for (let i = 0; i < steps; i++) {
        if ((first + i) % stride === 0) inputStep(gl, mouse, cfg, a);
        else stepSim(gl, OFF, OFF, false, 0, OFF, OFF, 0, cfg, a);
      }

      displayPass(gl, cfg, a, time, width, height);
    },

    resize(gl: WebGL2RenderingContext, width: number, height: number): void {
      // Shared rule (`resizeSim` in sim-resize.ts): rebuild only on a real
      // change of shape, never on a lost context, allocating before
      // destroying. The new grid is reseeded and regrown.
      const resized = resizeSim(
        gl,
        grid,
        simBuf,
        width,
        height,
        LENIA_GRID_BASE,
        LENIA_GRID_CELL
      );
      if (!resized) return;
      grid = resized.grid;
      simBuf = resized.buf;
      wrapGrid(gl, simBuf);
      this.reset(gl);
    },

    reset(_gl: WebGL2RenderingContext): void {
      lastAmbientTime = 0;
      nextAmbientInterval = 4.0 + Math.random() * 3.0;
      pendingDrops = [];
      burst = null;
      pulseClock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;
      stepClock.reset();
      seedPending = true;
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
      pendingDrops = [];
      burst = null;
    },
  };
}
