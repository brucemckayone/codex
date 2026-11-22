/**
 * Ink Dispersion renderer — implements ShaderRenderer.
 *
 * 3-channel advection-diffusion ink effect with ping-pong FBO simulation.
 * Buffer format: vec4(inkR, inkG, inkB, 1.0) where RGB = concentrations
 * of primary/secondary/accent brand-colored ink.
 *
 * Audio-reactive immersive mode uses the three ink channels as a natural
 * audio-band mapping:
 *   - Wanderer (noise-perturbed Lissajous point) lays a continuous PRIMARY
 *     ink trail every frame. This is the background "song line."
 *   - Bass rumble emitters orbit the canvas and deposit wide SECONDARY ink
 *     drops driven by `bassSmooth²`. Sustained low-end (meditation drones)
 *     produces visible atmospheric presence even without transients.
 *   - Beat onsets (`beatPulse > 0.2`) splash an ACCENT ink drop at the
 *     wanderer's position — a flash of third-colour on musical accents.
 *   - A smooth `wandererFade` (eased on play/pause) gates all audio-reactive
 *     deposits so nothing pops in/out.
 *
 * Display pass uses ACES tone-mapping with a pre-tonemap saturation pump,
 * a bass-breath UV warp on the ink sample, mid-driven brightness lift, and
 * a treble-driven wet-edge sharpening term for sparkle on ink boundaries.
 *
 * Simulation runs in a ping-pong double FBO shaped like the canvas (about 512²
 * texels, sim-grid.ts), on the step clock: 120 steps a second at any frame
 * rate, input on every second step. It used to run a square 512² grid (drops
 * drew as ellipses) a fixed number of steps per frame (twice as fast at 120
 * Hz), and started from clear water: black, or the bare ground, until something
 * stirred it. It now starts seeded and warmed, and a slow idle trail keeps it
 * alive with no audio. Display pass renders to the full canvas viewport.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  createDeltaClock,
  SILENT_AUDIO,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { createClickEdge } from '../click-edge';
import { computeImmersiveColours } from '../immersive-colours';
import { bindOutput } from '../output-target';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { InkConfig, ShaderConfig } from '../shader-config';
import { INK_DISPLAY_FRAG } from '../shaders/ink-display.frag';
import { INK_SIM_FRAG } from '../shaders/ink-sim.frag';
import {
  createStepClock,
  inputStride,
  type SimGrid,
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

/** Steps a second: what ink ran at 60 Hz (an input step and a coast step). */
const STEPS_PER_SECOND = 120;
const INPUT_STRIDE = inputStride(STEPS_PER_SECOND);

/** Ink init fragment shader — clear liquid (all zeros). */
const INK_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

// ── Channel conventions ──────────────────────────────────────
/** R channel → primary colour (wanderer trail). */
const CHANNEL_PRIMARY = 0;
/** G channel → secondary colour (bass rumble atmosphere). */
const CHANNEL_SECONDARY = 1;
/** B channel → accent colour (beat splash). */
const CHANNEL_ACCENT = 2;

// ── Wanderer tunables ────────────────────────────────────────
/** Wanderer path base frequencies — irrational ratio, never exactly repeats. */
const WANDERER_FREQ_X = 0.13;
const WANDERER_FREQ_Y = 0.19;
/** Slow phase-drift rates — reshape the Lissajous curve over ~minute timescales. */
const WANDERER_DRIFT_RATE_X = 0.017;
const WANDERER_DRIFT_RATE_Y = 0.023;
/** Base path radius (fraction of canvas half-width). Audio amplitude expands this. */
const WANDERER_BASE_RADIUS = 0.14;
const WANDERER_RADIUS_GAIN = 0.05;
/**
 * Continuous trail deposit strength — boosted so the wanderer reads as the
 * dominant visual actor. User direction: "the wanderer component needs more
 * power." Trail at peak amplitude = BASE + GAIN = 1.0; at quiet = 0.45.
 */
const WANDERER_TRAIL_BASE = 0.45;
const WANDERER_TRAIL_GAIN = 0.55;
/** Wanderer trail Gaussian radius multiplier — slightly larger than default
 * so the wanderer's path reads as a clear ribbon rather than a dotted line. */
