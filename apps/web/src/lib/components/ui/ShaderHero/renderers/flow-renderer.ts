/**
 * Flow renderer — Curl-noise vector field painting (2-pass FBO).
 *
 * Ping-pong FBO (512x512): RG = vector field, B = divergence.
 * Self-organising dynamical system: self-advection + curl rotation
 * + Laplacian smoothing creates coherent flow patterns.
 * Display uses Line Integral Convolution (LIC) to map the field
 * to flowing paint streaks in brand colors.
 *
 * Audio-reactive immersive mode mirrors the pattern established by the
 * ripple preset:
 *   - A "wanderer" (noise-perturbed Lissajous point) injects a gentle
 *     continuous curl burst into the field every frame, with a larger
 *     burst on detected beat onsets.
 *   - A bass rumble emitter injects wider, slower curl bursts at orbiting
 *     positions driven by `bassSmooth²`. Provides continuous low-end
 *     "presence" on meditation drones that lack transients.
 *   - A smooth `wandererFade` (eased on play/pause) gates all audio-reactive
 *     effects so nothing pops in/out.
 *   - Smoothed envelopes drive display modulation: bass shakes and breathes
 *     the colour sample; mids drive streak brightness + palette hue nudge;
 *     treble lifts a flow-aligned sheen; amplitude drives the vibrance pump.
 *
 * Adapted from Flexi's curl-noise dynamical system (Shadertoy XddSRX).
 */

import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { FlowConfig, ShaderConfig } from '../shader-config';
import { FLOW_DISPLAY_FRAG } from '../shaders/flow-display.frag';
import { FLOW_SIM_FRAG } from '../shaders/flow-sim.frag';
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

