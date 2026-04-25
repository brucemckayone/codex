/**
 * Water Ripple renderer — implements ShaderRenderer.
 *
 * 2D wave equation with ping-pong FBO simulation.
 * Buffer format: vec4(height, previousHeight, 0, 0).
 *
 * Audio-reactive immersive mode uses a "wanderer" — a single drifting point
 * that follows a noise-perturbed Lissajous path. Each frame it deposits a
 * gentle trail at its current position; detected beat onsets deposit a larger
 * splash at the same position. This replaces the former random-per-frame
 * impulse strategy, which became chaotic on dense audio.
 *
 * Display pass renders normal-mapped surface with Fresnel, refraction,
 * caustics, specular highlights, and a brand gradient. Caustic brightness
 * breathes with smoothed mids; specular sharpness softens with smoothed
 * treble; saturation lifts during playback so meditation content reads as
 * vibrant rather than washed out.
 *
 * Simulation runs at 512x512 in a ping-pong double FBO.
 * Display pass renders to the full canvas viewport.
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { RippleConfig, ShaderConfig } from '../shader-config';
import { RIPPLE_DISPLAY_FRAG } from '../shaders/ripple-display.frag';
import { RIPPLE_SIM_FRAG } from '../shaders/ripple-sim.frag';
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

/** Ripple init fragment shader — flat water (all zeros). */
const RIPPLE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

/** Default refraction strength (from prototype). */
const DEFAULT_REFRACTION = 0.5;

/** Default ripple size for mouse impulse (from prototype). */
const DEFAULT_RIPPLE_SIZE = 0.03;

// ── Wanderer tunables ─────────────────────────────────────────
/** Wanderer path base frequencies — irrational ratio, never exactly repeats. */
const WANDERER_FREQ_X = 0.13;
const WANDERER_FREQ_Y = 0.19;
/** Slow phase-drift rates — reshape the Lissajous curve over ~minute timescales. */
const WANDERER_DRIFT_RATE_X = 0.017;
const WANDERER_DRIFT_RATE_Y = 0.023;
/**
 * Wanderer PHASE speed multiplier gain. Louder audio advances the wanderer
 * faster so it traces more canvas per unit time — combined with
 * distance-based tapping (below), this means louder content produces more
 * ripples at more positions. Peak (amp=1) → 5.5× base speed, genuinely
 * visible differentiation vs the meditative baseline.
 */
const WANDERER_SPEED_GAIN = 4.5;
/**
 * Wanderer path radius — base path + amplitude-driven expansion, bounded
 * well inside the canvas so the path never drifts toward the edges.
 * User direction: "the central audio focus, when louder, seems to produce
 * larger effects" — so wanderer size IS loudness-reactive, but capped.
 * Peak radius at full amplitude = BASE + GAIN = 0.22, leaving ~28% margin.
 */
const WANDERER_BASE_RADIUS = 0.14;
const WANDERER_RADIUS_GAIN = 0.08;
/**
 * Wanderer tap distance — minimum spatial movement from the last tap before
 * a new one fires. Replaces the old time-based rate: spatial separation
 * guarantees each tap hits fresh water (no buildup, no flicker) regardless
 * of wanderer speed. Value ~= Gaussian impulse radius so consecutive taps
 * just barely don't overlap — smooth chain of ripples when wanderer is
 * moving fast, sparse distinct ripples when it's slow.
 *
 * Tap rate EMERGES from wanderer speed: at base (amp=0) ~0.7 taps/sec;
 * at peak amp ~6 taps/sec. No fixed rate — always matches motion.
 */
const WANDERER_TAP_DISTANCE = 0.025;
/**
 * Fallback max interval — if wanderer has been nearly stationary (quiet
 * audio, no movement threshold met), fire at least one tap per interval
 * so the wanderer stays alive on screen. Keeps very-quiet baseline from
 * feeling stalled.
 */
const WANDERER_TAP_MAX_INTERVAL = 0.8;
/**
 * Per-tap deposit strength. Each tap is a DISCRETE impulse (must be
 * strong enough to produce a visible ripple) rather than part of a
 * sustained build-up. Peak strength (amp=1) = 1.8; quiet = 1.0.
 */