const WANDERER_TRAIL_SIZE_MULT = 1.25;
/** Beat splash strength — scales with beatPulse at wanderer's current position. */
const WANDERER_SPLASH_BASE = 0.85;
const WANDERER_SPLASH_GAIN = 1.1;
/**
 * Beat-splash Gaussian radius multiplier — a bit larger than trail so the
 * accent flash reads as a distinct bloom rather than a trail dot.
 */
const WANDERER_SPLASH_SIZE_MULT = 1.5;
/** Fade curve for the wanderer — eases from 0 on pause/resume. */
const WANDERER_FADE_RATE = 2.5;
/**
 * Wanderer channel cycle — duration (seconds) spent depositing into each
 * brand-ink channel before rotating. User direction: "wanderer should
 * produce its own colour effect." Instead of always painting primary, the
 * wanderer sweeps through primary → secondary → accent → primary on a slow
 * cycle, creating a multi-coloured ribbon that reads as the wanderer's
 * distinctive visual signature. Ink's diffusion blends the channel
 * transitions naturally.
 */
const WANDERER_CHANNEL_CYCLE_SECS = 2.5;

// ── Bass rumble emitter tunables ─────────────────────────────
/**
 * Complement to the beat-onset path — creates continuous secondary-channel
 * ink presence driven by smoothed bass envelope. Suitable for meditation /
 * drone content where there are no sharp onsets for the beat detector to
 * catch but clear low-end energy the viewer should *feel*.
 */
/** Below this smoothed-bass value, no rumble drops are emitted. */
const BASS_RUMBLE_FLOOR = 0.1;
/** Drop-size multiplier for rumble emitters — wider plumes on loud bass. */
const BASS_RUMBLE_SIZE_MULT = 2.5;
/** Orbit rate of rumble emitters around canvas centre (radians/sec). */
const BASS_ORBIT_RATE = 0.23;
/** Emitter orbit radius baseline + breathing amplitude. */
const BASS_ORBIT_R_BASE = 0.32;
const BASS_ORBIT_R_BREATH = 0.06;

// ── Ambient drip / mouse tunables ────────────────────────────
/** Ambient drip interval during audio playback — sparse background life. */
const AMBIENT_INTERVAL_PLAYING_MIN = 3.5;
const AMBIENT_INTERVAL_PLAYING_MAX = 5.5;
/** Ambient drip interval when idle (audio paused / hero mode). */
const AMBIENT_INTERVAL_IDLE_MIN = 2.0;
const AMBIENT_INTERVAL_IDLE_MAX = 3.5;
/** Hover-channel rotation period (was 45 frames: 0.75 s at 60 Hz). */
const HOVER_CHANNEL_ROTATE_SECS = 0.75;
/** Input steps a click burst lasts, cycling its three offset deposits. */
const CLICK_BURST_STEPS = 5;

// ── Seed and idle trail ──────────────────────────────────────
/** Drops a fresh surface starts with, cycling the three channels. */
const SEED_DROPS = 9;
const SEED_DROP_STRENGTH = 2.5;
/** Coast steps run after the seed: ~0.75 s of bloom, so frame one has ink. */
const SEED_WARMUP_STEPS = 90;
/**
 * The idle trail: with no audio, a slow path lays a faint ribbon through the
 * mouse slot (the wanderer's, during playback), so the water never empties.
 */
const IDLE_TRAIL_STRENGTH = 0.22;
const IDLE_TRAIL_SIZE_MULT = 1.6;

/** One Gaussian deposit: where, how strong, which ink, and its radius. */
interface Deposit {
  x: number;
  y: number;
  strength: number;
  channel: number;
  /** Radius override; the config's drop size when absent. */
  size?: number;
}

/** An empty slot: off the grid, nothing laid. */
const NO_DEPOSIT: Deposit = { x: -10, y: -10, strength: 0, channel: 0 };

