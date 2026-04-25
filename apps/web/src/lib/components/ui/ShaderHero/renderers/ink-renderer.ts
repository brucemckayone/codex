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
 * Simulation runs at 512x512 in a ping-pong double FBO.
 * Display pass renders to the full canvas viewport.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { InkConfig, ShaderConfig } from '../shader-config';
import { INK_DISPLAY_FRAG } from '../shaders/ink-display.frag';
import { INK_SIM_FRAG } from '../shaders/ink-sim.frag';
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
/** Per-frame strength coefficient (applied to bassSmooth²). */
const BASS_RUMBLE_STRENGTH = 0.8;
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
/** Hover-channel rotation period (frames). */
const HOVER_CHANNEL_ROTATE_FRAMES = 45;

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
  'uBassSmooth',
  'uMidsSmooth',
  'uTrebleSmooth',
  'uAmplitudeSmooth',
  'uAudioActive',
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
  let simBuf: DoubleFBO | null = null;

  /** Timestamp (seconds) of last ambient drop. */
  let lastAmbientTime = 0;

  /** Next ambient drop interval (randomized). */
  let nextAmbientInterval =
    AMBIENT_INTERVAL_IDLE_MIN +
    Math.random() * (AMBIENT_INTERVAL_IDLE_MAX - AMBIENT_INTERVAL_IDLE_MIN);

  /** Current rotating channel for mouse hover deposits (0, 1, 2). */
  let hoverChannel = 0;

  /** Frame counter for rotating hover channel. */
  let hoverFrameCounter = 0;

  /** Current rotating channel for ambient drops (0, 1, 2). */
  let ambientChannel = 0;

  /** Active click burst animations. */
  let clickBursts: Array<{
    x: number;
    y: number;
    frames: number;
    offsets: Array<{ dx: number; dy: number; channel: number }>;
  }> = [];

  /** Last render time — used for frame-rate-independent fades. */
  let lastRenderTime = 0;

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Prevents ink deposits from popping into existence — meditation-first
   * content needs gentle onsets and offsets.
   */
  let wandererFade = 0;

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

    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    const tx = 1.0 / SIM_RES;
    gl.uniform2f(simU.uTexel, tx, tx);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
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
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize to clear liquid
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
      const midsSmooth = audio?.midsSmooth ?? 0;
      const trebleSmooth = audio?.trebleSmooth ?? 0;
      const amplitudeSmooth = audio?.amplitudeSmooth ?? 0;
      const beatPulse = audio?.beatPulse ?? 0;
      const audioActive = audio?.active ?? false;

      // Frame-rate-independent dt — used for the wanderer fade only.
      const dt =
        lastRenderTime === 0 ? 1 / 60 : Math.min(0.1, time - lastRenderTime);
      lastRenderTime = time;

      // Ease wanderer fade toward 1 (audio playing) or 0 (paused).
      const fadeTarget = audioActive ? 1 : 0;
      wandererFade +=
        (fadeTarget - wandererFade) * Math.min(1, dt * WANDERER_FADE_RATE);

      // ── Rotate hover channel every ~45 frames ──────────────
      hoverFrameCounter++;
      if (hoverFrameCounter >= HOVER_CHANNEL_ROTATE_FRAMES) {
        hoverFrameCounter = 0;
        hoverChannel = (hoverChannel + 1) % 3;
      }

      // ── Wanderer: continuous PRIMARY-channel trail ───────────
      // A single gentle Gaussian deposit at the wanderer's position every
      // frame during playback. Strength scales with smoothed amplitude so
      // loud passages feel more present without jittering. Uses the sim's
      // `uMouse`/`uInkChannel` deposit slot (always-on mouseStrength path).
      let wandererDeposit = false;
      let wandererX = -10.0;
      let wandererY = -10.0;
      let wandererStr = 0.0;
      if (wandererFade > 0.01) {
        const pos = wandererPosition(time, amplitudeSmooth);
        wandererDeposit = true;
        wandererX = pos.x;
        wandererY = pos.y;
        wandererStr =
          (WANDERER_TRAIL_BASE + WANDERER_TRAIL_GAIN * amplitudeSmooth) *
          wandererFade;
      }

      // ── Bass rumble emitters — SECONDARY channel ─────────────
      // Parallel to the beat-onset path. Sustained low-end (meditation
      // drones, pads, rumble) produces no transients for the onset detector
      // to fire on, but there IS continuous bass energy the viewer should
      // feel. We emit 1-4 wide SECONDARY ink drops per frame at orbiting
      // positions. Each is deposited in its own sim substep (the sim only
      // supports two simultaneous channels per step — mouse + drop — but
      // we want one sim tick per emitter for diffusion realism anyway).
      const emitRumble =
        audioActive && bassSmooth > BASS_RUMBLE_FLOOR && wandererFade > 0.01;
      const rumbleEmitterCount = emitRumble
        ? Math.min(4, 1 + Math.floor(bassSmooth * 6))
        : 0;
      const rumbleStrength = emitRumble
        ? bassSmooth * bassSmooth * BASS_RUMBLE_STRENGTH * wandererFade
        : 0;
      const rumbleSize = cfg.dropSize * BASS_RUMBLE_SIZE_MULT;

      // ── Ambient drip: sparse background life ────────────────
      // Much less frequent than before so the wanderer reads as the primary
      // actor rather than noise.
      let ambDropX = -10.0;
      let ambDropY = -10.0;
      let ambDropCh = 0;

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
        ambDropX = 0.15 + Math.random() * 0.7;
        ambDropY = 0.15 + Math.random() * 0.7;
        ambDropCh = ambientChannel;
        ambientChannel = (ambientChannel + 1) % 3;
      }

      // ── Click bursts: 3 offset deposits (one per channel) ─
      if (mouse.burstStrength > 0) {
        const spread = cfg.dropSize * 2.5;
        clickBursts.push({
          x: mouse.x,
          y: mouse.y,
          frames: 0,
          offsets: [
            { dx: 0, dy: 0, channel: CHANNEL_PRIMARY },
            { dx: spread, dy: -spread * 0.5, channel: CHANNEL_SECONDARY },
            { dx: -spread, dy: spread * 0.5, channel: CHANNEL_ACCENT },
          ],
        });
      }

      for (let i = clickBursts.length - 1; i >= 0; i--) {
        const burst = clickBursts[i];
        if (burst.frames < 5) {
          const str = 2.5 * (1.0 - burst.frames / 5.0);
          // Deposit one offset per frame, cycling through the 3 channels
          const offsetIdx = burst.frames % burst.offsets.length;
          const off = burst.offsets[offsetIdx];
          stepSim(
            gl,
            time,
            burst.x + off.dx,
            burst.y + off.dy,
            true,
            str,
            off.channel,
            -10.0,
            -10.0,
            0,
            cfg
          );
          burst.frames++;
        } else {
          clickBursts.splice(i, 1);
        }
      }

      // ── Mouse hover — attenuated during loud passages so music leads.
      // Also the carrier for the wanderer trail when audio is playing:
      // wanderer uses the same `uMouse`/`uInkChannel` slot as real mouse.
      const mouseAttenuation = audioActive
        ? Math.max(0.45, 1.0 - 0.55 * amplitudeSmooth)
        : 1.0;

      if (wandererDeposit) {
        // Wanderer channel cycles slowly through the three brand-ink channels
        // so the trail paints a multi-coloured ribbon. Diffusion smooths the
        // transitions — you see primary bleed into secondary, then into
        // accent, rather than hard channel switches.
        const wandererChannel =
          Math.floor(time / WANDERER_CHANNEL_CYCLE_SECS) % 3;

        // Wanderer trail takes priority over mouse hover when audio plays —
        // the ink channel is a shared resource. Wanderer deposits via the
        // mouse slot (rotating channel), paired with ambient via drop slot.
        // Uses a larger drop-size override so the wanderer's ribbon reads
        // clearly rather than blending into background ink.
        stepSim(
          gl,
          time,
          wandererX,
          wandererY,
          true,
          wandererStr,
          wandererChannel,
          ambDropX,
          ambDropY,
          ambDropCh,
          cfg,
          cfg.dropSize * WANDERER_TRAIL_SIZE_MULT
        );

        // Extra sim step for real mouse hover (audio-attenuated) +
        // rotating hover channel. Keeps mouse interaction alive during
        // playback without shredding the wanderer trail.
        if (mouse.active) {
          stepSim(
            gl,
            time,
            mouse.x,
            mouse.y,
            true,
            mouseAttenuation,
            hoverChannel,
            -10.0,
            -10.0,
            0,
            cfg
          );
        }
      } else {
        // No audio: original behaviour — mouse hover + ambient drop.
        stepSim(
          gl,
          time,
          mouse.active ? mouse.x : -10.0,
          mouse.active ? mouse.y : -10.0,
          mouse.active,
          mouseAttenuation,
          hoverChannel,
          ambDropX,
          ambDropY,
          ambDropCh,
          cfg
        );
      }

      // ── Beat-synced ACCENT splash ─────────────────────────────
      // Gated on audible pulse so it doesn't ring during fade-in. Landed
      // after the wanderer/mouse step so it layers on top. Slightly larger
      // radius than the trail so the accent flash reads as a distinct bloom.
      if (beatPulse > 0.2 && audioActive && wandererFade > 0.01) {
        const pos = wandererPosition(time, amplitudeSmooth);
        const splashStrength =
          (WANDERER_SPLASH_BASE + WANDERER_SPLASH_GAIN * beatPulse) *
          wandererFade;
        stepSim(
          gl,
          time,
          pos.x,
          pos.y,
          true,
          splashStrength,
          CHANNEL_ACCENT,
          -10.0,
          -10.0,
          0,
          cfg,
          cfg.dropSize * WANDERER_SPLASH_SIZE_MULT
        );
      }

      // ── Bass rumble emitter substeps — wide SECONDARY drops ──
      for (let i = 0; i < rumbleEmitterCount; i++) {
        const orbitT = time * BASS_ORBIT_RATE;
        const angle = orbitT + (i * (Math.PI * 2)) / rumbleEmitterCount;
        const r =
          BASS_ORBIT_R_BASE +
          BASS_ORBIT_R_BREATH * Math.sin(time * 0.11 + i * 1.7);
        const bx = 0.5 + r * Math.cos(angle);
        const by = 0.5 + r * Math.sin(angle);
        // Use the drop slot so it doesn't fight the wanderer/mouse slot.
        stepSim(
          gl,
          time,
          -10.0,
          -10.0,
          false,
          0.0,
          0,
          bx,
          by,
          CHANNEL_SECONDARY,
          cfg,
          rumbleSize
        );
      }

      // ── Coast substep (no input) ─────────────────────────────
      stepSim(gl, time, -10.0, -10.0, false, 0.0, 0, -10.0, -10.0, 0, cfg);

      // ── Display pass ───────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

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
      gl.uniform1f(displayU.uBassSmooth, bassSmooth);
      gl.uniform1f(displayU.uMidsSmooth, midsSmooth);
      gl.uniform1f(displayU.uTrebleSmooth, trebleSmooth);
      gl.uniform1f(displayU.uAmplitudeSmooth, amplitudeSmooth);
      gl.uniform1f(displayU.uAudioActive, wandererFade);

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
      nextAmbientInterval =
        AMBIENT_INTERVAL_IDLE_MIN +
        Math.random() * (AMBIENT_INTERVAL_IDLE_MAX - AMBIENT_INTERVAL_IDLE_MIN);
      hoverChannel = 0;
      hoverFrameCounter = 0;
      ambientChannel = 0;
      clickBursts = [];
      lastRenderTime = 0;
      wandererFade = 0;

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Zero out both FBO sides (clear liquid)
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