const WANDERER_TAP_BASE = 1.0;
const WANDERER_TAP_GAIN = 0.8;
/** Beat splash strength — scales with beat pulse at wanderer's current position. */
const WANDERER_SPLASH_BASE = 0.9;
const WANDERER_SPLASH_GAIN = 1.6;
/** Fade curve for the wanderer — eases from 0 on pause/resume. */
const WANDERER_FADE_RATE = 2.5; // higher = faster fade-in/out (units per second)

// ── Bass rumble emitter tunables ─────────────────────────────
/**
 * Complement to the beat-onset path — creates continuous wave activity driven
 * by smoothed bass envelope, suitable for meditation / drone content where
 * there are no sharp onsets for the beat detector to catch but clear low-end
 * energy the viewer should *feel*.
 */
/** Below this smoothed-bass value, no rumble impulses are emitted. */
const BASS_RUMBLE_FLOOR = 0.1;
/**
 * Per-frame strength coefficient (applied to bassSmooth — LINEAR, not
 * quadratic). User direction: bass should "affect more" and have "greater
 * impact". Linear scaling keeps mid-range bass visible while peak bass
 * stays punchy. Raised from 0.55 → 1.5 so each rumble tap is visibly
 * spiky (previously the cumulative-buildup effect from continuous
 * per-frame deposits was masking the per-tap weakness).
 */
const BASS_RUMBLE_STRENGTH = 1.5;
/**
 * Maximum simultaneous rumble emitters. Was 2 (reduced from 4 to prevent
 * dome-buildup). With distance-based tapping, buildup is no longer an
 * issue regardless of count — raising back to 3 for richer bass texture.
 */
const BASS_RUMBLE_MAX_EMITTERS = 3;
/** Ripple size multiplier for rumble impulses — slightly narrower (2.0 vs
 * 2.5) so each spike feels punchier. Still wider than the wanderer's
 * deposits (1.0x) so rumble reads as atmospheric vs focal. */
const BASS_RUMBLE_SIZE_MULT = 2.0;
/** Orbit rate of rumble emitters around canvas centre (radians/sec). */
const BASS_ORBIT_RATE = 0.23;
/**
 * Orbit-speed gain with bass. Louder bass → faster orbit → more taps per
 * second (because emitters cover more ground between taps). Peak
 * (bass=1) → 3× base orbit speed. Complements distance-based tapping
 * to give bass visible "intensity scaling" as volume rises.
 */
const BASS_ORBIT_SPEED_GAIN = 2.0;
/** Emitter orbit radius baseline + breathing amplitude. */
const BASS_ORBIT_R_BASE = 0.32;
const BASS_ORBIT_R_BREATH = 0.06;
/**
 * Minimum distance an emitter must move before its next tap fires. Same
 * distance-based principle as the wanderer — guarantees no overlap/
 * buildup at any orbit speed. Value = 1× the rumble Gaussian radius so
 * consecutive taps just barely don't overlap.
 */
const BASS_RUMBLE_TAP_DISTANCE = 0.06;

/** Ambient drip interval during audio playback — sparse background life. */
const AMBIENT_INTERVAL_PLAYING_MIN = 3.5;
const AMBIENT_INTERVAL_PLAYING_MAX = 5.5;
/** Ambient drip interval when idle (audio paused / hero mode). */
const AMBIENT_INTERVAL_IDLE_MIN = 2.5;
const AMBIENT_INTERVAL_IDLE_MAX = 4.0;

/** Uniform name lists for type-safe location lookup. */
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uWaveSpeed',
  'uDamping',
  'uRippleSize',
  'uMouse',
  'uMouseActive',
  'uMouseStrength',
] as const;
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uColorPrimary',
  'uColorSecondary',
  'uColorAccent',
  'uBgColor',
  'uIntensity',
  'uRefraction',
  'uGrain',
  'uVignette',
  'uTime',
  'uBassSmooth',
  'uMidsSmooth',
  'uTrebleSmooth',
  'uAmplitudeSmooth',
  'uAudioActive',
] as const;

