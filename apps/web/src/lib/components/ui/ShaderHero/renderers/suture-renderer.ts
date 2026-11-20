/**
 * Suture Fluid renderer — implements ShaderRenderer.
 *
 * Faithful port of cornusammonis XddSRX (Shadertoy).
 * Single feedback buffer: vec3(velocity.x, velocity.y, divergence).
 * Self-sustaining via curl-rotation + divergence-pressure feedback.
 *
 * Audio-reactive immersive mode (parity with the ripple preset's v2 model):
 *
 *   1. Distance-based wanderer tapping — the wanderer only deposits a force
 *      when it has physically moved at least `WANDERER_TAP_DISTANCE` from
 *      the previous tap. Replaces the old "continuous every-frame deposit"
 *      strategy which, at slow wanderer speeds, produced a static DOME
 *      rather than a propagating trail.
 *   2. Variable-rate phase clock with aggressive speed gain — `wandererPhase`
 *      accumulates at `1 + amp·WANDERER_SPEED_GAIN`, so louder audio
 *      visibly accelerates the wanderer (more taps/sec, more canvas covered).
 *   3. Counter-rotating secondary Lissajous component — 72% primary + 28%
 *      opposite-parity secondary breaks the uniform anti-clockwise visual
 *      bias that a single sin/cos pair imposes.
 *   4. Bass rumble v2 — distance-based per-emitter tapping, orbit phase
 *      accumulator with bass-scaled rate, LINEAR bass scaling (not quadratic),
 *      alternating rotation direction per emitter, up to 3 emitters, higher
 *      strength. Suture's sim does not accept a per-tap Gaussian-radius
 *      override (unlike ripple), so rumble force itself sets the spread.
 *   5. Elevated wanderer force — suture's `uForce` controls both Gaussian
 *      radius AND strength (via `exp(-length/(10·force))` additive to
 *      velocity). With distance-based tapping each tap is now a discrete
 *      event, not a fraction of continuous pressure, so per-tap force is
 *      notably higher than before (≈2-3× the old continuous values).
 *
 * Display pass layers full-spectrum visual modulation: UV-breath warp (bass),
 * sparkle gain on suture lines (mids), pseudo-specular on divergence ridges
 * (treble), saturation pump (amplitude) and ACES tone mapping. See
 * `suture-display.frag.ts` for the exact mappings.
 *
 * Simulation runs in a ping-pong double FBO shaped like the canvas (~512²
 * texels, `sim-grid.ts`), so the marbling is not stretched on wide heroes.
 * Display pass renders to the full canvas viewport.
 */

