/**
 * Ether renderer — Raymarched volumetric light (nimitz 2014).
 *
 * Single-pass: one program + fullscreen quad, no FBOs.
 * Mouse parallax shifts the view origin, lerped smoothly (0.04 rate).
 * Configurable: rotationSpeed, complexity (3-8 steps), glow, scale, zoom.
 * Brand colors as uniforms (primary, secondary, accent, bg).
 *
 * Audio-reactive immersive mode follows the pattern established by ripple, but
 * adapted for a single-pass raymarched shader — there is no simulation FBO to
 * inject impulses into. Instead:
 *   - A "wanderer" virtual light focal point follows a noise-perturbed
 *     Lissajous path. Passed to the shader as a uniform and used to bias the
 *     raymarch origin (so the volumetric structure drifts with it) AND to
 *     seed an additive radial glow term.
 *   - `bassSmooth` drives a slow global glow lift + shader-side UV-breath
 *     warping inside the raymarch loop (sub-sonic pressure).
 *   - `midsSmooth` sparkles on the shader's highlight term.
 *   - `trebleSmooth` amplifies aberration and the bloom/highlight boost.
 *   - `amplitudeSmooth` lifts the saturation pump (pre-ACES) + base brightness.
 *   - `beatPulse` adds a short-lived overall brightness splash on onsets.
 *   - `wandererFade` eases 0→1 on audio start, 1→0 on pause — gates all
 *     audio-reactive boosts so the scene doesn't pop.
 */

import {
  AUDIO_UNIFORM_NAMES,
  createAudioFade,
  uploadAudioUniforms,
} from '../audio-uniforms';
import { computeImmersiveColours } from '../immersive-colours';
import type { AudioState, MouseState, ShaderRenderer } from '../renderer-types';
import type { EtherConfig, ShaderConfig } from '../shader-config';
import { ETHER_FRAG } from '../shaders/ether.frag';
import {
  createSinglePass,
  easePointer,
  restingPointer,
  setPalette,
} from './single-pass';

// ── Wanderer tunables (mirror ripple-renderer.ts) ──────────────
/** Wanderer path base frequencies — irrational ratio, never exactly repeats. */
const WANDERER_FREQ_X = 0.13;
const WANDERER_FREQ_Y = 0.19;
/** Slow phase-drift rates — reshape the Lissajous curve over ~minute timescales. */
const WANDERER_DRIFT_RATE_X = 0.017;
const WANDERER_DRIFT_RATE_Y = 0.023;
/** Base path radius (fraction of canvas half-width). Audio amplitude expands this. */
const WANDERER_BASE_RADIUS = 0.14;
const WANDERER_RADIUS_GAIN = 0.05;
/** Fade curve for the wanderer — eases from 0 on pause/resume. */
const WANDERER_FADE_RATE = 2.5; // higher = faster fade-in/out (units per second)

const UNIFORM_NAMES = [
  'u_time',
  'u_resolution',
  'u_mouse',
  'u_brandPrimary',
  'u_brandSecondary',
  'u_brandAccent',
  'u_bgColor',
  'u_phase',
  'u_complexity',
  'u_glow',
  'u_scale',
  'u_zoom',
  'u_intensity',
  'u_grain',
  'u_vignette',
  'u_aberration',
  // Audio-reactive uniforms
  'u_wanderer',
  ...AUDIO_UNIFORM_NAMES,
] as const;

/** Default values matching the prototype. */
// The lab's tuning, which shader-config's DEFAULTS also carry.
const DEFAULTS = {
  rotSpeed: 0.9,
  complexity: 8,
  glow: 1.5,
  scale: 4.0,
  zoom: 5.5,
  intensity: 0.65,
  grain: 0.07,
  vignette: 0.3,
  aberration: 0.02,
} as const;

/** Per-frame share of the way the eased pointer moves toward the real one. */
const MOUSE_LERP = 0.04;