/** Uniform name lists for type-safe location lookup. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uDiffusion',
  'uAdvection',
  'uDropSize',
  'uEvaporation',
  'uCurl',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
  'uInkChannel',
  'uDropPos',
  'uDropChannel',
  ...AUDIO_UNIFORM_NAMES,
] as const;

const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uTexel',
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

export function createInkRenderer(): ShaderRenderer {
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

  const audioFade = createAudioFade();
  const _deltaClock = createDeltaClock();
  let simBuf: DoubleFBO | null = null;
  let grid: SimGrid = simGridFor(0, 0);
  const clock = createStepClock(STEPS_PER_SECOND);
  const clickEdge = createClickEdge();
  /** Seed + warm-up on the next frame (set by reset()). */
  let seedPending = false;
  /** An ambient drop due, held until an input step lays it. */
  let pendingDrop: { x: number; y: number; channel: number } | null = null;

  /** Timestamp (seconds) of last ambient drop. */
  let lastAmbientTime = 0;

  /** Next ambient drop interval (randomized). */
  let nextAmbientInterval =
    AMBIENT_INTERVAL_IDLE_MIN +
    Math.random() * (AMBIENT_INTERVAL_IDLE_MAX - AMBIENT_INTERVAL_IDLE_MIN);

  /** Current rotating channel for ambient drops (0, 1, 2). */
  let ambientChannel = 0;

  /** Active click bursts: one per click, over CLICK_BURST_STEPS input steps. */
  let clickBursts: Array<{
    x: number;
    y: number;
    applied: number;
    offsets: Array<{ dx: number; dy: number; channel: number }>;
  }> = [];

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Prevents ink deposits from popping into existence — meditation-first
   * content needs gentle onsets and offsets.
   */
  let wandererFade = 0;
  /**
   * This frame's resolved audio, shared with the sim pass.
   *
   * The sim runs from a helper that has no access to the render scope, and
   * uniforms are PER-PROGRAM state — so the block has to be uploaded on both
   * passes, not just the display one. Mirrors how this file already hands
   * `wandererFade` across the same boundary.
   */
  let resolvedAudio = SILENT_AUDIO;

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    time: number,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    inkChannel: number,
    dropX: number,
    dropY: number,
    dropChannel: number,
    cfg: InkConfig,
    /** Optional override for Gaussian deposit radius (default = cfg.dropSize). */
    dropSizeOverride?: number
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;

    gl.viewport(0, 0, grid.w, grid.h);
    gl.useProgram(simProg);
    uploadAudioUniforms(gl, simU, resolvedAudio);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    gl.uniform2f(simU.uTexel, 1.0 / grid.w, 1.0 / grid.h);
    gl.uniform1f(simU.uDiffusion, cfg.diffusion);
    gl.uniform1f(simU.uAdvection, cfg.advection);
    gl.uniform1f(simU.uDropSize, dropSizeOverride ?? cfg.dropSize);
    gl.uniform1f(simU.uEvaporation, cfg.evaporation);
    gl.uniform1f(simU.uCurl, cfg.curl);
    gl.uniform1f(simU.uTime, time);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);
    gl.uniform1f(simU.uInkChannel, inkChannel);
    gl.uniform2f(simU.uDropPos, dropX, dropY);
    gl.uniform1f(simU.uDropChannel, dropChannel);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    bindOutput(gl);
    simBuf.swap();
  }

  /**
   * Wanderer position — noise-perturbed Lissajous. Bounded to the middle of
   * the canvas so deposits don't spawn on the edge-damping rim. Never exactly
   * repeats; the slow `sin(drift)` term reshapes the curve over minutes.
   */
  function wandererPosition(
    time: number,
    amplitudeSmooth: number
  ): { x: number; y: number } {
    const radius =
      WANDERER_BASE_RADIUS + WANDERER_RADIUS_GAIN * amplitudeSmooth;
    const driftX = Math.sin(time * WANDERER_DRIFT_RATE_X) * 2.0;
    const driftY = Math.sin(time * WANDERER_DRIFT_RATE_Y + 1.3) * 1.7;
    const x = 0.5 + radius * Math.sin(time * WANDERER_FREQ_X + driftX);
    const y = 0.5 + radius * Math.cos(time * WANDERER_FREQ_Y + driftY);
    return { x, y };
  }

  /** The idle trail's path: slow, wide, never quite repeating. */
  function idlePosition(time: number): { x: number; y: number } {
    const x = 0.5 + 0.3 * Math.sin(time * 0.11 + Math.sin(time * 0.031) * 2.0);
    const y =
      0.5 + 0.26 * Math.cos(time * 0.083 + Math.sin(time * 0.027 + 1.1) * 1.7);
    return { x, y };
  }

  return {
    init(gl: WebGL2RenderingContext, width: number, height: number): boolean {
      // Check required extensions
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, INK_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, INK_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, INK_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      grid = simGridFor(width, height);
      simBuf = createDoubleFBO(gl, grid.w, grid.h);

      // Clear liquid, seeded on the first frame
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

      const cfg = config as InkConfig;
      const bassSmooth = audio?.bassSmooth ?? 0;
      const amplitudeSmooth = audio?.amplitudeSmooth ?? 0;
      const beatPulse = audio?.beatPulse ?? 0;
      const audioActive = audio?.active ?? false;

      // One clock for the frame: dt and this frame's simulation steps.
      const { steps, first, dt } = clock.tick(time);
      // Shared vocabulary + the five signals this preset never had.
      const a = audioFade.update(audio, dt);
      resolvedAudio = a;

      // Ease wanderer fade toward 1 (audio playing) or 0 (paused).
      const fadeTarget = audioActive ? 1 : 0;
      wandererFade +=
        (fadeTarget - wandererFade) * Math.min(1, dt * WANDERER_FADE_RATE);

      // ── Per-frame state ────────────────────────────────────
      // Channels, timers and the click edge follow time and are caught on
      // the frame they land. Nothing here steps the simulation: the input
      // steps below do, on the step clock.
      const hoverChannel = Math.floor(time / HOVER_CHANNEL_ROTATE_SECS) % 3;

      // ── Ambient drip: sparse background life ────────────────
      // Held until an input step lays it (a 120 Hz frame may have none).
      const ambientMin = audioActive
        ? AMBIENT_INTERVAL_PLAYING_MIN
        : AMBIENT_INTERVAL_IDLE_MIN;
      const ambientMax = audioActive
        ? AMBIENT_INTERVAL_PLAYING_MAX
        : AMBIENT_INTERVAL_IDLE_MAX;
      if (time - lastAmbientTime > nextAmbientInterval) {
        lastAmbientTime = time;
        nextAmbientInterval =
          ambientMin + Math.random() * (ambientMax - ambientMin);
        pendingDrop = {
          x: 0.15 + Math.random() * 0.7,
          y: 0.15 + Math.random() * 0.7,
          channel: ambientChannel,
        };
        ambientChannel = (ambientChannel + 1) % 3;
      }

      // ── Click: ONE burst of 3 offset deposits (one per channel) ──
      // click-edge.ts. A burst used to be queued on every frame
      // burstStrength was above zero: ~28 per click at 60 Hz.
      if (clickEdge.clicked(mouse.burstStrength)) {
        const spread = cfg.dropSize * 2.5;
        clickBursts.push({
          x: mouse.x,
          y: mouse.y,
          applied: 0,
          offsets: [
            { dx: 0, dy: 0, channel: CHANNEL_PRIMARY },
            { dx: spread, dy: -spread * 0.5, channel: CHANNEL_SECONDARY },
            { dx: -spread, dy: spread * 0.5, channel: CHANNEL_ACCENT },
          ],
        });
      }

      // ── Wanderer (audio) and the idle trail (no audio) ───────
      // The wanderer lays a continuous trail through the sim's mouse slot
      // during playback. With no audio, a slow idle trail takes the same
      // slot, so the water is never empty until someone stirs it; it fades
      // out as the wanderer fades in.
      const wanderer =
        wandererFade > 0.01 ? wandererPosition(time, amplitudeSmooth) : null;
      const wandererStr =
        (WANDERER_TRAIL_BASE + WANDERER_TRAIL_GAIN * amplitudeSmooth) *
        wandererFade;
      const wandererChannel =
        Math.floor(time / WANDERER_CHANNEL_CYCLE_SECS) % 3;
      const idleStr = IDLE_TRAIL_STRENGTH * (1 - wandererFade);
      const idle = idleStr > 0.005 ? idlePosition(time) : null;

      // ── Bass rumble emitters — SECONDARY channel ─────────────
      // Sustained low-end (drones, pads) has no transients for the onset
      // detector, but there IS bass energy the viewer should feel: 1-4 wide
      // SECONDARY drops at orbiting positions, each in its own sim step.
      const emitRumble =
        audioActive && bassSmooth > BASS_RUMBLE_FLOOR && wandererFade > 0.01;
      const rumbleEmitterCount = emitRumble
        ? Math.min(4, 1 + Math.floor(bassSmooth * 6))
        : 0;
      const rumbleSize = cfg.dropSize * BASS_RUMBLE_SIZE_MULT;

      const mouseAttenuation = audioActive
        ? Math.max(0.45, 1.0 - 0.55 * amplitudeSmooth)
        : 1.0;

      /** A sim step with one deposit in the mouse slot and none in the drop slot. */
      const depositStep = (
        x: number,
        y: number,
        strength: number,
        channel: number,
        size?: number
      ) =>
        stepSim(
          gl,
          time,
          x,
          y,
          true,
          strength,
          channel,
          -10,
          -10,
          0,
          cfg,
          size
        );

      /**
       * The input step's impulses, in the order they ran per frame: click
       * bursts, the main step (wanderer or idle trail or hover, plus the
       * ambient drop), hover during playback, the beat splash, the rumble.
       * Each is a sim step of its own, so they run on the clock's input
       * steps (60 a second at any frame rate). They ran once a FRAME, so at
       * 120 Hz the ink ran twice as fast. At 60 Hz the count and order are
       * what they were. One closure per group, run in that order.
       */
      const burstSteps = (): void => {
        for (let i = clickBursts.length - 1; i >= 0; i--) {
          const burst = clickBursts[i];
          const off = burst.offsets[burst.applied % burst.offsets.length];
          const str = 2.5 * (1.0 - burst.applied / CLICK_BURST_STEPS);
          depositStep(burst.x + off.dx, burst.y + off.dy, str, off.channel);
          burst.applied++;
          if (burst.applied >= CLICK_BURST_STEPS) clickBursts.splice(i, 1);
        }
      };

      /**
       * This frame's trail, laid in the mouse slot of the main step: the
       * wanderer during playback, else the pointer, else the idle path.
       */
      const trail: Deposit | null = wanderer
        ? {
            x: wanderer.x,
            y: wanderer.y,
            strength: wandererStr,
            channel: wandererChannel,
            size: cfg.dropSize * WANDERER_TRAIL_SIZE_MULT,
          }
        : mouse.active
          ? {
              x: mouse.x,
              y: mouse.y,
              strength: mouseAttenuation,
              channel: hoverChannel,
            }
          : idle && {
              x: idle.x,
              y: idle.y,
              strength: idleStr,
              channel: wandererChannel,
              size: cfg.dropSize * IDLE_TRAIL_SIZE_MULT,
            };

      /** The trail, with the ambient drop due; then hover during playback. */
      const mainStep = (): void => {
        const at = trail ?? NO_DEPOSIT;
        const drop = pendingDrop ?? NO_DEPOSIT;
        pendingDrop = null;
        stepSim(
          gl,
          time,
          at.x,
          at.y,
          trail !== null,
          at.strength,
          at.channel,
          drop.x,
          drop.y,
          drop.channel,
          cfg,
          at.size
        );
        if (wanderer && mouse.active) {
          depositStep(mouse.x, mouse.y, mouseAttenuation, hoverChannel);
        }
      };

      /** The sound's own steps: the beat splash, then the bass rumble. */
      const soundSteps = (): void => {
        // Beat-synced ACCENT splash, gated on an audible pulse.
        if (wanderer && beatPulse > 0.2 && audioActive) {
          const splashStrength =
            (WANDERER_SPLASH_BASE + WANDERER_SPLASH_GAIN * beatPulse) *
            wandererFade;
          depositStep(
            wanderer.x,
            wanderer.y,
            splashStrength,
            CHANNEL_ACCENT,
            cfg.dropSize * WANDERER_SPLASH_SIZE_MULT
          );
        }

        for (let i = 0; i < rumbleEmitterCount; i++) {
          const orbitT = time * BASS_ORBIT_RATE;
          const angle = orbitT + (i * (Math.PI * 2)) / rumbleEmitterCount;
          const r =
            BASS_ORBIT_R_BASE +
            BASS_ORBIT_R_BREATH * Math.sin(time * 0.11 + i * 1.7);
          // The drop slot, so it does not fight the wanderer/mouse slot.
          stepSim(
            gl,
            time,
            -10,
            -10,
            false,
            0,
            0,
            0.5 + r * Math.cos(angle),
            0.5 + r * Math.sin(angle),
            CHANNEL_SECONDARY,
            cfg,
            rumbleSize
          );
        }
      };

      const inputStep = (): void => {
        burstSteps();
        mainStep();
        soundSteps();
      };

      // ── A fresh surface starts with ink already blooming ─────
      if (seedPending) {
        seedPending = false;
        for (let i = 0; i < SEED_DROPS; i++) {
          depositStep(
            0.15 + Math.random() * 0.7,
            0.15 + Math.random() * 0.7,
            SEED_DROP_STRENGTH,
            i % 3,
            cfg.dropSize * (1.2 + Math.random() * 1.3)
          );
        }
        for (let i = 0; i < SEED_WARMUP_STEPS; i++) {
          stepSim(gl, time, -10, -10, false, 0, 0, -10, -10, 0, cfg);
        }
        lastAmbientTime = time;
      }

      // Steps follow elapsed time, so 120 Hz runs ink at 60 Hz speed. Input
      // lands on a fixed stride of steps (60 a second at any frame rate);
      // the rest coast.
      for (let i = 0; i < steps; i++) {
        if ((first + i) % INPUT_STRIDE === 0) inputStep();
        else stepSim(gl, time, -10, -10, false, 0, 0, -10, -10, 0, cfg);
      }

      // ── Display pass ───────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      uploadAudioUniforms(gl, displayU, a);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);
      gl.uniform2f(displayU.uTexel, 1.0 / grid.w, 1.0 / grid.h);

      // ── Immersive colour cycling ───────────────────────────
      // Uses smoothed amplitude so phase nudge doesn't jitter.
      const colours = audioActive
        ? computeImmersiveColours(time, cfg.colors, amplitudeSmooth)
        : cfg.colors;

      gl.uniform3fv(displayU.uColorPrimary, colours.primary);
      gl.uniform3fv(displayU.uColorSecondary, colours.secondary);
      gl.uniform3fv(displayU.uColorAccent, colours.accent);
      gl.uniform3fv(displayU.uBgColor, colours.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(displayU.uVignette, audioActive ? 0.0 : cfg.vignette);
      gl.uniform1f(displayU.uTime, time);

      // Full-spectrum modulation — see display shader for exact mappings.

      bindOutput(gl);
      drawQuad(gl);
    },

    resize(gl: WebGL2RenderingContext, width: number, height: number): void {
      // Shared rule (`resizeSim` in sim-resize.ts): rebuild only on a real
      // change of shape, never on a lost context, allocating before
      // destroying. The new grid is reseeded. The display viewport is set
      // each frame in render().
      const resized = resizeSim(gl, grid, simBuf, width, height);
      if (!resized) return;
      grid = resized.grid;
      simBuf = resized.buf;
      this.reset(gl);
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastAmbientTime = 0;
      nextAmbientInterval =
        AMBIENT_INTERVAL_IDLE_MIN +
        Math.random() * (AMBIENT_INTERVAL_IDLE_MAX - AMBIENT_INTERVAL_IDLE_MIN);
      ambientChannel = 0;
      clickBursts = [];
      pendingDrop = null;
      wandererFade = 0;
      clock.reset();
      seedPending = true;

      gl.viewport(0, 0, grid.w, grid.h);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Zero out both FBO sides (clear liquid)
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.read.fbo);
      drawQuad(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
      drawQuad(gl);
      bindOutput(gl);
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