import { createClickEdge } from '../click-edge';
import { computeImmersiveColours } from '../immersive-colours';
import { bindOutput } from '../output-target';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import {
  DEFAULTS,
  type ShaderConfig,
  type SutureConfig,
} from '../shader-config';
import { SUTURE_DISPLAY_FRAG } from '../shaders/suture-display.frag';
import { SUTURE_SIM_FRAG } from '../shaders/suture-sim.frag';
import {
  createStepClock,
  INPUT_PER_SECOND,
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

/** Simulation steps a second: 1 a frame at 60 Hz, as suture always ran. */
const STEPS_PER_SECOND = 60;
const INPUT_STRIDE = inputStride(STEPS_PER_SECOND);

// A click is ONE burst (click-edge.ts): pushes swept around a circle, one per
// input step, so 12 of them over 0.2 s at any frame rate. A click used to
// queue ~28 bursts of 8 pushes (each an extra step), which is what made it
// read: the fluid ran ~4 s fast for half a second. One burst of the old size
// barely showed, so it is wider and stronger: the push's falloff radius is
// 10 * force sim px (suture-sim), so 7 is 70 px against hover's 27.
const BURST_LIFETIME_SECONDS = 12 / 60;
/** A burst ages this much per input step: 12 pushes at any rate. */
const INPUT_STEP_SECONDS = 1 / INPUT_PER_SECOND;
/** Each push's force (its falloff radius / 10, in sim px). */
const CLICK_BURST_FORCE = 7.0;
/** Radius of the circle the pushes sweep, in sim px. */
const CLICK_BURST_RADIUS = 36;

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
 * force injections at more positions. Peak (amp=1) → 5.5× base speed.
 *
 * NOTE: an earlier experiment added a beat-pulse speed burst on top of
 * this — it made the wanderer jerky on suture's advection-based fluid.
 * Reverted; speed is amplitude-driven only.
 */
const WANDERER_SPEED_GAIN = 4.5;
/**
 * Wanderer path radius — base path + amplitude-driven expansion, bounded
 * well inside the canvas so the path never drifts toward the edges. User
 * direction: "the central audio focus, when louder, seems to produce larger
 * effects" — wanderer size IS loudness-reactive but capped. Peak radius at
 * full amplitude = BASE + GAIN = 0.22, leaving ~28% margin.
 */
const WANDERER_BASE_RADIUS = 0.14;
const WANDERER_RADIUS_GAIN = 0.08;
/**
 * Wanderer tap distance (normalised 0..1). Minimum spatial movement from
 * the last tap before a new one fires. Replaces the old continuous-deposit
 * model: spatial separation guarantees each tap hits fresh fluid (no
 * buildup, no dome) regardless of wanderer speed.
 *
 * Suture's `uForce` controls Gaussian radius via `exp(-length/(10·force))`,
 * so at force ≈ 2 the visible "radius" is ~20 sim-pixels ≈ 0.04 normalised.
 * We pick tap distance ≈ 0.035 so consecutive taps just barely don't
 * overlap — smooth trail when wanderer is moving fast, sparse distinct
 * impressions when slow. Tap rate EMERGES from wanderer speed: at base
 * (amp=0) ~0.5 taps/sec; at peak amp ~5 taps/sec.
 */
const WANDERER_TAP_DISTANCE = 0.035;
/**
 * Fallback max interval — if wanderer has been nearly stationary (quiet
 * audio, no movement threshold met), fire at least one tap per interval
 * so the wanderer stays alive on screen. Keeps very-quiet baseline from
 * feeling stalled.
 */
const WANDERER_TAP_MAX_INTERVAL = 0.8;
/**
 * Per-tap wanderer force. Each tap is now a DISCRETE event (not a fraction
 * of continuous pressure), so values are substantially higher than the
 * previous continuous-trail era (old: 0.35 + 0.5·amp → effective 0.35-0.85;
 * new: 1.6 + 1.4·amp → 1.6-3.0). This is roughly 3-4× the old values,
 * addressing user feedback that "the wanderer doesn't have nearly enough
 * effect on everything".
 *
 * Note: suture's `uForce` compounds via `exp(-length/(10·force))` — small
 * increases produce visibly wider/stronger impressions.
 */
const WANDERER_TAP_BASE = 1.6;
const WANDERER_TAP_GAIN = 1.4;
/**
 * Beat splash force at the wanderer's position. Raised from the old
 * (1.2 + 1.5·pulse) era to (2.2 + 2.0·pulse) for a more commanding onset
 * response. With distance-based tapping, the splash no longer rides on
 * top of a sustained baseline — it has to stand on its own.
 */
const WANDERER_SPLASH_BASE = 2.2;
const WANDERER_SPLASH_GAIN = 2.0;
/** Fade curve for the wanderer — eases from 0 on pause/resume. */
const WANDERER_FADE_RATE = 2.5; // higher = faster fade-in/out (units per second)

// ── Bass rumble emitter tunables ─────────────────────────────
/**
 * Complement to the beat-onset path — creates continuous fluid activity
 * driven by smoothed bass envelope, suitable for meditation / drone content
 * where there are no sharp onsets for the beat detector to catch but clear
 * low-end energy the viewer should *feel*.
 *
 * v2 changes (ported from ripple):
 * - Distance-based tapping per emitter (no per-frame buildup, no dome).
 * - Orbit phase accumulator with bass-scaled rate (louder → faster orbit).
 * - LINEAR bass scaling (not quadratic) so mid-bass is visibly bassy too.
 * - Alternating rotation direction per emitter (breaks unified CCW bias).
 * - Max 3 emitters; higher force floor + strength.
 */
/** Below this smoothed-bass value, no rumble impulses are emitted. */
const BASS_RUMBLE_FLOOR = 0.1;
/**
 * Per-tap bass force coefficient. Reduced from 3.0 → 1.7 after user
 * reported high-frequency concentric "ringing" around emitter positions —
 * the fluid was hitting resonance from too-strong continuous point input.
 * Lower force = less energy in the standing-wave mode = smoother visuals.
 */
const BASS_RUMBLE_STRENGTH = 1.7;
/** Constant force floor. Lowered 1.5 → 0.85 alongside STRENGTH for the
 * same resonance reason. Peak force now = 0.85 + 1.7 = 2.55 (was 4.5). */
const BASS_RUMBLE_FORCE_BASE = 0.85;
/**
 * Per-emitter slow temporal modulation — each emitter's force multiplier
 * oscillates between (1-AMP) and 1 on an independent slow cycle so the
 * fluid's driving frequency is never constant. This DETUNES the resonance
 * mode continuously, preventing standing-wave ring pattern buildup.
 * Each emitter gets its own cycle rate and phase offset.
 *
 * Amplitude 0.4 = force modulates between 0.6×rumble and 1.0×rumble —
 * never silent, but enough variation to keep resonance broken.
 */
const BASS_EMITTER_MOD_AMP = 0.4;
const BASS_EMITTER_MOD_RATE = 0.55; // Hz-ish (radians per "orbitPhase" unit)
/** Maximum simultaneous rumble emitters (raised back to 3 with v2 tap model). */
const BASS_RUMBLE_MAX_EMITTERS = 3;
/**
 * Orbit rate of rumble emitters around canvas centre (radians/sec).
 * Slowed from 0.23 → 0.14 after user feedback that the outer ring was
 * rotating too fast — the slower rate makes the swirl feel atmospheric
 * rather than clockwork-like.
 */
const BASS_ORBIT_RATE = 0.14;
/**
 * Orbit-speed gain with bass. Reduced from 2.0 → 1.2 alongside the slower
 * base rate. Peak (bass=1) → 2.2× base = 0.31 rad/s (was 0.69 rad/s).
 */
const BASS_ORBIT_SPEED_GAIN = 1.2;
/** Emitter orbit radius baseline + breathing amplitude. */
const BASS_ORBIT_R_BASE = 0.32;
const BASS_ORBIT_R_BREATH = 0.06;
/**
 * Per-emitter RADIUS wobble — adds organic random-walk drift within the
 * outer ring so emitters don't trace a perfect circle. Each emitter's
 * wobble phase is offset by `i * 1.7` so they don't sync up.
 */
const BASS_ORBIT_R_WOBBLE = 0.05;
/**
 * Per-emitter ANGLE wobble (radians) — breaks the perfectly-even
 * angular spacing. ±0.35 rad = ±20° of drift from even 120° spacing.
 * Combined with the radius wobble, the emitters feel like free-drifting
 * particles confined to the ring rather than clockwork hands.
 */
const BASS_ORBIT_A_WOBBLE = 0.35;
/**
 * Audio-driven curl boost. Louder bass/amplitude pushes the fluid's
 * base curl coefficient upward — the whole field becomes more vortical
 * on heavy low-end, complementing the outer-ring's force injections.
 * The user wanted "more curl or whatever there is there that could also
 * be affected." This is modulating the fluid's CHARACTER, not just
 * adding more impulses.
 */
const CURL_BASS_GAIN = 0.35;
const CURL_AMP_GAIN = 0.15;
/**
 * Rumble path geometry — a CONSISTENT outer ring that all emitters share.
 * User feedback: the outer ring should be a smooth continuous swirl,
 * confined to its own territory, NOT per-emitter Lissajous paths crossing
 * into the middle. Suture's advection-based fluid carries injected force
 * away naturally, so continuous per-frame deposits at orbital positions
 * create a smooth swirling outflow (unlike ripple's wave equation which
 * would build a dome — the physics differ, and per-preset tuning matters).
 */

/** Ambient force interval during audio playback — sparse background life. */
const AMBIENT_INTERVAL_PLAYING_MIN = 3.5;
const AMBIENT_INTERVAL_PLAYING_MAX = 5.5;
/** Ambient force interval when idle (audio paused / hero mode). */
const AMBIENT_INTERVAL_IDLE_MIN = 2.5;
const AMBIENT_INTERVAL_IDLE_MAX = 4.0;

/** Suture init fragment shader — IQ's simplex noise. */
const SUTURE_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform float uSeed;

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x+p.y)*K1);
  vec2 a = p - i + (i.x+i.y)*K2;
  vec2 o = step(a.yx, a.xy);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0*K2;
  vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
  vec3 n = h*h*h*h * vec3(dot(a,hash(i)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
  return dot(n, vec3(70.0));
}

void main() {
  vec2 p = 16.0 * v_uv + uSeed;
  fragColor = vec4(noise(p + 1.1), noise(p + 2.2), noise(p + 3.3), 0.0);
}
`;

/** Uniform name lists for type-safe location lookup. */
const INIT_UNIFORM_NAMES = ['uSeed'] as const;
const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uCurlScale',
  'uAdvDist',
  'uMouse',
  'uMouseActive',
  'uForce',
] as const;
const DISPLAY_UNIFORM_NAMES = [
  'uState',
  'uColorA',
  'uColorB',
  'uColorC',
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

export function createSutureRenderer(): ShaderRenderer {
  let initProg: WebGLProgram | null = null;
  let simProg: WebGLProgram | null = null;
  let displayProg: WebGLProgram | null = null;

  let initU: Record<
    (typeof INIT_UNIFORM_NAMES)[number],
    WebGLUniformLocation | null
  > | null = null;
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

  let grid: SimGrid = simGridFor(0, 0);
  const clock = createStepClock(STEPS_PER_SECOND);

  /** Timestamp (seconds) of last ambient force injection. */
  let lastAmbientTime = 0;

  /**
   * Active click burst animations. Each burst ages out after
   * BURST_LIFETIME_SECONDS. `age` is seconds since the click event.
   */
  let clickBursts: Array<{ x: number; y: number; age: number }> = [];
  /** One burst per click (click-edge.ts); never reset with the sim. */
  const clickEdge = createClickEdge();

  /** Last render time — used for frame-rate-independent fades and phase accumulation. */

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Prevents audio-reactive visuals from popping — meditation content needs
   * gentle onsets and offsets.
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
   * Position of the last wanderer tap (normalised 0..1). Compared each
   * frame — a new tap fires when the wanderer has moved at least
   * `WANDERER_TAP_DISTANCE` from here. Initialised off-canvas so the first
   * tap always fires immediately on play.
   */
  let lastTapX = -10;
  let lastTapY = -10;
  let lastTapTime = -Infinity;

  /**
   * Orbit phase clock for bass rumble emitters. Accumulated with variable
   * rate (bass-scaled) so orbit speed changes without phase discontinuities.
   * Same pattern as `wandererPhase`.
   */
  let orbitPhase = 0;

  // Cached config values (updated each render call; stepSim reads them)
  let _curlScale = -0.6;
  let _advDist = 6.0;

  /** Current audio state, cached for the display pass. */
  let _audio: AudioState | undefined;
  /** Smoothed amplitude, cached for colour cycling + display. */
  let _amp = 0;

  // ── Sim step helper ────────────────────────────────────────
  /**
   * Step the fluid simulation once. Mouse coords are in sim-pixel space
   * (0..grid.w, 0..grid.h) — NOT normalised UV. `uForce` controls BOTH the Gaussian
   * radius AND the peak strength (via `exp(-length/(10·force))` additive
   * to velocity).
   */
  function stepSim(
    gl: WebGL2RenderingContext,
    mouseX: number,
    mouseY: number,
    mouseOn: boolean,
    force: number
  ): void {
    if (!simProg || !simU || !simBuf || !quad) return;

    gl.viewport(0, 0, grid.w, grid.h);
    gl.useProgram(simProg);
    quad.bind(simProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
    gl.uniform1i(simU.uState, 0);

    gl.uniform2f(simU.uTexel, 1.0 / grid.w, 1.0 / grid.h);
    gl.uniform1f(simU.uCurlScale, _curlScale);
    gl.uniform1f(simU.uAdvDist, _advDist);
    gl.uniform2f(simU.uMouse, mouseX, mouseY);
    gl.uniform1f(simU.uMouseActive, mouseOn ? 1.0 : 0.0);
    gl.uniform1f(simU.uForce, force);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    bindOutput(gl);
    simBuf.swap();
  }

  /**
   * Wanderer position (normalised 0..1). Noise-perturbed Lissajous bounded
   * to the inner field so injections don't clip the canvas edge.
   *
   * v2: 72% primary + 28% counter-rotating secondary component. The primary
   * sin/cos pair alone traces a path with a preferred rotation direction
   * (anti-clockwise under positive phase); the secondary uses opposite
   * parity (cos for x, sin for y) AND a negative phase factor on Y at
   * different frequencies, orbiting the opposite direction at a different
   * rate. Mixing breaks the uniform rotational bias without disrupting
   * the bounded path shape.
   */
  function wandererPosition(
    phase: number,
    amplitudeSmooth: number
  ): { x: number; y: number } {
    const radius =
      WANDERER_BASE_RADIUS + WANDERER_RADIUS_GAIN * amplitudeSmooth;
    const driftX = Math.sin(phase * WANDERER_DRIFT_RATE_X) * 2.0;
    const driftY = Math.sin(phase * WANDERER_DRIFT_RATE_Y + 1.3) * 1.7;

    // Primary Lissajous (72%) — sin/cos at ratio 0.13:0.19.
    const px = Math.sin(phase * WANDERER_FREQ_X + driftX);
    const py = Math.cos(phase * WANDERER_FREQ_Y + driftY);

    // Secondary counter-rotating Lissajous (28%) — opposite parity, negative
    // phase factor on Y, different irrational-ish frequencies so the combined
    // path never exactly repeats.
    const sx = Math.cos(phase * 0.31 + 2.1);
    const sy = Math.sin(-phase * 0.26 + 1.3);

    const x = 0.5 + radius * (0.72 * px + 0.28 * sx);
    const y = 0.5 + radius * (0.72 * py + 0.28 * sy);
    return { x, y };
  }

  // ── Display pass helper ────────────────────────────────────
  function displayPass(
    gl: WebGL2RenderingContext,
    time: number,
    cfg: SutureConfig,
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

    // Immersive colour cycling — uses smoothed amplitude so phase nudge
    // doesn't jitter.
    const colours = _audio?.active
      ? computeImmersiveColours(time, cfg.colors, _amp)
      : cfg.colors;

    gl.uniform3fv(displayU.uColorA, colours.primary);
    gl.uniform3fv(displayU.uColorB, colours.secondary);
    gl.uniform3fv(displayU.uColorC, colours.accent);
    gl.uniform3fv(displayU.uBgColor, colours.bg);
    gl.uniform1f(displayU.uIntensity, cfg.intensity);
    gl.uniform1f(displayU.uGrain, cfg.grain);
    gl.uniform1f(displayU.uVignette, _audio?.active ? 0.0 : cfg.vignette);
    gl.uniform1f(displayU.uTime, time);

    // Full-spectrum audio modulation. See display shader for exact mappings.
    const bassSmooth = _audio?.bassSmooth ?? 0;
    const midsSmooth = _audio?.midsSmooth ?? 0;
    const trebleSmooth = _audio?.trebleSmooth ?? 0;
    const amplitudeSmooth = _audio?.amplitudeSmooth ?? 0;
    gl.uniform1f(displayU.uBassSmooth, bassSmooth);
    gl.uniform1f(displayU.uMidsSmooth, midsSmooth);
    gl.uniform1f(displayU.uTrebleSmooth, trebleSmooth);
    gl.uniform1f(displayU.uAmplitudeSmooth, amplitudeSmooth);
    gl.uniform1f(displayU.uAudioActive, wandererFade);

    bindOutput(gl);
    drawQuad(gl);
  }

  return {
    init(gl: WebGL2RenderingContext, width: number, height: number): boolean {
      // Check required extensions
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      // Compile programs
      initProg = createProgram(gl, VERTEX_SHADER, SUTURE_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, SUTURE_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, SUTURE_DISPLAY_FRAG);

      if (!initProg || !simProg || !displayProg) return false;

      // Get uniform locations
      initU = getUniforms(gl, initProg, INIT_UNIFORM_NAMES);
      simU = getUniforms(gl, simProg, SIM_UNIFORM_NAMES);
      displayU = getUniforms(gl, displayProg, DISPLAY_UNIFORM_NAMES);

      // Create geometry and FBOs
      quad = createQuad(gl);
      grid = simGridFor(width, height);
      simBuf = createDoubleFBO(gl, grid.w, grid.h);

      // Seed initial state
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
      if (
        !initProg ||
        !simProg ||
        !displayProg ||
        !initU ||
        !simU ||
        !displayU ||
        !simBuf ||
        !quad
      )
        return;

      const cfg = config as SutureConfig;

      // Cache config values for stepSim. Curl is audio-boosted so the
      // fluid's vortical CHARACTER responds to bass/amplitude — not just
      // via injected impulses. User direction: "more curl or whatever
      // there is there that could also be affected".
      const bassSmoothEarly = audio?.bassSmooth ?? 0;
      const amplitudeSmoothEarly = audio?.amplitudeSmooth ?? 0;
      const curlBoost =
        (bassSmoothEarly * CURL_BASS_GAIN +
          amplitudeSmoothEarly * CURL_AMP_GAIN) *
        wandererFade;
      // Fallbacks: a caller can hand a fresh renderer another preset's config
      // for a frame, and a NaN here poisons the field for good.
      const curl = cfg.curl ?? DEFAULTS.curl;
      const dissipation = cfg.dissipation ?? DEFAULTS.dissipation;
      const audioCurl = curl + curl * curlBoost;
      _curlScale = -audioCurl / 50.0;
      const advBase = cfg.advection ?? DEFAULTS.advection;
      _advDist = dissipation > 0.98 ? advBase : advBase * (dissipation / 0.985);

      // The field is seeded ONCE, in reset(). It used to re-seed with a new
      // random seed on each of the first 10 frames and draw each one, so the
      // hero strobed through 10 unrelated images in its first ~166 ms.

      // Cache audio state for display pass and colour cycling.
      const bassSmooth = audio?.bassSmooth ?? 0;
      const amplitudeSmooth = audio?.amplitudeSmooth ?? 0;
      const beatPulse = audio?.beatPulse ?? 0;
      const audioActive = audio?.active ?? false;
      _audio = audio;
      _amp = amplitudeSmooth;

      // Frame-rate-independent dt — drives fade + phase accumulators.
      // One clock for the frame: dt and this frame's simulation steps.
      const { steps, first, dt } = clock.tick(time);

      // Ease wanderer fade toward 1 (audio playing) or 0 (paused).
      const fadeTarget = audioActive ? 1 : 0;
      wandererFade +=
        (fadeTarget - wandererFade) * Math.min(1, dt * WANDERER_FADE_RATE);

      // ── Per-frame state ────────────────────────────────────
      // The phases follow dt and a click is caught on the frame it lands.
      // Nothing here steps the simulation: the impulses below do, on the
      // step clock.
      if (wandererFade > 0.01) {
        // Advance the variable-rate phase: louder → faster wanderer.
        // Amplitude-driven only (beat-burst experiment removed — made the
        // wanderer feel jerky on the advection-based fluid).
        wandererPhase += dt * (1 + amplitudeSmooth * WANDERER_SPEED_GAIN);
      }
      orbitPhase +=
        dt * BASS_ORBIT_RATE * (1 + bassSmooth * BASS_ORBIT_SPEED_GAIN);
      // One burst per click (click-edge.ts). A burst used to be queued on
      // every frame burstStrength was above zero: ~28 per click at 60 Hz,
      // each running 8 extra steps, so a click raced the fluid for ~0.5 s.
      if (clickEdge.clicked(mouse.burstStrength)) {
        clickBursts.push({ x: mouse.x * grid.w, y: mouse.y * grid.h, age: 0 });
      }

      /**
       * The impulses: wanderer taps, beat splashes, bass rumble, ambient
       * force and click bursts. Each one is a simulation step of its own, so
       * they run on the clock's input steps (60 a second at any frame rate).
       * They ran once a FRAME, so at 120 Hz they landed twice as often (the
       * fluid raced while audio played), and they still stepped the fluid
       * on a still frame that takes no steps. At 60 Hz the count and order
       * are what they were.
       *
       * Its complexity is render's per-frame impulse code, moved here as it
       * was (render is simpler by as much). Split per impulse, it doubled
       * the code ripple and suture already share (fallow dupes, WP-1d).
       */
      // fallow-ignore-next-line complexity
      const applyImpulses = (): void => {
        // ── Wanderer: distance-based taps + beat-synced splash ─
        // Rewritten from the old continuous-every-frame deposit (which
        // caused a static dome at slow wanderer speeds, NOT a propagating
        // trail) into discrete taps that fire only after the wanderer has
        // physically moved past a fresh patch of fluid. Tap rate EMERGES
        // from wanderer speed: loud audio → fast wanderer → many taps per
        // second; quiet audio → slow wanderer → sparse taps.
        if (wandererFade > 0.01) {
          const pos = wandererPosition(wandererPhase, amplitudeSmooth);

          // Distance-based tap: fire only when the wanderer has physically
          // moved enough from the previous tap. Guarantees no overlap /
          // buildup / flicker regardless of speed. Fallback max-interval
          // keeps a nearly-stationary wanderer alive during very quiet
          // content.
          const dx = pos.x - lastTapX;
          const dy = pos.y - lastTapY;
          const distSq = dx * dx + dy * dy;
          const threshSq = WANDERER_TAP_DISTANCE * WANDERER_TAP_DISTANCE;
          const timeSinceLast = time - lastTapTime;
          if (distSq > threshSq || timeSinceLast > WANDERER_TAP_MAX_INTERVAL) {
            lastTapX = pos.x;
            lastTapY = pos.y;
            lastTapTime = time;
            const tapForce =
              (WANDERER_TAP_BASE + WANDERER_TAP_GAIN * amplitudeSmooth) *
              wandererFade;
            stepSim(gl, pos.x * grid.w, pos.y * grid.h, true, tapForce);
          }

          // Beat-synced splash: larger discrete impulse at the wanderer's
          // current position when the onset detector fires. Gated on
          // audible pulse so it doesn't ring during fade-in.
          if (beatPulse > 0.2 && audioActive) {
            const splashForce =
              (WANDERER_SPLASH_BASE + WANDERER_SPLASH_GAIN * beatPulse) *
              wandererFade;
            stepSim(gl, pos.x * grid.w, pos.y * grid.h, true, splashForce);
          }
        }

        // ── Bass rumble emitter (v4 — smooth consistent outer swirl) ─
        // For SUTURE's advection-based fluid, continuous deposits at
        // orbital positions create SMOOTH swirling outflow (no dome risk):
        // a consistent uniform-direction orbit at shared radius, orbit
        // speed + force both scaling with bass. This keeps the rumble
        // confined to its own outer ring (the "swirling border" aesthetic
        // the user asked for). The deposits are per input step now (60 a
        // second), which is what "per frame" meant at 60 Hz.
        if (
          audioActive &&
          bassSmooth > BASS_RUMBLE_FLOOR &&
          wandererFade > 0.01
        ) {
          const emitterCount = Math.min(
            BASS_RUMBLE_MAX_EMITTERS,
            1 + Math.floor(bassSmooth * 4)
          );
          const rumbleForce =
            (BASS_RUMBLE_FORCE_BASE + bassSmooth * BASS_RUMBLE_STRENGTH) *
            wandererFade;
          for (let i = 0; i < emitterCount; i++) {
            // Per-emitter ANGLE wobble — each emitter drifts ±20° from its
            // even-spaced base angle on an independent slow oscillator.
            // Breaks the "clockwork" feel without abandoning the consistent
            // outer-ring aesthetic.
            const angleWobble =
              BASS_ORBIT_A_WOBBLE * Math.sin(orbitPhase * 0.29 + i * 2.3);
            const angle =
              orbitPhase + (i * (Math.PI * 2)) / emitterCount + angleWobble;
            // Per-emitter RADIUS wobble — emitter drifts in/out within the
            // ring on a separate oscillator frequency. Combined with the
            // angle wobble, each emitter traces an independent organic
            // path confined to the outer region.
            const radiusWobble =
              BASS_ORBIT_R_WOBBLE * Math.sin(orbitPhase * 0.37 + i * 1.7);
            const r =
              BASS_ORBIT_R_BASE +
              BASS_ORBIT_R_BREATH * Math.sin(time * 0.11 + i * 1.7) +
              radiusWobble;
            const bx = 0.5 + r * Math.cos(angle);
            const by = 0.5 + r * Math.sin(angle);
            // Per-emitter temporal modulation on force — breaks the
            // standing-wave resonance that a constant-force point source
            // would excite in suture's curl+divergence feedback. Each
            // emitter's phase is offset so they don't pulse in sync.
            const forceMod =
              1.0 -
              BASS_EMITTER_MOD_AMP *
                (0.5 +
                  0.5 * Math.sin(orbitPhase * BASS_EMITTER_MOD_RATE + i * 1.9));
            stepSim(gl, bx * grid.w, by * grid.h, true, rumbleForce * forceMod);
          }
        }

        // ── Ambient force — sparse background life ──────────────
        // Much less frequent now that the wanderer + rumble path handle the
        // primary motion during playback. Interval depends on playback
        // state.
        const ambientInterval = audioActive
          ? AMBIENT_INTERVAL_PLAYING_MIN +
            Math.random() *
              (AMBIENT_INTERVAL_PLAYING_MAX - AMBIENT_INTERVAL_PLAYING_MIN)
          : AMBIENT_INTERVAL_IDLE_MIN +
            Math.random() *
              (AMBIENT_INTERVAL_IDLE_MAX - AMBIENT_INTERVAL_IDLE_MIN);
        if (time - lastAmbientTime > ambientInterval) {
          lastAmbientTime = time;
          const ax = (0.15 + Math.random() * 0.7) * grid.w;
          const ay = (0.15 + Math.random() * 0.7) * grid.h;
          const force = dissipation > 0.98 ? 1.0 : dissipation;
          stepSim(gl, ax, ay, true, force);
        }

        // ── Click bursts: a radial sweep over BURST_LIFETIME_SECONDS ──
        // The angle sweeps a full circle as the burst ages; it ages one
        // input step at a time, so it is 12 pushes at any frame rate. The
        // wanderer + bass rumble emitters (above) handle audio-driven
        // injections during playback, so the old unconditional
        // `if (audio.active && bass > 0.5)` random impulse path stays gone —
        // it would double-inject on top of the wanderer's beat splashes.
        for (let i = clickBursts.length - 1; i >= 0; i--) {
          const b = clickBursts[i];
          const progress = b.age / BURST_LIFETIME_SECONDS;
          const angle = progress * Math.PI * 2;
          const bx = b.x + Math.cos(angle) * CLICK_BURST_RADIUS;
          const by = b.y + Math.sin(angle) * CLICK_BURST_RADIUS;
          stepSim(gl, bx, by, true, CLICK_BURST_FORCE);
          b.age += INPUT_STEP_SECONDS;
          if (b.age >= BURST_LIFETIME_SECONDS - 1e-6) clickBursts.splice(i, 1);
        }
      };

      // ── Mouse hover — attenuated during loud passages so music leads.
      // Ducks up to ~50% as smoothed amplitude rises.
      const mouseAttenuation = audioActive
        ? Math.max(0.45, 1.0 - 0.55 * amplitudeSmooth)
        : 1.0;
      const mouseX = mouse.active ? mouse.x * grid.w : -1000;
      const mouseY = mouse.active ? mouse.y * grid.h : -1000;
      // Steps follow elapsed time, so 120 Hz runs suture at 60 Hz speed.
      // Input lands on a fixed stride of steps (INPUT_STRIDE): 60 pushes a
      // second at any frame rate, as flow and ripple do, the impulses with
      // it.
      for (let i = 0; i < steps; i++) {
        const inputStep = (first + i) % INPUT_STRIDE === 0;
        if (inputStep) applyImpulses();
        const input = inputStep && mouse.active;
        stepSim(
          gl,
          input ? mouseX : -1000,
          input ? mouseY : -1000,
          input,
          (cfg.force ?? DEFAULTS.force) * mouseAttenuation
        );
      }

      // ── Display pass ───────────────────────────────────────
      displayPass(gl, time, cfg, width, height);
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
      if (!initProg || !initU || !simBuf || !quad) return;

      clock.reset();
      lastAmbientTime = 0;
      wandererFade = 0;
      wandererPhase = 0;
      lastTapX = -10;
      lastTapY = -10;
      lastTapTime = -Infinity;
      orbitPhase = 0;
      clickBursts = [];

      gl.viewport(0, 0, grid.w, grid.h);
      gl.useProgram(initProg);
      quad.bind(initProg);
      gl.uniform1f(initU.uSeed, Math.random() * 100.0);

      // Seed both FBO sides
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

      initU = null;
      simU = null;
      displayU = null;
      clickBursts = [];
    },
  };
}