/** Init shader: seeds with noise-based vector field. */
const FLOW_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Seed with random vectors (noise texture substitute)
  // The dynamical system will self-organise from any noise seed
  float h1 = hash21(v_uv * 256.0 + 1.0);
  float h2 = hash21(v_uv * 256.0 + 2.0);
  vec2 v = vec2(h1, h2) - 0.5; // range -0.5 to 0.5
  fragColor = vec4(v, 0.0, 1.0);
}
`;

// ── Wanderer tunables ─────────────────────────────────────────
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
 * Continuous trail burst — small curl injection into the vector field at
 * the wanderer's position every frame during audio playback. Kept small so
 * the field's coherent streaks aren't shredded; big enough to be felt.
 */
const WANDERER_TRAIL_BASE = 0.08;
const WANDERER_TRAIL_GAIN = 0.12;
/**
 * Beat-synced splash — larger curl injection when `beatPulse > 0.2`.
 * Beatpulse already decays; we gate + scale so the burst "rings" visibly.
 */
const WANDERER_SPLASH_BASE = 0.45;
const WANDERER_SPLASH_GAIN = 0.8;
/** Fade curve for the wanderer — eases from 0 on pause/resume. */
const WANDERER_FADE_RATE = 2.5;

// ── Bass rumble emitter tunables ─────────────────────────────
/**
 * Continuous wide curl bursts driven by smoothed bass. Meditation drones
 * have no transients for the beat detector to latch onto, so this provides
 * the low-end "shake" the viewer should feel. 1-4 emitters orbit around
 * the canvas centre and inject curl at each position, larger brush than the
 * wanderer. Quadratic scaling so soft bass is subtle, loud bass is dramatic.
 */
/** Below this smoothed-bass value, no rumble impulses are emitted. */
const BASS_RUMBLE_FLOOR = 0.1;
/** Per-frame burst strength coefficient (applied to bassSmooth²). */
const BASS_RUMBLE_STRENGTH = 0.5;
/** Orbit rate of rumble emitters around canvas centre (rad/s). */
const BASS_ORBIT_RATE = 0.23;
/** Emitter orbit radius baseline + breathing amplitude. */
const BASS_ORBIT_R_BASE = 0.32;
const BASS_ORBIT_R_BREATH = 0.06;

const SIM_UNIFORM_NAMES = [
  'uState',
  'uTexel',
  'uTime',
  'uMouse',
  'uMouseActive',
  'uBurst',
  'uCurl',
  'uAdvection',
  'uSmoothing',
  'uFieldSpeed',
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
  'uContrast',
  'uBassSmooth',
  'uMidsSmooth',
  'uTrebleSmooth',
  'uAmplitudeSmooth',
  'uAudioActive',
] as const;

const DEFAULTS = {
  curl: 0.6,
  advection: 6.0,
  smoothing: 0.8,
  contrast: 12.0,
  fieldSpeed: 1.0,
  intensity: 0.65,
  grain: 0.025,
  vignette: 0.2,
} as const;

export function createFlowRenderer(): ShaderRenderer {
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

  /** Last render time — used for frame-rate-independent fades. */
  let lastRenderTime = 0;

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Prevents the wanderer from popping into existence — meditation-first
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
    burst: number,
    cfg: FlowConfig
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

    gl.uniform1f(simU.uCurl, cfg.curl ?? DEFAULTS.curl);
    gl.uniform1f(simU.uAdvection, cfg.advection ?? DEFAULTS.advection);
    gl.uniform1f(simU.uSmoothing, cfg.smoothing ?? DEFAULTS.smoothing);
    gl.uniform1f(simU.uFieldSpeed, cfg.fieldSpeed ?? DEFAULTS.fieldSpeed);

    gl.bindFramebuffer(gl.FRAMEBUFFER, simBuf.write.fbo);
    drawQuad(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    simBuf.swap();
  }

  /**
   * Wanderer position — noise-perturbed Lissajous. Bounded to [~0.36, ~0.64]
   * with default radius, smooth everywhere, never exactly repeats.
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
      if (!gl.getExtension('EXT_color_buffer_float')) return false;
      gl.getExtension('OES_texture_float_linear');

      initProg = createProgram(gl, VERTEX_SHADER, FLOW_INIT_FRAG);
      simProg = createProgram(gl, VERTEX_SHADER, FLOW_SIM_FRAG);
      displayProg = createProgram(gl, VERTEX_SHADER, FLOW_DISPLAY_FRAG);

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

      const cfg = config as FlowConfig;
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

      // Audio-modulated config for sim — gentle speed/curl boost using
      // smoothed amplitude so the field itself doesn't jitter.
      const audioCfg = audioActive
        ? {
            ...cfg,
            fieldSpeed:
              (cfg.fieldSpeed ?? DEFAULTS.fieldSpeed) + amplitudeSmooth * 0.15,
            curl: (cfg.curl ?? DEFAULTS.curl) + amplitudeSmooth * 0.15,
          }
        : cfg;

      // ── Wanderer: continuous trail + beat-synced splash ──────
      if (wandererFade > 0.01) {
        const pos = wandererPosition(time, amplitudeSmooth);

        // Continuous trail: a single gentle curl-burst at the wanderer's
        // position every frame. Strength scales with smoothed amplitude so
        // loud passages feel more present without jittering.
        const trailStrength =
          (WANDERER_TRAIL_BASE + WANDERER_TRAIL_GAIN * amplitudeSmooth) *
          wandererFade;
        stepSim(gl, time, pos.x, pos.y, false, trailStrength, audioCfg);

        // Beat-synced splash: bigger burst at the wanderer's current
        // position when the onset detector fires. Gated on audible pulse so
        // it doesn't ring during fade-in.
        if (beatPulse > 0.2 && audioActive) {
          const splashStrength =
            (WANDERER_SPLASH_BASE + WANDERER_SPLASH_GAIN * beatPulse) *
            wandererFade;
          stepSim(gl, time, pos.x, pos.y, false, splashStrength, audioCfg);
        }
      }

      // ── Bass rumble emitter ──────────────────────────────────
      // Parallel to the beat-onset path. Sustained low-end (meditation
      // drones, pads, rumble) produces no transients for the onset detector
      // to fire on, but there IS continuous bass energy the viewer should
      // feel. We emit 1-4 wide curl bursts at orbiting positions — the
      // dynamical system blends these into large-scale "atmospheric swirl."
      // Quadratic bass scaling so soft bass is subtle, loud bass is
      // dramatic.
      if (
        audioActive &&
        bassSmooth > BASS_RUMBLE_FLOOR &&
        wandererFade > 0.01
      ) {
        const emitterCount = Math.min(4, 1 + Math.floor(bassSmooth * 6));
        const orbitT = time * BASS_ORBIT_RATE;
        const rumbleStrength =
          bassSmooth * bassSmooth * BASS_RUMBLE_STRENGTH * wandererFade;
        for (let i = 0; i < emitterCount; i++) {
          const angle = orbitT + (i * (Math.PI * 2)) / emitterCount;
          // Orbit radius breathes slowly so positions don't feel static.
          const r =
            BASS_ORBIT_R_BASE +
            BASS_ORBIT_R_BREATH * Math.sin(time * 0.11 + i * 1.7);
          const bx = 0.5 + r * Math.cos(angle);
          const by = 0.5 + r * Math.sin(angle);
          stepSim(gl, time, bx, by, false, rumbleStrength, audioCfg);
        }
      }

      // ── Mouse hover + click burst ────────────────────────────
      // Mouse hover attenuates during loud passages so the music leads —
      // ducks up to ~45% as smoothed amplitude rises.
      const mouseAttenuation = audioActive
        ? Math.max(0.55, 1.0 - 0.45 * amplitudeSmooth)
        : 1.0;
      stepSim(
        gl,
        time,
        mouse.active ? mouse.x : -10.0,
        mouse.active ? mouse.y : -10.0,
        mouse.active,
        (mouse.burstStrength ?? 0.0) * mouseAttenuation,
        audioCfg
      );

      // ── Substep 2: coast (no input) ───────────────────────
      stepSim(gl, time, -10.0, -10.0, false, 0.0, audioCfg);

      // ── Display pass ──────────────────────────────────────
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProg);
      quad.bind(displayProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simBuf.read.tex);
      gl.uniform1i(displayU.uState, 0);

      // Immersive colour cycling — uses smoothed amplitude so phase nudge
      // doesn't jitter.
      const colours = audioActive
        ? computeImmersiveColours(time, cfg.colors, amplitudeSmooth)
        : cfg.colors;

      gl.uniform3fv(displayU.uColorPrimary, colours.primary);
      gl.uniform3fv(displayU.uColorSecondary, colours.secondary);
      gl.uniform3fv(displayU.uColorAccent, colours.accent);
      gl.uniform3fv(displayU.uBgColor, colours.bg);
      gl.uniform1f(displayU.uIntensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(displayU.uGrain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        displayU.uVignette,
        audioActive ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );
      gl.uniform1f(displayU.uTime, time);
      gl.uniform1f(displayU.uContrast, cfg.contrast ?? DEFAULTS.contrast);

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
    },

    reset(gl: WebGL2RenderingContext): void {
      if (!initProg || !simBuf || !quad) return;

      lastRenderTime = 0;
      wandererFade = 0;

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