export function createEtherRenderer(): ShaderRenderer {
  const pass = createSinglePass(ETHER_FRAG, UNIFORM_NAMES);
  const audioFade = createAudioFade();

  // Eased for smooth parallax; only its position is uploaded.
  let pointer = restingPointer();

  /** Last render time — used for frame-rate-independent fades. */
  let lastRenderTime = 0;

  /**
   * Wanderer fade intensity (0..1). Eases in on audio start, out on pause.
   * Gates all audio-reactive visual boosts so the shader doesn't pop.
   */
  let wandererFade = 0;

  /** Rotation angle: the integral of the rotation speed, see u_phase. */
  let phase = 0;

  /**
   * Wanderer position — noise-perturbed Lissajous. Smooth everywhere, never
   * exactly repeats. The inner sin(drift) term reshapes the curve slowly so
   * consecutive orbits don't trace the same path. Returns 0..1 UV space.
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
      if (!pass.init(gl)) return false;
      pointer = restingPointer();
      lastRenderTime = 0;
      wandererFade = 0;
      phase = 0;
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
      const u = pass.begin(gl, width, height);
      if (!u) return;

      const cfg = config as EtherConfig;
      const bassSmooth = audio?.bassSmooth ?? 0;
      const trebleSmooth = audio?.trebleSmooth ?? 0;
      const amplitudeSmooth = audio?.amplitudeSmooth ?? 0;
      const audioActive = audio?.active ?? false;

      // Frame-rate-independent dt — used for the wanderer fade.
      const dt =
        lastRenderTime === 0 ? 1 / 60 : Math.min(0.1, time - lastRenderTime);
      lastRenderTime = time;
      // Resolve through the shared fade so this preset speaks the same audio
      // vocabulary as every other, and gains the five signals it never had
      // (energy, flux, centroid, beatPhase, beatSeed).
      const a = audioFade.update(audio, dt);

      // Ease wanderer fade toward 1 (audio playing) or 0 (paused).
      const fadeTarget = audioActive ? 1 : 0;
      wandererFade +=
        (fadeTarget - wandererFade) * Math.min(1, dt * WANDERER_FADE_RATE);

      easePointer(pointer, mouse, MOUSE_LERP);

      // Wanderer position (UV 0..1) — feeds both focal-point shift and
      // additive glow in the shader.
      const wanderer = wandererPosition(time, amplitudeSmooth);

      uploadAudioUniforms(gl, u, a);
      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform2f(u.u_mouse, pointer.x, pointer.y);

      // Immersive colour cycling when audio is active — smoothed amplitude
      // so palette phase doesn't jitter.
      setPalette(
        gl,
        u,
        audioActive
          ? computeImmersiveColours(time, cfg.colors, amplitudeSmooth)
          : cfg.colors
      );

      // Preset-specific config. Rotation speed drifts very gently with
      // smoothed amplitude (not raw) so loud passages feel more alive without
      // jitter on transients. It is integrated here: the shader used
      // time * speed, so any change of speed jumped the angle by time * the
      // change (after a minute, a slider nudge spun the form).
      phase +=
        dt *
        ((cfg.rotationSpeed ?? DEFAULTS.rotSpeed) + amplitudeSmooth * 0.12);
      gl.uniform1f(u.u_phase, phase);
      gl.uniform1i(u.u_complexity, cfg.complexity ?? DEFAULTS.complexity);
      // Glow lifts visibly with smoothed bass — deeper low-frequency presence.
      // Expanded from the old raw `bass * 0.1` to a larger envelope on
      // bassSmooth, gated by the wanderer fade.
      gl.uniform1f(
        u.u_glow,
        (cfg.glow ?? DEFAULTS.glow) * (1.0 + bassSmooth * 0.45 * wandererFade)
      );
      gl.uniform1f(u.u_scale, cfg.scale ?? DEFAULTS.scale);
      gl.uniform1f(u.u_zoom, cfg.zoom ?? DEFAULTS.zoom);
      gl.uniform1f(u.u_intensity, cfg.intensity ?? DEFAULTS.intensity);
      gl.uniform1f(u.u_grain, cfg.grain ?? DEFAULTS.grain);
      gl.uniform1f(
        u.u_vignette,
        audioActive ? 0.0 : (cfg.vignette ?? DEFAULTS.vignette)
      );
      // Treble pushes aberration up — keeps the baseline tunable value but
      // adds edge colour fringing on bright high-frequency passages.
      gl.uniform1f(
        u.u_aberration,
        (cfg.aberration ?? DEFAULTS.aberration) *
          (1.0 + trebleSmooth * 1.5 * wandererFade)
      );

      // Audio-reactive uniforms
      gl.uniform2f(u.u_wanderer, wanderer.x, wanderer.y);
      pass.draw(gl);
    },

    resize(_gl: WebGL2RenderingContext, _width: number, _height: number): void {
      // Single-pass preset: no FBOs to resize. Viewport set in render().
    },

    reset(_gl: WebGL2RenderingContext): void {
      // No simulation state to reset for single-pass presets.
      pointer = restingPointer();
      lastRenderTime = 0;
      wandererFade = 0;
    },

    destroy(gl: WebGL2RenderingContext): void {
      pass.destroy(gl);
    },
  };
}