export function createRippleRenderer(): ShaderRenderer {
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

  /** Timestamp (seconds) of last ambient drip. */
  let lastAmbientTime = 0;

  /** Active click splash animations. */
  let clickSplashes: Array<{ x: number; y: number; frames: number }> = [];

  /** Last render time — used for frame-rate-independent fades. */
  let lastRenderTime = 0;

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Prevents the wanderer from popping into existence — meditation-first
   * content needs gentle onsets and offsets.
   */
  let wandererFade = 0;

  /**
   * Variable-rate phase clock for the wanderer's position. Advances at
   * `1 + amp·SPEED_GAIN` seconds per second, so the wanderer moves faster
   * at high amplitude. Accumulating phase (rather than multiplying `time`)
   * avoids discontinuities when the rate changes.
   */
  let wandererPhase = 0;

  /**
   * Position of the last tap. Compared to current wanderer position each
   * frame — a new tap fires when the wanderer has moved at least
   * `WANDERER_TAP_DISTANCE` from here. Initialised off-canvas so the first
   * tap always fires immediately on play.
   */
  let lastTapX = -10;
  let lastTapY = -10;
  let lastTapTime = -Infinity;

  /**
   * Orbit phase clock for bass rumble emitters. Accumulated with
   * variable rate (bass-scaled) so orbit speed changes without phase
   * discontinuities. Same pattern as `wandererPhase`.
   */
  let orbitPhase = 0;

  /**
   * Per-emitter last-tap positions for the bass rumble's distance-based
   * tapping. Sized to max emitter count; unused slots ignored.
   */
  const lastRumbleTapX = new Array<number>(BASS_RUMBLE_MAX_EMITTERS).fill(-10);
  const lastRumbleTapY = new Array<number>(BASS_RUMBLE_MAX_EMITTERS).fill(-10);

  // ── Sim step helper ────────────────────────────────────────
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    mouseStr: number,
    cfg: RippleConfig,
    /** Optional override for Gaussian impulse radius (default = cfg.rippleSize). */
    rippleSizeOverride?: number
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
    gl.uniform1f(simU.uWaveSpeed, cfg.waveSpeed);
    gl.uniform1f(simU.uDamping, cfg.damping);
    gl.uniform1f(
      simU.uRippleSize,
      rippleSizeOverride ?? cfg.rippleSize ?? DEFAULT_RIPPLE_SIZE
    );
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uMouseStrength, mouseStr);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  /**
   * Wanderer position — noise-perturbed Lissajous. Bounded to [~0.15, ~0.85]
   * along each axis (bg margin), smooth everywhere, never exactly repeats.
   * The inner `sin(drift)` term reshapes the curve slowly so consecutive
   * orbits don't trace the same path.
   */
  function wandererPosition(
    phase: number,
    amplitudeSmooth: number
  ): { x: number; y: number } {
    // Radius = base + amplitude gain.
    const radius =
      WANDERER_BASE_RADIUS + WANDERER_RADIUS_GAIN * amplitudeSmooth;
    const driftX = Math.sin(phase * WANDERER_DRIFT_RATE_X) * 2.0;
    const driftY = Math.sin(phase * WANDERER_DRIFT_RATE_Y + 1.3) * 1.7;

    // Primary Lissajous component (72% weight). sin/cos at ratio 0.13:0.19
    // creates a path with a preferred rotation direction (anti-clockwise
    // under positive phase).
    const px = Math.sin(phase * WANDERER_FREQ_X + driftX);
    const py = Math.cos(phase * WANDERER_FREQ_Y + driftY);

    // Secondary COUNTER-ROTATING Lissajous component (28% weight). Uses
    // cos for x and sin for y (opposite parity to primary) AND a negative
    // phase factor on Y — so it orbits the opposite direction at a
    // different rate. Mixing in breaks the uniform anti-clockwise bias
    // without disrupting the bounded path shape. Frequencies chosen to
    // be irrational-ish relative to the primary so the combined path
    // never exactly repeats.
    const sx = Math.cos(phase * 0.31 + 2.1);
    const sy = Math.sin(-phase * 0.26 + 1.3);

    const x = 0.5 + radius * (0.72 * px + 0.28 * sx);
    const y = 0.5 + radius * (0.72 * py + 0.28 * sy);
    return { x, y };
  }

  return {
    init(gl: WebGL2RenderingContext, _width: number, _height: number): boolean {
      // Check required extensions
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, RIPPLE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, RIPPLE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, RIPPLE_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      simBuf = createDoubleFBO(gl, SIM_RES, SIM_RES);

      // Initialize to flat water
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

      const cfg = config as RippleConfig;
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

      // ── Wanderer: pulsed taps + beat-synced splash ───────────
      // Rewritten from the old continuous deposit (which caused a sustained
      // dome at high volume) into discrete taps — the sim now propagates
      // real ripples between taps. Rate scales with amplitude so loud
      // content produces denser ripple patterns without sustained dominance.
      if (wandererFade > 0.01) {
        // Advance the variable-rate phase: louder → faster wanderer. Speed
        // gain compounds with tap-rate gain (below) so dense mixes create
        // a visibly more energetic wanderer.
        wandererPhase += dt * (1 + amplitudeSmooth * WANDERER_SPEED_GAIN);

        const pos = wandererPosition(wandererPhase, amplitudeSmooth);

        // Distance-based tap: fire a new tap only when the wanderer has
        // physically moved enough from the previous tap position. This
        // guarantees no overlap / buildup / flicker regardless of speed.
        // Fallback max-interval keeps a nearly-stationary wanderer alive
        // during very quiet content.
        const dx = pos.x - lastTapX;
        const dy = pos.y - lastTapY;
        const distSq = dx * dx + dy * dy;
        const threshSq = WANDERER_TAP_DISTANCE * WANDERER_TAP_DISTANCE;
        const timeSinceLast = time - lastTapTime;
        if (distSq > threshSq || timeSinceLast > WANDERER_TAP_MAX_INTERVAL) {
          lastTapX = pos.x;
          lastTapY = pos.y;
          lastTapTime = time;
          const tapStrength =
            (WANDERER_TAP_BASE + WANDERER_TAP_GAIN * amplitudeSmooth) *
            wandererFade;
          stepSim(gl, pos.x, pos.y, true, tapStrength, cfg);
        }

        // Beat-synced splash: already a discrete impulse — fires on
        // detected onset at the wanderer's current position.
        if (beatPulse > 0.2 && audioActive) {
          const splashStrength =
            (WANDERER_SPLASH_BASE + WANDERER_SPLASH_GAIN * beatPulse) *
            wandererFade;
          stepSim(gl, pos.x, pos.y, true, splashStrength, cfg);
        }
      }

      // ── Bass rumble emitter (v2 — distance-based, spiky) ─────
      // Rewritten for "more bass impact, with spikes" (user direction).
      //
      // Key changes from v1:
      // 1. Distance-based tapping per emitter (not per-frame) — each
      //    emitter fires only when its orbital motion has carried it
      //    past BASS_RUMBLE_TAP_DISTANCE of fresh water. Fixes the same
      //    "anti-clockwise dome" issue the wanderer had: continuous
      //    per-frame deposits at slow-moving positions create static
      //    protrusions, not propagating ripples.
      // 2. Orbit phase accumulates at bass-scaled rate — louder bass =
      //    faster orbit = more taps/sec = more visible spikes.
      // 3. Linear bass scaling (not quadratic) — mid-range bass is now
      //    as visible as peak bass, so everyday content feels bassier.
      // 4. Alternating rotation direction per emitter (i%2 sign flip) —
      //    breaks the unifying anti-clockwise visual bias.
      // 5. Higher strength (0.55 → 1.5), narrower Gaussian (2.5 → 2.0×)
      //    so each deposit reads as a "spike" not a smear.
      orbitPhase +=
        dt * BASS_ORBIT_RATE * (1 + bassSmooth * BASS_ORBIT_SPEED_GAIN);
      if (
        audioActive &&
        bassSmooth > BASS_RUMBLE_FLOOR &&
        wandererFade > 0.01
      ) {
        const emitterCount = Math.min(
          BASS_RUMBLE_MAX_EMITTERS,
          1 + Math.floor(bassSmooth * 4)
        );
        const rumbleStrength = bassSmooth * BASS_RUMBLE_STRENGTH * wandererFade;
        const rumbleSize =
          (cfg.rippleSize ?? DEFAULT_RIPPLE_SIZE) * BASS_RUMBLE_SIZE_MULT;
        const threshSq = BASS_RUMBLE_TAP_DISTANCE * BASS_RUMBLE_TAP_DISTANCE;
        for (let i = 0; i < emitterCount; i++) {
          // Alternating rotation direction — even-indexed emitters orbit
          // one way, odd-indexed the opposite. Breaks unified bias.
          const dir = i % 2 === 0 ? 1 : -1;
          const angle = orbitPhase * dir + (i * (Math.PI * 2)) / emitterCount;
          const r =
            BASS_ORBIT_R_BASE +
            BASS_ORBIT_R_BREATH * Math.sin(time * 0.11 + i * 1.7);
          const bx = 0.5 + r * Math.cos(angle);
          const by = 0.5 + r * Math.sin(angle);

          // Distance-based tap: only deposit when this emitter has moved
          // past a fresh patch. No buildup possible at any orbit speed.
          const dbx = bx - lastRumbleTapX[i];
          const dby = by - lastRumbleTapY[i];
          if (dbx * dbx + dby * dby > threshSq) {
            lastRumbleTapX[i] = bx;
            lastRumbleTapY[i] = by;
            stepSim(gl, bx, by, true, rumbleStrength, cfg, rumbleSize);
          }
        }
      }

      // ── Ambient drips — sparse background life ─────────────
      // Much less frequent than before (was 0.8-2s) so the wanderer reads as
      // the primary actor rather than noise.
      const ambientInterval = audioActive
        ? AMBIENT_INTERVAL_PLAYING_MIN +
          Math.random() *
            (AMBIENT_INTERVAL_PLAYING_MAX - AMBIENT_INTERVAL_PLAYING_MIN)
        : AMBIENT_INTERVAL_IDLE_MIN +
          Math.random() *
            (AMBIENT_INTERVAL_IDLE_MAX - AMBIENT_INTERVAL_IDLE_MIN);
      if (time - lastAmbientTime > ambientInterval) {
        lastAmbientTime = time;
        const ax = 0.2 + Math.random() * 0.6;
        const ay = 0.2 + Math.random() * 0.6;
        const strength = audioActive ? 0.35 + bassSmooth * 0.25 : 0.5;
        stepSim(gl, ax, ay, true, strength, cfg);
      }

      // ── Click splashes: inject over several frames ─────────
      if (mouse.burstStrength > 0) {
        clickSplashes.push({ x: mouse.x, y: mouse.y, frames: 0 });
      }

      for (let i = clickSplashes.length - 1; i >= 0; i--) {
        const sp = clickSplashes[i];
        if (sp.frames < 6) {
          const str = 3.0 * (1.0 - sp.frames / 6.0);
          stepSim(gl, sp.x, sp.y, true, str, cfg);
          sp.frames++;
        } else {
          clickSplashes.splice(i, 1);
        }
      }

      // ── Mouse hover — attenuated during loud passages so the music leads.
      // Ducks up to ~50% as smoothed amplitude rises.
      const mouseAttenuation = audioActive
        ? Math.max(0.45, 1.0 - 0.55 * amplitudeSmooth)
        : 1.0;
      stepSim(
        gl,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        mouseAttenuation,
        cfg
      );

      // Extra substep for smoother wave propagation (matches prototype)
      stepSim(gl, -10.0, -10.0, false, 0.0, cfg);

      // ── Display pass ───────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      const tx = 1.0 / SIM_RES;
      gl.uniform2f(displayU.uTexel, tx, tx);

      // ── Immersive colour cycling (shared utility) ──────────
      // Uses smoothed amplitude so phase nudge doesn't jitter.
      const colours = audioActive
        ? computeImmersiveColours(time, cfg.colors, amplitudeSmooth)
        : cfg.colors;

      gl.uniform3fv(displayU.uColorPrimary, colours.primary);
      gl.uniform3fv(displayU.uColorSecondary, colours.secondary);
      gl.uniform3fv(displayU.uColorAccent, colours.accent);
      gl.uniform3fv(displayU.uBgColor, colours.bg);

      gl.uniform1f(displayU.uIntensity, cfg.intensity);
      // Refraction breathes more visibly with smoothed bass — up to +80% at peak.
      gl.uniform1f(
        displayU.uRefraction,
        (cfg.refraction ?? DEFAULT_REFRACTION) * (1.0 + bassSmooth * 0.8)
      );
      gl.uniform1f(displayU.uGrain, cfg.grain);
      gl.uniform1f(displayU.uVignette, 0.0);
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
      lastRenderTime = 0;
      wandererFade = 0;
      wandererPhase = 0;
      lastTapX = -10;
      lastTapY = -10;
      lastTapTime = -Infinity;
      orbitPhase = 0;
      lastRumbleTapX.fill(-10);
      lastRumbleTapY.fill(-10);
      clickSplashes = [];

      gl.viewport(0, 0, SIM_RES, SIM_RES);
      gl.useProgram(initProg);
      quad.bind(initProg);

      // Zero out both FBO sides (flat water)
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
      clickSplashes = [];
    },
  };
}
