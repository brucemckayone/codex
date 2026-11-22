/**
 * Physarum renderer: a slime-mould vein network (Jones, 2010).
 *
 * 65,536 agents, one per texel of a 256x256 agent texture, follow the trail
 * they lay on a trail grid of the canvas's shape (sim-grid.ts). Each step
 * runs three passes (physarum-sim.frag.ts): the agents sense, turn and move;
 * the trail diffuses and decays and takes the pointer and food; then every
 * agent deposits where it stands, drawn as a point. The display shades the
 * trail in the brand ramp.
 *
 * Before the particles, agents were a density field moved through the trail
 * texture by a bilinear backtrace, which blurred them on every step, so the
 * preset showed a faint mist and never a vein (18 s in, in the lab). It also
 * ran two steps a frame (twice as fast at 120 Hz), queued a click burst on
 * every frame of the click's decay, and stretched a square 512x512 grid over
 * the canvas. Now:
 * - the network has grown before the first frame shows (WARMUP_STEPS), so
 *   the still frame (reduced motion) is veins, not speckle;
 * - it runs 120 steps a second at any frame rate, input on every second
 *   step (the step clock);
 * - one click lays one burst of food over CLICK_BURST_STEPS input steps;
 * - the trail grid has the canvas's shape, so the veins are not stretched.
 *
 * Mouse and touch lay trail, so the agents gather to the pointer; ambient
 * food drops every 2-4 s (and one on every beat with sound) keep the network
 * re-routing.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  type ResolvedAudio,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { createClickEdge } from '../click-edge';
import { bindOutput } from '../output-target';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { ShaderConfig } from '../shader-config';
import { PHYSARUM_DISPLAY_FRAG } from '../shaders/physarum-display.frag';
import {
  PHYSARUM_INIT_FRAG,
  PHYSARUM_REMAP_FRAG,
} from '../shaders/physarum-init.frag';
import {
  PHYSARUM_AGENT_FRAG,
  PHYSARUM_DEPOSIT_FRAG,
  PHYSARUM_SIM_FRAG,
} from '../shaders/physarum-sim.frag';
import { PHYSARUM_DEPOSIT_VERT } from '../shaders/physarum-sim.vert';
import {
  createStepClock,
  inputStride,
  type SimGrid,
  simGridFor,
} from '../sim-grid';
import { resizeSim } from '../sim-resize';
import {
  createDoubleFBO,
  createFBOWithFormat,
  createProgram,
  createQuad,
  type DoubleFBO,
  destroyDoubleFBO,
  drawQuad,
  type FBO,
  getUniforms,
  VERTEX_SHADER,
} from '../webgl-utils';

/** Steps a second: what physarum ran at 60 Hz (two a frame). */
const STEPS_PER_SECOND = 120;
const INPUT_STRIDE = inputStride(STEPS_PER_SECOND);
/** The agent texture's side: AGENT_SIDE² agents. */
const AGENT_SIDE = 256;
const AGENT_COUNT = AGENT_SIDE * AGENT_SIDE;
/**
 * Steps run before the first frame shows, so the network has grown: 60 draw
 * a fine mesh, 120 clear veins (lab stills, Tide and OBB). About 55 ms of
 * GPU on a Mac, once per seed.
 */
const WARMUP_STEPS = 120;
/**
 * Steps run after a rotate (a real change of shape). The agents are kept
 * (their positions are uv, so they still lie along the veins); only the
 * trail is new, and the agents re-lay it in a step or two. 12 steps cost
 * about a tenth of the warm-up, once.
 */
const REGROW_STEPS = 12;
/** Input steps one click's burst lasts, and its first push. */
const CLICK_BURST_STEPS = 6;
const CLICK_BURST_STRENGTH = 3.0;
/** The hover's push on each input step. */
const HOVER_STRENGTH = 1.0;
/** Gain of a food drop. */
const FOOD_GAIN = 0.4;
/** Trail one agent lays a step, at the default decay. */
const DEPOSIT_PER_AGENT = 0.05;
/** How fast the decay slider's range fades the trail (see physarumRetain). */
const FADE_PER_STEP = 0.4;
/** Off the grid: a pointer or drop parked here lays nothing. */
const OFF = -10;

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

/**
 * The trail kept a step, from the decay slider (0.95 to 0.999). Its fade
 * rate follows the square root of (1 - decay), so the slider's ends are 7x
 * apart, not 50x: at 0.999 a vein still fades in about a second instead of
 * filling the frame (OBB stores 0.999). The deposit is scaled by the same
 * rate, so decay sets how long veins last and the deposit how bright.
 */
function physarumRetain(decay: number): number {
  const d = Math.min(Math.max(decay, 0.9), 0.9999);
  return 1 - FADE_PER_STEP * Math.sqrt(1 - d);
}

const AGENT_UNIFORM_NAMES = [
  'uAgents',
  'uTrail',
  'uTexel',
  'uSensor',
  'uTurn',
  'uStep',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const TRAIL_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDiffusion',
  'uRetain',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uDropPos',
  'uDropGain',
] as const;

const DEPOSIT_UNIFORM_NAMES = [
  'uAgents',
  'uAgentSide',
  'uDeposit',
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

type Locations<T extends readonly string[]> = Record<
  T[number],
  WebGLUniformLocation | null
>;

/** What an input step lays on the trail: the pointer and one food drop. */
interface TrailInput {
  mx: number;
  my: number;
  mouseOn: boolean;
  mouseStrength: number;
  dropX: number;
  dropY: number;
  dropGain: number;
}

const NO_INPUT: TrailInput = {
  mx: OFF,
  my: OFF,
  mouseOn: false,
  mouseStrength: 0,
  dropX: OFF,
  dropY: OFF,
  dropGain: 0,
};

/** The agents: 32-bit float positions, read texel by texel (no filtering). */
function createAgentBuffers(gl: WebGL2RenderingContext): DoubleFBO {
  const make = (): FBO =>
    createFBOWithFormat(
      gl,
      AGENT_SIDE,
      AGENT_SIDE,
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      gl.NEAREST
    );
  let a = make();
  let b = make();
  return {
    get read() {
      return a;
    },
    get write() {
      return b;
    },
    swap() {
      [a, b] = [b, a];
    },
  };
}

export function createPhysarumRenderer(): ShaderRenderer {
  let initProg: WebGLProgram | null = null;
  let agentProg: WebGLProgram | null = null;
  let trailProg: WebGLProgram | null = null;
  let depositProg: WebGLProgram | null = null;
  let displayProg: WebGLProgram | null = null;
  let initSeedU: WebGLUniformLocation | null = null;
  let remapProg: WebGLProgram | null = null;
  let remapAgentsU: WebGLUniformLocation | null = null;
  let remapScaleU: WebGLUniformLocation | null = null;
  /**
   * The canvas the agents were last laid out on, set on EVERY resize: a
   * same-shape resize scales their uv places with it, so a later rotate
   * remaps from this size, not from the one the grid was built for.
   */
  let agentCanvas = { w: 0, h: 0 };
  let agentU: Locations<typeof AGENT_UNIFORM_NAMES> | null = null;
  let trailU: Locations<typeof TRAIL_UNIFORM_NAMES> | null = null;
  let depositU: Locations<typeof DEPOSIT_UNIFORM_NAMES> | null = null;
  let displayU: Locations<typeof DISPLAY_UNIFORM_NAMES> | null = null;

  let quad: ReturnType<typeof createQuad> | null = null;
  /** An empty vertex array: the deposit draws read no attributes. */
  let pointsVao: WebGLVertexArrayObject | null = null;
  let grid: SimGrid = simGridFor(0, 0);
  let trailBuf: DoubleFBO | null = null;
  let agentBuf: DoubleFBO | null = null;

  const audioFade = createAudioFade();
  const stepClock = createStepClock(STEPS_PER_SECOND);
  const clickEdge = createClickEdge();
  let seedPending = true;
  /** A new trail grid after a rotate: regrow it from the agents kept. */
  let regrowPending = false;

  /** Timestamp (seconds) of the last ambient drop, and the next interval. */
  let lastAmbientTime = 0;
  let nextAmbientInterval = 2.0 + Math.random() * 2.0;
  /** Food due, laid one an input step. */
  let pendingDrops: Array<{ x: number; y: number; gain: number }> = [];
  /** The latest click's burst: a new click restarts it where it lands. */
  let burst: { x: number; y: number; applied: number } | null = null;

  /** Accumulated junction-pulse phase, monotone by construction. */
  let clock = 0;
  /** Previous beatPhase sample, or -1 when there is none to difference. */
  let prevBeatPhase = -1;
  /** Last onset acted on, so a beat drops exactly one food source. */
  let lastOnsetSeen = -1;

  function agentPass(
    gl: WebGL2RenderingContext,
    index: number,
    cfg: PhysarumCfg,
    audio: ResolvedAudio
  ): void {
    if (!agentProg || !agentU || !agentBuf || !trailBuf || !quad) return;
    gl.viewport(0, 0, AGENT_SIDE, AGENT_SIDE);
    gl.useProgram(agentProg);
    quad.bind(agentProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, agentBuf.read.tex);
    gl.uniform1i(agentU.uAgents, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, trailBuf.read.tex);
    gl.uniform1i(agentU.uTrail, 1);
    gl.uniform2f(agentU.uTexel, 1 / grid.w, 1 / grid.h);
    gl.uniform1f(agentU.uSensor, cfg.sensor ?? DEFAULTS.sensor);
    gl.uniform1f(agentU.uTurn, cfg.turn ?? DEFAULTS.turn);
    gl.uniform1f(agentU.uStep, index);
    uploadAudioUniforms(gl, agentU, audio);
    gl.bindFramebuffer(gl.FRAMEBUFFER, agentBuf.write.fbo);
    drawQuad(gl);
    agentBuf.swap();
  }

  function trailPass(
    gl: WebGL2RenderingContext,
    input: TrailInput,
    cfg: PhysarumCfg
  ): void {
    if (!trailProg || !trailU || !trailBuf || !quad) return;
    gl.viewport(0, 0, grid.w, grid.h);
    gl.useProgram(trailProg);
    quad.bind(trailProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trailBuf.read.tex);
    gl.uniform1i(trailU.uState, 0);
    gl.uniform2f(trailU.uTexel, 1 / grid.w, 1 / grid.h);
    gl.uniform1f(trailU.uDiffusion, cfg.diffusion ?? DEFAULTS.diffusion);
    gl.uniform1f(trailU.uRetain, physarumRetain(cfg.decay ?? DEFAULTS.decay));
    gl.uniform2f(trailU.uMouse, input.mx, input.my);
    gl.uniform1f(trailU.uMouseActive, input.mouseOn ? 1 : 0);
    gl.uniform1f(trailU.uMouseStrength, input.mouseStrength);
    gl.uniform2f(trailU.uDropPos, input.dropX, input.dropY);
    gl.uniform1f(trailU.uDropGain, input.dropGain);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailBuf.write.fbo);
    drawQuad(gl);
    trailBuf.swap();
  }

  /** Every agent's deposit, added onto the trail it just stepped. */
  function depositPass(
    gl: WebGL2RenderingContext,
    cfg: PhysarumCfg,
    audio: ResolvedAudio
  ): void {
    if (!depositProg || !depositU || !agentBuf || !trailBuf || !pointsVao)
      return;
    gl.viewport(0, 0, grid.w, grid.h);
    gl.useProgram(depositProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, agentBuf.read.tex);
    gl.uniform1i(depositU.uAgents, 0);
    gl.uniform1i(depositU.uAgentSide, AGENT_SIDE);
    const fade = 1 - physarumRetain(cfg.decay ?? DEFAULTS.decay);
    const defaultFade = 1 - physarumRetain(DEFAULTS.decay);
    gl.uniform1f(
      depositU.uDeposit,
      DEPOSIT_PER_AGENT *
        (cfg.deposit ?? DEFAULTS.deposit) *
        (fade / defaultFade)
    );
    uploadAudioUniforms(gl, depositU, audio);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailBuf.read.fbo);
    gl.bindVertexArray(pointsVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, AGENT_COUNT);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function step(
    gl: WebGL2RenderingContext,
    index: number,
    input: TrailInput,
    cfg: PhysarumCfg,
    audio: ResolvedAudio
  ): void {
    agentPass(gl, index, cfg, audio);
    trailPass(gl, input, cfg);
    depositPass(gl, cfg, audio);
    bindOutput(gl);
  }

  /** Scatter the agents and clear the trail. */
  function seed(gl: WebGL2RenderingContext): void {
    if (!initProg || !agentBuf || !quad) return;
    gl.viewport(0, 0, AGENT_SIDE, AGENT_SIDE);
    gl.useProgram(initProg);
    quad.bind(initProg);
    gl.uniform1f(initSeedU, Math.random() * 100);
    gl.bindFramebuffer(gl.FRAMEBUFFER, agentBuf.read.fbo);
    drawQuad(gl);
    clearTrail(gl);
  }

  function clearTrail(gl: WebGL2RenderingContext): void {
    if (!trailBuf) return;
    gl.viewport(0, 0, grid.w, grid.h);
    gl.clearColor(0, 0, 0, 0);
    for (const side of [trailBuf.read, trailBuf.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, side.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    bindOutput(gl);
  }

  /**
   * The musical clock for the junction pulse: blend RATES, then integrate. A
   * frame on the same timestamp as the last (dt 0: Firefox's coarsened
   * performance.now) leaves it: the rate would be x / 0, and NaN sticks.
   */
  function advanceClock(dt: number, a: ResolvedAudio): void {
    if (!(dt > 0)) return;
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
  }

  /** Food due this frame: every 2-4 s (sooner with sound), and one a beat. */
  function queueFood(time: number, a: ResolvedAudio): void {
    const interval = a.silent
      ? nextAmbientInterval
      : Math.max(1.0, nextAmbientInterval - a.energy * 1.5);
    if (time - lastAmbientTime > interval) {
      lastAmbientTime = time;
      nextAmbientInterval = 2.0 + Math.random() * 2.0;
      pendingDrops.push({
        x: 0.15 + Math.random() * 0.7,
        y: 0.15 + Math.random() * 0.7,
        gain: FOOD_GAIN,
      });
    }
    // One per detected onset, keyed on onsetCount changing: beatPulse > x
    // is true on every frame of its decay, and would drop tens a second.
    if (!a.silent && a.onsetCount !== lastOnsetSeen) {
      lastOnsetSeen = a.onsetCount;
      pendingDrops.push({
        x: 0.15 + a.beatSeed * 0.7,
        y: 0.15 + ((a.beatSeed * 7.31) % 1.0) * 0.7,
        gain: FOOD_GAIN * (1 + a.bass * 0.8),
      });
    }
    // A backlog (a tab back from the background) lays the newest few.
    if (pendingDrops.length > 3) pendingDrops = pendingDrops.slice(-3);
  }

  /** What this input step lays: the pointer (or a click's burst) and food. */
  function nextInput(mouse: MouseState): TrailInput {
    const drop = pendingDrops.shift();
    const hover = mouse.active ? HOVER_STRENGTH : 0;
    let input: TrailInput = {
      ...NO_INPUT,
      mx: mouse.active ? mouse.x : OFF,
      my: mouse.active ? mouse.y : OFF,
      mouseOn: mouse.active,
      mouseStrength: hover,
    };
    if (burst) {
      input = {
        ...input,
        mx: burst.x,
        my: burst.y,
        mouseOn: true,
        mouseStrength:
          hover +
          CLICK_BURST_STRENGTH * (1 - burst.applied / CLICK_BURST_STEPS),
      };
      burst.applied++;
      if (burst.applied >= CLICK_BURST_STEPS) burst = null;
    }
    if (drop) {
      input = { ...input, dropX: drop.x, dropY: drop.y, dropGain: drop.gain };
    }
    return input;
  }

  /** Scatter the agents and run the network until it has grown. */
  function grow(
    gl: WebGL2RenderingContext,
    cfg: PhysarumCfg,
    a: ResolvedAudio
  ): void {
    seed(gl);
    for (let i = 0; i < WARMUP_STEPS; i++) step(gl, i, NO_INPUT, cfg, a);
  }

  /**
   * Keep each agent's pixel offset from the centre on a canvas of a new
   * shape (PHYSARUM_REMAP_FRAG): one pass over the 65,536 agents, one fetch
   * each.
   */
  function remapAgents(
    gl: WebGL2RenderingContext,
    width: number,
    height: number
  ): void {
    if (!remapProg || !agentBuf || !quad) return;
    if (!(agentCanvas.w > 0 && agentCanvas.h > 0)) return;
    gl.viewport(0, 0, AGENT_SIDE, AGENT_SIDE);
    gl.useProgram(remapProg);
    quad.bind(remapProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, agentBuf.read.tex);
    gl.uniform1i(remapAgentsU, 0);
    gl.uniform2f(remapScaleU, agentCanvas.w / width, agentCanvas.h / height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, agentBuf.write.fbo);
    drawQuad(gl);
    agentBuf.swap();
    bindOutput(gl);
  }

  /** A new trail after a rotate, re-laid by the agents kept. */
  function regrow(
    gl: WebGL2RenderingContext,
    cfg: PhysarumCfg,
    a: ResolvedAudio
  ): void {
    clearTrail(gl);
    for (let i = 0; i < REGROW_STEPS; i++) step(gl, i, NO_INPUT, cfg, a);
  }

  /** The display pass: the trail in the brand ramp. */
  function displayPass(
    gl: WebGL2RenderingContext,
    cfg: PhysarumCfg,
    a: ResolvedAudio,
    time: number,
    width: number,
    height: number
  ): void {
    if (!displayProg || !displayU || !trailBuf || !quad) return;
    gl.viewport(0, 0, width, height);
    gl.useProgram(displayProg);
    quad.bind(displayProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trailBuf.read.tex);
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

    bindOutput(gl);
    drawQuad(gl);
  }

  return {
    init(gl: WebGL2RenderingContext, width: number, height: number): boolean {
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_INIT_FRAG);
      remapProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_REMAP_FRAG);
      agentProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_AGENT_FRAG);
      trailProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_SIM_FRAG);
      depositProg = createProgram(
        gl,
        PHYSARUM_DEPOSIT_VERT,
        PHYSARUM_DEPOSIT_FRAG
      );
      displayProg = createProgram(gl, VERTEX_SHADER, PHYSARUM_DISPLAY_FRAG);
      if (
        !initProg ||
        !remapProg ||
        !agentProg ||
        !trailProg ||
        !depositProg ||
        !displayProg
      )
        return false;

      initSeedU = gl.getUniformLocation(initProg, 'uSeed');
      remapAgentsU = gl.getUniformLocation(remapProg, 'uAgents');
      remapScaleU = gl.getUniformLocation(remapProg, 'uScale');
      agentU = getUniforms(gl, agentProg, AGENT_UNIFORM_NAMES);
      trailU = getUniforms(gl, trailProg, TRAIL_UNIFORM_NAMES);
      depositU = getUniforms(gl, depositProg, DEPOSIT_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      quad = createQuad(gl);
      pointsVao = gl.createVertexArray();
      grid = simGridFor(width, height);
      agentCanvas = { w: width, h: height };
      trailBuf = createDoubleFBO(gl, grid.w, grid.h);
      agentBuf = createAgentBuffers(gl);

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
      if (!trailBuf || !agentBuf) return;
      const cfg = config as unknown as PhysarumCfg;

      // One clock for the frame: dt and this frame's simulation steps.
      const { steps, first, dt } = stepClock.tick(time);
      const a = audioFade.update(audio, dt);
      advanceClock(dt, a);

      // A fresh network has grown before anyone sees it.
      if (seedPending) {
        seedPending = false;
        regrowPending = false;
        grow(gl, cfg, a);
        lastAmbientTime = time;
      } else if (regrowPending) {
        regrowPending = false;
        regrow(gl, cfg, a);
      }

      // Timers and the click edge follow time and are caught on the frame
      // they land; the input steps below lay them.
      queueFood(time, a);
      // One burst per click (click-edge.ts). A burst used to be queued on
      // every frame the click's strength was above zero: ~28 per click.
      if (clickEdge.clicked(mouse.burstStrength)) {
        burst = { x: mouse.x, y: mouse.y, applied: 0 };
      }

      // Steps follow elapsed time, so 120 Hz runs at 60 Hz speed. Input lands
      // on a fixed stride of steps (60 a second at any frame rate).
      for (let i = 0; i < steps; i++) {
        const index = WARMUP_STEPS + first + i;
        const input =
          (first + i) % INPUT_STRIDE === 0 ? nextInput(mouse) : NO_INPUT;
        step(gl, index, input, cfg, a);
      }

      displayPass(gl, cfg, a, time, width, height);
    },

    resize(gl: WebGL2RenderingContext, width: number, height: number): void {
      // Shared rule (`resizeSim` in sim-resize.ts): rebuild only on a real
      // change of shape, never on a lost context, allocating before
      // destroying. Only the trail is new: the agents keep their pixel
      // offsets from the centre (remapAgents) and re-lay it (REGROW_STEPS),
      // so a rotate never re-runs the warm-up and the cells stay round.
      const resized = resizeSim(gl, grid, trailBuf, width, height);
      if (!resized) {
        agentCanvas = { w: width, h: height };
        return;
      }
      grid = resized.grid;
      trailBuf = resized.buf;
      remapAgents(gl, width, height);
      agentCanvas = { w: width, h: height };
      regrowPending = true;
    },

    reset(_gl: WebGL2RenderingContext): void {
      lastAmbientTime = 0;
      nextAmbientInterval = 2.0 + Math.random() * 2.0;
      pendingDrops = [];
      burst = null;
      clock = 0;
      prevBeatPhase = -1;
      lastOnsetSeen = -1;
      stepClock.reset();
      seedPending = true;
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (trailBuf) {
        destroyDoubleFBO(gl, trailBuf);
        trailBuf = null;
      }
      if (agentBuf) {
        destroyDoubleFBO(gl, agentBuf);
        agentBuf = null;
      }
      for (const prog of [
        initProg,
        remapProg,
        agentProg,
        trailProg,
        depositProg,
        displayProg,
      ]) {
        if (prog) gl.deleteProgram(prog);
      }
      initProg = remapProg = agentProg = trailProg = depositProg = null;
      displayProg = null;
      if (pointsVao) {
        gl.deleteVertexArray(pointsVao);
        pointsVao = null;
      }
      if (quad) {
        gl.deleteBuffer(quad.buffer);
        quad = null;
      }
      initSeedU = remapAgentsU = remapScaleU = null;
      agentU = trailU = depositU = displayU = null;
      pendingDrops = [];
      burst = null;
    },
  };
}
